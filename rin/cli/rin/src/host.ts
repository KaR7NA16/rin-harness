/**
 * rin launcher — host assembly and boot.
 *
 * Boots the @rin/bundle assembly through @deepseek-ai/dsh-app-boot's boot: the
 * @rin/bundle cordis.yml is the entry list, dsh-base's patch layer is applied
 * underneath it, and the --port/--host flags replace the web-server row. The
 * boot is fail-loud (installFailLoud + boot's activation audit). Boot is
 * deferred to the real machine; the strip-types smoke test only asserts the
 * assembly metadata, never this module.
 *
 * @module @rin/cli/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import {
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  defaultConfig,
  rinHome,
  webUiDistRoot,
} from '@rin/bundle'
import type { RinArgs } from './args.ts'

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
 * Boot the @rin/bundle assembly and return its address.
 *
 * The web-server row is always re-stated from the resolved default config so
 * --port/--host override deterministically; every other plugin keeps its
 * cordis.yml `!!js` defaults, which the prepare hook resolves by providing the
 * rinHome and builtinRepositoryRoot helpers on the boot context.
 * @param args - the parsed invocation.
 * @returns the booted host handle.
 * @throws when the plugin tree fails to load or activate (fail-loud).
 */
export async function startHost(args: RinArgs): Promise<RinHost> {
  installFailLoud('rin')

  const port = args.port ?? defaultConfig['web-server'].port
  const host = args.host ?? defaultConfig['web-server'].host
  const basePatches = loadOverlayPatches('rin', baseBundlePatchPath())
  const overrides = [{
    id: 'web-server',
    config: { ...defaultConfig['web-server'], port, host },
  }]

  const ctx = await boot(
    'rin',
    configPath(),
    [...basePatches, ...overrides],
    (hostCtx: Context) => {
      hostCtx.provide('rinHome', rinHome)
      hostCtx.provide('builtinRepositoryRoot', builtinRepositoryRoot)
      hostCtx.provide('webUiDistRoot', webUiDistRoot)
    },
  )

  return {
    port,
    host,
    baseUrl: `http://${host}:${port}`,
    close: async () => { await ctx.fiber.dispose() },
  }
}
