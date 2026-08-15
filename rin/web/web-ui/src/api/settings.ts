import { api } from './client'
import type { PermissionMode, UserSettings } from '../types/settings'

export type CliLauncherStatus = {
  supported: boolean
  command: string
  installed: boolean
  launcherPath: string
  binDir: string
  pathConfigured: boolean
  pathInCurrentShell: boolean
  availableInNewTerminals: boolean
  needsTerminalRestart: boolean
  configTarget: string | null
  lastError: string | null
}

export type PermissionRuleEntry = {
  source: 'userSettings' | 'projectSettings' | 'localSettings'
  behavior: 'allow' | 'deny' | 'ask'
  ruleString: string
  toolName: string
  ruleContent?: string
}

export type AddPermissionRuleInput = {
  toolName: string
  ruleContent?: string
  behavior: 'allow' | 'deny' | 'ask'
  source: 'userSettings' | 'projectSettings' | 'localSettings'
}

export const settingsApi = {
  getUser() {
    return api.get<UserSettings>('/api/settings/user')
  },

  updateUser(settings: Partial<UserSettings>) {
    return api.put<{ ok: true }>('/api/settings/user', settings)
  },

  getPermissionMode() {
    return api.get<{ mode: PermissionMode }>('/api/permissions/mode')
  },

  setPermissionMode(mode: PermissionMode) {
    return api.put<{ ok: true; mode: PermissionMode }>('/api/permissions/mode', { mode })
  },

  getPermissionRules() {
    return api.get<{ rules: PermissionRuleEntry[] }>('/api/permissions/rules')
  },

  addPermissionRule(input: AddPermissionRuleInput) {
    return api.post<{ ok: true; rule: PermissionRuleEntry }>('/api/permissions/rules', input)
  },

  deletePermissionRule(input: AddPermissionRuleInput) {
    const query = new URLSearchParams({
      toolName: input.toolName,
      behavior: input.behavior,
      source: input.source,
    })
    if (input.ruleContent) query.set('ruleContent', input.ruleContent)
    return api.delete<{ ok: boolean }>(`/api/permissions/rules?${query.toString()}`)
  },

  getCliLauncherStatus() {
    return api.get<CliLauncherStatus>('/api/settings/cli-launcher')
  },
}
