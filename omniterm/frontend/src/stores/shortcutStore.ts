import { create } from 'zustand'

export interface ShortcutDef {
  id: string
  keys: string        // e.g. "Ctrl+N", "Ctrl+Shift+E", "F11"
  label: string        // display name
  defaultKeys: string  // original default (for reset)
}

type ActionHandler = (e: KeyboardEvent) => boolean // returns true if handled

const actionRegistry: Map<string, ActionHandler> = new Map()

export function registerShortcutAction(id: string, handler: ActionHandler) {
  actionRegistry.set(id, handler)
}

export function getShortcutAction(id: string): ActionHandler | undefined {
  return actionRegistry.get(id)
}

const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: 'newSession',      keys: 'Ctrl+N',        label: '新建会话',   defaultKeys: 'Ctrl+N' },
  { id: 'closeTab',        keys: 'Ctrl+W',        label: '关闭标签',   defaultKeys: 'Ctrl+W' },
  { id: 'nextTab',         keys: 'Ctrl+Tab',      label: '下一个标签', defaultKeys: 'Ctrl+Tab' },
  { id: 'prevTab',         keys: 'Ctrl+Shift+Tab',label: '上一个标签', defaultKeys: 'Ctrl+Shift+Tab' },
  { id: 'toggleSidebar',   keys: 'Ctrl+Shift+E',  label: '切换侧边栏', defaultKeys: 'Ctrl+Shift+E' },
  { id: 'settings',        keys: 'Ctrl+,',        label: '设置',       defaultKeys: 'Ctrl+,' },
  { id: 'splitHorizontal', keys: 'Ctrl+Shift+O',  label: '水平分屏',   defaultKeys: 'Ctrl+Shift+O' },
  { id: 'splitVertical',   keys: "Ctrl+'",        label: '垂直分屏',   defaultKeys: "Ctrl+'" },
  { id: 'multiexec',       keys: 'Ctrl+Shift+M',  label: '多路广播',   defaultKeys: 'Ctrl+Shift+M' },
  { id: 'copy',            keys: 'Ctrl+Shift+C',  label: '复制',       defaultKeys: 'Ctrl+Shift+C' },
  { id: 'paste',           keys: 'Ctrl+Shift+V',  label: '粘贴',       defaultKeys: 'Ctrl+Shift+V' },
  { id: 'selectAll',       keys: '',              label: '全选',       defaultKeys: '' },
  { id: 'clearBuffer',     keys: 'Ctrl+Shift+K',  label: '清除缓冲',   defaultKeys: 'Ctrl+Shift+K' },
  { id: 'saveTerminal',    keys: 'Ctrl+Shift+S',  label: '保存终端内容', defaultKeys: 'Ctrl+Shift+S' },
  { id: 'find',            keys: 'Ctrl+Shift+F',  label: '查找',       defaultKeys: 'Ctrl+Shift+F' },
  { id: 'newTab',          keys: 'Ctrl+T',        label: '新建标签',   defaultKeys: 'Ctrl+T' },
  { id: 'zoomIn',          keys: 'Ctrl+=',        label: '放大',       defaultKeys: 'Ctrl+=' },
  { id: 'zoomOut',         keys: 'Ctrl+-',        label: '缩小',       defaultKeys: 'Ctrl+-' },
  { id: 'resetZoom',       keys: 'Ctrl+0',        label: '重置缩放',   defaultKeys: 'Ctrl+0' },
  { id: 'toggleFullscreen',keys: 'F11',           label: '切换全屏',   defaultKeys: 'F11' },
]

interface ShortcutStore {
  shortcuts: ShortcutDef[]
  load: () => void
  setKeys: (id: string, keys: string) => void
  reset: (id: string) => void
  resetAll: () => void
}

function loadCustom(): Record<string, string> {
  try {
    const raw = localStorage.getItem('omni-shortcuts')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveCustom(custom: Record<string, string>) {
  localStorage.setItem('omni-shortcuts', JSON.stringify(custom))
}

export const useShortcutStore = create<ShortcutStore>((set, get) => ({
  shortcuts: DEFAULT_SHORTCUTS.map(s => ({ ...s, keys: loadCustom()[s.id] || s.keys })),

  load: () => {
    const custom = loadCustom()
    set({
      shortcuts: DEFAULT_SHORTCUTS.map(s => ({ ...s, keys: custom[s.id] || s.defaultKeys })),
    })
  },

  setKeys: (id, keys) => {
    const custom = loadCustom()
    if (keys === DEFAULT_SHORTCUTS.find(s => s.id === id)?.defaultKeys) {
      delete custom[id]
    } else {
      custom[id] = keys
    }
    saveCustom(custom)
    set({ shortcuts: get().shortcuts.map(s => s.id === id ? { ...s, keys } : s) })
  },

  reset: (id) => {
    const custom = loadCustom()
    delete custom[id]
    saveCustom(custom)
    const def = DEFAULT_SHORTCUTS.find(s => s.id === id)
    set({ shortcuts: get().shortcuts.map(s => s.id === id ? { ...s, keys: def?.defaultKeys || s.keys } : s) })
  },

  resetAll: () => {
    localStorage.removeItem('omni-shortcuts')
    set({ shortcuts: DEFAULT_SHORTCUTS.map(s => ({ ...s, keys: s.defaultKeys })) })
  },
}))

// Parse "Ctrl+Shift+N" into { ctrl: true, shift: true, alt: false, meta: false, key: "n" }
export function parseShortcut(keys: string) {
  const parts = keys.toLowerCase().split('+')
  const result: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } = {
    ctrl: false, shift: false, alt: false, meta: false, key: '',
  }
  for (const p of parts) {
    switch (p.trim()) {
      case 'ctrl': case 'control': result.ctrl = true; break
      case 'shift': result.shift = true; break
      case 'alt': result.alt = true; break
      case 'meta': case 'cmd': case 'win': result.meta = true; break
      default: result.key = p.trim(); break
    }
  }
  return result
}

// Match a KeyboardEvent against a shortcut string like "Ctrl+Shift+N"
export function matchShortcut(e: KeyboardEvent, keys: string): boolean {
  const s = parseShortcut(keys)
  if (!s.key) return false

  // Special key matching
  const specialKeys: Record<string, string> = {
    'tab': 'Tab', 'escape': 'Escape', 'esc': 'Escape', 'enter': 'Enter',
    'space': ' ', 'backspace': 'Backspace', 'delete': 'Delete',
    'up': 'ArrowUp', 'down': 'ArrowDown', 'left': 'ArrowLeft', 'right': 'ArrowRight',
    'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4', 'f5': 'F5',
    'f6': 'F6', 'f7': 'F7', 'f8': 'F8', 'f9': 'F9', 'f10': 'F10',
    'f11': 'F11', 'f12': 'F12',
  }

  const expectedKey = (specialKeys[s.key] || s.key).toLowerCase()
  const actualKey = e.key.toLowerCase()

  // All keys: match modifiers + key (case-insensitive)
  if (expectedKey === actualKey) {
    const ctrlMatch = s.ctrl === (e.ctrlKey || e.metaKey)
    const shiftMatch = s.shift === e.shiftKey
    const altMatch = s.alt === e.altKey
    const metaMatch = s.meta === e.metaKey
    return ctrlMatch && shiftMatch && altMatch && metaMatch
  }

  return false
}

// Listen for keyboard events and dispatch to registered actions
export function handleShortcutEvent(e: KeyboardEvent, shortcuts: ShortcutDef[]): boolean {
  for (const s of shortcuts) {
    if (s.keys && matchShortcut(e, s.keys)) {
      const handler = actionRegistry.get(s.id)
      if (handler) {
        const handled = handler(e)
        if (handled) return true
      }
    }
  }
  return false
}
