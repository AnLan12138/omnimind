package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"omniterm/internal/config"
	"omniterm/internal/filetransfer"
	"omniterm/internal/protocol"
	"omniterm/internal/protocol/serial"
	ftpclient "omniterm/internal/protocol/ftp"
	sshclient "omniterm/internal/protocol/ssh"
	telnetclient "omniterm/internal/protocol/telnet"
	rdpclient "omniterm/internal/protocol/rdp"
	moshclient "omniterm/internal/protocol/mosh"
	vncclient "omniterm/internal/protocol/vnc"
	"omniterm/internal/session"
)

type ActiveConn struct {
	ID       string
	Client   protocol.ProtocolClient
	SFTP     *filetransfer.SFTPClient
	Recorder *filetransfer.Recorder
	Ctx      context.Context
	Cancel   context.CancelFunc
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
		keyPath = home + "/.ssh/id_ed25519_omniterm"
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

	// Set up callbacks to push events to frontend
	client.OnData(func(data []byte) {
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
	if err := client.Connect(ctx, cfg); err != nil {
		cancel()
		return err
	}

	a.connsMu.Lock()
	a.conns[connID] = &ActiveConn{
		ID:     connID,
		Client: client,
		Ctx:    ctx,
		Cancel: cancel,
	}
	a.connsMu.Unlock()

	return nil
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
		BaudRate:       sess.BaudRate,
		DataBits:       sess.DataBits,
		StopBits:       sess.StopBits,
		Parity:         sess.Parity,
		FlowControl:    sess.FlowControl,
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

// --- SSH Tunnels ---

func (a *App) StartLocalForward(connID string, localPort int, remoteHost string, remotePort int) error {
	ac := a.getConn(connID)
	if ac == nil {
		return fmt.Errorf("connection not found")
	}
	sshClient, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("tunnels only for SSH connections")
	}
	return sshClient.StartLocalForward(localPort, remoteHost, remotePort)
}

func (a *App) StartRemoteForward(connID string, remotePort int, localHost string, localPort int) error {
	ac := a.getConn(connID)
	if ac == nil {
		return fmt.Errorf("connection not found")
	}
	sshClient, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("tunnels only for SSH connections")
	}
	return sshClient.StartRemoteForward(remotePort, localHost, localPort)
}

func (a *App) StartSOCKS5Proxy(connID string, port int) error {
	ac := a.getConn(connID)
	if ac == nil {
		return fmt.Errorf("connection not found")
	}
	sshClient, ok := ac.Client.(*sshclient.Client)
	if !ok {
		return fmt.Errorf("tunnels only for SSH connections")
	}
	return sshClient.StartSOCKS5(port)
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
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return nil, fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.ListDir(path)
}

func (a *App) SFTPDownload(connID string, remotePath string, localPath string) error {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.Download(remotePath, localPath, nil)
}

func (a *App) SFTPUpload(connID string, localPath string, remotePath string) error {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.Upload(localPath, remotePath, nil)
}

func (a *App) SFTPMkdir(connID string, path string) error {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.Mkdir(path)
}

func (a *App) SFTPRemove(connID string, path string) error {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.Remove(path)
}

func (a *App) SFTPRename(connID string, oldPath string, newPath string) error {
	ac := a.getSFTPConn(connID)
	if ac == nil {
		return fmt.Errorf("SFTP not open")
	}
	return ac.SFTP.Rename(oldPath, newPath)
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

// --- Utility ---

func (a *App) ListSerialPorts() ([]string, error) {
	return serial.ListPorts()
}

func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}
