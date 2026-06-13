package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

// ToolRegistry manages registered tools
type ToolRegistry struct {
	mu     sync.RWMutex
	tools  map[string]*Tool
	ctx    *ToolContext
}

// ToolContext provides tools access to the application state
type ToolContext struct {
	// Device & connection access
	GetConnections     func() []DeviceInfo
	SendCommand        func(connID, cmd string) (string, error)
	SendCommandDirect  func(connID, cmd string) error
	ReadBuffer         func(connID string) string

	// Knowledge access
	SearchKnowledge func(query string, topK int) []RAGDocument
	IndexDocument   func(doc RAGDocument) error

	// Skill access
	ListSkills   func() []string
	GetSkill     func(name string) (string, error)

	// Config
	GetConfig func() ClientConfig
}

func NewToolRegistry(ctx *ToolContext) *ToolRegistry {
	return &ToolRegistry{
		tools: make(map[string]*Tool),
		ctx:   ctx,
	}
}

func (r *ToolRegistry) Register(tool *Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[tool.Name] = tool
}

func (r *ToolRegistry) Get(name string) *Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.tools[name]
}

func (r *ToolRegistry) List() []*Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.tools))
	for n := range r.tools {
		names = append(names, n)
	}
	sort.Strings(names)
	result := make([]*Tool, len(names))
	for i, n := range names {
		result[i] = r.tools[n]
	}
	return result
}

// Execute runs a tool by name with given arguments
func (r *ToolRegistry) Execute(name string, args map[string]interface{}) (string, error) {
	tool := r.Get(name)
	if tool == nil {
		return "", fmt.Errorf("unknown tool: %s", name)
	}
	return tool.Handler(args)
}

// ToOpenAIFormat converts all tools to OpenAI function calling format
func (r *ToolRegistry) ToOpenAIFormat() []map[string]interface{} {
	tools := r.List()
	result := make([]map[string]interface{}, len(tools))
	for i, t := range tools {
		result[i] = map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  json.RawMessage(t.Parameters),
			},
		}
	}
	return result
}

// ── Parameter helpers ──

func Params(props map[string]interface{}, required []string) json.RawMessage {
	raw, _ := json.Marshal(map[string]interface{}{
		"type":       "object",
		"properties": props,
		"required":   required,
	})
	return raw
}

func StringParam(desc string) map[string]interface{} {
	return map[string]interface{}{"type": "string", "description": desc}
}
func IntParam(desc string) map[string]interface{} {
	return map[string]interface{}{"type": "integer", "description": desc}
}
