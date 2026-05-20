import React, { createContext, useContext, useCallback } from 'react'
import { useConfigStore } from '../stores/configStore'

export type Lang = 'en' | 'zh'

type TranslationMap = Record<string, Record<Lang, string>>

export const t: TranslationMap = {
  newSession: { en: 'New Session', zh: '新建会话' },
  sessions: { en: 'Devices', zh: '设备管理' },
  activeSessions: { en: 'Active Sessions', zh: '活跃会话' },
  terminal: { en: 'Terminal', zh: '终端' },
  split: { en: 'Split View', zh: '分屏视图' },
  macros: { en: 'Macros', zh: '快捷指令' },
  fileBrowser: { en: 'File Browser', zh: '文件管理' },
  monitor: { en: 'Monitor', zh: '连接监控' },
  settings: { en: 'Settings', zh: '设置' },
  search: { en: 'Search', zh: '搜索' },
  searchSessions: { en: 'Search sessions...', zh: '搜索会话...' },
  searchMacros: { en: 'Search macros...', zh: '搜索指令...' },
  searchFiles: { en: 'Search files...', zh: '搜索文件...' },
  noSessions: { en: 'No sessions', zh: '暂无会话' },
  createOne: { en: 'Create one', zh: '创建一个' },
  newMacro: { en: 'New Macro', zh: '新建指令' },
  editMacro: { en: 'Edit Macro', zh: '编辑指令' },
  recordMacro: { en: 'Record Macro', zh: '录制指令' },
  name: { en: 'Name', zh: '名称' },
  command: { en: 'Command', zh: '指令' },
  save: { en: 'Save', zh: '保存' },
  cancel: { en: 'Cancel', zh: '取消' },
  startRecording: { en: 'Start Recording', zh: '开始录制' },
  stop: { en: 'Stop', zh: '停止' },
  record: { en: 'Record', zh: '录制' },
  run: { en: 'Run', zh: '运行' },
  edit: { en: 'Edit', zh: '编辑' },
  delete: { en: 'Delete', zh: '删除' },
  copy: { en: 'Copy', zh: '复制' },
  paste: { en: 'Paste', zh: '粘贴' },
  clearBuffer: { en: 'Clear Screen', zh: '清屏' },
  selectAll: { en: 'Select All', zh: '全选' },
  connect: { en: 'Connect', zh: '连接' },
  host: { en: 'Host', zh: '主机' },
  port: { en: 'Port', zh: '端口' },
  username: { en: 'Username', zh: '用户名' },
  password: { en: 'Password', zh: '密码' },
  protocol: { en: 'Protocol', zh: '协议' },
  group: { en: 'Group', zh: '分组' },
  newGroup: { en: 'New Group', zh: '新建分组' },
  deleteGroup: { en: 'Delete Group', zh: '删除分组' },
  import: { en: 'Import', zh: '导入' },
  export: { en: 'Export', zh: '导出' },
  default: { en: 'Default', zh: '默认' },
  unassigned: { en: 'unassigned', zh: '未分组' },
  noMacros: { en: 'No macros. Click "New" or "Record".', zh: '暂无指令，点击"新建"或"录制"。' },
  noMacrosMatch: { en: 'No macros match search.', zh: '没有匹配的指令。' },
  noActiveSession: { en: 'No active session.', zh: '没有活动连接。' },
  connectSSH: { en: 'Connect via SSH to browse files.', zh: '通过 SSH 连接后浏览文件。' },
  noSessionMonitor: { en: 'No active session to monitor.', zh: '没有活动连接可监控。' },
  splitHint: { en: 'Connect multiple sessions then use Split View.', zh: '连接多台设备后使用分屏视图。' },
  status: { en: 'Status', zh: '状态' },
  connected: { en: 'Connected', zh: '已连接' },
  connecting: { en: 'Connecting', zh: '连接中' },
  reconnecting: { en: 'Reconnecting', zh: '重连中' },
  disconnected: { en: 'Disconnected', zh: '未连接' },
  uptime: { en: 'Uptime', zh: '在线时长' },
  received: { en: 'Received', zh: '接收' },
  sent: { en: 'Sent', zh: '发送' },
  latency: { en: 'Latency', zh: '延迟' },
  reconnects: { en: 'Reconnects', zh: '重连次数' },
  panel: { en: 'Panel', zh: '面板' },
  appearance: { en: 'Appearance', zh: '外观' },
  terminalTab: { en: 'Terminal', zh: '终端' },
  shortcuts: { en: 'Shortcuts', zh: '快捷键' },
  security: { en: 'Security', zh: '安全' },
  about: { en: 'About', zh: '关于' },
  uiScale: { en: 'UI Scale', zh: '界面缩放' },
  accentColor: { en: 'Accent Color', zh: '强调色' },
  terminalTheme: { en: 'Terminal Color Theme', zh: '终端配色' },
  language: { en: 'Language', zh: '语言' },
  font: { en: 'Font', zh: '字体' },
  fontSize: { en: 'Font Size', zh: '字号' },
  fontFamily: { en: 'Font Family', zh: '字体' },
  cursor: { en: 'Cursor', zh: '光标' },
  cursorStyle: { en: 'Cursor Style', zh: '光标样式' },
  scrollback: { en: 'Scrollback', zh: '回滚行数' },
  bar: { en: 'Bar', zh: '竖线' },
  block: { en: 'Block', zh: '方块' },
  underline: { en: 'Underline', zh: '下划线' },
  sshOptions: { en: 'SSH Options', zh: 'SSH 选项' },
  privateKey: { en: 'Private Key Path', zh: '私钥路径' },
  proxyJump: { en: 'ProxyJump', zh: '跳板机' },
  useAgent: { en: 'Use SSH Agent', zh: '使用 SSH Agent' },
  keepAlive: { en: 'KeepAlive (s)', zh: '心跳间隔 (秒)' },
  folder: { en: 'Folder', zh: '文件夹' },
  notes: { en: 'Notes', zh: '备注' },
  sessionName: { en: 'Session Name', zh: '会话名称' },
  deleteSession: { en: 'Delete Session', zh: '删除会话' },
  saveConnect: { en: 'Save & Connect', zh: '保存并连接' },
  apply: { en: 'Apply', zh: '应用' },
  saved: { en: 'Saved!', zh: '已保存！' },
  new: { en: 'New', zh: '新建' },
  close: { en: 'Close', zh: '关闭' },
  clone: { en: 'Clone Tab', zh: '克隆标签' },
  noActiveConnection: { en: 'No active connection', zh: '无活动连接' },
  version: { en: 'v0.1.0 • Multi-protocol Remote Client', zh: 'v0.1.0 • 多协议远程客户端' },
  builtWith: { en: 'Built with Wails v2 + Go + React + xterm.js', zh: '基于 Wails v2 + Go + React + xterm.js' },
  extensions: { en: 'Extensions', zh: '拓展模块' },
  extensionsDesc: { en: 'Configure external tool integrations. More tools can be added in future updates.', zh: '配置外部工具集成。后续可添加更多工具。' },
  selectEditorPath: { en: 'Select editor executable path...', zh: '选择编辑器可执行文件路径...' },
  browse: { en: 'Browse', zh: '浏览' },
  launchArgs: { en: 'Launch Arguments', zh: '启动参数' },
  argNoSession: { en: 'Start with a blank window, ignoring the last session', zh: '启动空白窗口，不恢复上次关闭的标签页' },
  argMultiInst: { en: 'Allow multiple windows at the same time', zh: '允许多个窗口同时运行' },
  argNoPlugin: { en: 'Start without loading plugins', zh: '启动时不加载插件' },
  openEditor: { en: 'Open Text Editor', zh: '打开文本编辑器' },
  closeTab: { en: 'Close Tab', zh: '关闭标签' },
  nextTab: { en: 'Next Tab', zh: '下一个标签' },
  prevTab: { en: 'Previous Tab', zh: '上一个标签' },
  toggleSidebar: { en: 'Toggle Sidebar', zh: '切换侧边栏' },
  searchTerminal: { en: 'Search in Terminal', zh: '终端内搜索' },
  zoomFont: { en: 'Zoom Font', zh: '缩放字体' },
  masterPassword: { en: 'Master Password', zh: '主密码' },
  masterPassPlaceholder: { en: 'Set a master password to encrypt saved credentials', zh: '设置主密码以加密保存的凭据' },
  encryptNote: { en: 'All saved passwords will be encrypted with AES-256-GCM using this key.', zh: '所有保存的密码将使用此密钥通过 AES-256-GCM 加密。' },
  savePassword: { en: 'Save Password', zh: '保存密码' },
  unsaved: { en: 'Unsaved changes', zh: '有未保存的更改' },
  showShortcuts: { en: 'Show Shortcut Hints', zh: '显示快捷键提示' },
  showShortcutsDesc: { en: 'Show keyboard shortcuts in tooltips and context menus.', zh: '在鼠标悬停和右键菜单中显示快捷键。' },
  saveTerminal: { en: 'Save Terminal', zh: '保存终端' },
  saveTerminalSuccess: { en: 'Terminal content saved successfully', zh: '终端内容已保存' },
  saveTerminalEmpty: { en: 'Terminal buffer is empty', zh: '终端缓冲区为空' },
  find: { en: 'Find', zh: '查找' },
  zoomIn: { en: 'Zoom In', zh: '放大' },
  zoomOut: { en: 'Zoom Out', zh: '缩小' },
  resetZoom: { en: 'Reset Zoom', zh: '重置缩放' },
  splitHorizontal: { en: 'Split Horizontal', zh: '水平分屏' },
  splitVertical: { en: 'Split Vertical', zh: '垂直分屏' },
  focusTerminal: { en: 'Focus Terminal', zh: '聚焦终端' },
  toggleFullscreen: { en: 'Toggle Fullscreen', zh: '切换全屏' },
  newTab: { en: 'New Tab', zh: '新建标签' },
  editSession: { en: 'Edit Session', zh: '编辑会话' },
  telnetOptions: { en: 'Telnet Options', zh: 'Telnet 选项' },
  serialOptions: { en: 'Serial Options', zh: '串口选项' },
  terminalType: { en: 'Terminal Type', zh: '终端类型' },
  baud: { en: 'Baud', zh: '波特率' },
  dataBits: { en: 'Data Bits', zh: '数据位' },
  stopBits: { en: 'Stop Bits', zh: '停止位' },
  parity: { en: 'Parity', zh: '校验' },
  flowControl: { en: 'Flow', zh: '流控' },
  saving: { en: 'Saving...', zh: '保存中...' },
  needMoreDevices: { en: 'Need at least 2 connected devices', zh: '需要至少 2 台已连接设备' },
  tunnels: { en: 'Tunnels', zh: '隧道' },
  multiexec: { en: 'MultiExec', zh: '多路广播' },
}

interface I18nContextType {
  lang: Lang
  setLang: (l: Lang) => void
}

const I18nContext = createContext<I18nContextType>({ lang: 'en', setLang: () => {} })

export function useT() {
  const { lang } = useContext(I18nContext)
  return useCallback((key: string, fallback?: string) => {
    if (!t[key]) return fallback || key
    return t[key][lang] || t[key].en || fallback || key
  }, [lang])
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useConfigStore(s => s.lang || 'en')
  const update = useConfigStore(s => s.update)

  const setLang = useCallback((l: Lang) => {
    update({ lang: l } as any)
  }, [update])

  return (
    <I18nContext.Provider value={{ lang, setLang }}>
      {children}
    </I18nContext.Provider>
  )
}

// Shorthand hook: returns { t, lang, setLang }
export function useI18n() {
  const { lang, setLang } = useContext(I18nContext)
  return { lang, setLang, t: (key: string, fb?: string) => (t[key] ? t[key][lang] || t[key].en : fb || key) }
}
