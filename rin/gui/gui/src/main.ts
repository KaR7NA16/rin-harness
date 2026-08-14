/**
 * rin GUI frontend bootstrap (placeholder entry).
 *
 * The real UI is the @rin/web-ui SPA, which the WebView loads from the bundled
 * frontendDist (release) or from the rin web-server devUrl (development). When
 * this module does run, it only detects the Tauri runtime and probes the host
 * health endpoint so the placeholder page can report whether the host is up.
 */

import { isTauri } from '@tauri-apps/api/core'

/** The rin web-server health endpoint exposed by the spawned host. */
const HEALTH_URL = 'http://127.0.0.1:8320/api/health'
/** How long the health probe waits before reporting the host as down. */
const PROBE_TIMEOUT_MS = 3000

function statusElement(): HTMLElement | null {
  return document.getElementById('host-status')
}

function setStatus(text: string, bad: boolean): void {
  const element = statusElement()
  if (element === null) return
  element.textContent = text
  element.classList.toggle('bad', bad)
}

async function probeHost(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (isTauri()) {
    setStatus('running inside the Tauri shell…', false)
  } else {
    setStatus('not running inside Tauri (plain browser); the real UI is @rin/web-ui', false)
  }

  if (await probeHost()) {
    setStatus('host is up at ' + HEALTH_URL, false)
  } else {
    setStatus('host is not reachable at ' + HEALTH_URL + ' — start it with "rin web"', true)
  }
}

void main()
