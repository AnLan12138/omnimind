package config

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const (
	updateURL     = "https://api.github.com/repos/AnLan12138/omnimind/releases/latest"
	updateTimeout = 15 * time.Second
)

type ReleaseAsset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"browser_download_url"`
	Size        int64  `json:"size"`
}

type ReleaseInfo struct {
	TagName string         `json:"tag_name"`
	Name    string         `json:"name"`
	Body    string         `json:"body"`
	Assets  []ReleaseAsset `json:"assets"`
}

type UpdateChecker struct {
	CurrentVersion string
	HTTPClient     *http.Client
}

func NewUpdateChecker(currentVersion string) *UpdateChecker {
	return &UpdateChecker{
		CurrentVersion: currentVersion,
		HTTPClient:     &http.Client{Timeout: updateTimeout},
	}
}

func (u *UpdateChecker) CheckForUpdate() (*ReleaseInfo, error) {
	req, err := http.NewRequest("GET", updateURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "OmniMind-UpdateChecker/1.0")

	resp, err := u.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	var release ReleaseInfo
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	if release.TagName == u.CurrentVersion || release.TagName == "v"+u.CurrentVersion {
		return nil, nil // no update
	}

	return &release, nil
}

func (u *UpdateChecker) DownloadAndReplace(assetURL, targetPath string) error {
	// Download to temp file
	tmpPath := targetPath + ".tmp"
	resp, err := u.HTTPClient.Get(assetURL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	f, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}

	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write: %w", err)
	}
	f.Close()

	// On Windows, rename current exe to .old, move new exe in place
	bakPath := targetPath + ".old"
	os.Remove(bakPath)
	if err := os.Rename(targetPath, bakPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("backup: %w", err)
	}
	if err := os.Rename(tmpPath, targetPath); err != nil {
		os.Rename(bakPath, targetPath) // restore
		os.Remove(tmpPath)
		return fmt.Errorf("replace: %w", err)
	}

	os.Remove(bakPath) // clean up backup
	return nil
}

func GetAssetForPlatform(assets []ReleaseAsset) *ReleaseAsset {
	suffix := fmt.Sprintf("-%s-%s.exe", runtime.GOOS, runtime.GOARCH)
	for _, a := range assets {
		if filepath.Ext(a.Name) == ".exe" && (contains(a.Name, suffix) || contains(a.Name, runtime.GOOS)) {
			return &a
		}
	}
	// Fallback: first .exe
	for _, a := range assets {
		if filepath.Ext(a.Name) == ".exe" {
			return &a
		}
	}
	return nil
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && s[len(s)-len(substr):] == substr
}
