import { useState, useEffect } from 'react'
/*
 * StatusBar.tsx — 软件底部状态栏
 * ==========================================
 * 显示内容（从左到右）：
 *   连接状态(WiFi图标) | 协议类型 | 设备标题
 *   ─── flex-1 ───
 *   在线时长 | ↓下载 KB/s | ↑上传 KB/s | 延迟 ms | 时钟
 *
 * 特性：
 *   - 延迟数字可点击打开/关闭完整监控面板
 *   - 每2秒轮询延迟并更新监控数据(uptime/bandwidth)
 *   - 连接监控数据来自 monitorStore
 */
import { useTabStore } from '../stores/tabStore'
import { useMonitorStore } from '../stores/monitorStore'
import { useI18n } from '../lib/i18n'
import { GetLatency } from '../../wailsjs/go/main/App'
import { Wifi, WifiOff, Activity, Clock, ArrowDown, ArrowUp } from 'lucide-react'

function formatBytes(b: number) {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

interface Props {
  onTogglePanel: () => void
  panelVisible: boolean
  onMonitor: () => void
}

export default function StatusBar({ onTogglePanel, panelVisible, onMonitor }: Props) {
  const tab = useTabStore(s => s.getActiveTab())
  const { t } = useI18n()
  const [time, setTime] = useState(new Date())
  const [latency, setLatency] = useState(0)
  const { stats, initConn, addLatencySample, tickUptime } = useMonitorStore()
  const st = tab?.connId ? stats[tab.connId] : undefined

  useEffect(() => { const iv = setInterval(() => setTime(new Date()), 60000); return () => clearInterval(iv) }, [])

  useEffect(() => {
    if (!tab?.connId || tab.state !== 'connected') { setLatency(0); return }
    if (!stats[tab.connId]) initConn(tab.connId)
    const iv = setInterval(async () => {
      try {
        const ms = await GetLatency(tab.connId)
        setLatency(ms)
        addLatencySample(tab.connId, ms)
      } catch { setLatency(0) }
      tickUptime(tab.connId)
    }, 2000)
    return () => clearInterval(iv)
  }, [tab?.connId, tab?.state])

  return (
    <div className="flex items-center h-6 px-2 bg-vscode-status text-white/90 text-[11px] select-none shrink-0">
      {/* Connection state */}
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

      {/* Monitor data — always visible in status bar */}
      <div className="flex items-center gap-3 text-white/70">
        {tab?.state === 'connected' && (
          <>
            {/* Uptime */}
            <span className="flex items-center gap-1">
              <Clock size={10} />
              <span>{st ? formatUptime(st.uptime) : '00:00:00'}</span>
            </span>
            <span className="text-white/30">|</span>

            {/* Bandwidth down */}
            <span className="flex items-center gap-1">
              <ArrowDown size={10} />
              <span>{st ? `${(st.bandwidthIn / 1024).toFixed(1)} KB/s` : '--'}</span>
            </span>
            <span className="text-white/30">|</span>

            {/* Bandwidth up */}
            <span className="flex items-center gap-1">
              <ArrowUp size={10} />
              <span>{st ? `${(st.bandwidthOut / 1024).toFixed(1)} KB/s` : '--'}</span>
            </span>
            <span className="text-white/30">|</span>

            {/* Latency */}
            <span onClick={onMonitor} title={t('monitor')} className="flex items-center gap-1 cursor-pointer hover:text-white transition-colors">
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
