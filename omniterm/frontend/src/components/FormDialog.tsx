import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  fields: { label: string; value: string; set: (v: string) => void; placeholder?: string; type?: string; multiline?: boolean; displayOnly?: boolean; selectOptions?: { value: string; label: string }[] }[]
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  confirmDisabled?: boolean
  danger?: boolean
}

export default function FormDialog({ title, fields, onConfirm, onCancel, confirmLabel = 'OK', confirmDisabled, danger }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl w-80" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 h-9 border-b border-vscode-border">
          <span className="text-[12px] font-semibold text-vscode-text">{title}</span>
          <button onClick={onCancel} className="p-0.5 hover:bg-vscode-hover rounded"><X size={13} className="text-vscode-text-muted" /></button>
        </div>
        <div className="p-3 space-y-2">
          {fields.map(f => (
            <div key={f.label}>
              {f.label ? <label className="block text-[10px] text-vscode-text-dim mb-0.5">{f.label}</label> : null}
              {f.displayOnly ? (
                <p className="text-[12px] text-vscode-text py-1">{f.value}</p>
              ) : f.selectOptions ? (
                <select value={f.value} onChange={e => f.set(e.target.value)}
                  className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent">
                  {f.selectOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.multiline ? (
                <textarea value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} autoFocus rows={3}
                  className="w-full px-2 py-1 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent resize-none font-mono" />
              ) : (
                <input type={f.type || 'text'} value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                  autoFocus
                  className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent" />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-4 py-2 border-t border-vscode-border">
          <button onClick={onCancel} className="px-3 h-6 text-[11px] text-vscode-text-muted hover:text-vscode-text rounded hover:bg-vscode-hover">Cancel</button>
          <button onClick={onConfirm} disabled={confirmDisabled}
            className={`px-3 h-6 text-[11px] text-white rounded font-medium disabled:opacity-40 transition-colors ${
              danger ? 'bg-vscode-red hover:bg-red-600' : 'bg-vscode-accent hover:bg-vscode-accent-hover'
            }`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
