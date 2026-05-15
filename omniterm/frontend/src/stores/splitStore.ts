import { create } from 'zustand'

export type SplitMode = 'horizontal' | 'vertical' | 'grid'

interface SplitStore {
  active: boolean
  mode: SplitMode
  columns: number
  toggle: () => void
  setMode: (mode: SplitMode) => void
  setColumns: (n: number) => void
}

export const useSplitStore = create<SplitStore>((set) => ({
  active: false,
  mode: 'horizontal',
  columns: 2,
  toggle: () => set(s => ({ active: !s.active })),
  setMode: (mode) => set({ mode }),
  setColumns: (columns) => set({ columns: Math.max(1, Math.min(4, columns)) }),
}))
