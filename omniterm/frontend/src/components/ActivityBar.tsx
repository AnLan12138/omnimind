import React from 'react'
/*
 * ActivityBar.tsx — 左侧图标工具栏
 * ==========================================
 * 布局顺序：
 *   新建会话 ═══ 分隔线 ═══
 *   设备管理 / 活跃会话 / 快捷指令 / 文件管理 / 隧道
 *   ─── 分隔线 ───
 *   分屏视图 / 多路广播 / 文本编辑器
 *   ─── flex-1 ───
 *   设置
 *
 * 特性：
 *   - 分屏/广播按钮在设备<2时自动变灰(opacity 0.3)并不可用
 *   - 活跃icon带左侧蓝色竖条指示器
 *   - 支持中英文切换（i18n）
 */
import { Settings, SquarePlus, MessageSquare, Monitor, PanelRight, LayoutGrid, Rocket, Folder, FileText, Network } from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { useI18n } from '../lib/i18n'
import { useShortcutStore } from '../stores/shortcutStore'

interface Props {
  activeView: string
  sidebarVisible: boolean
  broadcastActive: boolean
  splitActive: boolean
  connectedCount: number
  onViewChange: (view: string) => void
  onToggleBroadcast: () => void
  onOpenEditor: () => void
}

// Map button ids to shortcut ids for tooltip display
const shortcutMap: Record<string, string> = {
  new: 'newSession', sessions: 'toggleSidebar', split: 'splitHorizontal',
  settings: 'settings',
}

const topItems = [
  { id: 'new', icon: SquarePlus, key: 'newSession' },
  { id: 'sessions', icon: MessageSquare, key: 'sessions' },
  { id: 'connected', icon: Monitor, key: 'activeSessions' },
  { id: 'macro', icon: Rocket, key: 'macros' },
  { id: 'sftp', icon: Folder, key: 'fileBrowser' },
  { id: 'tunnel', icon: Network, key: 'tunnels' },
]

const middleItems = [
  { id: 'split', icon: PanelRight, key: 'split' },
]

export default function ActivityBar({ activeView, sidebarVisible, broadcastActive, splitActive, connectedCount, onViewChange, onToggleBroadcast, onOpenEditor }: Props) {
  const accentColor = useConfigStore(s => s.accentColor)
  const showShortcuts = useConfigStore(s => s.showShortcuts)
  const { t } = useI18n()
  const shortcuts = useShortcutStore(s => s.shortcuts)

  const getSk = (id: string) => {
    const sid = shortcutMap[id]
    if (!sid) return ''
    return shortcuts.find(s => s.id === sid)?.keys || ''
  }

  const renderBtn = (id: string, Icon: any, label: string) => {
    const isActive = id === 'sessions' ? sidebarVisible : id === 'split' ? splitActive : activeView === id
    const sk = getSk(id)
    const tip = label + (showShortcuts && sk ? ' (' + sk + ')' : '')
    const dim = id === 'split' && connectedCount < 2 && !isActive
    return (
      <button key={id} tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => onViewChange(id)} title={tip}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors relative"
        style={{ color: isActive ? accentColor : undefined, opacity: dim ? 0.3 : 1 }}>
        <Icon size={24} className={isActive ? '' : dim ? 'text-vscode-text-muted' : 'text-vscode-text-muted hover:text-white'} />
        {isActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r" style={{ background: accentColor }} />}
      </button>
    )
  }

  const multiExecSk = shortcuts.find(s => s.id === 'multiexec')?.keys || ''

  return (
    <div className="flex flex-col items-center w-12 bg-vscode-activity border-r border-vscode-border pt-1 pb-5">
      {topItems.map(({ id, icon: Icon, key }, idx) => (
        <React.Fragment key={id}>
          {renderBtn(id, Icon, t(key))}
          {idx === 0 && <div className="w-8 h-[1px] bg-white/20 my-1" />}
        </React.Fragment>
      ))}

      {/* Separator before utility group */}
      <div className="w-8 h-[1px] bg-white/10 my-2" />

      {/* Split view */}
      {renderBtn('split', PanelRight, t('split'))}

      {/* MultiExec broadcast */}
      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onToggleBroadcast}
        title={t('multiexec') + (showShortcuts && multiExecSk ? ' (' + multiExecSk + ')' : '')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors relative"
        style={{ color: broadcastActive ? accentColor : undefined, opacity: connectedCount < 2 && !broadcastActive ? 0.3 : 1 }}>
        <LayoutGrid size={24} className={broadcastActive ? '' : connectedCount >= 2 ? 'text-vscode-text-muted hover:text-white' : 'text-vscode-text-muted'} />
        {broadcastActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r" style={{ background: accentColor }} />}
      </button>

      {/* Editor */}
      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onOpenEditor} title={t('openEditor')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors">
        <FileText size={24} className="text-vscode-text-muted hover:text-white" />
      </button>

      <div className="flex-1" />
      {renderBtn('settings', Settings, t('settings'))}
    </div>
  )
}
