/**
 * rin web-server — prompt-memory write-path strip-types smoke.
 *
 * Exercises prompt-memory.ts directly with a fake prompt-memory service,
 * asserting PATCH /api/prompt-memory/config and
 * POST /api/prompt-memory/:target/entries return real (fake) data instead of
 * 404/empty-state. Run from the package directory:
 *
 *   node --experimental-strip-types tests/prompt-memory-write.smoke.ts
 *
 * The fake service is a plain object (no cordis, no @rin runtime modules).
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { handle } from '../../src/web-server/routes/prompt-memory.ts'

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

const config = {}

/** Record every mutation the fake service receives so wiring is asserted. */
const calls = { updateConfig: [], add: [], replace: [], remove: [] }

function mutationResult(target, action, entries) {
  return {
    target,
    path: '/tmp/' + target.toUpperCase() + '.md',
    action,
    changed: true,
    message: action + 'ed',
    entries,
    entryCount: entries.length,
    charCount: entries.join('').length,
    limit: 1375,
    overLimit: false,
  }
}

const promptMemory = {
  async updateConfig(input) {
    calls.updateConfig.push(input)
    return { version: 1, injectEvolutionMemory: input.injectEvolutionMemory, updatedAt: '2026-01-01T00:00:00.000Z' }
  },
  async addEntry(target, content) {
    calls.add.push({ target, content })
    return mutationResult(target, 'add', [content])
  },
  async replaceEntry(target, oldText, content) {
    calls.replace.push({ target, oldText, content })
    return mutationResult(target, 'replace', [content])
  },
  async removeEntry(target, oldText) {
    calls.remove.push({ target, oldText })
    return mutationResult(target, 'remove', [])
  },
}

// Only promptMemory is read by this route; the rest of RinServiceRefs is unused.
const services = { promptMemory: () => promptMemory }

async function main() {
  let res

  // PATCH /api/prompt-memory/config
  res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: false }, services, config)
  expect('config patch status', res.status, 200)
  expect('config patch body', res.body, { version: 1, injectEvolutionMemory: false, updatedAt: '2026-01-01T00:00:00.000Z' })
  expect('config patch forwards input', calls.updateConfig, [{ injectEvolutionMemory: false }])

  res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: 'yes' }, services, config)
  expect('config patch rejects non-boolean', res.status, 400)

  res = await handle('/api/prompt-memory/config', '', 'PATCH', {}, services, config)
  expect('config patch rejects missing field', res.status, 400)

  res = await handle('/api/prompt-memory/config', '', 'GET', undefined, services, config)
  expect('config patch rejects GET', res.status, 405)

  // POST /api/prompt-memory/:target/entries — add
  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'add', content: 'Call me Alice' }, services, config)
  expect('entries add status', res.status, 200)
  expect('entries add changed', res.body.changed, true)
  expect('entries add entryCount', res.body.entryCount, 1)
  expect('entries add forwards', calls.add, [{ target: 'user', content: 'Call me Alice' }])

  // replace
  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'replace', oldText: 'Call me Alice', content: 'Call me Bob' }, services, config)
  expect('entries replace status', res.status, 200)
  expect('entries replace forwards', calls.replace, [{ target: 'user', oldText: 'Call me Alice', content: 'Call me Bob' }])

  // remove (the shape the frontend promptMemoryApi.removeEntry sends)
  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'remove', oldText: 'Call me Bob' }, services, config)
  expect('entries remove status', res.status, 200)
  expect('entries remove changed', res.body.changed, true)
  expect('entries remove entryCount', res.body.entryCount, 0)
  expect('entries remove forwards', calls.remove, [{ target: 'user', oldText: 'Call me Bob' }])

  // brief target is accepted too
  res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'remove', oldText: 'workflow' }, services, config)
  expect('entries brief target status', res.status, 200)
  expect('entries brief forwards', calls.remove.at(-1), { target: 'brief', oldText: 'workflow' })

  // soul is not a mutation target
  res = await handle('/api/prompt-memory/soul/entries', '', 'POST', { action: 'remove', oldText: 'x' }, services, config)
  expect('entries rejects soul', res, null)

  // validation
  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'nope' }, services, config)
  expect('entries rejects unknown action', res.status, 400)

  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'remove' }, services, config)
  expect('entries remove requires oldText', res.status, 400)

  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'replace', oldText: 'a' }, services, config)
  expect('entries replace requires content', res.status, 400)

  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'add' }, services, config)
  expect('entries add requires content', res.status, 400)

  res = await handle('/api/prompt-memory/user/entries', '', 'GET', undefined, services, config)
  expect('entries rejects GET', res.status, 405)

  // unmounted service keeps the notMounted envelope
  const emptyServices = { promptMemory: () => undefined }
  res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: true }, emptyServices, config)
  expect('config unmounted fallback', res.body, { mounted: false })

  res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'remove', oldText: 'x' }, emptyServices, config)
  expect('entries unmounted fallback', res.body, { mounted: false })

  if (failures > 0) {
    console.error('prompt-memory-write smoke: ' + failures + ' failure(s)')
    process.exitCode = 1
  } else {
    console.log('prompt-memory-write smoke: all assertions passed')
    console.log('PROMPT-MEMORY-WRITE-SMOKE-OK')
  }
}

await main()
