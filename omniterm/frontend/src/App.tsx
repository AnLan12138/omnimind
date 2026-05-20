import { useEffect, useCallback, useState, useRef } from 'react'
import { Search } from 'lucide-react'
import ActivityBar from './components/ActivityBar'
import SessionSidebar from './components/SessionSidebar'
import TabBar from './components/TabBar'
import Terminal, { disposeTerminal, getPoolXterm, feedBuffer } from './components/Terminal'
import VNCViewer from './components/VNCViewer'
import RDPViewer from './components/RDPViewer'
import StatusBar from './components/StatusBar'
import SessionDialog from './components/SessionDialog'
import { useBroadcastStore } from './stores/broadcastStore'
import SettingsDialog from './components/SettingsDialog'
import { useTabStore } from './stores/tabStore'
import { useSessionStore, type Session } from './stores/sessionStore'
import { ListSessions, ListFolders, Connect, LaunchProgram } from '../wailsjs/go/main/App'
import { useConfigStore, getScaleSize } from './stores/configStore'
import { useExtensionStore } from './stores/extensionStore'
import MacroPanel from './components/MacroPanel'
import FilePanel from './components/FilePanel'
import TunnelPanel from './components/TunnelPanel'
import MonitorPanel from './components/MonitorPanel'
import logoImg from './assets/images/logo-universal.png'
import { useI18n } from './lib/i18n'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { registerShortcutAction, handleShortcutEvent, useShortcutStore } from './stores/shortcutStore'
import { useSplitStore } from './stores/splitStore'

function genId() { return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10) }

export default function App() {
  const { tabs, addTab, removeTab } = useTabStore()
  const { setSessions, setFolders } = useSessionStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [defaultGroupId, setDefaultGroupId] = useState('default')
  const [activeView, setActiveView] = useState('sessions')
  const broadcastActive = useBroadcastStore(s => s.active)
  const broadcastIncluded = useBroadcastStore(s => s.included)
  const splitActive = useSplitStore(s => s.active)
  const toggleSplit = useSplitStore(s => s.toggle)
  const [panelVisible, setPanelVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [toastMsg, setToastMsg] = useState('')
  const [toastType, setToastType] = useState<'error' | 'success' | 'info'>('info')

  const uiScale = useConfigStore(s => s.uiScale)
  const { t } = useI18n()

  const doToast = (msg: string, type: 'error' | 'success' | 'info' = 'info') => {
    setToastType(type)
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 5000)
  }

  useEffect(() => { document.documentElement.style.fontSize = getScaleSize(uiScale) }, [uiScale])
  useEffect(() => { loadSessions() }, [])

  useEffect(() => {
    registerShortcutAction('newSession', e => { e.preventDefault(); setEditingSession(null); setDialogOpen(true); return true })
    registerShortcutAction('closeTab', e => {
      e.preventDefault()
      const t = useTabStore.getState().tabs.find(t => t.active)
      if (t) { window.go.main.App.Disconnect(t.connId).catch(() => {}); useTabStore.getState().removeTab(t.id) }
      return true
    })
    registerShortcutAction('nextTab', e => { e.preventDefault(); const s = useTabStore.getState(); const i = s.tabs.findIndex(t => t.id === s.activeTabId); const n = (i + 1) % s.tabs.length; if (s.tabs[n]) s.setActive(s.tabs[n].id); return true })
    registerShortcutAction('prevTab', e => { e.preventDefault(); const s = useTabStore.getState(); const i = s.tabs.findIndex(t => t.id === s.activeTabId); const n = (i - 1 + s.tabs.length) % s.tabs.length; if (s.tabs[n]) s.setActive(s.tabs[n].id); return true })
    registerShortcutAction('toggleSidebar', e => { e.preventDefault(); setActiveView(a => a === 'sessions' ? 'terminal' : 'sessions'); return true })
    registerShortcutAction('settings', e => { e.preventDefault(); setSettingsOpen(true); return true })
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { handleShortcutEvent(e, useShortcutStore.getState().shortcuts) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const activeTab = useTabStore.getState().tabs.find(t => t.active && t.state === 'error')
      if (activeTab) { window.go.main.App.Disconnect(activeTab.connId).catch(() => {}); useTabStore.getState().removeTab(activeTab.id) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Session data events at App level (never unmounts) ──
  const listenersRef = useRef(new Set<string>())
  useEffect(() => {
    for (const t of useTabStore.getState().tabs) {
      if (listenersRef.current.has(t.connId)) continue
      listenersRef.current.add(t.connId)
      const cid = t.connId
      EventsOn('conn:' + cid + ':data', (d: string | Uint8Array) => {
        const xterm = getPoolXterm(cid)
        const raw = typeof d === 'string' ? d : new TextDecoder().decode(d)
        if (xterm) {
          xterm.write(raw)
          try { xterm.refresh(0, xterm.rows) } catch {}
        } else {
          feedBuffer(cid, raw)
        }
      })
      EventsOn('conn:' + cid + ':state', (s: string) => { useTabStore.getState().updateTabState(cid, s) })
    }
  }, [tabs])

  const loadSessions = async () => { try { setSessions((await ListSessions()) || []); setFolders((await ListFolders()) || []) } catch {} }

  const doConnect = useCallback(async (sess: any) => {
    const connId = genId()
    const title = `${sess.username ? sess.username + '@' : ''}${sess.host}:${sess.port}`
    addTab({ id: genId(), title, protocol: sess.protocol || 'ssh', connId, active: true, state: 'connecting', sessionSnapshot: sess })
    try { await Connect(connId, sess) } catch (err: any) {
      doToast('连接失败: ' + (err?.message || err || '未知错误'), 'error')
      useTabStore.getState().updateTabState(connId, 'error')
    }
  }, [addTab])

  const handleCloneTab = useCallback((tab: any) => { if (tab.sessionSnapshot) doConnect(tab.sessionSnapshot) }, [doConnect])
  const handleDoubleClick = useCallback(async (sess: Session) => { doConnect(sess) }, [doConnect])
  const handleNewSessionWithGroup = useCallback((groupId: string) => { setDefaultGroupId(groupId); setEditingSession(null); setDialogOpen(true) }, [])
  const handleOpenEditor = useCallback(() => {
    const store = useExtensionStore.getState()
    const path = store.getPath('text-editor')
    if (path) { LaunchProgram(path, store.getArgs('text-editor')).catch(() => doToast('启动编辑器失败', 'error')) }
    else { setSettingsTab('extensions'); setSettingsOpen(true) }
  }, [])

  const handleCloseAll = useCallback(async () => {
    for (const t of useTabStore.getState().tabs) {
      try { await window.go.main.App.Disconnect(t.connId) } catch {}
      disposeTerminal(t.connId)
      removeTab(t.id)
    }
  }, [removeTab])

  const handleDisconnect = useCallback(async (connId: string) => {
    try { await window.go.main.App.Disconnect(connId) } catch {}
    disposeTerminal(connId)
    const t = tabs.find(t => t.connId === connId)
    if (t) removeTab(t.id)
  }, [tabs, removeTab])

  const renderViewer = (tab: any) => {
    if (tab.protocol === 'vnc') return <VNCViewer connId={tab.connId} onDisconnect={handleDisconnect} />
    if (tab.protocol === 'rdp') return <RDPViewer connId={tab.connId} onDisconnect={handleDisconnect} />
    return <Terminal connId={tab.connId} onDisconnect={handleDisconnect} />
  }

  return (
    <div className="flex flex-col h-screen bg-vscode-bg">
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          activeView={activeView} sidebarVisible={activeView === 'sessions'}
          broadcastActive={broadcastActive} splitActive={splitActive}
          onToggleBroadcast={() => {
            const store = useBroadcastStore.getState()
            if (store.active) { store.stop(); return }
            if (tabs.filter(t => t.state === 'connected').length < 2) { doToast(t('needMoreDevices')); return }
            store.start(tabs.filter(t => t.state === 'connected').map(t => t.connId))
          }}
          onViewChange={v => {
            if (v === 'new') { setEditingSession(null); setDialogOpen(true) }
            else if (v === 'sessions') { setActiveView(activeView === 'sessions' ? 'terminal' : 'sessions') }
            else if (v === 'terminal') { setActiveView('terminal') }
            else if (v === 'settings') { setSettingsOpen(true); setActiveView('sessions') }
            else if (v === 'split') {
              if (!splitActive && tabs.filter(t => t.state === 'connected').length < 2) { doToast(t('needMoreDevices')) }
              else { toggleSplit() }
            } else { setActiveView(activeView === v ? 'terminal' : v) }
          }}
          onOpenEditor={handleOpenEditor} />

        {activeView !== 'terminal' && (
          <div className="w-60 shrink-0 border-r border-vscode-border bg-vscode-sidebar flex flex-col h-full">
            <div className="px-1.5 pt-1.5 pb-1 shrink-0 relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-vscode-text-dim pointer-events-none" />
              <input type="text" placeholder="搜索..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
                className="w-full h-7 pl-7 pr-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeView === 'sessions' && (
                <SessionSidebar searchTerm={sidebarSearch} onDoubleClick={handleDoubleClick}
                  onEditSession={s => { setEditingSession(s); setDialogOpen(true) }}
                  onNewSession={() => { setEditingSession(null); setDialogOpen(true) }}
                  onNewSessionWithGroup={handleNewSessionWithGroup} />
              )}
              {activeView === 'macro' && (
                <MacroPanel searchTerm={sidebarSearch} onClose={() => setActiveView('terminal')} onSendMacro={d => {
                  const bc = useBroadcastStore.getState()
                  if (bc.active && bc.included.size > 0) { bc.included.forEach(cid => { window.go.main.App.Send(cid, d) }) }
                  else { const t = tabs.find(x => x.active); if (t) window.go.main.App.Send(t.connId, d) }
                }} />
              )}
              {activeView === 'sftp' && (tabs.find(t => t.active) ? (
                <FilePanel connId={tabs.find(t => t.active)!.connId} searchTerm={sidebarSearch} onClose={() => setActiveView('terminal')} />
              ) : (<div className="flex items-center justify-center h-full text-[11px] text-vscode-text-dim p-3 text-center">没有活动连接</div>))}
              {activeView === 'tunnel' && (<TunnelPanel searchTerm={sidebarSearch} onClose={() => setActiveView('terminal')} />)}
              {activeView === 'monitor' && (<MonitorPanel onClose={() => setActiveView('terminal')} />)}
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          <TabBar onCloneTab={handleCloneTab} onCloseAll={handleCloseAll} />

          <div className="flex-1 min-h-0">
            {tabs.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                  <img src={logoImg} alt="OmniMind" className="w-24 h-24 mx-auto opacity-90" />
                  <h2 className="text-xl font-semibold text-white">OmniMind</h2>
                  <p className="text-xs text-vscode-text-dim max-w-xs">Multi-protocol remote client — SSH, Telnet, RDP, VNC, FTP, Serial</p>
                  <div className="flex gap-5 justify-center mt-3">
                    {[{ k: 'Ctrl+N', l: 'New Session' }, { k: 'Ctrl+Shift+E', l: 'Toggle Sidebar' }, { k: 'Ctrl+,', l: 'Settings' }].map(s => (
                      <div key={s.k} className="flex items-center gap-1.5 text-[11px] text-vscode-text-dim"><kbd className="px-1.5 py-0.5 bg-vscode-input border border-vscode-border rounded text-[10px]">{s.k}</kbd><span>{s.l}</span></div>))}
                  </div>
                </div>
              </div>
            ) : (
              /* ALL terminals always absolute-positioned — NEVER display:none, NEVER CSS grid */
              <div className="h-full relative">
                {tabs.map((tab, idx) => {
                  const inGrid = broadcastActive || splitActive
                  const visibleTabs = inGrid
                    ? tabs.filter(t => broadcastActive ? t.state === 'connected' : true)
                    : [tab]
                  const visIdx = visibleTabs.findIndex(t => t.id === tab.id)
                  const show = inGrid ? visIdx >= 0 : tab.active
                  const cols = inGrid ? Math.min(visibleTabs.length, 2) : 1
                  const rows = inGrid ? Math.ceil(visibleTabs.length / cols) : 1
                  const col = visIdx >= 0 ? visIdx % cols : 0
                  const row = visIdx >= 0 ? Math.floor(visIdx / cols) : 0
                  return (
                    <div key={tab.id}
                      style={{
                        position: 'absolute',
                        visibility: show ? 'visible' : 'hidden',
                        top: inGrid ? `${(row / rows) * 100}%` : 0,
                        left: inGrid ? `${(col / cols) * 100}%` : 0,
                        width: inGrid ? `${100 / cols}%` : '100%',
                        height: inGrid ? `${100 / rows}%` : '100%',
                        display: 'flex', flexDirection: 'column',
                        border: inGrid ? (broadcastActive ? '2px solid rgba(86,156,214,0.5)' : '1px solid #3c3c3c') : undefined,
                        borderRadius: inGrid ? 4 : 0,
                        overflow: 'hidden',
                        background: inGrid ? '#1e1e1e' : undefined,
                        boxSizing: 'border-box',
                      }}>
                      {/* Always present — height 0 when hidden */}
                      <div style={{
                        height: inGrid ? 24 : 0, flexShrink: 0, overflow: 'hidden',
                        display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 10,
                        background: broadcastActive ? 'rgba(86,156,214,0.2)' : '#2d2d2d',
                        borderBottom: broadcastActive ? undefined : '1px solid #3c3c3c',
                      }}>
                        {broadcastActive ? (<>
                          <span className="truncate flex-1" style={{ color: '#ccc' }}>{tab.protocol.toUpperCase()} · {tab.title}</span>
                          <button onMouseDown={e => e.preventDefault()} onClick={() => useBroadcastStore.getState().toggle(tab.connId)}
                            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, marginLeft: 4, fontWeight: 500, minWidth: 32,
                              background: broadcastIncluded.has(tab.connId) ? 'rgba(34,197,94,0.13)' : 'rgba(107,114,128,0.13)',
                              color: broadcastIncluded.has(tab.connId) ? '#4ec9b0' : '#6a6a6a',
                              border: '1px solid ' + (broadcastIncluded.has(tab.connId) ? 'rgba(34,197,94,0.27)' : 'rgba(107,114,128,0.27)') }}>
                            {broadcastIncluded.has(tab.connId) ? 'ON' : 'OFF'}
                          </button>
                        </>) : inGrid ? (<>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', marginRight: 6, flexShrink: 0,
                            background: tab.state === 'connected' ? '#4ec9b0' : tab.state === 'connecting' ? '#cca700' : '#6a6a6a' }} />
                          <span className="truncate">{tab.title}</span>
                        </>) : null}
                      </div>
                      <div style={{ flex: 1, minHeight: 0 }}>{renderViewer(tab)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <StatusBar onTogglePanel={() => setPanelVisible(!panelVisible)} panelVisible={panelVisible} />
      {dialogOpen && <SessionDialog session={editingSession} groupId={defaultGroupId} onClose={() => setDialogOpen(false)} onSaved={loadSessions} onConnect={doConnect} />}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsTab(undefined) }} initialTab={settingsTab} />}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 pointer-events-none" style={{ animation: 'toastIn 0.25s ease-out' }}>
          <div className={`w-80 px-4 py-2 rounded-lg text-[13px] text-white shadow-lg ${toastType === 'error' ? 'bg-red-600/90' : toastType === 'success' ? 'bg-green-600/90' : 'bg-vscode-accent/90'}`}>{toastMsg}</div>
        </div>
      )}
    </div>
  )
}
