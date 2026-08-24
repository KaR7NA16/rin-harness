/**
 * rin codegraph — Cordis plugin entry.
 *
 * Exposes a ctx.codegraph service that builds and reads a per-project SQLite
 * code graph. The indexer is in-process web-tree-sitter (pure WASM); the
 * service owns the lifecycle (enable/disable/rebuild + lazy auto-index) and
 * derives ranked visualization, architecture summary, and aggregate stats,
 * ported from the legacy desktop codegraph service.
 *
 * @module @rin/context
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import { getCodeGraphArchitecture, getCodeGraphVisualization, formatCodeGraphArchitecture } from './analysis.ts'
import { indexProject } from './indexer.ts'
import type { CodeGraphArchitecture, CodeGraphVisualization } from './analysis.ts'
import { openCodeGraphDatabaseForRead } from './db.ts'

export type * from './analysis.ts'
export { confidenceForProvenance, formatCodeGraphArchitecture, getCodeGraphArchitecture, getCodeGraphVisualization } from './analysis.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    codegraph: CodeGraphService
  }
}

/** Bundled grammar languages, in display order. */
export const CODEGRAPH_BUNDLED_LANGUAGES = [
  'HTML (embedded JavaScript)', 'TypeScript', 'TSX', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C', 'PHP', 'Lua', 'Solidity',
] as const

/** Lifecycle state of one project's code graph. */
export type CodeGraphState = 'disabled' | 'preparing' | 'indexing' | 'ready' | 'empty' | 'error'

/** Aggregate graph stats read from the SQLite database. */
export interface CodeGraphStats {
  fileCount: number
  nodeCount: number
  edgeCount: number
  errorFileCount: number
  dbSizeBytes: number
  lastUpdated: number | null
  filesByLanguage: Record<string, number>
}

/** Full per-project status surfaced to the token-optimization UI. */
export interface CodeGraphStatus {
  projectPath: string
  indexable: boolean
  enabled: boolean
  state: CodeGraphState
  progress: { phase: string; current: number; total: number; currentFile?: string } | null
  stats: CodeGraphStats | null
  error: string | null
  bundledLanguages: readonly string[]
}

/** Global enable flag surfaced to the token-optimization UI. */
export interface CodeGraphGlobalStatus {
  enabled: boolean
}

/** Error marking a project path that must never be indexed wholesale. */
class CodeGraphProjectScopeError extends Error {
  constructor(message: string, readonly projectPath: string) {
    super(message)
    this.name = 'CodeGraphProjectScopeError'
  }
}

const CONFIG_VERSION = 1
interface StoredConfig { version: number; enabled: boolean }

interface RuntimeState {
  status: CodeGraphStatus
  generation: number | null
}

/** The code-graph service exposed on the shared context. */
export abstract class CodeGraphService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'codegraph')
  }

  abstract visualization(projectPath: string, limit?: number): CodeGraphVisualization
  abstract architecture(projectPath: string): { architecture: CodeGraphArchitecture; text: string }
  abstract status(projectPath: string): CodeGraphStatus
  abstract enable(projectPath: string): Promise<CodeGraphStatus>
  abstract disable(projectPath: string): Promise<CodeGraphStatus>
  abstract rebuild(projectPath: string): Promise<CodeGraphStatus>
  abstract globalStatus(): CodeGraphGlobalStatus
  abstract enableGlobal(): CodeGraphGlobalStatus
  abstract disableGlobal(): Promise<CodeGraphGlobalStatus>
}

/** File-backed implementation indexing and reading a project's .codegraph db. */
export class FileCodeGraphService extends CodeGraphService {
  private readonly runtimes = new Map<string, RuntimeState>()
  private lifecycleGeneration = 0

  private dbPath(projectPath: string): string {
    return join(projectPath, '.codegraph', 'codegraph.db')
  }

  override visualization(projectPath: string, limit = 120) {
    return getCodeGraphVisualization(this.dbPath(projectPath), limit)
  }

  override architecture(projectPath: string) {
    const graph = getCodeGraphArchitecture(this.dbPath(projectPath))
    return { architecture: graph.architecture, text: formatCodeGraphArchitecture(graph) }
  }

  override globalStatus(): CodeGraphGlobalStatus {
    return { enabled: this.readConfig().enabled }
  }

  override enableGlobal(): CodeGraphGlobalStatus {
    this.setGlobalEnabled(true)
    for (const runtime of this.runtimes.values()) {
      runtime.status.enabled = true
      runtime.status.error = null
      if (runtime.generation === null) this.startIndex(runtime.status.projectPath)
    }
    return this.globalStatus()
  }

  override async disableGlobal(): Promise<CodeGraphGlobalStatus> {
    this.lifecycleGeneration += 1
    this.setGlobalEnabled(false)
    for (const runtime of this.runtimes.values()) {
      runtime.generation = null
      runtime.status = {
        ...runtime.status,
        enabled: false,
        state: 'disabled',
        progress: null,
        error: null,
        stats: this.readStats(runtime.status.projectPath),
      }
    }
    return this.globalStatus()
  }

  override async enable(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    this.setGlobalEnabled(true)
    const runtime = this.getOrCreateRuntime(canonicalPath, true)
    runtime.status.enabled = true
    runtime.status.error = null
    if (runtime.generation === null) this.startIndex(canonicalPath)
    return this.cloneStatus(runtime.status)
  }

  override async disable(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    this.lifecycleGeneration += 1
    const runtime = this.getOrCreateRuntime(canonicalPath, false)
    runtime.generation = null
    runtime.status = {
      ...runtime.status,
      enabled: false,
      state: 'disabled',
      progress: null,
      error: null,
      stats: this.readStats(canonicalPath),
    }
    return this.cloneStatus(runtime.status)
  }

  override async rebuild(projectPath: string): Promise<CodeGraphStatus> {
    const canonicalPath = this.resolveProjectPath(projectPath)
    if (!this.isProjectEnabled(canonicalPath)) throw new Error('Enable Code Graph before rebuilding the index')
    const runtime = this.getOrCreateRuntime(canonicalPath, true)
    if (runtime.generation === null) this.startIndex(canonicalPath)
    return this.cloneStatus(runtime.status)
  }

  override status(projectPath: string): CodeGraphStatus {
    let canonicalPath: string
    try {
      canonicalPath = this.resolveProjectPath(projectPath)
    } catch (error) {
      if (error instanceof CodeGraphProjectScopeError) {
        return {
          projectPath: error.projectPath,
          indexable: false,
          enabled: this.readConfig().enabled,
          state: 'disabled',
          progress: null,
          stats: null,
          error: null,
          bundledLanguages: CODEGRAPH_BUNDLED_LANGUAGES,
        }
      }
      throw error
    }
    const enabled = this.isProjectEnabled(canonicalPath)
    const runtime = this.getOrCreateRuntime(canonicalPath, enabled)
    runtime.status.enabled = enabled
    if (runtime.generation === null && runtime.status.state !== 'error') {
      runtime.status.stats = this.readStats(canonicalPath)
      runtime.status.state = enabled ? this.stateForStats(runtime.status.stats) : 'disabled'
    }
    if (enabled && runtime.generation === null && runtime.status.stats === null) {
      this.startIndex(canonicalPath)
    }
    return this.cloneStatus(runtime.status)
  }

  private startIndex(projectPath: string): void {
    const runtime = this.getOrCreateRuntime(projectPath, true)
    if (runtime.generation !== null) return
    const generation = this.lifecycleGeneration
    runtime.generation = generation
    runtime.status = {
      ...runtime.status,
      enabled: true,
      state: 'preparing',
      progress: { phase: 'preparing', current: 0, total: 0 },
      error: null,
    }
    void this.runIndex(projectPath, generation)
  }

  private async runIndex(projectPath: string, generation: number): Promise<void> {
    const runtime = this.getOrCreateRuntime(projectPath, true)
    try {
      await indexProject(projectPath, (progress) => {
        if (runtime.generation !== generation || generation !== this.lifecycleGeneration || !this.isProjectEnabled(projectPath)) return
        runtime.status.state = 'indexing'
        runtime.status.progress = {
          phase: 'indexing',
          current: progress.current,
          total: progress.total,
          ...(progress.currentFile !== undefined ? { currentFile: progress.currentFile } : {}),
        }
      })
      if (runtime.generation !== generation) return
      if (generation !== this.lifecycleGeneration || !this.isProjectEnabled(projectPath)) {
        runtime.generation = null
        return
      }
      const nextStats = this.readStats(projectPath)
      runtime.status = {
        ...runtime.status,
        state: this.stateForStats(nextStats),
        progress: null,
        stats: nextStats,
        error: null,
      }
      if (runtime.generation === generation) runtime.generation = null
    } catch (error) {
      if (runtime.generation !== generation) return
      if (generation !== this.lifecycleGeneration) {
        runtime.generation = null
        return
      }
      if (!this.isProjectEnabled(projectPath)) {
        runtime.generation = null
        runtime.status = { ...runtime.status, enabled: false, state: 'disabled', progress: null, error: null }
        return
      }
      runtime.generation = null
      runtime.status = {
        ...runtime.status,
        state: 'error',
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private getOrCreateRuntime(projectPath: string, enabled: boolean): RuntimeState {
    const existing = this.runtimes.get(projectPath)
    if (existing !== undefined) return existing
    const stats = this.readStats(projectPath)
    const runtime: RuntimeState = {
      status: {
        projectPath,
        indexable: true,
        enabled,
        state: enabled ? this.stateForStats(stats) : 'disabled',
        progress: null,
        stats,
        error: null,
        bundledLanguages: CODEGRAPH_BUNDLED_LANGUAGES,
      },
      generation: null,
    }
    this.runtimes.set(projectPath, runtime)
    return runtime
  }

  private readStats(projectPath: string): CodeGraphStats | null {
    const dbPath = this.dbPath(projectPath)
    if (!existsSync(dbPath)) return null
    let db: ReturnType<typeof openCodeGraphDatabaseForRead>
    try {
      db = openCodeGraphDatabaseForRead(dbPath)
    } catch {
      return null
    }
    try {
      const counts = db.query(`
        SELECT
          (SELECT COUNT(*) FROM files) AS file_count,
          (SELECT COUNT(*) FROM nodes) AS node_count,
          (SELECT COUNT(*) FROM edges) AS edge_count,
          (SELECT COUNT(*) FROM files WHERE errors IS NOT NULL AND errors NOT IN ('', '[]')) AS error_file_count,
          (SELECT MAX(indexed_at) FROM files) AS last_updated
      `).get() as { file_count?: unknown; node_count?: unknown; edge_count?: unknown; error_file_count?: unknown; last_updated?: unknown } | undefined
      if (counts === undefined) return null
      const languages = db.query('SELECT language, COUNT(*) AS count FROM files GROUP BY language ORDER BY count DESC').all() as Array<{ language: string; count: unknown }>
      const relatedFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
      const dbSizeBytes = relatedFiles.reduce((total, filePath) => total + (existsSync(filePath) ? statSync(filePath).size : 0), 0)
      return {
        fileCount: Number(counts.file_count ?? 0),
        nodeCount: Number(counts.node_count ?? 0),
        edgeCount: Number(counts.edge_count ?? 0),
        errorFileCount: Number(counts.error_file_count ?? 0),
        dbSizeBytes,
        lastUpdated: counts.last_updated == null ? null : Number(counts.last_updated),
        filesByLanguage: Object.fromEntries(languages.map(entry => [entry.language, Number(entry.count ?? 0)])),
      }
    } catch {
      return null
    } finally {
      db.close()
    }
  }

  private resolveProjectPath(projectPath: string): string {
    const trimmed = projectPath.trim()
    if (trimmed === '') throw new Error('Project path is required')
    let resolved: string
    try {
      resolved = realpathSync(resolve(trimmed))
    } catch {
      throw new Error('Project path is not a directory')
    }
    if (!statSync(resolved).isDirectory()) throw new Error('Project path is not a directory')
    if (parse(resolved).root === resolved) {
      throw new CodeGraphProjectScopeError('Code Graph cannot index an entire filesystem root', resolved)
    }
    if (resolved === realpathSync(homedir())) {
      throw new CodeGraphProjectScopeError('Code Graph cannot index the entire user home directory', resolved)
    }
    return resolved
  }

  private stateForStats(stats: CodeGraphStats | null): CodeGraphState {
    if (stats === null) return 'preparing'
    return stats.nodeCount > 0 ? 'ready' : 'empty'
  }

  private isProjectEnabled(_projectPath: string): boolean {
    return this.readConfig().enabled
  }

  private configPath(): string {
    return join(homedir(), '.rin', 'codegraph.json')
  }

  private readConfig(): StoredConfig {
    const configPath = this.configPath()
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<StoredConfig>
      return { version: CONFIG_VERSION, enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true }
    } catch {
      return { version: CONFIG_VERSION, enabled: true }
    }
  }

  private setGlobalEnabled(enabled: boolean): void {
    const configPath = this.configPath()
    mkdirSync(dirname(configPath), { recursive: true })
    const temporaryPath = `${configPath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify({ version: CONFIG_VERSION, enabled }, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, configPath)
  }

  private cloneStatus(status: CodeGraphStatus): CodeGraphStatus {
    return structuredClone(status)
  }
}

export const name = 'codegraph'
export const inject: string[] = []

/** Install the file-backed code-graph service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileCodeGraphService)
}
