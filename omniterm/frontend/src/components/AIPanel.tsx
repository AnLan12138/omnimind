import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Bot, User, Trash2, Loader2, Brain, Wrench,
  ChevronDown, ChevronRight, Copy, Check, Square,
  ArrowDown, Sparkles, Terminal, Search, BookOpen
} from 'lucide-react'
import { useAIStore, type AIMessage, type AgentStep } from '../stores/aiStore'
import { useI18n } from '../lib/i18n'
import { AIChatStream } from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { ai } from '../../wailsjs/go/models'

/*
 * AIPanel.tsx — AI 聊天面板 (Agent 模式)
 * ==========================================
 * VS Code 风格优化：
 * - 圆形头像 + 角色色彩
 * - 代码块顶栏 + 一键复制
 * - 可折叠"思考过程"区域
 * - 生成中显示停止按钮
 * - 空态建议快捷入口
 * - 消息时间戳 + 复制按钮
 * - 离开底部时显示回底按钮
 * - 流式输出闪烁光标 / 三点跳动
 */

// ── 工具函数 ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// ── 内容渲染 (Markdown → HTML) ──

function renderContent(text: string): string {
  let out = text
  // 保护代码块，避免被内联规则误处理
  const blocks: { lang: string; code: string }[] = []
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_f, lang: string, code: string) => {
    blocks.push({ lang, code: code.trim() })
    return `\x00CODE${blocks.length - 1}\x00`
  })

  // 内联标记
  out = out.replace(/`([^`]+)`/g,
    '<code class="bg-black/30 px-1 py-px rounded text-[11px] font-mono text-vscode-accent">$1</code>')
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
  out = out.replace(/\n/g, '<br/>')

  // 还原代码块 → 带顶栏 + 复制按钮的 HTML
  blocks.forEach((b, i) => {
    const html =
      `<div class="my-1.5 rounded border border-vscode-border bg-[#1a1a1a] overflow-hidden">` +
      `<div class="flex items-center justify-between px-2.5 py-1 bg-vscode-sidebar border-b border-vscode-border">` +
      `<span class="text-[10px] text-vscode-text-dim tracking-wider uppercase">${escapeHtml(b.lang || 'code')}</span>` +
      `<button class="copy-code-btn p-0.5 rounded hover:bg-white/10 transition-colors" data-code="${escapeHtml(b.code)}" title="复制">` +
      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `</button></div>` +
      `<pre class="p-2.5 overflow-x-auto text-[11px] font-mono text-vscode-text leading-relaxed"><code>${escapeHtml(b.code)}</code></pre>` +
      `</div>`
    out = out.replace(`\x00CODE${i}\x00`, html)
  })

  return out
}

// ── 代码块复制 → 事件委托 ──

function handleCodeCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.copy-code-btn')
  if (!btn) return
  const code = btn.getAttribute('data-code')
  if (!code) return
  navigator.clipboard.writeText(code)
  btn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  setTimeout(() => {
    btn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  }, 2000)
}

// ── 消息复制按钮 ──

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className={`p-0.5 rounded hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100 ${className}`}
      title="复制"
    >
      {copied
        ? <Check size={12} className="text-green-400" />
        : <Copy size={12} />}
    </button>
  )
}

// ── Agent 步骤卡片 ──

function StepCard({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false)
  const hasTool = !!step.toolCall

  return (
    <div className="ml-2 pl-2 my-0.5 border-l-2 border-vscode-accent/30">
      {/* 思考文本 */}
      {step.thought && (
        <div className="flex items-start gap-1.5 text-[11px] text-vscode-text-dim/60 italic leading-relaxed">
          <Brain size={11} className="shrink-0 mt-0.5 text-vscode-accent/40" />
          <span>{step.thought}</span>
        </div>
      )}

      {/* 工具调用 */}
      {hasTool && (
        <div className="mt-0.5">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-vscode-accent hover:text-vscode-accent-hover transition-colors group"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Wrench size={10} className="text-vscode-text-dim group-hover:text-vscode-accent" />
            <span className="font-medium">{step.toolCall!.tool}</span>
            <span className="text-vscode-text-dim truncate max-w-[120px]">
              {step.toolCall!.args}
            </span>
          </button>

          {expanded && (
            <div className="mt-1 ml-4">
              {step.toolResult ? (
                <div className="p-1.5 bg-[#1a1a1a] border border-vscode-border rounded text-[10px] font-mono text-vscode-text-muted max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {step.toolResult.result.length > 2000
                    ? step.toolResult.result.slice(0, 2000) + '\n... (输出被截断)'
                    : step.toolResult.result}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[10px] text-vscode-text-dim">
                  <Loader2 size={10} className="animate-spin" />
                  执行中...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 空态建议 ──

const suggestions = [
  { icon: Search, label: '查看所有设备状态' },
  { icon: Terminal, label: '检查接口带宽使用' },
  { icon: BookOpen, label: '排查常见网络故障' },
]

// ══════════════════════════════════════════
//  主组件
// ══════════════════════════════════════════

export default function AIPanel() {
  const {
    messages, sending, streamContent, agentSteps,
    addMessage, appendStream, finishStream, clearMessages, setSending, config,
    updateLastThought, setLastToolCall, setLastToolResult
  } = useAIStore()
  const { t } = useI18n()
  const [input, setInput] = useState('')

  // 滚动相关
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  // 流式控制
  const streamIdRef = useRef<string | null>(null)
  const listenersSetup = useRef(false)
  const genRef = useRef(0)        // 代数计数器，stop 时递增以忽略旧事件
  const activeRef = useRef(true)  // 当前代是否活跃

  // ── 自动滚动 (尊重用户手动上滚) ──

  const scrollToBottom = useCallback((smooth = true) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    }
  }, [])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setUserScrolledUp(scrollHeight - scrollTop - clientHeight > 60)
  }, [])

  useEffect(() => {
    if (!userScrolledUp) scrollToBottom()
  }, [messages, streamContent, agentSteps, userScrolledUp, scrollToBottom])

  // 首次有内容时滚到底
  useEffect(() => {
    if (messages.length > 0 || streamContent) {
      scrollToBottom(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 流式事件监听 (仅注册一次) ──

  useEffect(() => {
    if (listenersSetup.current) return
    listenersSetup.current = true
    const id = `ai-stream-${Date.now()}`
    streamIdRef.current = id

    EventsOn('ai:stream:' + id + ':chunk', (chunk: string) => {
      if (!activeRef.current) return
      appendStream(chunk)
    })
    EventsOn('ai:stream:' + id + ':thought', (text: string) => {
      if (!activeRef.current) return
      updateLastThought(text)
    })
    EventsOn('ai:stream:' + id + ':tool', (data: string) => {
      if (!activeRef.current) return
      try {
        const parsed = JSON.parse(data)
        setLastToolCall(parsed.tool || '', parsed.args || '')
      } catch { setLastToolCall(data, '') }
    })
    EventsOn('ai:stream:' + id + ':tool_result', (data: string) => {
      if (!activeRef.current) return
      try {
        const parsed = JSON.parse(data)
        setLastToolResult(parsed.tool || '', parsed.result || '')
      } catch { setLastToolResult('', data) }
    })
    EventsOn('ai:stream:' + id + ':done', () => {
      if (!activeRef.current) return
      activeRef.current = false
      finishStream()
    })
    EventsOn('ai:stream:' + id + ':error', (err: string) => {
      if (!activeRef.current) return
      appendStream(`\n\n❌ 错误: ${err}`)
      activeRef.current = false
      finishStream()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 代码块复制事件委托 ──

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('click', handleCodeCopy)
    return () => el.removeEventListener('click', handleCodeCopy)
  }, [])

  // ── 发送 ──

  const doSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')

    // 新的一代
    genRef.current++
    activeRef.current = true
    setUserScrolledUp(false)

    const userMsg: AIMessage = { role: 'user', content: text, timestamp: Date.now() }
    addMessage(userMsg)
    setSending(true)

    const msgs = [
      ai.Message.createFrom({ role: 'system', content: config.systemPrompt }),
      ...messages.map(m => ai.Message.createFrom({ role: m.role, content: m.content })),
      ai.Message.createFrom({ role: 'user', content: text }),
    ]

    const streamId = streamIdRef.current || `ai-stream-${Date.now()}`
    try {
      await AIChatStream(streamId, msgs, ai.ClientConfig.createFrom({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        baseURL: config.baseURL,
      }))
    } catch (err: any) {
      if (!activeRef.current) return
      appendStream(`\n\n❌ 请求失败: ${err?.message || err || '未知错误'}`)
      activeRef.current = false
      finishStream()
    }
  }, [input, sending, messages, config, addMessage, appendStream, finishStream, setSending])

  // ── 停止生成 ──

  const handleStop = useCallback(() => {
    activeRef.current = false
    genRef.current++
    if (streamContent.trim()) {
      appendStream('\n\n---\n*⏸ 已停止生成*')
    }
    finishStream()
  }, [streamContent, appendStream, finishStream])

  // ── 键盘 ──

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      if (sending) {
        handleStop()
      } else {
        doSend()
      }
    }
  }

  // ── 快捷建议 ──

  const handleSuggestion = (label: string) => {
    setInput(label)
  }

  // ══════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════

  return (
    <div className="flex flex-col h-full">
      {/* ── 消息区域 ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 relative"
      >
        {/* 空态 */}
        {messages.length === 0 && !streamContent && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-2">
            {/* 图标 */}
            <div className="w-14 h-14 rounded-2xl bg-vscode-accent/10 flex items-center justify-center">
              <Sparkles size={28} className="text-vscode-accent" />
            </div>

            {/* 标题 */}
            <div>
              <p className="text-[13px] font-semibold text-vscode-text">
                {t('aiWelcome', 'AI 网络运维助手')}
              </p>
              <p className="text-[11px] text-vscode-text-dim mt-1.5 leading-relaxed max-w-[280px]">
                {t('aiWelcomeHint', '我可以帮你查询设备状态、执行诊断命令、排查网络故障。试试下面的问题：')}
              </p>
            </div>

            {/* 建议快捷入口 */}
            <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestion(s.label)}
                  disabled={sending}
                  className="flex items-center gap-2.5 px-3 py-2 text-left text-[11px] text-vscode-text-muted
                    hover:text-vscode-text bg-vscode-input/40 hover:bg-vscode-input
                    border border-vscode-border/40 hover:border-vscode-border/70
                    rounded-lg transition-all disabled:opacity-40"
                >
                  <s.icon size={13} className="text-vscode-accent/60 shrink-0" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息列表 */}
        <div className="space-y-3.5">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 group ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {/* 助手头像 */}
              {msg.role === 'assistant' && (
                <div className="shrink-0 w-7 h-7 rounded-full bg-green-400/10 flex items-center justify-center mt-0.5">
                  <Bot size={14} className="text-green-400" />
                </div>
              )}

              {/* 消息气泡 */}
              <div className={`relative max-w-[85%] rounded-xl px-3 py-2.5 text-[12px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-vscode-accent text-white rounded-br-md'
                  : 'bg-vscode-input text-vscode-text rounded-bl-md'
              }`}>
                {/* 正文 */}
                <div
                  dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                  className="break-words"
                />

                {/* 底部：时间 + 复制 (hover 显示) */}
                <div className={`flex items-center gap-1.5 mt-1.5 ${
                  msg.role === 'user' ? 'justify-end' : ''
                }`}>
                  <span className={`text-[9px] select-none ${
                    msg.role === 'user' ? 'text-white/40' : 'text-vscode-text-dim/40'
                  }`}>
                    {formatTime(msg.timestamp)}
                  </span>
                  <CopyButton
                    text={msg.content}
                    className={msg.role === 'user'
                      ? 'text-white/40 hover:text-white/80'
                      : 'text-vscode-text-dim/40 hover:text-vscode-text-dim/80'}
                  />
                </div>
              </div>

              {/* 用户头像 */}
              {msg.role === 'user' && (
                <div className="shrink-0 w-7 h-7 rounded-full bg-vscode-accent/20 flex items-center justify-center mt-0.5">
                  <User size={14} className="text-vscode-accent" />
                </div>
              )}
            </div>
          ))}

          {/* ── Agent 思考过程 (生成中显示) ── */}
          {agentSteps.length > 0 && (
            <div className="flex gap-2">
              <div className="shrink-0 w-7 h-7 rounded-full bg-vscode-accent/10 flex items-center justify-center mt-0.5">
                <Brain size={14} className="text-vscode-accent" />
              </div>
              <div className="flex-1 max-w-[85%] bg-vscode-input/60 border border-vscode-border/40 rounded-xl rounded-bl-md px-3 py-2">
                {/* 思考过程标题 */}
                <div className="flex items-center gap-1.5 text-[10px] text-vscode-text-dim mb-1.5 font-semibold uppercase tracking-widest select-none">
                  <Brain size={10} />
                  思考过程
                </div>
                {agentSteps.map((step, i) => (
                  <StepCard key={i} step={step} />
                ))}
                {sending && !streamContent && (
                  <div className="flex items-center gap-1.5 text-[11px] text-vscode-text-dim mt-1.5">
                    <Loader2 size={11} className="animate-spin" />
                    正在思考...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 流式文本 (非 Agent 模式) ── */}
          {streamContent && agentSteps.length === 0 && (
            <div className="flex gap-2">
              <div className="shrink-0 w-7 h-7 rounded-full bg-green-400/10 flex items-center justify-center mt-0.5">
                <Bot size={14} className="text-green-400" />
              </div>
              <div className="max-w-[85%] rounded-xl rounded-bl-md px-3 py-2.5 text-[12px] leading-relaxed bg-vscode-input text-vscode-text">
                <div
                  dangerouslySetInnerHTML={{ __html: renderContent(streamContent) }}
                  className="break-words"
                />
                {/* 闪烁光标 */}
                <span className="inline-block w-1.5 h-4 bg-vscode-accent ml-0.5 animate-pulse align-text-bottom rounded-sm" />
              </div>
            </div>
          )}

          {/* ── 等待首字 (三点跳动) ── */}
          {sending && !streamContent && agentSteps.length === 0 && (
            <div className="flex gap-2">
              <div className="shrink-0 w-7 h-7 rounded-full bg-green-400/10 flex items-center justify-center mt-0.5">
                <Bot size={14} className="text-green-400" />
              </div>
              <div className="rounded-xl rounded-bl-md px-4 py-2.5 bg-vscode-input">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-vscode-text-dim animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-vscode-text-dim animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-vscode-text-dim animate-bounce" style={{ animationDelay: '240ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* 自动滚动锚点 */}
          <div ref={bottomRef} />
        </div>

        {/* ── 回底按钮 ── */}
        {userScrolledUp && (
          <button
            onClick={() => { setUserScrolledUp(false); scrollToBottom() }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 p-1.5
              bg-vscode-input border border-vscode-border rounded-full
              shadow-lg hover:bg-vscode-sidebar hover:border-vscode-border-light
              transition-all z-10"
            title="回到底部"
          >
            <ArrowDown size={14} className="text-vscode-text-muted" />
          </button>
        )}
      </div>

      {/* ── 输入区域 ── */}
      <div className="shrink-0 border-t border-vscode-border bg-vscode-bg/80 backdrop-blur">
        <div className="p-2.5">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('aiPlaceholder', '输入消息，Enter 发送，Shift+Enter 换行...')}
            rows={2}
            readOnly={sending}
            className="w-full bg-vscode-input border border-vscode-border rounded-xl px-3 py-2
              text-[12px] text-vscode-text placeholder-vscode-text-dim/50
              resize-none
              focus:outline-none focus:border-vscode-accent focus:ring-1 focus:ring-vscode-accent/30
              transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          />

          {/* 工具栏 */}
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={clearMessages}
              disabled={messages.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-vscode-text-muted
                hover:text-vscode-red disabled:opacity-30 rounded transition-colors"
            >
              <Trash2 size={11} />
              {t('clearConversation', '清空对话')}
            </button>

            <div className="flex items-center gap-2">
              {sending ? (
                /* 停止按钮 */
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5
                    bg-vscode-red/10 hover:bg-vscode-red/20
                    text-vscode-red border border-vscode-red/20
                    rounded-lg text-[11px] font-medium transition-colors"
                >
                  <Square size={10} />
                  停止生成
                </button>
              ) : (
                /* 发送按钮 */
                <button
                  onClick={doSend}
                  disabled={!input.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5
                    bg-vscode-accent hover:bg-vscode-accent-hover
                    text-white rounded-lg text-[11px] font-medium
                    disabled:opacity-40 transition-colors shadow-sm"
                >
                  <Send size={11} />
                  {t('send', '发送')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
