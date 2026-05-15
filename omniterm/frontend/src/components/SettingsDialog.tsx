import { useState, useEffect } from 'react'
import { X, Monitor, Keyboard, Palette, Shield, Info, Check, Download, Loader2, Puzzle, FolderOpen } from 'lucide-react'
import { useThemeStore, THEMES } from '../stores/themeStore'
import { useConfigStore, type AppSettings } from '../stores/configStore'
import { useExtensionStore } from '../stores/extensionStore'
import { useI18n } from '../lib/i18n'
import { CheckForUpdate, InstallUpdate, PickExecutable } from '../../wailsjs/go/main/App'

interface Props { onClose: () => void; initialTab?: string }

const shortcutList = [
  { keys: 'Ctrl+Shift+C', dk: 'copy' },
  { keys: 'Ctrl+Shift+V', dk: 'paste' },
  { keys: 'Ctrl+Shift+K', dk: 'clearBuffer' },
  { keys: 'Ctrl+Shift+S', dk: 'saveTerminal' },
  { keys: 'Ctrl+Shift+F', dk: 'find' },
  { keys: 'Ctrl+T', dk: 'newTab' },
  { keys: 'Ctrl+N', dk: 'newSession' },
  { keys: 'Ctrl+W', dk: 'closeTab' },
  { keys: 'Ctrl+Tab', dk: 'nextTab' },
  { keys: 'Ctrl+Shift+Tab', dk: 'prevTab' },
  { keys: 'Ctrl+Shift+E', dk: 'toggleSidebar' },
  { keys: 'Ctrl+Shift+O', dk: 'splitHorizontal' },
  { keys: 'Ctrl+\'', dk: 'splitVertical' },
  { keys: 'Ctrl+=', dk: 'zoomIn' },
  { keys: 'Ctrl+-', dk: 'zoomOut' },
  { keys: 'Ctrl+0', dk: 'resetZoom' },
  { keys: 'Ctrl+MouseWheel', dk: 'zoomFont' },
  { keys: 'Ctrl+,', dk: 'settings' },
  { keys: 'F11', dk: 'toggleFullscreen' },
]

export default function SettingsDialog({ onClose, initialTab }: Props) {
  const [active, setActive] = useState(initialTab || 'appearance')
  const { current, setTheme } = useThemeStore()
  const config = useConfigStore()
  const { t } = useI18n()
  const extStore = useExtensionStore()
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [updateState, setUpdateState] = useState<'idle'|'checking'|'available'|'installing'|'done'|'error'>('idle')
  const [updateErr, setUpdateErr] = useState('')

  useEffect(() => {
    if (active !== 'about' || updateState !== 'idle') return
    setUpdateState('checking')
    CheckForUpdate()
      .then(r => { if (r) { setUpdateInfo(r); setUpdateState('available') } else { setUpdateState('idle') } })
      .catch(() => setUpdateState('idle'))
  }, [active])

  const tabs = [
    { id: 'appearance', icon: Palette, label: t('appearance') },
    { id: 'terminal', icon: Monitor, label: t('terminalTab') },
    { id: 'extensions', icon: Puzzle, label: t('extensions') },
    { id: 'shortcuts', icon: Keyboard, label: t('shortcuts') },
    { id: 'security', icon: Shield, label: t('security') },
    { id: 'about', icon: Info, label: t('about') },
  ]

  const [fontSize, setFontSize] = useState(config.terminalFontSize)
  const [fontFamily, setFontFamily] = useState(config.terminalFontFamily)
  const [cursorStyle, setCursorStyle] = useState<'bar' | 'block' | 'underline'>(config.cursorStyle)
  const [scrollback, setScrollback] = useState(config.scrollback)
  const [themePick, setThemePick] = useState(config.terminalTheme)
  const [accentColor, setAccentColor] = useState(config.accentColor)
  const [uiScale, setUIScale] = useState(config.uiScale)
  const [lang, setLang] = useState(config.lang)
  const [showShortcuts, setShowShortcuts] = useState(config.showShortcuts)
  const [masterPass, setMasterPass] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setFontSize(config.terminalFontSize); setFontFamily(config.terminalFontFamily)
    setCursorStyle(config.cursorStyle); setScrollback(config.scrollback)
    setThemePick(config.terminalTheme); setAccentColor(config.accentColor)
    setUIScale(config.uiScale); setLang(config.lang); setShowShortcuts(config.showShortcuts)
  }, [config.terminalFontSize, config.terminalFontFamily, config.cursorStyle, config.scrollback, config.terminalTheme, config.accentColor, config.uiScale, config.lang, config.showShortcuts])

  const hasChanges = fontSize !== config.terminalFontSize || fontFamily !== config.terminalFontFamily ||
    cursorStyle !== config.cursorStyle || scrollback !== config.scrollback ||
    themePick !== config.terminalTheme || uiScale !== config.uiScale ||
    accentColor !== config.accentColor || lang !== config.lang || showShortcuts !== config.showShortcuts

  const apply = () => {
    config.update({ terminalFontSize: fontSize, terminalFontFamily: fontFamily, cursorStyle, scrollback, terminalTheme: themePick, accentColor, uiScale, lang })
    setTheme(themePick); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const cancel = () => {
    setFontSize(config.terminalFontSize); setFontFamily(config.terminalFontFamily)
    setCursorStyle(config.cursorStyle); setScrollback(config.scrollback)
    setThemePick(config.terminalTheme); setAccentColor(config.accentColor)
    setUIScale(config.uiScale); setLang(config.lang)
  }

  const CurTab = tabs.find(x => x.id === active)!

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="flex w-[720px] h-[500px] bg-vscode-panel border border-vscode-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-44 bg-vscode-sidebar border-r border-vscode-border py-2 flex flex-col">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-vscode-text-dim mb-1">{t('settings')}</div>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActive(tab.id)}
              className={`w-full flex items-center gap-2 px-3 h-8 text-[12px] transition-colors ${active === tab.id ? 'bg-vscode-hover text-white border-l-2 border-l-vscode-accent' : 'text-vscode-text-muted hover:text-vscode-text border-l-2 border-l-transparent'}`}>
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 h-9 border-b border-vscode-border shrink-0">
            <span className="text-[13px] text-vscode-text">{CurTab.label}</span>
            <button onClick={onClose} className="p-0.5 hover:bg-vscode-hover rounded"><X size={14} className="text-vscode-text-muted" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {active === 'appearance' && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-vscode-text mb-2">{t('terminalTheme')}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(THEMES).map(([key, theme]) => (
                      <button key={key} onClick={() => setThemePick(key)}
                        className={`p-2 rounded border text-left transition-colors relative ${themePick === key ? 'border-vscode-accent bg-vscode-selection ring-1 ring-vscode-accent' : 'border-vscode-border hover:bg-vscode-hover'}`}>
                        <div className="flex gap-1 mb-1">{[theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map((c, i) => (<span key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />))}</div>
                        <div className="text-[10px] text-vscode-text">{theme.name}</div>
                        <div className="text-[9px] text-vscode-text-dim mt-0.5 px-1 py-0.5 rounded" style={{ background: theme.background, color: theme.foreground }}>AaBbCc 123</div>
                        {themePick === key && <Check size={12} className="absolute top-1 right-1 text-vscode-accent" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-vscode-text mb-2">{t('accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="w-8 h-8 rounded border border-vscode-border cursor-pointer bg-transparent p-0" />
                    <input type="text" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="w-24 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text font-mono focus:outline-none focus:border-vscode-accent" />
                    <div className="flex gap-1 ml-2">
                      {['#007acc','#3b82f6','#8b5cf6','#ec4899','#f97316','#22c55e'].map(c => (
                        <button key={c} onClick={() => setAccentColor(c)} className="w-5 h-5 rounded-full border border-vscode-border hover:scale-110 transition-transform"
                          style={{ background: c, outline: accentColor === c ? '2px solid white' : 'none', outlineOffset: '1px' }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-vscode-text mb-2">{t('language')}</label>
                  <div className="flex gap-1.5">
                    {[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }].map(s => (
                      <button key={s.value} onClick={() => setLang(s.value as any)}
                        className={`px-3 py-1.5 rounded border text-[12px] transition-colors ${lang === s.value ? 'border-vscode-accent bg-vscode-selection text-white' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>{s.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-vscode-text mb-2">{t('uiScale')}</label>
                  <div className="flex gap-1.5">
                    {(['compact','normal','comfortable'] as const).map(s => (
                      <button key={s} onClick={() => setUIScale(s)}
                        className={`px-3 py-1.5 rounded border text-[12px] transition-colors capitalize ${uiScale === s ? 'border-vscode-accent bg-vscode-selection text-white' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>
                        {s === 'compact' ? (lang==='zh'?'紧凑':'Small') : s === 'normal' ? (lang==='zh'?'标准':'Normal') : (lang==='zh'?'舒适':'Large')}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {active === 'terminal' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-vscode-text-dim mb-1">{t('fontSize')}{fontSize !== config.terminalFontSize && <span className="ml-1 text-vscode-yellow text-[10px]">•</span>}</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={8} max={36} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1 h-1 accent-vscode-accent" />
                      <span className="w-8 text-center text-[12px] text-vscode-text font-mono">{fontSize}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-vscode-text-dim mb-1">{t('cursorStyle')}{cursorStyle !== config.cursorStyle && <span className="ml-1 text-vscode-yellow text-[10px]">•</span>}</label>
                    <div className="flex gap-1">
                      {(['bar','block','underline'] as const).map(s => (
                        <button key={s} onClick={() => setCursorStyle(s)}
                          className={`px-3 h-7 text-[11px] rounded border capitalize transition-colors ${cursorStyle === s ? 'border-vscode-accent bg-vscode-selection text-vscode-text' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>{t(s)}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-vscode-text-dim mb-1">{t('fontFamily')}{fontFamily !== config.terminalFontFamily && <span className="ml-1 text-vscode-yellow text-[10px]">•</span>}</label>
                  <input type="text" value={fontFamily} onChange={e => setFontFamily(e.target.value)} className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent font-mono" />
                </div>
                <div>
                  <label className="block text-[11px] text-vscode-text-dim mb-1">{t('scrollback')}{scrollback !== config.scrollback && <span className="ml-1 text-vscode-yellow text-[10px]">•</span>}</label>
                  <input type="number" value={scrollback} onChange={e => setScrollback(Number(e.target.value))} min={500} max={100000} step={1000} className="w-28 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent font-mono" />
                </div>
              </>
            )}

            {active === 'extensions' && (
              <div className="space-y-3 text-[12px] text-vscode-text">
                <div className="text-vscode-text-dim text-[11px]">{t('extensionsDesc')}</div>
                {extStore.extensions.map(ext => (
                  <div key={ext.id} className="p-2 bg-vscode-input border border-vscode-border rounded space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-white">{ext.name}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${ext.exePath ? 'bg-vscode-green' : 'bg-vscode-text-dim/30'}`} />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text" readOnly value={ext.exePath}
                        placeholder={t('selectEditorPath')}
                        className="flex-1 h-7 px-2 bg-vscode-bg border border-vscode-border rounded text-[11px] text-vscode-text placeholder-vscode-text-dim truncate" />
                      <button
                        onClick={async () => {
                          try { const p = await PickExecutable(); if (p) extStore.setPath(ext.id, p) } catch {}
                        }}
                        className="flex items-center gap-1 px-2 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[11px] shrink-0">
                        <FolderOpen size={12} /> {t('browse')}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-vscode-text-dim">{t('launchArgs')}</span>
                      {[
                        { flag: '-nosession', k: 'argNoSession' },
                        { flag: '-multiInst', k: 'argMultiInst' },
                        { flag: '-noPlugin', k: 'argNoPlugin' },
                      ].map(p => {
                        const args = ext.args || ''
                        const checked = args.includes(p.flag)
                        return (
                          <label key={p.flag} className="flex items-start gap-1.5 cursor-pointer hover:bg-vscode-hover/50 rounded px-1 py-0.5">
                            <input type="checkbox" checked={checked}
                              onChange={() => {
                                const current = args.split(' ').filter(Boolean)
                                const next = checked ? current.filter(f => f !== p.flag) : [...current, p.flag]
                                extStore.setArgs(ext.id, next.join(' '))
                              }}
                              className="mt-0.5 shrink-0" />
                            <div>
                              <span className="text-[11px] text-vscode-text">{t(p.k)}</span>
                              <span className="text-[10px] text-vscode-text-dim/60 ml-1 font-mono">{p.flag}</span>
                            </div>
                          </label>
                        )
                      })}
                      <input
                        type="text" value={ext.args || ''}
                        onChange={e => extStore.setArgs(ext.id, e.target.value)}
                        placeholder="-nosession -multiInst"
                        className="w-full h-7 px-2 bg-vscode-bg border border-vscode-border rounded text-[11px] text-vscode-text placeholder-vscode-text-dim font-mono" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {active === 'shortcuts' && (
              <div className="space-y-0.5">
                {shortcutList.map(s => (
                  <div key={s.keys} className="flex items-center justify-between px-2 h-7 hover:bg-vscode-hover rounded">
                    <span className="text-[12px] text-vscode-text">{t(s.dk)}</span>
                    <kbd className="px-1.5 py-0.5 bg-vscode-input border border-vscode-border rounded text-[10px] text-vscode-text-dim font-mono">{s.keys}</kbd>
                  </div>
                ))}
              </div>
            )}

            {active === 'security' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-vscode-text mb-2">{t('masterPassword')}</label>
                  <input type="password" value={masterPass} onChange={e => setMasterPass(e.target.value)}
                    placeholder={t('masterPassPlaceholder')}
                    className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[12px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                  <p className="text-[10px] text-vscode-text-dim mt-1">{t('encryptNote')}</p>
                </div>
                <button onClick={() => { import('../../wailsjs/go/main/App').then(m => m.SetMasterPassword(masterPass)); setMasterPass('') }}
                  className="px-4 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[12px]">{t('savePassword')}</button>
              </div>
            )}

            {active === 'about' && (
              <div className="space-y-2 text-[12px] text-vscode-text">
                <div className="text-lg font-semibold text-white">OmniTerm</div>
                <div className="text-vscode-text-dim">v0.1.0 — {t('builtWith')}</div>

                {/* Update check */}
                <div className="mt-3 p-2 bg-vscode-input border border-vscode-border rounded">
                  {updateState === 'checking' && (
                    <div className="flex items-center gap-2 text-vscode-text-dim"><Loader2 size={12} className="animate-spin" /> Checking for updates...</div>
                  )}
                  {updateState === 'available' && updateInfo && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-vscode-green text-[12px] font-medium"><Download size={13} /> {updateInfo.tag_name} available</div>
                      {updateInfo.body && <div className="text-[10px] text-vscode-text-dim whitespace-pre-wrap max-h-20 overflow-y-auto">{updateInfo.body}</div>}
                      <button
                        onClick={async () => {
                          setUpdateState('installing')
                          try {
                            const asset = updateInfo.assets?.find((a: any) => a.name.endsWith('.exe'))
                            if (asset) {
                              await InstallUpdate(asset.browser_download_url)
                              setUpdateState('done')
                            } else {
                              setUpdateErr('No suitable download found')
                              setUpdateState('error')
                            }
                          } catch (e: any) {
                            setUpdateErr(e?.message || 'Install failed')
                            setUpdateState('error')
                          }
                        }}
                        className="px-3 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[11px]">
                        { 'Install Update' }
                      </button>
                    </div>
                  )}
                  {updateState === 'done' && (
                    <div className="flex items-center gap-1.5 text-vscode-green"><Check size={12} /> Update installed — restart to apply</div>
                  )}
                  {updateState === 'idle' && (
                    <div className="text-vscode-text-dim text-[11px]">You're up to date</div>
                  )}
                  {updateState === 'error' && (
                    <div className="text-vscode-red text-[11px]">{updateErr || 'Check failed'}</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1 mt-3 text-[11px]">
                  {[{ name: 'SSH', ok: true },{ name: 'Telnet', ok: true },{ name: 'RDP', ok: true },{ name: 'VNC', ok: true },{ name: 'FTP', ok: true },{ name: 'SFTP', ok: true },{ name: 'Serial', ok: true },{ name: 'MOSH', ok: true },{ name: 'X11', ok: false }].map(p => (
                    <div key={p.name} className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${p.ok ? 'bg-vscode-green' : 'bg-vscode-text-dim/30'}`} />
                      <span className={p.ok ? 'text-vscode-text' : 'text-vscode-text-dim'}>{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 h-10 border-t border-vscode-border bg-vscode-sidebar shrink-0">
            <div className="text-[11px]">
              {saved ? <span className="flex items-center gap-1 text-vscode-green"><Check size={12} /> {t('saved')}</span>
               : hasChanges ? <span className="text-vscode-yellow">{t('unsaved')}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { cancel(); onClose() }} className="px-3 h-7 text-[12px] text-vscode-text-muted hover:text-vscode-text hover:bg-vscode-hover rounded transition-colors">{t('cancel')}</button>
              <button onClick={() => { apply(); onClose() }}
                className="px-5 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[12px] font-medium transition-colors">{t('close')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
