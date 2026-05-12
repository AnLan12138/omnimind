import React from 'react'
import {createRoot} from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './style.css'
import App from './App'
import { I18nProvider } from './lib/i18n'

const container = document.getElementById('root')

if (container) {
  try {
    const root = createRoot(container)
    root.render(
      <React.StrictMode>
        <I18nProvider>
          <App/>
        </I18nProvider>
      </React.StrictMode>
    )
  } catch (err: any) {
    container.innerHTML = '<div style="color:red;font-family:monospace;padding:20px;background:#111;height:100vh"><h2>Error</h2><pre>' + (err?.message || err) + '</pre></div>'
  }
}
