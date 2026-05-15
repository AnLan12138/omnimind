import { create } from 'zustand'

export interface TerminalTheme {
  name: string
  background: string; foreground: string; cursor: string; selectionBackground: string
  black: string; red: string; green: string; yellow: string
  blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

export const THEMES: Record<string, TerminalTheme> = {
  'vs-code': {
    name: 'VS Code Dark+',
    background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#ffffff', selectionBackground: '#264f78',
    black: '#0c0c0c', red: '#e74856', green: '#16c60c', yellow: '#f9f939',
    blue: '#3b78ff', magenta: '#b4009e', cyan: '#61d6d6', white: '#cccccc',
    brightBlack: '#767676', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#ffff4c', brightBlue: '#3b8eea', brightMagenta: '#e454ff',
    brightCyan: '#29b8db', brightWhite: '#ffffff',
  },
  dark: {
    name: 'Dark',
    background: '#0d0d0d', foreground: '#e0e0e0', cursor: '#3b82f6', selectionBackground: '#3b82f644',
    black: '#1a1a1a', red: '#ff4444', green: '#44ff44', yellow: '#ffcc00',
    blue: '#4488ff', magenta: '#ff44ff', cyan: '#44ffff', white: '#e0e0e0',
    brightBlack: '#555555', brightRed: '#ff6666', brightGreen: '#66ff66',
    brightYellow: '#ffdd44', brightBlue: '#66aaff', brightMagenta: '#ff66ff',
    brightCyan: '#66ffff', brightWhite: '#ffffff',
  },
  light: {
    name: 'Light',
    background: '#ffffff', foreground: '#1a1a1a', cursor: '#3b82f6', selectionBackground: '#3b82f644',
    black: '#1a1a1a', red: '#cc0000', green: '#008800', yellow: '#aa6600',
    blue: '#0044cc', magenta: '#aa00aa', cyan: '#008888', white: '#f0f0f0',
    brightBlack: '#666666', brightRed: '#ff0000', brightGreen: '#00cc00',
    brightYellow: '#ff8800', brightBlue: '#0055ff', brightMagenta: '#cc00cc',
    brightCyan: '#00aaaa', brightWhite: '#ffffff',
  },
  monokai: {
    name: 'Monokai',
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#49483e',
    black: '#272822', red: '#ff5555', green: '#a6e22e', yellow: '#e6db74',
    blue: '#66d9ef', magenta: '#fd5ff0', cyan: '#a0efe0', white: '#d6d6d6',
    brightBlack: '#75715e', brightRed: '#ff6e67', brightGreen: '#b8f23e',
    brightYellow: '#fff280', brightBlue: '#8be9fd', brightMagenta: '#ff7af7',
    brightCyan: '#a2ffe4', brightWhite: '#f8f8f0',
  },
  dracula: {
    name: 'Dracula',
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  nord: {
    name: 'Nord',
    background: '#2e3440', foreground: '#e5e9f0', cursor: '#e5e9f0', selectionBackground: '#434c5e',
    black: '#3b4252', red: '#e64569', green: '#89d351', yellow: '#ebcb8b',
    blue: '#5e81f4', magenta: '#b48ead', cyan: '#5eacd4', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#ff5879', brightGreen: '#8af058',
    brightYellow: '#ffd27a', brightBlue: '#77a0ff', brightMagenta: '#da98e0',
    brightCyan: '#46d4ff', brightWhite: '#eceff4',
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selectionBackground: '#073642',
    black: '#002b36', red: '#dc322f', green: '#718c00', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#073642', brightRed: '#ff4444', brightGreen: '#00bb00',
    brightYellow: '#ffbb00', brightBlue: '#3399ff', brightMagenta: '#ff55cc',
    brightCyan: '#20ddcc', brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    name: 'Solarized Light',
    background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', selectionBackground: '#eee8d5',
    black: '#002b36', red: '#dc322f', green: '#718c00', yellow: '#b58900',
    blue: '#0072ff', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#839496', brightRed: '#ff3333', brightGreen: '#00aa00',
    brightYellow: '#ddaa00', brightBlue: '#0077ff', brightMagenta: '#ff44cc',
    brightCyan: '#00cccc', brightWhite: '#fdf6e3',
  },
  'one-dark': {
    name: 'One Dark',
    background: '#282c34', foreground: '#e0e0e0', cursor: '#528bff', selectionBackground: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#e0e0e0',
    brightBlack: '#545862', brightRed: '#ff7790', brightGreen: '#55e688',
    brightYellow: '#ffbb66', brightBlue: '#44aaff', brightMagenta: '#ee88ff',
    brightCyan: '#33ddff', brightWhite: '#ffffff',
  },
  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selectionBackground: '#504945',
    black: '#282828', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f',
    blue: '#458588', magenta: '#d3869b', cyan: '#83a598', white: '#ebdbb2',
    brightBlack: '#928374', brightRed: '#ff4848', brightGreen: '#c6e600',
    brightYellow: '#ffcc00', brightBlue: '#66bbff', brightMagenta: '#ff88bb',
    brightCyan: '#33ddbb', brightWhite: '#fbf1c7',
  },
}

interface ThemeStore {
  current: string
  theme: TerminalTheme
  setTheme: (name: string) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  current: 'vs-code',
  theme: THEMES['vs-code'],
  setTheme: (name: string) => set({ current: name, theme: THEMES[name] || THEMES['vs-code'] }),
}))
