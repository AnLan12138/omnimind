import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Search, BookOpen } from 'lucide-react'
import { ListKnowledge, ImportKnowledge, DeleteKnowledge } from '../../wailsjs/go/main/App'
import { ai } from '../../wailsjs/go/models'

export default function KnowledgePanel() {
  const [docs, setDocs] = useState<ai.RAGDocument[]>([])
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')

  const load = useCallback(async () => {
    try { setDocs(await ListKnowledge()) } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = docs.filter(d =>
    !search || d.title.includes(search) || d.content.includes(search) || d.tags.some(t => t.includes(search))
  )

  const add = async () => {
    if (!title.trim() || !content.trim()) return
    await ImportKnowledge(title.trim(), content.trim(), tags)
    setTitle(''); setContent(''); setTags(''); setAdding(false)
    load()
  }

  const del = async (id: string) => {
    await DeleteKnowledge(id)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 pt-2 pb-1 shrink-0 relative">
        <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-vscode-text-dim pointer-events-none" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索知识库..."
          className="w-full h-7 pl-7 pr-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <BookOpen size={24} className="text-vscode-text-dim/30" />
            <p className="text-[11px] text-vscode-text-dim">{search ? '没有匹配的文档' : '知识库为空'}</p>
          </div>
        ) : filtered.map(doc => (
          <div key={doc.id} className="border-b border-vscode-border/30 py-2 group">
            <div className="flex items-start justify-between">
              <span className="text-[12px] font-medium text-vscode-text truncate flex-1">{doc.title}</span>
              <button onClick={() => del(doc.id)} className="p-0.5 hover:bg-vscode-red/20 rounded opacity-0 group-hover:opacity-100 shrink-0">
                <Trash2 size={11} className="text-vscode-red" />
              </button>
            </div>
            <p className="text-[10px] text-vscode-text-dim mt-0.5 line-clamp-3 whitespace-pre-wrap">{doc.content.slice(0, 200)}</p>
            {doc.tags?.length > 0 && (
              <div className="flex gap-1 mt-1">
                {doc.tags.map(t => (
                  <span key={t} className="px-1 py-0.5 bg-vscode-accent/10 text-vscode-accent rounded text-[9px]">{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add form */}
      <div className="shrink-0 border-t border-vscode-border p-2">
        {adding ? (
          <div className="space-y-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="文档标题"
              className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
            <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="文档内容..."
              rows={4}
              className="w-full px-2 py-1 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text resize-none focus:outline-none focus:border-vscode-accent" />
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="标签，逗号分隔"
              className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
            <div className="flex gap-1.5">
              <button onClick={add} disabled={!title.trim() || !content.trim()}
                className="px-2 py-0.5 bg-vscode-accent text-white rounded text-[10px] disabled:opacity-40">添加</button>
              <button onClick={() => setAdding(false)} className="px-2 py-0.5 bg-vscode-input text-vscode-text rounded text-[10px]">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-2 py-1 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px] w-full justify-center">
            <Plus size={11} /> 添加知识文档
          </button>
        )}
      </div>
    </div>
  )
}
