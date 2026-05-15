import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Folder, File, Upload, Download, Trash2, Plus, ArrowLeft, RefreshCw, ChevronRight, Home, FilePlus } from 'lucide-react'
import { OpenSFTP, ListSFTP, SFTPDownload, SFTPMkdir, SFTPRemove, SFTPCreateFile, SFTPUploadData, PickDownloadDir } from '../../wailsjs/go/main/App'
import FormDialog from './FormDialog'

interface FileInfo { name: string; path: string; size: number; isDir: boolean; modTime: string }
interface Props { connId: string; searchTerm?: string; onClose: () => void }

function formatSize(b: number): string {
  if (b === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

function parentPath(p: string): string {
  if (p === '/') return '/'
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}

export default function FilePanel({ connId, searchTerm = '', onClose }: Props) {
  const [path, setPath] = useState('/')
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [draggingDownload, setDraggingDownload] = useState<FileInfo | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; target: FileInfo } | null>(null)
  const [dialog, setDialog] = useState<{ type: string } | null>(null)
  const [dName, setDName] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const [transferring, setTransferring] = useState<{ active: boolean; text: string; pct: number }>({ active: false, text: '', pct: 0 })

  // Init
  useEffect(() => { OpenSFTP(connId).then(() => setReady(true)).catch(e => setError(e?.message || e)) }, [connId])
  const load = useCallback(async (p: string) => {
    setLoading(true); setError('')
    try { setFiles((await ListSFTP(connId, p)) || []); setPath(p); setSelected(new Set()) }
    catch (e: any) { setError(e?.message || 'List failed') }
    finally { setLoading(false) }
  }, [connId])
  useEffect(() => { if (ready) load(path) }, [ready, load])

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement)?.closest('input')
      if (inInput) return
      if (e.key === 'Backspace') { e.preventDefault(); goUp() }
      if (e.key === 'Delete' && selected.size > 0) { e.preventDefault(); setDialog({ type: 'delete' }) }
      if (e.key === 'F5') { e.preventDefault(); load(path) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [path, selected])

  // Context menu close
  useEffect(() => { const h = () => setCtx(null); if (ctx) { window.addEventListener('click', h); return () => window.removeEventListener('click', h) } }, [ctx])

  const goUp = () => { if (path !== '/') load(parentPath(path)) }
  const enterDir = (f: FileInfo) => { if (f.isDir) load(f.path) }
  const toggleSelect = (name: string, ctrl: boolean) => {
    setSelected((p: Set<string>) => {
      const n = ctrl ? new Set<string>(p) : new Set<string>()
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  }

  // Filter
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return files
    const q = searchTerm.toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(q))
  }, [files, searchTerm])

  // Operations
  const op = {
    delete: async () => {
      setDialog(null)
      for (const name of selected) { const f = files.find(x => x.name === name); if (f) await SFTPRemove(connId, f.path).catch(() => {}) }
      load(path)
    },
    newFolder: async () => {
      if (!dName.trim()) return; setDialog(null)
      await SFTPMkdir(connId, path + '/' + dName.trim()).catch(e => setError(e?.message || e))
      load(path); setDName('')
    },
    newFile: async () => {
      if (!dName.trim()) return; setDialog(null)
      await SFTPCreateFile(connId, path + '/' + dName.trim()).catch(e => setError(e?.message || e))
      load(path); setDName('')
    },
    download: async () => {
      if (!dName.trim()) return; setDialog(null)
      for (const name of selected) {
        const f = files.find(x => x.name === name)
        if (f && !f.isDir) await SFTPDownload(connId, f.path, dName.trim() + '/' + f.name).catch(() => {})
      }
    },
  }

  // Breadcrumbs
  const crumbs = () => {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    const items = [{ name: '/', path: '/' }]
    let current = ''
    for (const p of parts) { current += '/' + p; items.push({ name: p, path: current }) }
    return items
  }

  // Upload a browser File as base64 (handles flat files, folders handled separately)
  const uploadBuf = (f: File, remoteDir: string): Promise<void> => new Promise(resolve => {
    const r = new FileReader()
    r.onload = () => {
      const b64 = (r.result as string).split(',')[1] || ''
      SFTPUploadData(connId, remoteDir + '/' + f.name, b64).catch(() => {}).finally(resolve)
    }
    r.onerror = () => resolve()
    r.readAsDataURL(f)
  })

  // Recursively traverse dropped items to handle folders
  const traverseEntries = async (entries: any[], remoteDir: string): Promise<void> => {
    for (const entry of entries) {
      if (entry.isFile) {
        const file: File = await new Promise(resolve => entry.file(resolve))
        await uploadBuf(file, remoteDir)
      } else if (entry.isDirectory) {
        const subDir = remoteDir + '/' + entry.name
        await SFTPMkdir(connId, subDir).catch(() => {})
        const reader = entry.createReader()
        const subEntries: any[] = await new Promise(resolve => {
          reader.readEntries((entries: any[]) => resolve(entries))
        })
        await traverseEntries(subEntries, subDir)
      }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      setTransferring({ active: true, text: 'Uploading...', pct: 0 })
      const done = () => {
        setTransferring({ active: true, text: 'Upload complete', pct: 100 })
        setTimeout(() => setTransferring({ active: false, text: '', pct: 0 }), 2500)
        load(path)
      }
      // Try webkitGetAsEntry for folder support
      const entries: any[] = []
      for (let i = 0; i < items.length; i++) {
        const entry = (items[i] as any).webkitGetAsEntry?.()
        if (entry) entries.push(entry)
      }
      if (entries.length > 0) {
        traverseEntries(entries, path).then(done)
      } else {
        // Fallback: flat files
        Promise.all(Array.from(e.dataTransfer.files).map(f => uploadBuf(f, path))).then(done)
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-vscode-sidebar"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>

      {/* Drop overlay */}
      {dragOver && <div className="absolute inset-0 z-10 bg-vscode-accent/10 border-2 border-dashed border-vscode-accent flex items-center justify-center pointer-events-none"><span className="text-vscode-accent text-xs font-medium">Drop to upload</span></div>}

      {/* Breadcrumb */}
      <div className="flex items-center h-7 px-1 border-b border-vscode-border overflow-x-auto shrink-0">
        <button onClick={() => load('/')} className="p-0.5 hover:bg-vscode-hover rounded shrink-0"><Home size={12} className="text-vscode-text-muted" /></button>
        {crumbs().map((c, i) => (
          <div key={c.path} className="flex items-center shrink-0">
            <ChevronRight size={10} className="text-vscode-text-dim/40 mx-0.5" />
            <button onClick={() => load(c.path)}
              className={`px-1 py-0.5 rounded text-[11px] hover:bg-vscode-hover ${i === crumbs().length - 1 ? 'text-vscode-text font-medium' : 'text-vscode-text-dim'}`}>
              {c.name}
            </button>
          </div>
        ))}
        <div className="flex-1" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-center h-12 px-1 border-b border-vscode-border gap-1.5 shrink-0">
        <button onClick={goUp} disabled={path === '/'} className="p-1.5 hover:bg-vscode-hover rounded disabled:opacity-30"><ArrowLeft size={17} className="text-vscode-text-muted" /></button>
        <button onClick={() => load(path)} className="p-1.5 hover:bg-vscode-hover rounded"><RefreshCw size={17} className={loading ? 'text-vscode-accent animate-spin' : 'text-vscode-text-muted'} /></button>
        <span className="text-vscode-text-dim/30 mx-1">|</span>
        <button onClick={() => uploadRef.current?.click()} className="p-1 hover:bg-vscode-hover rounded"><Upload size={17} className="text-vscode-text-muted" /></button>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={e => {
          if (e.target.files && e.target.files.length > 0) {
            const fl = Array.from(e.target.files)
            setTransferring({ active: true, text: `Uploading ${fl.length} file(s)...`, pct: 0 })
            Promise.all(fl.map(f => uploadBuf(f, path))).then(() => {
              setTransferring({ active: true, text: 'Upload complete', pct: 100 })
              setTimeout(() => setTransferring({ active: false, text: '', pct: 0 }), 2500)
              load(path)
            })
            e.target.value = ''
          }
        }} />
        <button onClick={async () => {
          try {
            const dir = await PickDownloadDir()
            if (!dir) return
            const dl = Array.from(selected).filter(name => { const f = files.find(x => x.name === name); return f && !f.isDir }).map(name => files.find(x => x.name === name)!)
            if (dl.length === 0) return
            setTransferring({ active: true, text: `Downloading ${dl.length} file(s)...`, pct: 0 })
            let done = 0
            for (const f of dl) {
              setTransferring({ active: true, text: `${f.name}`, pct: Math.round((done / dl.length) * 100) })
              await SFTPDownload(connId, f.path, dir + '/' + f.name).catch(() => {})
              done++
            }
            setTransferring({ active: true, text: 'Download complete', pct: 100 })
            setTimeout(() => setTransferring({ active: false, text: '', pct: 0 }), 2500)
          } catch {}
        }} disabled={selected.size === 0} className="p-1 hover:bg-vscode-hover rounded disabled:opacity-30" title="Download"><Download size={17} className="text-vscode-text-muted" /></button>
        <button onClick={() => selected.size > 0 && op.delete()} disabled={selected.size === 0} className="p-1 hover:bg-red-500/10 rounded disabled:opacity-30"><Trash2 size={17} className={selected.size > 0 ? 'text-vscode-red' : 'text-vscode-text-muted'} /></button>
        <button onClick={() => { setDName('newfile.txt'); setDialog({ type: 'newFile' }) }} className="p-1 hover:bg-vscode-hover rounded"><FilePlus size={17} className="text-vscode-text-muted" /></button>
        <button onClick={() => { setDName(''); setDialog({ type: 'newFolder' }) }} className="p-1 hover:bg-vscode-hover rounded"><Plus size={17} className="text-vscode-text-muted" /></button>
      </div>

      {/* Error */}
      {error && <div className="px-2 py-1 text-[10px] text-vscode-red bg-red-500/5 border-b border-red-500/10">{error}</div>}

      {/* File list */}
      <div className="flex-1 overflow-y-auto" onContextMenu={e => e.preventDefault()}>
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[11px] text-vscode-text-dim">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-[11px] text-vscode-text-dim">{searchTerm ? 'No matches' : 'Empty'}</div>
        ) : (
          filtered.map(f => (
            <div key={f.name}
              onClick={e => toggleSelect(f.name, e.ctrlKey)}
              onDoubleClick={() => enterDir(f)}
              onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, target: f }) }}
              draggable={!f.isDir}
              onDragStart={e => {
                if (f.isDir) { e.preventDefault(); return }
                // Start download for drag-to-desktop
                const p = '/tmp/omnimind-dl/' + f.name
                SFTPDownload(connId, f.path, p).catch(() => {})
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('text/plain', f.name)
                e.dataTransfer.setData('DownloadURL', 'file:///' + p.replace(/\\/g, '/'))
              }}
              className={`flex items-center gap-2 px-2 h-7 cursor-pointer text-[11px] border-b border-vscode-border/20 transition-colors ${
                selected.has(f.name) ? 'bg-vscode-accent/10 text-vscode-text' : 'text-vscode-text hover:bg-vscode-hover'
              }`}>
              {f.isDir ? <Folder size={13} className="text-vscode-yellow shrink-0" /> : <File size={13} className="text-vscode-text-muted shrink-0" />}
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-[10px] text-vscode-text-dim w-16 text-right shrink-0">{formatSize(f.size)}</span>
            </div>
          ))
        )}
      </div>

      {/* Transfer progress */}
      {transferring.active && (
        <div className="flex items-center h-7 px-2 bg-vscode-accent/10 border-t border-vscode-accent/20 text-[11px] text-vscode-accent shrink-0 gap-2">
          <div className="flex-1 truncate">{transferring.text}</div>
          <div className="w-20 h-1.5 bg-vscode-bg rounded-full overflow-hidden shrink-0">
            <div className="h-full bg-vscode-accent rounded-full transition-all duration-300" style={{ width: `${transferring.pct}%` }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center h-6 px-2 bg-vscode-bg border-t border-vscode-border text-[10px] text-vscode-text-dim shrink-0">
        <span>{files.length} items</span>
        {selected.size > 0 && <span className="ml-2">{selected.size} selected</span>}
        <div className="flex-1" />
        <button onClick={onClose} className="px-1 hover:bg-vscode-hover rounded">Hide</button>
      </div>

      {/* Context menu */}
      {ctx && <div className="fixed z-50 w-40 bg-vscode-input border border-vscode-border shadow-xl py-0.5" style={{ left: ctx.x, top: ctx.y }}>
        <div className="px-3 py-1 text-[10px] text-vscode-text-dim truncate">{ctx.target.name}</div>
        {ctx.target.isDir && <button onClick={() => { load(ctx.target.path); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text">Open</button>}
        <button onClick={() => { enterDir(ctx.target); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-text">{ctx.target.isDir ? 'Enter' : 'Open'}</button>
        <button onClick={() => { setDialog({ type: 'delete' }); setSelected(new Set([ctx.target.name])); setCtx(null) }} className="w-full flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover text-[12px] text-vscode-red"><Trash2 size={12} /> Delete</button>
      </div>}

      {/* Dialogs */}
      {dialog?.type === 'delete' && <FormDialog title="删除" danger confirmLabel="删除" confirmDisabled={false}
        fields={[{ label: '', value: `确定删除 ${selected.size} 个项目？此操作不可恢复。`, set: () => {}, displayOnly: true }]}
        onConfirm={op.delete} onCancel={() => setDialog(null)} />}
      {dialog?.type === 'newFolder' && <FormDialog title="新建文件夹" confirmLabel="创建" confirmDisabled={!dName.trim()}
        fields={[{ label: '名称', value: dName, set: setDName, placeholder: 'newfolder' }]}
        onConfirm={op.newFolder} onCancel={() => setDialog(null)} />}
      {dialog?.type === 'newFile' && <FormDialog title="新建文件" confirmLabel="创建" confirmDisabled={!dName.trim()}
        fields={[{ label: '名称', value: dName, set: setDName, placeholder: 'newfile.txt' }]}
        onConfirm={op.newFile} onCancel={() => setDialog(null)} />}
    </div>
  )
}
