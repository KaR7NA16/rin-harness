/**
 * Keyless Host journal restore transcript: large JSON, export round trip,
 * and refusal to overwrite a nonempty cognition journal.
 * @module @rin/host
 */
import { deepStrictEqual, equal, ok } from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { FileMemoryStore, hashMaterializedState } from '@rin/memory'
import {
  baseBundlePatchPath, builtinRepositoryRoot, configPath, credentialsPath,
  defaultConfig, dshHome, rinHome, sessionRoot, settingsPath, webUiDistRoot,
} from '@rin/host'

async function freePort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing socket address')
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rin-journal-host-'))
  const previous = { RIN_HOME: process.env.RIN_HOME, DSH_HOME: process.env.DSH_HOME, RIN_PACKAGED_RUNTIME: process.env.RIN_PACKAGED_RUNTIME }
  process.env.RIN_HOME = join(root, 'target')
  process.env.DSH_HOME = join(root, 'target-dsh')
  process.env.RIN_PACKAGED_RUNTIME = '1'
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    const source = new FileMemoryStore(new Context(), {
      dbPath: join(root, 'source', 'memory.db'),
      manifestPath: join(root, 'source', 'manifest.json'),
      homeRoot: join(root, 'source'),
    })
    source.ingestRuntimeEvent('journal-http', {
      type: 'user/message', seq: 1, time: 1767225600000,
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'journal evidence '.repeat(40_000) }] },
    })
    const transactions = source.exportCognitionJournal()
    const body = JSON.stringify({ transactions })
    ok(Buffer.byteLength(body) > 1024 * 1024)
    const port = await freePort()
    ctx = await boot('rin', configPath(), [
      ...loadOverlayPatches('rin', baseBundlePatchPath()),
      { id: 'web-server', config: { ...defaultConfig['web-server'], enabled: true, host: '127.0.0.1', port } },
      { id: 'session-persistence-jsonl', config: { root: sessionRoot() } },
      { id: 'settings', config: { path: settingsPath(), dshHome: dshHome() } },
      { id: 'credentials', config: { path: credentialsPath(), dshHome: dshHome() } },
      { id: 'session-query-sqlite', config: { path: rinHome('sessions/search.sqlite'), openAt: 'first-search' } },
      { id: 'tool-bash', disabled: true },
      { id: 'hmr', disabled: true },
    ], host => {
      host.provide('rinHome', rinHome)
      host.provide('dshHome', dshHome)
      host.provide('sessionRoot', sessionRoot)
      host.provide('settingsPath', settingsPath)
      host.provide('credentialsPath', credentialsPath)
      host.provide('builtinRepositoryRoot', builtinRepositoryRoot)
      host.provide('webUiDistRoot', webUiDistRoot)
    }, undefined)
    const url = 'http://127.0.0.1:' + port + '/api/memory/journal'
    // boot resolves service readiness; listen completion is asynchronous.
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { ready = (await fetch(url)).ok } catch { /* socket is not listening yet */ }
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    ok(ready, 'Host must expose journal before restore')
    const restored = await fetch(url + '/restore', { method: 'POST', body })
    equal(restored.status, 200)
    deepStrictEqual(await restored.json(), { mounted: true, restored: transactions.length })
    const exported = await fetch(url)
    deepStrictEqual(await exported.json(), { mounted: true, transactions })
    const target = ctx.get('memory') as FileMemoryStore
    equal(hashMaterializedState(target.readCognitionState()), hashMaterializedState(source.readCognitionState()))
    const duplicate = await fetch(url + '/restore', { method: 'POST', body })
    equal(duplicate.status, 400)
    await duplicate.arrayBuffer()
    const emptyDuplicate = await fetch(url + '/restore', { method: 'POST', body: JSON.stringify({ transactions: [] }) })
    equal(emptyDuplicate.status, 400)
    await emptyDuplicate.arrayBuffer()
    const transcript = [
      { operation: 'restore-large-journal', status: restored.status, complete: true },
      { operation: 'export-restored-journal', status: exported.status, stateMatches: true },
      { operation: 'restore-into-nonempty-journal', status: duplicate.status, unchanged: true },
    ]
    deepStrictEqual(target.exportCognitionJournal(), transactions)
    deepStrictEqual(transcript, JSON.parse(await readFile(new URL('./fixtures/memory-journal-http.json', import.meta.url), 'utf8')))
    console.log('REAL-HOST-JOURNAL-HTTP-SMOKE-OK', JSON.stringify(transcript))
  } finally {
    if (ctx !== undefined) await ctx.fiber.dispose()
    for (const key of ['RIN_HOME', 'DSH_HOME', 'RIN_PACKAGED_RUNTIME'] as const) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(root, { recursive: true, force: true })
  }
}

await main()
