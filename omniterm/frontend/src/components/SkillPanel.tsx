import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import { ListSkills, SaveSkill, DeleteSkill } from '../../wailsjs/go/main/App'
import { skill } from '../../wailsjs/go/models'

export default function SkillPanel() {
  const [skills, setSkills] = useState<skill.Skill[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editPrompt, setEditPrompt] = useState('')
  const [editId, setEditId] = useState('')

  const load = useCallback(async () => {
    try { setSkills(await ListSkills()) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const getPrompt = (s: skill.Skill): string => {
    try { return JSON.parse(s.Description).prompt || '' } catch { return '' }
  }

  const startEdit = (s: skill.Skill) => {
    setEditing(s.ID)
    setEditName(s.Name)
    setEditDesc(s.Description)
    setEditPrompt(getPrompt(s))
  }

  const startAdd = () => {
    setAdding(true)
    setEditId('')
    setEditName('')
    setEditDesc('')
    setEditPrompt('')
  }

  const save = async () => {
    if (!editName.trim()) return
    const id = editing || editId || editName.toLowerCase().replace(/\s+/g, '-')
    await SaveSkill(id, editName.trim(), editDesc.trim(), editPrompt, '')
    setEditing(null); setAdding(false)
    load()
  }

  const del = async (id: string) => {
    await DeleteSkill(id)
    setExpanded(null); setEditing(null)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-2">
        {skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <Zap size={24} className="text-vscode-text-dim/30" />
            <p className="text-[11px] text-vscode-text-dim">暂无技能</p>
          </div>
        ) : skills.map(s => (
          <div key={s.ID} className="border-b border-vscode-border/30 py-2 group">
            <div className="flex items-center justify-between">
              <button onClick={() => setExpanded(expanded === s.ID ? null : s.ID)}
                className="flex items-center gap-1 text-[12px] font-medium text-vscode-text hover:text-white">
                {expanded === s.ID ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Zap size={12} className="text-vscode-accent" />
                {s.Name}
                {s.Builtin && <span className="text-[9px] px-1 bg-vscode-accent/10 text-vscode-accent rounded">内置</span>}
              </button>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button onClick={() => startEdit(s)} className="p-0.5 hover:bg-vscode-hover rounded">
                  <Pencil size={10} className="text-vscode-text-muted" />
                </button>
                <button onClick={() => del(s.ID)} className="p-0.5 hover:bg-vscode-red/20 rounded">
                  <Trash2 size={10} className="text-vscode-red" />
                </button>
              </div>
            </div>
            <p className="text-[10px] text-vscode-text-dim mt-0.5 ml-4">{s.Description}</p>

            {expanded === s.ID && editing !== s.ID && (
              <div className="mt-2 ml-4 p-2 bg-vscode-input rounded text-[10px] text-vscode-text-muted whitespace-pre-wrap max-h-32 overflow-y-auto">
                ID: {s.ID} | Version: {s.Version || '-'} | {s.Enabled ? '启用' : '禁用'}
              </div>
            )}

            {editing === s.ID && (
              <div className="mt-2 ml-4 space-y-1.5">
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="名称"
                  className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text" />
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="描述"
                  className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text" />
                <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} placeholder="System Prompt"
                  rows={4}
                  className="w-full px-2 py-1 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text resize-none font-mono" />
                <div className="flex gap-1.5">
                  <button onClick={save} className="px-2 py-0.5 bg-vscode-accent text-white rounded text-[10px]">保存</button>
                  <button onClick={() => setEditing(null)} className="px-2 py-0.5 bg-vscode-input text-vscode-text rounded text-[10px]">取消</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add form */}
      <div className="shrink-0 border-t border-vscode-border p-2">
        {adding ? (
          <div className="space-y-1.5">
            <input value={editId} onChange={e => setEditId(e.target.value)} placeholder="技能ID (如 cisco-expert)"
              className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text" />
            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="名称"
              className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text" />
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="描述"
              className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text" />
            <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} placeholder="System Prompt..."
              rows={3}
              className="w-full px-2 py-1 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text resize-none font-mono" />
            <div className="flex gap-1.5">
              <button onClick={save} disabled={!editName.trim()}
                className="px-2 py-0.5 bg-vscode-accent text-white rounded text-[10px] disabled:opacity-40">创建</button>
              <button onClick={() => setAdding(false)} className="px-2 py-0.5 bg-vscode-input text-vscode-text rounded text-[10px]">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={startAdd}
            className="flex items-center gap-1 px-2 py-1 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px] w-full justify-center">
            <Plus size={11} /> 添加技能
          </button>
        )}
      </div>
    </div>
  )
}
