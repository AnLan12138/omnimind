package filetransfer

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ResumeInfo stores the state needed to resume an interrupted transfer.
type ResumeInfo struct {
	TaskID       string `json:"taskId"`
	LocalPath    string `json:"localPath"`
	RemotePath   string `json:"remotePath"`
	Direction    string `json:"direction"`
	Offset       int64  `json:"offset"`
	TotalBytes   int64  `json:"totalBytes,omitempty"`
	ChunkSize    int64  `json:"chunkSize"`
}

// SaveResumeState persists transfer progress to a JSON file.
func SaveResumeState(dataDir string, info *ResumeInfo) error {
	path := filepath.Join(dataDir, "transfer_queue.json")
	var queue []*ResumeInfo
	data, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(data, &queue)
	}
	found := false
	for i, r := range queue {
		if r.TaskID == info.TaskID {
			queue[i] = info
			found = true
			break
		}
	}
	if !found {
		queue = append(queue, info)
	}
	b, err := json.MarshalIndent(queue, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}

// LoadResumeState reads persisted transfer progress.
func LoadResumeState(dataDir string) ([]*ResumeInfo, error) {
	path := filepath.Join(dataDir, "transfer_queue.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var queue []*ResumeInfo
	if err := json.Unmarshal(data, &queue); err != nil {
		return nil, err
	}
	return queue, nil
}

// ClearResumeState removes a completed transfer's progress.
func ClearResumeState(dataDir, taskID string) error {
	path := filepath.Join(dataDir, "transfer_queue.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var queue []*ResumeInfo
	if err := json.Unmarshal(data, &queue); err != nil {
		return err
	}
	var filtered []*ResumeInfo
	for _, r := range queue {
		if r.TaskID != taskID {
			filtered = append(filtered, r)
		}
	}
	b, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0644)
}
