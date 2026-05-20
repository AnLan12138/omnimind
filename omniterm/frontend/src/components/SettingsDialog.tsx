import { useState, useEffect } from 'react'
import { X, Monitor, Keyboard, Palette, Shield, Info, Check, Download, Loader2, Puzzle, FolderOpen, Cloud, CloudUpload, CloudDownload, Eye, EyeOff } from 'lucide-react'
import { useThemeStore, THEMES } from '../stores/themeStore'
import { useConfigStore, type AppSettings } from '../stores/configStore'
import { useExtensionStore } from '../stores/extensionStore'
import { useI18n } from '../lib/i18n'
import { CheckForUpdate, InstallUpdate, PickExecutable } from '../../wailsjs/go/main/App'
import { useShortcutStore } from '../stores/shortcutStore'
import { PRESET_RULES, SGR, type HighlightRule } from '../lib/KeywordHighlighter'
import logoImg from '../assets/images/logo-universal.png'

// Map SGR color names to hex for UI display
function colorToHex(name: string): string {
  const map: Record<string, string> = {
    red: '#e74856', boldRed: '#f14c4c', green: '#16c60c', boldGreen: '#23d18b',
    yellow: '#f9f939', boldYellow: '#ffff4c', blue: '#3b78ff', boldBlue: '#3b8eea',
    magenta: '#b4009e', boldMagenta: '#e454ff', cyan: '#61d6d6', boldCyan: '#29b8db',
    white: '#cccccc', boldWhite: '#ffffff', black: '#0c0c0c',
    brightBlack: '#767676', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#ffff4c', brightBlue: '#3b8eea', brightMagenta: '#e454ff',
    brightCyan: '#29b8db', brightWhite: '#ffffff', gray: '#a0a0a0',
    orange: '#ff8700', lime: '#87ff00', sky: '#00afff', pink: '#ff87af',
    amber: '#ffaf00', teal: '#00af87', violet: '#875fff',
    dim: '#888888', bold: '#ffffff', italic: '#cccccc', underline: '#cccccc',
  }
  return map[name] || '#888888'
}

interface Props { onClose: () => void; initialTab?: string }

export default function SettingsDialog({ onClose, initialTab }: Props) {
  const [active, setActive] = useState(initialTab || 'appearance')
  const { current, setTheme } = useThemeStore()
  const config = useConfigStore()
  const { t } = useI18n()
  const extStore = useExtensionStore()
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [updateState, setUpdateState] = useState<'idle'|'checking'|'available'|'installing'|'done'|'error'>('idle')
  const [updateErr, setUpdateErr] = useState('')

  // Esc to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

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
    { id: 'sync', icon: Cloud, label: 'GitHub Sync' },
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
  const [highlightEnabled, setHighlightEnabled] = useState(config.highlightEnabled)
  const [highlightRules, setHighlightRules] = useState<HighlightRule[]>(config.highlightRules)

  useEffect(() => {
    setFontSize(config.terminalFontSize); setFontFamily(config.terminalFontFamily)
    setCursorStyle(config.cursorStyle); setScrollback(config.scrollback)
    setThemePick(config.terminalTheme); setAccentColor(config.accentColor)
    setUIScale(config.uiScale); setLang(config.lang); setShowShortcuts(config.showShortcuts)
    setHighlightEnabled(config.highlightEnabled); setHighlightRules(config.highlightRules)
  }, [config.terminalFontSize, config.terminalFontFamily, config.cursorStyle, config.scrollback, config.terminalTheme, config.accentColor, config.uiScale, config.lang, config.showShortcuts, config.highlightEnabled, config.highlightRules])

  const hasChanges = fontSize !== config.terminalFontSize || fontFamily !== config.terminalFontFamily ||
    cursorStyle !== config.cursorStyle || scrollback !== config.scrollback ||
    themePick !== config.terminalTheme || uiScale !== config.uiScale ||
    accentColor !== config.accentColor || lang !== config.lang || showShortcuts !== config.showShortcuts ||
    highlightEnabled !== config.highlightEnabled || JSON.stringify(highlightRules) !== JSON.stringify(config.highlightRules)

  const apply = () => {
    config.update({ terminalFontSize: fontSize, terminalFontFamily: fontFamily, cursorStyle, scrollback, terminalTheme: themePick, accentColor, uiScale, lang, highlightEnabled, highlightRules })
    setTheme(themePick); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  const cancel = () => {
    setFontSize(config.terminalFontSize); setFontFamily(config.terminalFontFamily)
    setCursorStyle(config.cursorStyle); setScrollback(config.scrollback)
    setThemePick(config.terminalTheme); setAccentColor(config.accentColor)
    setUIScale(config.uiScale); setLang(config.lang)
    setHighlightEnabled(config.highlightEnabled); setHighlightRules(config.highlightRules)
  }

  const CurTab = tabs.find(x => x.id === active)!

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="flex w-[860px] h-[560px] bg-vscode-panel border border-vscode-border shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="w-48 bg-vscode-sidebar border-r border-vscode-border py-2 flex flex-col">
          <div className="px-4 py-1.5 text-[14px] font-semibold uppercase tracking-wider text-vscode-text-dim mb-1">{t('settings')}</div>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActive(tab.id)}
              className={`w-full flex items-center gap-2.5 px-4 h-10 text-[13px] transition-colors ${active === tab.id ? 'bg-vscode-hover text-white border-l-2 border-l-vscode-accent' : 'text-vscode-text-muted hover:text-vscode-text border-l-2 border-l-transparent'}`}>
              <tab.icon size={16} /> {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 h-9 border-b border-vscode-border shrink-0">
            <span className="text-[15px] font-semibold text-vscode-text">{CurTab.label}</span>
            <button onClick={onClose} className="p-1 hover:bg-vscode-hover rounded"><X size={16} className="text-vscode-text-muted" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {active === 'appearance' && (
              <>
                <div>
                  <label className="block text-[13px] font-semibold text-vscode-text mb-2">{t('terminalTheme')}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(THEMES).map(([key, theme]) => (
                      <button key={key} onClick={() => setThemePick(key)}
                        className={`p-2 rounded border text-left transition-colors relative ${themePick === key ? 'border-vscode-accent bg-vscode-selection ring-1 ring-vscode-accent' : 'border-vscode-border hover:bg-vscode-hover'}`}>
                        <div className="flex gap-1 mb-1">{[theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map((c, i) => (<span key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />))}</div>
                        <div className="text-[14px] text-vscode-text">{theme.name}</div>
                        <div className="text-[11px] text-vscode-text-dim mt-0.5 px-1 py-0.5 rounded" style={{ background: theme.background, color: theme.foreground }}>AaBbCc 123</div>
                        {themePick === key && <Check size={12} className="absolute top-1 right-1 text-vscode-accent" />}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-vscode-text mb-2">{t('accentColor')}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="w-8 h-8 rounded border border-vscode-border cursor-pointer bg-transparent p-0" />
                    <input type="text" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="w-24 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text font-mono focus:outline-none focus:border-vscode-accent" />
                    <div className="flex gap-1 ml-2">
                      {['#007acc','#3b82f6','#8b5cf6','#ec4899','#f97316','#22c55e'].map(c => (
                        <button key={c} onClick={() => setAccentColor(c)} className="w-5 h-5 rounded-full border border-vscode-border hover:scale-110 transition-transform"
                          style={{ background: c, outline: accentColor === c ? '2px solid white' : 'none', outlineOffset: '1px' }} />
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-vscode-text mb-2">{t('language')}</label>
                  <div className="flex gap-1.5">
                    {[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }].map(s => (
                      <button key={s.value} onClick={() => setLang(s.value as any)}
                        className={`px-3 py-1.5 rounded border text-[14px] transition-colors ${lang === s.value ? 'border-vscode-accent bg-vscode-selection text-white' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>{s.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-vscode-text mb-2">{t('uiScale')}</label>
                  <div className="flex gap-1.5">
                    {(['compact','normal','comfortable'] as const).map(s => (
                      <button key={s} onClick={() => setUIScale(s)}
                        className={`px-3 py-1.5 rounded border text-[14px] transition-colors capitalize ${uiScale === s ? 'border-vscode-accent bg-vscode-selection text-white' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>
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
                    <label className="block text-[13px] text-vscode-text-dim mb-1">{t('fontSize')}{fontSize !== config.terminalFontSize && <span className="ml-1 text-vscode-yellow text-[14px]">•</span>}</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={8} max={36} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="flex-1 h-1 accent-vscode-accent" />
                      <span className="w-8 text-center text-[14px] text-vscode-text font-mono">{fontSize}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] text-vscode-text-dim mb-1">{t('cursorStyle')}{cursorStyle !== config.cursorStyle && <span className="ml-1 text-vscode-yellow text-[14px]">•</span>}</label>
                    <div className="flex gap-1">
                      {(['bar','block','underline'] as const).map(s => (
                        <button key={s} onClick={() => setCursorStyle(s)}
                          className={`px-3 h-7 text-[13px] rounded border capitalize transition-colors ${cursorStyle === s ? 'border-vscode-accent bg-vscode-selection text-vscode-text' : 'border-vscode-border text-vscode-text-muted hover:bg-vscode-hover'}`}>{t(s)}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] text-vscode-text-dim mb-1">{t('fontFamily')}{fontFamily !== config.terminalFontFamily && <span className="ml-1 text-vscode-yellow text-[14px]">•</span>}</label>
                  <input type="text" value={fontFamily} onChange={e => setFontFamily(e.target.value)} className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text focus:outline-none focus:border-vscode-accent font-mono" />
                </div>
                <div>
                  <label className="block text-[13px] text-vscode-text-dim mb-1">{t('scrollback')}{scrollback !== config.scrollback && <span className="ml-1 text-vscode-yellow text-[14px]">•</span>}</label>
                  <input type="number" value={scrollback} onChange={e => setScrollback(Number(e.target.value))} min={500} max={100000} step={1000} className="w-28 px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text focus:outline-none focus:border-vscode-accent font-mono" />
                </div>

                {/* Keyword Highlighting */}
                <div className="border-t border-vscode-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-semibold text-vscode-text">关键字高亮</label>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-vscode-text-dim">{highlightRules.filter(r => r.enabled).length}/{highlightRules.length} 条启用</span>
                      <button
                        onClick={() => setHighlightEnabled(!highlightEnabled)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[14px] transition-colors ${highlightEnabled ? 'bg-vscode-green/20 text-vscode-green' : 'bg-vscode-input text-vscode-text-dim'}`}>
                        {highlightEnabled ? <Eye size={11} /> : <EyeOff size={11} />}
                        {highlightEnabled ? '已启用' : '已禁用'}
                      </button>
                    </div>
                  </div>
                  {highlightEnabled && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {(() => {
                        const groups = new Map<string, HighlightRule[]>()
                        for (const r of highlightRules) {
                          const cat = r.category || '其他'
                          if (!groups.has(cat)) groups.set(cat, [])
                          groups.get(cat)!.push(r)
                        }
                        return Array.from(groups.entries()).map(([cat, rules]) => (
                          <div key={cat}>
                            <div className="text-[14px] font-semibold text-vscode-text-dim mb-1 px-1 border-b border-vscode-border pb-0.5">
                              {cat}
                              <span className="ml-1 font-normal text-vscode-text-dim/60">({rules.filter(r => r.enabled).length}/{rules.length})</span>
                            </div>
                            <div className="space-y-0.5">
                              {rules.map((rule) => {
                                const i = highlightRules.findIndex(r => r.id === rule.id)
                                return (
                                  <div key={rule.id} className="flex items-center gap-2 px-1.5 h-6 hover:bg-vscode-hover rounded group">
                                    <input
                                      type="checkbox"
                                      checked={rule.enabled}
                                      onChange={() => {
                                        const next = [...highlightRules]
                                        next[i] = { ...next[i], enabled: !next[i].enabled }
                                        setHighlightRules(next)
                                      }}
                                      className="shrink-0 w-3 h-3"
                                    />
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorToHex(rule.color) }} />
                                    <span className="text-[13px] text-vscode-text flex-1 truncate">{rule.name}</span>
                                    <button
                                      onClick={() => {
                                        const next = [...highlightRules]
                                        const preset = PRESET_RULES.find(p => p.id === rule.id)
                                        if (preset) next[i] = { ...preset }
                                        setHighlightRules(next)
                                      }}
                                      className="text-[11px] text-vscode-text-dim hover:text-vscode-accent opacity-0 group-hover:opacity-100 shrink-0">
                                      重置
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                  <div className="flex gap-1 mt-2">
                    <button
                      onClick={() => setHighlightRules(PRESET_RULES.map(r => ({ ...r })))}
                      className="px-2 py-0.5 text-[14px] text-vscode-text-dim hover:text-vscode-text border border-vscode-border rounded">
                      恢复默认
                    </button>
                    <button
                      onClick={() => {
                        const next = highlightRules.map(r => ({ ...r, enabled: true }))
                        setHighlightRules(next)
                      }}
                      className="px-2 py-0.5 text-[14px] text-vscode-text-dim hover:text-vscode-text border border-vscode-border rounded">
                      全部启用
                    </button>
                    <button
                      onClick={() => {
                        const next = highlightRules.map(r => ({ ...r, enabled: false }))
                        setHighlightRules(next)
                      }}
                      className="px-2 py-0.5 text-[14px] text-vscode-text-dim hover:text-vscode-text border border-vscode-border rounded">
                      全部禁用
                    </button>
                  </div>
                </div>
              </>
            )}

            {active === 'extensions' && (
              <div className="space-y-3 text-[14px] text-vscode-text">
                <div className="text-vscode-text-dim text-[13px]">{t('extensionsDesc')}</div>
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
                        className="flex-1 h-7 px-2 bg-vscode-bg border border-vscode-border rounded text-[13px] text-vscode-text placeholder-vscode-text-dim truncate" />
                      <button
                        onClick={async () => {
                          try { const p = await PickExecutable(); if (p) extStore.setPath(ext.id, p) } catch {}
                        }}
                        className="flex items-center gap-1 px-2 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[13px] shrink-0">
                        <FolderOpen size={12} /> {t('browse')}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[14px] text-vscode-text-dim">{t('launchArgs')}</span>
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
                              <span className="text-[13px] text-vscode-text">{t(p.k)}</span>
                              <span className="text-[14px] text-vscode-text-dim/60 ml-1 font-mono">{p.flag}</span>
                            </div>
                          </label>
                        )
                      })}
                      <input
                        type="text" value={ext.args || ''}
                        onChange={e => extStore.setArgs(ext.id, e.target.value)}
                        placeholder="-nosession -multiInst"
                        className="w-full h-7 px-2 bg-vscode-bg border border-vscode-border rounded text-[13px] text-vscode-text placeholder-vscode-text-dim font-mono" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {active === 'shortcuts' && <ShortcutEditor />}

            {active === 'security' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[13px] font-semibold text-vscode-text mb-2">{t('masterPassword')}</label>
                  <input type="password" value={masterPass} onChange={e => setMasterPass(e.target.value)}
                    placeholder={t('masterPassPlaceholder')}
                    className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
                  <p className="text-[14px] text-vscode-text-dim mt-1">{t('encryptNote')}</p>
                </div>
                <button onClick={() => { import('../../wailsjs/go/main/App').then(m => m.SetMasterPassword(masterPass)); setMasterPass('') }}
                  className="px-4 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[14px]">{t('savePassword')}</button>
              </div>
            )}

            {active === 'sync' && <SyncSettings />}

            {active === 'about' && (
              <div className="space-y-2 text-[14px] text-vscode-text">
                <img src={logoImg} alt="OmniMind" className="w-16 h-16 mx-auto mb-2" />
                <div className="text-lg font-semibold text-white text-center">OmniMind</div>
                <div className="text-vscode-text-dim text-center">v0.1.0 — {t('builtWith')}</div>

                {/* Update check */}
                <div className="mt-3 p-2 bg-vscode-input border border-vscode-border rounded">
                  {updateState === 'checking' && (
                    <div className="flex items-center gap-2 text-vscode-text-dim"><Loader2 size={12} className="animate-spin" /> Checking for updates...</div>
                  )}
                  {updateState === 'available' && updateInfo && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-vscode-green text-[14px] font-medium"><Download size={13} /> {updateInfo.tag_name} available</div>
                      {updateInfo.body && <div className="text-[14px] text-vscode-text-dim whitespace-pre-wrap max-h-20 overflow-y-auto">{updateInfo.body}</div>}
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
                        className="px-3 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[13px]">
                        { 'Install Update' }
                      </button>
                    </div>
                  )}
                  {updateState === 'done' && (
                    <div className="flex items-center gap-1.5 text-vscode-green"><Check size={12} /> Update installed — restart to apply</div>
                  )}
                  {updateState === 'idle' && (
                    <div className="text-vscode-text-dim text-[13px]">You're up to date</div>
                  )}
                  {updateState === 'error' && (
                    <div className="text-vscode-red text-[13px]">{updateErr || 'Check failed'}</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1 mt-3 text-[13px]">
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
            <div className="text-[13px]">
              {saved ? <span className="flex items-center gap-1 text-vscode-green"><Check size={12} /> {t('saved')}</span>
               : hasChanges ? <span className="text-vscode-yellow">{t('unsaved')}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { apply(); onClose() }}
                className="px-5 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[14px] font-medium transition-colors">保存并关闭</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SyncSettings() {
  const [token, setToken] = useState(localStorage.getItem('gh_token') || '')
  const [gistID, setGistID] = useState(localStorage.getItem('gh_gist_id') || '')
  const [status, setStatus] = useState('')
  const [syncing, setSyncing] = useState(false)

  const saveCreds = () => {
    localStorage.setItem('gh_token', token)
    localStorage.setItem('gh_gist_id', gistID)
    setStatus('已保存')
    setTimeout(() => setStatus(''), 2000)
  }

  const doSync = async (action: 'push' | 'pull') => {
    if (!token) { setStatus('请先输入 Token'); return }
    setSyncing(true); setStatus(action === 'push' ? '上传中...' : '下载中...')
    try {
      const mod = await import('../../wailsjs/go/main/App')
      if (action === 'push') {
        const sessions = JSON.stringify(await mod.ListSessions())
        const folders = JSON.stringify(await mod.ListFolders())
        const macros = localStorage.getItem('omni-macros2') || '[]'
        const settings = localStorage.getItem('omni-config2') || '{}'
        const devices = localStorage.getItem('omni-devices2') || '[]'
        const newGistID = await mod.SyncPush(token, gistID, sessions, folders, macros, settings, devices)
        if (newGistID && !gistID) { setGistID(newGistID); localStorage.setItem('gh_gist_id', newGistID) }
        setStatus('上传完成!')
      } else {
        if (!gistID) { setStatus('请先输入 Gist ID'); setSyncing(false); return }
        const data = await mod.SyncPull(token, gistID)
        if (data.sessions) {
          const sessions = JSON.parse(data.sessions)
          for (const s of sessions) { try { await mod.SaveSession(s) } catch {} }
          // Reload sessions
          window.dispatchEvent(new Event('devices-changed'))
        }
        if (data.devices) localStorage.setItem('omni-devices2', data.devices)
        if (data.macros) localStorage.setItem('omni-macros2', data.macros)
        if (data.settings) localStorage.setItem('omni-config2', data.settings)
        setStatus('下载完成! 请重启应用以完整刷新')
      }
    } catch (err: any) {
      setStatus('失败: ' + (err?.message || err))
    }
    setSyncing(false)
    setTimeout(() => setStatus(''), 5000)
  }

  return (
    <div className="space-y-3 text-[14px] text-vscode-text">
      <p className="text-vscode-text-dim text-[13px]">同步设备列表、宏指令、设置到 GitHub Gist。数据以加密 JSON 存储在你的私有 Gist 中。</p>

      <div>
        <div className="text-[13px] text-vscode-text-dim mb-0.5">GitHub Personal Access Token</div>
        <input type="password" value={token} onChange={e => setToken(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text focus:outline-none focus:border-vscode-accent" />
        <div className="text-[11px] text-vscode-text-dim mt-0.5">需要 <code className="text-[#ce9178]">gist</code> 权限</div>
      </div>

      <div>
        <div className="text-[13px] text-vscode-text-dim mb-0.5">Gist ID (首次上传后自动填入)</div>
        <input type="text" value={gistID} onChange={e => setGistID(e.target.value)}
          placeholder="32 位十六进制字符串"
          className="w-full px-2 h-7 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text font-mono focus:outline-none focus:border-vscode-accent" />
      </div>

      <div className="flex gap-2">
        <button onClick={() => doSync('push')} disabled={syncing}
          className="flex items-center gap-1.5 px-3 h-7 bg-vscode-accent hover:bg-vscode-accent-hover text-white rounded text-[13px] disabled:opacity-50">
          <CloudUpload size={12} /> 上传到 GitHub
        </button>
        <button onClick={() => doSync('pull')} disabled={syncing}
          className="flex items-center gap-1.5 px-3 h-7 bg-vscode-input border border-vscode-border hover:bg-vscode-hover text-vscode-text rounded text-[13px] disabled:opacity-50">
          <CloudDownload size={12} /> 从 GitHub 下载
        </button>
        <button onClick={saveCreds} className="px-3 h-7 bg-vscode-input border border-vscode-border hover:bg-vscode-hover text-vscode-text rounded text-[13px]">
          保存凭据
        </button>
      </div>

      {status && <div className="text-[13px] text-vscode-accent mt-1">{status}</div>}
    </div>
  )
}

function ShortcutEditor() {
  const { shortcuts, setKeys, reset, resetAll } = useShortcutStore()
  const [editing, setEditing] = useState<string | null>(null)
  const [captureKeys, setCaptureKeys] = useState('')

  const startCapture = (id: string) => {
    setEditing(id)
    setCaptureKeys('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!editing) return
    e.preventDefault()
    e.stopPropagation()

    // Build shortcut string
    const parts: string[] = []
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')

    // Ignore pure modifier key presses
    const modifierKeys = ['Control', 'Shift', 'Alt', 'Meta']
    if (modifierKeys.includes(e.key)) return

    // Normalize key name
    let key = e.key
    if (key === ' ') key = 'Space'
    if (key.length === 1) key = key.toUpperCase()

    parts.push(key)
    const shortcut = parts.join('+')
    setCaptureKeys(shortcut)

    // Save after short delay
    setTimeout(() => {
      setKeys(editing, shortcut)
      setEditing(null)
      setCaptureKeys('')
    }, 300)
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] text-vscode-text-dim">双击快捷键进行编辑，按新组合键替换。点 Reset 恢复默认。</span>
        <button onClick={resetAll} className="px-2 py-0.5 text-[14px] text-vscode-text-dim hover:text-vscode-red border border-vscode-border rounded">
          全部重置
        </button>
      </div>
      {shortcuts.map(s => (
        <div key={s.id}
          className="flex items-center justify-between px-2 h-7 hover:bg-vscode-hover rounded group"
          onDoubleClick={() => startCapture(s.id)}
          onKeyDown={editing === s.id ? handleKeyDown : undefined}
          tabIndex={editing === s.id ? 0 : -1}
          style={editing === s.id ? { background: '#007acc33', outline: '1px solid #007acc' } : undefined}>
          <span className="text-[14px] text-vscode-text">{s.label}</span>
          <div className="flex items-center gap-1.5">
            {editing === s.id ? (
              <span className="px-1.5 py-0.5 bg-vscode-accent text-white rounded text-[14px] font-mono animate-pulse">
                {captureKeys || '按下新快捷键...'}
              </span>
            ) : (
              <kbd className="px-1.5 py-0.5 bg-vscode-input border border-vscode-border rounded text-[14px] text-vscode-text-dim font-mono">
                {s.keys}
              </kbd>
            )}
            {s.keys !== s.defaultKeys && (
              <button onClick={() => reset(s.id)}
                className="text-[11px] text-vscode-text-dim hover:text-vscode-accent opacity-0 group-hover:opacity-100">
                重置
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
