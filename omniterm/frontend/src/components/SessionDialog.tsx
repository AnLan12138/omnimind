import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, FolderOpen, Monitor, MonitorPlay, Computer, Wifi, Cable } from 'lucide-react'
import { session } from '../../wailsjs/go/models'
import { SaveSession, DeleteSession, ListFolders } from '../../wailsjs/go/main/App'
import { useSessionStore } from '../stores/sessionStore'

interface Props {
  session?: session.Session | null
  onClose: () => void
  onSaved: () => void
}

const PROTOCOLS = [
  { value: 'ssh', label: 'SSH', defaultPort: 22, icon: Monitor, color: '#569cd6' },
  { value: 'sftp', label: 'SFTP', defaultPort: 22, icon: FolderOpen, color: '#569cd6' },
  { value: 'telnet', label: 'Telnet', defaultPort: 23, icon: Cable, color: '#ce9178' },
  { value: 'serial', label: 'Serial', defaultPort: 0, icon: MonitorPlay, color: '#dcdcaa' },
  { value: 'rdp', label: 'RDP', defaultPort: 3389, icon: Computer, color: '#4ec9b0' },
  { value: 'vnc', label: 'VNC', defaultPort: 5900, icon: MonitorPlay, color: '#c586c0' },
  { value: 'ftp', label: 'FTP', defaultPort: 21, icon: Wifi, color: '#4fc1ff' },
]

const BAUDS = [110, 300, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
const DATA_BITS = [5, 6, 7, 8]
const STOP_BITS = [1, 1.5, 2]
const PARITIES = ['none', 'even', 'odd', 'mark', 'space']
const FLOW_CONTROLS = ['none', 'rtscts', 'xonxoff']

function genId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10) }
const now = () => new Date().toISOString()

export default function SessionDialog({ session: editSession, onClose, onSaved }: Props) {
  const { folders } = useSessionStore()
  const [protocol, setProtocol] = useState('ssh')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // SSH
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [useAgent, setUseAgent] = useState(false)
  const [proxyJump, setProxyJump] = useState('')
  const [keepAliveSec, setKeepAliveSec] = useState(30)
  // Telnet
  const [telnetTermType, setTelnetTermType] = useState('XTERM-256COLOR')
  // Serial
  const [baudRate, setBaudRate] = useState(115200)
  const [dataBits, setDataBits] = useState(8)
  const [stopBits, setStopBits] = useState(1.0)
  const [parity, setParity] = useState('none')
  const [flowControl, setFlowControl] = useState('none')
  // General
  const [folderId, setFolderId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editSession) {
      setProtocol(editSession.protocol || 'ssh')
      setName(editSession.name || '')
      setHost(editSession.host || '')
      setPort(String(editSession.port || 22))
      setUsername(editSession.username || '')
      setPassword(editSession.password || '')
      setPrivateKeyPath(editSession.privateKeyPath || '')
      setUseAgent(editSession.useAgent || false)
      setProxyJump(editSession.proxyJump || '')
      setKeepAliveSec(editSession.keepAliveSec || 30)
      setTelnetTermType(editSession.telnetTermType || 'XTERM-256COLOR')
      setBaudRate(editSession.baudRate || 115200)
      setDataBits(editSession.dataBits || 8)
      setStopBits(editSession.stopBits || 1.0)
      setParity(editSession.parity || 'none')
      setFlowControl(editSession.flowControl || 'none')
      setFolderId(editSession.folderId || '')
      setNotes(editSession.notes || '')
    }
  }, [editSession])

  const handleProtocolChange = (p: string) => {
    setProtocol(p)
    const proto = PROTOCOLS.find(x => x.value === p)
    if (proto) setPort(String(proto.defaultPort))
  }

  const handleSave = async () => {
    if (!name.trim() || !host.trim()) return
    setSaving(true)
    try {
      const s = session.Session.createFrom({
        id: editSession?.id || genId(), name: name.trim(), protocol, host: host.trim(),
        port: parseInt(port) || 22, username: username.trim(), password, privateKeyPath, useAgent,
        proxyJump, keepAliveSec, telnetTermType, baudRate, dataBits, stopBits, parity, flowControl,
        folderId, notes, sortOrder: editSession?.sortOrder || 0,
        createdAt: editSession?.createdAt || now(), updatedAt: now(),
      })
      await SaveSession({
        id: s.id, name: s.name, protocol: s.protocol, host: s.host, port: s.port,
        username: s.username || '', password: s.password || '', privateKeyPath: s.privateKeyPath || '',
        useAgent: s.useAgent || false, proxyJump: s.proxyJump || '', keepAliveSec: s.keepAliveSec || 30,
        telnetTermType: s.telnetTermType || '', baudRate: s.baudRate || 115200, dataBits: s.dataBits || 8,
        stopBits: s.stopBits || 1.0, parity: s.parity || 'none', flowControl: s.flowControl || 'none',
        folderId: s.folderId || '', sortOrder: s.sortOrder || 0, createdAt: s.createdAt, updatedAt: s.updatedAt,
      })
      onSaved(); onClose()
    } catch (err) { console.error('Save failed:', err) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!editSession?.id) return
    try { await DeleteSession(editSession.id); onSaved(); onClose() } catch {}
  }

  const input = (label: string, value: string, set: (v: string) => void, opts?: { placeholder?: string; type?: string; className?: string }) => (
    <div>
      <label className="block text-[11px] text-vscode-text-dim mb-1">{label}</label>
      <input type={opts?.type || 'text'} value={value} onChange={e => set(e.target.value)} placeholder={opts?.placeholder}
        className={`px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent ${opts?.className || 'w-full'}`} />
    </div>
  )

  const select = (label: string, value: any, set: (v: any) => void, options: any[]) => (
    <div>
      <label className="block text-[11px] text-vscode-text-dim mb-1">{label}</label>
      <select value={value} onChange={e => set(e.target.value)}
        className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent">
        {options.map(o => <option key={String(o)} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl w-[660px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-10 border-b border-vscode-border">
          <span className="text-[13px] font-semibold text-vscode-text">{editSession ? 'Edit Session' : 'New Session'}</span>
          <button onClick={onClose} className="p-1 hover:bg-vscode-hover rounded"><X size={14} className="text-vscode-text-muted" /></button>
        </div>

        {/* Protocol selector row */}
        <div className="px-4 py-3 border-b border-vscode-border">
          <div className="flex items-center justify-center gap-1.5 flex-nowrap">
            {PROTOCOLS.map(p => (
              <button key={p.value} onClick={() => handleProtocolChange(p.value)}
                className="flex items-center gap-1 px-3 h-9 rounded transition-colors border shrink-0"
                style={{
                  background: protocol === p.value ? p.color + '20' : 'transparent',
                  borderColor: protocol === p.value ? p.color : '#3c3c3c',
                  color: protocol === p.value ? p.color : '#858585',
                }}>
                <p.icon size={22} />
                <span className="text-[12px] font-medium whitespace-nowrap">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Connection params */}
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-[1fr_100px_120px_120px] gap-3">
            {input('Host', host, setHost, { placeholder: '192.168.1.1' })}
            {input('Port', port, setPort, { placeholder: '22' })}
            {input('Username', username, setUsername, { placeholder: 'root' })}
            <div>
              <label className="block text-[11px] text-vscode-text-dim mb-1">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-2 h-7 pr-8 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2">
                  {showPassword ? <EyeOff size={12} className="text-vscode-text-muted" /> : <Eye size={12} className="text-vscode-text-muted" />}
                </button>
              </div>
            </div>
          </div>

          {input('Session Name', name, setName, { placeholder: 'My Server' })}

          {/* SSH options */}
          {protocol === 'ssh' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[11px] text-vscode-text-dim uppercase tracking-wider">SSH Options</div>
              <div className="grid grid-cols-2 gap-3">
                {input('Private Key Path', privateKeyPath, setPrivateKeyPath, { placeholder: '~/.ssh/id_ed25519' })}
                {input('ProxyJump', proxyJump, setProxyJump, { placeholder: 'bastion:22' })}
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-[12px] text-vscode-text cursor-pointer">
                  <input type="checkbox" checked={useAgent} onChange={e => setUseAgent(e.target.checked)}
                    className="rounded accent-vscode-accent" />
                  Use SSH Agent
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-vscode-text-dim">KeepAlive (s)</span>
                  <input type="number" value={keepAliveSec} onChange={e => setKeepAliveSec(Number(e.target.value) || 30)}
                    className="w-16 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                </div>
              </div>
            </div>
          )}

          {/* Telnet options */}
          {protocol === 'telnet' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[11px] text-vscode-text-dim uppercase tracking-wider">Telnet Options</div>
              {select('Terminal Type', telnetTermType, setTelnetTermType, ['XTERM-256COLOR', 'XTERM', 'VT220', 'VT100', 'ANSI', 'IBM-3278-2'])}
            </div>
          )}

          {/* Serial options */}
          {protocol === 'serial' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[11px] text-vscode-text-dim uppercase tracking-wider">Serial Options</div>
              <div className="grid grid-cols-5 gap-3">
                {select('Baud', baudRate, setBaudRate, BAUDS)}
                {select('Data Bits', dataBits, setDataBits, DATA_BITS)}
                {select('Stop Bits', stopBits, setStopBits, STOP_BITS)}
                {select('Parity', parity, setParity, PARITIES)}
                {select('Flow', flowControl, setFlowControl, FLOW_CONTROLS)}
              </div>
            </div>
          )}

          {/* RDP/VNC/FTP - no extra options for now */}

          {/* Folder + Notes */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-vscode-border">
            <div>
              <label className="block text-[11px] text-vscode-text-dim mb-1">Folder</label>
              <div className="flex items-center gap-1">
                <FolderOpen size={12} className="text-vscode-text-muted ml-1" />
                <select value={folderId} onChange={e => setFolderId(e.target.value)}
                  className="flex-1 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent">
                  <option value="">None</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-vscode-text-dim mb-1">Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional..."
                className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-10 border-t border-vscode-border">
          <div>
            {editSession && (
              <button onClick={handleDelete}
                className="px-3 h-6 text-[11px] text-vscode-red hover:bg-red-500/10 rounded transition-colors">
                Delete Session
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 h-6 text-[11px] text-vscode-text-muted hover:text-vscode-text rounded hover:bg-vscode-hover transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim() || !host.trim()}
              className="px-5 h-6 bg-vscode-accent hover:bg-vscode-accent-hover disabled:opacity-40 text-white rounded text-[11px] font-medium transition-colors">
              {saving ? 'Saving...' : editSession ? 'Save & Connect' : 'Save & Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
