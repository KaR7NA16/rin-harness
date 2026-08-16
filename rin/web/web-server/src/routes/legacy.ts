/**
 * rin web-server — cyberpsychosis-desktop legacy route compatibility.
 *
 * The migrated desktop frontend expects the old cyberpsychosis REST paths.
 * This module maps those paths onto the @rin services already mounted by the
 * host, so the desktop UI can read and write real rin data without changing
 * the frontend's api/ modules. Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { buildPromptMemoryInsights } from '@rin/prompt-memory'
import type { DiscoveryInput, ProviderTestInput } from '@rin/provider-probe'
import type { BrowseInput } from '@rin/filesystem'
import type { Config, JsonResponse, ResponseStyle } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  json,
  notMounted,
  queryParam,
  stringField,
} from '../http.ts'
import type { DshShellLike, RinServiceRefs } from '../routes.ts'

const NOTE_PATH_RE = /^\/api\/notes\/note\/(.+)$/

/**
 * Session ids removed through this host's lifetime. dsh's session store has
 * no public removal API and empty (event-less) sessions have no durable file,
 * so a rin-side tombstone is the only way to make deletion stick for them.
 * In-memory only: on restart empty sessions are gone and durable files are
 * already deleted, so no persistence is needed.
 */
const deletedSessionIds = new Set<string>()

/** Dispatch the legacy desktop paths; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  // Repositories
  if (pathname === '/api/repositories') return repositoriesListRoute(method, body, services)
  if (pathname === '/api/repositories/connect') return repositoriesConnectRoute(method, body, services)
  if (pathname === '/api/repositories/create') return repositoriesCreateRoute(method, body, services)
  if (pathname.startsWith('/api/repositories/')) {
    return repositoriesItemRoute(pathname, search, method, body, services, config)
  }

  // Sessions (legacy desktop REST surface over the mounted dsh session services)
  if (pathname === '/api/sessions') return sessionsListRoute(method, body, services)
  if (pathname === '/api/sessions/recent-projects') return recentProjectsRoute(search, services)
  if (pathname === '/api/sessions/backup') return sessionBackupRoute(method, services)
  if (pathname === '/api/sessions/backups') return sessionBackupsRoute(method, services)
  if (pathname === '/api/sessions/backup/restore') return sessionBackupRestoreRoute(method, body, services)
  if (pathname === '/api/sessions/backup-settings') return sessionBackupSettingsRoute(method, body, services)
  const sessionMatch = /^\/api\/sessions\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (sessionMatch !== null && sessionMatch[1] !== undefined) {
    return sessionsItemRoute(sessionMatch[1], sessionMatch[3], search, method, body, services)
  }

  // Notes (legacy desktop paths)
  if (pathname === '/api/notes/list') return notesListRoute(services)
  if (pathname === '/api/notes/search') return notesSearchRoute(search, services)
  if (pathname === '/api/notes/graph') return notesGraphRoute(services)
  if (pathname === '/api/notes/todos') return notesTodosRoute(services)
  if (pathname === '/api/notes/templates') return notesTemplatesRoute(services)
  if (pathname === '/api/notes/from-template') return notesFromTemplateRoute(method, body, services)
  if (pathname === '/api/notes/export') return notesExportRoute(search, services)
  if (pathname === '/api/notes/move') return notesMoveRoute(method, body, services)
  if (pathname === '/api/notes/daily') return notesDailyRoute(method, services)
  if (pathname === '/api/notes/backlinks') return notesBacklinksRoute(search, services)
  if (pathname === '/api/notes/snapshots') return notesSnapshotsRoute(search, services)
  if (pathname === '/api/notes/snapshot') return notesSnapshotRoute(search, services)
  const notePath = NOTE_PATH_RE.exec(pathname)
  if (notePath !== null && notePath[1] !== undefined) {
    return notesNoteRoute(notePath[1], method, body, services)
  }

  // Prompt memory (legacy desktop paths)
  if (pathname === '/api/prompt-memory') return promptMemoryStatusRoute(services)
  if (pathname === '/api/prompt-memory/logs') return promptMemoryLogsRoute(search, services)
  if (pathname === '/api/prompt-memory/insights') return promptMemoryInsightsRoute(services)
  const promptMemoryFile = /^\/api\/prompt-memory\/(soul|brief|user)$/.exec(pathname)
  if (promptMemoryFile !== null && promptMemoryFile[1] !== undefined) {
    return promptMemoryFileRoute(promptMemoryFile[1], method, body, services)
  }

  // Search (legacy desktop path backed by @rin/session-search)
  if (pathname === '/api/search/sessions') return searchSessionsRoute(method, body, services)

  // Skills (legacy desktop path backed by @rin/skill-memory)
  if (pathname === '/api/skills') return skillsListRoute(services, config)
  if (pathname === '/api/skills/config') return skillsConfigRoute(config)
  if (pathname === '/api/skills/open-config') return notImplemented(method, 'opening the skills config directory is a desktop-only action')

  // Token optimization (legacy desktop paths backed by the two @rin knobs)
  if (pathname.startsWith('/api/token-optimization/')) {
    return tokenOptimizationRoute(pathname, search, method, body, services)
  }

  // Sandboxes (legacy desktop paths over @rin/sandboxes)
  if (pathname === '/api/sandboxes/profiles') return sandboxesProfilesRoute(method, body, services)
  if (pathname === '/api/sandboxes/runtime') return json(200, { runtime: null, version: null })
  if (pathname === '/api/sandboxes/stats') return json(200, { stats: [] })
  if (pathname === '/api/sandboxes/default') return sandboxesDefaultRoute(method, body, services)
  const sandboxItem = /^\/api\/sandboxes\/profile\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (sandboxItem !== null && sandboxItem[1] !== undefined) {
    return sandboxesItemRoute(sandboxItem[1], sandboxItem[3], method, body, services, config)
  }

  // Agents (legacy desktop paths over @rin/agents)
  if (pathname === '/api/agents') return agentsListRoute(search, services, config)
  const agentProposal = /^\/api\/agents\/repositories\/([^/]+)\/proposals(?:\/([^/]+)\/(approve|reject))?$/.exec(pathname)
  if (agentProposal !== null && agentProposal[1] !== undefined) {
    return agentProposalRoute(agentProposal[1], agentProposal[2], agentProposal[3], method, body, services)
  }
  const agentRepo = /^\/api\/agents\/repositories\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (agentRepo !== null && agentRepo[1] !== undefined) {
    return agentsRepositoryRoute(agentRepo[1], agentRepo[3], method, body, services, config)
  }

  // Settings / models / providers minimal compatibility
  if (pathname === '/api/settings/user') return settingsUserRoute(method, body)
  if (pathname === '/api/settings/cli-launcher') return cliLauncherRoute(method)
  if (pathname === '/api/permissions/mode') return permissionsModeRoute(method, body, services)
  if (pathname === '/api/permissions/rules') return permissionsRulesRoute(method, body, search)
  if (pathname === '/api/models') return modelsRoute(services)
  if (pathname === '/api/models/current') return modelsCurrentRoute(method, body, services)
  if (pathname === '/api/effort') return effortRoute(method, body, services)
  if (pathname === '/api/status') return statusRoute()
  if (pathname === '/api/adapters') return adaptersRoute(method, body)
  if (pathname === '/api/providers') return providersRoute(method, body)
  if (pathname === '/api/providers/presets') return json(200, { presets: PROVIDER_PRESETS })
  if (pathname === '/api/providers/auth-status') return authStatusRoute(services)
  if (pathname === '/api/providers/settings') return providersSettingsRoute(method, body)
  if (pathname === '/api/providers/official') return providersOfficialRoute(method, body)
  if (pathname === '/api/providers/test') return providersTestRoute(method, body, services)
  if (pathname === '/api/providers/models/discover') return providersDiscoverRoute(method, body, services)
  const providerItem = /^\/api\/providers\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (providerItem !== null && providerItem[1] !== undefined) {
    return providerItemRoute(providerItem[1], providerItem[3], method, body, services)
  }
  if (pathname === '/api/mcp') return mcpListRoute(method, body, services)
  const mcpItem = /^\/api\/mcp\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (mcpItem !== null && mcpItem[1] !== undefined) {
    return mcpItemRoute(decodeURIComponent(mcpItem[1]), mcpItem[3], method, body, services)
  }

  // A-class automation/collaboration surfaces over the new @rin services.
  if (pathname === '/api/teams') return teamsListRoute(method, services)
  const teamsItem = /^\/api\/teams\/([^/]+)(?:\/members\/([^/]+)\/(transcript|messages))?$/.exec(pathname)
  if (teamsItem !== null && teamsItem[1] !== undefined) {
    return teamsItemRoute(decodeURIComponent(teamsItem[1]), teamsItem[2] === undefined ? undefined : decodeURIComponent(teamsItem[2]), teamsItem[3], method, body, services)
  }
  if (pathname === '/api/tasks') return tasksRoute(method, services)
  if (pathname === '/api/tasks/lists') return taskListsRoute(method, services)
  const taskListItem = /^\/api\/tasks\/lists\/([^/]+)(?:\/([^/]+))?$/.exec(pathname)
  if (taskListItem !== null && taskListItem[1] !== undefined) {
    return taskListItemRoute(decodeURIComponent(taskListItem[1]), taskListItem[2] === undefined ? undefined : decodeURIComponent(taskListItem[2]), method, services)
  }
  if (pathname === '/api/computer-use/status') return computerUseStatusRoute(services)
  if (pathname === '/api/computer-use/apps') return computerUseAppsRoute(services)
  if (pathname === '/api/computer-use/authorized-apps') return computerUseAuthorizedAppsRoute(method, body, services)
  if (pathname === '/api/computer-use/setup') return computerUseSetupRoute(method)
  if (pathname === '/api/computer-use/open-settings') return computerUseOpenSettingsRoute(method)
  if (pathname === '/api/agent-migration/scan' || pathname === '/api/agent-migration') return agentMigrationRoute(services)
  if (pathname === '/api/agent-migration/migrate') return agentMigrationMigrateRoute(method, body, services)
  const migrationItem = /^\/api\/agent-migration\/items\/([^/]+)$/.exec(pathname)
  if (migrationItem !== null && migrationItem[1] !== undefined) {
    return agentMigrationPreviewRoute(migrationItem[1], search, services)
  }
  if (pathname === '/api/status/diagnostics') {
    return json(200, {
      nodeVersion: process.version,
      bunVersion: null,
      platform: process.platform,
      arch: process.arch,
      configDir: process.env.RIN_HOME ?? join(homedir(), '.rin'),
      memory: { rss: 0, heapUsed: 0, heapTotal: 0 },
    })
  }
  if (pathname === '/api/status/user') {
    return json(200, {
      configDir: process.env.RIN_HOME ?? join(homedir(), '.rin'),
      projects: [],
      username: 'rin',
      displayName: 'rin',
      hostname: 'localhost',
      homeDir: homedir(),
    })
  }

  // Features the migrated frontend calls that have no @rin backend service yet.
  // Return an explicit 501 so the UI reports "not available" instead of a bare 404.
  if (pathname === '/api/plugins') return pluginsListRoute(method, services)
  if (pathname === '/api/plugins/detail') return pluginsDetailRoute(search, services)
  if (pathname === '/api/plugins/enable' || pathname === '/api/plugins/disable') return pluginsSetEnabledRoute(pathname, method, body, services)
  if (pathname === '/api/filesystem/browse') return filesystemBrowseRoute(search, services)
  if (pathname === '/api/sessions/export' || pathname === '/api/sessions/import'
    || pathname === '/api/sessions/project-folders') {
    return notImplemented(method, 'session export/import (raw binary) is not implemented on this host yet')
  }

  if (pathname === '/api/notes/assets') {
    return notImplemented(method, 'note asset upload is not implemented on this host')
  }
  return null
}


/* --------------------------- sandboxes legacy --------------------------- */

const legacyInstallRuns = new Map<string, Array<Record<string, unknown>>>()

async function sandboxesProfilesRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  try {
    if (method === 'GET') return json(200, { profiles: await sandboxes.list() })
    if (method === 'POST') {
      const fields = asRecord(body)
      const name = fields === undefined ? undefined : stringField(fields, 'name')
      const type = fields === undefined ? undefined : stringField(fields, 'type')
      if (name === undefined || type === undefined) return error(400, 'name and type are required')
      const input: Record<string, unknown> = {
        name,
        type: type === 'container' || type === 'remote' || type === 'local-sandbox' ? type : 'local-sandbox',
      }
      if (fields?.['isDefault'] === true) input['isDefault'] = true
      if (fields?.['repositoryId'] !== undefined) input['repositoryId'] = stringField(fields, 'repositoryId')
      if (fields?.['repositoryPath'] !== undefined) input['repositoryPath'] = stringField(fields, 'repositoryPath')
      if (fields?.['environmentProfileId'] !== undefined) input['environmentProfileId'] = stringField(fields, 'environmentProfileId')
      if (fields?.['container'] !== undefined) input['container'] = fields['container']
      if (fields?.['remote'] !== undefined) input['remote'] = fields['remote']
      return json(200, await sandboxes.create(input as never))
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sandboxesDefaultRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const id = fields === undefined ? undefined : stringField(fields, 'id')
  if (id === undefined) return error(400, 'id is required')
  try {
    await sandboxes.setDefault(id)
    return json(200, { ok: true })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sandboxesItemRoute(
  rawId: string,
  action: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return error(400, 'invalid sandbox id')
  }
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  try {
    if (action === undefined) {
      if (method === 'PUT') {
        const fields = asRecord(body)
        if (fields === undefined) return error(400, 'request body must be a JSON object')
        const { id: _ignored, createdAt: _created, updatedAt: _updated, name, type, ...rest } = fields
        void _ignored; void _created; void _updated
        const patch: Record<string, unknown> = { ...rest }
        if (name !== undefined) patch['name'] = name
        if (type !== undefined) patch['type'] = type
        return json(200, await sandboxes.update(id, patch as never))
      }
      if (method === 'DELETE') return json(200, { removed: await sandboxes.remove(id) })
      return error(405, 'method not allowed')
    }
    if (action === 'state') return json(200, { exists: (await sandboxes.get(id)) !== null, running: false })
    if (action === 'start' || action === 'stop' || action === 'exec' || action === 'test' || action === 'interactive-command') {
      return error(501, 'sandbox ' + action + ' is not available for local-sandbox profiles yet')
    }
    if (action === 'prepare-environment') {
      if (method !== 'POST') return error(405, 'method not allowed')
      const profile = await sandboxes.get(id)
      if (profile === null) return error(404, 'sandbox profile not found')
      const environment = services.environment()
      if (environment === undefined) return error(500, 'environment service is not mounted')
      const repositoryRoot = config.repositoryRoot
      if (repositoryRoot === undefined) return error(500, 'repository root is not configured')
      const environmentProfileId = profile.environmentProfileId ?? 'scientific-base'
      const capabilities = await sandboxes.probeCapabilities(profile)
      const plan = await environment.plan(repositoryRoot, environmentProfileId, capabilities)
      // The legacy prepare flow already implies approval; the shared executor
      // requires the flag so no caller can auto-approve a plan it resolves.
      const run = await sandboxes.executeEnvironmentPlan(profile, profile.repositoryId ?? 'builtin', environmentProfileId, plan, { approve: true })
      const runs = legacyInstallRuns.get(id) ?? []
      runs.push(run as unknown as Record<string, unknown>)
      legacyInstallRuns.set(id, runs)
      return json(200, run)
    }
    if (action === 'environment-runs') {
      return json(200, { runs: legacyInstallRuns.get(id) ?? [] })
    }
    if (action === 'approve-environment') {
      return error(501, 'environment execution is direct; the run is already approved after prepare')
    }
    return error(404, 'unknown sandbox action')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* ----------------------------- agents legacy ----------------------------- */

async function agentProposalRoute(
  repositoryId: string,
  proposalId: string | undefined,
  action: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  try {
    if (proposalId !== undefined && action !== undefined) {
      if (method !== 'POST') return error(405, 'method not allowed')
      if (action === 'approve') {
        const fields = asRecord(body)
        const acknowledge = fields?.['acknowledgeBypassRisk'] === true
        return json(200, { proposal: await agents.approveProposal(proposalId, { acknowledgeBypassRisk: acknowledge }) })
      }
      return json(200, { proposal: await agents.rejectProposal(proposalId) })
    }
    if (method === 'GET') return json(200, { proposals: await agents.listProposals(repositoryId) })
    if (method === 'POST') {
      const fields = asRecord(body)
      if (fields === undefined) return error(400, 'request body must be a JSON object')
      const instructions = stringField(fields, 'instructions')
      if (instructions === undefined) return error(400, 'instructions is required')
      const request: { instructions: string; currentName?: string } = { instructions }
      const currentName = fields['currentName'] === undefined ? undefined : stringField(fields, 'currentName')
      if (currentName !== undefined) request.currentName = currentName
      const proposal = await agents.prepareProposal(repositoryId, request)
      return json(200, { proposal })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsListRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  const root = queryParam(search, 'repositoryId') ?? config.repositoryRoot
  if (root === undefined) return json(200, { activeAgents: [], allAgents: [] })
  try {
    const records = await agents.listRepositoryAgents(root)
    const definitions = records.map(record => ({
      agentType: record.name,
      description: record.description,
      model: record.model,
      tools: record.tools,
      systemPrompt: record.systemPrompt,
      source: 'repository',
      repositoryRoot: root,
      isActive: true,
    }))
    return json(200, { activeAgents: definitions, allAgents: definitions })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsRepositoryRoute(
  rawRepositoryId: string,
  rawName: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  let repositoryId: string
  let name: string | undefined
  try {
    repositoryId = decodeURIComponent(rawRepositoryId)
    name = rawName === undefined ? undefined : decodeURIComponent(rawName)
  } catch {
    return error(400, 'invalid agent locator')
  }
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  const root = repositoryId === 'builtin' || repositoryId === 'default' ? config.repositoryRoot : repositoryId
  if (root === undefined) return error(500, 'repository root is not configured')

  try {
    if (name === undefined) {
      if (method === 'GET') {
        const records = await agents.listRepositoryAgents(root)
        return json(200, { agents: records })
      }
      if (method === 'POST') {
        const fields = asRecord(body)
        if (fields === undefined) return error(400, 'request body must be a JSON object')
        const input: Record<string, unknown> = {
          name: stringField(fields, 'name') ?? '',
          description: stringField(fields, 'description') ?? '',
          systemPrompt: stringField(fields, 'systemPrompt') ?? '',
          tools: Array.isArray(fields['tools']) ? fields['tools'].filter((value): value is string => typeof value === 'string') : [],
        }
        if (fields['model'] !== undefined) input['model'] = stringField(fields, 'model')
        if (fields['permissionMode'] !== undefined) input['permissionMode'] = fields['permissionMode']
        if (fields['resources'] !== undefined) input['resources'] = fields['resources']
        return json(200, await agents.createRepositoryAgent(root, input as never))
      }
      return error(405, 'method not allowed')
    }

    if (method === 'PUT') {
      const fields = asRecord(body)
      if (fields === undefined) return error(400, 'request body must be a JSON object')
      const input: Record<string, unknown> = {
        description: stringField(fields, 'description') ?? '',
        systemPrompt: stringField(fields, 'systemPrompt') ?? '',
        tools: Array.isArray(fields['tools']) ? fields['tools'].filter((value): value is string => typeof value === 'string') : [],
      }
      if (fields['model'] !== undefined) input['model'] = stringField(fields, 'model')
      if (fields['permissionMode'] !== undefined) input['permissionMode'] = fields['permissionMode']
      if (fields['resources'] !== undefined) input['resources'] = fields['resources']
      return json(200, await agents.updateRepositoryAgent(root, name, input as never))
    }
    if (method === 'DELETE') {
      await agents.deleteRepositoryAgent(root, name)
      return json(200, { ok: true })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}


/* ------------------------- providers legacy --------------------------- */

const DEFAULT_PROVIDER_PRESETS = [
  {
    id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiFormat: 'openai_chat',
    defaultModels: { main: 'deepseek-v4-flash', haiku: 'deepseek-v4-flash', sonnet: 'deepseek-v4-pro', opus: 'deepseek-v4-pro' },
    defaultModelContextWindows: {}, modelOptions: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
    supportsImages: false, needsApiKey: true, websiteUrl: 'https://platform.deepseek.com', apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiFormat: 'openai_chat',
    defaultModels: { main: 'gpt-4.1', haiku: 'gpt-4.1-mini', sonnet: 'gpt-4.1', opus: 'gpt-4.1' },
    defaultModelContextWindows: {}, modelOptions: [], supportsImages: false, needsApiKey: true, websiteUrl: 'https://platform.openai.com',
  },
  {
    id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiFormat: 'anthropic',
    defaultModels: { main: 'claude-sonnet-4', haiku: 'claude-haiku-4', sonnet: 'claude-sonnet-4', opus: 'claude-opus-4' },
    defaultModelContextWindows: {}, modelOptions: [], supportsImages: false, needsApiKey: true, websiteUrl: 'https://console.anthropic.com',
  },
  {
    id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434', apiFormat: 'openai_chat',
    defaultModels: { main: 'llama3', haiku: 'llama3', sonnet: 'llama3', opus: 'llama3' },
    defaultModelContextWindows: {}, modelOptions: [], supportsImages: false, needsApiKey: false, websiteUrl: 'https://ollama.com',
  },
] as const

const PROVIDER_PRESETS = DEFAULT_PROVIDER_PRESETS

function providerStorePath(): string {
  const home = process.env.RIN_HOME ?? join(homedir(), '.rin')
  return join(home, 'providers.json')
}

async function readProviderStore(): Promise<{ activeId: string | null; providers: Array<Record<string, unknown>> }> {
  try {
    const parsed = JSON.parse(await readFile(providerStorePath(), 'utf-8')) as { activeId?: string | null; providers?: Array<Record<string, unknown>> }
    return { activeId: parsed.activeId ?? null, providers: Array.isArray(parsed.providers) ? parsed.providers : [] }
  } catch {
    return { activeId: null, providers: [] }
  }
}

async function writeProviderStore(store: { activeId: string | null; providers: Array<Record<string, unknown>> }): Promise<void> {
  const path = providerStorePath()
  await mkdir(join(path, '..').replace(/\\/g, '/'), { recursive: true }).catch(() => {})
  await writeFile(path, JSON.stringify(store, null, 2))
}

function maskedApiKey(record: Record<string, unknown>): Record<string, unknown> {
  const apiKey = typeof record['apiKey'] === 'string' ? record['apiKey'] : ''
  return { ...record, apiKey: apiKey === '' ? '' : apiKey.slice(0, 6) + '••••••' }
}

async function providersSettingsRoute(method: string, body: unknown): Promise<JsonResponse> {
  const path = join(rinConfigDir(), 'providers-settings.json')
  if (method === 'GET') {
    try {
      return json(200, JSON.parse(await readFile(path, 'utf-8')))
    } catch {
      return json(200, {})
    }
  }
  if (method === 'PUT') {
    const fields = asRecord(body)
    if (fields === undefined) return error(400, 'request body must be a JSON object')
    await mkdir(dirname(path), { recursive: true }).catch(() => {})
    await writeFile(path, JSON.stringify(fields, null, 2))
    return json(200, { ok: true })
  }
  return error(405, 'method not allowed')
}

async function providersOfficialRoute(method: string, body: unknown): Promise<JsonResponse> {
  void body
  if (method !== 'POST') return error(405, 'method not allowed')
  try {
    const store = await readProviderStore()
    store.activeId = null
    await writeProviderStore(store)
    return json(200, { ok: true })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function providersTestRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const probe = services.providerProbe()
  if (probe === undefined) return notMounted()
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const baseUrl = stringField(fields, 'baseUrl')
  const modelId = stringField(fields, 'modelId')
  if (baseUrl === undefined || modelId === undefined) return error(400, 'baseUrl and modelId are required')
  const apiFormat = fields['apiFormat'] === 'openai_chat' || fields['apiFormat'] === 'openai_responses'
    ? fields['apiFormat']
    : 'anthropic'
  try {
    const input: ProviderTestInput = {
      baseUrl,
      apiKey: stringField(fields, 'apiKey') ?? '',
      modelId,
      apiFormat,
    }
    const models = fields['models'] === undefined ? undefined : providerModelsFromRecord(asRecord(fields['models']))
    if (models !== undefined) input.models = models
    const presetId = fields['presetId'] === undefined ? undefined : stringField(fields, 'presetId')
    if (presetId !== undefined) input.presetId = presetId
    return json(200, { result: await probe.test(input) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function providersDiscoverRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const probe = services.providerProbe()
  if (probe === undefined) return notMounted()
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const baseUrl = stringField(fields, 'baseUrl')
  if (baseUrl === undefined) return error(400, 'baseUrl is required')
  try {
    const input: DiscoveryInput = {
      baseUrl,
      apiFormat: fields['apiFormat'] === 'openai_chat' || fields['apiFormat'] === 'openai_responses' ? fields['apiFormat'] : 'anthropic',
    }
    const apiKey = fields['apiKey'] === undefined ? undefined : stringField(fields, 'apiKey')
    if (apiKey !== undefined) input.apiKey = apiKey
    const presetId = fields['presetId'] === undefined ? undefined : stringField(fields, 'presetId')
    if (presetId !== undefined) input.presetId = presetId
    return json(200, { result: await probe.discover(input) })
  } catch (err) {
    return error(502, errorMessage(err))
  }
}

/** Project a saved provider's models record into the probe's ModelMapping. */
function providerModelsFromRecord(value: Record<string, unknown> | undefined): { main: string; haiku: string; sonnet: string; opus: string } {
  const pick = (key: string): string => (typeof value?.[key] === 'string' ? value[key] as string : '')
  return { main: pick('main'), haiku: pick('haiku'), sonnet: pick('sonnet'), opus: pick('opus') }
}

async function providersRoute(method: string, body: unknown): Promise<JsonResponse> {
  try {
    const store = await readProviderStore()
    if (method === 'GET') {
      return json(200, { providers: store.providers.map(maskedApiKey), activeId: store.activeId })
    }
    if (method === 'POST') {
      const fields = asRecord(body)
      if (fields === undefined) return error(400, 'request body must be a JSON object')
      const name = stringField(fields, 'name') ?? 'Provider'
      const presetId = stringField(fields, 'presetId') ?? 'openai'
      const now = new Date().toISOString()
      const provider: Record<string, unknown> = {
        id: crypto.randomUUID(),
        presetId,
        name,
        apiKey: stringField(fields, 'apiKey') ?? '',
        baseUrl: stringField(fields, 'baseUrl') ?? '',
        apiFormat: stringField(fields, 'apiFormat') ?? 'openai_chat',
        models: fields['models'] ?? { main: '', haiku: '', sonnet: '', opus: '' },
        ...(fields['modelCatalog'] !== undefined ? { modelCatalog: fields['modelCatalog'] } : {}),
        ...(fields['modelContextWindows'] !== undefined ? { modelContextWindows: fields['modelContextWindows'] } : {}),
        ...(fields['imageSupportMode'] !== undefined ? { imageSupportMode: fields['imageSupportMode'] } : {}),
        ...(fields['notes'] !== undefined ? { notes: fields['notes'] } : {}),
        createdAt: now,
        updatedAt: now,
      }
      store.providers.push(provider)
      await writeProviderStore(store)
      return json(200, { provider: maskedApiKey(provider) })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function providerItemRoute(
  rawId: string,
  action: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return error(400, 'invalid provider id')
  }
  try {
    const store = await readProviderStore()
    const index = store.providers.findIndex(provider => provider['id'] === id)
    if (index < 0) return error(404, 'provider not found')

    if (action === 'activate') {
      if (method !== 'POST') return error(405, 'method not allowed')
      store.activeId = id
      await writeProviderStore(store)
      return json(200, { ok: true })
    }
    if (action === 'test') {
      if (method !== 'POST') return error(405, 'method not allowed')
      const current = store.providers[index]!
      const overrides = asRecord(body)
      const baseUrl = (overrides === undefined ? undefined : stringField(overrides, 'baseUrl'))
        ?? stringField(current, 'baseUrl') ?? ''
      const models = providerModelsFromRecord(asRecord(current['models']))
      const modelId = (overrides === undefined ? undefined : stringField(overrides, 'modelId')) ?? models.main
      const apiFormat = (overrides?.['apiFormat'] as string | undefined)
        ?? (typeof current['apiFormat'] === 'string' ? current['apiFormat'] as string : 'anthropic')
      const probe = services.providerProbe()
      if (probe === undefined) return notMounted()
      const input: ProviderTestInput = {
        baseUrl,
        apiKey: typeof current['apiKey'] === 'string' ? current['apiKey'] : '',
        modelId,
        models,
        apiFormat: apiFormat === 'openai_chat' || apiFormat === 'openai_responses' ? apiFormat : 'anthropic',
      }
      if (typeof current['presetId'] === 'string') input.presetId = current['presetId']
      return json(200, { result: await probe.test(input) })
    }

    if (method === 'PUT') {
      const fields = asRecord(body)
      if (fields === undefined) return error(400, 'request body must be a JSON object')
      const current = store.providers[index]!
      for (const key of ['name', 'apiKey', 'baseUrl', 'apiFormat', 'models', 'modelCatalog', 'modelContextWindows', 'imageSupportMode', 'supportsImages', 'notes']) {
        if (fields[key] !== undefined) current[key] = fields[key]
      }
      current['updatedAt'] = new Date().toISOString()
      store.providers[index] = current
      await writeProviderStore(store)
      return json(200, { provider: maskedApiKey(current) })
    }
    if (method === 'DELETE') {
      store.providers.splice(index, 1)
      if (store.activeId === id) store.activeId = null
      await writeProviderStore(store)
      return json(200, { ok: true })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* ---------------------- settings/models/providers ---------------------- */

/* ---------------------- rin settings file store ---------------------- */

interface RinSettingsFile {
  user: Record<string, unknown>
  permissionMode: string
  permissionRules: Array<Record<string, unknown>>
  effort: string
  currentModelId: string | null
}

const VALID_EFFORT_LEVELS = ['low', 'medium', 'high', 'max']

function rinConfigDir(): string {
  return process.env.RIN_HOME ?? join(homedir(), '.rin')
}

function settingsFilePath(): string {
  return join(rinConfigDir(), 'settings.json')
}

async function readSettingsFile(): Promise<RinSettingsFile> {
  try {
    const parsed = JSON.parse(await readFile(settingsFilePath(), 'utf-8')) as Partial<RinSettingsFile>
    return {
      user: asRecord(parsed.user) ?? {},
      permissionMode: typeof parsed.permissionMode === 'string' ? parsed.permissionMode : 'default',
      permissionRules: Array.isArray(parsed.permissionRules) ? parsed.permissionRules : [],
      effort: typeof parsed.effort === 'string' ? parsed.effort : 'medium',
      currentModelId: typeof parsed.currentModelId === 'string' ? parsed.currentModelId : null,
    }
  } catch {
    return { user: {}, permissionMode: 'default', permissionRules: [], effort: 'medium', currentModelId: null }
  }
}

async function writeSettingsFile(store: RinSettingsFile): Promise<void> {
  const path = settingsFilePath()
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  await writeFile(path, JSON.stringify(store, null, 2))
}

async function settingsUserRoute(method: string, body: unknown): Promise<JsonResponse> {
  if (method === 'GET') return json(200, (await readSettingsFile()).user)
  if (method === 'PUT') {
    const fields = asRecord(body)
    if (fields === undefined) return error(400, 'request body must be a JSON object')
    const store = await readSettingsFile()
    store.user = { ...store.user, ...fields }
    await writeSettingsFile(store)
    return json(200, { ok: true })
  }
  return error(405, 'method not allowed')
}

const PERMISSION_NAMESPACE = 'permission'
const PERMISSION_PRESETS_FALLBACK = ['read-only', 'workspace-write', 'danger-full-access']

async function permissionsModeRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const presets = services.permissionPresets()
  const settings = services.settings()
  if (method === 'GET') {
    if (presets === undefined) return json(200, { mode: 'workspace-write', available: PERMISSION_PRESETS_FALLBACK })
    return json(200, { mode: presets.defaultPreset, available: [...presets.names] })
  }
  if (method === 'PUT') {
    const fields = asRecord(body)
    const mode = fields === undefined ? undefined : stringField(fields, 'mode')
    if (mode === undefined) return error(400, 'mode is required')
    if (presets !== undefined && !presets.names.includes(mode)) return error(400, 'invalid permission mode')
    if (settings === undefined) return error(500, 'settings service is not mounted')
    try {
      await settings.update(PERMISSION_NAMESPACE, { defaultPreset: mode })
      return json(200, { ok: true, mode })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  return error(405, 'method not allowed')
}

async function permissionsRulesRoute(method: string, body: unknown, search: string): Promise<JsonResponse> {
  const store = await readSettingsFile()
  if (method === 'GET') return json(200, { rules: store.permissionRules })
  if (method === 'POST') {
    const fields = asRecord(body)
    if (fields === undefined) return error(400, 'request body must be a JSON object')
    const behavior = fields['behavior'] === 'allow' || fields['behavior'] === 'deny' || fields['behavior'] === 'ask'
      ? fields['behavior']
      : 'ask'
    const source = fields['source'] === 'projectSettings' || fields['source'] === 'localSettings'
      ? fields['source']
      : 'userSettings'
    const toolName = stringField(fields, 'toolName') ?? ''
    const ruleContent = stringField(fields, 'ruleContent')
    const rule: Record<string, unknown> = {
      source,
      behavior,
      ruleString: ruleContent ?? toolName,
      toolName,
      ...(ruleContent !== undefined ? { ruleContent } : {}),
    }
    store.permissionRules.push(rule)
    await writeSettingsFile(store)
    return json(200, { ok: true, rule })
  }
  if (method === 'DELETE') {
    const toolName = queryParam(search, 'toolName') ?? ''
    const behavior = queryParam(search, 'behavior') ?? ''
    const source = queryParam(search, 'source') ?? ''
    store.permissionRules = store.permissionRules.filter(rule =>
      !(rule['toolName'] === toolName && rule['behavior'] === behavior && rule['source'] === source))
    await writeSettingsFile(store)
    return json(200, { ok: true })
  }
  return error(405, 'method not allowed')
}

async function effortRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const defaultModel = services.agentDefaultModel()
  if (defaultModel === undefined) return error(404, 'no default model service mounted')
  if (method === 'GET') return json(200, { level: defaultModel.currentSelection().reasoningEffort ?? 'medium', available: VALID_EFFORT_LEVELS })
  if (method === 'PUT') {
    const fields = asRecord(body)
    const level = fields === undefined ? 'medium' : stringField(fields, 'level') ?? 'medium'
    if (!VALID_EFFORT_LEVELS.includes(level)) return error(400, 'invalid effort level')
    const current = defaultModel.currentSelection()
    try {
      await defaultModel.saveSelection({ provider: current.provider, model: current.model, reasoningEffort: level })
      return json(200, { ok: true, level })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  return error(405, 'method not allowed')
}

function skillsConfigRoute(config: Config): JsonResponse {
  const roots = config.skillMemoryRoots
  if (roots === undefined) return json(200, { config: { userSkillsDir: '', displayPath: '' } })
  const dir = join(roots.globalConfigRoot, 'skill-memory')
  return json(200, { config: { userSkillsDir: dir, displayPath: dir } })
}

/** Honest 501 for a frontend feature the @rin backend does not implement yet. */
function notImplemented(_method: string, message: string): JsonResponse {
  return error(501, message)
}

async function filesystemBrowseRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const filesystem = services.filesystem()
  if (filesystem === undefined) return notMounted()
  const input: BrowseInput = { includeFiles: queryParam(search, 'includeFiles') === 'true' }
  const path = queryParam(search, 'path')
  if (path !== undefined) input.path = path
  const searchQuery = queryParam(search, 'search')
  if (searchQuery !== undefined) input.search = searchQuery
  const rawMax = Number(queryParam(search, 'maxResults') ?? '200')
  if (Number.isFinite(rawMax)) input.maxResults = rawMax
  try {
    return json(200, await filesystem.browse(input))
  } catch (err) {
    const message = errorMessage(err)
    if (message.includes('Access denied')) return error(403, message)
    if (message.includes('Not a directory')) return error(400, message)
    return error(500, message)
  }
}

async function sessionBackupRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  const backup = services.sessionBackup()
  if (backup === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  try {
    return json(200, { ok: true, backup: await backup.runBackup() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sessionBackupsRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  const backup = services.sessionBackup()
  if (backup === undefined) return notMounted()
  if (method !== 'GET') return error(405, 'method not allowed')
  try {
    return json(200, { backups: await backup.listBackups() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sessionBackupRestoreRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const backup = services.sessionBackup()
  if (backup === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const name = fields === undefined ? undefined : stringField(fields, 'name')
  if (name === undefined) return error(400, 'name is required')
  try {
    return json(200, await backup.restoreBackup(name))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

async function sessionBackupSettingsRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const backup = services.sessionBackup()
  if (backup === undefined) return notMounted()
  if (method === 'GET') {
    try {
      return json(200, { settings: await backup.getSettings() })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  if (method === 'PUT') {
    const fields = asRecord(body)
    const settings = fields === undefined ? undefined : asRecord(fields['settings'])
    try {
      return json(200, { settings: await backup.updateSettings(settings ?? {}) })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  return error(405, 'method not allowed')
}

function statusRoute(): JsonResponse {
  return json(200, { status: 'ok', version: '0.1.0', uptime: Math.round(process.uptime()) })
}

async function adaptersRoute(method: string, body: unknown): Promise<JsonResponse> {
  const path = join(rinConfigDir(), 'adapters.json')
  if (method === 'GET') {
    try {
      return json(200, JSON.parse(await readFile(path, 'utf-8')))
    } catch {
      return json(200, {})
    }
  }
  if (method === 'PUT') {
    const fields = asRecord(body)
    if (fields === undefined) return error(400, 'request body must be a JSON object')
    await mkdir(dirname(path), { recursive: true }).catch(() => {})
    await writeFile(path, JSON.stringify(fields, null, 2))
    return json(200, fields)
  }
  return error(405, 'method not allowed')
}

async function cliLauncherRoute(method: string): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const binDir = join(homedir(), '.local', 'bin')
  const launcherPath = join(binDir, 'rin')
  let installed = false
  try {
    await access(launcherPath)
    installed = true
  } catch {
    // Launcher not present is a normal, reportable state.
  }
  return json(200, {
    supported: true,
    command: 'rin',
    installed,
    launcherPath,
    binDir,
    pathConfigured: false,
    pathInCurrentShell: false,
    availableInNewTerminals: installed,
    needsTerminalRestart: false,
    configTarget: installed ? launcherPath : null,
    lastError: installed ? null : 'rin CLI launcher is not installed',
  })
}

async function modelsRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const llm = services.llm()
  if (llm === undefined) return json(200, { models: [], provider: null })
  try {
    const provider = llm.listProviders()[0]
    if (provider === undefined) return json(200, { models: [], provider: null })
    const models = await llm.listModels(provider.id)
    return json(200, {
      models: models.map(model => ({
        id: model.id,
        name: model.name,
        description: '',
        context: '0',
      })),
      provider: { id: provider.id, name: provider.name },
    })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function modelsCurrentRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const defaultModel = services.agentDefaultModel()
  const llm = services.llm()
  if (defaultModel === undefined) return error(404, 'no default model service mounted')

  if (method === 'PUT') {
    const fields = asRecord(body)
    const modelId = fields === undefined ? undefined : stringField(fields, 'modelId')
    if (modelId === undefined) return error(400, 'modelId is required')
    const current = defaultModel.currentSelection()
    try {
      await defaultModel.saveSelection({
        provider: current.provider,
        model: modelId,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
      })
      return json(200, { ok: true, model: modelId })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }

  const selection = defaultModel.currentSelection()
  const providerModels = llm === undefined ? [] : await llm.listModels(selection.provider)
  const name = providerModels.find(model => model.id === selection.model)?.name ?? selection.model
  return json(200, { model: { id: selection.model, name, description: '', context: '0' } })
}


/* ----------------------------- repositories ----------------------------- */

async function repositoriesListRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  void body
  if (method !== 'GET') return error(405, 'method not allowed')
  const repository = services.repository()
  if (repository === undefined) return notMounted()
  try {
    const connections = await repository.listConnections()
    return json(200, { repositories: connections.map(repositoryConnectionDto) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function repositoriesConnectRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const path = fields === undefined ? undefined : stringField(fields, 'path')
  if (path === undefined || path.trim() === '') return error(400, 'path is required')
  const repository = services.repository()
  if (repository === undefined) return notMounted()
  const name = fields === undefined ? undefined : stringField(fields, 'name')
  try {
    return json(200, repositoryConnectionDto(await repository.connectRepository(path, name)))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

async function repositoriesCreateRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const repository = services.repository()
  if (repository === undefined) return notMounted()
  const fields = asRecord(body)
  const parentDir = fields === undefined ? undefined : stringField(fields, 'parentDir')
  const name = fields === undefined ? undefined : stringField(fields, 'name')
  if (parentDir === undefined || name === undefined) return error(400, 'parentDir and name are required')
  try {
    return json(200, repositoryConnectionDto(await repository.createRepository(parentDir, name)))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

/** Project a connected repository onto the legacy desktop DTO. */
function repositoryConnectionDto(connection: { id: string; name: string; rootPath: string; createdAt: string; updatedAt: string }): Record<string, unknown> {
  return {
    id: connection.id,
    name: connection.name,
    rootPath: connection.rootPath,
    manifest: { version: 1, name: connection.name, categories: [] },
    storage: { mode: 'connected', workingPath: connection.rootPath, localModificationCount: 0 },
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

async function repositoriesItemRoute(
  pathname: string,
  _search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const segments = pathname.slice('/api/repositories/'.length).split('/')
  const id = decodeURIComponent(segments[0] ?? '')
  const action = segments[1]

  if (action === 'resolve-environment') return resolveEnvironmentRoute(body, services, config)

  const repository = services.repository()
  if (repository === undefined) return notMounted()

  if (action === undefined) {
    if (method === 'DELETE') {
      try {
        return json(200, { disconnected: await repository.disconnectRepository(id) })
      } catch (err) {
        return error(500, errorMessage(err))
      }
    }
    try {
      const connection = await repository.getConnection(id)
      if (connection === undefined) return error(404, 'repository not found')
      return json(200, repositoryConnectionDto(connection))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }

  if (action === 'environment-profiles') {
    try {
      const connection = await repository.getConnection(id)
      if (connection === undefined) return error(404, 'repository not found')
      return json(200, { repositoryId: id, profiles: connection.environmentProfiles })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }

  return error(404, 'unknown repository action')
}

async function resolveEnvironmentRoute(
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (body === undefined) return error(400, 'profileId is required')
  const fields = asRecord(body)
  const profileId = fields === undefined ? undefined : stringField(fields, 'profileId')
  if (profileId === undefined) return error(400, 'profileId is required')
  const environment = services.environment()
  if (environment === undefined) return error(500, 'environment service is not mounted')
  const root = (fields === undefined ? undefined : stringField(fields, 'root')) ?? config.repositoryRoot
  if (root === undefined) return error(400, 'repository root is not configured')
  const capabilities = fields?.['capabilities'] as { platform?: string; runtimes?: Record<string, boolean> } | undefined
  try {
    const plan = await environment.plan(root, profileId, {
      platform: capabilities?.platform ?? process.platform,
      runtimes: {
        apt: capabilities?.runtimes?.apt ?? false,
        python: capabilities?.runtimes?.python ?? false,
        pip: capabilities?.runtimes?.pip ?? false,
        r: capabilities?.runtimes?.r ?? false,
        npm: capabilities?.runtimes?.npm ?? false,
        tlmgr: capabilities?.runtimes?.tlmgr ?? false,
      },
    })
    return json(200, plan)
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

/* ------------------------------- notes -------------------------------- */

async function notesListRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  try {
    return json(200, { notes: await notes.list() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesSearchRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const q = queryParam(search, 'q') ?? ''
  try {
    return json(200, { results: await notes.search(q) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesGraphRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  try {
    return json(200, await notes.graph())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesTodosRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  try {
    return json(200, { todos: await notes.todos() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesTemplatesRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  try {
    return json(200, { templates: await notes.templates() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesFromTemplateRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const fields = asRecord(body)
  const path = fields === undefined ? undefined : stringField(fields, 'path')
  const template = fields === undefined ? undefined : stringField(fields, 'template')
  if (path === undefined || template === undefined) return error(400, 'path and template are required')
  try {
    const templates = await notes.templates()
    const found = templates.find(item => item.name === template || item.path === template)
    if (found === undefined) return error(404, 'template not found')
    const doc = await notes.read(found.path)
    return json(200, await notes.write(path, doc.content))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesExportRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const path = queryParam(search, 'path')
  if (path === undefined) return error(400, 'path is required; pass ?path=')
  try {
    const doc = await notes.read(path)
    const title = doc.title ?? doc.name ?? path
    const body = doc.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return json(200, { html: `<h1>${title}</h1>\n<pre>${body}</pre>`, title })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesNoteRoute(
  rawPath: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return error(400, 'invalid note path')
  }
  try {
    if (method === 'GET') {
      return json(200, await notes.read(path))
    }
    if (method === 'PUT' || method === 'POST') {
      const fields = asRecord(body)
      const content = fields === undefined ? undefined : stringField(fields, 'content')
      if (content === undefined) return error(400, 'content is required')
      return json(200, await notes.write(path, content))
    }
    if (method === 'DELETE') {
      await notes.delete(path)
      return json(200, { removed: true })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesMoveRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const from = fields === undefined ? undefined : stringField(fields, 'from')
  const to = fields === undefined ? undefined : stringField(fields, 'to')
  if (from === undefined || to === undefined) return error(400, 'from and to are required')
  try {
    const doc = await notes.read(from)
    const moved = await notes.write(to, doc.content)
    await notes.delete(from)
    return json(200, moved)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesDailyRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const date = new Date().toISOString().slice(0, 10)
  const path = `daily/${date}.md`
  try {
    const existing = await notes.list()
    if (existing.some(note => note.path === path)) return json(200, await notes.read(path))
    return json(200, await notes.write(path, `# ${date}\n\n`))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesBacklinksRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const target = queryParam(search, 'path')
  if (target === undefined) return error(400, 'path is required')
  try {
    const all = await notes.list()
    const backlinks = []
    for (const note of all) {
      if ((note.links ?? []).some(link => link.target === target || link.target.endsWith('/' + target))) {
        backlinks.push(note)
      }
    }
    return json(200, { backlinks })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* --------------------------- prompt memory ----------------------------- */

async function promptMemoryStatusRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  try {
    const status = await promptMemory.getStatus()
    return json(200, status)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function promptMemoryLogsRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  const limit = Number(queryParam(search, 'limit') ?? '20')
  try {
    return json(200, await promptMemory.readReviewLogs(Number.isFinite(limit) ? limit : 20))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function promptMemoryFileRoute(
  target: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  const fileTarget = target as 'soul' | 'brief' | 'user'
  try {
    if (method === 'GET') return json(200, await promptMemory.readFile(fileTarget))
    if (method === 'PUT') {
      const fields = asRecord(body)
      const content = fields === undefined ? undefined : stringField(fields, 'content')
      if (content === undefined) return error(400, 'content is required')
      return json(200, await promptMemory.writeFile(fileTarget, content))
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* ------------------------------ search -------------------------------- */

async function searchSessionsRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const sessionSearch = services.sessionSearch()
  if (sessionSearch === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const query = fields === undefined ? '' : stringField(fields, 'query') ?? ''
  try {
    const result = await sessionSearch.search({ query, limit: 20 })
    return json(200, result ?? { results: [], count: 0 })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* ------------------------------- skills -------------------------------- */

async function skillsListRoute(services: RinServiceRefs, config: Config): Promise<JsonResponse> {
  const skillMemory = services.skillMemory()
  if (skillMemory === undefined) return notMounted()
  const roots = config.skillMemoryRoots
  if (roots === undefined) return json(200, { skills: [] })
  try {
    skillMemory.createStore(roots)
    const skills: Array<Record<string, unknown>> = []
    const dirs = [join(roots.globalConfigRoot, 'skill-memory'), join(roots.projectConfigRoot ?? roots.globalConfigRoot, 'skill-memory')]
    for (const dir of dirs) {
      try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          skills.push({ id: entry.name, name: entry.name, path: join(dir, entry.name), status: 'unknown' })
        }
      } catch {
        // A root that has no skill-memory directory is normal.
      }
    }
    return json(200, { skills })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* -------------------------- token optimization -------------------------- */

async function tokenOptimizationRoute(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  if (pathname === '/api/token-optimization/codegraph/graph') return codegraphGraphRoute(search, services)
  if (pathname === '/api/token-optimization/codegraph') return codegraphStatusRoute(search, services)
  if (pathname === '/api/token-optimization/codegraph/global/enable') return codegraphGlobalWriteRoute(method, services, true)
  if (pathname === '/api/token-optimization/codegraph/global/disable') return codegraphGlobalWriteRoute(method, services, false)
  if (pathname === '/api/token-optimization/codegraph/global') return codegraphGlobalStatusRoute(method, services)
  if (pathname === '/api/token-optimization/codegraph/enable') return codegraphEnableRoute(method, body, services)
  if (pathname === '/api/token-optimization/codegraph/disable') return codegraphDisableRoute(method, body, services)
  if (pathname === '/api/token-optimization/codegraph/rebuild') return codegraphRebuildRoute(method, body, services)
  if (pathname.includes('/rtk')) {
    // rtk (response token keeping) is a native desktop optimization, not ported to the web host.
    return json(200, { enabled: false, available: false, version: null, stats: null, error: 'rtk is not available on this host' })
  }

  const token = services.tokenOptimization()
  if (token === undefined) return notMounted()

  if (pathname === '/api/token-optimization/lite') return tokenLiteStatus(method, token)
  if (pathname === '/api/token-optimization/lite/enable' || pathname === '/api/token-optimization/lite/disable') {
    if (method !== 'POST') return error(405, 'method not allowed')
    const enabled = pathname.endsWith('/enable')
    const status = token.setCleanPrompt(enabled)
    return json(200, { enabled: status.cleanPrompt, mode: 'deterministic' })
  }
  if (pathname === '/api/token-optimization/ponytail') return responseStyleStatus(method, 'ponytail', token)
  if (pathname === '/api/token-optimization/ponytail/enable' || pathname === '/api/token-optimization/ponytail/disable') {
    if (method !== 'POST') return error(405, 'method not allowed')
    const enabled = pathname.endsWith('/enable')
    token.setResponseStyle(enabled ? 'ponytail' : 'off')
    return json(200, { enabled, mode: 'full' })
  }
  if (pathname === '/api/token-optimization/caveman') return responseStyleStatus(method, 'caveman', token)
  if (pathname === '/api/token-optimization/caveman/enable' || pathname === '/api/token-optimization/caveman/disable') {
    if (method !== 'POST') return error(405, 'method not allowed')
    const enabled = pathname.endsWith('/enable')
    token.setResponseStyle(enabled ? 'caveman' : 'off')
    return json(200, { enabled, mode: 'full' })
  }

  const pruning = services.smartPruning()
  if (pathname === '/api/token-optimization/pruning') {
    if (pruning === undefined) return json(200, { enabled: false, level: 'balanced', mode: 'deterministic' })
    return json(200, { enabled: pruning.getStatus().enabled, level: pruning.getStatus().level, mode: pruning.getStatus().mode })
  }
  if (pathname === '/api/token-optimization/pruning/enable' || pathname === '/api/token-optimization/pruning/disable') {
    if (pruning === undefined) return notMounted()
    if (method !== 'POST') return error(405, 'method not allowed')
    const status = pruning.setEnabled(pathname.endsWith('/enable'))
    return json(200, { enabled: status.enabled, level: status.level, mode: status.mode })
  }
  if (pathname === '/api/token-optimization/pruning/level') {
    if (pruning === undefined) return notMounted()
    if (method !== 'POST') return error(405, 'method not allowed')
    const fields = asRecord(body)
    const level = fields?.['level']
    if (level !== 'conservative' && level !== 'balanced' && level !== 'aggressive') return error(400, 'level is required')
    const status = pruning.setLevel(level)
    return json(200, { enabled: status.enabled, level: status.level, mode: status.mode })
  }

  return error(404, 'unknown token optimization endpoint')
}

function tokenLiteStatus(
  method: string,
  token: { getStatus(): { cleanPrompt: boolean }; setCleanPrompt(value: boolean): unknown },
): JsonResponse {
  if (method === 'POST') return error(405, 'method not allowed')
  return json(200, { enabled: token.getStatus().cleanPrompt, mode: 'deterministic' })
}

function responseStyleStatus(
  method: string,
  style: 'caveman' | 'ponytail',
  token: { getStatus(): { responseStyle: ResponseStyle } },
): JsonResponse {
  if (method === 'POST') return error(405, 'method not allowed')
  return json(200, { enabled: token.getStatus().responseStyle === style, mode: 'full' })
}


/* ------------------------- legacy A/B service routes ------------------------ */

async function notesSnapshotsRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return json(200, { snapshots: [] })
  const path = queryParam(search, 'path')
  if (path === undefined) return error(400, 'path is required')
  try {
    return json(200, { snapshots: await notes.listSnapshots(path) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesSnapshotRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const path = queryParam(search, 'path')
  const id = queryParam(search, 'id')
  if (path === undefined || id === undefined) return error(400, 'path and id are required')
  try {
    return json(200, await notes.readSnapshot(path, id))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function promptMemoryInsightsRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) {
    return json(200, { insights: [], stats: { total: 0, user: 0, methods: 0, dimensions: 0, automaticUpdates: 0 } })
  }
  try {
    const [status, logs] = await Promise.all([
      promptMemory.getStatus(),
      promptMemory.readReviewLogs(200),
    ])
    return json(200, buildPromptMemoryInsights({
      files: { user: status.files.user, brief: status.files.brief },
      logs,
    }))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function tasksRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const tasks = services.tasks()
  if (tasks === undefined) return json(200, { lists: [], tasks: [] })
  try {
    return json(200, { tasks: await tasks.listTasks() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function taskListsRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const tasks = services.tasks()
  if (tasks === undefined) return json(200, { lists: [], tasks: [] })
  try {
    return json(200, { lists: await tasks.listTaskLists() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function teamsListRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const teams = services.teams()
  if (teams === undefined) return json(200, { teams: [] })
  try {
    return json(200, { teams: await teams.list() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function teamsItemRoute(
  name: string,
  agentId: string | undefined,
  action: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  void body; void agentId
  if (action === 'transcript' || action === 'messages') {
    return error(501, 'team member ' + action + ' is not available on this host yet (multi-agent orchestration is deferred)')
  }
  const teams = services.teams()
  if (teams === undefined) return notMounted()
  try {
    if (method === 'GET') return json(200, await teams.get(name))
    if (method === 'DELETE') {
      await teams.delete(name)
      return json(200, { ok: true })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function taskListItemRoute(
  listId: string,
  taskId: string | undefined,
  method: string,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const tasks = services.tasks()
  if (tasks === undefined) return notMounted()
  try {
    if (taskId === 'reset') {
      if (method !== 'POST') return error(405, 'method not allowed')
      const items = await tasks.getTasksForList(listId)
      for (const item of items) await tasks.deleteTask(listId, item.id)
      return json(200, { ok: true })
    }
    if (taskId !== undefined) {
      if (method !== 'GET') return error(405, 'method not allowed')
      const task = await tasks.getTask(listId, taskId)
      if (task === null) return error(404, 'task not found')
      return json(200, { task })
    }
    if (method !== 'GET') return error(405, 'method not allowed')
    return json(200, { tasks: await tasks.getTasksForList(listId) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function mcpListRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET' && method !== 'POST') return error(405, 'method not allowed')
  const mcp = services.mcp()
  if (mcp === undefined) return method === 'GET' ? json(200, { servers: [] }) : error(500, 'mcp service is not mounted')
  try {
    if (method === 'POST') {
      const input = mcpInputFromBody(body)
      if (input === undefined) return error(400, 'name and config.type are required')
      return json(200, { server: mcpServerDto(await mcp.create(input)) })
    }
    const servers = await mcp.list()
    return json(200, { servers: servers.map(mcpServerDto) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function mcpItemRoute(
  name: string,
  action: string | undefined,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const mcp = services.mcp()
  if (mcp === undefined) return notMounted()
  try {
    if (action === 'status') {
      if (method !== 'GET') return error(405, 'method not allowed')
      const server = await mcp.get(name)
      if (server === null) return error(404, 'mcp server not found')
      return json(200, { server: mcpServerDto(server) })
    }
    if (action === 'toggle') {
      if (method !== 'POST') return error(405, 'method not allowed')
      const server = await mcp.get(name)
      if (server === null) return error(404, 'mcp server not found')
      const next = server.status === 'disabled' ? 'checking' : 'disabled'
      return json(200, { server: mcpServerDto(await mcp.update(name, { status: next })) })
    }
    if (action === 'reconnect') {
      if (method !== 'POST') return error(405, 'method not allowed')
      const server = await mcp.get(name)
      if (server === null) return error(404, 'mcp server not found')
      return json(200, { server: mcpServerDto(await mcp.update(name, { status: 'checking' })) })
    }
    if (action !== undefined) return error(404, 'unknown mcp action')
    if (method === 'PUT') {
      const input = mcpInputFromBody(body)
      if (input === undefined) return error(400, 'config.type is required')
      const { name: _ignored, ...patch } = input
      void _ignored
      return json(200, { server: mcpServerDto(await mcp.update(name, patch)) })
    }
    if (method === 'DELETE') {
      await mcp.remove(name)
      return json(200, { ok: true })
    }
    return error(405, 'method not allowed')
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

type McpTransportLike = 'stdio' | 'http' | 'sse'

interface McpInputShape {
  name: string
  transport: McpTransportLike
  command: string
  args: string[]
  env: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

/** Project the desktop upsert payload into a store input, or undefined when invalid. */
function mcpInputFromBody(body: unknown): McpInputShape | undefined {
  const fields = asRecord(body)
  if (fields === undefined) return undefined
  const name = stringField(fields, 'name')
  if (name === undefined) return undefined
  const config = fields['config'] === undefined ? undefined : asRecord(fields['config'])
  const transport = config === undefined ? undefined : stringField(config, 'type')
  if (transport === undefined) return undefined
  const normalized: McpTransportLike = transport === 'http' || transport === 'sse' ? transport : 'stdio'
  const env = config === undefined ? undefined : asRecord(config['env'])
  const stringEnv: Record<string, string> = {}
  if (normalized === 'stdio' && env !== undefined) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') stringEnv[key] = value
    }
  }
  const headers = config !== undefined ? asRecord(config['headers']) : undefined
  const stringHeaders: Record<string, string> | undefined = headers === undefined ? undefined : Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  const url = normalized !== 'stdio' && config !== undefined ? stringField(config, 'url') : undefined
  const input: McpInputShape = {
    name,
    transport: normalized,
    command: normalized === 'stdio' ? stringField(config ?? {}, 'command') ?? '' : '',
    args: normalized === 'stdio' && Array.isArray(config?.['args']) ? config['args'].filter((v): v is string => typeof v === 'string') : [],
    env: stringEnv,
  }
  if (url !== undefined) input.url = url
  if (stringHeaders !== undefined) input.headers = stringHeaders
  return input
}

/** The @rin/mcp store fields the route layer projects a desktop DTO from. */
interface McpServerConfigLike {
  name: string
  transport: string
  command: string
  args: string[]
  env: Record<string, string>
  url?: string
  headers?: Record<string, string>
  status: string
}

function mcpServerDto(server: McpServerConfigLike): Record<string, unknown> {
  const isStdio = server.transport === 'stdio'
  return {
    name: server.name,
    scope: 'user',
    transport: server.transport,
    enabled: server.status !== 'disabled',
    status: server.status,
    statusLabel: mcpStatusLabel(server.status),
    configLocation: '~/.rin/mcp/servers.json',
    summary: mcpServerSummary(server),
    canEdit: true,
    canRemove: true,
    canReconnect: !isStdio,
    canToggle: true,
    config: isStdio
      ? { type: 'stdio', command: server.command, args: server.args, env: server.env }
      : { type: server.transport, url: server.url ?? '', headers: server.headers ?? {} },
  }
}

function mcpStatusLabel(status: string): string {
  switch (status) {
    case 'connected': return 'Connected'
    case 'needs-auth': return 'Needs auth'
    case 'failed': return 'Unavailable'
    case 'disabled': return 'Disabled'
    case 'checking': return 'Checking'
    default: return status
  }
}

function mcpServerSummary(server: McpServerConfigLike): string {
  if (server.transport === 'http' || server.transport === 'sse') {
    return server.url ?? server.transport
  }
  return [server.command, ...server.args].join(' ').trim()
}

async function computerUseStatusRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const computerUse = services.computerUse()
  if (computerUse === undefined) {
    return json(200, {
      platform: process.platform,
      supported: false,
      python: { installed: false, version: null, path: null },
      venv: { created: false, path: '' },
      dependencies: { installed: false, requirementsFound: false },
      permissions: { accessibility: null, screenRecording: null },
    })
  }
  try {
    return json(200, await computerUse.getStatus())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function computerUseAppsRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const computerUse = services.computerUse()
  if (computerUse === undefined) return json(200, { apps: [] })
  try {
    return json(200, { apps: await computerUse.listAuthorizedApps() })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function computerUseAuthorizedAppsRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  const computerUse = services.computerUse()
  if (computerUse === undefined) return json(200, { apps: [] })
  try {
    if (method === 'PUT') {
      const fields = asRecord(body)
      if (fields === undefined) return error(400, 'request body must be a JSON object')
      if (Array.isArray(fields['authorizedApps'])) {
        const apps = fields['authorizedApps'].map((value) => asRecord(value))
          .filter((value): value is Record<string, unknown> => value !== undefined)
          .map((value) => ({ bundleId: stringField(value, 'bundleId') ?? '', displayName: stringField(value, 'displayName') ?? '' }))
        await computerUse.replaceAuthorizedApps(apps)
      }
      const grantFlags = fields['grantFlags'] === undefined ? undefined : asRecord(fields['grantFlags'])
      if (grantFlags !== undefined) {
        await computerUse.updateGrantFlags(grantFlags as never)
      }
      return json(200, { ok: true })
    }
    if (method !== 'GET') return error(405, 'method not allowed')
    const [authorizedApps, grantFlags] = await Promise.all([
      computerUse.listAuthorizedApps(),
      computerUse.getGrantFlags(),
    ])
    return json(200, { authorizedApps, grantFlags })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function computerUseSetupRoute(method: string): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  return json(200, {
    success: false,
    steps: [{ name: 'python-environment', ok: false, message: 'computer-use runtime setup is not available on this host yet' }],
  })
}

async function computerUseOpenSettingsRoute(method: string): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  return error(501, 'opening OS privacy settings is a desktop-only action and is not available on the web host')
}

async function agentMigrationRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const agentMigration = services.agentMigration()
  if (agentMigration === undefined) {
    return json(200, { scannedAt: new Date().toISOString(), targetAgentId: 'claude-code', agents: [] })
  }
  try {
    return json(200, await agentMigration.scan())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentMigrationPreviewRoute(rawId: string, search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const agentMigration = services.agentMigration()
  if (agentMigration === undefined) return notMounted()
  let itemId: string
  try {
    itemId = decodeURIComponent(rawId)
  } catch {
    return error(400, 'invalid item id')
  }
  const agentId = queryParam(search, 'agentId')
  if (agentId === undefined) return error(400, 'agentId is required')
  try {
    return json(200, await agentMigration.preview(agentId, itemId))
  } catch (err) {
    return error(404, errorMessage(err))
  }
}

async function codegraphGraphRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  const projectPath = queryParam(search, 'projectPath')
  if (projectPath === undefined) return error(400, 'projectPath is required')
  const rawLimit = Number(queryParam(search, 'limit') ?? '120')
  try {
    return json(200, codegraph.visualization(projectPath, Number.isFinite(rawLimit) ? rawLimit : 120))
  } catch (err) {
    return error(404, errorMessage(err))
  }
}

async function codegraphStatusRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  const projectPath = queryParam(search, 'projectPath')
  if (projectPath === undefined) return error(400, 'projectPath is required')
  try {
    return json(200, codegraph.status(projectPath))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function codegraphGlobalStatusRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  return json(200, codegraph.globalStatus())
}

async function codegraphGlobalWriteRoute(method: string, services: RinServiceRefs, enable: boolean): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  try {
    return json(200, enable ? codegraph.enableGlobal() : await codegraph.disableGlobal())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function codegraphEnableRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  const projectPath = codegraphProjectPathFromBody(body)
  if (projectPath === undefined) return error(400, 'projectPath is required')
  try {
    return json(202, await codegraph.enable(projectPath))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

async function codegraphDisableRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  const projectPath = codegraphProjectPathFromBody(body)
  if (projectPath === undefined) return error(400, 'projectPath is required')
  try {
    return json(200, await codegraph.disable(projectPath))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

async function codegraphRebuildRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const codegraph = services.codegraph()
  if (codegraph === undefined) return notMounted()
  const projectPath = codegraphProjectPathFromBody(body)
  if (projectPath === undefined) return error(400, 'projectPath is required')
  try {
    return json(202, await codegraph.rebuild(projectPath))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

function codegraphProjectPathFromBody(body: unknown): string | undefined {
  const fields = asRecord(body)
  return fields === undefined ? undefined : stringField(fields, 'projectPath')
}

async function pluginsListRoute(method: string, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'GET') return error(405, 'method not allowed')
  const plugins = services.plugins()
  if (plugins === undefined) return notMounted()
  try {
    return json(200, await plugins.list())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function pluginsDetailRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const plugins = services.plugins()
  if (plugins === undefined) return notMounted()
  const id = queryParam(search, 'id')
  if (id === undefined) return error(400, 'id is required')
  try {
    const detail = await plugins.detail(id)
    if (detail === undefined) return error(404, 'plugin not found')
    return json(200, { detail })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function pluginsSetEnabledRoute(pathname: string, method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const plugins = services.plugins()
  if (plugins === undefined) return notMounted()
  const fields = asRecord(body)
  const id = fields === undefined ? undefined : stringField(fields, 'id')
  if (id === undefined) return error(400, 'id is required')
  const enabled = pathname.endsWith('/enable')
  try {
    return json(200, { ok: true, enabled: await plugins.setEnabled(id, enabled) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentMigrationMigrateRoute(method: string, body: unknown, services: RinServiceRefs): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  const agentMigration = services.agentMigration()
  if (agentMigration === undefined) return notMounted()
  const fields = asRecord(body)
  const agentId = fields === undefined ? undefined : stringField(fields, 'agentId')
  if (agentId === undefined) return error(400, 'agentId is required')
  const itemIds = Array.isArray(fields?.['itemIds']) ? fields['itemIds'].filter((value): value is string => typeof value === 'string') : []
  try {
    return json(200, await agentMigration.migrate(agentId, itemIds))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}


/* --------------------------- legacy D-class routes -------------------------- */

const ACTIVE_PROVIDER_REF: Record<string, string> = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
}

async function authStatusRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const credentials = services.credentials()
  const selection = services.agentDefaultModel()?.currentSelection()
  if (credentials === undefined || selection === undefined) {
    return json(200, { hasAuth: false, source: 'none' })
  }
  const apiKeyEnv = ACTIVE_PROVIDER_REF[selection.provider]
  if (apiKeyEnv === undefined) {
    return json(200, { hasAuth: false, source: 'none', activeProvider: selection.provider })
  }
  try {
    const info = await credentials.describe(apiKeyEnv)
    const source = !info.configured
      ? 'none'
      : info.source === 'file'
        ? 'managed'
        : 'env'
    return json(200, { hasAuth: info.configured, source, activeProvider: selection.provider })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function recentProjectsRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const registry = services.workspaceRegistry()
  if (registry === undefined) return json(200, { projects: [] })
  const shell = services.shell()
  const rawLimit = Number(queryParam(search, 'limit') ?? '10')
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 10
  try {
    const projects: Array<Record<string, unknown>> = []
    for (const workspace of registry.list().slice(0, limit)) {
      const git = await gitProjectFacts(shell, workspace.path)
      projects.push({
        projectPath: workspace.path,
        realPath: workspace.path,
        projectName: workspace.title || basename(workspace.path),
        isGit: git.isGit,
        repoName: git.repoName,
        branch: git.branch,
        modifiedAt: workspace.updatedAt,
        sessionCount: workspace.sessionIds.length,
      })
    }
    return json(200, { projects })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function gitRun(shell: DshShellLike, workDir: string, command: string): Promise<string | null> {
  try {
    const spec = shell.resolve({ command, workdir: workDir })
    const res = await shell.run(spec)
    return res.exitCode === 0 ? res.stdout.text.trim() : null
  } catch {
    return null
  }
}

function parseRepoName(remote: string | null): string | null {
  if (remote === null || remote === '') return null
  const match = remote.match(/\/([^/]+?)(?:\.git)?$/) ?? remote.match(/:([^/]+\/[^/]+?)(?:\.git)?$/)
  const name = match?.[1]
  return name === undefined || name === '' ? null : name
}

async function gitProjectFacts(
  shell: DshShellLike | undefined,
  workDir: string,
): Promise<{ isGit: boolean; branch: string | null; repoName: string | null }> {
  if (shell === undefined) return { isGit: false, branch: null, repoName: null }
  const branch = await gitRun(shell, workDir, 'git rev-parse --abbrev-ref HEAD')
  if (branch === null) return { isGit: false, branch: null, repoName: null }
  const remote = await gitRun(shell, workDir, 'git remote get-url origin')
  return { isGit: true, branch, repoName: parseRepoName(remote) }
}

async function gitChangedFileCount(shell: DshShellLike, workDir: string): Promise<number> {
  const changed = await gitRun(shell, workDir, 'git status --porcelain')
  return changed === null ? 0 : changed.split('\n').filter(line => line.trim() !== '').length
}

async function sessionGitInfoRoute(id: string, services: RinServiceRefs): Promise<JsonResponse> {
  const session = services.sessions()?.get(id)
  const workDir = session?.header?.cwd ?? ''
  const shell = services.shell()
  if (shell === undefined || workDir === '') {
    return json(200, { branch: null, repoName: null, workDir, changedFiles: 0 })
  }
  const git = await gitProjectFacts(shell, workDir)
  if (!git.isGit) return json(200, { branch: null, repoName: null, workDir, changedFiles: 0 })
  const changedFiles = await gitChangedFileCount(shell, workDir)
  return json(200, { branch: git.branch, repoName: git.repoName, workDir, changedFiles })
}

async function sessionUsageRoute(id: string, services: RinServiceRefs): Promise<JsonResponse> {
  const session = services.sessions()?.get(id)
  if (session === undefined) return json(200, { usage: null, context: null })

  const snap = services.sessionProjections()?.snapshot(session)
  const tokenUsage = snap?.values?.tokenUsage
  const pressure = snap?.values?.contextPressure

  let usage: Record<string, unknown> | null = null
  if (tokenUsage !== undefined) {
    usage = {
      totalInputTokens: tokenUsage.uncachedInputTokens + tokenUsage.cacheReadTokens + tokenUsage.cacheWriteTokens,
      totalOutputTokens: tokenUsage.outputTokens,
      totalCacheReadInputTokens: tokenUsage.cacheReadTokens,
      totalCacheCreationInputTokens: tokenUsage.cacheWriteTokens,
    }
  }

  let context: Record<string, unknown> | null = null
  if (pressure !== undefined) {
    const model = services.agentDefaultModel()?.currentSelection().model
    const meter = services.tokenMeter()
    const usedTokens = pressure.projectedTokens ?? pressure.pressureTokens
      ?? (meter !== undefined ? meter.measure(session).totalTokens : undefined)
    const contextWindow = pressure.contextWindow
    context = {
      ...(model !== undefined ? { model } : {}),
      ...(usedTokens !== undefined ? { usedTokens } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(usedTokens !== undefined && contextWindow !== undefined && contextWindow > 0
        ? { percentage: Math.round((usedTokens / contextWindow) * 100) }
        : {}),
    }
  }

  return json(200, { usage, context })
}

function sessionSlashCommandsRoute(id: string, services: RinServiceRefs): JsonResponse {
  const agents = services.dshAgents()
  const commands = services.commands()
  if (agents === undefined || commands === undefined) return json(200, { commands: [] })
  const agent = agents.get(id)
  if (agent === undefined) return json(200, { commands: [] })
  return json(200, {
    commands: commands.list(agent as unknown).map(({ name, description }) => ({ name, description })),
  })
}


/* ------------------------------ sessions -------------------------------- */

async function sessionsListRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  if (method === 'POST') {
    return sessionsCreateRoute(body, services)
  }
  if (method !== 'GET') return error(405, 'method not allowed')

  const store = services.sessions()
  const persistence = services.sessionPersistence()

  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  if (persistence !== undefined) {
    try {
      const persisted = await persistence.list()
      for (const header of persisted) {
        if (seen.has(header.id) || deletedSessionIds.has(header.id)) continue
        seen.add(header.id)
        const live = store?.get(header.id)
        rows.push({
          id: header.id,
          title: `Session ${header.id.slice(-8)}`,
          lastMessage: '',
          createdAt: new Date(header.createdAt).toISOString(),
          modifiedAt: new Date(header.createdAt).toISOString(),
          messageCount: live?.events.length ?? 0,
          projectPath: header.cwd ?? '',
          workDir: header.cwd ?? null,
          workDirExists: true,
          isTemporary: false,
        })
      }
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }

  if (store !== undefined) {
    for (const session of store.list()) {
      if (seen.has(session.id) || deletedSessionIds.has(session.id)) continue
      seen.add(session.id)
      const last = session.events[session.events.length - 1]
      rows.push({
        id: session.id,
        title: `Session ${session.id.slice(-8)}`,
        lastMessage: '',
        createdAt: new Date(session.events[0]?.time ?? Date.now()).toISOString(),
        modifiedAt: new Date(last?.time ?? Date.now()).toISOString(),
        messageCount: session.events.length,
        projectPath: '',
        workDir: null,
        workDirExists: true,
        isTemporary: false,
      })
    }
  }

  return json(200, { sessions: rows, total: rows.length })
}

async function sessionsCreateRoute(
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const store = services.sessions()
  if (store === undefined) return error(500, 'session service is not mounted')
  const fields = asRecord(body)
  const workDir = fields === undefined ? undefined : stringField(fields, 'workDir')
  try {
    // Mint a globally-unique id instead of dsh's in-memory `session-<n>`
    // counter: that counter resets on every host restart and collides with
    // persisted logs still on disk (`refusing to materialize ... a log already
    // exists`), which is fatal at createAgent time. `session-<uuid>` matches the
    // id shape dsh's own web sessions use and cannot collide.
    // Prepare, do not enter: dsh's agent factory prepares the session again
    // when a chat message arrives (createAgent -> sessions.prepare), which
    // throws "already exists" if this route entered it into the store first.
    const session = store.prepare(`session-${randomUUID()}`, { meta: { cwd: workDir ?? process.cwd() } })
    return json(200, {
      sessionId: session.id,
      session: {
        id: session.id,
        title: `Session ${session.id.slice(-8)}`,
        lastMessage: '',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        messageCount: 0,
        projectPath: workDir ?? '',
        workDir: workDir ?? null,
        workDirExists: true,
        isTemporary: false,
      },
    })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sessionsItemRoute(
  rawId: string,
  action: string | undefined,
  _search: string,
  method: string,
  _body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return error(400, 'invalid session id')
  }

  const store = services.sessions()
  const persistence = services.sessionPersistence()

  if (action === 'messages') {
    if (method !== 'GET') return error(405, 'method not allowed')
    try {
      let session = store?.get(id)
      if (session === undefined && persistence !== undefined) {
        await persistence.prepare(id)
        session = store?.get(id)
      }
      if (session === undefined) return error(404, 'session not found')
      return json(200, { messages: mapSessionEvents(session), hasMore: false })
    } catch (err) {
      return error(404, errorMessage(err))
    }
  }

  if (action === 'slash-commands') return sessionSlashCommandsRoute(id, services)
  if (action === 'git-info') return sessionGitInfoRoute(id, services)
  if (action === 'inspection') return json(200, { active: false, status: { sessionId: id, workDir: '', permissionMode: 'default' } })
  if (action === 'usage') return sessionUsageRoute(id, services)

  if (action === undefined) {
    if (method === 'DELETE') {
      return deleteSessionRoute(id, services)
    }
    if (method === 'PATCH') return json(501, 'session update is not available on this host yet')
    return error(405, 'method not allowed')
  }

  if (action === 'rewind' || action === 'branch') {
    return error(501, 'session ' + action + ' is not available on this host yet')
  }

  return error(404, 'unknown session action')
}

/**
 * Delete one session's durable artifact files.
 *
 * dsh's session model is append-only: the SessionStore exposes no public
 * removal API and the persistence seam no delete method, so a session's
 * durable files under the dsh home are the only removal target. Deleting them
 * makes the session disappear from {@link sessionsListRoute} (persistence
 * list) on the next refresh; a live in-memory entry is left to its lifecycle.
 */
async function deleteSessionRoute(id: string, services: RinServiceRefs): Promise<JsonResponse> {
  const root = join(homedir(), '.dsh', 'sessions')
  let removed = 0
  try {
    for await (const file of walkSessionFiles(root, id)) {
      await rm(file, { force: true })
      removed++
    }
  } catch (err) {
    return error(500, errorMessage(err))
  }
  void services // kept for signature symmetry with sibling routes
  // Tombstone in-memory sessions (no durable file) so the list stops showing
  // them for the rest of this host's lifetime.
  deletedSessionIds.add(id)
  return json(200, { ok: true, removed })
}

/**
 * Yield every session artifact file matching one session id under a root,
 * walking workspace directories without following symlinks.
 */
async function* walkSessionFiles(
  root: string,
  id: string,
): AsyncGenerator<string, void, undefined> {
  let entries: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>
  try {
    entries = await readdir(root, { withFileTypes: true }) as Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkSessionFiles(full, id)
    } else if (entry.isFile() && entry.name.startsWith(id + '.jsonl')) {
      yield full
    }
  }
}

function mapSessionEvents(session: { events: readonly { type: string; seq: number; time: number; data: unknown }[] }): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  for (const event of session.events) {
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        messages.push({
          id: 'evt-' + event.seq,
          type: 'user',
          content: data['content'] ?? '',
          timestamp: new Date(event.time).toISOString(),
        })
        break
      }
      case 'assistant/message': {
        const message = data['message'] as Record<string, unknown> | undefined
        const blocks = Array.isArray(message?.['content']) ? message['content'] as Array<Record<string, unknown>> : []
        const mapped = blocks.map(block => {
          if (block.type === 'reasoning') return { type: 'thinking', thinking: block.text }
          if (block.type === 'tool-call') return { type: 'tool_use', id: block.id, name: block.name, input: block.arguments }
          return block
        })
        messages.push({
          id: 'evt-' + event.seq,
          type: 'assistant',
          content: mapped,
          timestamp: new Date(event.time).toISOString(),
          model: message?.['source'] !== undefined && typeof message?.['source'] === 'object'
            ? (message['source'] as Record<string, unknown>)['model']
            : undefined,
        })
        break
      }
      case 'tool/call': {
        let input: unknown = data['arguments']
        try { input = JSON.parse(String(data['arguments'])) } catch { /* keep raw */ }
        messages.push({
          id: 'evt-' + event.seq,
          type: 'tool_use',
          content: [{ type: 'tool_use', id: data['callId'], name: data['name'], input }],
          timestamp: new Date(event.time).toISOString(),
        })
        break
      }
      case 'tool/result': {
        const message = data['message'] as Record<string, unknown> | undefined
        const content = Array.isArray(message?.['content']) ? message['content'] : []
        const block = (content as Array<Record<string, unknown>>)[0]
        messages.push({
          id: 'evt-' + event.seq,
          type: 'tool_result',
          content: block === undefined
            ? []
            : [{ type: 'tool_result', tool_use_id: block['toolCallId'], content: block['content'], is_error: data['error'] !== undefined }],
          timestamp: new Date(event.time).toISOString(),
        })
        break
      }
      default:
        break
    }
  }
  return messages
}
