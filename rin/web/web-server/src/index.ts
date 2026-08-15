/**
 * rin web-server — Cordis plugin entry.
 *
 * Runs an independent node:http server (separate from the dsh Web UI) that
 * serves the JSON API and the static frontend. Optional @rin services are read
 * through ctx.get() at request time; the health endpoint reports which are
 * mounted.
 *
 * @module @rin/web-server
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Config as RinWebConfig, SmartPruningRef, TokenOptimizationRef } from './types.ts'
import { errorMessage } from './http.ts'
import { createWebServer } from './server.ts'
import type { DshSessionPersistenceLike, DshSessionStoreLike, RinServiceRefs } from './routes.ts'

export type * from './types.ts'
export { createWebServer } from './server.ts'
export type { RinWebServer } from './server.ts'
export {
  RIN_WEB_NAME,
  RIN_WEB_VERSION,
  parseBoolean,
  parseRepositoryQuery,
  parseEnvironmentPlanQuery,
  json,
  error,
  healthResponse,
  smartPruningStatusResponse,
  notMounted,
  mounted,
  mountedValue,
  queryParam,
  parsePositiveInt,
  parsePromptMemoryTarget,
  errorMessage,
  isSmartPruningLevel,
  isResponseStyle,
  asRecord,
  stringField,
  booleanField,
} from './http.ts'
export { resolveStaticPath, readStaticFile, contentTypeFor } from './static.ts'
export type { StaticFile } from './static.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    smartPruning: SmartPruningRef
    tokenOptimization: TokenOptimizationRef
  }
}

export const name = 'web-server'
export const inject = []

/** Plugin configuration: listen address plus optional roots. */
export const Config: z<RinWebConfig> = z.object({
  port: z.natural().max(65535).default(8320),
  host: z.string().default('127.0.0.1'),
  enabled: z.boolean().default(true),
  repositoryRoot: z.string(),
  staticRoot: z.string(),
  knowledgeDbPath: z.string(),
  skillMemoryRoots: z.object({
    globalConfigRoot: z.string().required(),
    projectConfigRoot: z.string(),
  }),
})

/** The node:http server service installed by apply(). */
export class WebServerService extends Service {
  constructor(ctx: Context, config: RinWebConfig) {
    super(ctx, 'web-server')
    const services: RinServiceRefs = {
      repository: () => ctx.get('repository'),
      environment: () => ctx.get('environment'),
      smartPruning: () => ctx.get('smartPruning'),
      knowledge: () => ctx.get('knowledge'),
      sessionSearch: () => ctx.get('sessionSearch'),
      promptMemory: () => ctx.get('promptMemory'),
      evolution: () => ctx.get('evolution'),
      skillMemory: () => ctx.get('skill-memory'),
      agents: () => ctx.get('rinAgents'),
      notes: () => ctx.get('notes'),
      sandboxes: () => ctx.get('sandboxes'),
      tokenOptimization: () => ctx.get('tokenOptimization'),
      sessions: () => ctx.get('sessions') as unknown as DshSessionStoreLike | undefined,
      sessionPersistence: () => ctx.get('sessionPersistence') as unknown as DshSessionPersistenceLike | undefined,
    }
    const server = createWebServer(config, services)
    ctx.effect(() => () => server.close(), 'web-server.close')
    if (config.enabled === false) {
      ctx.logger.info('rin web-server disabled via Config.enabled=false (listener not started)')
      return
    }
    void server.listen(config.port, config.host).then(
      () => {
        ctx.logger.info('rin web-server listening on http://' + config.host + ':' + config.port)
      },
      (err: unknown) => {
        ctx.logger.error('rin web-server failed to listen: ' + errorMessage(err))
      },
    )
  }
}

/**
 * Install the node:http server service.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: RinWebConfig): void {
  ctx.plugin(WebServerService, config)
}
