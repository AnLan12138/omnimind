package sync

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const apiBase = "https://api.github.com"

// GistFile represents a file in a GitHub Gist.
type GistFile struct {
	Content string `json:"content,omitempty"`
}

// Gist represents a GitHub Gist.
type Gist struct {
	ID          string               `json:"id,omitempty"`
	Description string               `json:"description"`
	Public      bool                 `json:"public"`
	Files       map[string]*GistFile `json:"files,omitempty"`
	UpdatedAt   string               `json:"updated_at,omitempty"`
}

// SyncData bundles all syncable application data.
type SyncData struct {
	Timestamp   string `json:"timestamp"`
	Version     string `json:"version"`
	Sessions    string `json:"sessions"`    // JSON array of sessions
	Folders     string `json:"folders"`     // JSON array of folders
	Macros      string `json:"macros"`      // JSON string from localStorage
	Settings    string `json:"settings"`    // JSON string from localStorage
	Devices     string `json:"devices"`     // JSON string from localStorage
}

// PushToGist pushes data to a GitHub Gist. Creates a new gist if gistID is empty.
func PushToGist(token string, gistID string, data *SyncData) (string, error) {
	data.Timestamp = time.Now().UTC().Format(time.RFC3339)
	data.Version = "0.2.0"

	body, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	b64 := base64.StdEncoding.EncodeToString(body)

	gist := &Gist{
		Description: "OmniMind sync data",
		Public:      false,
		Files: map[string]*GistFile{
			"omnimind-sync.json": {Content: string(body)},
		},
	}

	var req *http.Request
	if gistID != "" {
		// Update existing gist
		gistBody, _ := json.Marshal(gist)
		req, err = http.NewRequest("PATCH", apiBase+"/gists/"+gistID, bytes.NewReader(gistBody))
	} else {
		// Create new gist
		gistBody, _ := json.Marshal(gist)
		req, err = http.NewRequest("POST", apiBase+"/gists", bytes.NewReader(gistBody))
	}
	if err != nil {
		return "", err
	}

	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("github api: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	_ = b64

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("github api %d: %s", resp.StatusCode, string(respBody))
	}

	var result Gist
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}

	return result.ID, nil
}

// PullFromGist fetches sync data from a GitHub Gist.
func PullFromGist(token string, gistID string) (*SyncData, error) {
	req, err := http.NewRequest("GET", apiBase+"/gists/"+gistID, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github api: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("gist not found: %s", gistID)
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("github api %d: %s", resp.StatusCode, string(body))
	}

	var gist Gist
	if err := json.NewDecoder(resp.Body).Decode(&gist); err != nil {
		return nil, fmt.Errorf("parse gist: %w", err)
	}

	file, ok := gist.Files["omnimind-sync.json"]
	if !ok {
		return nil, fmt.Errorf("omnimind-sync.json not found in gist")
	}

	var data SyncData
	if err := json.Unmarshal([]byte(file.Content), &data); err != nil {
		return nil, fmt.Errorf("parse sync data: %w", err)
	}

	return &data, nil
}
