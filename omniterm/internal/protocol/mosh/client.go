package mosh

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"omnimind/internal/protocol"
)

// MOSH client - implements the Mobile Shell protocol for high-latency connections.
// Uses AES-128 OCB for encryption and SSP for state synchronization.

type Client struct {
	cfg protocol.ConnConfig

	conn   net.Conn
	sshCli *ssh.Client
	key    []byte

	state   protocol.ConnState
	stateMu sync.RWMutex

	onData  protocol.DataCallback
	onState protocol.StateCallback
	onError protocol.ErrorCallback

	cancel context.CancelFunc
}

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 0 {
		cfg.Port = 22 // MOSH uses SSH for initial handshake
		addr = fmt.Sprintf("%s:%d", cfg.Host, 22)
	}

	// Step 1: SSH connection for session setup
	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}
	if cfg.Password != "" {
		sshCfg.Auth = append(sshCfg.Auth, ssh.Password(cfg.Password))
	}

	sshConn, err := ssh.Dial("tcp", addr, sshCfg)
	if err != nil {
		c.setError(fmt.Errorf("mosh ssh: %w", err))
		return err
	}
	c.sshCli = sshConn

	// Step 2: Run mosh-server on remote and get UDP port + key
	session, err := sshConn.NewSession()
	if err != nil {
		c.setError(fmt.Errorf("mosh session: %w", err))
		return err
	}

	output, err := session.CombinedOutput("mosh-server new -s -l LANG=en_US.UTF-8")
	if err != nil {
		session.Close()
		c.setError(fmt.Errorf("mosh-server: %w (is mosh installed on remote?)", err))
		return err
	}
	session.Close()

	// Parse MOSH_KEY and MOSH_PORT from output
	// Format: "MOSH CONNECT 60001 <key>"
	outputStr := string(output)
	var moshPort int
	var moshKey string
	fmt.Sscanf(outputStr, "MOSH CONNECT %d %s", &moshPort, &moshKey)

	if moshPort == 0 || moshKey == "" {
		c.setError(fmt.Errorf("mosh: failed to parse server output: %s", outputStr))
		return err
	}

	// Step 3: Decode the base64-encoded 16-byte key from mosh-server
	keyBytes, err := base64.StdEncoding.DecodeString(moshKey)
	if err != nil || len(keyBytes) != 16 {
		c.setError(fmt.Errorf("mosh: invalid key from server: %s", moshKey))
		return fmt.Errorf("mosh: invalid key length %d", len(keyBytes))
	}
	c.key = keyBytes

	// Step 4: Establish UDP connection
	udpAddr := fmt.Sprintf("%s:%d", cfg.Host, moshPort)
	udpConn, err := net.DialTimeout("udp", udpAddr, 5*time.Second)
	if err != nil {
		c.setError(fmt.Errorf("mosh udp: %w", err))
		return err
	}
	c.conn = udpConn

	// Send initial datagram with sequence number
	initPkt := make([]byte, 12)
	binary.BigEndian.PutUint64(initPkt[0:8], 0)  // seq
	binary.BigEndian.PutUint32(initPkt[8:12], 0)  // ack
	c.sendEncrypted(initPkt)

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	go c.readLoop(ctx)

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil { c.cancel() }
	if c.conn != nil { c.conn.Close() }
	if c.sshCli != nil { c.sshCli.Close() }
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	if c.conn == nil { return fmt.Errorf("not connected") }
	// Wrap user input in a MOSH packet
	pkt := make([]byte, 13+len(data))
	binary.BigEndian.PutUint64(pkt[0:8], uint64(time.Now().UnixNano()))
	pkt[12] = 0x01 // input type
	copy(pkt[13:], data)
	return c.sendEncrypted(pkt)
}

func (c *Client) Resize(rows, cols int) error {
	if c.conn == nil { return fmt.Errorf("not connected") }
	c.cfg.Rows = rows; c.cfg.Cols = cols
	// Send resize notification
	pkt := make([]byte, 16)
	binary.BigEndian.PutUint64(pkt[0:8], uint64(time.Now().UnixNano()))
	pkt[12] = 0x02 // resize type
	binary.BigEndian.PutUint16(pkt[13:15], uint16(cols))
	binary.BigEndian.PutUint16(pkt[15:17], uint16(rows))
	return c.sendEncrypted(pkt)
}

func (c *Client) State() protocol.ConnState {
	c.stateMu.RLock(); defer c.stateMu.RUnlock(); return c.state
}
func (c *Client) Features() protocol.Features {
	return protocol.Features{TerminalType: "pty", SupportsSFTP: false, SupportsClipboard: false, SupportsResize: true, SupportsRecording: true, SupportsFilePanel: false}
}
func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

func (c *Client) readLoop(ctx context.Context) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done(): return
		default:
			n, err := c.conn.Read(buf)
			if err != nil {
				if ctx.Err() == nil { c.setError(err); c.setState(protocol.StateDisconnected) }
				return
			}
			// Decrypt and extract terminal output
			plain := c.decryptPacket(buf[:n])
			if plain != nil && len(plain) > 13 && c.onData != nil {
				// Skip MOSH header (12 bytes seq + 1 byte type)
				c.onData(plain[13:])
			}
		}
	}
}

func (c *Client) sendEncrypted(data []byte) error {
	encrypted, err := c.ocbEncryptPacket(data)
	if err != nil {
		return err
	}
	_, err = c.conn.Write(encrypted)
	return err
}

func (c *Client) decryptPacket(data []byte) []byte {
	plain, err := c.ocbDecryptPacket(data)
	if err != nil {
		c.setError(fmt.Errorf("mosh decrypt: %w", err))
		return nil
	}
	return plain
}

func (c *Client) setState(s protocol.ConnState) {
	c.stateMu.Lock(); c.state = s; c.stateMu.Unlock()
	if c.onState != nil { c.onState(s) }
}
func (c *Client) setError(err error) { if c.onError != nil { c.onError(err) } }
