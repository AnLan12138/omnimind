import { useState, useEffect } from 'react'
import { Play, Trash2, Plus, Pencil, Circle, Square } from 'lucide-react'
import FormDialog from './FormDialog'
import { useRecordingStore } from '../stores/recordingStore'

interface Macro { id: string; name: string; command: string }
interface Props { searchTerm?: string; onClose: () => void; onSendMacro: (data: string) => void }

function genId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 8) }
function load(): Macro[] { try { const d = localStorage.getItem('omniterm-macros'); return d ? JSON.parse(d) : [] } catch { return [] } }
function save(m: Macro[]) { localStorage.setItem('omniterm-macros', JSON.stringify(m)) }

export default function MacroPanel({ searchTerm = '', onClose, onSendMacro }: Props) {
  const [macros, setMacros] = useState<Macro[]>(load)
  const [dialog, setDialog] = useState<{ type: 'new' | 'edit'; macro?: Macro } | null>(null)
  const [dName, setDName] = useState('')
  const [dCmd, setDCmd] = useState('')
  const [recordDialog, setRecordDialog] = useState(false)
  const [recordName, setRecordName] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; macro: Macro } | null>(null)

  const recording = useRecordingStore(s => s.active)
  const recordingName = useRecordingStore(s => s.name)
  const recordingKeys = useRecordingStore(s => s.keys)
  const startRec = useRecordingStore(s => s.start)
  const stopRec = useRecordingStore(s => s.stop)

  useEffect(() => { save(macros) }, [macros])
  useEffect(() => {
    const h = () => setCtxMenu(null)
    if (ctxMenu) { window.addEventListener('click', h); return () => window.removeEventListener('click', h) }
  }, [ctxMenu])

  const openNew = () => { setDName(''); setDCmd(''); setDialog({ type: 'new' }) }
  const openEdit = (m: Macro) => { setDName(m.name); setDCmd(m.command); setDialog({ type: 'edit', macro: m }) }

  const confirmDialog = () => {
    if (!dName.trim()) return
    if (dialog?.type === 'new') {
      setMacros([...macros, { id: genId(), name: dName.trim(), command: dCmd.trim() }])
    } else if (dialog?.type === 'edit' && dialog.macro) {
      setMacros(macros.map(m => m.id === dialog.macro!.id ? { ...m, name: dName.trim(), command: dCmd.trim() } : m))
    }
    setDialog(null)
  }

  const openRecord = () => { setRecordName(''); setRecordDialog(true) }
  const startRecording = () => {
    if (!recordName.trim()) return
    startRec(recordName.trim())
    setRecordDialog(false)
  }

  const stopRecording = () => {
    const result = stopRec()
    if (result) {
      setMacros([...macros, { id: genId(), name: result.name, command: result.command }])
    }
  }

  const remove = (id: string) => { setMacros(macros.filter(m => m.id !== id)); setCtxMenu(null) }
  const playMacro = (m: Macro) => { onSendMacro(m.command + '\r') }

  const preview = (cmd: string) => cmd.replace(/\r/g,'↵').replace(/\x7f/g,'⌫').replace(/\t/g,'⇥').substring(0, 60)

  const filtered = macros.filter(m => !searchTerm || m.name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar">
      {/* Toolbar */}
      <div className="flex items-center justify-between h-8 px-2 border-b border-vscode-border shrink-0">
        <span className="text-[11px] font-semibold text-vscode-text">Macros</span>
        <div className="flex items-center gap-1">
          {!recording ? (
            <button onClick={openRecord}
              className="flex items-center gap-0.5 px-2 h-5 bg-vscode-red/20 hover:bg-vscode-red/30 text-vscode-red rounded text-[10px]">
              <Circle size={8} /> Record
            </button>
          ) : (
            <button onClick={stopRecording}
              className="flex items-center gap-0.5 px-2 h-5 bg-vscode-red hover:bg-red-600 text-white rounded text-[10px] animate-pulse">
              <Square size={8} /> Stop
            </button>
          )}
          <button onClick={openNew}
            className="flex items-center gap-0.5 px-2 h-5 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px]">
            <Plus size={10} /> New
          </button>
        </div>
      </div>

      {/* Recording indicator */}
      {recording && (
        <div className="px-2 py-1 bg-vscode-red/10 border-b border-vscode-red/20 text-[10px] text-vscode-red font-mono">
          ⏺ Recording "{recordingName}": {preview(recordingKeys) || 'Listening...'}
        </div>
      )}

      {/* Macro list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[11px] text-vscode-text-dim">
            {searchTerm ? 'No macros match search.' : 'No macros. Click "Record" and start typing, or "New" to write a command.'}
          </div>
        ) : (
          filtered.map(m => (
            <div key={m.id}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, macro: m }) }}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-vscode-border/30 group hover:bg-vscode-hover transition-colors">
              <button onClick={() => playMacro(m)} className="p-1 hover:bg-vscode-green/20 rounded shrink-0" title="Run">
                <Play size={18} className="text-vscode-green" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-vscode-text truncate font-medium">{m.name}</div>
                <div className="text-[10px] text-vscode-text-dim/50 font-mono truncate">{preview(m.command)}</div>
              </div>
              <button onClick={() => openEdit(m)} className="p-1 hover:bg-vscode-hover rounded opacity-0 group-hover:opacity-100 shrink-0">
                <Pencil size={13} className="text-vscode-text-muted" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="fixed z-50 w-36 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button onClick={() => { openEdit(ctxMenu.macro); setCtxMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Pencil size={12} /> Edit</button>
          <button onClick={() => { playMacro(ctxMenu.macro); setCtxMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text"><Play size={12} /> Run</button>
          <button onClick={() => remove(ctxMenu.macro.id)}
            className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> Delete</button>
        </div>
      )}

      {dialog && (
        <FormDialog
          title={dialog.type === 'new' ? 'New Macro' : 'Edit Macro'}
          fields={[
            { label: 'Name', value: dName, set: setDName, placeholder: 'Macro name' },
            { label: 'Command', value: dCmd, set: setDCmd, placeholder: 'Command to send', multiline: true },
          ]}
          onConfirm={confirmDialog} onCancel={() => setDialog(null)}
          confirmLabel="Save" confirmDisabled={!dName.trim()}
        />
      )}

      {recordDialog && (
        <FormDialog
          title="Record Macro"
          fields={[{ label: 'Name', value: recordName, set: setRecordName, placeholder: 'Macro name' }]}
          onConfirm={startRecording} onCancel={() => setRecordDialog(false)}
          confirmLabel="Start Recording" confirmDisabled={!recordName.trim()}
        />
      )}
    </div>
  )
}
