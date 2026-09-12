/**
 * M8-05 memory cognition performance baseline.
 *
 * Measures the fixed-semantics kernel costs on one machine: journal append,
 * full materializer replay, recall over a filled store, state hashing, and
 * database growth. Run with `pnpm run bench:memory`; record the output in
 * docs/roadmap/ACTIVE.md. The numbers are a relative baseline, not a claim
 * about production hardware.
 *
 * @module @rin/memory/scripts
 */
import { mkdtemp } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import { MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import {
  FileMemoryStore,
  MemoryCognitionDatabase,
  MemoryMaterializer,
  createMemory,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryId,
  createMemoryTransaction,
  createMemoryTransactionId,
  createParticipantId,
  createRuntimeActor,
  hashMaterializedState,
  type MemoryCommand,
  type MemoryEvent,
  type MemoryTransaction,
  type RinMemory,
} from '../src/index.ts'

const SCENE_COUNT = Number(process.env.BENCH_SCENES ?? 200)
const RECALL_RUNS = 20

function sceneMemory(index: number): RinMemory {
  return createMemory({
    id: createMemoryId('bench-scene-' + index),
    form: 'scene',
    data: {
      participants: [createParticipantId('user-1')],
      environment: 'bench',
      goals: [],
      observations: ['benchmark observation ' + index + ' with enough text to approximate real content weight'],
      interpretations: [],
      actions: [],
      outcomes: [],
      predictionErrors: [],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
    },
    state: {
      persistence: 'durable',
      activation: 'dormant',
      integration: 'integrated',
      epistemic: 'observed',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.1,
      accessibility: 0.4,
      salience: 0.6,
      stability: 0.2,
      confidence: 0.8,
      integrationStrength: 0.1,
      novelty: 0.7,
      surprise: 0.5,
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: 0.2,
      influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function observeTransaction(memory: RinMemory): MemoryTransaction {
  const runtime = createRuntimeActor('bench-runtime')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'observe',
    commandId: createMemoryCommandId('bench-command-' + String(memory.id)),
    correlationId: createMemoryCorrelationId('bench-correlation-' + String(memory.id)),
    actor: runtime,
    issuedAt: '2026-01-01T00:00:01.000Z',
    payload: { memory },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-observed',
    eventId: createMemoryEventId('bench-event-' + String(memory.id)),
    transactionId: createMemoryTransactionId('bench-transaction-' + String(memory.id)),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: '2026-01-01T00:00:01.000Z',
    payload: { memory },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId: command.correlationId,
    actor: runtime,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? NaN
}

const root = await mkdtemp(join(tmpdir(), 'rin-memory-bench-'))
const dbPath = join(root, 'memory.db')
const database = new MemoryCognitionDatabase(dbPath)

const appendStart = performance.now()
for (let index = 0; index < SCENE_COUNT; index += 1) {
  database.appendTransaction(observeTransaction(sceneMemory(index)))
}
const appendTotal = performance.now() - appendStart

const store = new FileMemoryStore(new Context(), {
  dbPath,
  manifestPath: join(root, 'manifest.json'),
  homeRoot: root,
})
const transactions = database.listAllTransactions()
const state = store.readCognitionState()

const replayRuns = []
for (let index = 0; index < 5; index += 1) {
  const start = performance.now()
  new MemoryMaterializer().replay(transactions)
  replayRuns.push(performance.now() - start)
}

const recallRuns = []
for (let index = 0; index < RECALL_RUNS; index += 1) {
  const start = performance.now()
  await store.recall({ query: { text: 'benchmark observation' }, budget: { maxItems: 8, maxTokens: 1200 } })
  recallRuns.push(performance.now() - start)
}

const hashRuns = []
for (let index = 0; index < 50; index += 1) {
  const start = performance.now()
  hashMaterializedState(state)
  hashRuns.push(performance.now() - start)
}

const databaseBytes = statSync(dbPath).size

console.log('M8-05 memory cognition performance baseline')
console.log('  scenes (observe transactions):', SCENE_COUNT)
console.log('  journal append total:          ' + appendTotal.toFixed(1) + ' ms  (avg ' + (appendTotal / SCENE_COUNT).toFixed(3) + ' ms/transaction)')
console.log('  full journal replay median:    ' + median(replayRuns).toFixed(1) + ' ms  (' + transactions.length + ' transactions)')
console.log('  recall median:                 ' + median(recallRuns).toFixed(1) + ' ms  (maxItems=8, ' + RECALL_RUNS + ' runs)')
console.log('  materialized state hash:       ' + median(hashRuns).toFixed(2) + ' ms')
console.log('  database size:                 ' + (databaseBytes / 1024).toFixed(1) + ' KiB')
