import { create } from 'zustand'

export interface TerminalTheme {
  name: string
  background: string; foreground: string; cursor: string; selectionBackground: string
  black: string; red: string; green: string; yellow: string
  blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

export const THEMES: Record<string, TerminalTheme> = {
  'vs-code': {
    name: 'VS Code Dark+',
    background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#ffffff', selectionBackground: '#264f78',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#ffffff',
  },
  dark: {
    name: 'Dark',
    background: '#161618', foreground: '#f4f4f5', cursor: '#3b82f6', selectionBackground: '#3b82f644',
    black: '#1a1a2e', red: '#f87171', green: '#4ade80', yellow: '#fbbf24',
    blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e5e7eb',
    brightBlack: '#4b5563', brightRed: '#fca5a5', brightGreen: '#86efac',
    brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9', brightWhite: '#f9fafb',
  },
  light: {
    name: 'Light',
    background: '#ffffff', foreground: '#1a1a2e', cursor: '#3b82f6', selectionBackground: '#3b82f622',
    black: '#1a1a2e', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
    blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f8fafc',
    brightBlack: '#64748b', brightRed: '#ef4444', brightGreen: '#22c55e',
    brightYellow: '#eab308', brightBlue: '#3b82f6', brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4', brightWhite: '#f1f5f9',
  },
}

interface ThemeStore {
  current: string
  theme: TerminalTheme
  setTheme: (name: string) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  current: 'vs-code',
  theme: THEMES['vs-code'],
  setTheme: (name: string) => set({ current: name, theme: THEMES[name] || THEMES['vs-code'] }),
}))
