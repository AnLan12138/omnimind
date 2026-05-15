package ssh

import (
	"context"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type TunnelType int

const (
	TunnelLocal   TunnelType = 0 // -L localPort:remoteHost:remotePort
	TunnelRemote  TunnelType = 1 // -R remotePort:localHost:localPort
	TunnelDynamic TunnelType = 2 // -D localPort (SOCKS5)
)

type Tunnel struct {
	ID          string     `json:"id"`
	Type        TunnelType `json:"type"`
	LocalHost   string     `json:"localHost"`
	LocalPort   int        `json:"localPort"`
	RemoteHost  string     `json:"remoteHost"`
	RemotePort  int        `json:"remotePort"`
	Status      string     `json:"status"` // "running" | "stopped" | "error"
	Error       string     `json:"error,omitempty"`
	Connections int        `json:"connections"` // active connections count

	listener  net.Listener
	cancel    context.CancelFunc
	sshClient *gossh.Client
	conns     map[string]net.Conn
	connsMu  sync.Mutex
}

// StartLocalForward starts a local TCP listener and forwards connections through SSH.
func (c *Client) StartLocalForward(id, localAddr, remoteAddr string) (*Tunnel, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("ssh: not connected")
	}

	localHost, localPort, err := parseAddr(localAddr)
	if err != nil {
		return nil, fmt.Errorf("ssh: invalid local address: %w", err)
	}
	remoteHost, remotePort, err := parseAddr(remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("ssh: invalid remote address: %w", err)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", localHost, localPort))
	if err != nil {
		return nil, fmt.Errorf("ssh: listen %s:%d failed: %w", localHost, localPort, err)
	}

	t := &Tunnel{
		ID:         id,
		Type:       TunnelLocal,
		LocalHost:  localHost,
		LocalPort:  localPort,
		RemoteHost: remoteHost,
		RemotePort: remotePort,
		Status:     "running",
		listener:   listener,
		sshClient:  c.conn,
		conns:      make(map[string]net.Conn),
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	go t.serveLocal(ctx)

	c.mu.Lock()
	c.tunnels[t.ID] = t
	c.mu.Unlock()

	return t, nil
}

// StartRemoteForward starts a remote TCP listener and forwards connections to local.
func (c *Client) StartRemoteForward(id, remoteAddr, localAddr string) (*Tunnel, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("ssh: not connected")
	}

	remoteHost, remotePort, err := parseAddr(remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("ssh: invalid remote address: %w", err)
	}
	localHost, localPort, err := parseAddr(localAddr)
	if err != nil {
		return nil, fmt.Errorf("ssh: invalid local address: %w", err)
	}

	// Open a remote listener via SSH
	remoteListener, err := c.conn.Listen("tcp", fmt.Sprintf("%s:%d", remoteHost, remotePort))
	if err != nil {
		return nil, fmt.Errorf("ssh: remote listen %s:%d failed: %w", remoteHost, remotePort, err)
	}

	t := &Tunnel{
		ID:         id,
		Type:       TunnelRemote,
		LocalHost:  localHost,
		LocalPort:  localPort,
		RemoteHost: remoteHost,
		RemotePort: remotePort,
		Status:     "running",
		sshClient:  c.conn,
		conns:      make(map[string]net.Conn),
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	go t.serveRemote(ctx, remoteListener)

	c.mu.Lock()
	c.tunnels[t.ID] = t
	c.mu.Unlock()

	return t, nil
}

// StartDynamicForward starts a SOCKS5 proxy on the local address.
func (c *Client) StartDynamicForward(id, localAddr string) (*Tunnel, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("ssh: not connected")
	}

	localHost, localPort, err := parseAddr(localAddr)
	if err != nil {
		return nil, fmt.Errorf("ssh: invalid local address: %w", err)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", localHost, localPort))
	if err != nil {
		return nil, fmt.Errorf("ssh: listen %s:%d failed: %w", localHost, localPort, err)
	}

	t := &Tunnel{
		ID:        id,
		Type:      TunnelDynamic,
		LocalHost: localHost,
		LocalPort: localPort,
		Status:    "running",
		listener:  listener,
		sshClient: c.conn,
		conns:     make(map[string]net.Conn),
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	go t.serveSOCKS5(ctx)

	c.mu.Lock()
	c.tunnels[t.ID] = t
	c.mu.Unlock()

	return t, nil
}

// StopTunnel stops a running tunnel.
func (c *Client) StopTunnel(id string) error {
	c.mu.Lock()
	t, ok := c.tunnels[id]
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("ssh: tunnel %s not found", id)
	}
	t.stop()
	return nil
}

// ListTunnels returns all tunnels.
func (c *Client) ListTunnels() []*Tunnel {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var result []*Tunnel
	for _, t := range c.tunnels {
		result = append(result, t)
	}
	return result
}

// serveLocal handles incoming connections for local forwarding (-L).
func (t *Tunnel) serveLocal(ctx context.Context) {
	defer t.stop()
	for {
		select {
		case <-ctx.Done():
			return
		default:
			localConn, err := t.listener.Accept()
			if err != nil {
				return
			}
			id := fmt.Sprintf("%d", time.Now().UnixNano())
			t.trackConn(id, localConn)
			go func(id string) {
				defer t.removeConn(id)
				defer localConn.Close()

				remoteAddr := fmt.Sprintf("%s:%d", t.RemoteHost, t.RemotePort)
				remoteConn, err := t.sshClient.Dial("tcp", remoteAddr)
				if err != nil {
					t.Status = "error"
					t.Error = fmt.Sprintf("remote dial: %v", err)
					return
				}
				defer remoteConn.Close()

				bidirectionalCopy(localConn, remoteConn)
			}(id)
		}
	}
}

// serveRemote handles incoming connections for remote forwarding (-R).
func (t *Tunnel) serveRemote(ctx context.Context, listener net.Listener) {
	defer t.stop()
	defer listener.Close()
	for {
		select {
		case <-ctx.Done():
			return
		default:
			remoteConn, err := listener.Accept()
			if err != nil {
				return
			}
			id := fmt.Sprintf("%d", time.Now().UnixNano())
			t.trackConn(id, remoteConn)
			go func(id string) {
				defer t.removeConn(id)
				defer remoteConn.Close()

				localAddr := fmt.Sprintf("%s:%d", t.LocalHost, t.LocalPort)
				localConn, err := net.DialTimeout("tcp", localAddr, 10*time.Second)
				if err != nil {
					t.Status = "error"
					t.Error = fmt.Sprintf("local dial: %v", err)
					return
				}
				defer localConn.Close()

				bidirectionalCopy(remoteConn, localConn)
			}(id)
		}
	}
}

// serveSOCKS5 handles SOCKS5 proxy connections for dynamic forwarding (-D).
func (t *Tunnel) serveSOCKS5(ctx context.Context) {
	defer t.stop()
	for {
		select {
		case <-ctx.Done():
			return
		default:
			clientConn, err := t.listener.Accept()
			if err != nil {
				return
			}
			id := fmt.Sprintf("%d", time.Now().UnixNano())
			t.trackConn(id, clientConn)
			go func(id string) {
				defer t.removeConn(id)
				defer clientConn.Close()

				targetAddr, err := socks5HandshakeAddr(clientConn)
				if err != nil {
					return
				}

				remoteConn, err := t.sshClient.Dial("tcp", targetAddr)
				if err != nil {
					clientConn.Write(socks5Reply(0x04)) // Host unreachable
					return
				}
				defer remoteConn.Close()

				// Send success
				clientConn.Write(socks5Reply(0x00))
				bidirectionalCopy(clientConn, remoteConn)
			}(id)
		}
	}
}

func (t *Tunnel) stop() {
	if t.cancel != nil {
		t.cancel()
	}
	if t.listener != nil {
		t.listener.Close()
	}
	t.Status = "stopped"
	t.connsMu.Lock()
	for _, conn := range t.conns {
		conn.Close()
	}
	t.conns = nil
	t.connsMu.Unlock()
}

func (t *Tunnel) trackConn(id string, conn net.Conn) {
	t.connsMu.Lock()
	t.conns[id] = conn
	t.Connections = len(t.conns)
	t.connsMu.Unlock()
}

func (t *Tunnel) removeConn(id string) {
	t.connsMu.Lock()
	delete(t.conns, id)
	t.Connections = len(t.conns)
	t.connsMu.Unlock()
}

// socks5HandshakeAddr performs a minimal SOCKS5 handshake and returns the target address.
func socks5HandshakeAddr(client net.Conn) (string, error) {
	client.SetDeadline(time.Now().Add(30 * time.Second))
	defer client.SetDeadline(time.Time{})

	buf := make([]byte, 256)

	// Read greeting
	if _, err := io.ReadFull(client, buf[:2]); err != nil {
		return "", fmt.Errorf("socks5: read greeting: %w", err)
	}
	nmethods := int(buf[1])
	if _, err := io.ReadFull(client, buf[:nmethods]); err != nil {
		return "", fmt.Errorf("socks5: read methods: %w", err)
	}

	// Reply: no auth required
	if _, err := client.Write([]byte{0x05, 0x00}); err != nil {
		return "", fmt.Errorf("socks5: write auth reply: %w", err)
	}

	// Read request
	if _, err := io.ReadFull(client, buf[:4]); err != nil {
		return "", fmt.Errorf("socks5: read request: %w", err)
	}
	if buf[1] != 0x01 {
		client.Write(socks5Reply(0x07))
		return "", fmt.Errorf("socks5: unsupported command %d", buf[1])
	}

	// Read address
	var host string
	switch buf[3] {
	case 0x01: // IPv4
		if _, err := io.ReadFull(client, buf[:4]); err != nil {
			return "", err
		}
		host = fmt.Sprintf("%d.%d.%d.%d", buf[0], buf[1], buf[2], buf[3])
	case 0x03: // Domain
		if _, err := io.ReadFull(client, buf[:1]); err != nil {
			return "", err
		}
		if _, err := io.ReadFull(client, buf[:buf[0]]); err != nil {
			return "", err
		}
		host = string(buf[:buf[0]])
	case 0x04: // IPv6
		if _, err := io.ReadFull(client, buf[:16]); err != nil {
			return "", err
		}
		host = fmt.Sprintf("[%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x]",
			buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6], buf[7],
			buf[8], buf[9], buf[10], buf[11], buf[12], buf[13], buf[14], buf[15])
	default:
		client.Write(socks5Reply(0x08))
		return "", fmt.Errorf("socks5: unsupported address type %d", buf[3])
	}

	// Read port
	if _, err := io.ReadFull(client, buf[:2]); err != nil {
		return "", err
	}
	port := int(buf[0])<<8 | int(buf[1])

	return fmt.Sprintf("%s:%d", host, port), nil
}

// socks5Reply returns a SOCKS5 server reply packet.
func socks5Reply(code byte) []byte {
	return []byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0}
}

func parseAddr(addr string) (string, int, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return "", 0, err
	}
	var port int
	if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil {
		return "", 0, fmt.Errorf("invalid port: %s", portStr)
	}
	return host, port, nil
}

func bidirectionalCopy(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { io.Copy(a, b); done <- struct{}{} }()
	go func() { io.Copy(b, a); done <- struct{}{} }()
	<-done
}
