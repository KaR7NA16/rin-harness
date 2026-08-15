/**
 * rin launcher — assembly metadata strip-types smoke.
 *
 * Asserts the @rin/bundle roster is complete and correctly scoped: all seventeen
 * @rin host plugins plus the web-server, dsh-base first, and dsh-web-app
 * absent (MIGRATION.md §8 decision 10). Pure data assertions — no Cordis boot.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/host.smoke.ts
 */

import {
  ASSEMBLY_LAYERS,
  BASE_BUNDLE,
  defaultConfig,
  EXCLUDED_BUNDLE,
  RIN_HOST_PLUGINS,
  RIN_PLUGINS,
  RIN_WEB_SERVER,
} from '../../../bundle/rin/src/index.ts'

// 1. Exactly seventeen @rin host plugins, web-server separate, eighteen total.
if (RIN_HOST_PLUGINS.length !== 17) throw new Error('expected 17 @rin host plugins, got ' + RIN_HOST_PLUGINS.length)
if (RIN_WEB_SERVER !== '@rin/web-server') throw new Error('RIN_WEB_SERVER mismatch')
if (RIN_PLUGINS.length !== 18) throw new Error('expected 18 @rin plugins, got ' + RIN_PLUGINS.length)

const expectedHost = [
  '@rin/repository',
  '@rin/environment',
  '@rin/knowledge',
  '@rin/prompt-memory',
  '@rin/skill-memory',
  '@rin/session-search',
  '@rin/evolution',
  '@rin/token-optimization',
  '@rin/smart-pruning',
  '@rin/notes',
  '@rin/agents',
  '@rin/sandboxes',
  '@rin/tasks',
  '@rin/mcp',
  '@rin/computer-use',
  '@rin/agent-migration',
  '@rin/teams',
]
for (const name of expectedHost) {
  if (!RIN_HOST_PLUGINS.includes(name)) throw new Error('missing host plugin: ' + name)
  if (!RIN_PLUGINS.includes(name)) throw new Error('missing from RIN_PLUGINS: ' + name)
}

// 2. Assembly order: dsh-base first, no dsh-web-app anywhere.
if (BASE_BUNDLE !== '@deepseek-ai/dsh-base') throw new Error('BASE_BUNDLE mismatch')
if (ASSEMBLY_LAYERS[0] !== BASE_BUNDLE) throw new Error('assembly must start with dsh-base')
if (ASSEMBLY_LAYERS.length !== 19) throw new Error('expected 19 assembly layers, got ' + ASSEMBLY_LAYERS.length)
if (ASSEMBLY_LAYERS.includes(EXCLUDED_BUNDLE)) throw new Error('assembly must not include ' + EXCLUDED_BUNDLE)
if (RIN_PLUGINS.includes(EXCLUDED_BUNDLE)) throw new Error('RIN_PLUGINS must not include ' + EXCLUDED_BUNDLE)

// 3. The web-server plugin carries the one resolved default the launcher overrides.
const configured = Object.keys(defaultConfig).sort()
if (configured.length !== 1) throw new Error('expected 1 configured plugin, got ' + configured.length)
if (defaultConfig['web-server'].port !== 8320) throw new Error('web-server default port must be 8320')
if (defaultConfig['web-server'].host !== '127.0.0.1') throw new Error('web-server default host mismatch')
if (defaultConfig['web-server'].enabled !== true) throw new Error('web-server default enabled mismatch')

console.log('HOST-SMOKE-OK', { hostPlugins: RIN_HOST_PLUGINS.length, plugins: RIN_PLUGINS.length, layers: ASSEMBLY_LAYERS.length, configured: configured.length })
