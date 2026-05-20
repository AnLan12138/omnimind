package main
/*
 * app.go — Go 后端主文件（Wails 绑定）
 * ==========================================
 * 核心结构：
 *   App.conns[connID] → ActiveConn{Client, SFTP, Recorder, Ctx, Cancel, ReplayBuf}
 *
 * 主要功能：
 *   1. Connect() — 根据协议创建 Client(SSH/Telnet/Serial/RDP/VNC/FTP/MOSH)
 *      - client.OnData → EventsEmit("conn:ID:data") 推送到前端
 *      - ringBuf(1MB) 记录最近输出，供前端 GetConnectionBuffer() 回放
 *   2. Disconnect() — 取消 context → 关闭连接 → 清理资源
 *   3. Send() — 线程安全读写，connID 不存在时静默忽略
 *   4. GetConnectionBuffer() — 返回 ringBuf 内容，用于终端重新挂载时回放
 *   5. LogFrontend() — 前端诊断日志写入 telnet log 文件
 *   6. autoReconnect() — 意外断连自动重连（5次）
 */

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"omnimind/internal/config"
	"omnimind/internal/filetransfer"
	"omnimind/internal/protocol"
	"omnimind/internal/protocol/serial"
	ftpclient "omnimind/internal/protocol/ftp"
	sshclient "omnimind/internal/protocol/ssh"
	telnetclient "omnimind/internal/protocol/telnet"
	rdpclient "omnimind/internal/protocol/rdp"
	moshclient "omnimind/internal/protocol/mosh"
	vncclient "omnimind/internal/protocol/vnc"
	"omnimind/internal/session"
	ghsync "omnimind/internal/sync"
)

// ringBuf is a simple circular byte buffer for replaying recent output.
type ringBuf struct {
	buf  []byte
	size int
	pos  int
	mu   sync.Mutex
}

func newRingBuf(size int) *ringBuf { return &ringBuf{buf: make([]byte, size), size: size} }

func (rb *ringBuf) Write(p []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	for _, b := range p {
		rb.buf[rb.pos] = b
		rb.pos = (rb.pos + 1) % rb.size
	}
}

func (rb *ringBuf) Bytes() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	out := make([]byte, 0, rb.size)
	for i := 0; i < rb.size; i++ {
		b := rb.buf[(rb.pos+i)%rb.size]
		if b != 0 {
			out = append(out, b)
		}
	}
	return out
}

type ActiveConn struct {
	ID       string
	Client   protocol.ProtocolClient
	SFTP     *filetransfer.SFTPClient
	Recorder *filetransfer.Recorder
	Ctx      context.Context
	Cancel   context.CancelFunc
	Latency  int64    // atomic, last measured RTT in milliseconds
	ReplayBuf *ringBuf // recent output buffer for terminal re-attach
}

// LatencyProber is implemented by clients that can measure RTT
type LatencyProber interface {
	Latency() int64
}

type App struct {
	ctx     context.Context
	store   *session.Store
	conns   map[string]*ActiveConn
	connsMu sync.RWMutex
}

func NewApp() *App {
	return &App{
		conns: make(map[string]*ActiveConn),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize data store
	dataDir, err := config.DataDir()
	if err != nil {
		runtime.LogError(ctx, "Failed to get data dir: "+err.Error())
		return
	}
	store, err := session.NewStore(dataDir)
	if err != nil {
		runtime.LogError(ctx, "Failed to init store: "+err.Error())
	} else {
		a.store = store
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.connsMu.Lock()
	for _, ac := range a.conns {
		ac.Client.Disconnect()
	}
	a.connsMu.Unlock()
	if a.store != nil {
		a.store.Close()
	}
}

// --- Session Management ---

func (a *App) ListSessions() ([]session.Session, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store not initialized")
	}
	return a.store.ListSessions()
}

func (a *App) SaveSession(sess session.Session) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	if sess.ID == "" {
		sess.ID = uuid.New().String()
	}
	return a.store.SaveSession(&sess)
}

func (a *App) DeleteSession(id string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	return a.store.DeleteSession(id)
}

func (a *App) ListFolders() ([]session.Folder, error) {
	if a.store == nil {
		return nil, fmt.Errorf("store not initialized")
	}
	return a.store.ListFolders()
}

func (a *App) SaveFolder(folder session.Folder) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	if folder.ID == "" {
		folder.ID = uuid.New().String()
	}
	return a.store.SaveFolder(&folder)
}

func (a *App) DeleteFolder(id string) error {
	if a.store == nil {
		return fmt.Errorf("store not initialized")
	}
	return a.store.DeleteFolder(id)
}

func (a *App) ExportSessions(filePath string) error {
	if a.store == nil { return fmt.Errorf("store not initialized") }
	return a.store.ExportSessions(filePath)
}
func (a *App) ImportSessions(filePath string) (int, error) {
	if a.store == nil { return 0, fmt.Errorf("store not initialized") }
	return a.store.ImportSessions(filePath)
}

// ImportSSHConfig parses ~/.ssh/config and imports hosts as sessions.
func (a *App) ImportSSHConfig(filePath string) (int, error) {
	if a.store == nil { return 0, fmt.Errorf("store not initialized") }
	sessions, err := session.ParseSSHConfig(filePath)
	if err != nil { return 0, err }
	count := 0
	for _, s := range sessions {
		if err := a.store.SaveSession(&s); err == nil { count++ }
	}
	return count, nil
}

// ImportMobaXterm parses MobaXterm .ini files and imports sessions.
func (a *App) ImportMobaXterm(filePath string) (int, error) {
	if a.store == nil { return 0, fmt.Errorf("store not initialized") }
	sessions, err := session.ParseMobaXtermSessions(filePath)
	if err != nil { return 0, err }
	count := 0
	for _, s := range sessions {
		if err := a.store.SaveSession(&s); err == nil { count++ }
	}
	return count, nil
}

// GenerateSSHKey generates an Ed25519 key pair.
func (a *App) GenerateSSHKey(keyPath string, comment string) (string, error) {
	if keyPath == "" {
		home, _ := config.DataDir()
		home, _ = config.HomeDir()
		keyPath = home + "/.ssh/id_ed25519_omnimind"
	}
	pubKey, err := session.GenerateKeyPair(keyPath, comment)
	if err != nil { return "", err }
	return pubKey, nil
}

// --- Connection Management ---

func (a *App) Connect(connID string, sess session.Session) error {
	cfg := a.sessionToConfig(sess)

	var client protocol.ProtocolClient
	switch sess.Protocol {
	case protocol.ProtoSSH:
		client = sshclient.New()
	case protocol.ProtoTelnet:
		client = telnetclient.New()
	case protocol.ProtoSerial:
		client = serial.New()
	case protocol.ProtoSFTP:
		client = sshclient.New() // SFTP is SSH
	case protocol.ProtoFTP:
		client = ftpclient.New()
	case protocol.ProtoVNC:
		client = vncclient.New()
	case protocol.ProtoRDP:
		client = rdpclient.New()
	case protocol.ProtoMOSH:
		client = moshclient.New()
	default:
		return fmt.Errorf("unsupported protocol: %s", sess.Protocol)
	}

	if connID == "" {
		connID = uuid.New().String()
	}

	// Ring buffer for terminal re-attach replay
	rb := newRingBuf(1024 * 1024) // 1MB buffer

	// Set up callbacks to push events to frontend
	client.OnData(func(data []byte) {
		rb.Write(data)
		runtime.EventsEmit(a.ctx, "conn:"+connID+":data", string(data))
	})
	client.OnError(func(err error) {
		runtime.EventsEmit(a.ctx, "conn:"+connID+":error", err.Error())
	})

	// Set up frame callback for RDP/VNC (canvas-based protocols)
	if rdp, ok := client.(*rdpclient.Client); ok {
		rdp.OnFrame(func(update *rdpclient.FrameUpdate) {
			json := rdpclient.FrameUpdateToJSON(update)
			runtime.EventsEmit(a.ctx, "conn:"+connID+":data", []byte(json))
		})
	}
		if vnc, ok := client.(*vncclient.Client); ok {
			vnc.OnFrame(func(update *vncclient.FrameUpdate) {
				b, _ := json.Marshal(update)
				runtime.EventsEmit(a.ctx, "conn:"+connID+":data", b)
			})
			vnc.OnClipboard(func(text string) {
				runtime.EventsEmit(a.ctx, "conn:"+connID+":clipboard", text)
			})
		}

	// State callback with auto-reconnect for unexpected disconnects
	client.OnState(func(state protocol.ConnState) {
		runtime.EventsEmit(a.ctx, "conn:"+connID+":state", state.String())

		if state == protocol.StateDisconnected {
			// Check if this is an unexpected disconnect (not user-initiated)
			a.connsMu.RLock()
			ac, exists := a.conns[connID]
			a.connsMu.RUnlock()
			if exists && ac != nil {
				// Start auto-reconnect
				go a.autoReconnect(connID, sess, client)
			}
		}
	})

	ctx, cancel := context.WithCancel(context.Background())

	a.connsMu.Lock()
	a.conns[connID] = &ActiveConn{
		ID:        connID,
		Client:    client,
		ReplayBuf: rb,
		Ctx:       ctx,
		Cancel:    cancel,
	}
	a.connsMu.Unlock()

	if err := client.Connect(ctx, cfg); err != nil {
		cancel()
		return err
	}

	// Start latency polling for protocols that support it
	if lp, ok := client.(LatencyProber); ok {
		go a.pollLatency(ctx, connID, lp)
	}

	return nil
}

func (a *App) pollLatency(ctx context.Context, connID string, lp LatencyProber) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.connsMu.RLock()
			ac := a.conns[connID]
			a.connsMu.RUnlock()
			if ac != nil {
				atomic.StoreInt64(&ac.Latency, lp.Latency())
			}
		}
	}
}

// GetLatency returns the last measured latency in milliseconds for a connection
func (a *App) GetLatency(connID string) int64 {
	a.connsMu.RLock()
	ac := a.conns[connID]
	a.connsMu.RUnlock()
	if ac == nil {
		return 0
	}
	return atomic.LoadInt64(&ac.Latency)
}

func (a *App) autoReconnect(connID string, sess session.Session, client protocol.ProtocolClient) {
	cfg := a.sessionToConfig(sess)
	reconnectCfg := protocol.DefaultReconnectConfig()
	reconnectCfg.MaxRetries = 5

	protocol.ReconnectLoop(
		context.Background(),
		reconnectCfg,
		func(ctx context.Context) error {
			// Check if connection was removed by user
			a.connsMu.RLock()
			_, exists := a.conns[connID]
			a.connsMu.RUnlock()
			if !exists {
				return fmt.Errorf("connection closed by user")
			}
			return client.Connect(ctx, cfg)
		},
		func(state protocol.ConnState) {
			runtime.EventsEmit(a.ctx, "conn:"+connID+":state", state.String())
		},
	)
}

func (a *App) sessionToConfig(sess session.Session) protocol.ConnConfig {
	cfg := protocol.ConnConfig{
		Type:           sess.Protocol,
		Host:           sess.Host,
		Port:           sess.Port,
		Username:       sess.Username,
		Password:       sess.Password,
		PrivateKeyPath: sess.PrivateKeyPath,
		UseAgent:       sess.UseAgent,
		ProxyJump:      sess.ProxyJump,
		KeepAliveSec:   sess.KeepAliveSec,
		TelnetTermType: sess.TelnetTermType,
		UseTLS:        sess.UseTLS,
		TLSSkipVerify: sess.TLSSkipVerify,
		UseFTPS:       sess.UseFTPS,
		BaudRate:       sess.BaudRate,
		DataBits:       sess.DataBits,
		StopBits:       sess.StopBits,
		Parity:         sess.Parity,
		FlowControl:    sess.FlowControl,
		TermType:       sess.TermType,
		Rows:           24,
		Cols:           80,
	}
	if cfg.KeepAliveSec <= 0 {
		cfg.KeepAliveSec = 30
	}
	if cfg.BaudRate == 0 {
		cfg.BaudRate = 115200
	}
	if cfg.DataBits == 0 {
		cfg.DataBits = 8
	}
	if cfg.StopBits == 0 {
		cfg.StopBits = 1.0
	}
	return cfg
}

func (a *App) Disconnect(connID string) error {
	a.connsMu.Lock()
	ac, ok := a.conns[connID]
	if !ok {
		a.connsMu.Unlock()
		return fmt.Errorf("connection not found: %s", connID)
	}
	// Cancel context FIRST to stop any pending autoReconnect
	if ac.Cancel != nil {
		ac.Cancel()
	}
	// Remove from map BEFORE disconnecting so state callback won't trigger reconnect
	delete(a.conns, connID)
	a.connsMu.Unlock()

	if ac.SFTP != nil {
		ac.SFTP.Close()
	}
	ac.Client.Disconnect()
	return nil
}

func (a *App) sendData(connID string, data string) error {
	a.connsMu.RLock()
	ac, ok := a.conns[connID]
	a.connsMu.RUnlock()
	if !ok {
		return nil // silently ignore - connection already closed
	}
	return ac.Client.Send([]byte(data))
}

func (a *App) resizeTerm(connID string, rows int, cols int) error {
	a.connsMu.RLock()
	ac, ok := a.conns[connID]
	a.connsMu.RUnlock()
	if !ok {
		return nil
	}
	return ac.Client.Resize(rows, cols)
}

func (a *App) Send(connID string, data string) error {
	return a.sendData(connID, data)
}

func (a *App) Resize(connID string, rows int, cols int) error {
	return a.resizeTerm(connID, rows, cols)
}

func (a *App) GetConnectionState(connID string) string {
	a.connsMu.RLock()
	ac, ok := a.conns[connID]
	a.connsMu.RUnlock()
	if !ok {
		return "disconnected"
	}
	return ac.Client.State().String()
}

// LogFrontend writes a frontend diagnostic message to the telnet log
func (a *App) LogFrontend(msg string) {
	f, err := os.OpenFile(os.TempDir()+"/omnimind_telnet.log", os.O_APPEND|os.O_WRONLY, 0644)
	if err == nil {
		f.WriteString(msg + "\n")
		f.Close()
	}
}

// GetConnectionBuffer returns recent output for replay on terminal re-attach
func (a *App) GetConnectionBuffer(connID string) string {
	a.connsMu.RLock()
	ac := a.conns[connID]
	a.connsMu.RUnlock()
	if ac == nil || ac.ReplayBuf == nil {
		return ""
	}
	return string(ac.ReplayBuf.Bytes())
}

func (a *App) getConn(connID string) *ActiveConn {
	a.connsMu.RLock()
	defer a.connsMu.RUnlock()
	return a.conns[connID]
}

// --- RDP Operations ---

func (a *App) RDPSendKeyDown(connID string, sc int, name string) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendKeyDown(sc, name)
	return nil
}
func (a *App) RDPSendKeyUp(connID string, sc int, name string) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendKeyUp(sc, name)
	return nil
}
func (a *App) RDPSendMouseDown(connID string, button int, x int, y int) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendMouseDown(button, x, y)
	return nil
}
func (a *App) RDPSendMouseUp(connID string, button int, x int, y int) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendMouseUp(button, x, y)
	return nil
}
func (a *App) RDPSendMouseMove(connID string, x int, y int) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendMouseMove(x, y)
	return nil
}
func (a *App) RDPSendMouseWheel(connID string, scroll int, x int, y int) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rdp, ok := ac.Client.(*rdpclient.Client)
	if !ok { return fmt.Errorf("not an RDP connection") }
	rdp.SendMouseWheel(scroll, x, y)
	return nil
}

// --- VNC Operations ---

func (a *App) VNCRequestUpdate(connID string) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	vnc, ok := ac.Client.(*vncclient.Client)
	if !ok { return fmt.Errorf("not a VNC connection") }
	vnc.RequestUpdate()
	return nil
}

func (a *App) VNCSendPointer(connID string, x uint16, y uint16, buttons uint8) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	vnc, ok := ac.Client.(*vncclient.Client)
	if !ok { return fmt.Errorf("not a VNC connection") }
	vnc.SendPointer(x, y, buttons)
	return nil
}

func (a *App) VNCSendKey(connID string, down bool, keySym uint32) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	vnc, ok := ac.Client.(*vncclient.Client)
	if !ok { return fmt.Errorf("not a VNC connection") }
	vnc.SendKey(down, keySym)
	return nil
}

func (a *App) VNCFrameSize(connID string) (uint16, uint16, error) {
	ac := a.getConn(connID)
	if ac == nil { return 0, 0, fmt.Errorf("not connected") }
	vnc, ok := ac.Client.(*vncclient.Client)
	if !ok { return 0, 0, fmt.Errorf("not a VNC connection") }
	w, h := vnc.FrameSize()
	return w, h, nil
}

// VNCSendClipboard sends local clipboard text to the VNC server
func (a *App) VNCSendClipboard(connID string, text string) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	vnc, ok := ac.Client.(*vncclient.Client)
	if !ok { return fmt.Errorf("not a VNC connection") }
	return vnc.SendClipboard(text)
}

// --- FTP File Operations ---

func (a *App) ListFTP(connID string, path string) ([]ftpclient.FileInfo, error) {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return nil, err }
	return ftp.ListDir(path)
}
func (a *App) FTPDownload(connID string, remotePath string, localPath string) error {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return err }
	return ftp.Download(remotePath, localPath)
}
func (a *App) FTPUpload(connID string, localPath string, remotePath string) error {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return err }
	return ftp.Upload(localPath, remotePath)
}
func (a *App) FTPMkdir(connID string, path string) error {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return err }
	return ftp.Mkdir(path)
}
func (a *App) FTPRemove(connID string, path string) error {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return err }
	return ftp.Remove(path)
}
func (a *App) FTPRename(connID string, oldPath string, newPath string) error {
	ftp, err := a.getFTPClient(connID)
	if err != nil { return err }
	return ftp.Rename(oldPath, newPath)
}
func (a *App) getFTPClient(connID string) (*ftpclient.Client, error) {
	a.connsMu.RLock(); defer a.connsMu.RUnlock()
	ac := a.conns[connID]
	if ac == nil { return nil, fmt.Errorf("not connected") }
	ftp, ok := ac.Client.(*ftpclient.Client)
	if !ok { return nil, fmt.Errorf("not an FTP connection") }
	return ftp, nil
}

func (a *App) SendPassword(connID string, password string) {
	ac := a.getConn(connID)
	if ac == nil { return }
	if s, ok := ac.Client.(*sshclient.Client); ok {
		s.SendPassword(password)
	}
}

// --- SFTP Operations ---

func (a *App) OpenSFTP(connID string) error {
	a.connsMu.RLock()
	ac, ok := a.conns[connID]
	a.connsMu.RUnlock()
	if !ok {
		return fmt.Errorf("connection not found")
	}

	// Only SSH supports SFTP
	sshClient, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("SFTP only supported for SSH connections")
	}

	rawSSH, err := sshClient.GetSFTPClient()
	if err != nil {
		return err
	}

	sftpClient, err := filetransfer.NewSFTPClient(rawSSH)
	if err != nil {
		return err
	}

	a.connsMu.Lock()
	ac.SFTP = sftpClient
	a.connsMu.Unlock()
	return nil
}

func (a *App) ListSFTP(connID string, path string) ([]filetransfer.FileInfo, error) {
	// Auto-open SFTP if not already open
	ac := a.getSFTPConn(connID)
	if ac == nil {
		if err := a.OpenSFTP(connID); err != nil {
			return nil, fmt.Errorf("open SFTP: %w", err)
		}
		ac = a.getSFTPConn(connID)
		if ac == nil {
			return nil, fmt.Errorf("SFTP not open")
		}
	}
	return ac.SFTP.ListDir(path)
}

func (a *App) SFTPDownload(connID string, remotePath string, localPath string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.Download(remotePath, localPath, nil)
}
func (a *App) SFTPUpload(connID string, localPath string, remotePath string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.Upload(localPath, remotePath, nil)
}
func (a *App) SFTPMkdir(connID string, path string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.Mkdir(path)
}
func (a *App) SFTPCreateFile(connID string, path string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.CreateEmpty(path)
}

func (a *App) PickDownloadDir() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择下载保存目录"})
	if err != nil { return "", err }
	if dir == "" { return "", fmt.Errorf("未选择目录") }
	return dir, nil
}

func (a *App) SaveTerminalContent(content string, filename string) error {
	// Sanitize filename
	safe := strings.Map(func(r rune) rune {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*':
			return '_'
		}
		return r
	}, filename)

	// Use native Windows GetSaveFileNameW directly — Wails SaveFileDialog crashes
	filter := "Text Files (*.txt)\000*.txt\000All Files (*.*)\000*.*\000"
	filePath, err := winSaveFileDialog("保存终端内容", safe, filter, 1)
	if err != nil {
		return err
	}
	if filePath == "" {
		return nil // user cancelled
	}

	windowsContent := strings.ReplaceAll(content, "\n", "\r\n")
	return os.WriteFile(filePath, []byte(windowsContent), 0644)
}

func (a *App) SFTPUploadData(connID string, remotePath string, data string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil { return fmt.Errorf("decode: %w", err) }
	return ac.SFTP.UploadData(remotePath, decoded)
}

func (a *App) SFTPRemove(connID string, path string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.Remove(path)
}
func (a *App) SFTPRename(connID string, oldPath string, newPath string) error {
	ac := a.ensureSFTP(connID); if ac == nil { return fmt.Errorf("SFTP not open") }
	return ac.SFTP.Rename(oldPath, newPath)
}

func (a *App) ensureSFTP(connID string) *ActiveConn {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		a.OpenSFTP(connID)
		return a.getSFTPConn(connID)
	}
	return ac
}

func (a *App) getSFTPConn(connID string) *ActiveConn {
	a.connsMu.RLock()
	defer a.connsMu.RUnlock()
	ac, ok := a.conns[connID]
	if !ok || ac.SFTP == nil {
		return nil
	}
	return ac
}

// --- Terminal Recording ---

func (a *App) StartRecording(connID string, filePath string, width int, height int) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	rec, err := filetransfer.NewRecorder(filePath, width, height)
	if err != nil { return err }
	ac.Recorder = rec
	return nil
}

func (a *App) StopRecording(connID string) error {
	ac := a.getConn(connID)
	if ac == nil { return fmt.Errorf("not connected") }
	if ac.Recorder == nil { return nil }
	return ac.Recorder.Stop()
}

func (a *App) RecordData(connID string, data string, isOutput bool) {
	ac := a.getConn(connID)
	if ac == nil || ac.Recorder == nil { return }
	if isOutput { ac.Recorder.RecordOutput(data) } else { ac.Recorder.RecordInput(data) }
}

// --- Security ---

var masterPassword string

func (a *App) SetMasterPassword(password string) {
	masterPassword = password
	if a.store != nil && password != "" { a.store.SetMasterPassword(password) }
}

func (a *App) Unlock(password string) bool {
	return masterPassword == "" || password == masterPassword
}

func (a *App) IsLocked() bool {
	return masterPassword != ""
}

// --- Auto Update ---

func (a *App) CheckForUpdate() (*config.ReleaseInfo, error) {
	checker := config.NewUpdateChecker("0.1.0")
	release, err := checker.CheckForUpdate()
	if err != nil { return nil, err }
	if release == nil { return nil, nil }
	return release, nil
}

func (a *App) InstallUpdate(assetURL string) error {
	exePath, _ := os.Executable()
	checker := config.NewUpdateChecker("0.1.0")
	return checker.DownloadAndReplace(assetURL, exePath)
}

// --- Extensions / External Tools ---

// LaunchProgram starts an external program with optional arguments.
func (a *App) LaunchProgram(exePath string, args string) error {
	if exePath == "" {
		return fmt.Errorf("no program path configured")
	}
	parts := []string{}
	if args != "" {
		parts = stringsSplit(args)
	}
	cmd := exec.Command(exePath, parts...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

func stringsSplit(s string) []string {
	parts := []string{}
	current := ""
	inQuote := false
	for _, c := range s {
		if c == '"' {
			inQuote = !inQuote
		} else if c == ' ' && !inQuote {
			if current != "" {
				parts = append(parts, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		parts = append(parts, current)
	}
	return parts
}

// PickExecutable opens a file dialog to select an .exe file.
func (a *App) PickExecutable() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Program",
		Filters: []runtime.FileFilter{
			{DisplayName: "Executable (*.exe)", Pattern: "*.exe"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// --- SSH Tunnels ---

func (a *App) StartSSHTunnel(connID string, id string, ttype int, localAddr string, remoteAddr string) error {
	ac := a.getConn(connID)
	if ac == nil {
		return fmt.Errorf("connection %s not found", connID)
	}
	sshCli, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("connection %s is not SSH", connID)
	}
	switch ttype {
	case 0:
		_, err := sshCli.StartLocalForward(id, localAddr, remoteAddr)
		return err
	case 1:
		_, err := sshCli.StartRemoteForward(id, remoteAddr, localAddr)
		return err
	case 2:
		_, err := sshCli.StartDynamicForward(id, localAddr)
		return err
	default:
		return fmt.Errorf("unknown tunnel type: %d", ttype)
	}
}

func (a *App) StopSSHTunnel(connID string, id string) error {
	ac := a.getConn(connID)
	if ac == nil {
		return fmt.Errorf("connection %s not found", connID)
	}
	sshCli, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("connection %s is not SSH", connID)
	}
	return sshCli.StopTunnel(id)
}

// --- Utility ---

func (a *App) ListSerialPorts() ([]string, error) {
	return serial.ListPorts()
}

func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// --- GitHub Sync ---

func (a *App) SyncPush(token string, gistID string, sessionsJSON string, foldersJSON string, macrosJSON string, settingsJSON string, devicesJSON string) (string, error) {
	data := &ghsync.SyncData{
		Sessions: sessionsJSON,
		Folders:  foldersJSON,
		Macros:   macrosJSON,
		Settings: settingsJSON,
		Devices:  devicesJSON,
	}
	return ghsync.PushToGist(token, gistID, data)
}

func (a *App) SyncPull(token string, gistID string) (map[string]string, error) {
	data, err := ghsync.PullFromGist(token, gistID)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"sessions": data.Sessions,
		"folders":  data.Folders,
		"macros":   data.Macros,
		"settings": data.Settings,
		"devices":  data.Devices,
	}, nil
}
