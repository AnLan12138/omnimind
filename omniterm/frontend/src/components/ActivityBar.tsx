import { Settings, SquarePlus, MessageSquare, PanelRight, LayoutGrid, Rocket, Folder, FileText, Network, Activity } from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { useI18n } from '../lib/i18n'
import { useShortcutStore } from '../stores/shortcutStore'

interface Props {
  activeView: string
  sidebarVisible: boolean
  broadcastActive: boolean
  splitActive: boolean
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
  { id: 'split', icon: PanelRight, key: 'split' },
  { id: 'macro', icon: Rocket, key: 'macros' },
  { id: 'sftp', icon: Folder, key: 'fileBrowser' },
  { id: 'tunnel', icon: Network, key: 'tunnels' },
  { id: 'monitor', icon: Activity, key: 'monitor' },
]

export default function ActivityBar({ activeView, sidebarVisible, broadcastActive, splitActive, onViewChange, onToggleBroadcast, onOpenEditor }: Props) {
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
    return (
      <button key={id} tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => onViewChange(id)} title={tip}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors relative"
        style={{ color: isActive ? accentColor : undefined }}>
        <Icon size={24} className={isActive ? '' : 'text-vscode-text-muted hover:text-white'} />
        {isActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r" style={{ background: accentColor }} />}
      </button>
    )
  }

  const multiExecSk = shortcuts.find(s => s.id === 'multiexec')?.keys || ''

  return (
    <div className="flex flex-col items-center w-12 bg-vscode-activity border-r border-vscode-border pt-1 pb-5">
      {topItems.map(({ id, icon: Icon, key }) => renderBtn(id, Icon, t(key)))}

      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onToggleBroadcast}
        title={t('multiexec') + (showShortcuts && multiExecSk ? ' (' + multiExecSk + ')' : '')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors relative"
        style={{ color: broadcastActive ? accentColor : undefined }}>
        <LayoutGrid size={24} className={broadcastActive ? '' : 'text-vscode-text-muted hover:text-white'} />
        {broadcastActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r" style={{ background: accentColor }} />}
      </button>

      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onOpenEditor} title={t('openEditor')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors">
        <FileText size={24} className="text-vscode-text-muted hover:text-white" />
      </button>

      <div className="flex-1" />
      {renderBtn('settings', Settings, t('settings'))}
    </div>
  )
}
