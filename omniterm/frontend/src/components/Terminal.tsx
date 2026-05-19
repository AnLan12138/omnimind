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

// ---------------------------------------------------------------------------
// Global xterm pool — instances survive ALL React mount/unmount cycles
// ---------------------------------------------------------------------------
type PoolEntry = { xterm: XTerm; fit: FitAddon; dispose: () => void }
const pool = new Map<string, PoolEntry>()

export function disposeTerminal(connId: string) {
  pool.get(connId)?.dispose()
  pool.delete(connId)
}

// ---------------------------------------------------------------------------
interface Props { connId: string; onDisconnect: (connId: string) => void }
interface CtxMenu { x: number; y: number; visible: boolean }

export default function Terminal({ connId, onDisconnect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const updateTabState = useTabStore(s => s.updateTabState)
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
    try { const b64 = btoa(unescape(encodeURIComponent(sel))); window.go.main.App.Send(connId, `\x1b]52;c;${b64}\x07`) } catch {}
  }, [connId])

  const paste = useCallback(async () => {
    try { const t = await navigator.clipboard.readText(); if (t) window.go.main.App.Send(connId, t) } catch {}
  }, [connId])

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

  useEffect(() => { hlRef.current.updateConfig({ enabled: highlightEnabled, rules: highlightRules }) }, [highlightEnabled, highlightRules])

  // ── Main effect: create ONCE (store in pool), re-attach on remount ──
  useEffect(() => {
    if (!containerRef.current) return

    let entry = pool.get(connId)
    let xterm: XTerm
    let fit: FitAddon

    if (entry) {
      // ── Reuse existing instance ──
      xterm = entry.xterm
      fit = entry.fit
      // Move xterm element into the new React container
      if (xterm.element && xterm.element.parentNode !== containerRef.current) {
        containerRef.current.appendChild(xterm.element)
      }
      fit.fit()
    } else {
      // ── First time: create everything ──
      xterm = new XTerm({
        cursorBlink: true, cursorStyle: terminalCursorStyle, fontSize: terminalFontSize,
        fontFamily: terminalFontFamily, scrollback: terminalScrollback, theme: terminalTheme,
        allowProposedApi: true,
      })
      fit = new FitAddon()
      xterm.loadAddon(fit)
      xterm.loadAddon(new SearchAddon())
      try { xterm.loadAddon(new WebglAddon()) } catch {}
      const uni = new Unicode11Addon(); xterm.loadAddon(uni); xterm.unicode.activeVersion = '11'
      xterm.open(containerRef.current)
      fit.fit()

      // OSC 52 clipboard
      try { xterm.parser.registerOscHandler(52, (d: string) => { const s = d.indexOf(';'); if (s > 0) { try { navigator.clipboard.writeText(decodeURIComponent(escape(atob(d.slice(s + 1))))).catch(() => {}) } catch {} } return false }) } catch {}

      // ── Data flow: each terminal has its OWN onData + EventsOn ──
      xterm.onData(d => {
        const rec = useRecordingStore.getState()
        if (rec.active) rec.feed(d)
        const bc = useBroadcastStore.getState()
        if (bc.active && bc.included.has(connId)) {
          for (const cid of Array.from(bc.included)) { window.go.main.App.Send(cid, d) }
        } else {
          window.go.main.App.Send(connId, d)
        }
      })

      const hl = hlRef.current
      const onData = (d: string | Uint8Array) => {
        const raw = typeof d === 'string' ? d : new TextDecoder().decode(d)
        const processed = hl.process(raw)
        if (processed) xterm.write(processed)
      }
      const onState = (s: string) => { updateTabState(connId, s); if (s === 'connected') { setTimeout(() => xterm.focus(), 200) } }
      const onErr = (e: string) => { console.error(`[${connId}]`, e); if (e.includes('handshake') || e.includes('auth')) { setTimeout(() => xterm.write('\r\nPassword: '), 300) } }
      EventsOn('conn:' + connId + ':data', onData)
      EventsOn('conn:' + connId + ':state', onState)
      EventsOn('conn:' + connId + ':error', onErr)

      // Shortcut actions
      registerShortcutAction('copy', e => { e.preventDefault(); copy(); return true })
      registerShortcutAction('paste', e => { e.preventDefault(); paste(); return true })
      registerShortcutAction('clearBuffer', e => { e.preventDefault(); xterm.clear(); return true })
      registerShortcutAction('selectAll', e => { e.preventDefault(); xterm.selectAll(); return true })
      registerShortcutAction('zoomIn', e => { e.preventDefault(); xterm.options.fontSize = Math.min(36, (xterm.options.fontSize || 14) + 1); fit.fit(); return true })
      registerShortcutAction('zoomOut', e => { e.preventDefault(); xterm.options.fontSize = Math.max(8, (xterm.options.fontSize || 14) - 1); fit.fit(); return true })
      registerShortcutAction('resetZoom', e => { e.preventDefault(); xterm.options.fontSize = terminalFontSize; fit.fit(); return true })
      registerShortcutAction('saveTerminal', e => {
        e.preventDefault()
        const buf = xterm.buffer.active; const lines: string[] = []
        for (let i = 0; i < buf.length; i++) { const l = buf.getLine(i); if (l) lines.push(l.translateToString()) }
        if (lines.length === 0) { setToast('终端缓冲区为空'); setTimeout(() => setToast(null), 2500); return true }
        SaveTerminalContent(lines.join('\n'), (tab?.title || 'terminal').replace(/[:]/g, '_'))
          .then(() => { setToast('终端内容已保存'); setTimeout(() => setToast(null), 2500) })
          .catch((err: any) => { if (!err?.toString().includes('取消')) { setToast('保存失败: ' + err); setTimeout(() => setToast(null), 3000) } })
        return true
      })

      xterm.attachCustomKeyEventHandler(e => {
        const shortcuts = useShortcutStore.getState().shortcuts
        const acts = ['copy', 'paste', 'clearBuffer', 'saveTerminal', 'selectAll', 'find', 'zoomIn', 'zoomOut', 'resetZoom']
        for (const s of shortcuts) { if (acts.includes(s.id) && s.keys && matchShortcut(e, s.keys)) { const h = getShortcutAction(s.id); if (h) h(e); return false } }
        return true
      })

      // Store in pool with cleanup
      entry = { xterm, fit, dispose: () => { EventsOff('conn:' + connId + ':data'); EventsOff('conn:' + connId + ':state'); EventsOff('conn:' + connId + ':error'); xterm.dispose() } }
      pool.set(connId, entry)
    }

    xtermRef.current = xterm

    // ── Per-mount setup (re-done on every mount) ──
    xterm.onSelectionChange(() => { const s = xterm.getSelection(); if (s) navigator.clipboard.writeText(s).catch(() => {}) })

    const ro = new ResizeObserver(() => { fit.fit(); if (xterm.rows && xterm.cols) window.go.main.App.Resize(connId, xterm.rows, xterm.cols) })
    ro.observe(containerRef.current)

    const termEl = xterm.element!
    const onCtx = (e: MouseEvent) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, visible: true }) }
    termEl.addEventListener('contextmenu', onCtx)

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); xterm.options.fontSize = Math.max(8, Math.min(36, (xterm.options.fontSize || 14) + (e.deltaY > 0 ? -1 : 1))); fit.fit(); if (xterm.rows && xterm.cols) window.go.main.App.Resize(connId, xterm.rows, xterm.cols) }
    }
    containerRef.current.addEventListener('wheel', onWheel, { passive: false })

    const tabSt = useTabStore.getState().tabs.find(t => t.connId === connId)
    if (tabSt?.active) { setTimeout(() => xterm.focus(), 50) }

    const closeCtx = () => setCtxMenu(p => ({ ...p, visible: false }))
    window.addEventListener('click', closeCtx)

    return () => {
      ro.disconnect()
      containerRef.current?.removeEventListener('wheel', onWheel)
      window.removeEventListener('click', closeCtx)
      termEl.removeEventListener('contextmenu', onCtx)
      // ★ NEVER dispose xterm — keep it alive in the pool
      // Just detach from DOM so React can remove the container
      if (containerRef.current && xterm.element && containerRef.current.contains(xterm.element)) {
        try { containerRef.current.removeChild(xterm.element) } catch {}
      }
    }
  }, [connId])

  return (
    <div className="relative flex flex-col h-full bg-vscode-bg">
      <div ref={containerRef} className="flex-1 overflow-hidden" onClick={() => xtermRef.current?.focus()} />
      {ctxMenu.visible && (
        <div className="fixed z-[100] w-44 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          {(() => {
            const sk = (id: string) => useShortcutStore.getState().shortcuts.find(s => s.id === id)?.keys || ''
            return [
              { label: '复制', action: () => { copy(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'copy' },
              { label: '粘贴', action: () => { paste(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'paste' },
              { label: '清屏', action: () => { xtermRef.current?.clear(); setCtxMenu(p => ({ ...p, visible: false })) }, kid: 'clearBuffer' },
              { label: '保存终端', action: () => { setCtxMenu(p => ({ ...p, visible: false })); const b = xtermRef.current?.buffer.active; if (!b || b.length === 0) { setToast('终端缓冲区为空'); setTimeout(() => setToast(null), 2500); return } const ls: string[] = []; for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) ls.push(l.translateToString()) } SaveTerminalContent(ls.join('\n'), (tab?.title || 'terminal').replace(/[:]/g, '_')).then(() => { setToast('终端内容已保存'); setTimeout(() => setToast(null), 2500) }).catch((err: any) => { if (!err?.toString().includes('取消') && !err?.toString().includes('未选择')) { setToast('保存失败: ' + err); setTimeout(() => setToast(null), 3000) } }) }, kid: 'saveTerminal' },
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
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 bg-vscode-accent text-white rounded shadow-lg text-[12px] animate-pulse">{toast}</div>
      )}
    </div>
  )
}
