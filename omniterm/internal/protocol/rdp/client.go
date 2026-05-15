package rdp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/tomatome/grdp/core"
	"github.com/tomatome/grdp/protocol/nla"
	"github.com/tomatome/grdp/protocol/pdu"
	"github.com/tomatome/grdp/protocol/sec"
	"github.com/tomatome/grdp/protocol/t125"
	"github.com/tomatome/grdp/protocol/tpkt"
	"github.com/tomatome/grdp/protocol/x224"

	"omnimind/internal/protocol"
)

type FrameChunk struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"w"`
	Height int    `json:"h"`
	Data   string `json:"data"` // base64 PNG
}

type FrameUpdate struct {
	Chunks []FrameChunk `json:"chunks"`
}

type Client struct {
	cfg protocol.ConnConfig

	tpkt *tpkt.TPKT
	x224 *x224.X224
	mcs  *t125.MCSClient
	sec  *sec.Client
	pdu  *pdu.Client

	width  int
	height int

	state   protocol.ConnState
	stateMu sync.RWMutex

	onData  protocol.DataCallback
	onState protocol.StateCallback
	onError protocol.ErrorCallback
	onFrame func(*FrameUpdate)
}

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 0 {
		cfg.Port = 3389
		addr = fmt.Sprintf("%s:%d", cfg.Host, 3389)
	}

	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		c.setError(fmt.Errorf("rdp dial: %w", err))
		return err
	}

	domain, user := splitDomainUser(cfg.Username)

	c.tpkt = tpkt.New(core.NewSocketLayer(conn), nla.NewNTLMv2(domain, user, cfg.Password))
	c.x224 = x224.New(c.tpkt)
	c.mcs = t125.NewMCSClient(c.x224)
	c.sec = sec.NewClient(c.mcs)
	c.pdu = pdu.NewClient(c.sec)

	c.width = 1280
	c.height = 800
	c.mcs.SetClientCoreData(uint16(c.width), uint16(c.height))

	c.sec.SetUser(user)
	c.sec.SetPwd(cfg.Password)
	c.sec.SetDomain(domain)

	c.tpkt.SetFastPathListener(c.sec)
	c.sec.SetFastPathListener(c.pdu)
	c.sec.SetChannelSender(c.mcs)

	if err := c.x224.Connect(); err != nil {
		conn.Close()
		c.setError(fmt.Errorf("x224 connect: %w", err))
		return err
	}

	// Receive bitmap updates
	c.pdu.On("update", func(data []pdu.BitmapData) {
		if c.onFrame == nil { return }
		var chunks []FrameChunk
		for _, bmp := range data {
			chunk := convertPDUBitmap(&bmp)
			if chunk != nil {
				chunks = append(chunks, *chunk)
			}
		}
		if len(chunks) > 0 {
			c.onFrame(&FrameUpdate{Chunks: chunks})
		}
	})

	// Handle close
	c.pdu.On("close", func(_ interface{}) {
		c.setState(protocol.StateDisconnected)
	})

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.tpkt != nil { c.tpkt.Close() }
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error { return nil }
func (c *Client) Resize(rows, cols int) error { return nil }
func (c *Client) State() protocol.ConnState {
	c.stateMu.RLock(); defer c.stateMu.RUnlock(); return c.state
}
func (c *Client) Features() protocol.Features {
	return protocol.Features{
		TerminalType: "canvas", SupportsSFTP: false, SupportsClipboard: false,
		SupportsResize: false, SupportsRecording: false, SupportsFilePanel: false,
	}
}
func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }
func (c *Client) OnFrame(cb func(*FrameUpdate))     { c.onFrame = cb }

func (c *Client) FrameSize() (int, int) { return c.width, c.height }

func (c *Client) SendKeyDown(sc int, name string) {
	if c.pdu != nil {
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_SCANCODE, []pdu.InputEventsInterface{
			&pdu.ScancodeKeyEvent{KeyCode: uint16(sc)},
		})
	}
}
func (c *Client) SendKeyUp(sc int, name string) {
	if c.pdu != nil {
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_SCANCODE, []pdu.InputEventsInterface{
			&pdu.ScancodeKeyEvent{KeyCode: uint16(sc), KeyboardFlags: pdu.KBDFLAGS_RELEASE},
		})
	}
}
func (c *Client) SendMouseDown(button, x, y int) {
	if c.pdu != nil {
		var flags uint16 = pdu.PTRFLAGS_DOWN
		switch button { case 0: flags |= pdu.PTRFLAGS_BUTTON1; case 2: flags |= pdu.PTRFLAGS_BUTTON2; case 1: flags |= pdu.PTRFLAGS_BUTTON3 }
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_MOUSE, []pdu.InputEventsInterface{
			&pdu.PointerEvent{PointerFlags: flags, XPos: uint16(x), YPos: uint16(y)},
		})
	}
}
func (c *Client) SendMouseUp(button, x, y int) {
	if c.pdu != nil {
		var flags uint16
		switch button { case 0: flags = pdu.PTRFLAGS_BUTTON1; case 2: flags = pdu.PTRFLAGS_BUTTON2; case 1: flags = pdu.PTRFLAGS_BUTTON3; default: flags = pdu.PTRFLAGS_MOVE }
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_MOUSE, []pdu.InputEventsInterface{
			&pdu.PointerEvent{PointerFlags: flags, XPos: uint16(x), YPos: uint16(y)},
		})
	}
}
func (c *Client) SendMouseMove(x, y int) {
	if c.pdu != nil {
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_MOUSE, []pdu.InputEventsInterface{
			&pdu.PointerEvent{PointerFlags: pdu.PTRFLAGS_MOVE, XPos: uint16(x), YPos: uint16(y)},
		})
	}
}
func (c *Client) SendMouseWheel(scroll, x, y int) {
	if c.pdu != nil {
		c.pdu.SendInputEvents(pdu.INPUT_EVENT_SCANCODE, []pdu.InputEventsInterface{
			&pdu.PointerEvent{PointerFlags: pdu.PTRFLAGS_WHEEL, XPos: uint16(x), YPos: uint16(y)},
		})
	}
}

func (c *Client) setState(s protocol.ConnState) {
	c.stateMu.Lock(); c.state = s; c.stateMu.Unlock()
	if c.onState != nil { c.onState(s) }
}
func (c *Client) setError(err error) {
	if c.onError != nil { c.onError(err) }
}

func FrameUpdateToJSON(update *FrameUpdate) string {
	b, _ := json.Marshal(update)
	return string(b)
}

func splitDomainUser(user string) (domain, uname string) {
	if idx := strings.Index(user, "\\"); idx != -1 {
		return user[:idx], user[idx+1:]
	}
	if idx := strings.Index(user, "/"); idx != -1 {
		return user[:idx], user[idx+1:]
	}
	return "", user
}

func bitmapBPP(bp uint16) int {
	switch bp { case 15: return 1; case 16: return 2; case 24: return 3; case 32: return 4; default: return 3 }
}

func convertPDUBitmap(bmp *pdu.BitmapData) *FrameChunk {
	if bmp == nil { return nil }

	var rawData []byte
	if bmp.IsCompress() {
		bpp := bitmapBPP(bmp.BitsPerPixel)
		rawData = core.Decompress(bmp.BitmapDataStream, int(bmp.Width), int(bmp.Height), bpp)
	} else {
		rawData = bmp.BitmapDataStream
	}

	if len(rawData) == 0 { return nil }

	w := int(bmp.DestRight - bmp.DestLeft + 1)
	h := int(bmp.DestBottom - bmp.DestTop + 1)
	if w <= 0 || h <= 0 { return nil }

	img := image.NewRGBA(image.Rect(0, 0, w, h))

	switch bmp.BitsPerPixel {
	case 32:
		for i := 0; i < len(rawData) && i/4 < w*h; i += 4 {
			idx := i / 4
			img.Set(idx%w, idx/w, color.RGBA{rawData[i+2], rawData[i+1], rawData[i], rawData[i+3]})
		}
	case 24:
		for i := 0; i < len(rawData) && i/3 < w*h; i += 3 {
			idx := i / 3
			img.Set(idx%w, idx/w, color.RGBA{rawData[i+2], rawData[i+1], rawData[i], 255})
		}
	case 16:
		for i := 0; i < len(rawData) && i/2 < w*h; i += 2 {
			idx := i / 2
			pixel := uint16(rawData[i]) | uint16(rawData[i+1])<<8
			r := uint8((pixel>>11)&0x1F) << 3
			g := uint8((pixel>>5)&0x3F) << 2
			b := uint8(pixel&0x1F) << 3
			img.Set(idx%w, idx/w, color.RGBA{r, g, b, 255})
		}
	case 15:
		for i := 0; i < len(rawData) && i/2 < w*h; i += 2 {
			idx := i / 2
			pixel := uint16(rawData[i]) | uint16(rawData[i+1])<<8
			r := uint8((pixel>>10)&0x1F) << 3
			g := uint8((pixel>>5)&0x1F) << 3
			b := uint8(pixel&0x1F) << 3
			img.Set(idx%w, idx/w, color.RGBA{r, g, b, 255})
		}
	default:
		for i := 0; i < len(rawData) && i < w*h; i++ {
			v := rawData[i]
			img.Set(i%w, i/w, color.RGBA{v, v, v, 255})
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil { return nil }

	return &FrameChunk{
		X: int(bmp.DestLeft), Y: int(bmp.DestTop),
		Width: w, Height: h,
		Data: "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	}
}
