package protocol

import "context"

type ProtoType string

const (
	ProtoSSH    ProtoType = "ssh"
	ProtoTelnet ProtoType = "telnet"
	ProtoRDP    ProtoType = "rdp"
	ProtoVNC    ProtoType = "vnc"
	ProtoFTP    ProtoType = "ftp"
	ProtoSFTP   ProtoType = "sftp"
	ProtoMOSH   ProtoType = "mosh"
	ProtoSerial ProtoType = "serial"
)

type ConnState int

const (
	StateDisconnected ConnState = iota
	StateConnecting
	StateConnected
	StateReconnecting
	StateError
)

func (s ConnState) String() string {
	switch s {
	case StateDisconnected:
		return "disconnected"
	case StateConnecting:
		return "connecting"
	case StateConnected:
		return "connected"
	case StateReconnecting:
		return "reconnecting"
	case StateError:
		return "error"
	default:
		return "unknown"
	}
}

type Features struct {
	SupportsSFTP      bool
	SupportsClipboard bool
	SupportsResize    bool
	SupportsRecording bool
	SupportsFilePanel bool
	TerminalType      string // "pty" | "canvas" | "none"
}

type ConnConfig struct {
	Type     ProtoType `json:"type"`
	Host     string    `json:"host"`
	Port     int       `json:"port"`
	Username string    `json:"username,omitempty"`
	Password string    `json:"password,omitempty"`
	// SSH
	PrivateKeyPath  string `json:"privateKeyPath,omitempty"`
	UseAgent        bool   `json:"useAgent,omitempty"`
	ProxyJump       string `json:"proxyJump,omitempty"`
	KeepAliveSec    int    `json:"keepAliveSec,omitempty"`
	// Telnet
	TelnetTermType string `json:"telnetTermType,omitempty"`
	UseTLS        bool   `json:"useTLS,omitempty"`
	TLSSkipVerify bool   `json:"tlsSkipVerify,omitempty"`
	// FTP
	UseFTPS  string `json:"useFTPS,omitempty"` // "" | "explicit" | "implicit"
	// Serial
	BaudRate   int    `json:"baudRate,omitempty"`
	DataBits   int    `json:"dataBits,omitempty"`
	StopBits   float64 `json:"stopBits,omitempty"`
	Parity     string `json:"parity,omitempty"`
	FlowControl string `json:"flowControl,omitempty"`
	// General
	TermType string `json:"termType,omitempty"` // xterm-256color, vt100, etc.
	Rows     int    `json:"rows"`
	Cols     int    `json:"cols"`
}

type DataCallback func(data []byte)
type StateCallback func(state ConnState)
type ErrorCallback func(err error)

type ProtocolClient interface {
	Connect(ctx context.Context, cfg ConnConfig) error
	Disconnect() error

	Send(data []byte) error
	Resize(rows, cols int) error

	State() ConnState
	Features() Features

	OnData(cb DataCallback)
	OnState(cb StateCallback)
	OnError(cb ErrorCallback)
}
