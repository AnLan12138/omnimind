import { useState } from 'react'
import { Terminal, ChevronDown } from 'lucide-react'

interface Props {
  onConnect: (p: { protocol: string; host: string; port: number; username: string; password: string }) => void
}

function parseURL(input: string): { protocol: string; host: string; port: number; username: string } | null {
  if (!input.trim()) return null
  let s = input.trim()

  // Check for protocol:// prefix
  const protoMatch = s.match(/^(ssh|telnet|rdp|vnc|serial|ftp):\/\//i)
  let proto = 'ssh'
  if (protoMatch) {
    proto = protoMatch[1].toLowerCase()
    s = s.slice(protoMatch[0].length)
    if (proto === 'serial') return { protocol: 'serial', host: s, port: 0, username: '' }
  }

  // Extract user@
  let user = ''
  const atIdx = s.lastIndexOf('@')
  if (atIdx >= 0) { user = s.slice(0, atIdx); s = s.slice(atIdx + 1) }

  // Extract :port
  let port = 0
  const colonIdx = s.lastIndexOf(':')
  if (colonIdx >= 0) { const p = parseInt(s.slice(colonIdx + 1)); if (!isNaN(p)) { port = p; s = s.slice(0, colonIdx) } }

  // Auto-detect protocol from port if not specified
  if (!protoMatch) {
    if (port === 23) proto = 'telnet'
    else if (port === 3389) proto = 'rdp'
    else if (port === 5900) proto = 'vnc'
    else if (port === 21) proto = 'ftp'
    else port = port || 22
  } else { port = port || PROTOCOLS.find(p => p.value === proto)!.port }

  return { protocol: proto, host: s, port, username: user }
}

const PROTOCOLS: { value: string; label: string; port: number }[] = [
  { value: 'ssh', label: 'SSH', port: 22 }, { value: 'telnet', label: 'Telnet', port: 23 },
  { value: 'serial', label: 'Serial', port: 0 }, { value: 'rdp', label: 'RDP', port: 3389 },
  { value: 'vnc', label: 'VNC', port: 5900 }, { value: 'ftp', label: 'FTP', port: 21 },
]

export default function QuickConnect({ onConnect }: Props) {
  const [protocol, setProtocol] = useState('ssh')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [showDrop, setShowDrop] = useState(false)

  const connect = () => {
    if (!host.trim()) return
    // Try URL parsing
    const parsed = parseURL(host.trim())
    if (parsed && parsed.host) {
      onConnect({ protocol: parsed.protocol, host: parsed.host, port: parsed.port || PROTOCOLS.find(p=>p.value===parsed.protocol)!.port, username: parsed.username || user.trim(), password: pass })
    }
  }

  return (
    <div className="flex items-center gap-1.5 h-9 px-3 bg-vscode-panel border-b border-vscode-border">
      <div className="relative">
        <button onClick={() => setShowDrop(!showDrop)}
          className="flex items-center gap-1 px-2 h-6 bg-vscode-input hover:bg-vscode-hover border border-vscode-border rounded text-[11px] text-vscode-text min-w-[64px]">
          <Terminal size={12} className="text-vscode-accent" />
          <span className="text-[11px]">{PROTOCOLS.find(p=>p.value===protocol)!.label}</span>
          <ChevronDown size={10} className="text-vscode-text-muted" />
        </button>
        {showDrop && (
          <div className="absolute top-full left-0 mt-0.5 w-32 bg-vscode-input border border-vscode-border rounded shadow-xl z-50 py-0.5"
            onMouseLeave={() => setShowDrop(false)}>
            {PROTOCOLS.map(p => (
              <button key={p.value} onClick={() => { setProtocol(p.value); setPort(String(p.port)); setShowDrop(false) }}
                className="w-full flex items-center gap-2 px-2.5 py-1 hover:bg-vscode-hover text-[11px] text-vscode-text">
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <input type="text" placeholder="host (or user@host:22 or ssh://host)" value={host}
        onChange={e => setHost(e.target.value)} onKeyDown={e => { if (e.key==='Enter') connect() }}
        className="flex-1 h-6 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent min-w-0" />

      <input type="text" placeholder="port" value={port}
        onChange={e => setPort(e.target.value)} onKeyDown={e => { if (e.key==='Enter') connect() }}
        className="w-12 h-6 px-1.5 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text text-center focus:outline-none focus:border-vscode-accent" />

      <input type="text" placeholder="user" value={user}
        onChange={e => setUser(e.target.value)} onKeyDown={e => { if (e.key==='Enter') connect() }}
        className="w-24 h-6 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />

      <input type="password" placeholder="password" value={pass}
        onChange={e => setPass(e.target.value)} onKeyDown={e => { if (e.key==='Enter') connect() }}
        className="w-24 h-6 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />

      <button onClick={connect} disabled={!host.trim()}
        className="h-6 px-3 bg-vscode-accent hover:bg-vscode-accent-hover disabled:bg-vscode-input disabled:text-vscode-text-dim text-white rounded text-[11px] font-medium whitespace-nowrap">
        Connect
      </button>
    </div>
  )
}
