// Source: src/server/api/models.ts, src/server/api/settings.ts

export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'
export type ThemeMode = 'light' | 'dark'

export type ConnectionMode = 'local' | 'remote'

export type ModelInfo = {
  id: string
  name: string
  description: string
  context: string
  contextWindow?: number
}

export type UserSettings = {
  model?: string
  modelContext?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  theme?: ThemeMode
  language?: string
  promptMemoryLanguage?: string
  skipWebFetchPreflight?: boolean
  worktreeEnabled?: boolean
  connectionMode?: ConnectionMode
  /** 用户个性化显示名（覆盖操作系统用户名） */
  displayName?: string
  [key: string]: unknown
}
