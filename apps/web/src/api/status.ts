import { api } from './client'

export type StatusHealthResponse = {
  status: string
  version: string
  uptime: number
}

export type StatusDiagnosticsResponse = {
  nodeVersion: string
  bunVersion: string
  platform: string
  arch: string
  configDir: string
  memory: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
}

export type StatusUserResponse = {
  configDir: string
  projects: string[]
  username: string
  /** 个性化显示名（settings 未设置时等于 username） */
  displayName?: string
  hostname: string
  homeDir: string
}

export const statusApi = {
  health() {
    return api.get<StatusHealthResponse>('/api/status')
  },

  diagnostics() {
    return api.get<StatusDiagnosticsResponse>('/api/status/diagnostics')
  },

  user() {
    return api.get<StatusUserResponse>('/api/status/user')
  },
}
