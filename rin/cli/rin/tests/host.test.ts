/**
 * rin launcher — assembly metadata contract tests.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test
 * (tests/host.smoke.ts) is run during development.
 *
 * @module @rin/cli
 */

import { describe, expect, test } from 'vitest'
import {
  ASSEMBLY_LAYERS,
  BASE_BUNDLE,
  defaultConfig,
  EXCLUDED_BUNDLE,
  RIN_HOST_PLUGINS,
  RIN_PLUGINS,
  RIN_WEB_SERVER,
} from '../../../bundle/rin/src/index.ts'

describe('@rin/bundle roster', () => {
  test('lists the twelve host plugins plus the web-server', () => {
    expect(RIN_HOST_PLUGINS).toHaveLength(12)
    expect(RIN_WEB_SERVER).toBe('@rin/web-server')
    expect(RIN_PLUGINS).toHaveLength(13)
    expect(RIN_PLUGINS).toEqual(expect.arrayContaining(RIN_HOST_PLUGINS))
  })

  test('starts the assembly with dsh-base and never lists dsh-web-app', () => {
    expect(BASE_BUNDLE).toBe('@deepseek-ai/dsh-base')
    expect(ASSEMBLY_LAYERS[0]).toBe(BASE_BUNDLE)
    expect(ASSEMBLY_LAYERS).toHaveLength(14)
    expect(ASSEMBLY_LAYERS).not.toContain(EXCLUDED_BUNDLE)
    expect(RIN_PLUGINS).not.toContain(EXCLUDED_BUNDLE)
  })
})

describe('@rin/bundle default config', () => {
  test('resolves a default for every plugin that carries one', () => {
    expect(Object.keys(defaultConfig)).toHaveLength(8)
    expect(defaultConfig['web-server']).toMatchObject({ port: 8320, host: '127.0.0.1', enabled: true })
    expect(defaultConfig['prompt-memory'].configRoot).toContain('.rin')
    expect(defaultConfig.agents.defaultRepositoryRoot).toContain('repository')
  })
})
