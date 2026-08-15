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

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import type { RinServiceRefs } from '../routes.ts'

const REPOSITORY_ID = 'builtin'
const NOTE_PATH_RE = /^\/api\/notes\/note\/(.+)$/

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
  if (pathname === '/api/repositories') return repositoriesListRoute(method, body, services, config)
  if (pathname === '/api/repositories/connect') return repositoriesConnectRoute(method, body)
  if (pathname.startsWith('/api/repositories/')) {
    return repositoriesItemRoute(pathname, search, method, body, services, config)
  }

  // Sessions (legacy desktop REST surface over the mounted dsh session services)
  if (pathname === '/api/sessions') return sessionsListRoute(method, body, services)
  if (pathname === '/api/sessions/recent-projects') return json(200, { projects: [] })
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
  if (pathname === '/api/notes/move') return notesMoveRoute(method, body, services)
  if (pathname === '/api/notes/daily') return notesDailyRoute(method, services)
  if (pathname === '/api/notes/backlinks') return notesBacklinksRoute(search, services)
  if (pathname === '/api/notes/snapshots') return json(200, { snapshots: [] })
  const notePath = NOTE_PATH_RE.exec(pathname)
  if (notePath !== null && notePath[1] !== undefined) {
    return notesNoteRoute(notePath[1], method, body, services)
  }

  // Prompt memory (legacy desktop paths)
  if (pathname === '/api/prompt-memory') return promptMemoryStatusRoute(services)
  if (pathname === '/api/prompt-memory/logs') return promptMemoryLogsRoute(search, services)
  if (pathname === '/api/prompt-memory/insights') return json(200, { insights: [], stats: { total: 0, user: 0, methods: 0, dimensions: 0, automaticUpdates: 0 } })
  const promptMemoryFile = /^\/api\/prompt-memory\/(soul|brief|user)$/.exec(pathname)
  if (promptMemoryFile !== null && promptMemoryFile[1] !== undefined) {
    return promptMemoryFileRoute(promptMemoryFile[1], method, body, services)
  }

  // Search (legacy desktop path backed by @rin/session-search)
  if (pathname === '/api/search/sessions') return searchSessionsRoute(method, body, services)

  // Skills (legacy desktop path backed by @rin/skill-memory)
  if (pathname === '/api/skills') return skillsListRoute(services, config)
  if (pathname === '/api/skills/config') return json(200, { config: { enabled: true } })

  // Token optimization (legacy desktop paths backed by the two @rin knobs)
  if (pathname.startsWith('/api/token-optimization/')) {
    return tokenOptimizationRoute(pathname, method, body, services)
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
  const agentRepo = /^\/api\/agents\/repositories\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (agentRepo !== null && agentRepo[1] !== undefined) {
    return agentsRepositoryRoute(agentRepo[1], agentRepo[3], method, body, services, config)
  }

  // Settings / models / providers minimal compatibility
  if (pathname === '/api/settings/user') return settingsUserRoute(method, body)
  if (pathname === '/api/permissions/mode') return permissionsModeRoute(method, body)
  if (pathname === '/api/permissions/rules') return permissionsRulesRoute(method)
  if (pathname === '/api/models') return modelsRoute(services)
  if (pathname === '/api/models/current') return modelsCurrentRoute(services)
  if (pathname === '/api/effort') return json(200, { level: 'medium', available: ['low', 'medium', 'high'] })
  if (pathname === '/api/providers') return providersRoute(method, body)
  if (pathname === '/api/providers/presets') return json(200, { presets: PROVIDER_PRESETS })
  if (pathname === '/api/providers/auth-status') return json(200, { hasAuth: false, source: 'none' })
  if (pathname === '/api/providers/settings') return json(200, {})
  const providerItem = /^\/api\/providers\/([^/]+)(\/([^/]+))?$/.exec(pathname)
  if (providerItem !== null && providerItem[1] !== undefined) {
    return providerItemRoute(providerItem[1], providerItem[3], method, body)
  }
  if (pathname === '/api/mcp') return json(200, { servers: [] })

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
      const run = await sandboxes.executeEnvironmentPlan(profile, profile.repositoryId ?? 'builtin', environmentProfileId, plan)
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
      return json(200, { result: { connectivity: { success: false, latencyMs: 0, error: 'provider test is not wired yet' } } })
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

function settingsUserRoute(method: string, _body: unknown): JsonResponse {
  if (method === 'GET') return json(200, {})
  if (method === 'PUT') return json(200, { ok: true })
  return error(405, 'method not allowed')
}

function permissionsModeRoute(method: string, body: unknown): JsonResponse {
  if (method === 'GET') return json(200, { mode: 'default' })
  if (method === 'PUT') {
    const fields = asRecord(body)
    const mode = fields === undefined ? 'default' : stringField(fields, 'mode') ?? 'default'
    return json(200, { ok: true, mode })
  }
  return error(405, 'method not allowed')
}

function permissionsRulesRoute(method: string): JsonResponse {
  if (method === 'GET') return json(200, { rules: [] })
  if (method === 'POST') return json(200, { ok: true, rule: { source: 'userSettings', behavior: 'ask', ruleString: '', toolName: '' } })
  if (method === 'DELETE') return json(200, { ok: true })
  return error(405, 'method not allowed')
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

async function modelsCurrentRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const llm = services.llm()
  if (llm === undefined) return error(404, 'no llm service mounted')
  const provider = llm.listProviders()[0]
  if (provider === undefined) return error(404, 'no model configured')
  const models = await llm.listModels(provider.id)
  const model = models[0]
  if (model === undefined) return error(404, 'no model configured')
  return json(200, { model: { id: model.id, name: model.name, description: '', context: '0' } })
}


/* ----------------------------- repositories ----------------------------- */

async function repositoriesListRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method === 'POST') {
    // The desktop's create/connect form may POST here; accept and return the builtin row.
    return repositoriesConnectRoute('POST', body)
  }
  const repository = services.repository()
  if (repository === undefined) return notMounted()
  const root = config.repositoryRoot
  if (root === undefined) return error(500, 'repository root is not configured')
  return json(200, {
    repositories: [{
      id: REPOSITORY_ID,
      name: 'builtin',
      path: root,
      connected: true,
      createdAt: new Date(0).toISOString(),
      modifiedAt: new Date(0).toISOString(),
    }],
  })
}

function repositoriesConnectRoute(method: string, body: unknown): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const path = fields === undefined ? undefined : stringField(fields, 'path')
  if (path === undefined || path.trim() === '') return error(400, 'path is required')
  return json(200, {
    id: REPOSITORY_ID,
    name: 'builtin',
    path,
    connected: true,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  })
}

async function repositoriesItemRoute(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const segments = pathname.slice('/api/repositories/'.length).split('/')
  const id = decodeURIComponent(segments[0] ?? '')
  if (id !== '' && id !== REPOSITORY_ID) return error(404, 'repository not found')
  const action = segments[1]

  if (action === undefined) {
    if (method === 'DELETE') return json(200, { disconnected: false })
    const repository = services.repository()
    if (repository === undefined) return notMounted()
    const root = config.repositoryRoot
    if (root === undefined) return error(500, 'repository root is not configured')
    return json(200, { id: REPOSITORY_ID, name: 'builtin', path: root, connected: true })
  }

  if (action === 'environment-profiles') {
    const repository = services.repository()
    if (repository === undefined) return notMounted()
    const root = config.repositoryRoot
    if (root === undefined) return error(500, 'repository root is not configured')
    try {
      const repo = await repository.read(root)
      return json(200, { repositoryId: REPOSITORY_ID, profiles: repo.environmentProfiles })
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }

  if (action === 'resolve-environment') return resolveEnvironmentRoute(body, services, config)
  if (action === 'install-plan') return resolveEnvironmentRoute(method === 'GET' ? { profileId: queryParam(search, 'profile') } : body, services, config)

  if (action === 'manifest') {
    const repository = services.repository()
    if (repository === undefined) return notMounted()
    const root = config.repositoryRoot
    if (root === undefined) return error(500, 'repository root is not configured')
    try {
      const repo = await repository.read(root)
      return json(200, repo.manifest)
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
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
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

  if (pathname.includes('/codegraph') || pathname.includes('/rtk')) {
    return json(200, { enabled: false, available: false, version: null, stats: null, error: null })
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
        if (seen.has(header.id)) continue
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
      if (seen.has(session.id)) continue
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
    const session = store.create(undefined, { meta: { cwd: workDir ?? process.cwd() } })
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

  if (action === 'slash-commands') return json(200, { commands: [] })
  if (action === 'git-info') return json(200, { branch: null, repoName: null, workDir: '', changedFiles: 0 })
  if (action === 'inspection') return json(200, { active: false, status: { sessionId: id, workDir: '', permissionMode: 'default' } })
  if (action === 'usage') return json(200, { usage: null, context: null })

  if (action === undefined) {
    if (method === 'DELETE') {
      try {
        return json(200, { ok: true })
      } catch (err) {
        return error(500, errorMessage(err))
      }
    }
    if (method === 'PATCH') return json(200, { ok: true })
    return error(405, 'method not allowed')
  }

  if (action === 'rewind' || action === 'branch') {
    return error(501, 'session ' + action + ' is not available on this host yet')
  }

  return error(404, 'unknown session action')
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
