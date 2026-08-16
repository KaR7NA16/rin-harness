/**
 * rin web-server — provider connectivity probe and model discovery.
 *
 * Faithful port of the legacy desktop `providerModelDiscovery` and
 * `providerService.testConnectivity` (direct upstream call only — the
 * Anthropic↔OpenAI proxy-transform pipeline and image probe are out of scope
 * and reported as not-tested). Self-contained: only `node:` builtins plus the
 * global `fetch`/AbortSignal, so web-server stays zero-runtime-dep.
 *
 * @module @rin/web-server
 */

export type ProviderApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses'

export interface ProviderModelInfo {
  id: string
  label?: string
  contextWindow?: number
  supportsImages?: boolean
}

export interface ProviderTestStepResult {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  modelMatched?: boolean
  httpStatus?: number
}

export interface ProviderModelCheckResult {
  roles: string[]
  requestedModel: string
  result: ProviderTestStepResult
}

export interface ProviderTestResult {
  connectivity: ProviderTestStepResult
  proxy?: ProviderTestStepResult
  modelChecks?: ProviderModelCheckResult[]
  allModelsPassed?: boolean
}

export interface ProviderModelDiscoveryResult {
  models: ProviderModelInfo[]
  endpoint: string
  cached: boolean
}

export interface ProviderTestInput {
  baseUrl: string
  apiKey: string
  modelId: string
  models?: { main: string; haiku: string; sonnet: string; opus: string }
  presetId?: string
  apiFormat?: ProviderApiFormat
}

export type OpenAICompatibleEndpoint = 'chat/completions' | 'responses' | 'models'

/** Append an OpenAI-compatible endpoint path to a provider base URL. */
export function buildOpenAICompatibleUrl(baseUrl: string, endpoint: OpenAICompatibleEndpoint): string {
  const base = baseUrl.replace(/\/+$/, '')
  try {
    const parsed = new URL(base)
    const path = parsed.pathname.replace(/\/+$/, '')
    const alreadyVersioned = /\/v\d+(?:beta)?(?:\/openai)?$/.test(path)
    const suffix = alreadyVersioned ? endpoint : `v1/${endpoint}`
    parsed.pathname = `${path}/${suffix}`.replace(/\/{2,}/g, '/')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const alreadyVersioned = /\/v\d+(?:beta)?(?:\/openai)?$/.test(base)
    return `${base}/${alreadyVersioned ? endpoint : `v1/${endpoint}`}`
  }
}

/* ------------------------------ connectivity ------------------------------ */

const MODEL_ROLES = ['main', 'haiku', 'sonnet', 'opus'] as const

/** Test one provider config: direct upstream call per distinct model, no proxy transform. */
export async function testProviderConfig(input: ProviderTestInput, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ProviderTestResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const format: ProviderApiFormat = input.apiFormat ?? 'anthropic'
  const base = input.baseUrl.replace(/\/+$/, '')
  const apiKey = input.apiKey.trim() || 'local-provider'
  const models = {
    main: input.models?.main ?? input.modelId,
    haiku: input.models?.haiku ?? input.modelId,
    sonnet: input.models?.sonnet ?? input.modelId,
    opus: input.models?.opus ?? input.modelId,
  }

  const grouped = new Map<string, { requestedModel: string; roles: string[] }>()
  for (const role of MODEL_ROLES) {
    const requestedModel = models[role]
    const key = requestedModel.toLowerCase()
    const existing = grouped.get(key)
    if (existing) existing.roles.push(role)
    else grouped.set(key, { requestedModel, roles: [role] })
  }
  const checks = [...grouped.values()]
  const mainCheck = checks.find(check => check.roles.includes('main')) ?? checks[0]
  if (mainCheck === undefined) {
    return { connectivity: { success: false, latencyMs: 0, error: 'no model to test' }, modelChecks: [], allModelsPassed: false }
  }

  const step1 = await testConnectivity(base, apiKey, mainCheck.requestedModel, format, fetchImpl, timeoutMs)
  const modelChecks: ProviderModelCheckResult[] = [{ roles: mainCheck.roles, requestedModel: mainCheck.requestedModel, result: step1 }]

  if (!step1.success) {
    return { connectivity: step1, modelChecks, allModelsPassed: false }
  }

  const secondary = await Promise.all(checks
    .filter(check => check !== mainCheck)
    .map(async check => ({
      roles: check.roles,
      requestedModel: check.requestedModel,
      result: await testConnectivity(base, apiKey, check.requestedModel, format, fetchImpl, timeoutMs),
    })))
  modelChecks.push(...secondary)

  return { connectivity: step1, modelChecks, allModelsPassed: modelChecks.every(check => check.result.success) }
}

async function testConnectivity(
  base: string,
  apiKey: string,
  modelId: string,
  format: ProviderApiFormat,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProviderTestStepResult> {
  const start = Date.now()
  try {
    const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format)
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const resBody = await response.json().catch(() => null) as Record<string, unknown> | null
    const latencyMs = Date.now() - start

    if (!response.ok) {
      let error = `HTTP ${response.status}`
      if (resBody?.error && typeof resBody.error === 'object') {
        error = String((resBody.error as Record<string, unknown>).message ?? error)
      }
      return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
    }

    const valid = validateResponseBody(resBody, format)
    if (!valid.ok) {
      return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
    }
    const modelUsed = valid.model ?? modelId
    return {
      success: true,
      latencyMs,
      modelUsed,
      modelMatched: modelUsed.trim().toLowerCase() === modelId.trim().toLowerCase(),
      httpStatus: response.status,
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { success: false, latencyMs, error: 'Request timed out', modelUsed: modelId }
    }
    return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
  }
}

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ProviderApiFormat,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'
  if (format === 'openai_chat') {
    return {
      url: buildOpenAICompatibleUrl(base, 'chat/completions'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
    }
  }
  if (format === 'openai_responses') {
    return {
      url: buildOpenAICompatibleUrl(base, 'responses'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  return {
    url: `${base}/v1/messages`,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
  }
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ProviderApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: String((body.error as Record<string, unknown>).message ?? 'Error in response body') }
  }
  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return typeof body.model === 'string' ? { ok: true, model: body.model } : { ok: true }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return typeof body.model === 'string' ? { ok: true, model: body.model } : { ok: true }
  }
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return typeof body.model === 'string' ? { ok: true, model: body.model } : { ok: true }
}

/* ---------------------------- model discovery ----------------------------- */

export interface DiscoveryInput {
  baseUrl: string
  apiKey?: string
  apiFormat: ProviderApiFormat
  presetId?: string
}

type CachedDiscovery = { expiresAt: number; endpoint: string; models: ProviderModelInfo[] }

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CachedDiscovery>()

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl.replace(/\/+$/, '')
  }
}

function isOllama(input: DiscoveryInput): boolean {
  if (input.presetId === 'ollama') return true
  try {
    return new URL(input.baseUrl).port === '11434'
  } catch {
    return false
  }
}

function isLmStudio(input: DiscoveryInput): boolean {
  if (input.presetId === 'lmstudio') return true
  try {
    return new URL(input.baseUrl).port === '1234'
  } catch {
    return false
  }
}

function modelRecords(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
  }
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  for (const key of ['data', 'models', 'items']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    }
  }
  return []
}

function modelId(record: Record<string, unknown>): string | undefined {
  for (const key of ['id', 'model', 'name', 'key']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1_000) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[,_\s]/g, ''), 10)
    if (Number.isFinite(parsed) && parsed >= 1_000) return parsed
  }
  return undefined
}

function findContextWindow(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== 'object' || depth > 3) return undefined
  const record = value as Record<string, unknown>
  const directKeys = ['context_window', 'contextWindow', 'context_length', 'contextLength', 'max_context_length', 'maxContextLength', 'loaded_context_length']
  for (const key of directKeys) {
    const parsed = parsePositiveInteger(record[key])
    if (parsed) return parsed
  }
  for (const [key, nested] of Object.entries(record)) {
    if (/context(?:_length)?$/i.test(key)) {
      const parsed = parsePositiveInteger(nested)
      if (parsed) return parsed
    }
  }
  for (const nested of Object.values(record)) {
    const parsed = findContextWindow(nested, depth + 1)
    if (parsed) return parsed
  }
  return undefined
}

function parseCapabilities(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  const enabled = entries.filter(([, state]) => state === true).map(([name]) => name)
  return entries.some(([, state]) => typeof state === 'boolean') ? enabled : undefined
}

function supportsImages(record: Record<string, unknown>): boolean | undefined {
  const direct = record.supports_images ?? record.supportsImages
  if (typeof direct === 'boolean') return direct
  const modalities = record.modalities
  const modalityRecord = modalities && typeof modalities === 'object' && !Array.isArray(modalities)
    ? modalities as Record<string, unknown>
    : undefined
  const candidates = [record.capabilities, record.input_modalities, record.inputModalities, modalityRecord?.input, modalityRecord?.inputs, Array.isArray(modalities) ? modalities : undefined]
  let hasExplicitMetadata = false
  for (const candidate of candidates) {
    const capabilities = parseCapabilities(candidate)
    if (!capabilities) continue
    hasExplicitMetadata = true
    if (capabilities.some(capability => /^(?:vision|image|images|image_input|input_image|multimodal)$/i.test(capability.trim()))) return true
  }
  return hasExplicitMetadata ? false : undefined
}

function toModelInfo(record: Record<string, unknown>): ProviderModelInfo | undefined {
  const id = modelId(record)
  if (!id) return undefined
  const contextWindow = findContextWindow(record)
  const imageSupport = supportsImages(record)
  return {
    id,
    ...(typeof record.display_name === 'string' && { label: record.display_name }),
    ...(contextWindow && { contextWindow }),
    ...(imageSupport !== undefined && { supportsImages: imageSupport }),
  }
}

function dedupeModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const byId = new Map<string, ProviderModelInfo>()
  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    if (!key) continue
    const existing = byId.get(key)
    byId.set(key, { ...existing, ...model, id: existing?.id ?? model.id.trim() })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
}

function authHeaders(input: DiscoveryInput): Record<string, string> {
  const key = input.apiKey?.trim()
  if (!key) return { Accept: 'application/json' }
  return { Accept: 'application/json', Authorization: `Bearer ${key}`, 'x-api-key': key, 'anthropic-version': '2023-06-01' }
}

function discoveryEndpoints(input: DiscoveryInput): string[] {
  const endpoints: string[] = []
  if (isOllama(input)) endpoints.push(`${originOf(input.baseUrl)}/api/tags`)
  if (isLmStudio(input)) endpoints.push(`${originOf(input.baseUrl)}/api/v1/models`)
  endpoints.push(buildOpenAICompatibleUrl(input.baseUrl, 'models'))
  return [...new Set(endpoints)]
}

/** Discover a provider's model list from its model-list endpoint(s). */
export async function discoverProviderModels(
  input: DiscoveryInput,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; force?: boolean } = {},
): Promise<ProviderModelDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 5_000
  const cacheKey = [input.presetId ?? '', input.apiFormat, input.baseUrl.replace(/\/+$/, '').toLowerCase()].join('|')
  const cached = cache.get(cacheKey)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return { models: cached.models, endpoint: cached.endpoint, cached: true }
  }

  let lastError = ''
  for (const endpoint of discoveryEndpoints(input)) {
    try {
      const response = await fetchImpl(endpoint, { headers: authHeaders(input), signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        continue
      }
      let models = modelRecords(await response.json()).map(toModelInfo).filter((model): model is ProviderModelInfo => model !== undefined)
      if (models.length === 0) {
        lastError = 'The endpoint returned no model IDs'
        continue
      }
      models = dedupeModels(models)
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, endpoint, models })
      return { models, endpoint, cached: false }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError ? `Unable to discover models: ${lastError}` : 'This provider does not expose a model-list endpoint')
}

export function clearProviderDiscoveryCache(): void {
  cache.clear()
}
