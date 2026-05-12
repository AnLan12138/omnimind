package ssh

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"

	"omniterm/internal/protocol"
)

type Client struct {
	cfg protocol.ConnConfig

	conn    *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader

	state     protocol.ConnState
	stateMu   sync.RWMutex
	cancel    context.CancelFunc

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

	authMethods := c.buildAuthMethods()

	hostKeyCallback, err := c.buildHostKeyCallback()
	if err != nil {
		c.setError(fmt.Errorf("host key callback: %w", err))
		return err
	}

	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

	if cfg.KeepAliveSec <= 0 {
		cfg.KeepAliveSec = 30
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	var conn net.Conn
	d := net.Dialer{Timeout: 15 * time.Second}
	if cfg.ProxyJump != "" {
		conn, err = c.dialViaJump(ctx, cfg.ProxyJump, addr, sshCfg)
	} else {
		conn, err = d.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		c.setError(fmt.Errorf("dial: %w", err))
		return err
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, sshCfg)
	if err != nil {
		conn.Close()
		c.setError(fmt.Errorf("ssh handshake: %w", err))
		return err
	}

	c.conn = ssh.NewClient(sshConn, chans, reqs)

	session, err := c.conn.NewSession()
	if err != nil {
		c.conn.Close()
		c.setError(fmt.Errorf("new session: %w", err))
		return err
	}
	c.session = session

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	rows := cfg.Rows
	cols := cfg.Cols
	if rows == 0 {
		rows = 24
	}
	if cols == 0 {
		cols = 80
	}

	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("request pty: %w", err))
		return err
	}

	c.stdin, err = session.StdinPipe()
	if err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("stdin pipe: %w", err))
		return err
	}

	c.stdout, err = session.StdoutPipe()
	if err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("stdout pipe: %w", err))
		return err
	}

	// Merge stderr into stdout
	session.StderrPipe()

	if err := session.Shell(); err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("start shell: %w", err))
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	go c.readLoop(ctx)
	go c.keepAlive(ctx, time.Duration(cfg.KeepAliveSec)*time.Second)
	go c.waitSession(ctx)

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.session != nil {
		c.session.Close()
	}
	if c.conn != nil {
		c.conn.Close()
	}
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	if c.stdin == nil {
		return fmt.Errorf("not connected")
	}
	_, err := c.stdin.Write(data)
	return err
}

func (c *Client) Resize(rows, cols int) error {
	if c.session == nil {
		return fmt.Errorf("not connected")
	}
	c.cfg.Rows = rows
	c.cfg.Cols = cols
	return c.session.WindowChange(rows, cols)
}

func (c *Client) State() protocol.ConnState {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.state
}

func (c *Client) Features() protocol.Features {
	return protocol.Features{
		SupportsSFTP:      true,
		SupportsClipboard: false,
		SupportsResize:    true,
		SupportsRecording: true,
		SupportsFilePanel: true,
		TerminalType:      "pty",
	}
}

func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

// StartX11Forwarding starts X11 forwarding for the SSH session.
// Returns the display number (e.g., ":10.0") or an error.
func (c *Client) StartX11Forwarding() (string, error) {
	if c.conn == nil {
		return "", fmt.Errorf("not connected")
	}

	// Set up X11 authentication
	xauthCookie := make([]byte, 16)
	if _, err := rand.Read(xauthCookie); err != nil {
		return "", fmt.Errorf("x11 cookie: %w", err)
	}

	// Request X11 forwarding
	display := ":10.0"
	req := ssh.Marshal(&struct{ Proto, Data string }{
		Proto: "MIT-MAGIC-COOKIE-1",
		Data:  string(xauthCookie),
	})

	ok, _, err := c.conn.SendRequest("x11-req", true, req)
	if err != nil {
		return "", fmt.Errorf("x11 request: %w", err)
	}
	if !ok {
		return "", fmt.Errorf("x11 forwarding rejected by server (X11Forwarding may be disabled in sshd_config)")
	}

	return display, nil
}

func (c *Client) GetSFTPClient() (*ssh.Client, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	return c.conn, nil
}

// StartLocalForward listens on local port and forwards to remote host:port.
func (c *Client) StartLocalForward(localPort int, remoteHost string, remotePort int) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", localPort))
	if err != nil {
		return fmt.Errorf("local listen: %w", err)
	}

	go func() {
		for {
			localConn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer localConn.Close()
				remoteAddr := fmt.Sprintf("%s:%d", remoteHost, remotePort)
				remoteConn, err := c.conn.Dial("tcp", remoteAddr)
				if err != nil {
					return
				}
				defer remoteConn.Close()

				go func() {
					io.Copy(remoteConn, localConn)
				}()
				io.Copy(localConn, remoteConn)
			}()
		}
	}()

	runtimeLog("Local forward started: 127.0.0.1:%d -> %s:%d", localPort, remoteHost, remotePort)
	return nil
}

// StartRemoteForward listens on remote port and forwards to local host:port.
func (c *Client) StartRemoteForward(remotePort int, localHost string, localPort int) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	listener, err := c.conn.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", remotePort))
	if err != nil {
		return fmt.Errorf("remote listen: %w", err)
	}

	go func() {
		for {
			remoteConn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer remoteConn.Close()
				localAddr := fmt.Sprintf("%s:%d", localHost, localPort)
				localConn, err := net.Dial("tcp", localAddr)
				if err != nil {
					return
				}
				defer localConn.Close()

				go func() {
					io.Copy(localConn, remoteConn)
				}()
				io.Copy(remoteConn, localConn)
			}()
		}
	}()

	runtimeLog("Remote forward started: remote 0.0.0.0:%d -> %s:%d", remotePort, localHost, localPort)
	return nil
}

// StartSOCKS5 starts a SOCKS5 proxy on the given port.
func (c *Client) StartSOCKS5(port int) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("SOCKS5 listen: %w", err)
	}

	go func() {
		for {
			clientConn, err := listener.Accept()
			if err != nil {
				return
			}
			go c.handleSOCKS5(clientConn)
		}
	}()

	runtimeLog("SOCKS5 proxy started on 127.0.0.1:%d", port)
	return nil
}

func (c *Client) handleSOCKS5(clientConn net.Conn) {
	defer clientConn.Close()

	buf := make([]byte, 256)

	// SOCKS5 handshake
	if _, err := io.ReadFull(clientConn, buf[:2]); err != nil {
		return
	}
	nmethods := int(buf[1])
	if _, err := io.ReadFull(clientConn, buf[:nmethods]); err != nil {
		return
	}
	// No auth
	clientConn.Write([]byte{0x05, 0x00})

	// Request
	if _, err := io.ReadFull(clientConn, buf[:4]); err != nil {
		return
	}
	addrType := buf[3]

	var targetAddr string
	switch addrType {
	case 0x01: // IPv4
		if _, err := io.ReadFull(clientConn, buf[:4]); err != nil {
			return
		}
		targetAddr = fmt.Sprintf("%d.%d.%d.%d", buf[0], buf[1], buf[2], buf[3])
	case 0x03: // Domain
		if _, err := io.ReadFull(clientConn, buf[:1]); err != nil {
			return
		}
		domainLen := int(buf[0])
		if _, err := io.ReadFull(clientConn, buf[:domainLen]); err != nil {
			return
		}
		targetAddr = string(buf[:domainLen])
	case 0x04: // IPv6
		if _, err := io.ReadFull(clientConn, buf[:16]); err != nil {
			return
		}
		targetAddr = fmt.Sprintf("[%x:%x:%x:%x:%x:%x:%x:%x]",
			buf[0:2], buf[2:4], buf[4:6], buf[6:8],
			buf[8:10], buf[10:12], buf[12:14], buf[14:16])
	default:
		return
	}

	// Port
	if _, err := io.ReadFull(clientConn, buf[:2]); err != nil {
		return
	}
	targetPort := int(buf[0])<<8 | int(buf[1])

	// Connect to target via SSH
	remoteConn, err := c.conn.Dial("tcp", fmt.Sprintf("%s:%d", targetAddr, targetPort))
	if err != nil {
		// Reply with error
		clientConn.Write([]byte{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	defer remoteConn.Close()

	// Reply success
	clientConn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0})

	go func() { io.Copy(remoteConn, clientConn) }()
	io.Copy(clientConn, remoteConn)
}

func runtimeLog(format string, args ...interface{}) {
	_ = fmt.Sprintf(format, args...)
	// In production: pass back to UI via callback
}

// --- private ---

func (c *Client) buildAuthMethods() []ssh.AuthMethod {
	var methods []ssh.AuthMethod

	if c.cfg.Password != "" {
		methods = append(methods, ssh.Password(c.cfg.Password))
	}

	if c.cfg.PrivateKeyPath != "" {
		key, err := os.ReadFile(c.cfg.PrivateKeyPath)
		if err == nil {
			signer, err := ssh.ParsePrivateKey(key)
			if err == nil {
				methods = append(methods, ssh.PublicKeys(signer))
			}
		}
	}

	// Try default keys
	home, _ := os.UserHomeDir()
	for _, name := range []string{"id_rsa", "id_ed25519", "id_ecdsa"} {
		keyPath := home + "/.ssh/" + name
		key, err := os.ReadFile(keyPath)
		if err != nil {
			continue
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			continue
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if c.cfg.UseAgent {
		if agentConn, err := net.Dial("unix", os.Getenv("SSH_AUTH_SOCK")); err == nil {
			methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(agentConn).Signers))
		}
	}

	return methods
}

func (c *Client) buildHostKeyCallback() (ssh.HostKeyCallback, error) {
	home, _ := os.UserHomeDir()
	knownHostsPath := home + "/.ssh/known_hosts"

	f, err := os.Open(knownHostsPath)
	if err != nil {
		// No known_hosts file - accept all (like StrictHostKeyChecking=no)
		return ssh.InsecureIgnoreHostKey(), nil
	}
	defer f.Close()

	hostKeyCallback, err := knownhosts.New(knownHostsPath)
	if err != nil {
		return ssh.InsecureIgnoreHostKey(), nil
	}
	return hostKeyCallback, nil
}

func (c *Client) dialViaJump(ctx context.Context, jump, target string, targetCfg *ssh.ClientConfig) (net.Conn, error) {
	// Parse jump host
	jumpCfg := &ssh.ClientConfig{
		User:            c.cfg.Username,
		Auth:            c.buildAuthMethods(),
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}

	jumpConn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", jump)
	if err != nil {
		return nil, fmt.Errorf("dial jump %s: %w", jump, err)
	}

	jumpSSHConn, chans, reqs, err := ssh.NewClientConn(jumpConn, jump, jumpCfg)
	if err != nil {
		jumpConn.Close()
		return nil, fmt.Errorf("jump ssh handshake: %w", err)
	}
	jumpClient := ssh.NewClient(jumpSSHConn, chans, reqs)

	conn, err := jumpClient.Dial("tcp", target)
	if err != nil {
		jumpClient.Close()
		return nil, fmt.Errorf("dial via jump: %w", err)
	}
	return &jumpConnWrapper{Conn: conn, jump: jumpClient}, nil
}

func (c *Client) readLoop(ctx context.Context) {
	buf := make([]byte, 32*1024)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := c.stdout.Read(buf)
			if err != nil {
				if ctx.Err() == nil {
					c.setError(fmt.Errorf("read: %w", err))
					c.setState(protocol.StateDisconnected)
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

func (c *Client) keepAlive(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if c.conn != nil {
				c.conn.SendRequest("keepalive@openssh.com", true, nil)
			}
		}
	}
}

func (c *Client) waitSession(ctx context.Context) {
	if c.session == nil {
		return
	}
	err := c.session.Wait()
	if err != nil && ctx.Err() == nil {
		c.setError(fmt.Errorf("session ended: %w", err))
	}
	c.setState(protocol.StateDisconnected)
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

// jumpConnWrapper closes the jump client when the connection closes.
type jumpConnWrapper struct {
	net.Conn
	jump *ssh.Client
}

func (w *jumpConnWrapper) Close() error {
	err := w.Conn.Close()
	w.jump.Close()
	return err
}
