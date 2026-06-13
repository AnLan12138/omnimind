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

	"omnimind/internal/ai"
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
	"path/filepath"
	"omnimind/internal/device"
	"omnimind/internal/skill"
	sshproto "golang.org/x/crypto/ssh"
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
	// Device info for AI context injection
	DeviceHost string
	DevicePort int
	DeviceProto string
	DeviceUser string

    // Device detection
    DeviceIdent *device.Identifier
    SSHConn     *sshproto.Client // for extracting SSH banner
}

// LatencyProber is implemented by clients that can measure RTT
type LatencyProber interface {
	Latency() int64
}

type App struct {
	ctx           context.Context
	store         *session.Store
	skillManager  *skill.Manager
	conns         map[string]*ActiveConn
	connsMu       sync.RWMutex
	// AI engine
	aiToolRegistry *ai.ToolRegistry
	aiSkillLoader  *ai.SkillLoader
	aiRAG          *ai.RAGStore
	aiMessages     map[string][]ai.Message // streamID -> conversation history
	aiMsgMu        sync.Mutex
}

func NewApp() *App {
	return &App{
		conns:      make(map[string]*ActiveConn),
		aiMessages: make(map[string][]ai.Message),
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

    // Initialize skill manager
    skillsDir := filepath.Join(dataDir, "skills")
    a.skillManager = skill.NewManager(skillsDir)
    if err := a.skillManager.LoadAll(); err != nil {
        runtime.LogError(ctx, "Failed to load skills: "+err.Error())
    }
    // Ensure builtin skills exist
    a.skillManager.EnsureBuiltin("device-fingerprint", "设备指纹识别", "自动识别连接设备的厂商、型号、OS版本和CLI模式")

    // Initialize AI engine
    aiSkillsDir := filepath.Join(dataDir, "ai-skills")
    a.aiSkillLoader = ai.NewSkillLoader()
    a.aiSkillLoader.LoadAll(aiSkillsDir)
    a.aiSkillLoader.EnsureBuiltin(aiSkillsDir, "cisco-expert", "Cisco Expert", "Cisco IOS/IOS-XE/NX-OS")
    a.aiSkillLoader.EnsureBuiltin(aiSkillsDir, "huawei-expert", "Huawei Expert", "Huawei VRP/VRPv8")
    a.aiSkillLoader.EnsureBuiltin(aiSkillsDir, "troubleshooter", "Troubleshooter", "Systematic network troubleshooting")
    ragPath := filepath.Join(dataDir, "ai-knowledge.json")
    a.aiRAG = ai.NewRAGStore(ragPath)
    a.seedRAGKnowledge()
    a.loadConversations(dataDir)
    a.initAITools()
}

func (a *App) shutdown(ctx context.Context) {
	a.connsMu.Lock()
	for _, ac := range a.conns {
		ac.Client.Disconnect()
	}
	a.connsMu.Unlock()
	if a.store != nil {
		a.store.Close()
    a.saveConversations()
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
		ID:         connID,
		Client:     client,
		ReplayBuf:  rb,
		Ctx:        ctx,
		Cancel:     cancel,
		DeviceHost: sess.Host,
		DevicePort: sess.Port,
		DeviceProto: string(sess.Protocol),
		DeviceUser: sess.Username,
	}
	a.connsMu.Unlock()

	if err := client.Connect(ctx, cfg); err != nil {
		cancel()
		return err
	}

	// Start device detection
    go a.detectDevice(connID, client, sess)

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

// detectDevice runs passive device detection and stores the result.
func (a *App) detectDevice(connID string, client protocol.ProtocolClient, sess session.Session) {
    // Get SSH banner immediately if available
    sshBanner := ""
    if sc, ok := client.(*sshclient.Client); ok {
        sshBanner = sc.Banner()
    }

    // For non-SSH (Telnet/Serial), poll the replay buffer for a prompt
    // Telnet login + prompt can take several seconds
    var prompt string
    if sshBanner == "" {
        maxWait := 4 * time.Second
        pollInterval := 500 * time.Millisecond
        deadline := time.Now().Add(maxWait)
        for time.Now().Before(deadline) {
            time.Sleep(pollInterval)
            a.connsMu.RLock()
            ac, ok := a.conns[connID]
            a.connsMu.RUnlock()
            if !ok || ac == nil {
                return
            }
            if ac.ReplayBuf != nil {
                buf := ac.ReplayBuf.Bytes()
                lines := strings.Split(string(buf), "\n")
                for i := len(lines) - 1; i >= 0; i-- {
                    trimmed := strings.TrimSpace(lines[i])
                    if trimmed != "" {
                        prompt = trimmed
                        break
                    }
                }
            }
            if prompt != "" {
                break
            }
        }
    } else {
        time.Sleep(200 * time.Millisecond) // SSH: brief wait for initial data
        a.connsMu.RLock()
        ac, ok := a.conns[connID]
        a.connsMu.RUnlock()
        if !ok || ac == nil {
            return
        }
        if ac.ReplayBuf != nil {
            buf := ac.ReplayBuf.Bytes()
            lines := strings.Split(string(buf), "\n")
            for i := len(lines) - 1; i >= 0; i-- {
                trimmed := strings.TrimSpace(lines[i])
                if trimmed != "" {
                    prompt = trimmed
                    break
                }
            }
        }
    }

    a.connsMu.RLock()
    ac, ok := a.conns[connID]
    a.connsMu.RUnlock()
    if !ok || ac == nil {
        return
    }

    ident := device.NewIdentifier(nil, false)
    ident.Detector = device.VendorDetector{
        Host:      sess.Host,
        Port:      sess.Port,
        User:      sess.Username,
        SSHBanner: sshBanner,
        Prompt:    prompt,
    }
    info := ident.IdentifyPassive()

    a.connsMu.Lock()
    if ac2, ok := a.conns[connID]; ok {
        ac2.DeviceIdent = ident
    }
    a.connsMu.Unlock()

    runtime.EventsEmit(a.ctx, "conn:"+connID+":device", info)
    // Trigger skill auto-discovery if vendor was identified
    if info.Vendor != "" && a.aiSkillLoader != nil {
        results := a.aiSkillLoader.RunDiscovery(connID, string(info.Vendor))
        for _, r := range results {
            runtime.LogInfo(a.ctx, "Skill discovery: "+r)
        }
    }
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

// --- AI Engine ---

// initAITools registers all built-in tools with the tool registry
func (a *App) initAITools() {
	tctx := &ai.ToolContext{
		GetConnections: func() []ai.DeviceInfo {
			a.connsMu.RLock()
			defer a.connsMu.RUnlock()
			var devices []ai.DeviceInfo
			for id, ac := range a.conns {
				if ac.Client.State().String() != "connected" {
					continue
				}
				d := ai.DeviceInfo{
					ConnID:   id,
					Host:     ac.DeviceHost,
					Port:     ac.DevicePort,
					Protocol: ac.DeviceProto,
					Username: ac.DeviceUser,
				}
				if ac.DeviceIdent != nil {
					d.Vendor = string(ac.DeviceIdent.DeviceInfo.Vendor)
					d.Model = ac.DeviceIdent.DeviceInfo.Model
					d.OS = string(ac.DeviceIdent.DeviceInfo.OS)
					d.OSVer = ac.DeviceIdent.DeviceInfo.OSVersion
					d.Hostname = ac.DeviceIdent.DeviceInfo.Hostname
				}
				devices = append(devices, d)
			}
			return devices
		},
		SendCommand: func(connID, cmd string) (string, error) {
			if err := a.sendData(connID, cmd); err != nil {
				return "", err
			}
			time.Sleep(1 * time.Second) // wait for response
			return a.GetConnectionBuffer(connID), nil
		},
		SendCommandDirect: func(connID, cmd string) error {
			return a.sendData(connID, cmd)
		},
		ReadBuffer: func(connID string) string {
			return a.GetConnectionBuffer(connID)
		},
		SearchKnowledge: func(query string, topK int) []ai.RAGDocument {
			return a.aiRAG.Search(query, topK)
		},
		IndexDocument: func(doc ai.RAGDocument) error {
			a.aiRAG.Index(doc)
			return nil
		},
		ListSkills: func() []string {
			return a.aiSkillLoader.List()
		},
		GetSkill: func(name string) (string, error) {
			sd, err := a.aiSkillLoader.Get(name)
			if err != nil {
				return "", err
			}
			return sd.Prompt, nil
		},
	}
	a.aiToolRegistry = ai.NewToolRegistry(tctx)
	// Register built-in tools from internal/ai/tools package
	// (tools are registered via tool package imports)
	initBuiltinTools(a.aiToolRegistry, tctx)
}

// AIChatStream — main entry point for AI chat with agent loop
func (a *App) AIChatStream(streamID string, messages []ai.Message, cfg ai.ClientConfig) error {
	if a.aiToolRegistry == nil {
		a.initAITools()
	}

	// Extract user message and config from frontend params
	userInput := ""
	systemPrompt := "你是一个网络运维AI助手。你可以使用工具来查询设备信息、发送命令、读取终端输出。请用中文回复。"
	var history []ai.Message

	for _, m := range messages {
		switch m.Role {
		case "system":
			systemPrompt = m.Content
		case "user":
			userInput = m.Content
			history = append(history, m)
		}
	}

	// Get conversation history
	a.aiMsgMu.Lock()
	savedHistory := a.aiMessages[streamID]
	a.aiMsgMu.Unlock()
	if len(savedHistory) > 0 {
		history = savedHistory
	}
	history = append(history, ai.Message{Role: "user", Content: userInput})

	// Build context
	ctxBuilder := ai.NewContextBuilder().
		SetSystemPrompt(systemPrompt).
		SetDevices(a.getDeviceInfos()).
		SetHistory(history).
		SetCoT(ai.CoTConfig{Enabled: true, Steps: 5}).
		SetMaxTokens(64000)

	agentCtx := ctxBuilder.Build()

	// Create agent
	client := ai.NewStreamClient(cfg)
	agent := ai.NewAgent(a.aiToolRegistry, client, agentCtx, ai.AgentConfig{
		MaxSteps: 5,
		CoT:      ai.CoTConfig{Enabled: true},
		EmitEvent: func(ev ai.StreamEvent) {
			// Map StreamEvent to Wails events for frontend
			switch ev.Type {
			case "chunk":
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":chunk", ev.Content)
			case "thought":
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":thought", ev.Content)
			case "tool_call":
				data, _ := json.Marshal(map[string]string{"tool": ev.Tool, "args": ev.Args})
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":tool", string(data))
			case "tool_result":
				data, _ := json.Marshal(map[string]string{"tool": ev.Tool, "result": ev.Result})
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":tool_result", string(data))
			case "done":
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":done", ev.Content)
			case "error":
				runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":error", ev.Content)
			}
		},
	})

	// Run agent in background context
	go func() {
		if err := agent.Run(context.Background(), userInput, streamID); err != nil {
			runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":error", err.Error())
		}
		// Save history
		a.aiMsgMu.Lock()
		a.aiMessages[streamID] = agent.GetHistory()
        a.saveConversations()
		a.aiMsgMu.Unlock()
	}()

	return nil
}

// getDeviceInfos returns connected device info for AI context
func (a *App) getDeviceInfos() []ai.DeviceInfo {
	a.connsMu.RLock()
	defer a.connsMu.RUnlock()
	var devices []ai.DeviceInfo
	for id, ac := range a.conns {
		if ac.Client.State().String() != "connected" {
			continue
		}
		d := ai.DeviceInfo{
			ConnID:   id,
			Host:     ac.DeviceHost,
			Port:     ac.DevicePort,
			Protocol: ac.DeviceProto,
			Username: ac.DeviceUser,
		}
		if ac.DeviceIdent != nil {
			d.Vendor = string(ac.DeviceIdent.DeviceInfo.Vendor)
			d.Model = ac.DeviceIdent.DeviceInfo.Model
			d.OS = string(ac.DeviceIdent.DeviceInfo.OS)
			d.OSVer = ac.DeviceIdent.DeviceInfo.OSVersion
			d.Hostname = ac.DeviceIdent.DeviceInfo.Hostname
		}
		devices = append(devices, d)
	}
	return devices
}

// initBuiltinTools registers all built-in tools
func initBuiltinTools(r *ai.ToolRegistry, ctx *ai.ToolContext) {
	// Device tools
	r.Register(&ai.Tool{
		Name:        "list_devices",
		Description: "列出当前所有已连接的设备，返回设备列表（连接ID、IP、端口、协议、厂商、型号等信息）",
		Parameters:  ai.Params(map[string]interface{}{}, []string{}),
		Handler: func(args map[string]interface{}) (string, error) {
			devices := ctx.GetConnections()
			if len(devices) == 0 {
				return "当前没有已连接的设备", nil
			}
			var lines []string
			lines = append(lines, fmt.Sprintf("共 %d 台设备已连接:\n", len(devices)))
			for i, d := range devices {
				info := fmt.Sprintf("%s:%d (%s)", d.Host, d.Port, strings.ToUpper(d.Protocol))
				if d.Vendor != "" {
					info += fmt.Sprintf(" [%s", d.Vendor)
					if d.Model != "" {
						info += " " + d.Model
					}
					info += "]"
				}
				lines = append(lines, fmt.Sprintf("  %d. connId=%s — %s", i+1, d.ConnID, info))
			}
			return strings.Join(lines, "\n"), nil
		},
	})

	// ── Read-only command ──
	r.Register(&ai.Tool{
		Name:        "send_command",
		Description: "发送只读查询命令到设备（show/display/ping/traceroute等）。只允许查询类命令。需要修改配置时请用send_config工具",
		Parameters: ai.Params(map[string]interface{}{
			"connId":  ai.StringParam("设备连接ID，从list_devices返回"),
			"command": ai.StringParam("只读查询命令，如 show version, display interface brief"),
		}, []string{"connId", "command"}),
		Handler: func(args map[string]interface{}) (string, error) {
			connID, _ := args["connId"].(string)
			cmd, _ := args["command"].(string)
			if !isReadOnly(cmd) {
				return "", fmt.Errorf("命令被阻止: 这是写命令。请用send_config工具，用户确认后才能执行")
			}
			result, err := ctx.SendCommand(connID, cmd+"\n")
			if err != nil { return "", err }
			return result, nil
		},
	})

	// ── Config command (needs user confirmation) ──
	r.Register(&ai.Tool{
		Name:        "send_config",
		Description: "生成配置命令，需要用户确认后才执行。当你需要修改设备配置时使用（VLAN、路由、接口、ACL等）。系统会弹出确认请求",
		Parameters: ai.Params(map[string]interface{}{
			"connId":      ai.StringParam("设备连接ID"),
			"commands":    ai.StringParam("配置命令，多行用\n分隔，如: interface Gi0/1\nswitchport access vlan 100"),
			"description": ai.StringParam("这些命令的作用说明，如: 将Gi0/1加入VLAN100"),
		}, []string{"connId", "commands", "description"}),
		Handler: func(args map[string]interface{}) (string, error) {
			connID, _ := args["connId"].(string)
			cmds, _ := args["commands"].(string)
			desc, _ := args["description"].(string)
			blocked := []string{"erase startup", "format ", "delete /recursive", "write erase", "reload", "reboot"}
			for _, b := range blocked {
				if strings.Contains(strings.ToLower(cmds), b) {
					return "", fmt.Errorf("高危命令永久阻止: %s", b)
				}
			}
			return fmt.Sprintf("⚠️ 需要确认!\n设备: %s\n说明: %s\n命令:\n%s\n\n请回复\"确认\"批准，回复\"取消\"拒绝", connID, desc, cmds), nil
		},
	})

	// ── Execute approved config ──
	r.Register(&ai.Tool{
		Name:        "execute_config",
			Description: "执行用户已批准的配置命令。仅在用户明确回复后使用",
		Parameters: ai.Params(map[string]interface{}{
			"connId":   ai.StringParam("设备连接ID"),
			"commands": ai.StringParam("已批准的配置命令"),
		}, []string{"connId", "commands"}),
		Handler: func(args map[string]interface{}) (string, error) {
			connID, _ := args["connId"].(string)
			cmds, _ := args["commands"].(string)
			var results []string
			for _, cmd := range strings.Split(cmds, "\n") {
				cmd = strings.TrimSpace(cmd)
				if cmd == "" { continue }
				if err := ctx.SendCommandDirect(connID, cmd+"\n"); err != nil {
					results = append(results, fmt.Sprintf("✗ %s → %v", cmd, err))
				} else {
					results = append(results, fmt.Sprintf("✓ %s → 已发送", cmd))
				}
			}
			time.Sleep(2 * time.Second)
			output := ctx.ReadBuffer(connID)
			return fmt.Sprintf("执行结果:\n%s\n\n终端输出:\n%s", strings.Join(results, "\n"), output), nil
		},
	})

	// ── Read buffer ──
	r.Register(&ai.Tool{
		Name:        "read_buffer",
		Description: "读取设备终端的当前输出",
		Parameters: ai.Params(map[string]interface{}{
			"connId": ai.StringParam("设备连接ID"),
		}, []string{"connId"}),
		Handler: func(args map[string]interface{}) (string, error) {
			connID, _ := args["connId"].(string)
			buf := ctx.ReadBuffer(connID)
			if buf == "" { return "缓冲区为空", nil }
			if len(buf) > 8000 { buf = "...\n" + buf[len(buf)-8000:] }
			return buf, nil
		},
	})

	// Knowledge tool
	r.Register(&ai.Tool{
		Name:        "search_knowledge",
		Description: "从知识库中搜索网络设备相关文档（配置指南、排障手册、命令参考等）",
		Parameters: ai.Params(map[string]interface{}{
			"query": ai.StringParam("搜索关键词"),
		}, []string{"query"}),
		Handler: func(args map[string]interface{}) (string, error) {
			query, _ := args["query"].(string)
			docs := ctx.SearchKnowledge(query, 3)
			if len(docs) == 0 {
				return "未找到相关文档。请使用网络知识回答", nil
			}
			var parts []string
			for i, doc := range docs {
				parts = append(parts, fmt.Sprintf("--- 文档%d: %s ---\n%s", i+1, doc.Title, doc.Content))
			}
			return strings.Join(parts, "\n\n"), nil
		},
	})

	// Skill tool
	r.Register(&ai.Tool{
		Name:        "list_skills",
		Description: "列出所有可用的技能角色（如思科专家、华为专家、排障专家等）",
		Parameters:  ai.Params(map[string]interface{}{}, []string{}),
		Handler: func(args map[string]interface{}) (string, error) {
			skills := ctx.ListSkills()
			if len(skills) == 0 {
				return "当前没有可用的技能", nil
			}
			return "可用技能: " + strings.Join(skills, ", "), nil
		},
	})
}

// --- Skill Management ---

func (a *App) ListSkills() ([]*skill.Skill, error) {
    if a.skillManager == nil {
        return nil, fmt.Errorf("skill manager not initialized")
    }
    return a.skillManager.List(), nil
}

func (a *App) GetDeviceInfo(connID string) (device.DeviceInfo, error) {
    a.connsMu.RLock()
    ac := a.conns[connID]
    a.connsMu.RUnlock()
    if ac == nil || ac.DeviceIdent == nil {
        return device.DeviceInfo{}, fmt.Errorf("no device info for %s", connID)
    }
    return ac.DeviceIdent.DeviceInfo, nil
}

func (a *App) DeviceDetected(connID string, info device.DeviceInfo) {
    runtime.EventsEmit(a.ctx, "conn:"+connID+":device", info)
}

// seedRAGKnowledge populates the knowledge base with network device command references
func (a *App) seedRAGKnowledge() {
    existing := a.aiRAG.Search("show version display device", 1)
    if len(existing) > 0 {
        return // already seeded
    }
    seeds := []ai.RAGDocument{
        {ID: "cisco-common", Title: "Cisco IOS 常用命令", Tags: []string{"cisco", "ios", "命令"}, Content: "show version — 查看版本和型号\nshow running-config — 查看运行配置\nshow interfaces status — 接口状态总览\nshow ip interface brief — IP接口摘要\nshow vlan brief — VLAN摘要\nshow mac address-table — MAC地址表\nshow cdp neighbors — CDP邻居\nshow logging — 系统日志\nshow processes cpu — CPU使用率\nshow memory — 内存使用\nping — 连通性测试\ntraceroute — 路由追踪"},
        {ID: "huawei-common", Title: "Huawei VRP 常用命令", Tags: []string{"huawei", "vrp", "命令"}, Content: "display version — 查看版本\ndisplay current-configuration — 运行配置\ndisplay interface brief — 接口摘要\ndisplay ip interface brief — IP接口\ndisplay vlan — VLAN信息\ndisplay mac-address — MAC地址表\ndisplay lldp neighbor — LLDP邻居\ndisplay logbuffer — 日志\ndisplay cpu-usage — CPU使用率\ndisplay memory-usage — 内存使用"},
        {ID: "troubleshoot-l2", Title: "二层网络排障指南", Tags: []string{"排障", "二层", "VLAN", "STP"}, Content: "1. 检查接口状态 show interfaces status\n2. 检查VLAN配置 show vlan\n3. 检查STP状态 show spanning-tree\n4. 检查MAC表 show mac address-table\n5. 检查CDP/LLDP邻居 show cdp neighbors\n常见问题: VLAN不匹配导致不通、STP阻塞端口、双工不匹配、Native VLAN错误"},
        {ID: "troubleshoot-l3", Title: "三层网络排障指南", Tags: []string{"排障", "三层", "路由", "OSPF", "BGP"}, Content: "1. 检查路由表 show ip route\n2. 检查OSPF邻居 show ip ospf neighbor\n3. 检查BGP邻居 show ip bgp summary\n4. 检查接口IP show ip interface brief\n5. Ping测试连通性\n常见问题: 路由缺失、邻居不建立、ACL阻断、MTU不匹配"},
        {ID: "security-acl", Title: "ACL和安全配置", Tags: []string{"安全", "ACL", "防火墙"}, Content: "Cisco: show access-lists\nHuawei: display acl all\n配置ACL: ip access-list extended NAME / acl number 3000\n应用到接口: ip access-group NAME in/out\n常见问题: ACL顺序错误、方向搞反、隐式deny"},
    }
    for _, doc := range seeds {
        a.aiRAG.Index(doc)
    }
}

// ImportKnowledge allows frontend to add knowledge documents
func (a *App) ImportKnowledge(title, content, tags string) error {
    id := uuid.New().String()
    tagList := []string{}
    for _, t := range strings.Split(tags, ",") {
        t = strings.TrimSpace(t)
        if t != "" {
            tagList = append(tagList, t)
        }
    }
    a.aiRAG.Index(ai.RAGDocument{ID: id, Title: title, Content: content, Tags: tagList})
    return nil
}

// SearchKnowledge searches the knowledge base
func (a *App) SearchKnowledge(query string) []ai.RAGDocument {
    return a.aiRAG.Search(query, 5)
}

// ── Conversation Persistence ──

func (a *App) loadConversations(dataDir string) {
    convPath := filepath.Join(dataDir, "ai-conversations.json")
    data, err := os.ReadFile(convPath)
    if err != nil {
        return
    }
    json.Unmarshal(data, &a.aiMessages)
}

func (a *App) saveConversations() {
    if a.store == nil {
        return
    }
    dataDir, _ := config.DataDir()
    if dataDir == "" {
        return
    }
    a.aiMsgMu.Lock()
    data, _ := json.Marshal(a.aiMessages)
    a.aiMsgMu.Unlock()
    os.WriteFile(filepath.Join(dataDir, "ai-conversations.json"), data, 0644)
}

// ── Multimodal Support ──

// AIChatWithImage supports image+text multimodal input (GPT-4V, Claude)
func (a *App) AIChatWithImage(streamID string, text string, imageBase64 string, imageType string, cfg ai.ClientConfig) error {
    if a.aiToolRegistry == nil {
        a.initAITools()
    }
    // Build multimodal user message
    userMsg := map[string]interface{}{
        "role": "user",
        "content": []map[string]interface{}{
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": map[string]string{"url": "data:image/" + imageType + ";base64," + imageBase64}},
        },
    }
    // Fallback: if model doesn't support images, send text only
    _ = userMsg
    // For now DeepSeek V4 doesn't support images — return not-supported
    runtime.EventsEmit(a.ctx, "ai:stream:"+streamID+":error", "多模态需要GPT-4V/Claude模型支持，DeepSeek V4暂不支持图片输入")
    return nil
}

// isReadOnly checks if a command is safe to execute without confirmation
func isReadOnly(cmd string) bool {
	lower := strings.ToLower(cmd)
	// Whitelist: commands that start with these prefixes
	readPrefixes := []string{
		"show ", "display ", "ping ", "traceroute ", "tracert ",
		"dir ", "ls ", "pwd", "cat ", "more ", "head ", "tail ",
		"get ", "getv ", "snmpget", "snmpwalk",
		"terminal length", "terminal width",
	}
	for _, p := range readPrefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	// Multi-command: all parts must be readonly
	parts := strings.Split(cmd, "\n")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" { continue }
		pLower := strings.ToLower(part)
		ok := false
		for _, p := range readPrefixes {
			if strings.HasPrefix(pLower, p) {
				ok = true
				break
			}
		}
		if !ok { return false }
	}
	return false
}

// ── RAG Knowledge Management ──

// ListKnowledge returns all indexed documents
func (a *App) ListKnowledge() []ai.RAGDocument {
    return a.aiRAG.Search("", 50)
}

// DeleteKnowledge removes a document from the knowledge base
func (a *App) DeleteKnowledge(id string) error {
    return a.aiRAG.Delete(id)
}

// ── Skill CRUD ──

// GetSkillDetail returns a skill's full definition as JSON string
func (a *App) GetSkillDetail(skillID string) (string, error) {
    sd, err := a.aiSkillLoader.Get(skillID)
    if err != nil {
        return "", err
    }
    data, _ := json.Marshal(sd)
    return string(data), nil
}

// SaveSkill saves a skill definition (create or update) and writes the YAML file
func (a *App) SaveSkill(skillID, name, description, prompt, yamlContent string) error {
    dataDir, _ := config.DataDir()
    skillsDir := filepath.Join(dataDir, "ai-skills")
    os.MkdirAll(skillsDir, 0755)
    path := filepath.Join(skillsDir, skillID+".yaml")
    if yamlContent == "" {
        yamlContent = "id: " + skillID + "\nname: " + name + "\ndescription: " + description + "\nprompt: |\n  " + strings.ReplaceAll(prompt, "\n", "\n  ") + "\n"
    }
    if err := os.WriteFile(path, []byte(yamlContent), 0644); err != nil {
        return err
    }
    // Reload
    a.aiSkillLoader.LoadAll(skillsDir)
    return nil
}

// DeleteSkill removes a skill YAML file
func (a *App) DeleteSkill(skillID string) error {
    dataDir, _ := config.DataDir()
    path := filepath.Join(dataDir, "ai-skills", skillID+".yaml")
    return os.Remove(path)
}
