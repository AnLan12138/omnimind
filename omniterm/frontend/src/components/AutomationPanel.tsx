import { useState } from 'react'
import { Zap, Play, Trash2, Pencil } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/*
 * AutomationPanel.tsx — 右侧自动化侧边栏
 * ==========================================
 * 用于管理和执行自动化任务/脚本
 */

interface AutomationTask {
  id: string
  name: string
  command: string
  targetHosts: string[]
}

export default function AutomationPanel() {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<AutomationTask[]>(() => {
    try {
      const saved = localStorage.getItem('omni-automation-tasks')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCmd, setEditCmd] = useState('')

  const saveTasks = (updated: AutomationTask[]) => {
    setTasks(updated)
    localStorage.setItem('omni-automation-tasks', JSON.stringify(updated))
  }

  const updateTask = (id: string) => {
    if (!editName.trim()) return
    saveTasks(tasks.map(t => t.id === id ? { ...t, name: editName.trim(), command: editCmd } : t))
    setEditId(null)
  }

  const deleteTask = (id: string) => {
    saveTasks(tasks.filter(t => t.id !== id))
  }

  const runTask = (task: AutomationTask) => {
    // TODO: wire to backend automation execution
    console.log('Run automation task:', task)
  }

  return (
    <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <Zap size={32} className="text-vscode-text-dim/30" />
            <p className="text-[11px] text-vscode-text-dim">{t('noAutomation', '暂无自动化任务')}</p>
            <p className="text-[10px] text-vscode-text-dim/60">{t('noAutomationHint', '暂无自动化任务')}</p>
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className="border-b border-vscode-border/30">
              {editId === task.id ? (
                <div className="p-2 space-y-2">
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    placeholder={t('name', '名称')}
                    className="w-full h-7 px-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                  <textarea value={editCmd} onChange={e => setEditCmd(e.target.value)}
                    placeholder={t('command', '指令')} rows={3}
                    className="w-full px-2 py-1 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text font-mono resize-none focus:outline-none focus:border-vscode-accent" />
                  <div className="flex gap-1.5">
                    <button onClick={() => updateTask(task.id)}
                      className="px-2 py-0.5 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[10px]">{t('save', '保存')}</button>
                    <button onClick={() => setEditId(null)}
                      className="px-2 py-0.5 bg-vscode-input hover:bg-vscode-hover text-vscode-text rounded text-[10px]">{t('cancel', '取消')}</button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center h-9 px-2 hover:bg-vscode-hover">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Zap size={14} className="text-vscode-accent shrink-0" />
                    <span className="text-[12px] text-vscode-text truncate">{task.name}</span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button onClick={() => runTask(task)}
                      className="p-0.5 hover:bg-vscode-hover rounded" title={t('run', '运行')}>
                      <Play size={12} className="text-vscode-accent" />
                    </button>
                    <button onClick={() => { setEditId(task.id); setEditName(task.name); setEditCmd(task.command) }}
                      className="p-0.5 hover:bg-vscode-hover rounded">
                      <Pencil size={12} className="text-vscode-text-muted" />
                    </button>
                    <button onClick={() => deleteTask(task.id)}
                      className="p-0.5 hover:bg-vscode-hover rounded">
                      <Trash2 size={12} className="text-vscode-text-muted hover:text-vscode-red" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
  )
}
