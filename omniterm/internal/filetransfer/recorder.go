package filetransfer

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

type AsciicastHeader struct {
	Version   int               `json:"version"`
	Width     int               `json:"width"`
	Height    int               `json:"height"`
	Timestamp int64             `json:"timestamp,omitempty"`
	Duration  float64           `json:"duration,omitempty"`
	Title     string            `json:"title,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
}

type asciicastEvent struct {
	Time float64 `json:"0"`
	Type string  `json:"1"`
	Data string  `json:"2"`
}

type Recorder struct {
	mu       sync.Mutex
	file     *os.File
	header   AsciicastHeader
	start    time.Time
	recording bool
}

func NewRecorder(filePath string, width, height int) (*Recorder, error) {
	f, err := os.Create(filePath)
	if err != nil {
		return nil, fmt.Errorf("create file: %w", err)
	}

	r := &Recorder{
		file:  f,
		start: time.Now(),
		header: AsciicastHeader{
			Version:   2,
			Width:     width,
			Height:    height,
			Timestamp: time.Now().Unix(),
			Env: map[string]string{
				"SHELL": "/bin/bash",
				"TERM":  "xterm-256color",
			},
		},
		recording: true,
	}

	// Write header
	headerBytes, _ := json.Marshal(r.header)
	f.Write(headerBytes)
	f.Write([]byte("\n"))

	return r, nil
}

func (r *Recorder) RecordOutput(data string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.recording { return nil }
	return r.writeEvent("o", data)
}

func (r *Recorder) RecordInput(data string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.recording { return nil }
	return r.writeEvent("i", data)
}

func (r *Recorder) Stop() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recording = false
	return r.file.Close()
}

func (r *Recorder) writeEvent(eventType, data string) error {
	elapsed := time.Since(r.start).Seconds()
	evt := asciicastEvent{
		Time: elapsed,
		Type: eventType,
		Data: data,
	}
	b, err := json.Marshal([]interface{}{evt.Time, evt.Type, evt.Data})
	if err != nil { return err }
	r.file.Write(b)
	r.file.Write([]byte("\n"))
	return nil
}
