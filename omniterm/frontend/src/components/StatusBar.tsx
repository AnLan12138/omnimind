import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../lib/i18n'
import { Wifi, WifiOff, PanelRight } from 'lucide-react'

interface Props {
  onTogglePanel: () => void
  panelVisible: boolean
}

export default function StatusBar({ onTogglePanel, panelVisible }: Props) {
  const tab = useTabStore(s => s.getActiveTab())
  const { t } = useI18n()

  return (
    <div className="flex items-center h-6 px-2 bg-vscode-status text-white/90 text-[11px] select-none shrink-0">
      <div className="flex items-center gap-2">
        {tab ? (
          <>
            {tab.state === 'connected' ? <Wifi size={11} /> : tab.state === 'connecting' || tab.state === 'reconnecting' ? <WifiOff size={11} className="animate-pulse" /> : <WifiOff size={11} />}
            <span className="text-white/70">{t(tab.state)}</span>
            <span className="text-white/30">|</span>
            <span>{tab.protocol.toUpperCase()}</span>
            <span className="text-white/30">|</span>
            <span className="truncate max-w-[160px]">{tab.title}</span>
          </>
        ) : (
          <span className="text-white/60">{t('noActiveConnection')}</span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 text-white/70">
        <button onClick={onTogglePanel} className={`flex items-center gap-1 hover:text-white transition-colors ${panelVisible ? 'text-white' : ''}`}>
          <PanelRight size={11} />
          <span>{t('panel')}</span>
        </button>
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}
