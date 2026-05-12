import { useState, useEffect, useCallback, useRef } from 'react'
import { Folder, File, Upload, Download, Trash2, Plus, ArrowLeft, RefreshCw, ChevronRight, HardDrive, Server } from 'lucide-react'
import { OpenSFTP, ListSFTP, SFTPDownload, SFTPUpload, SFTPMkdir, SFTPRemove, SFTPRename, ListFTP, FTPDownload, FTPUpload, FTPMkdir, FTPRemove } from '../../wailsjs/go/main/App'

interface FileInfo { name: string; path: string; size: number; isDir: boolean; modTime: string; perm?: string }
interface Props { connId: string; protocol?: string; onClose: () => void }

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

export default function FilePanel({ connId, protocol = 'ssh', onClose }: Props) {
  const [remotePath, setRemotePath] = useState('/')
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [transferring, setTransferring] = useState<string[]>([])
  const dropRef = useRef<HTMLDivElement>(null)
  const localInputRef = useRef<HTMLInputElement>(null)

  const isSSH = protocol === 'ssh' || protocol === 'sftp'
  const isFTP = protocol === 'ftp'

  // Open file system on mount
  useEffect(() => {
    if (isSSH) {
      OpenSFTP(connId).then(() => setReady(true)).catch((e) => setError('SFTP failed: ' + e))
    } else if (isFTP) {
      setReady(true) // FTP is already connected
    }
  }, [connId])

  const loadDir = useCallback(async (path: string) => {
    setLoading(true); setError('')
    try {
      let entries: FileInfo[]
      if (isSSH) entries = await ListSFTP(connId, path)
      else if (isFTP) entries = await ListFTP(connId, path)
      else return
      setFiles(entries)
      setRemotePath(path)
      setSelectedFiles(new Set())
    } catch (e: any) { setError(e?.message || 'List failed') }
    finally { setLoading(false) }
  }, [connId, isSSH, isFTP])

  useEffect(() => { if (ready) loadDir(remotePath) }, [ready])

  const goUp = () => {
    const parts = remotePath.replace(/\\/g, '/').split('/').filter(Boolean)
    parts.pop()
    loadDir('/' + parts.join('/'))
  }
  const enterDir = (f: FileInfo) => { if (f.isDir) loadDir(f.path) }
  const toggleSelect = (name: string) => {
    setSelectedFiles((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n })
  }

  // Upload via file picker
  const handleUploadClick = () => localInputRef.current?.click()
  const handleUploadFiles = async (files: FileList) => {
    for (const f of Array.from(files)) {
      const remoteFile = remotePath + '/' + f.name
      setTransferring((t) => [...t, f.name])
      try {
        if (isSSH) await SFTPUpload(connId, (f as any).path || f.name, remoteFile)
        else if (isFTP) await FTPUpload(connId, (f as any).path || f.name, remoteFile)
      } catch (e) { console.error('Upload failed:', e) }
      setTransferring((t) => t.filter((x) => x !== f.name))
    }
    loadDir(remotePath)
  }

  // Drag & drop upload
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) handleUploadFiles(e.dataTransfer.files)
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  // Download selected
  const handleDownload = async () => {
    for (const name of selectedFiles) {
      const f = files.find((x) => x.name === name)
      if (!f || f.isDir) continue
      setTransferring((t) => [...t, name])
      try {
        if (isSSH) await SFTPDownload(connId, f.path, 'downloads/' + f.name)
        else if (isFTP) await FTPDownload(connId, f.path, 'downloads/' + f.name)
      } catch (e) { console.error('Download failed:', e) }
      setTransferring((t) => t.filter((x) => x !== name))
    }
  }

  // Delete
  const handleDelete = async () => {
    if (!confirm(`Delete ${selectedFiles.size} item(s)?`)) return
    for (const name of selectedFiles) {
      const f = files.find((x) => x.name === name)
      if (!f) continue
      try {
        if (isSSH) await SFTPRemove(connId, f.path)
        else if (isFTP) await FTPRemove(connId, f.path)
      } catch (e) { console.error('Delete failed:', e) }
    }
    loadDir(remotePath)
  }

  // New dir
  const handleNewDir = async () => {
    const name = prompt('Directory name:')
    if (!name) return
    try {
      if (isSSH) await SFTPMkdir(connId, remotePath + '/' + name)
      else if (isFTP) await FTPMkdir(connId, remotePath + '/' + name)
      loadDir(remotePath)
    } catch (e) { console.error('Mkdir failed:', e) }
  }

  const renderFileList = (files: FileInfo[], selected: Set<string>) => (
    <div className="flex-1 overflow-y-auto" onDrop={handleDrop} onDragOver={handleDragOver}>
      {loading && files.length === 0 ? (
        <div className="flex items-center justify-center h-16 text-xs text-text-muted">Loading...</div>
      ) : (
        files.map((f) => (
          <div key={f.name}
            onClick={() => toggleSelect(f.name)}
            onDoubleClick={() => enterDir(f)}
            className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-xs transition-colors ${
              selected.has(f.name) ? 'bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {f.isDir ? <Folder size={13} className="text-accent-yellow shrink-0" /> : <File size={13} className="text-text-muted shrink-0" />}
            <span className="flex-1 truncate">{f.name}</span>
            {transferring.includes(f.name) && <span className="text-[9px] text-accent animate-pulse">...</span>}
            <span className="text-[10px] text-text-muted w-16 text-right shrink-0">{formatSize(f.size)}</span>
            <span className="text-[10px] text-text-muted/50 w-16 text-right shrink-0 hidden md:block">{f.modTime?.slice(0, 10) || ''}</span>
          </div>
        ))
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-t border-border">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border">
        <button onClick={goUp} className="p-1 hover:bg-bg-hover rounded" title="Up"><ArrowLeft size={14} className="text-text-muted" /></button>
        <button onClick={() => loadDir(remotePath)} className="p-1 hover:bg-bg-hover rounded" title="Refresh"><RefreshCw size={14} className="text-text-muted" /></button>
        <span className="text-text-muted/30 mx-1">|</span>
        <button onClick={handleUploadClick} className="p-1 hover:bg-bg-hover rounded" title="Upload"><Upload size={14} className="text-text-muted" /></button>
        <button onClick={handleDownload} disabled={selectedFiles.size === 0} className="p-1 hover:bg-bg-hover rounded disabled:opacity-30" title="Download"><Download size={14} className="text-text-muted" /></button>
        <button onClick={handleNewDir} className="p-1 hover:bg-bg-hover rounded" title="New Folder"><Plus size={14} className="text-text-muted" /></button>
        <button onClick={handleDelete} disabled={selectedFiles.size === 0} className="p-1 hover:bg-red-500/10 rounded disabled:opacity-30" title="Delete"><Trash2 size={14} className={selectedFiles.size > 0 ? 'text-red-400' : 'text-text-muted'} /></button>
        <input ref={localInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) handleUploadFiles(e.target.files); e.target.value = '' }} />
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted truncate max-w-[200px]">{remotePath}</span>
      </div>

      {/* Path bar */}
      <div className="flex items-center px-2 py-0.5 bg-bg-tertiary border-b border-border">
        <Server size={12} className="text-accent mr-1" />
        <input type="text" value={remotePath} onChange={(e) => setRemotePath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadDir(remotePath) }}
          className="flex-1 px-2 py-0.5 bg-transparent text-[11px] text-text-primary font-mono focus:outline-none"
        />
      </div>

      {/* Error */}
      {error && <div className="px-3 py-1.5 text-xs text-red-400 bg-red-500/5 border-b border-red-500/10">{error}</div>}

      {/* Files */}
      {renderFileList(files, selectedFiles)}

      {/* Footer */}
      <div className="flex items-center px-2 py-0.5 bg-bg-tertiary border-t border-border text-[10px] text-text-muted">
        <span>{files.length} items</span>
        {selectedFiles.size > 0 && <><span className="mx-1">|</span><span>{selectedFiles.size} selected</span></>}
        <div className="flex-1" />
        <span className="mr-2 text-text-muted/50">Drag files here to upload</span>
        <button onClick={onClose} className="px-2 py-0.5 hover:bg-bg-hover rounded">Hide</button>
      </div>
    </div>
  )
}
