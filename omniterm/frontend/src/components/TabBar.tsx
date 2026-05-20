import { useState, useRef } from 'react'
/*
 * TabBar.tsx — 终端顶部标签栏
 * ==========================================
 * 特性：
 *   - 标签过多时自动缩小（shrink）如浏览器标签
 *   - 双击标签关闭设备
 *   - 点击标签切换设备并自动聚焦对应 xterm（getPoolXterm + focus）
 *   - 拖拽重排序标签
 *   - 右键菜单：克隆标签 / 关闭
 */
import { X, Pencil, Copy } from 'lucide-react'
import { useTabStore, type Tab } from '../stores/tabStore'
import { getPoolXterm } from './Terminal'

const stateColors: Record<string, string> = {
  connected: '#4ec9b0', connecting: '#cca700', reconnecting: '#cca700', error: '#f44747', disconnected: '#6a6a6a',
}

interface Props { onCloneTab?: (tab: Tab) => void }

export default function TabBar({ onCloneTab }: Props) {
  const { tabs, activeTabId, setActive, removeTab, reorderTabs } = useTabStore()
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [ctxTab, setCtxTab] = useState<{ tab: Tab; x: number; y: number } | null>(null)

  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx !== null && dragIdx !== idx) { reorderTabs(dragIdx, idx); setDragIdx(idx) }
  }
  const handleDragEnd = () => setDragIdx(null)
  const handleCtx = (e: React.MouseEvent, tab: Tab) => { e.preventDefault(); setCtxTab({ tab, x: e.clientX, y: e.clientY }) }

  const handleTabClick = (tab: Tab) => {
    setActive(tab.id)
    // Auto-focus the xterm for this tab
    setTimeout(() => {
      const xterm = getPoolXterm(tab.connId)
      if (xterm) xterm.focus()
    }, 100)
  }

  return (
    <>
      <div className="flex items-center h-9 bg-vscode-tab-inactive overflow-hidden" onClick={() => setCtxTab(null)}>
        {tabs.map((tab, idx) => (
          <div key={tab.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            onClick={() => handleTabClick(tab)}
            onDoubleClick={e => { e.stopPropagation(); removeTab(tab.id) }}
            onContextMenu={e => handleCtx(e, tab)}
            className={`group flex items-center gap-1.5 h-9 px-2 cursor-pointer text-[12px] border-r border-vscode-border select-none shrink transition-colors min-w-[40px]
              ${tab.active ? 'bg-vscode-tab-active text-white border-t border-t-vscode-accent border-b-transparent -mb-px' : 'text-vscode-text-muted hover:bg-vscode-hover border-t border-t-transparent'}
              ${dragIdx === idx ? 'opacity-50' : ''}`}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: stateColors[tab.state] || stateColors.disconnected }} />
            <span className="truncate max-w-[120px]">{tab.title}</span>
            <button onClick={e => { e.stopPropagation(); removeTab(tab.id) }}
              className="p-1 rounded hover:bg-vscode-red/20 opacity-0 group-hover:opacity-100 ml-0.5">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {ctxTab && (
        <div className="fixed z-50 w-36 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctxTab.x, top: ctxTab.y }}
          onClick={() => setCtxTab(null)}>
          <button onClick={() => { onCloneTab?.(ctxTab.tab); setCtxTab(null) }}
            className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text">
            <Copy size={11} /> Clone Tab
          </button>
          <button onClick={() => { removeTab(ctxTab.tab.id); setCtxTab(null) }}
            className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red">
            <X size={11} /> Close
          </button>
        </div>
      )}
    </>
  )
}
