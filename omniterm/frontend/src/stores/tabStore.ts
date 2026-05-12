import { create } from 'zustand'

export interface Tab {
  id: string
  title: string
  protocol: string
  connId: string
  active: boolean
  state: string // disconnected | connecting | connected | reconnecting | error
}

interface TabStore {
  tabs: Tab[]
  activeTabId: string | null
  addTab: (tab: Tab) => void
  removeTab: (id: string) => void
  setActive: (id: string) => void
  updateTabState: (connId: string, state: string) => void
  updateTabTitle: (connId: string, title: string) => void
  getActiveTab: () => Tab | undefined
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, { ...tab, active: true }].map((t) =>
        t.id === tab.id ? { ...t, active: true } : { ...t, active: false }
      ),
      activeTabId: tab.id,
    })),

  removeTab: (id) =>
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== id)
      const newActive =
        state.activeTabId === id
          ? remaining.length > 0
            ? remaining[remaining.length - 1].id
            : null
          : state.activeTabId
      return {
        tabs: remaining.map((t) => ({ ...t, active: t.id === newActive })),
        activeTabId: newActive,
      }
    }),

  setActive: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({ ...t, active: t.id === id })),
      activeTabId: id,
    })),

  updateTabState: (connId, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.connId === connId ? { ...t, state } : t)),
    })),

  updateTabTitle: (connId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.connId === connId ? { ...t, title } : t)),
    })),

  getActiveTab: () => get().tabs.find((t) => t.active),
}))
