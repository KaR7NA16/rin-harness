/**
 * rin launcher — assembly metadata contract tests.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test
 * (tests/host.smoke.ts) is run during development.
 *
 * @module @rin/cli
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ASSEMBLY_LAYERS,
  BASE_BUNDLE,
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  defaultConfig,
  EXCLUDED_BUNDLE,
  RIN_HOST_PLUGINS,
  RIN_PLUGINS,
  RIN_WEB_SERVER,
  webUiDistRoot,
} from '../src/index.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('@rin/host roster', () => {
  test('lists the host plugins plus the web-server', () => {
    expect(RIN_HOST_PLUGINS).toHaveLength(29)
    expect(RIN_WEB_SERVER).toBe('@rin/host/web-server')
    expect(RIN_PLUGINS).toHaveLength(30)
    expect(RIN_PLUGINS).toEqual(expect.arrayContaining(RIN_HOST_PLUGINS))
  })

  test('starts the assembly with dsh-base and never lists dsh-web-app', () => {
    expect(BASE_BUNDLE).toBe('@deepseek-ai/dsh-base')
    expect(ASSEMBLY_LAYERS[0]).toBe(BASE_BUNDLE)
    expect(ASSEMBLY_LAYERS).toHaveLength(31)
    expect(ASSEMBLY_LAYERS).not.toContain(EXCLUDED_BUNDLE)
    expect(RIN_PLUGINS).not.toContain(EXCLUDED_BUNDLE)
  })
})

describe('@rin/host default config', () => {
  test('resolves a default for the web-server plugin the launcher overrides', () => {
    expect(Object.keys(defaultConfig)).toHaveLength(1)
    expect(defaultConfig['web-server']).toMatchObject({ port: 8320, host: '127.0.0.1', enabled: true })
  })

  test('honors the packaged dsh-base patch override', () => {
    vi.stubEnv('RIN_DSH_BASE_PATCH_PATH', './packaged/dsh-base.cordis.patch.yml')
    expect(baseBundlePatchPath()).toMatch(/packaged[/\\]dsh-base\.cordis\.patch\.yml$/)
  })

  test('honors packaged host resource overrides', () => {
    vi.stubEnv('RIN_BUILTIN_REPOSITORY_ROOT', '/runtime/builtin')
    vi.stubEnv('RIN_WEB_UI_DIST_ROOT', '/runtime/web')
    vi.stubEnv('RIN_HOST_CONFIG_PATH', '/runtime/cordis.yml')
    expect(builtinRepositoryRoot()).toBe('/runtime/builtin')
    expect(webUiDistRoot()).toBe('/runtime/web')
    expect(configPath()).toBe('/runtime/cordis.yml')
  })
})
