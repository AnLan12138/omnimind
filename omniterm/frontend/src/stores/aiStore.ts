import { create } from 'zustand'

/*
 * aiStore.ts — AI 聊天状态管理
 * ==========================================
 * 管理消息列表、API 配置、发送状态
 * 支持 Agent 模式的思考链和工具调用展示
 *
 * Hermes 风格: 只需选厂商 + 填入 SK，模型/URL 自动推导
 */

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface AgentStep {
  thought: string
  toolCall?: { tool: string; args: string }
  toolResult?: { tool: string; result: string }
}

export type AIProvider = 'deepseek' | 'openai' | 'anthropic' | 'ollama' | 'custom'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  baseURL: string
  systemPrompt: string
}

// ── Provider 预设 (Hermes 风格: 每个厂商一条记录) ──

export interface ProviderPreset {
  id: AIProvider
  name: string
  defaultModel: string
  defaultBaseURL: string
  color: string           // 品牌色
  bgClass: string         // 卡片背景
  borderClass: string     // 选中边框
  getKeyURL?: string      // 获取 API Key 的链接
  keyHint?: string        // API Key 格式提示
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultModel: 'deepseek-v4-pro',
    defaultBaseURL: 'https://api.deepseek.com/v1',
    color: '#4F46E5',
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500',
    getKeyURL: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    defaultBaseURL: 'https://api.openai.com/v1',
    color: '#10A37F',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500',
    getKeyURL: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-proj-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    defaultBaseURL: 'https://api.anthropic.com',
    color: '#D97706',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500',
    getKeyURL: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    defaultModel: 'llama3',
    defaultBaseURL: 'http://localhost:11434',
    color: '#6B7280',
    bgClass: 'bg-gray-500/10',
    borderClass: 'border-gray-500',
    keyHint: '本地无需 Key',
  },
  {
    id: 'custom',
    name: '自定义',
    defaultModel: '',
    defaultBaseURL: '',
    color: '#7C3AED',
    bgClass: 'bg-violet-500/10',
    borderClass: 'border-violet-500',
    keyHint: '自定义 API Key',
  },
]

export function getPreset(provider: AIProvider): ProviderPreset {
  return PROVIDER_PRESETS.find(p => p.id === provider) || PROVIDER_PRESETS[0]
}

// ── 默认配置 ──

const defaultConfig: AIConfig = {
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-v4-pro',
  baseURL: 'https://api.deepseek.com/v1',
  systemPrompt: '你是一个网络运维助手，帮助用户管理网络设备和排查故障。用中文回复。',
}

function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem('omni-ai-config')
    return raw ? { ...defaultConfig, ...JSON.parse(raw) } : { ...defaultConfig }
  } catch { return { ...defaultConfig } }
}

function saveConfig(c: AIConfig) {
  localStorage.setItem('omni-ai-config', JSON.stringify(c))
}

interface AIStore {
  messages: AIMessage[]
  config: AIConfig
  sending: boolean
  streamContent: string
  agentSteps: AgentStep[]
  setConfig: (patch: Partial<AIConfig>) => void
  addMessage: (msg: AIMessage) => void
  appendStream: (chunk: string) => void
  finishStream: () => void
  clearMessages: () => void
  setSending: (v: boolean) => void
  addAgentStep: (step: AgentStep) => void
  updateLastThought: (thought: string) => void
  setLastToolCall: (tool: string, args: string) => void
  setLastToolResult: (tool: string, result: string) => void
}

export const useAIStore = create<AIStore>((set, get) => ({
  messages: [],
  config: loadConfig(),
  sending: false,
  streamContent: '',
  agentSteps: [],

  setConfig: (patch) => {
    const next = { ...get().config, ...patch }
    set({ config: next })
    saveConfig(next)
  },

  addMessage: (msg) => {
    set(s => ({ messages: [...s.messages, msg] }))
  },

  appendStream: (chunk) => {
    set(s => ({ streamContent: s.streamContent + chunk }))
  },

  finishStream: () => {
    const content = get().streamContent
    if (!content.trim()) { set({ streamContent: '', sending: false }); return }
    set(s => ({
      messages: [...s.messages, { role: 'assistant', content, timestamp: Date.now() }],
      streamContent: '',
      sending: false,
      agentSteps: [],
    }))
  },

  clearMessages: () => set({ messages: [], streamContent: '', agentSteps: [] }),

  setSending: (v) => set({ sending: v }),

  addAgentStep: (step) => {
    set(s => ({ agentSteps: [...s.agentSteps, step] }))
  },

  updateLastThought: (thought) => {
    set(s => {
      const steps = [...s.agentSteps]
      if (steps.length === 0) {
        steps.push({ thought })
      } else {
        const last = steps[steps.length - 1]
        if (last.toolCall) {
          steps.push({ thought })
        } else {
          steps[steps.length - 1] = { ...last, thought: last.thought + thought }
        }
      }
      return { agentSteps: steps }
    })
  },

  setLastToolCall: (tool, args) => {
    set(s => {
      const steps = [...s.agentSteps]
      if (steps.length === 0) {
        steps.push({ thought: '', toolCall: { tool, args } })
      } else {
        const last = steps[steps.length - 1]
        steps[steps.length - 1] = { ...last, toolCall: { tool, args } }
      }
      return { agentSteps: steps }
    })
  },

  setLastToolResult: (tool, result) => {
    set(s => {
      const steps = [...s.agentSteps]
      if (steps.length === 0) return { agentSteps: steps }
      const last = steps[steps.length - 1]
      steps[steps.length - 1] = { ...last, toolResult: { tool, result } }
      return { agentSteps: steps }
    })
  },
}))
