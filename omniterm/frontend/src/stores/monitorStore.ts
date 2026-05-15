import { create } from 'zustand'

export interface ConnectionStats {
  connId: string
  latency: number[]   // ring buffer (last 60 samples)
  bytesIn: number
  bytesOut: number
  bandwidthIn: number
  bandwidthOut: number
  uptime: number      // seconds
  connectedAt: number // timestamp
}

interface MonitorStore {
  stats: Record<string, ConnectionStats>
  initConn: (connId: string) => void
  removeConn: (connId: string) => void
  addLatencySample: (connId: string, ms: number) => void
  addBytes: (connId: string, bytesIn: number, bytesOut: number) => void
  tickUptime: (connId: string) => void
}

const MAX_SAMPLES = 60

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  stats: {},

  initConn: (connId) =>
    set((s) => ({
      stats: {
        ...s.stats,
        [connId]: {
          connId,
          latency: [],
          bytesIn: 0,
          bytesOut: 0,
          bandwidthIn: 0,
          bandwidthOut: 0,
          uptime: 0,
          connectedAt: Date.now(),
        },
      },
    })),

  removeConn: (connId) =>
    set((s) => {
      const { [connId]: _, ...rest } = s.stats
      return { stats: rest }
    }),

  addLatencySample: (connId, ms) =>
    set((s) => {
      const st = s.stats[connId]
      if (!st) return s
      const latency = [...st.latency, ms].slice(-MAX_SAMPLES)
      return { stats: { ...s.stats, [connId]: { ...st, latency } } }
    }),

  addBytes: (connId, bytesIn, bytesOut) =>
    set((s) => {
      const st = s.stats[connId]
      if (!st) return s
      const elapsed = Math.max((Date.now() - st.connectedAt) / 1000, 1)
      return {
        stats: {
          ...s.stats,
          [connId]: {
            ...st,
            bytesIn: st.bytesIn + bytesIn,
            bytesOut: st.bytesOut + bytesOut,
            bandwidthIn: Math.round(st.bytesIn / elapsed),
            bandwidthOut: Math.round(st.bytesOut / elapsed),
          },
        },
      }
    }),

  tickUptime: (connId) =>
    set((s) => {
      const st = s.stats[connId]
      if (!st) return s
      return {
        stats: {
          ...s.stats,
          [connId]: { ...st, uptime: Math.round((Date.now() - st.connectedAt) / 1000) },
        },
      }
    }),
}))
