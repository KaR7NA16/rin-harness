import { statusApi } from '../api/status'

type VersionSources = {
  server: () => Promise<string>
  desktop: () => Promise<string>
}

const defaultSources: VersionSources = {
  server: async () => (await statusApi.health()).version,
  desktop: async () => (await import('@tauri-apps/api/app')).getVersion(),
}

export async function resolveAboutVersion(sources: VersionSources = defaultSources): Promise<string> {
  try {
    const serverVersion = (await sources.server()).trim()
    if (serverVersion) return serverVersion
  } catch {
    // The source web preview may be opened without a local server.
  }

  try {
    const desktopVersion = (await sources.desktop()).trim()
    if (desktopVersion) return desktopVersion
  } catch {
    // The browser preview does not provide the Tauri app API.
  }

  return 'unknown'
}
