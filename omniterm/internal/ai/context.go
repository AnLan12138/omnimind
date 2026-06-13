package ai

import "sort"

// ContextBuilder assembles AgentContext from various sources
type ContextBuilder struct {
	systemPrompt string
	devices      []DeviceInfo
	history      []Message
	activeSkill  string
	cot          CoTConfig
	maxTokens    int
}

func NewContextBuilder() *ContextBuilder {
	return &ContextBuilder{
		maxTokens: 64000,
	}
}

func (b *ContextBuilder) SetSystemPrompt(p string) *ContextBuilder   { b.systemPrompt = p; return b }
func (b *ContextBuilder) SetDevices(d []DeviceInfo) *ContextBuilder  { b.devices = d; return b }
func (b *ContextBuilder) SetHistory(h []Message) *ContextBuilder     { b.history = h; return b }
func (b *ContextBuilder) SetActiveSkill(s string) *ContextBuilder    { b.activeSkill = s; return b }
func (b *ContextBuilder) SetCoT(c CoTConfig) *ContextBuilder          { b.cot = c; return b }
func (b *ContextBuilder) SetMaxTokens(m int) *ContextBuilder         { b.maxTokens = m; return b }

func (b *ContextBuilder) Build() *AgentContext {
	// Sort devices for consistent ordering
	devices := make([]DeviceInfo, len(b.devices))
	copy(devices, b.devices)
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Host != devices[j].Host {
			return devices[i].Host < devices[j].Host
		}
		return devices[i].Port < devices[j].Port
	})

	// Trim history to fit
	history := b.history
	if len(history) > 40 {
		history = history[len(history)-40:]
	}

	return &AgentContext{
		SystemPrompt: b.systemPrompt,
		Devices:      devices,
		ActiveSkill:  b.activeSkill,
		History:      history,
		CoT:          b.cot,
		MaxTokens:    b.maxTokens,
	}
}
