import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, Pencil, Trash2, FolderPlus, Upload, Download, GripVertical } from 'lucide-react'
import FormDialog from './FormDialog'
import { useSessionStore, type Session, type Folder } from '../stores/sessionStore'
import { DeleteSession, DeleteFolder, SaveFolder, ExportSessions, ImportSessions } from '../../wailsjs/go/main/App'

interface Props {
  searchTerm?: string
  onDoubleClick: (s: Session) => void
  onEditSession: (s: Session) => void
  onNewSession: () => void
}

interface CtxMenu { x: number; y: number; type: 'session' | 'folder' | 'root'; session?: Session; folder?: Folder }

function genId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10) }

export default function SessionSidebar({ searchTerm = '', onDoubleClick, onEditSession, onNewSession }: Props) {
  const { sessions, folders, setSessions, setFolders } = useSessionStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(folders.map(f => f.id)))
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [groupDialog, setGroupDialog] = useState(false)
  const [groupName, setGroupName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = () => setCtx(null)
    if (ctx) { window.addEventListener('click', h); return () => window.removeEventListener('click', h) }
  }, [ctx])

  const filtered = sessions.filter(s =>
    !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.host.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const folderSessions = (fid: string) => filtered.filter(s => s.folderId === fid)
  const unassigned = filtered.filter(s => !s.folderId || !folders.find(f => f.id === s.folderId))

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleRootCtx = (e: React.MouseEvent) => {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, type: 'root' })
  }

  const addGroup = async () => {
    if (!groupName.trim()) return
    const f: Folder = { id: genId(), name: groupName.trim(), parentId: '', sortOrder: folders.length }
    await SaveFolder(f)
    setFolders([...folders, f])
    setGroupDialog(false); setGroupName(''); setCtx(null)
  }

  const openGroupDialog = () => { setGroupName(''); setGroupDialog(true); setCtx(null) }

  const delGroup = async (f: Folder) => {
    if (!confirm(`Delete group "${f.name}"? Sessions will become unassigned.`)) return
    await DeleteFolder(f.id)
    setFolders(folders.filter(x => x.id !== f.id))
    setCtx(null)
  }

  const handleImport = () => { fileRef.current?.click(); setCtx(null) }
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const n = await ImportSessions((f as any).path || f.name)
      alert(`Imported ${n} sessions`)
      window.dispatchEvent(new CustomEvent('sessions-changed'))
    } catch (err: any) { alert('Import failed: ' + err)}
    e.target.value = ''
  }

  const handleExport = async () => {
    try {
      await ExportSessions('omniterm-sessions.json')
      alert('Exported to omniterm-sessions.json')
    } catch (err: any) { alert('Export failed: ' + err) }
    setCtx(null)
  }

  // Drag to move session between groups
  const handleDragStart = (e: React.DragEvent, s: Session) => {
    e.dataTransfer.setData('sessionId', s.id)
  }
  const handleDrop = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    const sid = e.dataTransfer.getData('sessionId')
    if (!sid) return
    const s = sessions.find(x => x.id === sid)
    if (!s) return
    const updated = { ...s, folderId }
    setSessions(sessions.map(x => x.id === sid ? updated : x))
    // Save to backend
    const { SaveSession } = await import('../../wailsjs/go/main/App')
    await SaveSession({ ...updated, username: updated.username || '', password: updated.password || '', privateKeyPath: updated.privateKeyPath || '', proxyJump: updated.proxyJump || '', telnetTermType: updated.telnetTermType || '', parity: updated.parity || 'none', flowControl: updated.flowControl || 'none', folderId: updated.folderId || '', sortOrder: updated.sortOrder || 0 })
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  // Protocol colors matching SessionDialog protocol bar
  const protoColor = (proto: string) => {
    switch (proto) {
      case 'ssh': return '#569cd6'
      case 'sftp': return '#569cd6'
      case 'telnet': return '#ce9178'
      case 'serial': return '#dcdcaa'
      case 'rdp': return '#4ec9b0'
      case 'vnc': return '#c586c0'
      case 'ftp': return '#4fc1ff'
      default: return '#858585'
    }
  }

  const protoLabel = (proto: string) => proto.toUpperCase()

  const renderSession = (s: Session) => {
    const color = protoColor(s.protocol)
    return (
      <div key={s.id}
        draggable
        onDragStart={e => handleDragStart(e, s)}
        onDoubleClick={() => onDoubleClick(s)}
        onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, type: 'session', session: s }) }}
        className="flex items-center gap-1.5 h-7 px-2 hover:bg-vscode-hover cursor-pointer text-[13px] text-vscode-text group">
        <GripVertical size={10} className="text-vscode-text-dim/30 opacity-0 group-hover:opacity-100 shrink-0" />
        <span className="text-[10px] font-semibold px-1 py-0.5 rounded shrink-0 min-w-[32px] text-center"
          style={{ background: color + '22', color: color, border: '1px solid ' + color + '44' }}>
          {protoLabel(s.protocol)}
        </span>
        <span className="truncate">{s.name}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar" onContextMenu={handleRootCtx}>
      <div className="flex-1 overflow-y-auto">
        {/* Folders */}
        {folders.map(f => {
          const fs = folderSessions(f.id)
          const ex = expanded.has(f.id)
          return (
            <div key={f.id}
              onDrop={e => handleDrop(e, f.id)}
              onDragOver={handleDragOver}>
              <button onClick={() => toggle(f.id)}
                onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, type: 'folder', folder: f }) }}
                className="w-full flex items-center gap-1 h-7 px-2 hover:bg-vscode-hover text-[14px] text-vscode-text font-semibold uppercase tracking-wide">
                {ex ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {f.name}
                <span className="text-vscode-text-dim ml-auto">{fs.length}</span>
              </button>
              {ex && fs.map(renderSession)}
            </div>
          )
        })}

        {/* Unassigned */}
        {unassigned.length > 0 && (
          <div onDrop={e => handleDrop(e, '')} onDragOver={handleDragOver}>
            {folders.length > 0 && (
              <div className="px-2 h-6 flex items-center text-[10px] text-vscode-text-dim uppercase tracking-wide">
                Default
              </div>
            )}
            {unassigned.map(renderSession)}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-[11px] text-vscode-text-dim">
            <p>No sessions</p>
            <button onClick={onNewSession} className="text-vscode-accent hover:text-vscode-accent-hover mt-1">Create one</button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />

      {/* Context menu */}
      {ctx && (
        <div className="fixed z-50 w-40 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctx.x, top: ctx.y }}>
          {ctx.type === 'session' && ctx.session && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.session.name}</div>
              <button onClick={() => { onEditSession(ctx.session!); setCtx(null) }}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> Edit</button>
              <button onClick={async () => { await DeleteSession(ctx.session!.id); window.dispatchEvent(new CustomEvent('sessions-changed')); setCtx(null) }}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Trash2 size={12} /> Delete</button>
            </>
          )}
          {ctx.type === 'folder' && ctx.folder && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.folder.name}</div>
              <button onClick={() => delGroup(ctx.folder!)}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> Delete Group</button>
            </>
          )}
          {ctx.type === 'root' && (
            <>
              <button onClick={openGroupDialog}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><FolderPlus size={12} /> New Group</button>
              <button onClick={handleImport}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Upload size={12} /> Import</button>
              <button onClick={handleExport}
                className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Download size={12} /> Export</button>
            </>
          )}
        </div>
      )}

      {/* New Group dialog */}
      {groupDialog && (
        <FormDialog
          title="New Group"
          fields={[{ label: 'Group Name', value: groupName, set: setGroupName, placeholder: 'Production / Test / Dev' }]}
          onConfirm={addGroup}
          onCancel={() => { setGroupDialog(false); setGroupName('') }}
          confirmLabel="Create"
          confirmDisabled={!groupName.trim()}
        />
      )}
    </div>
  )
}
