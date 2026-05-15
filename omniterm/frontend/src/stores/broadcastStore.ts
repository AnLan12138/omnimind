import { create } from 'zustand'

interface BroadcastStore {
  active: boolean
  included: Set<string>  // connIds that receive broadcast
  toggle: (connId: string) => void
  include: (connId: string) => void
  exclude: (connId: string) => void
  start: (connIds: string[]) => void
  stop: () => void
}

export const useBroadcastStore = create<BroadcastStore>((set, get) => ({
  active: false,
  included: new Set<string>(),
  toggle: (connId) => set(s => {
    const next = new Set(s.included)
    next.has(connId) ? next.delete(connId) : next.add(connId)
    return { included: next }
  }),
  include: (connId) => set(s => {
    const next = new Set(s.included); next.add(connId); return { included: next }
  }),
  exclude: (connId) => set(s => {
    const next = new Set(s.included); next.delete(connId); return { included: next }
  }),
  start: (connIds) => set({ active: true, included: new Set(connIds) }),
  stop: () => set({ active: false, included: new Set() }),
}))
