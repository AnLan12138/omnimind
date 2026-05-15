package session

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"omnimind/internal/protocol"

	"github.com/google/uuid"
)

// ParseSSHConfig parses an OpenSSH config file and returns sessions.
func ParseSSHConfig(path string) ([]Session, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open ssh config: %w", err)
	}
	defer f.Close()

	var sessions []Session
	var current Session
	scanner := bufio.NewScanner(f)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		key := strings.ToLower(fields[0])
		value := strings.Join(fields[1:], " ")

		switch key {
		case "host":
			if current.Name != "" {
				sessions = append(sessions, current)
			}
			// Remove wildcard patterns
			name := value
			name = strings.ReplaceAll(name, "*", "")
			name = strings.ReplaceAll(name, "?", "")
			name = strings.TrimSpace(name)
			current = Session{
				ID:       uuid.New().String(),
				Name:     name,
				Protocol: "ssh",
				Port:     22,
			}
		case "hostname":
			current.Host = value
		case "port":
			fmt.Sscanf(value, "%d", &current.Port)
		case "user":
			current.Username = value
		case "identityfile":
			current.PrivateKeyPath = expandPath(value)
		case "proxyjump":
			current.ProxyJump = value
		case "serveraliveinterval":
			fmt.Sscanf(value, "%d", &current.KeepAliveSec)
		}
	}

	if current.Name != "" {
		sessions = append(sessions, current)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}

// ParseMobaXtermSessions parses a MobaXterm sessions file.
// MobaXterm stores sessions in .ini format per session in MobaXterm/
func ParseMobaXtermSessions(path string) ([]Session, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read mobaxterm file: %w", err)
	}

	var sessions []Session
	lines := strings.Split(string(data), "\n")
	var current Session

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}

		if strings.HasPrefix(line, "[") {
			if current.Name != "" {
				sessions = append(sessions, current)
			}
			name := strings.Trim(line, "[]")
			current = Session{
				ID:       uuid.New().String(),
				Name:     name,
				Protocol: "ssh",
				Port:     22,
			}
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		switch key {
		case "Host":
			current.Host = value
		case "Port":
			fmt.Sscanf(value, "%d", &current.Port)
		case "UserName", "User":
			current.Username = value
		case "Protocol":
			current.Protocol = protocol.ProtoType(strings.ToLower(value))
		}
	}

	if current.Name != "" {
		sessions = append(sessions, current)
	}

	return sessions, nil
}

func expandPath(path string) string {
	if strings.HasPrefix(path, "~") {
		home, _ := os.UserHomeDir()
		return strings.Replace(path, "~", home, 1)
	}
	return path
}
