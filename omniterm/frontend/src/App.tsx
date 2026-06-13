import { useEffect, useCallback, useState, useRef } from 'react'
/*
 * App.tsx — 主应用组件（OmniMind 入口）
 * ==========================================
 * 布局结构：ActivityBar(左) | Sidebar(中) | Terminal区(右) | StatusBar(底)
 *
 * 核心职责：
 *   1. 连接管理 — doConnect() 创建 Tab + 调用 Go 后端 Connect()
 *   2. 会话数据流 — App 层注册 EventsOn（永不卸载），从全局 xterm Pool 取实例写入
 *      - 数据缓冲：xterm 未就绪时 feedBuffer()，就绪后 flushBuffer()
 *   3. 视图模式 — 所有 Terminal 始终 absolute 定位，零 display:none，零条件渲染
 *      - 普通模式：单 Terminal 全屏，其他 visibility:hidden
 *      - 分屏/广播：手动计算 top/left/width/height 实现网格布局
 *   4. 快捷键 — App 层只处理 App 级快捷键（新建/关闭/切换标签/侧边栏/设置）
 *      - 终端级快捷键（复制/粘贴/清屏等）由 xterm customKeyHandler 处理，防双击
 *   5. 活跃会话面板 — 侧边栏顶部显示已连接设备列表 + 全部关闭按钮
 *   6. 自动关闭分屏/广播 — 连接设备 < 2 时自动关闭并置灰按钮
 */
import { Search, X, Power } from 'lucide-react'
import ActivityBar from './components/ActivityBar'
import TitleBar from './components/TitleBar'
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
import RightSidebar from './components/RightSidebar'
import logoImg from './assets/images/logo-universal.png'
import { useI18n } from './lib/i18n'
import { EventsOn } from '../wailsjs/runtime/runtime'
import { getHighlighter } from './lib/KeywordHighlighter'
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
  const [automationVisible, setAutomationVisible] = useState(false)
  const [autoPanelWidth, setAutoPanelWidth] = useState(260)
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
    const h = (e: KeyboardEvent) => {
      const appActs = ['newSession', 'closeTab', 'nextTab', 'prevTab', 'toggleSidebar', 'settings']
      handleShortcutEvent(e, useShortcutStore.getState().shortcuts.filter(s => appActs.includes(s.id)))
    }
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
  const hlRef = useRef(getHighlighter())
  useEffect(() => { hlRef.current.updateConfig({ enabled: useConfigStore.getState().highlightEnabled, rules: useConfigStore.getState().highlightRules }) }, [useConfigStore(s => s.highlightEnabled), useConfigStore(s => s.highlightRules)])
  useEffect(() => {
    for (const t of useTabStore.getState().tabs) {
      if (listenersRef.current.has(t.connId)) continue
      listenersRef.current.add(t.connId)
      const cid = t.connId
      EventsOn('conn:' + cid + ':data', (d: string | Uint8Array) => {
        const xterm = getPoolXterm(cid)
        const raw = typeof d === 'string' ? d : new TextDecoder().decode(d)
        const processed = hlRef.current.process(raw)
        if (xterm) {
          xterm.write(processed || raw)
          try { xterm.refresh(0, xterm.rows) } catch {}
        } else {
          feedBuffer(cid, processed || raw)
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

  // Auto-close split/broadcast when connected devices drop below 2
  const connectedCount = tabs.filter(t => t.state === 'connected').length
  useEffect(() => {
    if (connectedCount < 2) {
      if (splitActive) toggleSplit()
      if (broadcastActive) useBroadcastStore.getState().stop()
    }
  }, [connectedCount])

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

  // Right sidebar resize
  const resizingRef = useRef(false)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startW = autoPanelWidth
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = startX - ev.clientX
      setAutoPanelWidth(Math.max(180, Math.min(600, startW + delta)))
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [autoPanelWidth])

  return (
    <div className="flex flex-col h-screen bg-vscode-bg">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <ActivityBar
          activeView={activeView} sidebarVisible={activeView === 'sessions'}
          automationVisible={automationVisible}
          broadcastActive={broadcastActive} splitActive={splitActive}
          connectedCount={connectedCount}
          onToggleBroadcast={() => {
            const store = useBroadcastStore.getState()
            if (store.active) { store.stop(); return }
            // Mutex: close split if open
            if (splitActive) toggleSplit()
            if (tabs.filter(t => t.state === 'connected').length < 2) { doToast(t('needMoreDevices')); return }
            store.start(tabs.filter(t => t.state === 'connected').map(t => t.connId))
          }}
          onToggleAutomation={() => setAutomationVisible(v => !v)}
          onViewChange={v => {
            if (v === 'new') { setEditingSession(null); setDialogOpen(true) }
            else if (v === 'sessions') { setActiveView(activeView === 'sessions' ? 'terminal' : 'sessions') }
            else if (v === 'terminal') { setActiveView('terminal') }
            else if (v === 'settings') { setSettingsOpen(true); setActiveView('sessions') }
            else if (v === 'split') {
              // Mutex: close broadcast if open
              if (broadcastActive) useBroadcastStore.getState().stop()
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
            {/* Connected devices tabs — shown when activeView === 'connected' */}
            {activeView === 'connected' && (
              <div className="flex flex-col gap-1.5 px-2 py-2 shrink-0 border-b border-vscode-border">
                {tabs.length > 0 && (
                  <button onClick={handleCloseAll} title="关闭所有连接"
                    className="flex items-center gap-2 h-8 px-3 text-[13px] rounded hover:bg-vscode-red/20 text-vscode-red transition-colors">
                    <Power size={16} />
                    <span>关闭所有连接</span>
                  </button>
                )}
                {tabs.map(tab => (
                  <div key={tab.id}
                    onClick={() => { useTabStore.getState().setActive(tab.id); setTimeout(() => getPoolXterm(tab.connId)?.focus(), 100) }}
                    className={`group flex items-center gap-2 h-8 px-3 cursor-pointer text-[13px] rounded shrink-0 transition-colors
                      ${tab.active ? 'bg-vscode-accent/20 text-white' : 'text-vscode-text-muted hover:bg-vscode-hover'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: tab.state === 'connected' ? '#4ec9b0' : tab.state === 'connecting' ? '#cca700' : '#6a6a6a' }} />
                    <span className="truncate flex-1">{tab.title}</span>
                    <button onClick={e => { e.stopPropagation(); handleDisconnect(tab.connId) }}
                      className="p-1 rounded hover:bg-vscode-red/20 opacity-0 group-hover:opacity-100">
                      <X size={14} className="text-vscode-red" />
                    </button>
                  </div>
                ))}
              </div>
            )}

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
          <TabBar onCloneTab={handleCloneTab} />

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
                        borderRadius: inGrid ? 8 : 0,
                        overflow: 'hidden',
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
                            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 8, marginLeft: 4, fontWeight: 500, minWidth: 32,
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

        {/* Right sidebar */}
        {automationVisible && (
          <div className="shrink-0 flex flex-row" style={{ width: autoPanelWidth }}>
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              className="w-1 shrink-0 cursor-ew-resize hover:bg-vscode-accent/50 border-l border-vscode-border"
            />
            <div className="flex-1 min-w-0">
              <RightSidebar />
            </div>
          </div>
        )}
      </div>
      <StatusBar onTogglePanel={() => setPanelVisible(!panelVisible)} panelVisible={panelVisible}
        onMonitor={() => setActiveView(activeView === 'monitor' ? 'terminal' : 'monitor')} />
      {dialogOpen && <SessionDialog session={editingSession} groupId={defaultGroupId} onClose={() => setDialogOpen(false)} onSaved={loadSessions} onConnect={doConnect} />}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsTab(undefined) }} initialTab={settingsTab} />}
      {toastMsg && (
        <div className="fixed top-12 right-4 z-50 pointer-events-none" style={{ animation: 'toastIn 0.25s ease-out' }}>
          <div className={`w-80 px-4 py-2 rounded-lg text-[13px] text-white shadow-lg ${toastType === 'error' ? 'bg-red-600/90' : toastType === 'success' ? 'bg-green-600/90' : 'bg-vscode-accent/90'}`}>{toastMsg}</div>
        </div>
      )}
    </div>
  )
}
