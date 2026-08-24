/**
 * rin smart pruning — seam strip-types smoke script.
 *
 * Exercises the session-surface pruning seam without importing Cordis:
 * level-driven planning (recent-message window), dedup + superseded-read
 * detection, failure preservation, shadow-price + replacement landing, and
 * the registerSeam wiring (enabled switch, live level read, disposer).
 * Run from the package directory with:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 */

import assert from 'node:assert/strict'
import { planSessionPruning, pruneSessionSurface } from '../../src/smart-pruning/seam-core.ts'
import { PRE_STEP_EVENT, registerSeam } from '../../src/smart-pruning/seam.ts'

const DUP_TEXT = 'duplicate payload line. '.repeat(12)
const OLD_READ = 'old read line. '.repeat(12)
const NEW_READ = 'new read line. '.repeat(12)

/** A tool/call log-only event (carries name + arguments for metadata). */
function toolCall(callId, name, args) {
  return { type: 'tool/call', seq: -1, data: { callId, name, arguments: args } }
}

/** A surface tool/result event. */
function toolResult(callId, text, opts = {}) {
  return {
    type: 'tool/result',
    seq: -1,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        id: 'msg-' + callId,
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          ...(opts.isError === true ? { isError: true } : {}),
          content: [{ type: 'text', text }],
        }],
      },
      ...(opts.error === undefined ? {} : { error: opts.error }),
    },
  }
}

/** A surface filler message (a step boundary, not a tool result). */
function filler() {
  return { type: 'user/message', seq: -1, data: { content: [{ type: 'text', text: 'ok' }], source: { kind: 'user' } } }
}

/**
 * Build a fake structural session from a push-based spec, simulating surface
 * replaces in the recorded nodes so re-triggering stays idempotent.
 * @param steps - the builder receiving a (event, onSurface) push function.
 * @returns the session plus the recorded appends.
 */
function buildSession(steps) {
  const events = []
  const nodes = []
  const appends = []
  function push(event, onSurface) {
    event.seq = events.length
    events.push(event)
    if (onSurface) nodes.push(event.seq)
  }
  steps(push)
  const session = {
    surface: { nodes },
    events,
    append(type, data, opts) {
      const seq = events.length
      events.push({ type, seq, data, ...(opts ?? {}) })
      appends.push({ type, data, opts, seq })
      if (opts?.surfaceOp?.op === 'replace') {
        const idx = nodes.indexOf(opts.surfaceOp.start)
        if (idx >= 0) nodes.splice(idx, 1, seq)
      }
      return { seq }
    },
  }
  return { session, appends }
}

/** A 20-node surface whose oldest result (seq 1) duplicates the newest (seq 21). */
function duplicateSession() {
  return buildSession((push) => {
    push(toolCall('call_old', 'Bash', '{"command":"echo hi"}'), false)
    push(toolResult('call_old', DUP_TEXT), true)
    for (let i = 0; i < 18; i += 1) push(filler(), true)
    push(toolCall('call_new', 'Bash', '{"command":"echo hi"}'), false)
    push(toolResult('call_new', DUP_TEXT), true)
  })
}

/** A 20-node surface whose oldest read (seq 1) is superseded by the newest (seq 21). */
function supersededSession() {
  return buildSession((push) => {
    push(toolCall('read_old', 'Read', '{"file_path":"docs.md"}'), false)
    push(toolResult('read_old', OLD_READ), true)
    for (let i = 0; i < 18; i += 1) push(filler(), true)
    push(toolCall('read_new', 'Read', '{"file_path":"docs.md"}'), false)
    push(toolResult('read_new', NEW_READ), true)
  })
}

/** A fake ctx exposing a mutable store and an optional token meter. */
function fakeCtx(store) {
  const listeners = new Map()
  const warnings = []
  const meter = { estimateMessage: () => 99 }
  return {
    listeners,
    warnings,
    get(name) {
      if (name === 'smartPruning') return store
      if (name === 'tokenMeter') return meter
      return undefined
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
  }
}

async function main() {
  // --- level → recent-window strategy ---
  const d = duplicateSession()
  assert.equal(planSessionPruning(d.session, 'conservative').length, 0)
  const balanced = planSessionPruning(d.session, 'balanced')
  assert.equal(balanced.length, 1)
  assert.equal(balanced[0].seq, 1)
  assert.equal(balanced[0].reason, 'duplicate')
  assert.match(balanced[0].marker, /duplicate output/)
  assert.ok(balanced[0].savedCharacters > 0)
  assert.equal(planSessionPruning(d.session, 'aggressive').length, 1)

  // --- superseded-read folding ---
  const sup = planSessionPruning(supersededSession().session, 'balanced')
  assert.equal(sup.length, 1)
  assert.equal(sup[0].reason, 'superseded')
  assert.match(sup[0].marker, /superseded file read/)
  assert.match(sup[0].marker, /path=docs.md/)

  // --- failures are never pruned ---
  const errored = buildSession((push) => {
    push(toolCall('call_old', 'Bash', '{}'), false)
    push(toolResult('call_old', DUP_TEXT, { isError: true }), true)
    for (let i = 0; i < 18; i += 1) push(filler(), true)
    push(toolCall('call_new', 'Bash', '{}'), false)
    push(toolResult('call_new', DUP_TEXT), true)
  })
  assert.equal(planSessionPruning(errored.session, 'aggressive').length, 0)

  const errorText = buildSession((push) => {
    push(toolCall('call_old', 'Bash', '{}'), false)
    push(toolResult('call_old', 'error: boom\n' + DUP_TEXT), true)
    for (let i = 0; i < 18; i += 1) push(filler(), true)
    push(toolCall('call_new', 'Bash', '{}'), false)
    push(toolResult('call_new', 'error: boom\n' + DUP_TEXT), true)
  })
  assert.equal(planSessionPruning(errorText.session, 'aggressive').length, 0)

  // --- landing: shadow-price + single-node replacement, only content changes ---
  const land = duplicateSession()
  const stats = pruneSessionSurface(land.session, 'balanced', () => 42)
  assert.equal(stats.prunedToolResults, 1)
  assert.equal(stats.duplicateResults, 1)
  assert.equal(stats.supersededReads, 0)
  assert.equal(stats.truncatedResults, 0)
  assert.ok(stats.savedCharacters > 0)
  assert.equal(land.appends.length, 2)
  const [shadow, replace] = land.appends
  assert.equal(shadow.type, 'compaction/prune')
  assert.equal(shadow.data.shadowedTokenCount, 42)
  assert.deepEqual(shadow.data.shadowedRange, { start: 1, end: 1 })
  assert.deepEqual(shadow.data.shadowedSeqs, [1])
  assert.equal(replace.type, 'tool/result')
  assert.deepEqual(replace.opts.surfaceOp, { op: 'replace', start: 1, end: 1 })
  assert.deepEqual(replace.opts.sourceEventSeqs, [1])
  assert.equal(replace.data.message.source.callId, 'call_old')
  assert.equal(replace.data.message.content[0].toolCallId, 'call_old')
  assert.equal(replace.data.message.content[0].content[0].text, balanced[0].marker)

  // --- seam wiring: enabled switch + live level read + disposer ---
  const store = { enabled: false, level: 'conservative' }
  const storeLike = { getStatus: () => ({ enabled: store.enabled, level: store.level }) }
  const ctx = fakeCtx(storeLike)
  const dispose = registerSeam(ctx)
  assert.equal(ctx.listeners.has(PRE_STEP_EVENT), true)
  const listener = ctx.listeners.get(PRE_STEP_EVENT)
  const seamSession = duplicateSession()
  let nextCalls = 0
  const next = async () => { nextCalls += 1; return 'enter' }

  // disabled → the trigger delegates without pruning
  assert.equal(await listener({ agent: { session: seamSession.session } }, next), 'enter')
  assert.equal(seamSession.appends.length, 0)
  assert.equal(nextCalls, 1)

  // enabled + conservative (20-node surface → boundary 0) → still no prune
  store.enabled = true
  await listener({ agent: { session: seamSession.session } }, next)
  assert.equal(seamSession.appends.length, 0)

  // hot level change to balanced, same session → now the duplicate is pruned
  store.level = 'balanced'
  await listener({ agent: { session: seamSession.session } }, next)
  assert.equal(seamSession.appends.length, 2)
  assert.equal(ctx.warnings.length, 0)

  // disposer removes the listener
  dispose()
  assert.equal(ctx.listeners.has(PRE_STEP_EVENT), false)

  // missing store is a silent no-op (the waterfall still delegates)
  const missing = fakeCtx(storeLike)
  missing.get = () => undefined
  const disposeMissing = registerSeam(missing)
  await missing.listeners.get(PRE_STEP_EVENT)({ agent: { session: seamSession.session } }, next)
  assert.equal(ctx.warnings.length, 0)
  assert.equal(nextCalls, 4)
  disposeMissing()

  // a throwing store is reported loudly but never vetoes the step
  const boom = fakeCtx({ getStatus: () => { throw new Error('boom') } })
  registerSeam(boom)
  await boom.listeners.get(PRE_STEP_EVENT)({ agent: { session: seamSession.session } }, next)
  assert.equal(boom.warnings.length, 1)
  assert.match(boom.warnings[0], /session pruning failed: boom/)
  assert.equal(nextCalls, 5)

  console.log('SEAM-SMOKE-OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
