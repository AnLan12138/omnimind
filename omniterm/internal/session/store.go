package session

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
	"golang.org/x/crypto/pbkdf2"

	"omnimind/internal/protocol"
)

type Session struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Protocol         protocol.ProtoType `json:"protocol"`
	Host             string           `json:"host"`
	Port             int              `json:"port"`
	Username         string           `json:"username,omitempty"`
	Password         string           `json:"password,omitempty"` // stored encrypted
	PrivateKeyPath   string           `json:"privateKeyPath,omitempty"`
	UseAgent         bool             `json:"useAgent,omitempty"`
	ProxyJump        string           `json:"proxyJump,omitempty"`
	KeepAliveSec     int              `json:"keepAliveSec,omitempty"`
	TelnetTermType   string           `json:"telnetTermType,omitempty"`
	TermType         string           `json:"termType,omitempty"` // xterm-256color, vt100, etc.
	UseTLS           bool             `json:"useTLS,omitempty"`
	TLSSkipVerify    bool             `json:"tlsSkipVerify,omitempty"`
	UseFTPS          string           `json:"useFTPS,omitempty"`
	BaudRate         int              `json:"baudRate,omitempty"`
	DataBits         int              `json:"dataBits,omitempty"`
	StopBits         float64          `json:"stopBits,omitempty"`
	Parity           string           `json:"parity,omitempty"`
	FlowControl      string           `json:"flowControl,omitempty"`
	FolderID         string           `json:"folderId,omitempty"`
	SortOrder        int              `json:"sortOrder"`
	ColorLabel       string           `json:"colorLabel,omitempty"`
	Notes            string           `json:"notes,omitempty"`
	CreatedAt        string           `json:"createdAt"`
	UpdatedAt        string           `json:"updatedAt"`
}

type Folder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parentId,omitempty"`
	SortOrder int    `json:"sortOrder"`
}

type Store struct {
	db          *sql.DB
	mu          sync.RWMutex
	masterKey   []byte
	dataDir     string
}

func NewStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	dbPath := filepath.Join(dataDir, "omnimind.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	s := &Store{db: db, dataDir: dataDir}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) SetMasterPassword(password string) {
	s.masterKey = pbkdf2.Key([]byte(password), []byte("omnimind-salt-2024"), 600000, 32, sha256.New)
}

func (s *Store) ListSessions() ([]Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`SELECT id, name, protocol, host, port, username,
		encrypted_password, private_key_path, use_agent, proxy_jump, keepalive_sec,
		telnet_term_type, term_type, use_tls, tls_skip_verify, use_ftps, baud_rate, data_bits, stop_bits, parity, flow_control,
		folder_id, sort_order, color_label, notes, created_at, updated_at
		FROM sessions ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]Session, 0)
	for rows.Next() {
		var sess Session
		var encPwd sql.NullString
		err := rows.Scan(&sess.ID, &sess.Name, &sess.Protocol, &sess.Host, &sess.Port, &sess.Username,
			&encPwd, &sess.PrivateKeyPath, &sess.UseAgent, &sess.ProxyJump, &sess.KeepAliveSec,
			&sess.TelnetTermType, &sess.TermType, &sess.UseTLS, &sess.TLSSkipVerify, &sess.UseFTPS, &sess.BaudRate, &sess.DataBits, &sess.StopBits, &sess.Parity, &sess.FlowControl,
			&sess.FolderID, &sess.SortOrder, &sess.ColorLabel, &sess.Notes, &sess.CreatedAt, &sess.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if encPwd.Valid {
			sess.Password = s.decryptPassword(encPwd.String)
		}
		sessions = append(sessions, sess)
	}
	return sessions, nil
}

func (s *Store) SaveSession(sess *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var encPwd string
	if sess.Password != "" {
		encPwd = s.encryptPassword(sess.Password)
	}

	_, err := s.db.Exec(`INSERT OR REPLACE INTO sessions
		(id, name, protocol, host, port, username, encrypted_password,
		 private_key_path, use_agent, proxy_jump, keepalive_sec,
		 telnet_term_type, term_type, use_tls, tls_skip_verify, use_ftps, baud_rate, data_bits, stop_bits, parity, flow_control,
		 folder_id, sort_order, color_label, notes, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		sess.ID, sess.Name, sess.Protocol, sess.Host, sess.Port, sess.Username, encPwd,
		sess.PrivateKeyPath, sess.UseAgent, sess.ProxyJump, sess.KeepAliveSec,
		sess.TelnetTermType, sess.TermType, sess.UseTLS, sess.TLSSkipVerify, sess.UseFTPS, sess.BaudRate, sess.DataBits, sess.StopBits, sess.Parity, sess.FlowControl,
		sess.FolderID, sess.SortOrder, sess.ColorLabel, sess.Notes)
	return err
}

func (s *Store) DeleteSession(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec("DELETE FROM sessions WHERE id = ?", id)
	return err
}

func (s *Store) ListFolders() ([]Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query("SELECT id, name, parent_id, sort_order FROM folders ORDER BY sort_order, name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.SortOrder); err != nil {
			return nil, err
		}
		folders = append(folders, f)
	}
	return folders, nil
}

func (s *Store) SaveFolder(folder *Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT OR REPLACE INTO folders (id, name, parent_id, sort_order)
		VALUES (?, ?, ?, ?)`, folder.ID, folder.Name, folder.ParentID, folder.SortOrder)
	return err
}

func (s *Store) DeleteFolder(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec("DELETE FROM folders WHERE id = ?", id)
	return err
}

// Import/Export
func (s *Store) ExportSessions(filePath string) error {
	sessions, err := s.ListSessions()
	if err != nil {
		return err
	}
	folders, err := s.ListFolders()
	if err != nil {
		return err
	}

	data := struct {
		Sessions []Session `json:"sessions"`
		Folders  []Folder  `json:"folders"`
	}{sessions, folders}

	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, b, 0600)
}

func (s *Store) ImportSessions(filePath string) (int, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return 0, err
	}
	var imp struct {
		Sessions []Session `json:"sessions"`
		Folders  []Folder  `json:"folders"`
	}
	if err := json.Unmarshal(data, &imp); err != nil {
		return 0, err
	}

	for _, f := range imp.Folders {
		s.SaveFolder(&f)
	}
	count := 0
	for _, sess := range imp.Sessions {
		if err := s.SaveSession(&sess); err == nil {
			count++
		}
	}
	return count, nil
}

// --- private ---

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			protocol TEXT NOT NULL DEFAULT 'ssh',
			host TEXT NOT NULL DEFAULT '',
			port INTEGER NOT NULL DEFAULT 22,
			username TEXT DEFAULT '',
			encrypted_password TEXT DEFAULT '',
			private_key_path TEXT DEFAULT '',
			use_agent INTEGER DEFAULT 0,
			proxy_jump TEXT DEFAULT '',
			keepalive_sec INTEGER DEFAULT 30,
			telnet_term_type TEXT DEFAULT '',
			baud_rate INTEGER DEFAULT 115200,
			data_bits INTEGER DEFAULT 8,
			stop_bits REAL DEFAULT 1.0,
			parity TEXT DEFAULT 'none',
			flow_control TEXT DEFAULT 'none',
			folder_id TEXT DEFAULT '',
			sort_order INTEGER DEFAULT 0,
			color_label TEXT DEFAULT '',
			notes TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS folders (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			parent_id TEXT DEFAULT '',
			sort_order INTEGER DEFAULT 0
		);
	`)
	if err != nil {
		return err
	}
	// Add new columns for TLS/FTPS (ignore errors if already exist)
s.db.Exec(`ALTER TABLE sessions ADD COLUMN term_type TEXT DEFAULT ''`)
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN use_tls INTEGER DEFAULT 0`)
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN tls_skip_verify INTEGER DEFAULT 0`)
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN use_ftps TEXT DEFAULT ''`)
	return nil
}

func (s *Store) encryptPassword(plaintext string) string {
	if len(s.masterKey) == 0 {
		// No master password set - store as base64 (not secure, just obfuscation)
		return base64.StdEncoding.EncodeToString([]byte(plaintext))
	}

	block, err := aes.NewCipher(s.masterKey)
	if err != nil {
		return base64.StdEncoding.EncodeToString([]byte(plaintext))
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return base64.StdEncoding.EncodeToString([]byte(plaintext))
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return base64.StdEncoding.EncodeToString([]byte(plaintext))
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext)
}

func (s *Store) decryptPassword(encoded string) string {
	if len(s.masterKey) == 0 {
		dec, _ := base64.StdEncoding.DecodeString(encoded)
		return string(dec)
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}

	block, err := aes.NewCipher(s.masterKey)
	if err != nil {
		return ""
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return ""
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return ""
	}
	return string(plaintext)
}
