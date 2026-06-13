//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// winSaveFileDialog stub for non-Windows platforms.
// On macOS/Linux, falls back to saving in the current directory.
func winSaveFileDialog(title, defaultFilename, filter string, filterIndex uint32) (string, error) {
	// Try to use home directory as save location
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	savePath := filepath.Join(home, defaultFilename)

	// Check if file exists
	if _, err := os.Stat(savePath); err == nil {
		return "", fmt.Errorf("file already exists: %s", savePath)
	}

	return savePath, nil
}
