package ssh

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"

	"omnimind/internal/protocol"
)

type Client struct {
	cfg protocol.ConnConfig

	conn    *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	stderr  io.Reader

	state     protocol.ConnState
	stateMu   sync.RWMutex
	cancel    context.CancelFunc
	latencyNs int64 // atomic, last measured RTT in nanoseconds

	tunnels map[string]*Tunnel
	mu      sync.RWMutex

	onData          protocol.DataCallback
	onState         protocol.StateCallback
	onError         protocol.ErrorCallback
	interactivePipe chan string
	authBuf         string
	authCtx         context.Context
}

func New() *Client {
	return &Client{
		state:           protocol.StateDisconnected,
		interactivePipe: make(chan string, 10),
		tunnels:         make(map[string]*Tunnel),
	}
}

func (c *Client) SendPassword(pw string) {
	c.cfg.Password = pw
	// Auto-reconnect with password
	go func() {
		if c.conn != nil {
			c.conn.Close()
		}
		// Brief delay to let disconnect settle
		time.Sleep(100 * time.Millisecond)
		if err := c.Connect(c.authCtx, c.cfg); err != nil {
			c.setError(fmt.Errorf("reconnect failed: %w", err))
		}
	}()
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.authCtx = ctx
	c.setState(protocol.StateConnecting)

	hostKeyCallback, err := c.buildHostKeyCallback()
	if err != nil {
		c.setError(fmt.Errorf("host key callback: %w", err))
		return err
	}

	if cfg.KeepAliveSec <= 0 {
		cfg.KeepAliveSec = 30
	}

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	authMethods := c.buildAuthMethods()

	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	}

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

	termType := cfg.TermType
	if termType == "" { termType = "xterm-256color" }
	if err := session.RequestPty(termType, rows, cols, modes); err != nil {
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

	c.stderr, err = session.StderrPipe()
	if err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("stderr pipe: %w", err))
		return err
	}

	if err := session.Shell(); err != nil {
		session.Close()
		c.conn.Close()
		c.setError(fmt.Errorf("start shell: %w", err))
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	go c.readLoop(ctx)
	go c.readStderrLoop(ctx)
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
	// If not yet connected (no stdin), treat input as password and auto-reconnect
	if c.stdin == nil {
		for _, b := range data {
			if b == '\r' || b == '\n' {
				if c.onData != nil { c.onData([]byte("\r\n")) }
				if c.authBuf != "" {
					// 阻塞投递到等待中的回调 (pipe 缓冲区=10，永不阻塞)
					c.interactivePipe <- c.authBuf
					c.authBuf = ""
				}
			} else if b == 127 || b == '\b' {
				if len(c.authBuf) > 0 {
					c.authBuf = c.authBuf[:len(c.authBuf)-1]
					if c.onData != nil { c.onData([]byte("\b \b")) }
				}
			} else if b >= 32 {
				c.authBuf += string(b)
				if c.onData != nil { c.onData([]byte("*")) }
			}
		}
		return nil
	}
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


// --- private ---

func (c *Client) buildAuthMethods() []ssh.AuthMethod {
	var methods []ssh.AuthMethod

	// Shared password-getter (prompts in terminal, waits for user input via interactivePipe)
	getPassword := func(prompt string) (string, error) {
		password := c.cfg.Password
		if password != "" {
			return password, nil
		}
		if c.onData != nil {
			c.onData([]byte("\r\n" + prompt + " "))
		}
		select {
		case pw := <-c.interactivePipe:
			c.cfg.Password = pw
			return pw, nil
		case <-c.authCtx.Done():
			return "", fmt.Errorf("auth cancelled")
		}
	}

	// 1. PasswordCallback + RetryableAuthMethod (handles "password" method servers)
	//    For keyboard-interactive-only servers, the authenticate loop skips this
	//    and falls through to method #2.
	methods = append(methods, ssh.RetryableAuthMethod(ssh.PasswordCallback(func() (string, error) {
		return getPassword(c.cfg.Username + "@" + c.cfg.Host + "'s password")
	}), 3))

	// 2. Keyboard-interactive for PAM-based servers (Ubuntu, etc.)
	methods = append(methods, ssh.KeyboardInteractive(func(
		user, instruction string, questions []string, echos []bool,
	) ([]string, error) {
		answers := make([]string, len(questions))
		for i, q := range questions {
			pw, err := getPassword(q)
			if err != nil {
				return nil, err
			}
			answers[i] = pw
		}
		return answers, nil
	}))

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

	// Ensure .ssh directory exists
	sshDir := home + "/.ssh"
	os.MkdirAll(sshDir, 0700)

	// Check if known_hosts exists and has this host
	cb, err := knownhosts.New(knownHostsPath)
	if err != nil {
		// No valid known_hosts — accept all (StrictHostKeyChecking=no)
		return ssh.InsecureIgnoreHostKey(), nil
	}

	// Try to verify; if unknown, auto-add to known_hosts (TOFU — Trust On First Use)
	addr := fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port)
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := cb(hostname, remote, key)
		if err == nil {
			return nil // known and matches
		}
		// Key is unknown — save and accept
		line := knownhosts.Line([]string{addr}, key)
		f, ferr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if ferr == nil {
			f.WriteString(line + "\n")
			f.Close()
		}
		return nil // accept the key
	}, nil
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

func (c *Client) readStderrLoop(ctx context.Context) {
	buf := make([]byte, 16*1024)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := c.stderr.Read(buf)
			if err != nil {
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
				start := time.Now()
				c.conn.SendRequest("keepalive@openssh.com", true, nil)
				atomic.StoreInt64(&c.latencyNs, int64(time.Since(start)))
			}
		}
	}
}

// Latency returns the last measured round-trip time in milliseconds
func (c *Client) Latency() int64 {
	return atomic.LoadInt64(&c.latencyNs) / 1e6
}

// Banner returns the SSH server version string (e.g. "SSH-2.0-Cisco-1.25").
func (c *Client) Banner() string {
    if c.conn != nil {
        return string(c.conn.ServerVersion())
    }
    return ""
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
