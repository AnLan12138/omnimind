package vnc

import (
	"bytes"
	"compress/zlib"
	"context"
	"crypto/des"
	"encoding/binary"
	"fmt"
	"image/jpeg"
	"io"
	"net"
	"sync"
	"time"

	"omnimind/internal/protocol"
)

const (
	encRaw                = 0
	encCopyRect           = 1
	encHextile            = 5
	encTight              = 7
	encDesktopSizePseudo  = int32(-223) // 0xFFFFFF21
)

type FrameRect struct {
	X, Y          uint16
	Width, Height uint16
	EncType       int32
	Data          []byte // raw BGRA pixel data (for CopyRect: [srcX,srcY])
}

type FrameUpdate struct {
	Rects []FrameRect
}

type Client struct {
	cfg protocol.ConnConfig

	conn   net.Conn
	reader io.Reader

	width  uint16
	height uint16
	name   string

	state   protocol.ConnState
	stateMu sync.RWMutex

	onData      protocol.DataCallback
	onState     protocol.StateCallback
	onError     protocol.ErrorCallback
	onFrame     func(*FrameUpdate)
	onClipboard func(string) // called when server sends clipboard text

	cancel context.CancelFunc
}

func (c *Client) OnClipboard(cb func(string)) { c.onClipboard = cb }

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 0 { cfg.Port = 5900; addr = fmt.Sprintf("%s:%d", cfg.Host, 5900) }

	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		c.setError(fmt.Errorf("dial: %w", err))
		return err
	}
	c.conn = conn

	// Handshake
	serverVer := make([]byte, 12)
	if _, err := io.ReadFull(conn, serverVer); err != nil {
		conn.Close()
		return fmt.Errorf("read version: %w", err)
	}
	conn.Write([]byte("RFB 003.008\n"))

	// Security
	var nSec [1]byte
	io.ReadFull(conn, nSec[:])
	secTypes := make([]byte, nSec[0])
	if nSec[0] > 0 { io.ReadFull(conn, secTypes) }

	// Try no-auth first, then VNC auth
	chosen := byte(0)
	for _, t := range secTypes {
		if t == 1 { chosen = 1; break } // None
		if t == 2 && cfg.Password != "" { chosen = 2; break } // VNC
	}
	if chosen == 0 { conn.Close(); return fmt.Errorf("no compatible auth") }
	conn.Write([]byte{chosen})

	if chosen == 2 {
		challenge := make([]byte, 16)
		io.ReadFull(conn, challenge)
		resp := vncAuth(challenge, cfg.Password)
		conn.Write(resp)
	}

	// Security result
	var secResult [4]byte
	io.ReadFull(conn, secResult[:])
	if binary.BigEndian.Uint32(secResult[:]) != 0 {
		reason := make([]byte, 255)
		n, _ := conn.Read(reason)
		conn.Close()
		return fmt.Errorf("auth failed: %s", string(reason[:n]))
	}

	// ClientInit
	conn.Write([]byte{1})

	// ServerInit
	if err := c.readServerInit(); err != nil { conn.Close(); return err }

	// Set 32-bit BGRA pixel format
	c.setPixelFormat()
	c.setEncodings([]int32{encTight, encHextile, encCopyRect, encRaw, encDesktopSizePseudo})

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	go c.readLoop(ctx)

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil { c.cancel() }
	if c.conn != nil { c.conn.Close() }
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	if c.conn == nil { return fmt.Errorf("not connected") }
	_, err := c.conn.Write(data)
	return err
}
func (c *Client) Resize(rows, cols int) error { return nil }
func (c *Client) State() protocol.ConnState { c.stateMu.RLock(); defer c.stateMu.RUnlock(); return c.state }
func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }
func (c *Client) OnFrame(cb func(*FrameUpdate))     { c.onFrame = cb }
func (c *Client) Features() protocol.Features {
	return protocol.Features{TerminalType: "canvas", SupportsSFTP: false, SupportsClipboard: true, SupportsResize: false, SupportsRecording: false, SupportsFilePanel: false}
}

// SendClipboard sends local clipboard text to the VNC server (ClientCutText)
func (c *Client) SendClipboard(text string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	data := []byte(text)
	buf := make([]byte, 8+len(data))
	buf[0] = 6 // ClientCutText message type
	buf[4] = byte(len(data) >> 24)
	buf[5] = byte(len(data) >> 16)
	buf[6] = byte(len(data) >> 8)
	buf[7] = byte(len(data))
	copy(buf[8:], data)
	_, err := c.conn.Write(buf)
	return err
}
func (c *Client) FrameSize() (uint16, uint16) { return c.width, c.height }

func (c *Client) RequestUpdate() {
	if c.conn != nil {
		c.sendFBUpdateReq(false, 0, 0, c.width, c.height)
	}
}

func (c *Client) SendPointer(x, y uint16, buttons uint8) {
	var buf [6]byte
	buf[0] = 5; buf[1] = buttons
	binary.BigEndian.PutUint16(buf[2:4], x)
	binary.BigEndian.PutUint16(buf[4:6], y)
	c.conn.Write(buf[:])
}

func (c *Client) SendKey(down bool, keySym uint32) {
	var buf [8]byte
	buf[0] = 4; buf[1] = boolByte(down); buf[2] = 0; buf[3] = 0
	binary.BigEndian.PutUint32(buf[4:8], keySym)
	c.conn.Write(buf[:])
}

// --- internal ---

func (c *Client) readServerInit() error {
	var h [24]byte
	if _, err := io.ReadFull(c.conn, h[:]); err != nil { return err }
	c.width = binary.BigEndian.Uint16(h[0:2])
	c.height = binary.BigEndian.Uint16(h[2:4])
	_ = h[4:20] // pixel format - we override
	nameLen := binary.BigEndian.Uint32(h[20:24])
	name := make([]byte, nameLen)
	io.ReadFull(c.conn, name)
	c.name = string(name)
	return nil
}

func (c *Client) setPixelFormat() {
	var buf [20]byte
	buf[0] = 0
	buf[4] = 32; buf[5] = 24; buf[6] = 0; buf[7] = 1
	binary.BigEndian.PutUint16(buf[8:10], 255)
	binary.BigEndian.PutUint16(buf[10:12], 255)
	binary.BigEndian.PutUint16(buf[12:14], 255)
	buf[14] = 16; buf[15] = 8; buf[16] = 0
	c.conn.Write(buf[:])
}

func (c *Client) setEncodings(encs []int32) {
	buf := make([]byte, 4+4*len(encs))
	buf[0] = 2
	binary.BigEndian.PutUint16(buf[2:4], uint16(len(encs)))
	for i, e := range encs { binary.BigEndian.PutUint32(buf[4+4*i:], uint32(e)) }
	c.conn.Write(buf)
}

func (c *Client) sendFBUpdateReq(incremental bool, x, y, w, h uint16) {
	var buf [10]byte
	buf[0] = 3; buf[1] = boolByte(incremental)
	binary.BigEndian.PutUint16(buf[2:4], x)
	binary.BigEndian.PutUint16(buf[4:6], y)
	binary.BigEndian.PutUint16(buf[6:8], w)
	binary.BigEndian.PutUint16(buf[8:10], h)
	c.conn.Write(buf[:])
}

func (c *Client) readLoop(ctx context.Context) {
	c.sendFBUpdateReq(false, 0, 0, c.width, c.height)

	for {
		select {
		case <-ctx.Done(): return
		default:
		}

		var msgType [1]byte
		if _, err := io.ReadFull(c.conn, msgType[:]); err != nil {
			if ctx.Err() == nil { c.setError(err); c.setState(protocol.StateDisconnected) }
			return
		}

		switch msgType[0] {
		case 0: c.handleFBUpdate()
		case 2: // SetColourMapEntries
			skip := make([]byte, 5)
			io.ReadFull(c.conn, skip)
			n := int(binary.BigEndian.Uint16(skip[2:4]))
			if n > 0 { io.ReadFull(c.conn, make([]byte, n*6)) }
		case 3: // Bell - ignore
		case 4: // ServerCutText
			skip := make([]byte, 7)
			io.ReadFull(c.conn, skip)
			l := int(binary.BigEndian.Uint32(skip[3:7]))
			if l > 0 {
				text := make([]byte, l)
				io.ReadFull(c.conn, text)
				if c.onClipboard != nil {
					c.onClipboard(string(text))
				}
			}
		default:
		}
	}
}

func (c *Client) handleFBUpdate() {
	var hdr [3]byte
	io.ReadFull(c.conn, hdr[:])
	nRects := int(binary.BigEndian.Uint16(hdr[1:3]))

	update := &FrameUpdate{}

	for i := 0; i < nRects; i++ {
		var rh [12]byte
		if _, err := io.ReadFull(c.conn, rh[:]); err != nil { return }
		r := FrameRect{
			X: binary.BigEndian.Uint16(rh[0:2]), Y: binary.BigEndian.Uint16(rh[2:4]),
			Width: binary.BigEndian.Uint16(rh[4:6]), Height: binary.BigEndian.Uint16(rh[6:8]),
			EncType: int32(binary.BigEndian.Uint32(rh[8:12])),
		}

		switch r.EncType {
		case encRaw:
			size := int(r.Width) * int(r.Height) * 4
			r.Data = make([]byte, size)
			io.ReadFull(c.conn, r.Data)
		case encCopyRect:
			var cr [4]byte
			io.ReadFull(c.conn, cr[:])
			r.Data = cr[:]
		case encHextile:
			r.Data = c.readHextile(r.Width, r.Height)
		case encTight:
			r.Data = c.readTight(r.Width, r.Height)
		case encDesktopSizePseudo:
			c.width = r.Width; c.height = r.Height
		default:
			// Skip unknown encoding
		}
		update.Rects = append(update.Rects, r)
	}

	if c.onFrame != nil { c.onFrame(update) }
	c.sendFBUpdateReq(true, 0, 0, c.width, c.height)
}

func (c *Client) readHextile(w, h uint16) []byte {
	data := make([]byte, int(w)*int(h)*4)
	bg := make([]byte, 4) // persistent background colour (initialised black)
	for y := uint16(0); y < h; y += 16 {
		for x := uint16(0); x < w; x += 16 {
			var flags [1]byte
			io.ReadFull(c.conn, flags[:])
			tw, th := minU16(16, w-x), minU16(16, h-y)

			if flags[0]&1 != 0 { // Raw — tile is raw BGRA pixels
				pixels := make([]byte, int(tw)*int(th)*4)
				io.ReadFull(c.conn, pixels)
				copyTile(data, w, x, y, tw, th, pixels)
				continue
			}

			if flags[0]&2 != 0 { // BackgroundSpecified — read new bg colour
				io.ReadFull(c.conn, bg)
			}
			fillRect(data, w, x, y, tw, th, bg)

			if flags[0]&8 == 0 { // no subrects
				continue
			}

			var nSub [1]byte
			io.ReadFull(c.conn, nSub[:])
			fg := make([]byte, 4)
			if flags[0]&16 != 0 { // SubrectsColoured
				for s := byte(0); s < nSub[0]; s++ {
					var color, posSize [4]byte
					io.ReadFull(c.conn, color[:])
					io.ReadFull(c.conn, posSize[:2])
					sx := uint16(posSize[0] >> 4)
					sy := uint16(posSize[0] & 0x0F)
					sw := uint16((posSize[1] >> 4) + 1)
					sh := uint16((posSize[1] & 0x0F) + 1)
					fillRect(data, w, x+sx, y+sy, minU16(sw, tw-sx), minU16(sh, th-sy), color[:])
				}
			} else {
				if flags[0]&4 != 0 { // ForegroundSpecified
					io.ReadFull(c.conn, fg)
				}
				for s := byte(0); s < nSub[0]; s++ {
					var posSize [2]byte
					io.ReadFull(c.conn, posSize[:])
					sx := uint16(posSize[0] >> 4)
					sy := uint16(posSize[0] & 0x0F)
					sw := uint16((posSize[1] >> 4) + 1)
					sh := uint16((posSize[1] & 0x0F) + 1)
					fillRect(data, w, x+sx, y+sy, minU16(sw, tw-sx), minU16(sh, th-sy), fg)
				}
			}
		}
	}
	return data
}

func (c *Client) readTight(w, h uint16) []byte {
	var cc [1]byte
	io.ReadFull(c.conn, cc[:])
	compType := cc[0] & 0x0F
	// resetStreams := cc[0] >> 4 — handled per-rect with fresh zlib

	switch compType {
	case 0:
		return c.readTightBasic(w, h)
	case 8:
		return c.readTightFill(w, h)
	case 9:
		return c.readTightJPEG(w, h)
	default:
		return make([]byte, int(w)*int(h)*4)
	}
}

func (c *Client) readTightFill(w, h uint16) []byte {
	var rgb [3]byte
	io.ReadFull(c.conn, rgb[:])
	data := make([]byte, int(w)*int(h)*4)
	for i := 0; i < len(data); i += 4 {
		data[i] = rgb[2]   // B
		data[i+1] = rgb[1] // G
		data[i+2] = rgb[0] // R
		data[i+3] = 255
	}
	return data
}

func (c *Client) readTightJPEG(w, h uint16) []byte {
	jpegLen := c.readCompactLen()
	jpegData := make([]byte, jpegLen)
	io.ReadFull(c.conn, jpegData)
	img, err := jpeg.Decode(bytes.NewReader(jpegData))
	if err != nil {
		return make([]byte, int(w)*int(h)*4)
	}
	bounds := img.Bounds()
	data := make([]byte, int(w)*int(h)*4)
	iw, ih := bounds.Dx(), bounds.Dy()
	for y := 0; y < ih && int(uint16(y)) < int(h); y++ {
		for x := 0; x < iw && int(uint16(x)) < int(w); x++ {
			r, g, b, a := img.At(x+bounds.Min.X, y+bounds.Min.Y).RGBA()
			off := (y*int(w) + x) * 4
			data[off] = byte(b >> 8)
			data[off+1] = byte(g >> 8)
			data[off+2] = byte(r >> 8)
			data[off+3] = byte(a >> 8)
		}
	}
	return data
}

func (c *Client) readTightBasic(w, h uint16) []byte {
	clen := c.readCompactLen()
	rowSizeRGB := int(w) * 3
	rawLen := rowSizeRGB*int(h) + int(h) // pixels (RGB) + filter bytes
	if clen == 0 {
		return make([]byte, int(w)*int(h)*4)
	}

	var buf []byte
	if clen < rawLen {
		compressed := make([]byte, clen)
		io.ReadFull(c.conn, compressed)
		r, err := zlib.NewReader(bytes.NewReader(compressed))
		if err != nil {
			return make([]byte, int(w)*int(h)*4)
		}
		defer r.Close()
		buf = make([]byte, rawLen)
		if _, err := io.ReadFull(r, buf); err != nil {
			return make([]byte, int(w)*int(h)*4)
		}
	} else {
		// data may be rawLen or could differ; clamp to what was actually sent
		buf = make([]byte, clen)
		io.ReadFull(c.conn, buf)
	}

	out := make([]byte, int(w)*int(h)*4)
	pos := 0
	prevRow := out[:int(w)*4] // pointer to first decoded BGRA row

	for y := uint16(0); y < h; y++ {
		if pos >= len(buf) {
			break
		}
		filter := buf[pos]
		pos++
		rowStart := int(y) * int(w) * 4

		switch filter {
		case 0: // Copy — raw RGB pixels, 3 bytes each
			remaining := len(buf) - pos
			needed := int(w) * 3
			if remaining < needed {
				needed = remaining
			}
			for x := 0; x < int(w) && pos+2 < len(buf); x++ {
				out[rowStart+x*4] = buf[pos+2]   // B
				out[rowStart+x*4+1] = buf[pos+1] // G
				out[rowStart+x*4+2] = buf[pos]   // R
				out[rowStart+x*4+3] = 255
				pos += 3
			}
		case 1: // Palette
			if pos >= len(buf) {
				break
			}
			nColors := int(buf[pos]) + 1
			pos++
			palette := make([][3]byte, nColors)
			for i := 0; i < nColors && pos+2 < len(buf); i++ {
				palette[i] = [3]byte{buf[pos], buf[pos+1], buf[pos+2]} // R,G,B
				pos += 3
			}
			pos = decodePaletteRow(out[rowStart:], buf, pos, palette, int(w))
		case 2: // Gradient
			pos = decodeGradientRow(out[rowStart:], buf, pos, int(w), prevRow)
		default:
			// Unknown filter — skip to row boundary (best-effort)
			pos += int(w) * 3
		}
		prevRow = out[rowStart : rowStart+int(w)*4]
	}
	return out
}

func (c *Client) readCompactLen() int {
	var b [1]byte
	io.ReadFull(c.conn, b[:])
	v := int(b[0])
	if v <= 0x7F {
		return v
	}
	if v <= 0xBF {
		var b2 [1]byte
		io.ReadFull(c.conn, b2[:])
		return ((v & 0x7F) << 8) | int(b2[0])
	}
	var b2, b3 [1]byte
	io.ReadFull(c.conn, b2[:])
	io.ReadFull(c.conn, b3[:])
	return ((v & 0x3F) << 16) | (int(b2[0]) << 8) | int(b3[0])
}

func decodeGradientRow(row []byte, src []byte, pos int, w int, prevRow []byte) int {
	for x := 0; x < w; x++ {
		if pos+2 >= len(src) {
			return pos
		}
		var predR, predG, predB int
		if x == 0 && prevRow == nil {
			row[0] = src[pos+2]   // B
			row[1] = src[pos+1]   // G
			row[2] = src[pos]     // R
			row[3] = 255
			pos += 3
			continue
		}
		above := prevRow != nil
		left := x > 0
		if left && above {
			predR = int(prevRow[(x-1)*4+2]) + int(prevRow[x*4+2]) - int(row[(x-1)*4+2])
			predG = int(prevRow[(x-1)*4+1]) + int(prevRow[x*4+1]) - int(row[(x-1)*4+1])
			predB = int(prevRow[(x-1)*4]) + int(prevRow[x*4]) - int(row[(x-1)*4])
		} else if left {
			predR = int(row[(x-1)*4+2])
			predG = int(row[(x-1)*4+1])
			predB = int(row[(x-1)*4])
		} else if above {
			predR = int(prevRow[x*4+2])
			predG = int(prevRow[x*4+1])
			predB = int(prevRow[x*4])
		}
		row[x*4] = clampByte(predB + int(decodeS8(src[pos+2])))
		row[x*4+1] = clampByte(predG + int(decodeS8(src[pos+1])))
		row[x*4+2] = clampByte(predR + int(decodeS8(src[pos])))
		row[x*4+3] = 255
		pos += 3
	}
	return pos
}

func decodePaletteRow(row []byte, src []byte, pos int, palette [][3]byte, w int) int {
	nColors := len(palette)
	needed := 0

	switch {
	case nColors == 1:
		b := palette[0][2]
		g := palette[0][1]
		r := palette[0][0]
		for x := 0; x < w; x++ {
			off := x * 4
			row[off], row[off+1], row[off+2], row[off+3] = b, g, r, 255
		}
	case nColors <= 2:
		needed = (w + 7) / 8
		for x := 0; x < w && pos+needed <= len(src); x++ {
			idx := (src[pos+x/8] >> (7 - x%8)) & 1
			p := palette[idx]
			off := x * 4
			row[off], row[off+1], row[off+2], row[off+3] = p[2], p[1], p[0], 255
		}
	case nColors <= 4:
		needed = (w*2 + 7) / 8
		for x := 0; x < w && pos+needed <= len(src); x++ {
			bitOff := uint(6 - (x*2)%8)
			idx := (src[pos+(x*2)/8] >> bitOff) & 3
			p := palette[idx]
			off := x * 4
			row[off], row[off+1], row[off+2], row[off+3] = p[2], p[1], p[0], 255
		}
	case nColors <= 16:
		needed = (w + 1) / 2
		for x := 0; x < w && pos+needed <= len(src); x++ {
			var idx byte
			if x%2 == 0 {
				idx = src[pos+x/2] >> 4
			} else {
				idx = src[pos+x/2] & 0x0F
			}
			p := palette[idx]
			off := x * 4
			row[off], row[off+1], row[off+2], row[off+3] = p[2], p[1], p[0], 255
		}
	default: // <= 256
		needed = w
		for x := 0; x < w && pos+x < len(src); x++ {
			idx := src[pos+x]
			p := palette[idx]
			off := x * 4
			row[off], row[off+1], row[off+2], row[off+3] = p[2], p[1], p[0], 255
		}
	}
	return pos + needed
}

func clampByte(v int) byte {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return byte(v)
}

func decodeS8(b byte) int8 { return int8(b) }

// copyTile writes a w×h BGRA tile into the framebuffer at (tileX, tileY)
func copyTile(fb []byte, stride uint16, tileX, tileY, tw, th uint16, tile []byte) {
	for ty := uint16(0); ty < th; ty++ {
		srcOff := int(ty) * int(tw) * 4
		dstOff := (int(tileY+ty)*int(stride) + int(tileX)) * 4
		copy(fb[dstOff:], tile[srcOff:srcOff+int(tw)*4])
	}
}

// fillRect fills a w×h rectangle in the framebuffer at (x, y) with a BGRA colour
func fillRect(fb []byte, stride uint16, x, y, w, h uint16, color []byte) {
	for ty := uint16(0); ty < h; ty++ {
		for tx := uint16(0); tx < w; tx++ {
			off := (int(y+ty)*int(stride) + int(x+tx)) * 4
			fb[off] = color[0]
			fb[off+1] = color[1]
			fb[off+2] = color[2]
			fb[off+3] = color[3]
		}
	}
}

func (c *Client) setState(s protocol.ConnState) {
	c.stateMu.Lock(); c.state = s; c.stateMu.Unlock()
	if c.onState != nil { c.onState(s) }
}
func (c *Client) setError(err error) { if c.onError != nil { c.onError(err) } }

func vncAuth(challenge []byte, password string) []byte {
	key := make([]byte, 8)
	copy(key, []byte(password))
	if len(key) < 8 {
		padded := make([]byte, 8)
		copy(padded, key)
		key = padded
	}
	for i := 0; i < 8; i++ {
		if key[i] == 0 { key[i] = 1 }
		key[i] = ((key[i] >> 1) | (key[i] << 7)) ^ 0xFF
	}
	block, _ := des.NewCipher(key)
	result := make([]byte, 16)
	block.Encrypt(result[0:8], challenge[0:8])
	block.Encrypt(result[8:16], challenge[8:16])
	return result
}

func boolByte(b bool) byte { if b { return 1 }; return 0 }
func minU16(a, b uint16) uint16 { if a < b { return a }; return b }
