package ai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// StreamClient handles chat completions with tool calling
type StreamClient struct {
	cfg    ClientConfig
	client *http.Client
}

// ChatResponse for non-streaming tool calls
type ChatResponse struct {
	Choices []struct {
		Message struct {
			Role             string     `json:"role"`
			Content          string     `json:"content"`
			ReasoningContent string     `json:"reasoning_content"`
			ToolCalls        []ToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func NewStreamClient(cfg ClientConfig) *StreamClient {
	return &StreamClient{
		cfg: cfg,
		client: &http.Client{
			Timeout: 300 * time.Second,
		},
	}
}

// ChatWithTools sends a request and returns the response (used for tool calling loop)
func (c *StreamClient) ChatWithTools(messages []Message, tools []map[string]interface{}) (*ChatResponse, error) {
	url := c.resolveURL()
	body := map[string]interface{}{
		"model":       c.cfg.Model,
		"messages":    messages,
		"temperature": 0.3,
	}
	if len(tools) > 0 {
		body["tools"] = tools
		body["tool_choice"] = "auto"
	}

	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("API请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API错误(%d): %s", resp.StatusCode, string(respBody))
	}

	var cr ChatResponse
	if err := json.Unmarshal(respBody, &cr); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if cr.Error != nil {
		return nil, fmt.Errorf("API错误: %s", cr.Error.Message)
	}
	return &cr, nil
}

// ChatStreamWithFuncs streams chat completions with tool calling support
func (c *StreamClient) ChatStreamWithFuncs(
	messages []Message,
	tools []map[string]interface{},
	onChunk func(string),
	onReasoning func(string),
	onToolCall func(ToolCall),
	onDone func(),
	onError func(error),
) error {
	url := c.resolveURL()
	body := map[string]interface{}{
		"model":       c.cfg.Model,
		"messages":    messages,
		"stream":      true,
		"temperature": 0.3,
	}
	if len(tools) > 0 {
		body["tools"] = tools
		body["tool_choice"] = "auto"
	}

	payload, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("API请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API错误(%d): %s", resp.StatusCode, string(respBody))
	}

	// Parse SSE stream
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	var toolCallAccum map[int]*ToolCall

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			if onDone != nil {
				onDone()
			}
			return nil
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
					ToolCalls        []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		for _, choice := range chunk.Choices {
			// Handle tool calls
			for _, tc := range choice.Delta.ToolCalls {
				if toolCallAccum == nil {
					toolCallAccum = make(map[int]*ToolCall)
				}
				idx := tc.Index
				if _, ok := toolCallAccum[idx]; !ok {
					toolCallAccum[idx] = &ToolCall{
						ID:   tc.ID,
						Type: tc.Type,
						Function: ToolCallFunc{
							Name: tc.Function.Name,
						},
					}
				}
				if tc.ID != "" {
					toolCallAccum[idx].ID = tc.ID
				}
				if tc.Function.Name != "" {
					toolCallAccum[idx].Function.Name = tc.Function.Name
				}
				toolCallAccum[idx].Function.Arguments += tc.Function.Arguments
			}

			// Handle reasoning content (DeepSeek thinking mode)
			if choice.Delta.ReasoningContent != "" && onReasoning != nil {
				onReasoning(choice.Delta.ReasoningContent)
			}
			// Handle text content
			if choice.Delta.Content != "" {
				onChunk(choice.Delta.Content)
			}

			// Handle finish — flush accumulated tool calls
			if choice.FinishReason != nil && *choice.FinishReason == "tool_calls" {
				if onToolCall != nil {
					for _, tc := range toolCallAccum {
						onToolCall(*tc)
					}
				}
				toolCallAccum = nil
			}
		}
	}

	if onDone != nil {
		onDone()
	}
	return scanner.Err()
}

func (c *StreamClient) resolveURL() string {
	base := strings.TrimRight(c.cfg.BaseURL, "/")
	switch c.cfg.Provider {
	case "deepseek", "openai", "custom":
		return base + "/chat/completions"
	case "anthropic":
		return base + "/messages"
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/chat/completions"
	}
}
