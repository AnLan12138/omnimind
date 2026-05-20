package telnet

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"omnimind/internal/protocol"
)

var dbgLog *log.Logger

func init() {
	f, err := os.Create(os.TempDir() + "/omnimind_telnet.log")
	if err == nil {
		dbgLog = log.New(f, "", log.Ltime|log.Lmicroseconds)
	}
}

func dbg(format string, args ...interface{}) {
	if dbgLog != nil {
		dbgLog.Printf(format, args...)
	}
}

// Telnet protocol constants
const (
	IAC  = 255
	DONT = 254
	DO   = 253
	WONT = 252
	WILL = 251
	SB   = 250
	SE   = 240
	NOP  = 241

	OPT_ECHO              = 1
	OPT_SUPPRESS_GO_AHEAD = 3
	OPT_STATUS            = 5
	OPT_TERMINAL_TYPE     = 24
	OPT_NAWS              = 31
	OPT_WINDOW_SIZE       = 31
	OPT_TERMINAL_SPEED    = 32
	OPT_NEW_ENVIRON       = 39
)

type Client struct {
	cfg protocol.ConnConfig

	conn   net.Conn
	cancel context.CancelFunc

	state   protocol.ConnState
	stateMu sync.RWMutex

	onData  protocol.DataCallback
	onState protocol.StateCallback
	onError protocol.ErrorCallback

	echoLocal bool // true if we're doing local echo
}

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dbg("DIAL %s", addr)
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		dbg("DIAL FAILED: %v", err)
		c.setError(fmt.Errorf("dial: %w", err))
		return err
	}

	if cfg.UseTLS {
		tlsCfg := &tls.Config{ServerName: cfg.Host, InsecureSkipVerify: cfg.TLSSkipVerify}
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

	// Initiate negotiation: we do local echo, ask to suppress go-ahead
	c.negotiate()
	// Start reading
	go c.readLoop(ctx)

	dbg("CONNECTED to %s:%d", cfg.Host, cfg.Port)
	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	dbg("DISCONNECT (conn=%p)", c.conn)
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		dbg("CLOSING TCP CONN")
		c.conn.Close()
	}
	c.setState(protocol.StateDisconnected)
		return nil
}

func (c *Client) Send(data []byte) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	dbg("SEND %d bytes: %q", len(data), string(data))
	_, err := c.conn.Write(data)
	return err
}

func (c *Client) Resize(rows, cols int) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	c.cfg.Rows = rows
	c.cfg.Cols = cols
	// IAC SB NAWS <cols-hi> <cols-lo> <rows-hi> <rows-lo> IAC SE
	c.conn.Write([]byte{IAC, SB, OPT_NAWS,
		byte(cols >> 8), byte(cols & 0xff),
		byte(rows >> 8), byte(rows & 0xff),
		IAC, SE})
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
		SupportsResize:    true,
		SupportsRecording: true,
		SupportsFilePanel: false,
		TerminalType:      "pty",
	}
}

func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

// ── Negotiation ──

func (c *Client) negotiate() {
	// Announce capabilities — DON'T touch ECHO, let server default handle it
	c.writeBytes([]byte{
		IAC, WILL, OPT_SUPPRESS_GO_AHEAD,
		IAC, WILL, OPT_TERMINAL_TYPE,
		IAC, WILL, OPT_NAWS,
	})
}

func (c *Client) handleNegotiation(cmd, opt byte) {
	switch opt {
	case OPT_SUPPRESS_GO_AHEAD:
		switch cmd {
		case DO:
			c.writeCmd(WILL, OPT_SUPPRESS_GO_AHEAD)
		case WILL:
			c.writeCmd(DO, OPT_SUPPRESS_GO_AHEAD)
		}

	case OPT_TERMINAL_TYPE:
		if cmd == DO {
			c.writeCmd(WILL, OPT_TERMINAL_TYPE)
		}

	case OPT_NAWS:
		if cmd == DO {
			c.writeCmd(WILL, OPT_NAWS)
		}

	default:
		// Reject unknown options gracefully
		switch cmd {
		case DO:
			c.writeCmd(WONT, opt)
		case WILL:
			c.writeCmd(DONT, opt)
		}
	}
}

func (c *Client) handleSubNegotiation(opt byte, data []byte) {
	switch opt {
	case OPT_TERMINAL_TYPE:
		if len(data) > 0 && data[0] == 1 { // SEND
			termType := c.cfg.TermType
			if termType == "" {
				termType = "xterm-256color"
			}
			reply := []byte{IAC, SB, OPT_TERMINAL_TYPE, 0} // 0 = IS
			reply = append(reply, []byte(termType)...)
			reply = append(reply, IAC, SE)
			c.writeBytes(reply)
		}
	}
}

func (c *Client) writeCmd(cmd, opt byte) {
	if c.conn != nil {
		c.conn.Write([]byte{IAC, cmd, opt})
	}
}

func (c *Client) writeBytes(b []byte) {
	if c.conn != nil {
		c.conn.Write(b)
	}
}

// ── Read loop ──

func (c *Client) readLoop(ctx context.Context) {
	buf := make([]byte, 32*1024)
	var dataBuf []byte
	var leftover []byte

	for {
		select {
		case <-ctx.Done():
			dbg("READ LOOP EXIT (ctx cancelled)")
			return
		default:
		}

		n, err := c.conn.Read(buf)
		if err != nil {
			if ctx.Err() == nil {
				c.setError(fmt.Errorf("read: %w", err))
				c.setState(protocol.StateDisconnected)
			}
			return
		}

		raw := append(leftover, buf[:n]...)
		leftover = leftover[:0]
		dataBuf = dataBuf[:0]

		i := 0
		for i < len(raw) {
			b := raw[i]

			if b != IAC {
				dataBuf = append(dataBuf, b)
				i++
				continue
			}

			// IAC found — need at least one more byte
			if i+1 >= len(raw) {
				leftover = append(leftover, raw[i:]...)
				break
			}
			next := raw[i+1]

			switch {
			case next == IAC:
				// Escaped IAC: 0xFF 0xFF → literal 0xFF
				dataBuf = append(dataBuf, IAC)
				i += 2

			case next == DO || next == DONT || next == WILL || next == WONT:
				// Three-byte: IAC <cmd> <opt>
				if i+2 >= len(raw) {
					leftover = append(leftover, raw[i:]...)
					i = len(raw)
					break
				}
				c.handleNegotiation(next, raw[i+2])
				i += 3

			case next == SB:
				// Subnegotiation: IAC SB <opt> <data> IAC SE
				if i+2 >= len(raw) {
					leftover = append(leftover, raw[i:]...)
					i = len(raw)
					break
				}
				subOpt := raw[i+2]
				// Find IAC SE
				seIdx := -1
				for j := i + 3; j < len(raw)-1; j++ {
					if raw[j] == IAC && raw[j+1] == SE {
						seIdx = j
						break
					}
				}
				if seIdx < 0 {
					leftover = append(leftover, raw[i:]...)
					i = len(raw)
					break
				}
				c.handleSubNegotiation(subOpt, raw[i+3:seIdx])
				i = seIdx + 2

			case next == NOP:
				i += 2

			default:
				// Other two-byte IAC commands
				i += 2
			}
		}

		if len(dataBuf) > 0 && c.onData != nil {
			dbg("RECV %d bytes raw", len(dataBuf))
			// Normalize CR/LF: many telnet devices send bare CR or CR+NUL
			normalized := make([]byte, 0, len(dataBuf)+16)
			for j := 0; j < len(dataBuf); j++ {
				b := dataBuf[j]
				if b == '\r' {
					normalized = append(normalized, '\r', '\n')
					// Skip next byte if it's NUL or LF (CR+NUL or CR+LF → single CRLF)
					if j+1 < len(dataBuf) && (dataBuf[j+1] == 0 || dataBuf[j+1] == '\n') {
						j++
					}
				} else if b == '\n' {
					normalized = append(normalized, '\r', '\n')
				} else {
					normalized = append(normalized, b)
				}
			}
			c.onData(normalized)
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
