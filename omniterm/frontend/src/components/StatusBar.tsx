import { useState, useEffect } from 'react'
import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../lib/i18n'
import { GetLatency } from '../../wailsjs/go/main/App'
import { Wifi, WifiOff, Activity } from 'lucide-react'

interface Props {
  onTogglePanel: () => void
  panelVisible: boolean
}

export default function StatusBar({ onTogglePanel, panelVisible }: Props) {
  const tab = useTabStore(s => s.getActiveTab())
  const { t } = useI18n()
  const [time, setTime] = useState(new Date())
  const [latency, setLatency] = useState(0)

  useEffect(() => { const iv = setInterval(() => setTime(new Date()), 60000); return () => clearInterval(iv) }, [])

  useEffect(() => {
    if (tab?.state !== 'connected') { setLatency(0); return }
    const iv = setInterval(async () => {
      try { setLatency(await GetLatency(tab.connId)) } catch { setLatency(0) }
    }, 5000)
    return () => clearInterval(iv)
  }, [tab?.connId, tab?.state])

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
        {/* Monitor info in status bar */}
        {tab?.state === 'connected' && (
          <>
            <span className="flex items-center gap-1">
              <Activity size={10} />
              <span>{latency > 0 ? `${latency} ms` : '-- ms'}</span>
            </span>
            <span className="text-white/30">|</span>
          </>
        )}
        <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}
