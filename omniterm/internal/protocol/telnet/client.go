package telnet

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"sync"
	"time"

	"omnimind/internal/protocol"
)

// Telnet protocol constants
const (
	// Negotiation commands
	IAC  = 255
	DONT = 254
	DO   = 253
	WONT = 252
	WILL = 251
	SB   = 250
	SE   = 240

	// Options
	OPT_ECHO           = 1
	OPT_SUPPRESS_GO_AHEAD = 3
	OPT_TERMINAL_TYPE  = 24
	OPT_NAWS           = 31 // Negotiate About Window Size
	OPT_NEW_ENVIRON    = 39
)

type Client struct {
	cfg protocol.ConnConfig

	conn     net.Conn
	cancel   context.CancelFunc

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

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		c.setError(fmt.Errorf("dial: %w", err))
		return err
	}

	if cfg.UseTLS {
		tlsCfg := &tls.Config{
			ServerName:         cfg.Host,
			InsecureSkipVerify: cfg.TLSSkipVerify,
		}
		tlsConn := tls.Client(conn, tlsCfg)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			conn.Close()
			c.setError(fmt.Errorf("tls handshake: %w", err))
			return err
		}
		c.conn = tlsConn
	} else {
		c.conn = conn
	}

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	// Start reading FIRST, so we're ready to receive server negotiation
	go c.readLoop(ctx)

	// Passive negotiation: don't initiate, just respond to server requests
	// This avoids sending bytes that non-compliant servers (e.g. Huawei) interpret as commands

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		c.conn.Close()
	}
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	_, err := c.conn.Write(data)
	return err
}

func (c *Client) Resize(rows, cols int) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	// Send NAWS (Negotiate About Window Size)
	c.cfg.Rows = rows
	c.cfg.Cols = cols

	b := []byte{IAC, SB, OPT_NAWS,
		byte(cols >> 8), byte(cols & 0xff),
		byte(rows >> 8), byte(rows & 0xff),
		IAC, SE}
	_, err := c.conn.Write(b)
	return err
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
		SupportsResize:    true,
		SupportsRecording: true,
		SupportsFilePanel: false,
		TerminalType:      "pty",
	}
}

func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

// --- private ---

func (c *Client) negotiate(ctx context.Context) {
	// Minimal initial negotiation - just announce we support terminal type and NAWS
	c.conn.Write([]byte{
		IAC, WILL, OPT_TERMINAL_TYPE,
		IAC, WILL, OPT_NAWS,
		IAC, DO, OPT_SUPPRESS_GO_AHEAD,
	})
}

func (c *Client) readLoop(ctx context.Context) {
	buf := make([]byte, 32*1024)
	var dataBuf []byte

	// leftover holds bytes from previous read that may be part of an incomplete IAC sequence
	var leftover []byte

	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := c.conn.Read(buf)
			if err != nil {
				if ctx.Err() == nil {
					c.setError(fmt.Errorf("read: %w", err))
					c.setState(protocol.StateDisconnected)
				}
				return
			}

			// Combine leftover from previous read with new data
			raw := append(leftover, buf[:n]...)
			leftover = leftover[:0]
			dataBuf = dataBuf[:0]

			i := 0
			for i < len(raw) {
				b := raw[i]

				if b == IAC {
					// Need at least one more byte after IAC
					if i+1 >= len(raw) {
						// Save IAC as leftover for next read
						leftover = append(leftover, raw[i:]...)
						break
					}

					next := raw[i+1]

					switch {
					case next == IAC:
						// Escaped IAC: 0xFF 0xFF → actual data byte 0xFF
						dataBuf = append(dataBuf, IAC)
						i += 2

					case next == DO || next == DONT || next == WILL || next == WONT:
						// Three-byte negotiation: IAC <cmd> <opt>
						if i+2 >= len(raw) {
							leftover = append(leftover, raw[i:]...)
							break
						}
						c.handleNegotiation(next, raw[i+2])
						i += 3

					case next == SB:
						// Subnegotiation: IAC SB <opt> <data> IAC SE
						if i+2 < len(raw) {
							subOpt := raw[i+2]
							if subOpt == OPT_TERMINAL_TYPE && i+3 < len(raw) && raw[i+3] == 1 {
								// Server sent: IAC SB TERMINAL-TYPE SEND IAC SE
								// Reply: IAC SB TERMINAL-TYPE IS <term> IAC SE
								foundSE := false
								for j := i + 4; j < len(raw)-1; j++ {
									if raw[j] == IAC && raw[j+1] == SE {
										i = j + 2
										foundSE = true
										break
									}
								}
								if !foundSE { leftover = append(leftover, raw[i:]...); i = len(raw); break }
								termType := c.cfg.TermType
								if termType == "" { termType = "xterm-256color" }
								reply := append([]byte{IAC, SB, OPT_TERMINAL_TYPE, 0}, termType...)
								reply = append(reply, IAC, SE)
								if c.conn != nil { c.conn.Write(reply) }
							} else {
								// Skip other subnegotiations
								found := false
								for j := i + 2; j < len(raw)-1; j++ {
									if raw[j] == IAC && raw[j+1] == SE {
										i = j + 2; found = true; break
									}
								}
								if !found { leftover = append(leftover, raw[i:]...); i = len(raw) }
							}
						}

					default:
						// Other IAC commands like IAC NOP (0xF1), IAC AYT (0xF6), etc.
						// These are two-byte sequences: IAC <command>
						i += 2
					}
				} else {
					dataBuf = append(dataBuf, b)
					i++
				}
			}

			if len(dataBuf) > 0 && c.onData != nil {
				out := make([]byte, len(dataBuf))
				copy(out, dataBuf)
				c.onData(out)
			}
		}
	}
}

func (c *Client) handleNegotiation(cmd, opt byte) {
	// Only handle terminal type negotiation — critical for color output on network gear.
	// Ignore everything else to avoid issues with broken Telnet implementations.
	if opt == OPT_TERMINAL_TYPE {
		if cmd == DO {
			c.writeCmd(WILL, OPT_TERMINAL_TYPE)
		} else if cmd == SB {
			// Server wants us to send our terminal type
			termType := c.cfg.TermType
			if termType == "" { termType = "xterm-256color" }
			// IAC SB TERMINAL-TYPE IS <type> IAC SE
			if c.conn != nil {
				c.conn.Write([]byte{IAC, SB, OPT_TERMINAL_TYPE, 0}) // 0 = IS
				c.conn.Write([]byte(termType))
				c.conn.Write([]byte{IAC, SE})
			}
		}
	}
}

func (c *Client) writeCmd(cmd, opt byte) {
	if c.conn != nil {
		c.conn.Write([]byte{IAC, cmd, opt})
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
