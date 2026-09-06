/**
 * rin launcher — host assembly and boot.
 *
 * Boots the @rin/host assembly through @deepseek-ai/dsh-app-boot's boot: the
 * @rin/host cordis.yml is the entry list, dsh-base's patch layer is applied
 * underneath it, and the --port/--host flags replace the web-server row. The
 * boot is fail-loud (installFailLoud + boot's activation audit). Boot is
 * deferred to the real machine; the strip-types smoke test only asserts the
 * assembly metadata, never this module.
 *
 * @module @rin/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { registerPromptMemorySeam, type PromptMemorySeam } from '@rin/memory/prompt'
import {
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  credentialsPath,
  defaultConfig,
  dshHome,
  rinHome,
  sessionRoot,
  settingsPath,
  webUiDistRoot,
} from '@rin/host'
/** Host address overrides accepted by application launchers. */
export interface HostOptions {
  port?: number
  host?: string
}

/** A booted rin host: its address and a disposer. */
export interface RinHost {
  /** The Web-server port the host was assembled with. */
  port: number
  /** The Web-server host the host was assembled with. */
  host: string
  /** The Web-server base URL (http://host:port). */
  baseUrl: string
  /** Dispose the whole Cordis tree (server, plugins, timers). */
  close(): Promise<void>
}

/**
 * Boot the @rin/host assembly and return its address.
 *
 * The web-server row is always re-stated from the resolved default config so
 * --port/--host override deterministically; every other plugin keeps its
 * cordis.yml `!!js` defaults, which the prepare hook resolves by providing the
 * rinHome and builtinRepositoryRoot helpers on the boot context.
 * @param args - the parsed invocation.
 * @returns the booted host handle.
 * @throws when the plugin tree fails to load or activate (fail-loud).
 */
export async function startHost(args: HostOptions = {}): Promise<RinHost> {
  installFailLoud('rin')
  if (process.env.DSH_HOME === undefined || process.env.DSH_HOME.trim() === '') {
    process.env.DSH_HOME = dshHome()
  }

  const port = args.port ?? defaultConfig['web-server'].port
  const host = args.host ?? defaultConfig['web-server'].host
  const basePatches = loadOverlayPatches('rin', baseBundlePatchPath())
  const overrides = [{
    id: 'web-server',
    config: { ...defaultConfig['web-server'], port, host },
  }, {
    // Make the three dsh file-backed persistence seams explicit. The path
    // helpers honor RIN_* overrides and otherwise follow the resolved homes.
    id: 'session-persistence-jsonl',
    config: { root: sessionRoot() },
  }, {
    id: 'settings',
    config: {
      path: settingsPath(),
      dshHome: dshHome(),
    },
  }, {
    id: 'credentials',
    config: {
      path: credentialsPath(),
      dshHome: dshHome(),
    },
  }, {
    // dsh-base mounts session-query-sqlite with path ':memory:' and openAt 'never'
    // (content search disabled; exact reads stay live). rin enables full-text
    // search lazily over a durable index under the rin home, so the first model
    // search opens the SQLite file and later searches reuse it.
    id: 'session-query-sqlite',
    config: {
      path: rinHome('sessions/search.sqlite'),
      openAt: 'first-search',
    },
  }, {
    // Enable Code Mode alongside native tools: 'both' exposes the run_code
    // transport plus the generated SDK prompt while keeping every native tool
    // callable. The bundle's code-runtime row registers the ctx.codeRuntime
    // this mode requires; without it dsh-tools fails prompt assembly loudly.
    id: 'tools',
    config: { mode: 'both' },
  }, {
    // dsh-base mounts tool-bash, a non-persistent `bash` tool; the bundle's
    // tool-bash-persistent row registers the same `bash` name over the
    // terminal chain. Disable the base row so the duplicate registration never
    // happens (dsh-tools rejects a second global `bash` at load).
    id: 'tool-bash',
    disabled: true,
  }, ...(process.env.RIN_PACKAGED_RUNTIME === '1' ? [{
    // HMR depends on Node's development-only internal module hooks. Packaged
    // desktop runtimes load immutable resources and must not activate it.
    id: 'hmr',
    disabled: true,
  }] : [])]

  const ctx = await boot(
    'rin',
    configPath(),
    [...basePatches, ...overrides],
    (hostCtx: Context) => {
      hostCtx.provide('rinHome', rinHome)
      hostCtx.provide('dshHome', dshHome)
      hostCtx.provide('sessionRoot', sessionRoot)
      hostCtx.provide('settingsPath', settingsPath)
      hostCtx.provide('credentialsPath', credentialsPath)
      hostCtx.provide('builtinRepositoryRoot', builtinRepositoryRoot)
      hostCtx.provide('webUiDistRoot', webUiDistRoot)
    },
    process.env.RIN_BARE_MODULE_BASE_URL?.trim() || undefined,
  )
  await registerRinPromptMemorySeam(ctx)

  return {
    port,
    host,
    baseUrl: `http://${host}:${port}`,
    close: async () => { await ctx.fiber.dispose() },
  }
}

/** Register the host-wide memory projection after all isolated entries are mounted. */
export async function registerRinPromptMemorySeam(ctx: Context): Promise<void> {
  const root = ctx.root
  const systemPrompt = root.get('systemPrompt')
  if (systemPrompt === undefined) {
    throw new Error('rin host: root systemPrompt service is required')
  }
  const seam: PromptMemorySeam = {
    systemPrompt,
    on: root.on.bind(root) as PromptMemorySeam['on'],
    effect: root.effect.bind(root) as unknown as PromptMemorySeam['effect'],
  }
  const memory = root.get('memory')
  if (memory !== undefined) seam.memory = memory
  await registerPromptMemorySeam(seam, {
    injectSoul: true,
    injectBrief: true,
  })
}
