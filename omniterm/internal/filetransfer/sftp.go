package filetransfer

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	ModTime string `json:"modTime"`
	Perm    string `json:"perm"`
}

type TransferProgress struct {
	Path       string `json:"path"`
	Total      int64  `json:"total"`
	Transferred int64  `json:"transferred"`
	Done       bool   `json:"done"`
	Error      string `json:"error,omitempty"`
}

type SFTPClient struct {
	client *sftp.Client
}

func NewSFTPClient(sshClient *ssh.Client) (*SFTPClient, error) {
	client, err := sftp.NewClient(sshClient)
	if err != nil {
		return nil, fmt.Errorf("sftp init: %w", err)
	}
	return &SFTPClient{client: client}, nil
}

func (s *SFTPClient) Close() error {
	return s.client.Close()
}

func (s *SFTPClient) ListDir(path string) ([]FileInfo, error) {
	if path == "" {
		path = "."
	}

	entries, err := s.client.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	var files []FileInfo
	for _, e := range entries {
		files = append(files, FileInfo{
			Name:    e.Name(),
			Path:    filepath.ToSlash(filepath.Join(path, e.Name())),
			Size:    e.Size(),
			IsDir:   e.IsDir(),
			ModTime: e.ModTime().Format(time.RFC3339),
			Perm:    e.Mode().String(),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	return files, nil
}

func (s *SFTPClient) Stat(path string) (FileInfo, error) {
	info, err := s.client.Stat(path)
	if err != nil {
		return FileInfo{}, err
	}
	return FileInfo{
		Name:    info.Name(),
		Path:    path,
		Size:    info.Size(),
		IsDir:   info.IsDir(),
		ModTime: info.ModTime().Format(time.RFC3339),
		Perm:    info.Mode().String(),
	}, nil
}

func (s *SFTPClient) Download(remotePath, localPath string, progressFn func(TransferProgress)) error {
	remoteFile, err := s.client.Open(remotePath)
	if err != nil {
		return fmt.Errorf("open remote: %w", err)
	}
	defer remoteFile.Close()

	remoteInfo, _ := remoteFile.Stat()

	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("create local: %w", err)
	}
	defer localFile.Close()

	total := remoteInfo.Size()
	var transferred int64
	buf := make([]byte, 32*1024)

	for {
		n, err := remoteFile.Read(buf)
		if n > 0 {
			if _, werr := localFile.Write(buf[:n]); werr != nil {
				return werr
			}
			transferred += int64(n)
			if progressFn != nil {
				progressFn(TransferProgress{
					Path:        remotePath,
					Total:       total,
					Transferred: transferred,
					Done:        transferred >= total,
				})
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
	}
	return nil
}

func (s *SFTPClient) Upload(localPath, remotePath string, progressFn func(TransferProgress)) error {
	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local: %w", err)
	}
	defer localFile.Close()

	localInfo, _ := localFile.Stat()

	remoteDir := filepath.ToSlash(filepath.Dir(remotePath))
	if remoteDir != "." && remoteDir != "/" {
		s.client.MkdirAll(remoteDir)
	}

	remoteFile, err := s.client.Create(remotePath)
	if err != nil {
		return fmt.Errorf("create remote: %w", err)
	}
	defer remoteFile.Close()

	total := localInfo.Size()
	var transferred int64
	buf := make([]byte, 32*1024)

	for {
		n, err := localFile.Read(buf)
		if n > 0 {
			if _, werr := remoteFile.Write(buf[:n]); werr != nil {
				return werr
			}
			transferred += int64(n)
			if progressFn != nil {
				progressFn(TransferProgress{
					Path:        localPath,
					Total:       total,
					Transferred: transferred,
					Done:        transferred >= total,
				})
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
	}
	return nil
}

func (s *SFTPClient) Mkdir(path string) error {
	return s.client.MkdirAll(path)
}

func (s *SFTPClient) CreateEmpty(path string) error {
	f, err := s.client.Create(path)
	if err != nil { return err }
	return f.Close()
}

func (s *SFTPClient) UploadData(remotePath string, data []byte) error {
	f, err := s.client.Create(remotePath)
	if err != nil { return err }
	if _, err := f.Write(data); err != nil { f.Close(); return err }
	return f.Close()
}

func (s *SFTPClient) Remove(path string) error {
	info, err := s.client.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return s.removeDir(path)
	}
	return s.client.Remove(path)
}

func (s *SFTPClient) Rename(oldPath, newPath string) error {
	return s.client.Rename(oldPath, newPath)
}

func (s *SFTPClient) removeDir(path string) error {
	entries, err := s.client.ReadDir(path)
	if err != nil {
		return err
	}
	for _, e := range entries {
		fullPath := filepath.ToSlash(filepath.Join(path, e.Name()))
		if e.IsDir() {
			if err := s.removeDir(fullPath); err != nil {
				return err
			}
		} else {
			if err := s.client.Remove(fullPath); err != nil {
				return err
			}
		}
	}
	return s.client.RemoveDirectory(path)
}
