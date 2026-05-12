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
import { useRecordingStore } from '../stores/recordingStore'

interface Props { connId: string; onDisconnect: (connId: string) => void }
interface CtxMenu { x: number; y: number; visible: boolean }

export default function Terminal({ connId, onDisconnect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const updateTabState = useTabStore(s => s.updateTabState)
  const terminalTheme = useThemeStore(s => s.theme)
  const terminalFontSize = useConfigStore(s => s.terminalFontSize)
  const terminalFontFamily = useConfigStore(s => s.terminalFontFamily)
  const terminalCursorStyle = useConfigStore(s => s.cursorStyle)
  const terminalScrollback = useConfigStore(s => s.scrollback)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu>({ x: 0, y: 0, visible: false })

  const copy = useCallback(() => {
    const sel = xtermRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel).catch(() => {})
  }, [])

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
    xterm.onData(d => {
      const rec = useRecordingStore.getState()
      if (rec.active) rec.feed(d)
      window.go.main.App.Send(connId, d)
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

    EventsOn('conn:' + connId + ':data', (d: string | Uint8Array) => {
      xterm.write(typeof d === 'string' ? d : new TextDecoder().decode(d))
    })
    EventsOn('conn:' + connId + ':state', (s: string) => { updateTabState(connId, s) })
    EventsOn('conn:' + connId + ':error', (e: string) => { console.error(`[${connId}]`, e) })

    xterm.attachCustomKeyEventHandler(e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') { copy(); return false }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') { paste(); return false }
      if (e.ctrlKey && e.shiftKey && e.key === 'F') return false
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
    <div className="flex flex-col h-full bg-vscode-bg">
      <div ref={containerRef} className="flex-1 overflow-hidden" />
      {ctxMenu.visible && (
        <div className="fixed z-[100] w-40 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          {[
            { label: 'Copy', action: () => { copy(); setCtxMenu(p => ({ ...p, visible: false })) }, key: 'Ctrl+Shift+C' },
            { label: 'Paste', action: () => { paste(); setCtxMenu(p => ({ ...p, visible: false })) }, key: 'Ctrl+Shift+V' },
            { label: 'Clear Buffer', action: () => { xtermRef.current?.clear(); setCtxMenu(p => ({ ...p, visible: false })) }, key: '' },
            { label: 'Select All', action: () => { xtermRef.current?.selectAll(); setCtxMenu(p => ({ ...p, visible: false })) }, key: '' },
          ].map(item => (
            <button key={item.label} onClick={item.action} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text">
              {item.label} <span className="ml-auto text-[10px] text-vscode-text-dim">{item.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
