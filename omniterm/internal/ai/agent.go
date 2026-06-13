package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// AgentConfig configures agent behavior
type AgentConfig struct {
	MaxSteps  int
	CoT       CoTConfig
	EmitEvent func(StreamEvent)
}

// Agent is the AI decision loop with streaming
type Agent struct {
	registry *ToolRegistry
	client   *StreamClient
	context  *AgentContext
	config   AgentConfig
	state    AgentState
}

func NewAgent(registry *ToolRegistry, client *StreamClient, ctx *AgentContext, cfg AgentConfig) *Agent {
	if cfg.MaxSteps <= 0 {
		cfg.MaxSteps = 5
	}
	return &Agent{
		registry: registry,
		client:   client,
		context:  ctx,
		config:   cfg,
	}
}

// Run executes the agent loop with streaming: stream text → detect tools → execute → repeat
func (a *Agent) Run(ctx context.Context, userInput string, streamID string) error {
	a.state.Active = true
	a.state.StreamID = streamID
	a.state.Steps = nil
	defer func() { a.state.Active = false }()

	messages := a.buildInitialMessages(userInput)
	tools := a.registry.ToOpenAIFormat()

	for step := 0; step < a.config.MaxSteps; step++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		a.emit(StreamEvent{Type: "thought", Content: "思考中..."})

		// ── Streaming call with tool detection ──
		var streamText strings.Builder
		var reasoningText strings.Builder
		var toolCalls []ToolCall
		var toolCallMu sync.Mutex
		streamDone := make(chan error, 1)

		go func() {
			err := a.client.ChatStreamWithFuncs(messages, tools,
				// onChunk
				func(chunk string) {
					streamText.WriteString(chunk)
					a.emit(StreamEvent{Type: "chunk", Content: chunk})
				},
				// onReasoning — capture DeepSeek thinking
				func(r string) {
					reasoningText.WriteString(r)
				},
				// onToolCall
				func(tc ToolCall) {
					toolCallMu.Lock()
					toolCalls = append(toolCalls, tc)
					toolCallMu.Unlock()
					a.emit(StreamEvent{
						Type: "tool_call",
						Tool: tc.Function.Name,
						Args: tc.Function.Arguments,
						Content: fmt.Sprintf("调用 %s", tc.Function.Name),
					})
				},
				// onDone — stream finished
				func() {
					streamDone <- nil
				},
				// onError
				func(err error) {
					streamDone <- err
				},
			)
			if err != nil {
				a.emit(StreamEvent{Type: "error", Content: err.Error()})
				streamDone <- err
			}
		}()

		// Wait for stream to finish
		if err := <-streamDone; err != nil {
			return err
		}

		// ── No tool calls → agent is done ──
		if len(toolCalls) == 0 {
			// Text was already streamed via onChunk
			a.emit(StreamEvent{Type: "done", Content: "completed"})
			return nil
		}

		// ── Execute tool calls ──
		content := streamText.String()
		reasoning := reasoningText.String()
		agentStep := AgentStep{Thought: content}

		messages = append(messages, Message{
			Role:             "assistant",
			Content:          content,
			ReasoningContent: reasoning,
			ToolCalls:        toolCalls,
		})

		for _, tc := range toolCalls {
			a.emit(StreamEvent{
				Type: "tool_run",
				Tool: tc.Function.Name,
				Args: tc.Function.Arguments,
			})

			var args map[string]interface{}
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				args = map[string]interface{}{}
			}

			result, err := a.registry.Execute(tc.Function.Name, args)
			tr := ToolResult{ToolCallID: tc.ID, Name: tc.Function.Name}
			if err != nil {
				tr.Error = err.Error()
				tr.Content = fmt.Sprintf("错误: %s", err.Error())
			} else {
				tr.Content = result
			}

			a.emit(StreamEvent{
				Type:   "tool_result",
				Tool:   tc.Function.Name,
				Result: tr.Content,
				Content: truncate(tr.Content, 300),
			})

			agentStep.Results = append(agentStep.Results, tr)
			messages = append(messages, Message{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    tr.Content,
			})
		}

		agentStep.ToolCalls = toolCalls
		a.state.Steps = append(a.state.Steps, agentStep)
	}

	// Max steps reached
	a.emit(StreamEvent{Type: "thought", Content: "总结结果..."})
	finalStream := a.streamFinalAnswer(messages)
	a.emit(StreamEvent{Type: "chunk", Content: finalStream})
	a.emit(StreamEvent{Type: "done", Content: "completed"})
	return nil
}

// streamFinalAnswer gets a quick non-streaming final answer when max steps reached
func (a *Agent) streamFinalAnswer(messages []Message) string {
	msg := append(messages, Message{
		Role:    "user",
		Content: "已达到工具调用最大次数。请根据以上信息给用户一个简短的总结回复。",
	})
	resp, err := a.client.ChatWithTools(msg, nil)
	if err != nil || len(resp.Choices) == 0 {
		return "抱歉，处理超时，请重试。"
	}
	return resp.Choices[0].Message.Content
}

func (a *Agent) buildInitialMessages(userInput string) []Message {
	sysPrompt := a.context.SystemPrompt
	if sysPrompt == "" {
		sysPrompt = "你是一个网络运维AI助手。你可以使用工具来查询设备、执行命令、读取终端。用中文回复。"
	}

	if ctx := a.buildDeviceContextStr(); ctx != "" {
		sysPrompt += "\n\n" + ctx
	}
	if a.context.ActiveSkill != "" {
		sysPrompt += fmt.Sprintf("\n\n当前角色: %s", a.context.ActiveSkill)
	}
	if a.config.CoT.Enabled {
		pipeline := NewPipeline()
		sysPrompt += "\n\n" + pipeline.BuildPrompt()
	}

	msgs := []Message{{Role: "system", Content: sysPrompt}}

	history := a.context.History
	if len(history) > 20 {
		history = history[len(history)-20:]
	}
	msgs = append(msgs, history...)
	msgs = append(msgs, Message{Role: "user", Content: userInput})

	return msgs
}

func (a *Agent) buildDeviceContextStr() string {
	if len(a.context.Devices) == 0 {
		return ""
	}
	var lines []string
	lines = append(lines, "当前已连接设备:")
	for i, d := range a.context.Devices {
		info := fmt.Sprintf("%s:%d (%s)", d.Host, d.Port, strings.ToUpper(d.Protocol))
		if d.Vendor != "" {
			info += fmt.Sprintf(" [%s", d.Vendor)
			if d.Model != "" {
				info += " " + d.Model
			}
			info += "]"
		}
		if d.Username != "" {
			info += " 用户:" + d.Username
		}
		lines = append(lines, fmt.Sprintf("  %d. connId=%s — %s", i+1, d.ConnID, info))
	}
	return strings.Join(lines, "\n")
}

func (a *Agent) emit(ev StreamEvent) {
	if a.config.EmitEvent != nil {
		a.config.EmitEvent(ev)
	}
}

func (a *Agent) GetHistory() []Message {
	var msgs []Message
	for _, step := range a.state.Steps {
		msgs = append(msgs, Message{Role: "assistant", Content: step.Thought, ToolCalls: step.ToolCalls})
		for _, r := range step.Results {
			msgs = append(msgs, Message{Role: "tool", Content: r.Content, ToolCallID: r.ToolCallID})
		}
	}
	return msgs
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
