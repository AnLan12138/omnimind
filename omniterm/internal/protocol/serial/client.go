package serial

import (
	"context"
	"fmt"
	"sync"
	"time"

	"omniterm/internal/protocol"

	"go.bug.st/serial"
)

type Client struct {
	cfg protocol.ConnConfig

	port   serial.Port
	cancel context.CancelFunc

	state   protocol.ConnState
	stateMu sync.RWMutex

	onData  protocol.DataCallback
	onState protocol.StateCallback
	onError protocol.ErrorCallback
}

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	mode := &serial.Mode{
		BaudRate: cfg.BaudRate,
		DataBits: cfg.DataBits,
		StopBits: serial.StopBits(cfg.StopBits),
		Parity:   parseParity(cfg.Parity),
	}
	if mode.BaudRate == 0 {
		mode.BaudRate = 115200
	}
	if mode.DataBits == 0 {
		mode.DataBits = 8
	}
	if mode.StopBits == 0 {
		mode.StopBits = serial.OneStopBit
	}

	port, err := serial.Open(cfg.Host, mode)
	if err != nil {
		c.setError(fmt.Errorf("open serial port: %w", err))
		return err
	}
	c.port = port

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	go c.readLoop(ctx)

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.port != nil {
		c.port.Close()
	}
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	if c.port == nil {
		return fmt.Errorf("not connected")
	}
	_, err := c.port.Write(data)
	return err
}

func (c *Client) Resize(rows, cols int) error {
	// Serial has no resize - no-op
	c.cfg.Rows = rows
	c.cfg.Cols = cols
	return nil
}

func (c *Client) State() protocol.ConnState {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.state
}

func (c *Client) Features() protocol.Features {
	return protocol.Features{
		SupportsSFTP:      false,
		SupportsClipboard: false,
		SupportsResize:    false,
		SupportsRecording: true,
		SupportsFilePanel: false,
		TerminalType:      "pty",
	}
}

func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

func (c *Client) readLoop(ctx context.Context) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			c.port.SetReadTimeout(100 * time.Millisecond)
			n, err := c.port.Read(buf)
			if err != nil {
				if ctx.Err() == nil {
					// Timeout is normal - just retry
					continue
				}
				return
			}
			if n > 0 && c.onData != nil {
				data := make([]byte, n)
				copy(data, buf[:n])
				c.onData(data)
			}
		}
	}
}

func (c *Client) setState(s protocol.ConnState) {
	c.stateMu.Lock()
	c.state = s
	c.stateMu.Unlock()
	if c.onState != nil {
		c.onState(s)
	}
}

func (c *Client) setError(err error) {
	if c.onError != nil {
		c.onError(err)
	}
}

func parseParity(p string) serial.Parity {
	switch p {
	case "even", "E":
		return serial.EvenParity
	case "odd", "O":
		return serial.OddParity
	case "mark", "M":
		return serial.MarkParity
	case "space", "S":
		return serial.SpaceParity
	default:
		return serial.NoParity
	}
}

// ListPorts returns available serial ports.
func ListPorts() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, err
	}
	return ports, nil
}
