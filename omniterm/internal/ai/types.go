package ai

import "encoding/json"

// ── Core Types ──

// Message is a chat message
type Message struct {
	Role             string     `json:"role"`
	Content          string     `json:"content,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
}

// ToolCall represents a tool invocation from the model
type ToolCall struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Function  ToolCallFunc    `json:"function"`
}

type ToolCallFunc struct {
	Name      string          `json:"name"`
	Arguments string          `json:"arguments"`
}

// Tool defines a callable tool
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
	Handler     ToolHandler
}

// ToolHandler is the function that executes a tool
type ToolHandler func(args map[string]interface{}) (string, error)

// ToolResult is the result of a tool execution
type ToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	Name       string `json:"name"`
	Content    string `json:"content"`
	Error      string `json:"error,omitempty"`
}

// ── Agent State ──

type AgentStep struct {
	Thought   string      `json:"thought"`
	ToolCalls []ToolCall  `json:"tool_calls,omitempty"`
	Results   []ToolResult `json:"results,omitempty"`
	Final     bool        `json:"final"`
}

type AgentState struct {
	Steps      []AgentStep `json:"steps"`
	Active     bool        `json:"active"`
	StreamID   string      `json:"streamId"`
}

// ── Provider Config ──

type ClientConfig struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	BaseURL  string `json:"baseURL"`
}

// ── CoT ──

type CoTConfig struct {
	Enabled bool `json:"enabled"`
	Steps   int  `json:"steps"` // max reasoning steps, 0 = unlimited
}

// ── RAG ──

type RAGDocument struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Content  string    `json:"content"`
	Tags     []string  `json:"tags"`
	Embedding []float32 `json:"-"`
}

// ── Context ──

type AgentContext struct {
	SystemPrompt string        `json:"systemPrompt"`
	Devices      []DeviceInfo  `json:"devices"`
	ActiveSkill  string        `json:"activeSkill,omitempty"`
	History      []Message     `json:"history"`
	CoT          CoTConfig     `json:"cot"`
	MaxTokens    int           `json:"maxTokens"`
}

type DeviceInfo struct {
	ConnID   string `json:"connId"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Username string `json:"username"`
	Vendor   string `json:"vendor"`
	Model    string `json:"model"`
	OS       string `json:"os"`
	OSVer    string `json:"osVersion"`
	Hostname string `json:"hostname"`
}

// ── Event types for frontend ──

type StreamEvent struct {
	Type    string `json:"type"` // "chunk", "thought", "tool_call", "tool_result", "done", "error"
	Content string `json:"content"`
	Tool    string `json:"tool,omitempty"`
	Args    string `json:"args,omitempty"`
	Result  string `json:"result,omitempty"`
}
