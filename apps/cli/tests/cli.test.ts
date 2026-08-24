import { describe, expect, test, vi } from 'vitest'
import { runCli, type CliProcess, type CliRuntime } from '../src/cli.ts'
import type { RinHost } from '@rin/host/launcher'

function makeRuntime() {
  const listeners = new Map<string, () => void>()
  const log = vi.fn()
  const close = vi.fn(async () => {})
  const exit = vi.fn()
  const host = { baseUrl: 'http://127.0.0.1:8320', close } as unknown as RinHost
  const cliProcess: CliProcess = {
    on: (signal, listener) => { listeners.set(signal, listener) },
    stdin: { on: (event, listener) => { listeners.set(event, listener) } },
    exit,
  }
  const startHost = vi.fn(async () => host)
  const runtime: CliRuntime = { startHost, log, process: cliProcess }
  return { runtime, listeners, log, close, exit, startHost }
}

describe('runCli', () => {
  test('prints help and version without starting the host', async () => {
    const state = makeRuntime()
    await runCli(['--help'], state.runtime)
    await runCli(['--version'], state.runtime)
    expect(state.startHost).not.toHaveBeenCalled()
    expect(state.log.mock.calls[0]?.[0]).toContain('usage: rin')
    expect(state.log).toHaveBeenLastCalledWith('rin 0.1.0')
  })

  test('boots the host, advertises an override, and registers shutdown hooks', async () => {
    const state = makeRuntime()
    await runCli(['web', '--url', 'http://desktop.test'], state.runtime)
    expect(state.startHost).toHaveBeenCalledWith(expect.objectContaining({ command: 'web' }))
    expect(state.log).toHaveBeenCalledWith('rin host on http://desktop.test')
    expect([...state.listeners.keys()].sort()).toEqual(['SIGINT', 'SIGTERM', 'end'])
  })

  test('closes once and preserves the first shutdown exit code', async () => {
    const state = makeRuntime()
    await runCli([], state.runtime)
    state.listeners.get('SIGINT')?.()
    state.listeners.get('SIGTERM')?.()
    state.listeners.get('end')?.()
    await vi.waitFor(() => { expect(state.exit).toHaveBeenCalledWith(130) })
    expect(state.close).toHaveBeenCalledTimes(1)
    expect(state.exit).toHaveBeenCalledTimes(1)
  })
})
