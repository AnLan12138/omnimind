import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useTabStore } from '../stores/tabStore'
import { useThemeStore } from '../stores/themeStore'
import { useConfigStore } from '../stores/configStore'
import { useBroadcastStore } from '../stores/broadcastStore'
import { useRecordingStore } from '../stores/recordingStore'
import { useShortcutStore, matchShortcut, registerShortcutAction, getShortcutAction } from '../stores/shortcutStore'
import { getHighlighter } from '../lib/KeywordHighlighter'
import { SaveTerminalContent } from '../../wailsjs/go/main/App'

interface Props { connId: string; onDisconnect: (connId: string) => void }
interface CtxMenu { x: number; y: number; visible: boolean }

export default function Terminal({ connId, onDisconnect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const updateTabState = useTabStore(s => s.updateTabState)
  const activeTabId = useTabStore(s => s.activeTabId)
  const tab = useTabStore(s => s.tabs.find(t => t.connId === connId))
  const terminalTheme = useThemeStore(s => s.theme)
  const terminalFontSize = useConfigStore(s => s.terminalFontSize)
  const terminalFontFamily = useConfigStore(s => s.terminalFontFamily)
  const terminalCursorStyle = useConfigStore(s => s.cursorStyle)
  const terminalScrollback = useConfigStore(s => s.scrollback)
  const highlightEnabled = useConfigStore(s => s.highlightEnabled)
  const highlightRules = useConfigStore(s => s.highlightRules)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>({ x: 0, y: 0, visible: false })
  const [toast, setToast] = useState<string | null>(null)
  const hlRef = useRef(getHighlighter())

  const copy = useCallback(() => {
    const sel = xtermRef.current?.getSelection()
    if (!sel) return
    navigator.clipboard.writeText(sel).catch(() => {})
    // Send OSC 52 to remote so programs like vim/tmux can receive clipboard
    try {
      const b64 = btoa(unescape(encodeURIComponent(sel)))
      window.go.main.App.Send(connId, `\x1b]52;c;${b64}\x07`)
    } catch {}
  }, [connId])

  const paste = useCallback(async () => {
    try { const t = await navigator.clipboard.readText(); if (t) window.go.main.App.Send(connId, t) } catch {}
  }, [connId])

  // Live-update terminal settings when config changes
  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.options.fontSize = terminalFontSize
    xterm.options.fontFamily = terminalFontFamily
    xterm.options.cursorStyle = terminalCursorStyle
    xterm.options.scrollback = terminalScrollback
    xterm.options.theme = terminalTheme
    try { xterm.refresh(0, xterm.rows) } catch {}
  }, [terminalFontSize, terminalFontFamily, terminalCursorStyle, terminalScrollback, terminalTheme])

  // Auto-focus terminal when this tab becomes active
  useEffect(() => {
    if (tab?.active) {
      const timer = setTimeout(() => xtermRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [activeTabId, tab?.active])

  // Sync highlight config to the highlighter engine
  useEffect(() => {
    hlRef.current.updateConfig({ enabled: highlightEnabled, rules: highlightRules })
  }, [highlightEnabled, highlightRules])

  useEffect(() => {
    if (!containerRef.current) return

    const xterm = new XTerm({
      cursorBlink: true, cursorStyle: terminalCursorStyle, fontSize: terminalFontSize,
      fontFamily: terminalFontFamily, scrollback: terminalScrollback,
      theme: terminalTheme, allowProposedApi: true,
    })
    xtermRef.current = xterm

    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new SearchAddon())
    try { xterm.loadAddon(new WebglAddon()) } catch {}
    const uni = new Unicode11Addon(); xterm.loadAddon(uni); xterm.unicode.activeVersion = '11'

    xterm.open(containerRef.current); fit.fit()

    // OSC 52 clipboard — intercept remote clipboard data
    try {
      xterm.parser.registerOscHandler(52, (data: string) => {
        const semi = data.indexOf(';')
        if (semi > 0) {
          try {
            const text = decodeURIComponent(escape(atob(data.slice(semi + 1))))
            navigator.clipboard.writeText(text).catch(() => {})
          } catch {}
        }
        return false
      })
    } catch {}

    // Auto-focus if this is the active tab
    const tab = useTabStore.getState().tabs.find(t => t.connId === connId)
    if (tab?.active) { setTimeout(() => xterm.focus(), 100) }
    xterm.onData(d => {
      const rec = useRecordingStore.getState()
      if (rec.active) rec.feed(d)
      const bc = useBroadcastStore.getState()
      if (bc.active) {
        if (!bc.included.has(connId)) return // excluded: ignore input
        const targets = Array.from(bc.included)
        const send = async () => {
          for (const cid of targets) {
            await window.go.main.App.Send(cid, d)
          }
        }
        send()
      } else {
        window.go.main.App.Send(connId, d)
      }
    })
    xterm.onSelectionChange(() => { const s = xterm.getSelection(); if (s) navigator.clipboard.writeText(s).catch(() => {}) })

    const ro = new ResizeObserver(() => { fit.fit(); if (xterm.rows && xterm.cols) window.go.main.App.Resize(connId, xterm.rows, xterm.cols) })
    ro.observe(containerRef.current)

    const termEl = xterm.element
    const onCtx = (e: MouseEvent) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, visible: true }) }
    termEl?.addEventListener('contextmenu', onCtx)

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const sz = (xterm.options.fontSize || 14) + (e.deltaY > 0 ? -1 : 1)
        xterm.options.fontSize = Math.max(8, Math.min(36, sz))
        fit.fit()
        if (xterm.rows && xterm.cols) {
          window.go.main.App.Resize(connId, xterm.rows, xterm.cols)
        }
      }
    }
    containerRef.current.addEventListener('wheel', onWheel, { passive: false })

    const hl = hlRef.current
    EventsOn('conn:' + connId + ':data', (d: string | Uint8Array) => {
      const raw = typeof d === 'string' ? d : new TextDecoder().decode(d)
      const processed = hl.process(raw)
      if (processed) xterm.write(processed)
    })
    EventsOn('conn:' + connId + ':state', (s: string) => {
      updateTabState(connId, s)
      if (s === 'connected') { setTimeout(() => xterm.focus(), 200) }
    })
    EventsOn('conn:' + connId + ':error', (e: string) => {
      console.error(`[${connId}]`, e)
      if (e.includes('handshake') || e.includes('auth')) {
        setTimeout(() => xterm.write('\r\nPassword: '), 300)
      }
    })

    // Register terminal-specific shortcut actions
    registerShortcutAction('copy', e => { e.preventDefault(); copy(); return true })
    registerShortcutAction('paste', e => { e.preventDefault(); paste(); return true })
    registerShortcutAction('clearBuffer', e => { e.preventDefault(); xterm.clear(); return true })
    registerShortcutAction('saveTerminal', e => {
      e.preventDefault()
      const lines: string[] = []
      const buf = xterm.buffer.active
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)
        if (line) lines.push(line.translateToString())
      }
      if (lines.length === 0) {
        setToast('终端缓冲区为空')
        setTimeout(() => setToast(null), 2500)
        return true
      }
      const content = lines.join('\n')
      const filename = (tab?.title || 'terminal').replace(/[:]/g, '_')
      SaveTerminalContent(content, filename)
        .then(() => {
          setToast('终端内容已保存')
          setTimeout(() => setToast(null), 2500)
        })
        .catch((err: any) => {
          if (!err?.toString().includes('取消')) {
            setToast('保存失败: ' + (err?.toString() || '未知错误'))
            setTimeout(() => setToast(null), 3000)
          }
        })
      return true
    })
    registerShortcutAction('selectAll', e => { e.preventDefault(); xterm.selectAll(); return true })
    registerShortcutAction('zoomIn', e => { e.preventDefault(); const sz = (xterm.options.fontSize || 14) + 1; xterm.options.fontSize = Math.max(8, Math.min(36, sz)); fit.fit(); return true })
    registerShortcutAction('zoomOut', e => { e.preventDefault(); const sz = (xterm.options.fontSize || 14) - 1; xterm.options.fontSize = Math.max(8, Math.min(36, sz)); fit.fit(); return true })
    registerShortcutAction('resetZoom', e => { e.preventDefault(); xterm.options.fontSize = terminalFontSize; fit.fit(); return true })

    xterm.attachCustomKeyEventHandler(e => {
      const shortcuts = useShortcutStore.getState().shortcuts
      const terminalActions = ['copy', 'paste', 'clearBuffer', 'saveTerminal', 'selectAll', 'find', 'zoomIn', 'zoomOut', 'resetZoom']
      for (const s of shortcuts) {
        if (!terminalActions.includes(s.id)) continue
        if (s.keys && matchShortcut(e, s.keys)) {
          const handler = getShortcutAction(s.id)
          if (handler) { handler(e) }
          return false
        }
      }
      return true
    })

    const closeCtx = () => setCtxMenu(p => ({ ...p, visible: false }))
    window.addEventListener('click', closeCtx)

    return () => {
      ro.disconnect(); containerRef.current?.removeEventListener('wheel', onWheel)
      window.removeEventListener('click', closeCtx)
      termEl?.removeEventListener('contextmenu', onCtx)
      EventsOff('conn:' + connId + ':data'); EventsOff('conn:' + connId + ':state'); EventsOff('conn:' + connId + ':error')
      xterm.dispose()
    }
  }, [connId])

  return (
    <div className="relative flex flex-col h-full bg-vscode-bg">
      <div ref={containerRef} className="flex-1 overflow-hidden" />
      {ctxMenu.visible && (
        <div className="fixed z-[100] w-44 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          {(() => {
            const sk = (id: string) => useShortcutStore.getState().shortcuts.find(s => s.id === id)?.keys || ''
            return [
              { label: '复制', action: () => { copy(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'copy' },
              { label: '粘贴', action: () => { paste(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'paste' },
              { label: '清屏', action: () => { xtermRef.current?.clear(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'clearBuffer' },
              { label: '保存终端', action: () => {
                setCtxMenu(p => ({ ...p, visible: false }))
                const buf = xtermRef.current?.buffer.active
                if (!buf || buf.length === 0) {
                  setToast('终端缓冲区为空')
                  setTimeout(() => setToast(null), 2500)
                  return
                }
                const lines: string[] = []
                for (let i = 0; i < buf.length; i++) {
                  const line = buf.getLine(i)
                  if (line) lines.push(line.translateToString())
                }
                const filename = (tab?.title || 'terminal').replace(/[:]/g, '_')
                SaveTerminalContent(lines.join('\n'), filename)
                  .then(() => {
                    setToast('终端内容已保存')
                    setTimeout(() => setToast(null), 2500)
                  })
                  .catch((err: any) => {
                    if (!err?.toString().includes('取消') && !err?.toString().includes('未选择')) {
                      setToast('保存失败: ' + (err?.toString() || '未知错误'))
                      setTimeout(() => setToast(null), 3000)
                    }
                  })
              }, kid: 'saveTerminal' },
              { label: '全选', action: () => { xtermRef.current?.selectAll(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'selectAll' },
            ].map(item => (
              <button key={item.label} onClick={item.action} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text">
                {item.label} <span className="ml-auto text-[10px] text-vscode-text-dim">{sk(item.kid)}</span>
              </button>
            ))
          })()}
        </div>
      )}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 bg-vscode-accent text-white rounded shadow-lg text-[12px] animate-pulse">
          {toast}
        </div>
      )}
    </div>
  )
}
