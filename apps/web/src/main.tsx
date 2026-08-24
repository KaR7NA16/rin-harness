import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './theme/globals.css'
import { initializeTheme } from './stores/uiStore'

const isTauriRuntime = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window || '__TAURI__' in window
)

document.documentElement.setAttribute('data-runtime', isTauriRuntime ? 'tauri' : 'web')
initializeTheme()

const isScreenshotWindow = new URLSearchParams(window.location.search).get('window') === 'screenshot'
if (isScreenshotWindow) {
  document.getElementById('boot-splash')?.remove()
}

const root = ReactDOM.createRoot(document.getElementById('root')!)

function renderRoot(node: React.ReactNode) {
  root.render(<React.StrictMode>{node}</React.StrictMode>)
}

if (isScreenshotWindow) {
  void import('./components/screenshot/ScreenshotOverlay')
    .then(({ ScreenshotOverlay }) => renderRoot(<ScreenshotOverlay />))
    .catch((error) => {
      console.error('[bootstrap] Failed to load screenshot window', error)
      renderRoot(<App />)
    })
} else {
  renderRoot(<App />)
}
