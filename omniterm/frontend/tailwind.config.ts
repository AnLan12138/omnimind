import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // VS Code Dark+ palette
        'vscode-bg': '#1e1e1e',
        'vscode-sidebar': '#252526',
        'vscode-activity': '#333333',
        'vscode-panel': '#1d1d1d',
        'vscode-tab-active': '#1e1e1e',
        'vscode-tab-inactive': '#2d2d2d',
        'vscode-border': '#3c3c3c',
        'vscode-border-light': '#474747',
        'vscode-accent': '#007acc',
        'vscode-accent-hover': '#1a8ad4',
        'vscode-status': '#007acc',
        'vscode-input': '#3c3c3c',
        'vscode-hover': '#2a2d2e',
        'vscode-selection': '#264f78',
        'vscode-text': '#cccccc',
        'vscode-text-light': '#e0e0e0',
        'vscode-text-muted': '#858585',
        'vscode-text-dim': '#6a6a6a',
        'vscode-green': '#4ec9b0',
        'vscode-yellow': '#cca700',
        'vscode-red': '#f44747',
        'vscode-purple': '#c586c0',
        'vscode-blue': '#569cd6',
        'vscode-orange': '#ce9178',
        // Legacy aliases for sub-components
        'bg-primary': '#1e1e1e',
        'bg-secondary': '#252526',
        'bg-tertiary': '#3c3c3c',
        'bg-hover': '#2a2d2e',
        'border': { DEFAULT: '#3c3c3c', light: '#474747' },
        'accent': { DEFAULT: '#007acc', hover: '#1a8ad4', secondary: '#c586c0', green: '#4ec9b0', yellow: '#cca700', red: '#f44747' },
        'text-primary': '#cccccc',
        'text-secondary': '#858585',
        'text-muted': '#6a6a6a',
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "sans-serif"],
        mono: ["Cascadia Code", "Consolas", "JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config
