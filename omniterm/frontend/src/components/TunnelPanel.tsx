import { useState } from 'react'
import { ArrowLeftRight, X, Plus, Play, Square } from 'lucide-react'
import { StartLocalForward, StartRemoteForward, StartSOCKS5Proxy } from '../../wailsjs/go/main/App'

interface Props {
  connId: string
  onClose: () => void
}

interface Tunnel {
  id: string
  type: 'local' | 'remote' | 'socks5'
  label: string
  running: boolean
}

export default function TunnelPanel({ connId, onClose }: Props) {
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [showForm, setShowForm] = useState(false)
  const [tunType, setTunType] = useState<'local' | 'remote' | 'socks5'>('local')
  const [localPort, setLocalPort] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePort, setRemotePort] = useState('')

  const handleStart = async () => {
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 8)
    const lp = parseInt(localPort) || 0
    const rp = parseInt(remotePort) || 0

    try {
      if (tunType === 'local') {
        await StartLocalForward(connId, lp, remoteHost, rp)
        setTunnels([...tunnels, {
          id, type: 'local',
          label: `127.0.0.1:${lp} → ${remoteHost}:${rp}`,
          running: true,
        }])
      } else if (tunType === 'remote') {
        await StartRemoteForward(connId, rp, remoteHost || 'localhost', lp)
        setTunnels([...tunnels, {
          id, type: 'remote',
          label: `0.0.0.0:${rp} → ${remoteHost || 'localhost'}:${lp}`,
          running: true,
        }])
      } else if (tunType === 'socks5') {
        await StartSOCKS5Proxy(connId, lp)
        setTunnels([...tunnels, {
          id, type: 'socks5',
          label: `SOCKS5 127.0.0.1:${lp}`,
          running: true,
        }])
      }
      setShowForm(false)
      setLocalPort('')
      setRemoteHost('')
      setRemotePort('')
    } catch (err: any) {
      console.error('Tunnel failed:', err)
    }
  }

  const handleStop = (id: string) => {
    setTunnels(tunnels.filter((t) => t.id !== id))
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-t border-border">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <ArrowLeftRight size={13} className="text-accent" />
        <span className="text-xs font-semibold text-text-secondary">Tunnels</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-2 py-0.5 bg-accent hover:bg-accent-hover text-white rounded text-[10px] transition-colors"
        >
          <Plus size={10} /> Add
        </button>
        <button onClick={onClose} className="p-0.5 hover:bg-bg-hover rounded">
          <X size={12} className="text-text-muted" />
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="px-3 py-2 border-b border-border space-y-2 bg-bg-tertiary">
          <div className="flex gap-1">
            {(['local', 'remote', 'socks5'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTunType(t)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  tunType === t ? 'bg-accent/20 text-accent' : 'bg-bg-secondary text-text-muted hover:bg-bg-hover'
                }`}
              >
                {t === 'local' ? '-L' : t === 'remote' ? '-R' : '-D'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {tunType !== 'socks5' ? (
              <>
                <input
                  type="text" placeholder="Local port"
                  value={localPort} onChange={(e) => setLocalPort(e.target.value)}
                  className="w-20 px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
                />
                <span className="text-text-muted text-[10px]">
                  {tunType === 'local' ? '→' : '←'}
                </span>
                <input
                  type="text" placeholder={tunType === 'local' ? 'remote-host' : 'local-host'}
                  value={remoteHost} onChange={(e) => setRemoteHost(e.target.value)}
                  className="flex-1 px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
                />
                <span className="text-text-muted text-[10px]">:</span>
                <input
                  type="text" placeholder="port"
                  value={remotePort} onChange={(e) => setRemotePort(e.target.value)}
                  className="w-16 px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
                />
              </>
            ) : (
              <input
                type="text" placeholder="SOCKS5 port (e.g. 1080)"
                value={localPort} onChange={(e) => setLocalPort(e.target.value)}
                className="flex-1 px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            )}
            <button
              onClick={handleStart}
              disabled={!localPort || (!tunType.includes('socks5') && (!remoteHost || !remotePort))}
              className="px-3 py-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded text-[10px] transition-colors"
            >
              <Play size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Active tunnels */}
      <div className="flex-1 overflow-y-auto">
        {tunnels.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[10px] text-text-muted">
            No active tunnels. Click "Add" to create one.
          </div>
        ) : (
          tunnels.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
              <span className="text-text-muted w-8 shrink-0">
                {t.type === 'local' ? '-L' : t.type === 'remote' ? '-R' : '-D'}
              </span>
              <span className="flex-1 text-text-secondary font-mono text-[10px]">{t.label}</span>
              <button onClick={() => handleStop(t.id)} className="p-0.5 hover:bg-red-500/10 rounded">
                <Square size={10} className="text-red-400" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
