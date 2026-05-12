import { create } from 'zustand'

interface RecordingState {
  active: boolean
  name: string
  keys: string
  start: (name: string) => void
  feed: (data: string) => void
  stop: () => { name: string; command: string } | null
  getProgress: () => string
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  active: false,
  name: '',
  keys: '',
  start: (name: string) => set({ active: true, name, keys: '' }),
  feed: (data: string) => set(s => ({ keys: s.keys + data })),
  stop: () => {
    const { name, keys } = get()
    if (!keys) return null
    set({ active: false, name: '', keys: '' })
    return { name, command: keys }
  },
  getProgress: () => {
    const { keys } = get()
    return keys.replace(/\r/g,'↵').replace(/\x7f/g,'⌫').replace(/\t/g,'⇥').slice(-60)
  },
}))
