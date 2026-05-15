import { Settings, SquarePlus, MessageSquare, PanelRight, LayoutGrid, Rocket, Folder, FileText } from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { useI18n } from '../lib/i18n'

interface Props {
  activeView: string
  sidebarVisible: boolean
  broadcastActive: boolean
  onViewChange: (view: string) => void
  onToggleBroadcast: () => void
  onOpenEditor: () => void
}

const topItems = [
  { id: 'new', icon: SquarePlus, key: 'newSession', sk: 'Ctrl+N' },
  { id: 'sessions', icon: MessageSquare, key: 'sessions', sk: 'Ctrl+Shift+E' },
  { id: 'split', icon: PanelRight, key: 'split', sk: 'Ctrl+Shift+O' },
  { id: 'macro', icon: Rocket, key: 'macros', sk: '' },
  { id: 'sftp', icon: Folder, key: 'fileBrowser', sk: '' },
]

export default function ActivityBar({ activeView, sidebarVisible, broadcastActive, onViewChange, onToggleBroadcast, onOpenEditor }: Props) {
  const accentColor = useConfigStore(s => s.accentColor)
  const showShortcuts = useConfigStore(s => s.showShortcuts)
  const { t } = useI18n()

  const renderBtn = (id: string, Icon: any, label: string, sk?: string) => {
    const isActive = id === 'sessions' ? sidebarVisible : activeView === id
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

  return (
    <div className="flex flex-col items-center w-12 bg-vscode-activity border-r border-vscode-border pt-1 pb-5">
      {topItems.map(({ id, icon: Icon, key, sk }) => renderBtn(id, Icon, t(key), sk))}

      {/* MultiExec — independent toggle, not part of activeView */}
      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onToggleBroadcast} title={t('multiexec') + (showShortcuts ? ' (Ctrl+Shift+M)' : '')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors relative"
        style={{ color: broadcastActive ? accentColor : undefined }}>
        <LayoutGrid size={24} className={broadcastActive ? '' : 'text-vscode-text-muted hover:text-white'} />
        {broadcastActive && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r" style={{ background: accentColor }} />}
      </button>

      {/* External Text Editor launcher */}
      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={onOpenEditor} title={t('openEditor')}
        className="w-10 h-10 flex items-center justify-center rounded transition-colors">
        <FileText size={24} className="text-vscode-text-muted hover:text-white" />
      </button>

      <div className="flex-1" />
      {renderBtn('settings', Settings, t('settings'), 'Ctrl+,')}
    </div>
  )
}
