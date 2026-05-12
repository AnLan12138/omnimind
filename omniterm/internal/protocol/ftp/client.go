package ftp

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jlaffaye/ftp"

	"omniterm/internal/protocol"
)

type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	ModTime string `json:"modTime"`
}

type Client struct {
	cfg      protocol.ConnConfig
	conn     *ftp.ServerConn
	cancel   context.CancelFunc
	state    protocol.ConnState
	stateMu  sync.RWMutex
	onData   protocol.DataCallback
	onState  protocol.StateCallback
	onError  protocol.ErrorCallback
}

func New() *Client {
	return &Client{state: protocol.StateDisconnected}
}

func (c *Client) Connect(ctx context.Context, cfg protocol.ConnConfig) error {
	c.cfg = cfg
	c.setState(protocol.StateConnecting)

	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 0 {
		cfg.Port = 21
		addr = fmt.Sprintf("%s:21", cfg.Host)
	}

	opts := []ftp.DialOption{
		ftp.DialWithTimeout(15 * time.Second),
	}

	conn, err := ftp.Dial(addr, opts...)
	if err != nil {
		c.setError(fmt.Errorf("ftp dial: %w", err))
		return err
	}
	c.conn = conn

	// Login
	user := cfg.Username
	if user == "" {
		user = "anonymous"
	}
	pass := cfg.Password
	if pass == "" {
		pass = "anonymous@"
	}

	if err := conn.Login(user, pass); err != nil {
		conn.Quit()
		c.setError(fmt.Errorf("ftp login: %w", err))
		return err
	}

	// Binary mode
	conn.Type("I")

	c.setState(protocol.StateConnected)
	return nil
}

func (c *Client) Disconnect() error {
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		c.conn.Quit()
	}
	c.setState(protocol.StateDisconnected)
	return nil
}

func (c *Client) Send(data []byte) error {
	return fmt.Errorf("ftp does not support raw send")
}

func (c *Client) Resize(rows, cols int) error {
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
		SupportsRecording: false,
		SupportsFilePanel: true,
		TerminalType:      "none",
	}
}

func (c *Client) OnData(cb protocol.DataCallback)   { c.onData = cb }
func (c *Client) OnState(cb protocol.StateCallback) { c.onState = cb }
func (c *Client) OnError(cb protocol.ErrorCallback) { c.onError = cb }

// --- FTP-specific operations ---

func (c *Client) ListDir(path string) ([]FileInfo, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	if path == "" {
		path = "."
	}

	entries, err := c.conn.List(path)
	if err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}

	var files []FileInfo
	for _, e := range entries {
		fullPath := filepath.ToSlash(filepath.Join(path, e.Name))
		files = append(files, FileInfo{
			Name:    e.Name,
			Path:    fullPath,
			Size:    int64(e.Size),
			IsDir:   e.Type == ftp.EntryTypeFolder,
			ModTime: e.Time.Format(time.RFC3339),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	return files, nil
}

func (c *Client) Download(remotePath, localPath string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	r, err := c.conn.Retr(remotePath)
	if err != nil {
		return fmt.Errorf("retr: %w", err)
	}
	defer r.Close()

	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return err
	}

	f, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("create local: %w", err)
	}
	defer f.Close()

	_, err = io.Copy(f, r)
	return err
}

func (c *Client) Upload(localPath, remotePath string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	f, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer f.Close()

	// Ensure remote directory exists
	remoteDir := filepath.ToSlash(filepath.Dir(remotePath))
	if remoteDir != "." && remoteDir != "/" {
		c.makeDirPath(remoteDir)
	}

	return c.conn.Stor(remotePath, f)
}

func (c *Client) Mkdir(path string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	return c.makeDirPath(path)
}

func (c *Client) Remove(path string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	// Try as file first, then as directory
	err := c.conn.Delete(path)
	if err != nil {
		return c.conn.RemoveDir(path)
	}
	return nil
}

func (c *Client) Rename(oldPath, newPath string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	return c.conn.Rename(oldPath, newPath)
}

func (c *Client) CurrentDir() (string, error) {
	if c.conn == nil {
		return "", fmt.Errorf("not connected")
	}
	return c.conn.CurrentDir()
}

func (c *Client) ChangeDir(path string) error {
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	return c.conn.ChangeDir(path)
}

// --- helpers ---

func (c *Client) makeDirPath(path string) error {
	parts := strings.Split(filepath.ToSlash(path), "/")
	current := ""
	for _, part := range parts {
		if part == "" {
			current = "/"
			continue
		}
		if current == "/" {
			current = "/" + part
		} else if current == "" {
			current = part
		} else {
			current = current + "/" + part
		}
		if err := c.conn.MakeDir(current); err != nil {
			// Ignore "already exists" errors
			_ = err
		}
	}
	return nil
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
