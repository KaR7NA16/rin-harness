/**
 * rin web-server — shared types.
 *
 * Owns the plugin configuration and the JSON response envelopes served by the
 * v1 API. Pure types only: no runtime code and no framework imports, so the
 * HTTP helpers (http.ts) and the smoke script can import this module without
 * pulling the cordis graph.
 *
 * @module @rin/web-server
 */

/** Plugin configuration resolved by the Config schema. */
export interface Config {
  /** Listen port; the schema defaults it to 8320. */
  port: number
  /** Listen host (loopback or all-interfaces literal); defaults to 127.0.0.1. */
  host: string
  /** Optional default repository root, used when a request omits ?root=. */
  repositoryRoot?: string
  /** Optional static frontend root; defaults to the package's web/ directory. */
  staticRoot?: string
}

/** Which @rin services are mounted in the composition. */
export interface HealthServices {
  repository: boolean
  environment: boolean
  smartPruning: boolean
}

/** GET /api/health response body. */
export interface HealthBody {
  ok: true
  name: 'rin-web'
  version: string
  services: HealthServices
}

/** Smart-pruning state fields the status endpoint reports. */
export interface SmartPruningStatus {
  enabled: boolean
  level: string
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
}
