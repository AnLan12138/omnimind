import { create } from 'zustand'
import type { Lang } from '../lib/i18n'

export type UIScale = 'compact' | 'normal' | 'comfortable'

const scaleMap: Record<UIScale, string> = { compact: '12px', normal: '14px', comfortable: '16px' }
export const getScaleSize = (s: UIScale) => scaleMap[s]

export interface AppSettings {
  lang: Lang
  uiScale: UIScale
  showShortcuts: boolean
  terminalFontSize: number
  terminalFontFamily: string
  cursorStyle: 'bar' | 'block' | 'underline'
  scrollback: number
  terminalTheme: string
  accentColor: string
}

const defaults: AppSettings = {
  lang: 'zh',
  uiScale: 'normal',
  showShortcuts: true,
  terminalFontSize: 14,
  terminalFontFamily: "'Cascadia Code', 'Consolas', 'JetBrains Mono', monospace",
  cursorStyle: 'bar',
  scrollback: 10000,
  terminalTheme: 'vs-code',
  accentColor: '#007acc',
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem('omnimind-settings')
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch {}
  return { ...defaults }
}

function save(s: AppSettings) {
  localStorage.setItem('omnimind-settings', JSON.stringify(s))
}

interface ConfigStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void
  reset: () => void
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch)
    save({ ...get(), update: get().update, reset: get().reset } as AppSettings)
  },
  reset: () => {
    set({ ...defaults, update: get().update, reset: get().reset })
    save(defaults)
  },
}))
