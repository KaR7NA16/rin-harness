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
import type { AgentMigrationService } from '@rin/agent-migration'
import type { ComputerUseService } from '@rin/computer-use'
import type { FilesystemService } from '@rin/filesystem'
import type { McpStore } from '@rin/mcp'
import type { SessionBackupService } from '@rin/session-backup'
import type { CodeGraphService } from '@rin/codegraph'
import type { PluginService } from '@rin/plugins'
import type { ProviderProbeService } from '@rin/provider-probe'
import type { TaskStore } from '@rin/tasks'
import type { TeamStore } from '@rin/teams'
import type { DshAgentDefaultModelLike, DshAgentRegistryLike, DshCommandsLike, DshCredentialsLike, DshLlmLike, DshPermissionPresetsLike, DshSessionPersistenceLike, DshSessionProjectionsLike, DshSessionStoreLike, DshSettingsLike, DshShellLike, DshTokenMeterLike, DshWorkspaceRegistryLike, RinServiceRefs } from './routes.ts'

export type * from './types.ts'
export { createWebServer } from './server.ts'
export type { RinWebServer } from './server.ts'
export {
  RIN_WEB_NAME,
  RIN_WEB_VERSION,
  parseBoolean,
  parseRepositoryQuery,
  isPathWithin,
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
  splitHostHeader,
  isAllowedHostHeader,
  isSameOrigin,
  extractBearerToken,
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
  authToken: z.string(),
  repositoryRoot: z.string(),
  staticRoot: z.string(),
  knowledgeDbPath: z.string(),
  knowledgeSourcesRoots: z.array(z.string()),
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
      filesystem: () => ctx.get('filesystem') as unknown as FilesystemService | undefined,
      sessionBackup: () => ctx.get('sessionBackup') as unknown as SessionBackupService | undefined,
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
      sessionTitle: () => ctx.get('sessionTitle') as unknown as { rename(session: unknown, title: string): Promise<void> | void } | undefined,
      dshAgents: () => ctx.get('agents') as unknown as DshAgentRegistryLike | undefined,
      agentDefaultModel: () => ctx.get('agentDefaultModel') as unknown as DshAgentDefaultModelLike | undefined,
      settings: () => ctx.get('settings') as unknown as DshSettingsLike | undefined,
      permissionPresets: () => ctx.get('permissionPresets') as unknown as DshPermissionPresetsLike | undefined,
      llm: () => ctx.get('llm') as unknown as DshLlmLike | undefined,
      credentials: () => ctx.get('credentials') as unknown as DshCredentialsLike | undefined,
      workspaceRegistry: () => ctx.get('workspaceRegistry') as unknown as DshWorkspaceRegistryLike | undefined,
      commands: () => ctx.get('commands') as unknown as DshCommandsLike | undefined,
      tokenMeter: () => ctx.get('tokenMeter') as unknown as DshTokenMeterLike | undefined,
      sessionProjections: () => ctx.get('sessionProjections') as unknown as DshSessionProjectionsLike | undefined,
      shell: () => ctx.get('shell') as unknown as DshShellLike | undefined,
      mcp: () => ctx.get('mcp') as unknown as McpStore | undefined,
      providerProbe: () => ctx.get('providerProbe') as unknown as ProviderProbeService | undefined,
      plugins: () => ctx.get('plugins') as unknown as PluginService | undefined,
      codegraph: () => ctx.get('codegraph') as unknown as CodeGraphService | undefined,
      teams: () => ctx.get('teams') as unknown as TeamStore | undefined,
      tasks: () => ctx.get('tasks') as unknown as TaskStore | undefined,
      computerUse: () => ctx.get('computerUse') as unknown as ComputerUseService | undefined,
      agentMigration: () => ctx.get('agentMigration') as unknown as AgentMigrationService | undefined,
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
