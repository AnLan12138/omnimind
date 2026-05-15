import { create } from 'zustand'

export interface ExtensionDef {
  id: string
  name: string
  exePath: string
  args: string
  enabled: boolean
}

const defaults: ExtensionDef[] = [
  { id: 'text-editor', name: 'Text Editor', exePath: '', args: '', enabled: true },
]

function load(): ExtensionDef[] {
  try {
    const raw = localStorage.getItem('omnimind-extensions')
    if (raw) {
      const saved: Partial<ExtensionDef>[] = JSON.parse(raw)
      // Merge with defaults so new fields always have values
      return defaults.map(d => {
        const s = saved.find((e: any) => e.id === d.id)
        return s ? { ...d, ...s } : { ...d }
      })
    }
  } catch {}
  return defaults.map(d => ({ ...d }))
}

function save(exts: ExtensionDef[]) {
  localStorage.setItem('omnimind-extensions', JSON.stringify(exts))
}

interface ExtensionStore {
  extensions: ExtensionDef[]
  setPath: (id: string, path: string) => void
  setArgs: (id: string, args: string) => void
  getPath: (id: string) => string
  getArgs: (id: string) => string
}

export const useExtensionStore = create<ExtensionStore>((set, get) => ({
  extensions: load(),
  setPath: (id, path) => {
    set(state => {
      const exts = state.extensions.map(e => e.id === id ? { ...e, exePath: path } : e)
      save(exts)
      return { extensions: exts }
    })
  },
  setArgs: (id, args) => {
    set(state => {
      const exts = state.extensions.map(e => e.id === id ? { ...e, args } : e)
      save(exts)
      return { extensions: exts }
    })
  },
  getPath: (id) => {
    return get().extensions.find(e => e.id === id)?.exePath || ''
  },
  getArgs: (id) => {
    return get().extensions.find(e => e.id === id)?.args || ''
  },
}))
