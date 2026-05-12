package vnc

import (
	"context"
	"crypto/des"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"omniterm/internal/protocol"
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

	onData  protocol.DataCallback
	onState protocol.StateCallback
	onError protocol.ErrorCallback
	onFrame func(*FrameUpdate)

	cancel context.CancelFunc
}

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
	return protocol.Features{TerminalType: "canvas", SupportsSFTP: false, SupportsClipboard: false, SupportsResize: false, SupportsRecording: false, SupportsFilePanel: false}
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
			if l > 0 { io.ReadFull(c.conn, make([]byte, l)) }
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
			r.Data = c.readHextileSimple(r.Width, r.Height)
		case encTight:
			r.Data = c.readTightSimple(r.Width, r.Height)
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

func (c *Client) readHextileSimple(w, h uint16) []byte {
	// Simplified: read tiles as raw blocks
	data := make([]byte, int(w)*int(h)*4)
	for y := uint16(0); y < h; y += 16 {
		for x := uint16(0); x < w; x += 16 {
			var flags [1]byte
			io.ReadFull(c.conn, flags[:])
			tw, th := minU16(16, w-x), minU16(16, h-y)
			tileSize := int(tw) * int(th) * 4

			if flags[0]&1 != 0 { // Raw tile
				io.ReadFull(c.conn, make([]byte, tileSize))
			} else if flags[0]&2 != 0 { // Solid color
				io.ReadFull(c.conn, make([]byte, 4))
			} else if flags[0]&4 != 0 { // Packed palette
				nColors := make([]byte, 1)
				io.ReadFull(c.conn, nColors)
				colors := int(nColors[0]) + 1
				io.ReadFull(c.conn, make([]byte, colors*4))
				bpp := 1; if colors > 2 { bpp = 2 }; if colors > 4 { bpp = 4 }; if colors > 16 { bpp = 8 }
				rowBytes := (int(tw)*bpp + 7) / 8
				io.ReadFull(c.conn, make([]byte, rowBytes*int(th)))
			} else if flags[0]&8 != 0 { // Plain RLE
				io.ReadFull(c.conn, make([]byte, tileSize+int(th)))
			} else if flags[0]&16 != 0 { // Palette RLE
				nColors := make([]byte, 1)
				io.ReadFull(c.conn, nColors)
				io.ReadFull(c.conn, make([]byte, (int(nColors[0])+1)*4+tileSize))
			} else {
				io.ReadFull(c.conn, make([]byte, tileSize))
			}
		}
	}
	return data
}

func (c *Client) readTightSimple(w, h uint16) []byte {
	return make([]byte, int(w)*int(h)*4)
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
