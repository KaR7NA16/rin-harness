/**
 * rin web-server — knowledge write-endpoint wiring strip-types smoke.
 *
 * Exercises the knowledge.ts dispatcher directly with a fake knowledge service,
 * asserting each newly wired write endpoint (add/remove/reindex sources) calls
 * the service method and returns real data instead of a 404/empty-state. Run
 * from the package directory:
 *
 *   node --experimental-strip-types tests/knowledge-write.smoke.ts
 *
 * The fake service is a plain object (no cordis, no @rin runtime modules).
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { handle } from '../src/routes/knowledge.ts'

let failures = 0
function expect(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log('PASS ' + label)
  } catch (err) {
    failures += 1
    console.error('FAIL ' + label)
    console.error('  expected:', inspect(expected))
    console.error('  actual:  ', inspect(actual))
  }
}

const config = { knowledgeDbPath: '/tmp/kb.db', knowledgeSourcesRoots: ['/tmp'] }

/** A minimal KnowledgeSource matching the @rin/knowledge model. */
const sourceA = {
  id: 'src-a',
  path: '/tmp/notes',
  name: 'notes',
  kind: 'folder',
  status: 'pending',
  error: null,
  documentCount: 0,
  chunkCount: 0,
  sizeBytes: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  indexedAt: null,
}

const calls = []
const service = {
  async addSources(paths) {
    calls.push({ method: 'addSources', paths })
    return [sourceA]
  },
  removeSource(id) {
    calls.push({ method: 'removeSource', id })
    return id === 'src-a'
  },
  async reindexSource(id) {
    calls.push({ method: 'reindexSource', id })
    return { ...sourceA, status: 'indexing' }
  },
}
const store = {
  open(dbPath) {
    calls.push({ method: 'open', dbPath })
    return service
  },
}
const services = { knowledge: () => store }

async function main() {
  let res

  // POST /api/knowledge/sources → addSources(paths) → KnowledgeSource[]
  res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['/tmp/notes'] }, services, config)
  expect('add sources status', res.status, 200)
  expect('add sources body', res.body, [sourceA])
  expect('add sources passes paths through', calls.filter((c) => c.method === 'addSources').at(-1).paths, ['/tmp/notes'])

  // DELETE /api/knowledge/sources/{id} → removeSource(id) → { removed: boolean }
  res = await handle('/api/knowledge/sources/src-a', '', 'DELETE', undefined, services, config)
  expect('remove source status', res.status, 200)
  expect('remove source body', res.body, { removed: true })
  expect('remove source passes id through', calls.filter((c) => c.method === 'removeSource').at(-1).id, 'src-a')

  // POST /api/knowledge/sources/{id}/reindex → reindexSource(id) → KnowledgeSource
  res = await handle('/api/knowledge/sources/src-a/reindex', '', 'POST', {}, services, config)
  expect('reindex source status', res.status, 200)
  expect('reindex source body', res.body, { ...sourceA, status: 'indexing' })
  expect('reindex source passes id through', calls.filter((c) => c.method === 'reindexSource').at(-1).id, 'src-a')

  // The service is opened (and closed) for each write.
  expect('service opened for writes', calls.filter((c) => c.method === 'open').length, 3)

  // wrong method → 405
  res = await handle('/api/knowledge/sources', '', 'DELETE', undefined, services, config)
  expect('add sources wrong method status', res.status, 405)

  res = await handle('/api/knowledge/sources/src-a', '', 'POST', undefined, services, config)
  expect('remove source wrong method status', res.status, 405)

  // missing/invalid paths → 400
  res = await handle('/api/knowledge/sources', '', 'POST', {}, services, config)
  expect('add sources missing paths status', res.status, 400)

  res = await handle('/api/knowledge/sources', '', 'POST', { paths: [42] }, services, config)
  expect('add sources non-string path status', res.status, 400)

  // unmounted service → notMounted()
  const emptyServices = { knowledge: () => undefined }
  res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['/tmp/x'] }, emptyServices, config)
  expect('add sources unmounted', res.body, { mounted: false })

  if (failures > 0) {
    console.error('knowledge-write smoke: ' + failures + ' failure(s)')
    process.exitCode = 1
  } else {
    console.log('knowledge-write smoke: all assertions passed')
    console.log('KNOWLEDGE-WRITE-SMOKE-OK')
  }
}

await main()
