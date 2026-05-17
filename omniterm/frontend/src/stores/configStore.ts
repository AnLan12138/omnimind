import { create } from 'zustand'
import type { Lang } from '../lib/i18n'
import type { HighlightRule } from '../lib/KeywordHighlighter'
import { PRESET_RULES } from '../lib/KeywordHighlighter'

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
  highlightEnabled: boolean
  highlightRules: HighlightRule[]
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
  highlightEnabled: true,
  highlightRules: PRESET_RULES,
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem('omnimind-settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      // Migrate: if stored rules lack the 'category' field (old format), use presets
      if (parsed.highlightRules && Array.isArray(parsed.highlightRules) && parsed.highlightRules.length > 0) {
        const first = parsed.highlightRules[0]
        if (first.category === undefined) {
          // Merge: keep user's enabled/disabled state where possible
          const merged = PRESET_RULES.map(preset => {
            const old = (parsed.highlightRules as HighlightRule[]).find((r: HighlightRule) => r.id === preset.id)
            return old ? { ...preset, enabled: old.enabled } : { ...preset }
          })
          parsed.highlightRules = merged
        }
      }
      if (parsed.highlightEnabled === undefined) parsed.highlightEnabled = true
      return { ...defaults, ...parsed }
    }
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
