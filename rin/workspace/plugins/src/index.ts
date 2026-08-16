/**
 * rin plugins — Cordis plugin entry.
 *
 * Exposes a ctx.plugins service listing markdown-based plugins under a root
 * directory (default ~/.rin/plugins). The listing core lives in core.ts and
 * stays cordis-free.
 *
 * @module @rin/plugins
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { getPluginDetail, listPlugins, setPluginEnabled } from './core.ts'
import type { PluginDetail, PluginListResult } from './core.ts'

export type * from './core.ts'
export { getPluginDetail, listPlugins, setPluginEnabled } from './core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    plugins: PluginService
  }
}

/** The plugin service exposed on the shared context. */
export abstract class PluginService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'plugins')
  }

  abstract list(): Promise<PluginListResult>
  abstract detail(id: string): Promise<PluginDetail | undefined>
  abstract setEnabled(id: string, enabled: boolean): Promise<boolean>
}

/** File-backed implementation over a plugins root directory. */
export class FilePluginService extends PluginService {
  private readonly root: string

  constructor(ctx: Context) {
    super(ctx)
    const home = process.env.RIN_HOME !== undefined && process.env.RIN_HOME.trim() !== '' ? process.env.RIN_HOME : join(homedir(), '.rin')
    this.root = join(home, 'plugins')
  }

  override list() {
    return listPlugins(this.root)
  }

  override detail(id: string) {
    return getPluginDetail(this.root, id)
  }

  override setEnabled(id: string, enabled: boolean) {
    return setPluginEnabled(this.root, id, enabled)
  }
}

export const name = 'plugins'
export const inject: string[] = []

/** Install the file-backed plugin service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FilePluginService)
}
