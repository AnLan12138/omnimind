import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, Pencil, Trash2, FolderPlus, Upload, Download, Plus, Play } from 'lucide-react'
import FormDialog from './FormDialog'
import { session } from '../../wailsjs/go/models'
import { DEFAULT_GROUP, genId } from '../stores/groupStore'

interface Props {
  onDoubleClick: (s: session.Session) => void
  onEditSession: (s: session.Session) => void
  onNewSession: () => void
  onNewSessionWithGroup: (groupId: string) => void
  searchTerm: string
}

interface Device {
  id: string; name: string; host: string; port: number; username: string
  protocol: string; status: 'online' | 'offline'; groupId: string
}
interface Group { id: string; name: string; parentId: string }
interface CtxMenu { x: number; y: number; type: 'device' | 'group' | 'root'; device?: Device; group?: Group }

function loadDevices(): Device[] {
  try {
    const d = localStorage.getItem('omni-devices2')
    if (!d) return []
    const devices: Device[] = JSON.parse(d)
    // Migration: fix old format with 'ip' instead of 'host'
    return devices.map(d => ({ ...d, host: d.host || (d as any).ip || '' }))
  } catch { return [] }
}
function saveDevices(d: Device[]) { localStorage.setItem('omni-devices2', JSON.stringify(d)) }
function loadGroups(): Group[] {
  try { const g: Group[] = JSON.parse(localStorage.getItem('omni-groups2') || '[]'); console.log('[SessionSidebar] loadGroups key=omni-groups2 data=', g); return g.find(x => x.id === 'default') ? g : [DEFAULT_GROUP, ...g] } catch { return [DEFAULT_GROUP] }
}
function saveGroups(g: Group[]) { console.log('[SessionSidebar] saveGroups key=omni-groups2 data=', g); localStorage.setItem('omni-groups2', JSON.stringify(g)) }

export default function SessionSidebar({ onDoubleClick, onEditSession, onNewSession, onNewSessionWithGroup, searchTerm }: Props) {
  const [devices, setDevices] = useState<Device[]>(loadDevices)
  const [groups, setGroups] = useState<Group[]>(loadGroups)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['default']))
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [dialog, setDialog] = useState<{ type: string; group?: Group; parentId?: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'device' | 'group'; item: Device | Group } | null>(null)
  const [dName, setDName] = useState('')
  const [devDialog, setDevDialog] = useState<{ type: 'edit'; groupId: string; device: Device } | null>(null)
  const [devName, setDevName] = useState(''); const [devHost, setDevHost] = useState('')
  const [devPort, setDevPort] = useState('22'); const [devUser, setDevUser] = useState('root')
  const [devProto, setDevProto] = useState('ssh')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const importGroupRef = useRef('default') // target group for import
  const lastClickedRef = useRef<string | null>(null) // for shift+click range select

  useEffect(() => { saveDevices(devices) }, [devices])
  useEffect(() => { saveGroups(groups) }, [groups])
  useEffect(() => { const h = () => setCtx(null); if (ctx) { window.addEventListener('click', h); return () => window.removeEventListener('click', h) } }, [ctx])
  // Listen for device changes from SessionDialog
  useEffect(() => {
    const h = () => { setDevices(loadDevices()); setGroups(loadGroups()) }
    window.addEventListener('devices-changed', h)
    return () => window.removeEventListener('devices-changed', h)
  }, [])

  // Enter key opens selected devices
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const inInput = (e.target as HTMLElement)?.closest('input')
      if (inInput) return
      if (selected.size === 0) return
      for (const id of selected) {
        const d = devices.find(x => x.id === id)
        if (d) connectDevice(d)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected, devices])

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const filtered = devices.filter(d => !searchTerm || d.name.includes(searchTerm) || d.host.includes(searchTerm))
  const groupDevices = (gid: string) => filtered.filter(d => d.groupId === gid)
  const childGroups = (pid: string) => groups.filter(g => g.parentId === pid)
  const rootGroups = childGroups('')

  // --- Device operations ---
  const connectDevice = (d: Device) => {
    if (!d.host || d.host === 'undefined') return
    const now = new Date().toISOString()
    onDoubleClick(session.Session.createFrom({
      id: genId(), name: d.name, protocol: d.protocol, host: d.host || '', port: d.port,
      username: d.username, password: '', privateKeyPath: '', useAgent: false, proxyJump: '', keepAliveSec: 30,
      telnetTermType: '', baudRate: 115200, dataBits: 8, stopBits: 1.0, parity: 'none', flowControl: 'none',
      folderId: '', sortOrder: 0, createdAt: now, updatedAt: now,
    }))
  }
  const deleteDevice = (id: string) => { setDevices(devices.filter(d => d.id !== id)); setCtx(null); setConfirmDelete(null) }
  const confirmDeleteDevice = (device: Device) => { setConfirmDelete({ type: 'device', item: device }); setCtx(null) }
  const saveDevice = () => {
    if (!devName.trim() || !devHost.trim() || !devDialog) return
    setDevices(devices.map(d => d.id === devDialog.device.id ? { ...d, name: devName.trim(), host: devHost.trim(), port: parseInt(devPort) || 22, username: devUser.trim(), protocol: devProto } : d))
    setDevDialog(null)
  }
  const openEditDevice = (d: Device) => { setDevName(d.name); setDevHost(d.host); setDevPort(String(d.port)); setDevUser(d.username); setDevProto(d.protocol); setDevDialog({ type: 'edit', groupId: d.groupId, device: d }) }
  const handleDragStart = (e: React.DragEvent, id: string) => { e.dataTransfer.setData('deviceId', id) }
  const handleDrop = (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('deviceId')
    if (id) setDevices(prev => prev.map(d => d.id === id ? { ...d, groupId } : d))
  }

  // --- Group operations ---
  const addGroup = (parentId: string) => {
    if (!dName.trim()) return
    setGroups([...groups, { id: genId(), name: dName.trim(), parentId }])
    setDialog(null)
  }
  const renameGroup = (g: Group) => {
    if (!dName.trim()) return
    setGroups(groups.map(x => x.id === g.id ? { ...x, name: dName.trim() } : x))
    setDialog(null); setCtx(null)
  }
  const deleteGroup = (g: Group) => {
    if (g.id === 'default') return
    const ids = new Set([g.id])
    const collect = (pid: string) => { childGroups(pid).forEach(c => { ids.add(c.id); collect(c.id) }) }
    collect(g.id)
    setGroups(groups.filter(x => !ids.has(x.id)))
    setDevices(devices.map(d => ids.has(d.groupId) ? { ...d, groupId: 'default' } : d))
    setCtx(null); setConfirmDelete(null)
  }
  const confirmDeleteGroup = (group: Group) => { setConfirmDelete({ type: 'group', item: group }); setCtx(null) }

  // Export/Import — NDJSON (one JSON object per line), per-group export
  const exportGroup = (groupId: string) => {
    const g = groups.find(x => x.id === groupId)
    const name = g?.name || 'devices'
    const devs = devices.filter(d => d.groupId === groupId)
    // One compact JSON object per line = NDJSON
    const lines = devs.map(d => JSON.stringify({ name: d.name, host: d.host, port: d.port, username: d.username, protocol: d.protocol }))
    const blob = new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.ndjson`; a.click()
    setCtx(null)
  }
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const targetGroup = importGroupRef.current
    const r = new FileReader(); r.onload = () => {
      try {
        const text = r.result as string
        const imported: Device[] = []
        const trimmed = text.trim()
        // Legacy: full JSON object with "groups" / "devices" arrays
        if (trimmed.startsWith('{') && (trimmed.includes('"groups"') || trimmed.includes('"devices"'))) {
          const data = JSON.parse(trimmed)
          if (data.groups) setGroups(data.groups)
          if (data.devices) setDevices(data.devices)
          return
        }
        // Legacy: JSON array of devices
        if (trimmed.startsWith('[')) {
          const arr = JSON.parse(trimmed)
          for (const item of arr) {
            imported.push({
              id: genId(), name: item.name || '', host: item.host || '', port: item.port || 22,
              username: item.username || 'root', protocol: item.protocol || 'ssh',
              status: 'offline' as const, groupId: targetGroup,
            })
          }
        } else {
          // NDJSON: one JSON object per line
          for (const line of text.split('\n')) {
            const lt = line.trim()
            if (!lt || lt.startsWith('#')) continue
            try {
              const obj = JSON.parse(lt)
              imported.push({
                id: genId(), name: obj.name || '', host: obj.host || '', port: obj.port || 22,
                username: obj.username || 'root', protocol: obj.protocol || 'ssh',
                status: 'offline' as const, groupId: targetGroup,
              })
            } catch { /* skip bad lines */ }
          }
        }
        if (imported.length > 0) setDevices(prev => [...prev.filter(d => d.groupId !== targetGroup), ...imported])
      } catch {}
    }; r.readAsText(f)
    e.target.value = ''
    setCtx(null)
  }

  // --- Render ---
  const renderGroup = (g: Group, depth: number) => {
    const items = groupDevices(g.id)
    const children = childGroups(g.id)
    const ex = expanded.has(g.id)
    const isDefault = g.id === 'default'
    return (
      <div key={g.id} onDrop={e => handleDrop(e, g.id)} onDragOver={e => e.preventDefault()}>
        <div className="group flex items-center h-8 hover:bg-vscode-hover border-b border-vscode-border/30"
          style={{ paddingLeft: 8 + depth * 12 }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, type: 'group', group: g }) }}>
          <button onClick={() => toggle(g.id)} onDoubleClick={() => onNewSessionWithGroup(g.id)}
            className="flex items-center gap-1 flex-1">
            {(children.length > 0 || items.length > 0) && (ex ? <ChevronDown size={10} className="text-vscode-text-muted" /> : <ChevronRight size={10} className="text-vscode-text-muted" />)}
            <span className={`text-[12px] ${isDefault ? 'text-vscode-text font-semibold' : 'text-vscode-text'}`}>{g.name}</span>
            <span className="text-[9px] text-vscode-text-dim ml-1">({items.length})</span>
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 pr-2">
            {!isDefault && <button onClick={() => { setDName(g.name); setDialog({ type: 'rename', group: g }) }} className="p-0.5 hover:bg-vscode-hover rounded"><Pencil size={10} className="text-vscode-text-muted" /></button>}
            {!isDefault && <button onClick={() => confirmDeleteGroup(g)} className="p-0.5 hover:bg-vscode-hover rounded"><Trash2 size={10} className="text-vscode-text-muted hover:text-vscode-red" /></button>}
          </div>
        </div>
        {ex && (
          <>
            {items.map(d => {
              const protoColors: Record<string, string> = { ssh: '#569cd6', telnet: '#ce9178', rdp: '#4ec9b0', vnc: '#c586c0', ftp: '#4fc1ff', serial: '#dcdcaa' }
              return (
                <div key={d.id} draggable onDragStart={e => handleDragStart(e, d.id)}
                  className={`flex items-center gap-1.5 h-8 cursor-pointer border-b border-vscode-border/20 group/item ${
                    selected.has(d.id) ? 'bg-vscode-accent/15' : 'hover:bg-vscode-hover'
                  }`}
                  style={{ paddingLeft: 20 + depth * 12 }}
                  onClick={e => {
                    if (e.shiftKey && lastClickedRef.current) {
                      // Range select from last clicked to this device
                      const gid = d.groupId
                      const siblings = groupDevices(gid)
                      const lastIdx = siblings.findIndex(x => x.id === lastClickedRef.current)
                      const thisIdx = siblings.findIndex(x => x.id === d.id)
                      if (lastIdx >= 0 && thisIdx >= 0) {
                        const [from, to] = lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx]
                        const range = new Set(selected)
                        for (let i = from; i <= to; i++) range.add(siblings[i].id)
                        setSelected(range)
                      }
                    } else if (e.ctrlKey || e.metaKey) {
                      setSelected(p => { const n = new Set(p); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n })
                      lastClickedRef.current = d.id
                    } else {
                      setSelected(new Set([d.id]))
                      lastClickedRef.current = d.id
                    }
                  }}
                  onDoubleClick={() => connectDevice(d)}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, type: 'device', device: d }) }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: d.status === 'online' ? '#4ec9b0' : '#6a6a6a' }} />
                  <span className="text-[9px] px-1 py-0.5 rounded font-medium shrink-0"
                    style={{ background: (protoColors[d.protocol] || '#858585') + '22', color: protoColors[d.protocol] || '#858585' }}>{d.protocol.toUpperCase()}</span>
                  <span className="text-[12px] text-vscode-text truncate flex-1">{d.name}</span>
                  <span className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100">
                    <button onClick={e => { e.stopPropagation(); openEditDevice(d) }}
                      className="p-0.5 hover:bg-vscode-hover rounded"><Pencil size={10} className="text-vscode-text-muted" /></button>
                    <button onClick={e => { e.stopPropagation(); confirmDeleteDevice(d) }}
                      className="p-0.5 hover:bg-vscode-hover rounded"><Trash2 size={10} className="text-vscode-text-muted hover:text-vscode-red" /></button>
                  </span>
                </div>
              )
            })}
            {items.length === 0 && children.length === 0 && (
              <div className="text-[10px] text-vscode-text-dim/40 py-2" style={{ paddingLeft: 20 + depth * 12 }}>空分组</div>
            )}
            {children.map(c => renderGroup(c, depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar w-60">
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-vscode-text">Devices</span>
        <button onClick={() => { setDName(''); setDialog({ type: 'addGroup', parentId: '' }) }} className="flex items-center gap-0.5 px-1.5 h-5 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px]">
          <Plus size={10} /> 添加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rootGroups.map(g => renderGroup(g, 0))}
        {rootGroups.length === 0 && <div className="text-center text-[11px] text-vscode-text-dim py-8">右键新建分组</div>}
      </div>

      <input ref={fileRef} type="file" accept=".json,.ndjson,.txt" className="hidden" onChange={handleImport} />

      {/* Context menu */}
      {ctx && (
        <div className="fixed z-50 w-44 bg-vscode-input border border-vscode-border shadow-xl py-0.5 rounded" style={{ left: ctx.x, top: ctx.y }}>
          {ctx.type === 'device' && ctx.device && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.device.protocol.toUpperCase()} · {ctx.device.name}</div>
              <button onClick={() => { connectDevice(ctx.device!); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-accent"><Play size={12} /> 打开</button>
              {selected.size > 1 && (
                <button onClick={() => { for (const id of selected) { const d = devices.find(x => x.id === id); if (d) connectDevice(d) } setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-accent"><Play size={12} /> 打开选中 ({selected.size})</button>
              )}
              <div className="h-px bg-vscode-border my-0.5" />
              <button onClick={() => { onEditSession(session.Session.createFrom({
                id: genId(), name: ctx.device!.name, protocol: ctx.device!.protocol, host: ctx.device!.host, port: ctx.device!.port,
                username: ctx.device!.username, password: '', privateKeyPath: '', useAgent: false, proxyJump: '', keepAliveSec: 30,
                telnetTermType: '', baudRate: 115200, dataBits: 8, stopBits: 1.0, parity: 'none', flowControl: 'none',
                folderId: '', sortOrder: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
              })); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> 编辑</button>
              <button onClick={() => confirmDeleteDevice(ctx.device!)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> 删除</button>
            </>
          )}
          {ctx.type === 'group' && ctx.group && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.group.name}</div>
              <button onClick={() => { setDName(''); setDialog({ type: 'addGroup', parentId: ctx.group!.id }) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><FolderPlus size={12} /> 子分组</button>
              {ctx.group.id !== 'default' && <button onClick={() => { setDName(ctx.group!.name); setDialog({ type: 'rename', group: ctx.group }) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> 重命名</button>}
              <button onClick={() => exportGroup(ctx.group!.id)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Download size={12} /> 导出此分组</button>
              <button onClick={() => { importGroupRef.current = ctx.group!.id; fileRef.current?.click(); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Upload size={12} /> 导入到此分组</button>
              {ctx.group.id !== 'default' && <button onClick={() => confirmDeleteGroup(ctx.group!)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> 删除</button>}
            </>
          )}
        </div>
      )}

      {/* Dialogs */}
      {dialog?.type === 'addGroup' && (
        <FormDialog title="新建分组" confirmLabel="创建" confirmDisabled={!dName.trim()}
          fields={[{ label: '分组名称', value: dName, set: setDName, placeholder: '分组名称' }]}
          onConfirm={() => addGroup(dialog.parentId || '')} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === 'rename' && dialog.group && (
        <FormDialog title="重命名分组" confirmLabel="保存" confirmDisabled={!dName.trim()}
          fields={[{ label: '分组名称', value: dName, set: setDName, placeholder: '' }]}
          onConfirm={() => renameGroup(dialog.group!)} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === 'renameDevice' && (
        <FormDialog title="重命名设备" confirmLabel="保存" confirmDisabled={!dName.trim()}
          fields={[{ label: '设备名称', value: dName, set: setDName, placeholder: '' }]}
          onConfirm={() => { /* handled inline */ setDialog(null) }} onCancel={() => setDialog(null)} />
      )}

      {devDialog && (
        <FormDialog title="编辑设备" confirmLabel="保存" confirmDisabled={!devName.trim() || !devHost.trim()}
          fields={[
            { label: '名称', value: devName, set: setDevName, placeholder: '设备名称' },
            { label: '地址', value: devHost, set: setDevHost, placeholder: 'IP 或域名' },
            { label: '端口', value: devPort, set: setDevPort, placeholder: '22' },
            { label: '用户名', value: devUser, set: setDevUser, placeholder: 'root' },
          ]}
          onConfirm={saveDevice} onCancel={() => setDevDialog(null)} />
      )}
      {confirmDelete?.type === 'device' && (
        <FormDialog title="删除设备" danger confirmLabel="删除"
          fields={[{ label: '', value: `确定删除设备 "${(confirmDelete.item as Device).name}" 吗？此操作不可恢复。`, set: () => {}, displayOnly: true }]}
          onConfirm={() => deleteDevice((confirmDelete.item as Device).id)}
          onCancel={() => setConfirmDelete(null)} />
      )}
      {confirmDelete?.type === 'group' && (
        <FormDialog title="删除分组" danger confirmLabel="删除"
          fields={[{ label: '', value: `确定删除分组 "${(confirmDelete.item as Group).name}" 吗？所有子分组将一起删除，设备会移到默认分组。`, set: () => {}, displayOnly: true }]}
          onConfirm={() => deleteGroup(confirmDelete.item as Group)}
          onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  )
}
