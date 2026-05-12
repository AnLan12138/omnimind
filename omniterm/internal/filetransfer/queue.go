package filetransfer

import (
	"fmt"
	"sync"
	"time"
)

type TransferStatus int

const (
	StatusQueued TransferStatus = iota
	StatusTransferring
	StatusDone
	StatusFailed
	StatusPaused
)

type TransferTask struct {
	ID          string         `json:"id"`
	Direction   string         `json:"direction"` // "upload" | "download"
	LocalPath   string         `json:"localPath"`
	RemotePath  string         `json:"remotePath"`
	Total       int64          `json:"total"`
	Transferred int64          `json:"transferred"`
	Status      TransferStatus `json:"status"`
	Error       string         `json:"error,omitempty"`
	StartedAt   time.Time      `json:"startedAt"`
	DoneAt      *time.Time     `json:"doneAt,omitempty"`
}

type Queue struct {
	mu      sync.Mutex
	tasks   []*TransferTask
	onEvent func(task *TransferTask)
}

func NewQueue() *Queue { return &Queue{tasks: make([]*TransferTask, 0)} }

func (q *Queue) OnEvent(cb func(*TransferTask)) { q.onEvent = cb }

func (q *Queue) Add(direction, localPath, remotePath string) *TransferTask {
	q.mu.Lock(); defer q.mu.Unlock()
	t := &TransferTask{
		ID: fmt.Sprintf("%d", time.Now().UnixNano()),
		Direction: direction, LocalPath: localPath, RemotePath: remotePath,
		Status: StatusQueued, StartedAt: time.Now(),
	}
	q.tasks = append(q.tasks, t)
	if q.onEvent != nil { q.onEvent(t) }
	return t
}

func (q *Queue) List() []*TransferTask {
	q.mu.Lock(); defer q.mu.Unlock()
	out := make([]*TransferTask, len(q.tasks))
	copy(out, q.tasks)
	return out
}

func (q *Queue) Update(id string, status TransferStatus, transferred, total int64, errMsg string) {
	q.mu.Lock(); defer q.mu.Unlock()
	for _, t := range q.tasks {
		if t.ID == id {
			t.Status = status; t.Transferred = transferred; t.Total = total
			if errMsg != "" { t.Error = errMsg }
			if status == StatusDone || status == StatusFailed { now := time.Now(); t.DoneAt = &now }
			if q.onEvent != nil { q.onEvent(t) }
			return
		}
	}
}

func (q *Queue) Pause(id string) { q.Update(id, StatusPaused, 0, 0, "") }
func (q *Queue) Resume(id string) { q.Update(id, StatusQueued, 0, 0, "") }
func (q *Queue) Remove(id string) {
	q.mu.Lock(); defer q.mu.Unlock()
	for i, t := range q.tasks { if t.ID == id { q.tasks = append(q.tasks[:i], q.tasks[i+1:]...); return } }
}
