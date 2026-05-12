import { FolderOpen, Settings, MonitorPlay, SplitSquareVertical, Zap, FolderSync, Network, Activity } from 'lucide-react'
import { useConfigStore } from '../stores/configStore'
import { useI18n } from '../lib/i18n'

interface Props {
  activeView: string
  sidebarVisible: boolean
  onViewChange: (view: string) => void
}

const topItems = [
  { id: 'new', icon: MonitorPlay, key: 'newSession', sk: 'Ctrl+N' },
  { id: 'sessions', icon: FolderOpen, key: 'sessions', sk: 'Ctrl+Shift+E' },
  { id: 'split', icon: SplitSquareVertical, key: 'split', sk: 'Ctrl+Shift+O' },
  { id: 'macro', icon: Zap, key: 'macros', sk: '' },
  { id: 'sftp', icon: FolderSync, key: 'fileBrowser', sk: '' },
  { id: 'tunnel', icon: Network, key: 'sshTunnels', sk: '' },
  { id: 'monitor', icon: Activity, key: 'monitor', sk: '' },
]

export default function ActivityBar({ activeView, sidebarVisible, onViewChange }: Props) {
  const accentColor = useConfigStore(s => s.accentColor)
  const showShortcuts = useConfigStore(s => s.showShortcuts)
  const { t } = useI18n()

  const renderBtn = (id: string, Icon: any, label: string, sk?: string) => {
    const isActive = id === 'sessions' ? sidebarVisible : activeView === id
    const tip = label + (showShortcuts && sk ? ' (' + sk + ')' : '')
    return (
      <button key={id} onClick={() => onViewChange(id)} title={tip}
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
      <div className="flex-1" />
      {renderBtn('settings', Settings, t('settings'), 'Ctrl+,')}
    </div>
  )
}
