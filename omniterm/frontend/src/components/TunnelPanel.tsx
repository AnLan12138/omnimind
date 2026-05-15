import { useState } from 'react'
import { Plus, Trash2, Play, Square, ArrowRightLeft, ArrowRight, Network } from 'lucide-react'
import { useTabStore } from '../stores/tabStore'
import { StartSSHTunnel, StopSSHTunnel } from '../../wailsjs/go/main/App'
import FormDialog from './FormDialog'

interface TunnelInfo {
  id: string; connId: string; ttype: number; localAddr: string; remoteAddr: string; status: string
}

const TYPE_LABELS = ['-L (本地)', '-R (远程)', '-D (SOCKS5)']

interface Props { searchTerm: string; onClose: () => void }

export default function TunnelPanel({ searchTerm, onClose }: Props) {
  const tabs = useTabStore(s => s.tabs)
  const connectedTabs = tabs.filter(t => t.state === 'connected' && t.protocol === 'ssh')
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([])
  const [dialog, setDialog] = useState(false)
  const [ttype, setTType] = useState(0)
  const [localAddr, setLocalAddr] = useState('')
  const [remoteAddr, setRemoteAddr] = useState('')
  const [connId, setConnId] = useState(connectedTabs[0]?.connId || '')

  const startTunnel = async () => {
    if (!connId || !localAddr) return
    const id = Date.now().toString(36)
    const info: TunnelInfo = { id, connId, ttype, localAddr, remoteAddr, status: 'starting' }
    setTunnels(prev => [...prev, info])
    try {
      await StartSSHTunnel(connId, id, ttype, localAddr, remoteAddr)
      setTunnels(prev => prev.map(t => t.id === id ? { ...t, status: 'running' } : t))
    } catch (err: any) {
      setTunnels(prev => prev.map(t => t.id === id ? { ...t, status: 'error:' + (err?.message || err) } : t))
    }
    setDialog(false)
  }

  const stopTunnel = async (t: TunnelInfo) => {
    try {
      await StopSSHTunnel(t.connId, t.id)
      setTunnels(prev => prev.filter(x => x.id !== t.id))
    } catch {}
  }

  const filtered = tunnels.filter(t => !searchTerm || t.localAddr.includes(searchTerm) || t.remoteAddr.includes(searchTerm))
  const typeIcons = [<ArrowRightLeft size={14} />, <ArrowRight size={14} />, <Network size={14} />]
  const typeColors = ['#569cd6', '#4ec9b0', '#ce9178']

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar">
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-vscode-text">隧道</span>
        <button onClick={() => { setDialog(true); if (connectedTabs[0]?.connId && !connId) setConnId(connectedTabs[0].connId) }}
          className="flex items-center gap-0.5 px-1.5 h-5 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px]">
          <Plus size={10} /> 新建
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {connectedTabs.length === 0 && (
          <div className="text-center text-[11px] text-vscode-text-dim py-8 px-3">需要先连接 SSH 会话</div>
        )}
        {filtered.map(t => (
          <div key={t.id} className="flex items-center gap-2 h-10 px-3 border-b border-vscode-border/30 hover:bg-vscode-hover">
            <span style={{ color: typeColors[t.ttype] || '#858585' }}>{typeIcons[t.ttype]}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-vscode-text truncate">
                {t.ttype === 2 ? `${t.localAddr}` : `${t.localAddr} → ${t.remoteAddr}`}
              </div>
              <div className="text-[9px] text-vscode-text-dim">
                {TYPE_LABELS[t.ttype]} · {t.status === 'running' ? <span className="text-[#4ec9b0]">运行中</span> : t.status}
              </div>
            </div>
            <button onClick={() => stopTunnel(t)} className="p-1 hover:bg-vscode-hover rounded">
              <Square size={12} className="text-vscode-red" />
            </button>
          </div>
        ))}
        {connectedTabs.length > 0 && filtered.length === 0 && (
          <div className="text-center text-[11px] text-vscode-text-dim py-8">无隧道</div>
        )}
      </div>

      {dialog && (
        <FormDialog title="新建隧道" confirmLabel="启动" confirmDisabled={!localAddr || !connId}
          fields={[
            { label: 'SSH 连接', value: connId, set: setConnId, placeholder: '', type: 'select', selectOptions: connectedTabs.map(ct => ({ value: ct.connId, label: ct.title })) },
            { label: '类型', value: String(ttype), set: (v: string) => setTType(parseInt(v)), type: 'select', selectOptions: [{ value: '0', label: '-L 本地转发' }, { value: '1', label: '-R 远程转发' }, { value: '2', label: '-D 动态转发' }] },
            { label: '本地地址 (host:port)', value: localAddr, set: setLocalAddr, placeholder: ttype === 2 ? '127.0.0.1:1080' : '127.0.0.1:8080' },
            ...(ttype !== 2 ? [{ label: '远程地址 (host:port)', value: remoteAddr, set: setRemoteAddr, placeholder: 'localhost:80' }] : []),
          ]}
          onConfirm={startTunnel} onCancel={() => setDialog(false)} />
      )}
    </div>
  )
}
