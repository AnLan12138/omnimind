import { useState, useEffect, useRef } from 'react'
import { Activity, Wifi, ArrowUp, ArrowDown, Clock, Cpu } from 'lucide-react'

interface Props { connId: string; onClose: () => void }

interface DataPoint { time: number; value: number }
interface Stats {
  connectedAt: number
  bytesIn: number; bytesOut: number
  reconnectCount: number
  latency: number
}

export default function MonitorPanel({ connId, onClose }: Props) {
  const [stats, setStats] = useState<Stats>({ connectedAt: Date.now(), bytesIn: 0, bytesOut: 0, reconnectCount: 0, latency: 0 })
  const [uptime, setUptime] = useState('00:00:00')
  const [latencyHistory, setLatencyHistory] = useState<DataPoint[]>([])
  const [throughputHistory, setThroughputHistory] = useState<DataPoint[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prevBytes = useRef({ in: 0, out: 0 })

  useEffect(() => {
    const iv = setInterval(() => {
      const elapsed = Math.floor((Date.now() - stats.connectedAt) / 1000)
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0')
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0')
      const s = (elapsed % 60).toString().padStart(2, '0')
      setUptime(`${h}:${m}:${s}`)

      // Simulate latency (30-80ms) and throughput
      const newLatency = 30 + Math.random() * 50
      const newThroughput = Math.max(0, (stats.bytesIn - prevBytes.current.in) / 1024)
      prevBytes.current = { in: stats.bytesIn, out: stats.bytesOut }

      const now = Date.now()
      setLatencyHistory(p => [...p.slice(-60), { time: now, value: newLatency }])
      setThroughputHistory(p => [...p.slice(-60), { time: now, value: newThroughput }])
      setStats(s => ({ ...s, latency: Math.round(newLatency) }))
    }, 1000)
    return () => clearInterval(iv)
  }, [stats.connectedAt, stats.bytesIn])

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#3c3c3c'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    // Latency line
    if (latencyHistory.length > 1) {
      ctx.strokeStyle = '#007acc'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      latencyHistory.forEach((p, i) => {
        const x = (i / latencyHistory.length) * w
        const y = h - (p.value / 100) * h
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // Throughput fill
    if (throughputHistory.length > 1) {
      ctx.fillStyle = '#4ec9b044'
      ctx.beginPath()
      const maxVal = Math.max(...throughputHistory.map(p => p.value), 1)
      throughputHistory.forEach((p, i) => {
        const x = (i / throughputHistory.length) * w
        const y = h - (p.value / maxVal) * h * 0.8
        if (i === 0) { ctx.moveTo(x, h); ctx.lineTo(x, y) }
        else { ctx.lineTo(x, y) }
        if (i === throughputHistory.length - 1) { ctx.lineTo(x, h) }
      })
      ctx.closePath(); ctx.fill()
    }
  }, [latencyHistory, throughputHistory])

  const formatBytes = (b: number) => {
    if (b < 1024) return b + ' B'
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
    return (b / 1048576).toFixed(1) + ' MB'
  }

  const rows = [
    { icon: Wifi, label: 'Status', value: 'Connected', color: 'text-vscode-green' },
    { icon: Clock, label: 'Uptime', value: uptime, color: 'text-vscode-text' },
    { icon: ArrowDown, label: 'Received', value: formatBytes(stats.bytesIn), color: 'text-vscode-blue' },
    { icon: ArrowUp, label: 'Sent', value: formatBytes(stats.bytesOut), color: 'text-vscode-orange' },
    { icon: Activity, label: 'Latency', value: stats.latency + ' ms', color: 'text-vscode-text' },
    { icon: Cpu, label: 'Reconnects', value: String(stats.reconnectCount), color: 'text-vscode-yellow' },
  ]

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar">
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border shrink-0">
        <span className="text-[11px] font-semibold text-vscode-text">Monitor</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Stats rows */}
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between py-0.5">
            <span className="flex items-center gap-1.5 text-[11px] text-vscode-text-dim">
              <r.icon size={12} />
              {r.label}
            </span>
            <span className={`text-[11px] font-mono font-medium ${r.color}`}>{r.value}</span>
          </div>
        ))}

        {/* Chart */}
        <div className="mt-2 pt-2 border-t border-vscode-border">
          <div className="text-[10px] text-vscode-text-dim mb-1 flex justify-between">
            <span><span className="inline-block w-2 h-2 rounded-full bg-vscode-accent mr-1" />Latency</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-vscode-green/40 mr-1" />Throughput</span>
          </div>
          <canvas ref={canvasRef} width={220} height={100} className="w-full h-24 bg-vscode-bg rounded border border-vscode-border" />
        </div>

        {/* Connection info */}
        <div className="pt-2 border-t border-vscode-border text-[10px] text-vscode-text-dim space-y-0.5">
          <div className="truncate">ConnID: {connId.slice(0, 12)}...</div>
        </div>
      </div>
    </div>
  )
}
