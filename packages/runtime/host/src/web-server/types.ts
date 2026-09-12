/**
 * rin web-server — shared types.
 *
 * Owns the plugin configuration and the JSON response envelopes served by the
 * v1/v2 API. Pure types only: no runtime code and no framework imports, so the
 * HTTP helpers (http.ts) and the smoke script can import this module without
 * pulling the cordis graph.
 *
 * @module @rin/host/web-server
 */

/** Plugin configuration resolved by the Config schema. */
export interface Config {
  /** Listen port; the schema defaults it to 8320. */
  port: number
  /** Listen host (loopback or all-interfaces literal); defaults to 127.0.0.1. */
  host: string
  /** When false, keep the service mounted (health reports it) but do not listen. Defaults to true. */
  enabled?: boolean
  /** Optional bearer token; when set, every /api/* request must present it via Authorization: Bearer or ?token=. */
  authToken?: string
  /** Maximum JSON bytes accepted by journal restore; defaults to 64 MiB. */
  journalImportMaxBytes?: number
  /** Optional default repository root, used when a request omits ?root=. */
  repositoryRoot?: string
  /** Optional static frontend root; defaults to the package's static/ directory. */
  staticRoot?: string
  /** Optional knowledge database path; knowledge endpoints accept ?db= to override. */
  knowledgeDbPath?: string
  /** Optional allowed roots for /api/knowledge/sources; a source path must resolve inside one of them. */
  knowledgeSourcesRoots?: string[]
  /** Optional skill-memory config roots used by /api/skill-memory/overview. */
  skillMemoryRoots?: SkillMemoryRootsConfig
}

/** Skill-memory configuration roots (mirrors @rin/memory/skill's SkillMemoryRoots). */
export interface SkillMemoryRootsConfig {
  globalConfigRoot: string
  projectConfigRoot?: string
}

/** Prompt-memory file target read by /api/prompt-memory/file. */
export type PromptMemoryTarget = 'soul' | 'brief' | 'user'

/** Which @rin services are mounted in the composition. */
export interface HealthServices {
  repository: boolean
  environment: boolean
  filesystem: boolean
  sessionBackup: boolean
  memory: boolean
  smartPruning: boolean
  knowledge: boolean
  knowledgeGraph: boolean
  sessionSearch: boolean
  promptMemory: boolean
  evolution: boolean
  skillMemory: boolean
  agents: boolean
  notes: boolean
  sandboxes: boolean
  tokenOptimization: boolean
  codegraph: boolean
  plugins: boolean
  providerProbe: boolean
  teams: boolean
  tasks: boolean
  mcp: boolean
  computerUse: boolean
  agentMigration: boolean
  doctor: boolean
}

/** GET /api/health response body. */
export interface HealthBody {
  ok: true
  name: 'rin-web'
  version: string
  services: HealthServices
}

/** The smart-pruning policy levels (mirrors @rin/context/smart-pruning). */
export type SmartPruningLevel = 'conservative' | 'balanced' | 'aggressive'

/** Smart-pruning state fields the status endpoint reports. */
export interface SmartPruningStatus {
  enabled: boolean
  level: SmartPruningLevel
  mode: string
}

/** GET /api/smart-pruning/status response body. */
export type SmartPruningStatusBody =
  | { mounted: false }
  | ({ mounted: true } & SmartPruningStatus)

/** Error envelope returned for every 4xx/5xx response. */
export interface ErrorBody {
  error: string
}

/** A shaped JSON response: HTTP status plus the body to serialize. */
export interface JsonResponse {
  status: number
  body: unknown
}

/** Parsed /api/repository query string. */
export interface RepositoryQuery {
  root: string | undefined
}

/** Parsed /api/environment/plan query string. */
export interface EnvironmentPlanQuery {
  profile: string | undefined
  root: string | undefined
  platform: string
  apt: boolean
  python: boolean
  pip: boolean
  r: boolean
  npm: boolean
  tlmgr: boolean
}

/** Minimal smart-pruning service surface read through ctx.get(). */
export interface SmartPruningRef {
  getStatus(): SmartPruningStatus
  setEnabled(enabled: boolean): SmartPruningStatus
  setLevel(level: SmartPruningLevel): SmartPruningStatus
}

/** Current token-optimization knob values. */
export interface TokenOptimizationStatus {
  cleanPrompt: boolean
}

/** Minimal token-optimization service surface read through ctx.get(). */
export interface TokenOptimizationRef {
  getStatus(): TokenOptimizationStatus
  setCleanPrompt(enabled: boolean): TokenOptimizationStatus
}
