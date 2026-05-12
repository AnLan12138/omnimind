import { create } from 'zustand'
import { session } from '../../wailsjs/go/models'

export type Session = session.Session
export type Folder = session.Folder

interface SessionStore {
  sessions: Session[]
  folders: Folder[]
  loading: boolean
  setSessions: (sessions: Session[]) => void
  setFolders: (folders: Folder[]) => void
  setLoading: (loading: boolean) => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  folders: [],
  loading: false,
  setSessions: (sessions) => set({ sessions }),
  setFolders: (folders) => set({ folders }),
  setLoading: (loading) => set({ loading }),
}))
