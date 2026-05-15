import { useState, useEffect } from 'react'
import { X, Monitor, MonitorPlay, Computer, Wifi, Cable } from 'lucide-react'
import { session } from '../../wailsjs/go/models'
import { SaveSession, DeleteSession } from '../../wailsjs/go/main/App'
import { useI18n } from '../lib/i18n'

interface Props {
  session?: session.Session | null
  groupId?: string
  onClose: () => void
  onSaved: () => void
  onConnect?: (sess: any) => void
}

const PROTOCOLS = [
  { value: 'ssh', label: 'SSH', defaultPort: 22, icon: Monitor, color: '#569cd6' },
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

export default function SessionDialog({ session: editSession, groupId = 'default', onClose, onSaved, onConnect }: Props) {
  const { t } = useI18n()
  const [protocol, setProtocol] = useState('ssh')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // SSH
  const [privateKeyPath, setPrivateKeyPath] = useState('')
  const [useAgent, setUseAgent] = useState(false)
  const [proxyJump, setProxyJump] = useState('')
  const [keepAliveSec, setKeepAliveSec] = useState(30)
  const [termType, setTermType] = useState('xterm-256color')
  // Telnet
  const [telnetTermType, setTelnetTermType] = useState('XTERM-256COLOR')
  // Serial
  const [baudRate, setBaudRate] = useState(115200)
  const [dataBits, setDataBits] = useState(8)
  const [stopBits, setStopBits] = useState(1.0)
  const [parity, setParity] = useState('none')
  const [flowControl, setFlowControl] = useState('none')
  const [useTLS, setUseTLS] = useState(false)
  const [tlsSkipVerify, setTlsSkipVerify] = useState(false)
  const [useFTPS, setUseFTPS] = useState('')
  // General
  const [folderId, setFolderId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    if (editSession) {
      setProtocol(editSession.protocol || 'ssh')
      setName(editSession.name || '')
      setHost(editSession.host || '')
      setPort(String(editSession.port || 22))
      setUsername(editSession.username || '')
      setPassword('')
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
    const sessionName = name.trim() || host.trim()
    if (!host.trim()) return
    setSaving(true)
    try {
      const s = session.Session.createFrom({
        id: editSession?.id || genId(), name: sessionName, protocol, host: host.trim(),
        port: parseInt(port) || 22, username: username.trim(), password, privateKeyPath, useAgent,
        proxyJump, keepAliveSec, telnetTermType, baudRate, dataBits, stopBits, parity, flowControl, useTLS, tlsSkipVerify, useFTPS, termType,
        folderId, notes, sortOrder: editSession?.sortOrder || 0,
        createdAt: editSession?.createdAt || now(), updatedAt: now(),
      })
      await SaveSession({
        id: s.id, name: s.name, protocol: s.protocol, host: s.host, port: s.port,
        username: s.username || '', password: s.password || '', privateKeyPath: s.privateKeyPath || '',
        useAgent: s.useAgent || false, proxyJump: s.proxyJump || '', keepAliveSec: s.keepAliveSec || 30,
        telnetTermType: s.telnetTermType || '', baudRate: s.baudRate || 115200, dataBits: s.dataBits || 8,
        stopBits: s.stopBits || 1.0, parity: s.parity || 'none', flowControl: s.flowControl || 'none', useTLS: useTLS || false, tlsSkipVerify: tlsSkipVerify || false, useFTPS: useFTPS || '', termType: termType || 'xterm-256color',
        folderId: s.folderId || '', sortOrder: s.sortOrder || 0, createdAt: s.createdAt, updatedAt: s.updatedAt,
      })
      // Also save to sidebar device list
      try {
        const devices: any[] = JSON.parse(localStorage.getItem('omni-devices2') || '[]')
        devices.push({ id: genId(), name: sessionName, host: host.trim(), port: parseInt(port) || 22, username: username.trim(), protocol, status: 'offline', groupId })
        localStorage.setItem('omni-devices2', JSON.stringify(devices))
        // Trigger sidebar refresh
        window.dispatchEvent(new Event('devices-changed'))
      } catch {}
      // Connect immediately after saving
      if (onConnect) {
        onConnect({ id: s.id, name: sessionName, protocol, host: host.trim(), port: parseInt(port) || 22, username: username.trim(), password, privateKeyPath, useAgent, proxyJump, keepAliveSec: keepAliveSec || 30, termType: termType || 'xterm-256color' })
      }
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
      <label className="block text-[13px] text-vscode-text mb-1">{label}</label>
      <input type={opts?.type || 'text'} value={value} onChange={e => set(e.target.value)} placeholder={opts?.placeholder}
        className={`px-2.5 h-8 bg-vscode-input border border-vscode-border rounded text-[13px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent ${opts?.className || 'w-full'}`} />
    </div>
  )

  const select = (label: string, value: any, set: (v: any) => void, options: any[], labelOptions?: string[]) => (
    <div>
      <label className="block text-[13px] text-vscode-text mb-1">{label}</label>
      <select value={value} onChange={e => set(e.target.value)}
        className="w-full px-2.5 h-8 bg-vscode-input border border-vscode-border rounded text-[13px] text-vscode-text focus:outline-none focus:border-vscode-accent">
        {options.map((o, i) => <option key={String(o)} value={labelOptions ? labelOptions[i] || o : o}>{labelOptions ? labelOptions[i] || o : o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl w-[660px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-10 border-b border-vscode-border">
          <span className="text-[15px] font-semibold text-white">{editSession ? t('editSession') : t('newSession')}</span>
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
          <div className="grid grid-cols-2 gap-3">
            {input(t('host'), host, setHost, { placeholder: '192.168.1.1' })}
            {input(t('port'), port, setPort, { placeholder: '22' })}
            {input(t('username'), username, setUsername, { placeholder: 'root' })}
            {input(t('password'), password, setPassword, { placeholder: '密码', type: 'password' })}
          </div>

          {input(t('sessionName'), name, setName, { placeholder: 'My Server' })}

          {/* SSH options */}
          {protocol === 'ssh' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[12px] text-vscode-text-muted uppercase tracking-wider">{t('sshOptions')}</div>
              <div className="grid grid-cols-2 gap-3">
                {input(t('privateKey'), privateKeyPath, setPrivateKeyPath, { placeholder: '~/.ssh/id_ed25519' })}
                {input(t('proxyJump'), proxyJump, setProxyJump, { placeholder: 'bastion:22' })}
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-[12px] text-vscode-text cursor-pointer">
                  <input type="checkbox" checked={useAgent} onChange={e => setUseAgent(e.target.checked)}
                    className="rounded accent-vscode-accent" />
                  {t('useAgent')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-vscode-text">{t('keepAlive')}</span>
                  <input type="number" value={keepAliveSec} onChange={e => setKeepAliveSec(Number(e.target.value) || 30)}
                    className="w-16 px-2.5 h-8 bg-vscode-input border border-vscode-border rounded text-[13px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                </div>
              </div>
              {select('终端类型 (TERM)', termType, setTermType, ['xterm-256color', 'xterm', 'xterm-color', 'vt220', 'vt100', 'ansi', 'linux'], ['xterm-256color (Linux 推荐)', 'xterm (通用)', 'xterm-color (彩色)', 'vt220 (旧设备)', 'vt100 (最小)', 'ansi (基础)', 'linux (控制台)'])}
            </div>
          )}

          {/* Telnet options */}
          {protocol === 'telnet' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[12px] text-vscode-text-muted uppercase tracking-wider">{t('telnetOptions')}</div>
              {select(t('terminalType'), telnetTermType, setTelnetTermType, ['XTERM-256COLOR', 'XTERM', 'VT220', 'VT100', 'ANSI', 'IBM-3278-2'])}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={useTLS} onChange={e => setUseTLS(e.target.checked)} className="accent-vscode-accent" />
                <span className="text-[13px] text-vscode-text">TLS/SSL (Telnets)</span>
              </label>
              {useTLS && (
                <label className="flex items-center gap-2 cursor-pointer ml-4">
                  <input type="checkbox" checked={tlsSkipVerify} onChange={e => setTlsSkipVerify(e.target.checked)} className="accent-vscode-accent" />
                  <span className="text-[12px] text-vscode-text-dim">跳过证书验证</span>
                </label>
              )}
            </div>
          )}

          {/* FTP / FTPS options */}
          {protocol === 'ftp' && (
            <div className="space-y-2 pt-2 border-t border-vscode-border">
              <div className="text-[12px] text-vscode-text-muted uppercase tracking-wider">FTPS</div>
              {select('加密模式', useFTPS, setUseFTPS, ['', 'explicit', 'implicit'], ['无', '显式 (AUTH TLS)', '隐式 (TLS 直连)'])}
              {useFTPS && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={tlsSkipVerify} onChange={e => setTlsSkipVerify(e.target.checked)} className="accent-vscode-accent" />
                  <span className="text-[12px] text-vscode-text-dim">跳过证书验证</span>
                </label>
              )}
            </div>
          )}

          {/* Serial options */}
          {protocol === 'serial' && (
            <div className="space-y-3 pt-2 border-t border-vscode-border">
              <div className="text-[12px] text-vscode-text-muted uppercase tracking-wider">{t('serialOptions')}</div>
              <div className="grid grid-cols-5 gap-3">
                {select(t('baud'), baudRate, setBaudRate, BAUDS)}
                {select(t('dataBits'), dataBits, setDataBits, DATA_BITS)}
                {select(t('stopBits'), stopBits, setStopBits, STOP_BITS)}
                {select(t('parity'), parity, setParity, PARITIES)}
                {select(t('flowControl'), flowControl, setFlowControl, FLOW_CONTROLS)}
              </div>
            </div>
          )}

          {/* RDP/VNC/FTP - no extra options for now */}

          {/* Notes */}
          <div className="pt-2 border-t border-vscode-border">
            <label className="block text-[13px] text-vscode-text mb-1">{t('notes')}</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional..."
              className="w-full px-2.5 h-8 bg-vscode-input border border-vscode-border rounded text-[13px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-10 border-t border-vscode-border">
          <div>
            {editSession && (
              <button onClick={handleDelete}
                className="px-3 h-7 text-[12px] text-vscode-red hover:bg-red-500/10 rounded transition-colors">
                {t('deleteSession')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 h-7 text-[12px] text-vscode-text-muted hover:text-vscode-text rounded hover:bg-vscode-hover transition-colors">
              {t('cancel')}
            </button>
            <button onClick={handleSave} disabled={saving || !host.trim()}
              className="px-5 h-7 bg-vscode-accent hover:bg-vscode-accent-hover disabled:opacity-40 text-white rounded text-[12px] font-medium transition-colors">
              {saving ? t('saving') : t('saveConnect')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
