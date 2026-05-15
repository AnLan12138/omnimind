import { useEffect, useState } from 'react'
import { Activity, Wifi, Clock, ArrowDown, ArrowUp } from 'lucide-react'
import { useTabStore } from '../stores/tabStore'
import { useMonitorStore } from '../stores/monitorStore'
import { GetLatency } from '../../wailsjs/go/main/App'

interface Props { onClose: () => void }

function formatBytes(b: number) {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

function formatUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function LatencyChart({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="text-[10px] text-vscode-text-dim">数据不足</div>
  const max = Math.max(...data, 1)
  const w = 200, h = 60, pad = 4
  const points = data.map((v, i) => `${pad + (i / (data.length - 1)) * (w - pad * 2)},${h - pad - (v / max) * (h - pad * 2)}`).join(' ')
  return (
    <svg width={w} height={h} className="block">
      <polyline points={points} fill="none" stroke="#4ec9b0" strokeWidth="1.5" />
    </svg>
  )
}

export default function MonitorPanel({ onClose }: Props) {
  const tabs = useTabStore(s => s.tabs)
  const activeTab = tabs.find(t => t.active && t.state === 'connected')
  const connId = activeTab?.connId
  const { stats, initConn, addLatencySample, tickUptime } = useMonitorStore()
  const st = connId ? stats[connId] : undefined
  const [autoPoll, setAutoPoll] = useState(true)

  useEffect(() => {
    if (!connId) return
    if (!stats[connId]) initConn(connId)
  }, [connId])

  useEffect(() => {
    if (!connId || !autoPoll) return
    const interval = setInterval(async () => {
      try {
        const ms = await GetLatency(connId)
        addLatencySample(connId, ms)
      } catch {}
      tickUptime(connId)
    }, 2000)
    return () => clearInterval(interval)
  }, [connId, autoPoll])

  if (!connId) {
    return (
      <div className="flex flex-col h-full bg-vscode-sidebar">
        <div className="text-center text-[11px] text-vscode-text-dim py-8 px-3">没有活动连接可监控</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar overflow-y-auto">
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-vscode-text">监控</span>
        <button onClick={() => setAutoPoll(!autoPoll)}
          className={`text-[9px] px-1.5 py-0.5 rounded ${autoPoll ? 'bg-[#4ec9b022] text-[#4ec9b0]' : 'bg-gray-500/20 text-vscode-text-dim'}`}>
          {autoPoll ? '轮询中' : '已暂停'}
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Connection info */}
        <div>
          <div className="text-[9px] uppercase text-vscode-text-dim mb-1">连接</div>
          <div className="text-[12px] text-vscode-text">{activeTab.protocol.toUpperCase()} · {activeTab.title}</div>
        </div>

        {/* Latency */}
        <div>
          <div className="flex items-center gap-1 text-[9px] uppercase text-vscode-text-dim mb-1"><Activity size={10} /> 延迟</div>
          <div className="text-[16px] font-mono text-white">{st?.latency?.slice(-1)[0] ?? '-'}<span className="text-[10px] text-vscode-text-dim"> ms</span></div>
          {st?.latency && <LatencyChart data={st.latency} />}
        </div>

        {/* Uptime */}
        <div>
          <div className="flex items-center gap-1 text-[9px] uppercase text-vscode-text-dim mb-1"><Clock size={10} /> 在线时长</div>
          <div className="text-[14px] font-mono text-vscode-text">{st ? formatUptime(st.uptime) : '--:--:--'}</div>
        </div>

        {/* Bandwidth */}
        <div>
          <div className="flex items-center gap-1 text-[9px] uppercase text-vscode-text-dim mb-1"><ArrowDown size={10} /> 流量</div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-vscode-input rounded p-1.5">
              <div className="text-vscode-text-dim">下载</div>
              <div className="text-vscode-text font-mono text-[11px]">{st ? formatBytes(st.bytesIn) : '-'}</div>
            </div>
            <div className="bg-vscode-input rounded p-1.5">
              <div className="text-vscode-text-dim">上传</div>
              <div className="text-vscode-text font-mono text-[11px]">{st ? formatBytes(st.bytesOut) : '-'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
            <div className="text-vscode-text-dim">↓ {st ? (st.bandwidthIn / 1024).toFixed(1) : '-'} KB/s</div>
            <div className="text-vscode-text-dim">↑ {st ? (st.bandwidthOut / 1024).toFixed(1) : '-'} KB/s</div>
          </div>
        </div>
      </div>
    </div>
  )
}
