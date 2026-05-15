import { useEffect, useCallback, useState } from 'react'
import { Search } from 'lucide-react'
import ActivityBar from './components/ActivityBar'
import SessionSidebar from './components/SessionSidebar'
import TabBar from './components/TabBar'
import Terminal from './components/Terminal'
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
  const [panelVisible, setPanelVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined)
  const [sidebarSearch, setSidebarSearch] = useState('')

  const uiScale = useConfigStore(s => s.uiScale)

  // Apply UI font scale to document root (everything inherits via rem)
  useEffect(() => {
    document.documentElement.style.fontSize = getScaleSize(uiScale)
  }, [uiScale])

  useEffect(() => { loadSessions() }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'w') { e.preventDefault(); const t = useTabStore.getState().tabs.find(t => t.active); if (t) { window.go.main.App.Disconnect(t.connId).catch(() => {}); useTabStore.getState().removeTab(t.id) } }
      if (ctrl && e.key === 'Tab') { e.preventDefault(); const s = useTabStore.getState(); const i = s.tabs.findIndex(t => t.id === s.activeTabId); const n = e.shiftKey ? (i - 1 + s.tabs.length) % s.tabs.length : (i + 1) % s.tabs.length; if (s.tabs[n]) s.setActive(s.tabs[n].id) }
      if (ctrl && e.key === 'n') { e.preventDefault(); setEditingSession(null); setDialogOpen(true) }
      if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); setActiveView(a => a === 'sessions' ? 'terminal' : 'sessions') }
      if (ctrl && e.key === ',') { e.preventDefault(); setSettingsOpen(true) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const loadSessions = async () => {
    try { setSessions((await ListSessions()) || []); setFolders((await ListFolders()) || []) } catch {}
  }

  const doConnect = useCallback(async (sess: any) => {
    const connId = genId()
    const title = `${sess.username ? sess.username + '@' : ''}${sess.host}:${sess.port}`
    addTab({ id: genId(), title, protocol: sess.protocol || 'ssh', connId, active: true, state: 'connecting' })
    try { await Connect(connId, sess) } catch (err: any) {
      console.error('Connect failed:', err)
      alert('Connection failed: ' + (err?.message || err || 'Unknown error'))
      useTabStore.getState().updateTabState(connId, 'error')
    }
  }, [addTab])

  const handleDoubleClick = useCallback(async (sess: Session) => {
    doConnect(sess)
  }, [doConnect])

  const handleNewSessionWithGroup = useCallback((groupId: string) => {
    setDefaultGroupId(groupId)
    setEditingSession(null)
    setDialogOpen(true)
  }, [])

  const handleOpenEditor = useCallback(() => {
    const store = useExtensionStore.getState()
    const path = store.getPath('text-editor')
    if (path) {
      const args = store.getArgs('text-editor')
      LaunchProgram(path, args).catch(() => alert('Failed to launch editor'))
    } else {
      setSettingsTab('extensions')
      setSettingsOpen(true)
    }
  }, [])

  const handleDisconnect = useCallback(async (connId: string) => {
    try { await window.go.main.App.Disconnect(connId) } catch {}
    const t = tabs.find(t => t.connId === connId)
    if (t) removeTab(t.id)
  }, [tabs, removeTab])

  return (
    <div className="flex flex-col h-screen bg-vscode-bg">
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          activeView={activeView}
          sidebarVisible={activeView === 'sessions'}
          broadcastActive={broadcastActive}
          onToggleBroadcast={() => {
            const store = useBroadcastStore.getState()
            if (store.active) store.stop()
            else store.start(tabs.filter(t => t.state === 'connected').map(t => t.connId))
          }}
          onViewChange={v => {
            if (v === 'new') { setEditingSession(null); setDialogOpen(true) }
            else if (v === 'sessions') { setActiveView(activeView === 'sessions' ? 'terminal' : 'sessions') }
            else if (v === 'terminal') { setActiveView('terminal') }
            else if (v === 'settings') { setSettingsOpen(true); setActiveView('sessions') }
            else { setActiveView(activeView === v ? 'terminal' : v) }
          }}
          onOpenEditor={handleOpenEditor} />

        {/* Side panel area — changes based on active view */}
        {activeView !== 'terminal' && (
          <div className="w-60 shrink-0 border-r border-vscode-border bg-vscode-sidebar flex flex-col h-full">
            <div className="px-1.5 pt-1.5 pb-1 shrink-0 relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-vscode-text-dim pointer-events-none" />
              <input type="text" placeholder="搜索..." value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
                className="w-full h-7 pl-7 pr-2 bg-vscode-input border border-vscode-border rounded text-[11px] text-vscode-text placeholder-vscode-text-dim focus:outline-none focus:border-vscode-accent" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeView === 'sessions' && (
                <SessionSidebar searchTerm={sidebarSearch}
                  onDoubleClick={handleDoubleClick}
                  onEditSession={s => { setEditingSession(s); setDialogOpen(true) }}
                  onNewSession={() => { setEditingSession(null); setDialogOpen(true) }}
                  onNewSessionWithGroup={handleNewSessionWithGroup}
                />
              )}
              {activeView === 'macro' && (
                <MacroPanel searchTerm={sidebarSearch} onClose={() => setActiveView('terminal')} onSendMacro={d => {
                  const bc = useBroadcastStore.getState()
                  if (bc.active && bc.included.size > 0) {
                    bc.included.forEach(cid => { window.go.main.App.Send(cid, d) })
                  } else {
                    const t = tabs.find(x => x.active)
                    if (t) window.go.main.App.Send(t.connId, d)
                  }
                }} />
              )}
              {activeView === 'sftp' && (tabs.find(t => t.active) ? (
                <FilePanel connId={tabs.find(t => t.active)!.connId} searchTerm={sidebarSearch} onClose={() => setActiveView('terminal')} />
              ) : (
                <div className="flex items-center justify-center h-full text-[11px] text-vscode-text-dim p-3 text-center">没有活动连接</div>
              ))}
              {activeView === 'split' && (
                <div className="p-3 text-[11px] text-vscode-text-dim">连接多台设备后使用分屏视图</div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          <TabBar />

          <div className="flex-1 min-h-0">
            {tabs.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                  <div className="text-5xl opacity-30">🖥</div>
                  <h2 className="text-base text-vscode-text-light">OmniTerm</h2>
                  <p className="text-xs text-vscode-text-dim max-w-xs">Multi-protocol remote client — SSH, Telnet, RDP, VNC, FTP, Serial</p>
                  <div className="flex gap-5 justify-center mt-3">
                    {[{ k: 'Ctrl+N', l: 'New Session' }, { k: 'Ctrl+Shift+E', l: 'Toggle Sidebar' }, { k: 'Ctrl+,', l: 'Settings' }].map(s => (
                      <div key={s.k} className="flex items-center gap-1.5 text-[11px] text-vscode-text-dim">
                        <kbd className="px-1.5 py-0.5 bg-vscode-input border border-vscode-border rounded text-[10px]">{s.k}</kbd>
                        <span>{s.l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : broadcastActive ? (
              /* MultiExec grid: 2 columns, all CONNECTED tabs */
              <div className="h-full overflow-auto p-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(tabs.filter(t => t.state === 'connected').length, 2)}, 1fr)`, gridAutoRows: `1fr` }}>
                {tabs.filter(t => t.state === 'connected').map(tab => (
                  <div key={tab.id} className="border-2 border-vscode-accent/50 rounded overflow-hidden bg-vscode-bg min-h-0">
                    <div className="flex items-center justify-between h-6 px-2 bg-vscode-accent/20 text-[10px]">
                      <span className="truncate text-vscode-text">{tab.protocol.toUpperCase()} · {tab.title}</span>
                      <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => useBroadcastStore.getState().toggle(tab.connId)}
                        className="text-[9px] px-1.5 py-0.5 rounded shrink-0 ml-1 font-medium min-w-[32px]"
                        style={{
                          background: broadcastIncluded.has(tab.connId) ? '#22c55e22' : '#6b728022',
                          color: broadcastIncluded.has(tab.connId) ? '#4ec9b0' : '#6a6a6a',
                          border: '1px solid ' + (broadcastIncluded.has(tab.connId) ? '#22c55e44' : '#6b728044'),
                        }}>
                        {broadcastIncluded.has(tab.connId) ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="h-[calc(100%-24px)]">
                      {tab.protocol === 'vnc' ? <VNCViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                       : tab.protocol === 'rdp' ? <RDPViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                       : <Terminal connId={tab.connId} onDisconnect={handleDisconnect} />}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeView === 'split' ? (
              /* Split grid: 2 columns, all tabs */
              <div className="h-full overflow-auto p-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(tabs.length, 2)}, 1fr)`, gridAutoRows: `1fr` }}>
                {tabs.map(tab => (
                  <div key={tab.id} className="border border-vscode-border rounded overflow-hidden bg-vscode-bg min-h-0">
                    <div className="flex items-center h-6 px-2 bg-vscode-tab-inactive border-b border-vscode-border text-[10px] text-vscode-text-dim">
                      <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: tab.state === 'connected' ? '#4ec9b0' : tab.state === 'connecting' ? '#cca700' : '#6a6a6a' }} />
                      {tab.title}
                    </div>
                    <div className="h-[calc(100%-24px)]">
                      {tab.protocol === 'vnc' ? <VNCViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                       : tab.protocol === 'rdp' ? <RDPViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                       : <Terminal connId={tab.connId} onDisconnect={handleDisconnect} />}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              tabs.map(tab => (
                <div key={tab.id} className="h-full" style={{ display: tab.active ? 'block' : 'none' }}>
                  {tab.protocol === 'vnc' ? <VNCViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                   : tab.protocol === 'rdp' ? <RDPViewer connId={tab.connId} onDisconnect={handleDisconnect} />
                   : <Terminal connId={tab.connId} onDisconnect={handleDisconnect} />}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <StatusBar onTogglePanel={() => setPanelVisible(!panelVisible)} panelVisible={panelVisible} />

      {dialogOpen && <SessionDialog session={editingSession} groupId={defaultGroupId} onClose={() => setDialogOpen(false)} onSaved={loadSessions} onConnect={doConnect} />}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsTab(undefined) }} initialTab={settingsTab} />}
    </div>
  )
}
