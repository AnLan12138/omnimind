import { useState, useEffect } from 'react'
import { Play, Save, Trash2, X, Plus, ChevronDown, ChevronRight } from 'lucide-react'

interface Snippet {
  id: string
  name: string
  command: string
  category: string
}

interface Props {
  onClose: () => void
  onSend: (data: string) => void
}

const DEFAULT_SNIPPETS: Snippet[] = [
  { id: '1', name: 'System Info', command: 'uname -a\r', category: 'System' },
  { id: '2', name: 'Disk Usage', command: 'df -h\r', category: 'System' },
  { id: '3', name: 'Memory Info', command: 'free -m\r', category: 'System' },
  { id: '4', name: 'Processes', command: 'ps aux --sort=-%mem | head -20\r', category: 'System' },
  { id: '5', name: 'List Files', command: 'ls -lah\r', category: 'Files' },
  { id: '6', name: 'Find Large Files', command: 'find / -type f -size +100M -exec ls -lh {} \\; 2>/dev/null\r', category: 'Files' },
  { id: '7', name: 'Tail Logs', command: 'tail -f /var/log/syslog\r', category: 'Logs' },
  { id: '8', name: 'Nginx Reload', command: 'nginx -t && nginx -s reload\r', category: 'Services' },
  { id: '9', name: 'Docker PS', command: 'docker ps -a\r', category: 'Docker' },
  { id: '10', name: 'SSH Key Copy', command: 'ssh-copy-id user@host\r', category: 'SSH' },
]

function generateId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 8) }

function loadSnippets(): Snippet[] {
  try { const d = localStorage.getItem('omniterm-snippets'); return d ? JSON.parse(d) : DEFAULT_SNIPPETS }
  catch { return DEFAULT_SNIPPETS }
}
function saveSnippets(s: Snippet[]) { localStorage.setItem('omniterm-snippets', JSON.stringify(s)) }

export default function SnippetsPanel({ onClose, onSend }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCmd, setNewCmd] = useState('')
  const [newCat, setNewCat] = useState('')
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(['System','Files','Logs','Services','Docker','SSH']))
  const [search, setSearch] = useState('')

  useEffect(() => { saveSnippets(snippets) }, [snippets])

  const categories = [...new Set(snippets.map((s) => s.category))].sort()
  const filtered = snippets.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.command.toLowerCase().includes(search.toLowerCase())
  )

  const addSnippet = () => {
    if (!newName.trim() || !newCmd.trim()) return
    setSnippets([...snippets, {
      id: generateId(), name: newName.trim(), command: newCmd.trim(),
      category: newCat.trim() || 'General',
    }])
    setNewName(''); setNewCmd(''); setNewCat(''); setShowAdd(false)
  }

  const deleteSnippet = (id: string) => setSnippets(snippets.filter((s) => s.id !== id))

  const toggleCat = (cat: string) => {
    setExpandedCats((p) => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-t border-border">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <span className="text-xs font-semibold text-text-secondary">Snippets</span>
        <div className="flex-1" />
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 px-2 py-0.5 bg-accent hover:bg-accent-hover text-white rounded text-[10px]">
          <Plus size={10} /> Add
        </button>
        <button onClick={onClose} className="p-0.5 hover:bg-bg-hover rounded"><X size={12} className="text-text-muted" /></button>
      </div>

      {/* Search */}
      <div className="px-2 py-1">
        <input type="text" placeholder="Search snippets..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-3 py-2 bg-bg-tertiary border-b border-border space-y-1.5">
          <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)}
            className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none"
          />
          <textarea placeholder="Command" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} rows={2}
            className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none resize-none font-mono"
          />
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Category" value={newCat} onChange={(e) => setNewCat(e.target.value)}
              className="flex-1 px-2 py-1 bg-bg-primary border border-border rounded text-[11px] text-text-primary placeholder-text-muted focus:outline-none"
            />
            <button onClick={addSnippet} className="px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded text-[10px]">Save</button>
          </div>
        </div>
      )}

      {/* Snippet list by category */}
      <div className="flex-1 overflow-y-auto">
        {categories.map((cat) => {
          const catSnippets = filtered.filter((s) => s.category === cat)
          if (catSnippets.length === 0) return null
          const expanded = expandedCats.has(cat)
          return (
            <div key={cat}>
              <button onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-1 px-2 py-1.5 hover:bg-bg-hover text-[10px] text-text-muted uppercase tracking-wider transition-colors"
              >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {cat} <span className="text-text-muted/40">{catSnippets.length}</span>
              </button>
              {expanded && catSnippets.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 group hover:bg-bg-hover transition-colors">
                  <button onClick={() => onSend(s.command)} className="p-0.5 hover:bg-accent/20 rounded shrink-0" title="Send">
                    <Play size={11} className="text-accent-green" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-text-secondary truncate">{s.name}</div>
                    <div className="text-[9px] text-text-muted/50 font-mono truncate">{s.command}</div>
                  </div>
                  <button onClick={() => deleteSnippet(s.id)} className="p-0.5 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Trash2 size={10} className="text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
