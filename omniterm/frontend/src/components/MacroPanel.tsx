import { useState, useEffect } from 'react'
import { Play, Trash2, Plus, Pencil, Circle, Square, ChevronRight, ChevronDown, FolderPlus, Copy, Download, Upload } from 'lucide-react'
import FormDialog from './FormDialog'
import { useRecordingStore } from '../stores/recordingStore'
import { DEFAULT_GROUP, genId } from '../stores/groupStore'

interface Command { id: string; name: string; text: string; groupId: string }
interface Group { id: string; name: string; parentId: string }
interface Props { searchTerm?: string; onClose: () => void; onSendMacro: (data: string) => void }
interface CtxMenu { x: number; y: number; type: 'cmd' | 'group' | 'root'; cmd?: Command; group?: Group }

function loadCmds(): Command[] { try { const d = localStorage.getItem('omni-cmds2'); return d ? JSON.parse(d) : [] } catch { return [] } }
function saveCmds(c: Command[]) { localStorage.setItem('omni-cmds2', JSON.stringify(c)) }
function loadGroups(): Group[] {
  try { const g: Group[] = JSON.parse(localStorage.getItem('omni-groups2') || '[]'); return g.find(x => x.id === 'default') ? g : [DEFAULT_GROUP, ...g] } catch { return [DEFAULT_GROUP] }
}
function saveGroups(g: Group[]) { localStorage.setItem('omni-groups2', JSON.stringify(g)) }

export default function MacroPanel({ searchTerm = '', onClose, onSendMacro }: Props) {
  const [cmds, setCmds] = useState<Command[]>(loadCmds)
  const [groups, setGroups] = useState<Group[]>(loadGroups)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['default']))
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [dialog, setDialog] = useState<{ type: string; cmd?: Command; group?: Group; parentId?: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'cmd' | 'group'; item: Command | Group } | null>(null)
  const [dName, setDName] = useState(''); const [dText, setDText] = useState(''); const [dGid, setDGid] = useState('default')

  const recording = useRecordingStore(s => s.active)
  const recKeys = useRecordingStore(s => s.keys)
  const startRec = useRecordingStore(s => s.start)
  const stopRec = useRecordingStore(s => s.stop)

  useEffect(() => { saveCmds(cmds) }, [cmds])
  useEffect(() => { saveGroups(groups) }, [groups])
  useEffect(() => { const h = () => setCtx(null); if (ctx) { window.addEventListener('click', h); return () => window.removeEventListener('click', h) } }, [ctx])

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const filtered = cmds.filter(c => !searchTerm || c.name.includes(searchTerm) || c.text.includes(searchTerm))
  const groupCmds = (gid: string) => filtered.filter(c => c.groupId === gid)
  const childGroups = (pid: string) => groups.filter(g => g.parentId === pid)
  const rootGroups = childGroups('')

  const runCmd = (c: Command) => { onSendMacro(c.text + '\r') }
  const copyCmd = (c: Command) => { navigator.clipboard.writeText(c.text) }
  const deleteCmd = (id: string) => { setCmds(cmds.filter(c => c.id !== id)); setCtx(null); setConfirmDelete(null) }
  const confirmDeleteCmd = (cmd: Command) => { setConfirmDelete({ type: 'cmd', item: cmd }); setCtx(null) }
  const handleDragStart = (e: React.DragEvent, id: string) => { e.dataTransfer.setData('cmdId', id) }
  const handleDrop = (e: React.DragEvent, groupId: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('cmdId')
    if (id) setCmds(prev => prev.map(c => c.id === id ? { ...c, groupId } : c))
  }

  const addGroup = (parentId: string) => { if (!dName.trim()) return; setGroups([...groups, { id: genId(), name: dName.trim(), parentId }]); setDialog(null) }
  const renameGroup = (g: Group) => { if (!dName.trim()) return; setGroups(groups.map(x => x.id === g.id ? { ...x, name: dName.trim() } : x)); setDialog(null); setCtx(null) }
  const deleteGroup = (g: Group) => {
    if (g.id === 'default') return
    const ids = new Set([g.id]); const collect = (pid: string) => { childGroups(pid).forEach(c => { ids.add(c.id); collect(c.id) }) }; collect(g.id)
    setGroups(groups.filter(x => !ids.has(x.id))); setCmds(cmds.map(c => ids.has(c.groupId) ? { ...c, groupId: 'default' } : c))
    setCtx(null); setConfirmDelete(null)
  }
  const confirmDeleteGroup = (group: Group) => { setConfirmDelete({ type: 'group', item: group }); setCtx(null) }

  // Export/Import
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ groups, cmds }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'omnimind-cmds.json'; a.click()
    setCtx(null)
  }
  const importData = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'
    input.onchange = (e: any) => {
      const f = e.target?.files?.[0]; if (!f) return
      const r = new FileReader(); r.onload = () => {
        try { const { groups: g, cmds: c } = JSON.parse(r.result as string); if (g) setGroups(g); if (c) setCmds(c) } catch {}
      }; r.readAsText(f)
    }
    input.click()
    setCtx(null)
  }

  const addCmd = () => { if (!dName.trim() || !dText.trim()) return; setCmds([...cmds, { id: genId(), name: dName.trim(), text: dText.trim(), groupId: dGid || 'default' }]); setDialog(null) }
  const editCmd = () => { if (!dName.trim() || !dialog?.cmd) return; setCmds(cmds.map(c => c.id === dialog.cmd!.id ? { ...c, name: dName.trim(), text: dText.trim(), groupId: dGid || 'default' } : c)); setDialog(null) }

  const openAddCmd = (groupId: string) => { setDName(''); setDText(''); setDGid(groupId || 'default'); setDialog({ type: 'addCmd' }) }
  const openEditCmd = (c: Command) => { setDName(c.name); setDText(c.text); setDGid(c.groupId || 'default'); setDialog({ type: 'editCmd', cmd: c }) }
  const openRecord = (groupId: string) => { setDName(''); setDGid(groupId || 'default'); setDialog({ type: 'record' }) }
  const startRecording = () => { if (!dName.trim()) return; startRec(dName.trim()); setDialog(null) }
  const stopRecording = () => { const r = stopRec(); if (r) setCmds([...cmds, { id: genId(), name: r.name, text: r.command, groupId: dGid }]) }

  const preview = (text: string) => text.replace(/\r/g,'↵').substring(0, 50)

  const renderGroup = (g: Group, depth: number) => {
    const items = groupCmds(g.id)
    const children = childGroups(g.id)
    const ex = expanded.has(g.id)
    const isDefault = g.id === 'default'
    return (
      <div key={g.id} onDrop={e => handleDrop(e, g.id)} onDragOver={e => e.preventDefault()}>
        <div className="group flex items-center h-8 hover:bg-vscode-hover border-b border-vscode-border/30"
          style={{ paddingLeft: 8 + depth * 12 }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, type: 'group', group: g }) }}>
          <button onClick={() => toggle(g.id)} className="flex items-center gap-1 flex-1">
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
            {items.map(c => (
              <div key={c.id} draggable onDragStart={e => handleDragStart(e, c.id)}
                className="flex items-center gap-1.5 h-10 hover:bg-vscode-hover border-b border-vscode-border/20 group/item"
                style={{ paddingLeft: 20 + depth * 12 }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, type: 'cmd', cmd: c }) }}>
                <button onClick={() => runCmd(c)} className="p-1 hover:bg-vscode-green/20 rounded shrink-0"><Play size={15} className="text-vscode-green" /></button>
                <div className="flex-1 min-w-0" onDoubleClick={() => runCmd(c)}>
                  <div className="text-[12px] text-vscode-text truncate">{c.name}</div>
                  <div className="text-[9px] text-vscode-text-dim/60 font-mono truncate">{preview(c.text)}</div>
                </div>
                <button onClick={() => copyCmd(c)} className="p-0.5 hover:bg-vscode-hover rounded shrink-0 opacity-0 group-hover/item:opacity-100"><Copy size={10} className="text-vscode-text-muted" /></button>
                <button onClick={() => openEditCmd(c)} className="p-0.5 hover:bg-vscode-hover rounded opacity-0 group-hover/item:opacity-100"><Pencil size={10} className="text-vscode-text-muted" /></button>
                <button onClick={() => confirmDeleteCmd(c)} className="p-0.5 hover:bg-vscode-hover rounded opacity-0 group-hover/item:opacity-100"><Trash2 size={10} className="text-vscode-text-muted hover:text-vscode-red" /></button>
              </div>
            ))}
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
    <div className="flex flex-col h-full bg-vscode-sidebar" onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, type: 'root' }) }}>
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-vscode-text">Commands</span>
        <div className="flex items-center gap-1">
          {!recording ? (
            <button onClick={() => openRecord('default')} className="flex items-center gap-0.5 px-1.5 h-5 bg-vscode-red/20 hover:bg-vscode-red/30 text-vscode-red rounded text-[10px]"><Circle size={8} /> 录制</button>
          ) : (
            <button onClick={stopRecording} className="flex items-center gap-0.5 px-1.5 h-5 bg-vscode-red hover:bg-red-600 text-white rounded text-[10px] animate-pulse"><Square size={8} /> 停止</button>
          )}
          <button onClick={() => openAddCmd('default')} className="flex items-center gap-0.5 px-1.5 h-5 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px]"><Plus size={10} /> 添加</button>
        </div>
      </div>
      {recording && (
        <div className="px-2 py-1 bg-vscode-red/10 border-b border-vscode-red/20 text-[10px] text-vscode-red font-mono">⏺ 录制中: {preview(recKeys) || '等待输入...'}</div>
      )}
      <div className="flex-1 overflow-y-auto">
        {rootGroups.map(g => renderGroup(g, 0))}
      </div>

      {/* Context menu */}
      {ctx && (
        <div className="fixed z-50 w-44 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctx.x, top: ctx.y }}>
          {ctx.type === 'cmd' && ctx.cmd && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.cmd.name}</div>
              <button onClick={() => { runCmd(ctx.cmd!); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Play size={12} /> 运行</button>
              <button onClick={() => { copyCmd(ctx.cmd!); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Copy size={12} /> 复制</button>
              <button onClick={() => { openEditCmd(ctx.cmd!); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> 编辑</button>
              <button onClick={() => confirmDeleteCmd(ctx.cmd!)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> 删除</button>
            </>
          )}
          {ctx.type === 'group' && ctx.group && (
            <>
              <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.group.name}</div>
              <button onClick={() => { setDName(''); setDialog({ type: 'addGroup', parentId: ctx.group!.id }) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><FolderPlus size={12} /> 子分组</button>
              {ctx.group.id !== 'default' && <button onClick={() => { setDName(ctx.group!.name); setDialog({ type: 'rename', group: ctx.group }) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> 重命名</button>}
              {ctx.group.id !== 'default' && <button onClick={() => confirmDeleteGroup(ctx.group!)} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> 删除</button>}
            </>
          )}
          {ctx.type === 'root' && (
            <>
              <button onClick={() => { setDName(''); setDialog({ type: 'addGroup', parentId: '' }) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><FolderPlus size={12} /> 新增分组</button>
              <button onClick={exportData} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Download size={12} /> 导出分组</button>
              <button onClick={importData} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Upload size={12} /> 导入分组</button>
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
        <FormDialog title="重命名" confirmLabel="保存" confirmDisabled={!dName.trim()}
          fields={[{ label: '名称', value: dName, set: setDName, placeholder: '' }]}
          onConfirm={() => renameGroup(dialog.group!)} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === 'addCmd' && (
        <FormDialog title="添加指令" confirmLabel="保存" confirmDisabled={!dName.trim() || !dText.trim()}
          fields={[
            { label: '名称', value: dName, set: setDName, placeholder: '指令名称' },
            { label: '分组', value: dGid, set: setDGid, selectOptions: groups.map(g => ({ value: g.id, label: g.name })) },
            { label: '指令', value: dText, set: setDText, placeholder: '命令内容', multiline: true },
          ]}
          onConfirm={addCmd} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === 'editCmd' && (
        <FormDialog title="编辑指令" confirmLabel="保存" confirmDisabled={!dName.trim() || !dText.trim()}
          fields={[
            { label: '名称', value: dName, set: setDName, placeholder: '' },
            { label: '分组', value: dGid, set: setDGid, selectOptions: groups.map(g => ({ value: g.id, label: g.name })) },
            { label: '指令', value: dText, set: setDText, placeholder: '', multiline: true },
          ]}
          onConfirm={editCmd} onCancel={() => setDialog(null)} />
      )}
      {dialog?.type === 'record' && (
        <FormDialog title="录制指令" confirmLabel="开始录制" confirmDisabled={!dName.trim()}
          fields={[
            { label: '名称', value: dName, set: setDName, placeholder: '指令名称' },
            { label: '分组', value: dGid, set: setDGid, selectOptions: groups.map(g => ({ value: g.id, label: g.name })) },
          ]}
          onConfirm={startRecording} onCancel={() => setDialog(null)} />
      )}
      {confirmDelete?.type === 'cmd' && (
        <FormDialog title="删除指令" danger confirmLabel="删除"
          fields={[{ label: '', value: `确定删除指令 "${(confirmDelete.item as Command).name}" 吗？此操作不可恢复。`, set: () => {}, displayOnly: true }]}
          onConfirm={() => deleteCmd((confirmDelete.item as Command).id)}
          onCancel={() => setConfirmDelete(null)} />
      )}
      {confirmDelete?.type === 'group' && (
        <FormDialog title="删除分组" danger confirmLabel="删除"
          fields={[{ label: '', value: `确定删除分组 "${(confirmDelete.item as Group).name}" 吗？所有子分组将一起删除，指令会移动到默认组。`, set: () => {}, displayOnly: true }]}
          onConfirm={() => deleteGroup(confirmDelete.item as Group)}
          onCancel={() => setConfirmDelete(null)} />
      )}
    </div>
  )
}
