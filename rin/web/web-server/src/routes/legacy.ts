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

import { readdir } from 'node:fs/promises'
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

  return null
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
