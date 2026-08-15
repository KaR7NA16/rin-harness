/**
 * rin launcher — host assembly contract tests.
 *
 * These describe behavior, not correctness: they drive {@link startHost}
 * against a fake @deepseek-ai/dsh-app-boot (no Cordis tree is actually booted)
 * and assert the resolved defaults, the --port/--host override, the prepare
 * hook, and the close disposer.
 *
 * @module @rin/cli
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const appBoot = vi.hoisted(() => ({
  boot: vi.fn(),
  installFailLoud: vi.fn(),
  loadOverlayPatches: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh-app-boot', () => appBoot)

import { startHost } from '../src/host.ts'
import {
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  defaultConfig,
  rinHome,
  webUiDistRoot,
} from '@rin/bundle'
import type { RinArgs } from '../src/args.ts'

function makeArgs(overrides: Partial<RinArgs> = {}): RinArgs {
  return { command: 'default', help: false, version: false, ...overrides }
}

describe('startHost assembly', () => {
  beforeEach(() => {
    appBoot.boot.mockReset()
    appBoot.installFailLoud.mockReset()
    appBoot.loadOverlayPatches.mockReset()
  })

  test('installs fail-loud, loads the base patch layer, and boots the resolved defaults', async () => {
    appBoot.loadOverlayPatches.mockReturnValue([{ id: 'dsh-base' }])
    const dispose = vi.fn().mockResolvedValue(undefined)
    appBoot.boot.mockResolvedValue({ fiber: { dispose } })

    const host = await startHost(makeArgs())

    expect(appBoot.installFailLoud).toHaveBeenCalledWith('rin')
    expect(appBoot.loadOverlayPatches).toHaveBeenCalledWith('rin', baseBundlePatchPath())
    expect(appBoot.boot).toHaveBeenCalledTimes(1)

    const bootCall = appBoot.boot.mock.calls[0]
    expect(bootCall?.[0]).toBe('rin')
    expect(bootCall?.[1]).toBe(configPath())
    const patches = bootCall?.[2] as Array<{ id?: string; config?: Record<string, unknown> }>
    expect(patches).toHaveLength(2)
    expect(patches?.find(patch => patch.id === 'web-server')).toEqual({
      id: 'web-server',
      config: { ...defaultConfig['web-server'], port: defaultConfig['web-server'].port, host: defaultConfig['web-server'].host },
    })

    const provide = vi.fn()
    const prepare = bootCall?.[3] as (ctx: { provide: (key: string, value: unknown) => void }) => void
    prepare({ provide })
    expect(provide).toHaveBeenCalledWith('rinHome', rinHome)
    expect(provide).toHaveBeenCalledWith('builtinRepositoryRoot', builtinRepositoryRoot)
    expect(provide).toHaveBeenCalledWith('webUiDistRoot', webUiDistRoot)

    expect(host.port).toBe(defaultConfig['web-server'].port)
    expect(host.host).toBe(defaultConfig['web-server'].host)
    expect(host.baseUrl).toBe('http://' + defaultConfig['web-server'].host + ':' + defaultConfig['web-server'].port)

    await host.close()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test('overrides port and host from the parsed args', async () => {
    appBoot.loadOverlayPatches.mockReturnValue([])
    appBoot.boot.mockResolvedValue({ fiber: { dispose: vi.fn() } })

    const host = await startHost(makeArgs({ port: 9000, host: '0.0.0.0' }))

    const bootCall = appBoot.boot.mock.calls[0]
    const patches = bootCall?.[2] as Array<{ id?: string; config?: Record<string, unknown> }>
    expect(patches?.find(patch => patch.id === 'web-server')).toMatchObject({ id: 'web-server', config: { port: 9000, host: '0.0.0.0' } })
    expect(host.baseUrl).toBe('http://0.0.0.0:9000')
  })
})
