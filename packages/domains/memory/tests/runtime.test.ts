import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createRuntimeMemoryTransaction,
  createGoalId,
  createActionId,
  createMemoryId,
  createOutcomeId,
  createParticipantId,
  createPredictionId,
  createWorkspaceCycleId,
  mapRuntimeSessionEvent,
  mapRuntimeBehaviorFact,
  selectCandidateActionSources,
  MemoryCognitionDatabase,
  MemoryMaterializer,
  RuntimeCognitionError,
  RuntimeCognitionIngestor,
  type RuntimeSceneBoundary,
  type RuntimeMemoryFact,
  type RuntimeSessionEvent,
} from '../src/index.ts'

function event(type: string, seq: number, data: unknown, time = 1767225600000): RuntimeSessionEvent {
  return { type, seq, time, data }
}

describe('runtime event formation', () => {
  test('maps user, assistant, tool, and turn events into distinct fact kinds', () => {
    const user = mapRuntimeSessionEvent('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'remember the workspace constraint' }],
    }))
    const assistant = mapRuntimeSessionEvent('session-1', event('assistant/message', 2, {
      message: { content: [{ type: 'text', text: 'I will keep it in scope' }] },
      relationshipExpression: {
        cycleId: 'cycle-1',
        workspaceHash: 'workspace-1',
        memoryIds: ['relationship-1'],
      },
    }))
    const tool = mapRuntimeSessionEvent('session-1', event('tool/call', 3, {
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    }))
    const result = mapRuntimeSessionEvent('session-1', event('tool/result', 4, {
      message: { content: [{ type: 'text', text: 'file read completed' }] },
    }))
    const turn = mapRuntimeSessionEvent('session-1', event('turn/end', 5, {
      reason: { kind: 'completed' },
    }))

    expect(user?.kind).toBe('observation')
    expect(assistant?.kind).toBe('action')
    expect(assistant?.relationshipExpression).toEqual({
      cycleId: 'cycle-1',
      workspaceHash: 'workspace-1',
      memoryIds: [createMemoryId('relationship-1')],
    })
    expect(tool?.kind).toBe('action')
    expect(result?.kind).toBe('outcome')
    expect(turn?.kind).toBe('outcome')
    expect(turn?.outcomeStatus).toBe('observed')
    expect(mapRuntimeSessionEvent('session-1', event('step/start', 0, { turn: 1, step: 1 }))).toBeNull()
    const correlatedCall = mapRuntimeSessionEvent('session-1', event('tool/call', 6, {
      callId: 'call-1',
      name: 'read_file',
      arguments: '{}',
    }))
    expect(correlatedCall?.correlationKey).toBe('call-1')
    const dshResult = mapRuntimeSessionEvent('session-1', event('tool/result', 7, {
      message: { content: [{ toolCallId: 'call-from-message', content: 'read completed' }] },
    }))
    expect(dshResult?.correlationKey).toBe('call-from-message')
    const ambiguousDshResult = mapRuntimeSessionEvent('session-1', event('tool/result', 8, {
      message: {
        content: [
          { toolCallId: 'call-a', content: 'first result' },
          { toolCallId: 'call-b', content: 'second result' },
        ],
      },
    }))
    expect(ambiguousDshResult?.correlationKey).toBeUndefined()
  })

  test('marks failed tool and turn outcomes without changing observed facts', () => {

    const tool = mapRuntimeSessionEvent('session-1', event('tool/result', 7, {
      message: { content: [{ type: 'text', text: 'permission denied' }] },
      error: { name: 'PermissionError', code: 'EACCES' },
    }))
    const turn = mapRuntimeSessionEvent('session-1', event('turn/end', 8, {
      reason: { kind: 'error', error: { message: 'provider failed', code: 'PROVIDER' } },
    }))

    expect(tool?.outcomeStatus).toBe('failed')
    expect(turn?.outcomeStatus).toBe('failed')
    expect(turn?.content).toContain('provider failed')
  })

  test('ignores plugin-injected user context as an observation', () => {
    expect(
      mapRuntimeSessionEvent('session-1', event('user/message', 6, {
        source: { kind: 'plugin', plugin: 'prompt-memory', form: 'recall' },
        content: [{ type: 'text', text: 'old prompt context' }],
      })),
    ).toBeNull()
  })

  test('rejects malformed meaningful events instead of silently forming memory', () => {
    expect(() => mapRuntimeSessionEvent('session-1', event('user/message', 1, { source: { kind: 'user' }, content: [] }))).toThrow(RuntimeCognitionError)
    expect(() => mapRuntimeSessionEvent('session-1', event('turn/end', 2, { reason: {} }))).toThrow(RuntimeCognitionError)
    expect(() => mapRuntimeSessionEvent('session-1', event('user/message', -1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] }))).toThrow(RuntimeCognitionError)
    expect(() => mapRuntimeSessionEvent('session-1', event('assistant/message', 3, {
      message: { content: [{ type: 'text', text: 'x' }] },
      relationshipExpression: {
        cycleId: 'cycle-duplicate',
        workspaceHash: 'workspace-duplicate',
        memoryIds: ['relationship-duplicate', 'relationship-duplicate'],
      },
    }))).toThrow('must not contain duplicates')
    expect(() => mapRuntimeSessionEvent('session-1', event('assistant/message', 4, {
      message: { content: [{ type: 'text', text: 'x' }] },
      relationshipExpression: {
        cycleId: 'cycle-empty',
        workspaceHash: 'workspace-empty',
        memoryIds: [],
      },
    }))).toThrow('must contain at least one memory id')
  })

  test('forms deterministic, locatable transactions and persists them idempotently', async () => {
    const fact: RuntimeMemoryFact = {
      sessionId: 'session/one',
      eventSeq: 11,
      eventType: 'user/message',
      occurredAt: '2026-01-01T00:00:00.000Z',
      kind: 'observation',
      content: 'a durable runtime observation',
    }
    const first = createRuntimeMemoryTransaction(fact)
    const second = createRuntimeMemoryTransaction(fact)
    expect(second).toEqual(first)
    expect(first.command.actor.kind).toBe('runtime')
    expect(first.events[0]?.payload.memory.form).toBe('scene')
    const refs = first.events[0]?.payload.memory.form === 'scene'
      ? first.events[0].payload.memory.data.runtimeEventRefs
      : undefined
    expect(refs).toEqual([{
      source: 'dsh-session',
      sessionId: 'session/one',
      eventSeq: 11,
      eventType: 'user/message',
      kind: 'observation',
    }])

    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const committed = ingestor.ingest(fact.sessionId, event(fact.eventType, fact.eventSeq, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: fact.content }],
    }))
    const retried = ingestor.ingest(fact.sessionId, event(fact.eventType, fact.eventSeq, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: fact.content }],
    }))

    expect(committed?.command.type).toBe('scene')
    expect(committed?.events[0]?.type).toBe('scene-opened')
    expect(retried).toEqual(committed)
    expect(database.listTransactions()).toHaveLength(1)
    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories).toHaveLength(1)
    expect(state.memories[0]?.form).toBe('scene')
  })


  test('extends one scene across meaningful events and resumes from the materialized log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const base = 1767225600000

    ingestor.ingest('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'keep this scene together' }],
    }, base + 1000))
    ingestor.ingest('session-1', event('assistant/message', 2, {
      message: { content: [{ type: 'text', text: 'I will' }] },
    }, base + 2000))
    ingestor.ingest('session-1', event('tool/call', 3, {
      name: 'read_file',
      arguments: '{"path":"docs"}',
    }, base + 3000))
    ingestor.ingest('session-1', event('tool/result', 4, {
      message: { content: [{ type: 'text', text: 'read completed' }] },
    }, base + 4000))
    ingestor.ingest('session-1', event('turn/end', 5, {
      reason: { kind: 'completed' },
    }, base + 5000))

    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories).toHaveLength(1)
    const scene = state.memories[0]
    expect(scene?.form).toBe('scene')
    if (scene?.form !== 'scene') throw new Error('expected a scene')
    expect(scene.data.runtimeEventRefs).toHaveLength(5)
    expect(scene.data.observations).toEqual(['keep this scene together'])
    expect(scene.data.actions).toHaveLength(2)
    expect(scene.data.outcomes).toHaveLength(2)
    expect(scene.data.lifecycle?.status).toBe('open')

    const restarted = new RuntimeCognitionIngestor(database)
    const resumed = restarted.ingest('session-1', event('tool/call', 6, {
      name: 'finish',
      arguments: '',
    }, base + 6000))
    expect(resumed?.events[0]?.type).toBe('scene-extended')
    const resumedScene = new MemoryMaterializer().replayFrom(database).memories[0]
    if (resumedScene?.form !== 'scene') throw new Error('expected a resumed scene')
    expect(resumedScene.data.runtimeEventRefs).toHaveLength(6)
  })

  test('opens a new continuity and closes the previous scene atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const base = 1767225600000

    ingestor.ingest('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'first task' }],
    }, base + 1000), { continuityKey: 'task-a' })
    const opened = ingestor.ingest('session-1', event('user/message', 2, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'second task' }],
    }, base + 2000), { continuityKey: 'task-b', boundary: 'open' })

    expect(opened?.events.map(item => item.type)).toEqual(['scene-closed', 'scene-opened'])
    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories).toHaveLength(2)
    const oldScene = state.memories.find(memory => memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'task-a')
    const newScene = state.memories.find(memory => memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'task-b')
    expect(oldScene?.form).toBe('scene')
    expect(newScene?.form).toBe('scene')
    if (oldScene?.form !== 'scene' || newScene?.form !== 'scene') throw new Error('expected two scenes')
    expect(oldScene.data.lifecycle?.status).toBe('closed')
    expect(newScene.data.lifecycle?.status).toBe('open')
  })

  test('continues one scene across sessions when the continuity key is explicit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const base = 1767225600000

    ingestor.ingest('session-a', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'shared context' }],
    }, base + 1000), { continuityKey: 'shared-task' })
    const continued = ingestor.ingest('session-b', event('assistant/message', 1, {
      message: { content: [{ type: 'text', text: 'continue context' }] },
    }, base + 2000), { continuityKey: 'shared-task' })

    expect(continued?.events[0]?.type).toBe('scene-extended')
    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories).toHaveLength(1)
    const scene = state.memories[0]
    if (scene?.form !== 'scene') throw new Error('expected a shared scene')
    expect(scene.data.runtimeEventRefs?.map(ref => ref.sessionId)).toEqual(['session-a', 'session-b'])
  })

  test('preserves explicit participants and goals when runtime scene crosses sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-context-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const user = createParticipantId('profile-user')
    const rin = createParticipantId('profile-rin')
    const goal = createGoalId('goal-runtime')
    const hint = {
      continuityKey: 'stable-runtime-scene',
      participants: { user, rin },
      goals: [goal],
    } as const
    const base = 1767225600000

    ingestor.ingest('session-a', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'explicit identity context' }],
    }, base + 1000), hint)
    ingestor.ingest('session-b', event('assistant/message', 1, {
      message: { content: [{ type: 'text', text: 'identity context continues' }] },
    }, base + 2000), hint)

    const scene = new MemoryMaterializer().replayFrom(database).memories[0]
    if (scene?.form !== 'scene') throw new Error('expected an explicit-context scene')
    expect(scene.data.participants).toEqual([user, rin])
    expect(scene.data.goals).toEqual([goal])
    expect(String(scene.data.participants[0])).toBe('profile-user')
    expect(scene.data.runtimeEventRefs.map(ref => ref.sessionId)).toEqual(['session-a', 'session-b'])

    expect(() => ingestor.ingest('session-b', event('tool/call', 2, {
      name: 'read_file',
      arguments: '{"path":"notes.md"}',
    }, base + 3000), {
      ...hint,
      participants: { user, rin: createParticipantId('other-rin') },
    })).toThrow('participants cannot change')

    expect(() => ingestor.ingest('session-b', event('tool/call', 3, {
      name: 'read_file',
      arguments: '{"path":"notes.md"}',
    }, base + 4000), {
      ...hint,
      goals: [createGoalId('other-goal')],
    })).toThrow('goals cannot change')
  })

  test('requires a new continuity after an explicit close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-runtime-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const base = 1767225600000

    ingestor.ingest('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'close me' }],
    }, base + 1000), { continuityKey: 'task-a' })
    const closed = ingestor.ingest('session-1', event('turn/end', 2, {
      reason: { kind: 'completed' },
    }, base + 2000), { continuityKey: 'task-a', boundary: 'close' })

    expect(closed?.events[0]?.type).toBe('scene-closed')
    expect(() => ingestor.ingest('session-1', event('user/message', 3, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'must not reopen' }],
    }, base + 3000), { continuityKey: 'task-a' })).toThrow(RuntimeCognitionError)
    expect(() => ingestor.ingest('session-1', event('user/message', 4, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'bad boundary' }],
    }, base + 4000), { boundary: 'invalid' as RuntimeSceneBoundary })).toThrow(RuntimeCognitionError)
  })
  test('opens an open loop for a tool call and reconnects a delayed result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-open-loop-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const materializer = new MemoryMaterializer()
    const base = 1767225600000

    ingestor.ingest('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'start the tool task' }],
    }, base + 1000), { continuityKey: 'loop-task' })
    const opened = ingestor.ingest('session-1', event('tool/call', 2, {
      callId: 'call-1',
      name: 'read_file',
      arguments: '{"path":"notes.md"}',
    }, base + 2000), { continuityKey: 'loop-task' })

    expect(opened?.events.map(item => item.type)).toEqual(['scene-extended', 'open-loop-opened'])
    const openState = materializer.replayFrom(database)
    const openScene = openState.memories.find(memory =>
      memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'loop-task',
    )
    const openLoop = openState.memories.find(memory => memory.form === 'open-loop')
    if (openScene?.form !== 'scene' || openLoop?.form !== 'open-loop') {
      throw new Error('expected a scene and an open loop')
    }
    expect(openLoop.data.relatedMemoryIds).toEqual([openScene.id])
    expect(openLoop.data.origin?.correlationKey).toBe('call-1')
    expect(openState.currentField.activeOpenLoops).toEqual([openLoop.id])

    const boundary = ingestor.ingest('session-1', event('user/message', 3, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'move to the next task' }],
    }, base + 3000), { continuityKey: 'next-task', boundary: 'open' })
    expect(boundary?.events.map(item => item.type)).toEqual(['scene-closed', 'scene-opened'])

    const betweenState = materializer.replayFrom(database)
    const currentScene = betweenState.memories.find(memory =>
      memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'next-task',
    )
    if (currentScene?.form !== 'scene') throw new Error('expected the newer current scene')
    expect(betweenState.currentField.sceneId).toBe(currentScene.id)
    expect(betweenState.currentField.activeOpenLoops).toEqual([])

    const resolved = ingestor.ingest('session-2', event('tool/result', 1, {
      callId: 'call-1',
      message: { content: [{ type: 'text', text: 'notes.md read completed' }] },
    }, base + 4000))
    expect(resolved?.events.map(item => item.type)).toEqual(['open-loop-resolved'])

    const finalState = materializer.replayFrom(database)
    const finalLoop = finalState.memories.find(memory => memory.id === openLoop.id)
    const oldScene = finalState.memories.find(memory =>
      memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'loop-task',
    )
    if (finalLoop?.form !== 'open-loop' || oldScene?.form !== 'scene') {
      throw new Error('expected the resolved loop and original scene')
    }
    expect(finalLoop.data.status).toBe('resolved')
    expect(finalLoop.data.resolution).toMatchObject({
      description: 'notes.md read completed',
      status: 'observed',
      occurredAt: new Date(base + 4000).toISOString(),
    })
    expect(finalLoop.data.resolution?.eventRef).toMatchObject({
      sessionId: 'session-2',
      eventSeq: 1,
      eventType: 'tool/result',
      correlationKey: 'call-1',
    })
    expect(oldScene.data.runtimeEventRefs?.some(ref => ref.eventType === 'tool/result')).toBe(false)
    expect(finalState.currentField.sceneId).toBe(currentScene.id)
    expect(finalState.currentField.activeOpenLoops).toEqual([])
    const journal = database.listAllTransactions()
    let prefixState = materializer.replay([])
    for (let index = 0; index < journal.length; index += 1) {
      const snapshot = JSON.stringify(prefixState)
      const next = materializer.apply(journal[index]!, prefixState)
      expect(JSON.stringify(prefixState)).toBe(snapshot)
      expect(materializer.replay(journal.slice(0, index + 1))).toEqual(next)
      prefixState = next
    }
    expect(prefixState).toEqual(finalState)
    expect(materializer.replay(database.listTransactions())).toEqual(finalState)
  })



  test('materializes one current field version per committed scene transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-current-field-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const ingestor = new RuntimeCognitionIngestor(database)
    const base = 1767225600000

    ingestor.ingest('session-1', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'first field scene' }],
    }, base + 1000), { continuityKey: 'field-a' })
    const committed = ingestor.ingest('session-1', event('user/message', 2, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'second field scene' }],
    }, base + 2000), { continuityKey: 'field-b', boundary: 'open' })

    expect(committed?.events).toHaveLength(2)
    const state = new MemoryMaterializer().replayFrom(database)
    const currentScene = state.memories.find(memory =>
      memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'field-b',
    )
    expect(currentScene?.form).toBe('scene')
    if (currentScene?.form !== 'scene') throw new Error('expected current scene')
    expect(state.eventCount).toBe(3)
    expect(state.version).toBe(2)
    expect(state.currentField.version).toBe(state.version)
    expect(state.currentField.sceneId).toBe(currentScene.id)
    expect(state.currentField.sceneVersion).toBe(currentScene.updatedAt)
    expect(state.currentField.sceneStatus).toBe('open')
    expect(state.currentField.activeMemoryCoalition).toEqual([currentScene.id])
    expect(Object.isFrozen(state.currentField)).toBe(true)

    const replayed = new MemoryMaterializer().replay(database.listTransactions())
    expect(replayed.currentField).toEqual(state.currentField)
  })
  test('binds runtime actions and outcomes to one persisted workspace cycle', () => {
    const actionFact = mapRuntimeSessionEvent('session-runtime', event('tool/call', 3, {
      callId: 'call-runtime', name: 'read_file', arguments: 'README.md',
      prediction: {
        statement: 'the file read will stay inside the workspace',
        expectedOutcome: 'README.md is returned',
      },
    }))
    if (actionFact === null) throw new Error('expected action fact')
    const dispositionId = createMemoryId('disposition-runtime')
    const actionMutation = mapRuntimeBehaviorFact(actionFact, {
      cycleId: 'cycle-runtime', workspaceHash: 'workspace-runtime',
      sceneId: createMemoryId('scene-runtime'), workspaceMemoryIds: [dispositionId], actions: [],
    })
    expect(actionMutation.action?.sourceMemoryIds).toEqual(expect.arrayContaining([dispositionId]))
    const fallbackId = createMemoryId('workspace-fallback')
    const candidateFact = mapRuntimeSessionEvent('session-runtime', event('assistant/message', 5, {
      message: { content: [{ type: 'text', text: 'I will ask before acting' }] },
    }))
    if (candidateFact === null) throw new Error('expected candidate action fact')
    const candidateMutation = mapRuntimeBehaviorFact(candidateFact, {
      cycleId: 'cycle-runtime', workspaceHash: 'workspace-runtime',
      sceneId: createMemoryId('scene-runtime'),
      workspaceMemoryIds: [dispositionId, fallbackId],
      goals: [createGoalId('goal-runtime')],
      candidateActionSources: [{
        action: 'ask before acting', sourceMemoryIds: [dispositionId],
        utility: 0,
        inhibition: 0,
        selectionValue: 0,
        reasons: [],
      }],
      actions: [],
    })
    expect(candidateMutation.action?.sourceMemoryIds).toEqual([
      createMemoryId('scene-runtime'), dispositionId,
    ])
    expect(candidateMutation.action?.goalIds).toEqual([createGoalId('goal-runtime')])
    expect(candidateMutation.action?.sourceMemoryIds).not.toContain(fallbackId)
    expect(actionMutation.action?.cycleId).toBe('cycle-runtime')
    expect(actionMutation.action?.workspaceHash).toBe('workspace-runtime')
    expect(actionMutation.action?.correlationKey).toBe('call-runtime')
    expect(actionMutation.prediction?.expectedOutcome).toBe('README.md is returned')
    if (actionMutation.action === undefined) throw new Error('expected runtime action')
    if (actionMutation.prediction === undefined) throw new Error('expected runtime prediction')
    expect(actionMutation.action.predictionIds).toEqual([actionMutation.prediction.id])
    const outcomeFact = mapRuntimeSessionEvent('session-runtime', event('tool/result', 4, {
      message: { content: [{ toolCallId: 'call-runtime', content: 'read completed' }] },
    }, 1767225601000))
    if (outcomeFact === null) throw new Error('expected outcome fact')
    const outcomeMutation = mapRuntimeBehaviorFact(outcomeFact, {
      cycleId: 'cycle-runtime', workspaceHash: 'workspace-runtime',
      actions: [actionMutation.action],
    })
    expect(outcomeMutation.outcome?.actionId).toBe(actionMutation.action.id)
    expect(outcomeMutation.outcome?.cycleId).toBe(actionMutation.action.cycleId)
    expect(outcomeMutation.outcome?.status).toBe('observed')
    expect(outcomeMutation.outcome?.sessionId).toBe('session-runtime')
    const delayedFact = mapRuntimeSessionEvent('session-later', event('tool/result', 7, {
      callId: 'call-runtime', message: { content: [{ type: 'text', text: 'delayed result arrived' }] },
    }, 1767225602000))
    if (delayedFact === null) throw new Error('expected delayed outcome fact')
    const delayedMutation = mapRuntimeBehaviorFact(delayedFact, { cycleId: 'later-cycle', workspaceHash: 'later-workspace', actions: [actionMutation.action] })
    expect(delayedMutation.outcome?.cycleId).toBe(actionMutation.action.cycleId)
    expect(delayedMutation.outcome?.delayed).toBe(true)
    const correctionFact = mapRuntimeSessionEvent('session-later', event('user/message', 8, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the result needs a correction' }],
      feedback: {
        kind: 'correct',
        actionId: String(actionMutation.action.id),
        outcomeId: String(outcomeMutation.outcome?.id),
        factualCorrection: 'the result was broader than the requested scope',
        taskOutcome: -0.6,
        predictionAccuracy: -0.8,
        userResponse: 'corrected',
        relationshipConsequence: -0.3,
        boundaryRespect: 'changed',
        autonomyEffect: -0.2,
        safetyEffect: -0.4,
        delayedConsequence: 'the correction remained relevant in the next session',
        explanation: 'user corrected the action outcome',
      },
    }, 1767225603000))
    if (correctionFact === null) throw new Error('expected explicit feedback fact')
    const feedbackMutation = mapRuntimeBehaviorFact(correctionFact, {
      cycleId: 'later-cycle',
      workspaceHash: 'later-workspace',
      actions: [actionMutation.action],
      outcomes: outcomeMutation.outcome === undefined ? [] : [outcomeMutation.outcome],
    })
    expect(feedbackMutation.feedback?.kind).toBe('correct')
    expect(feedbackMutation.feedback?.actionId).toBe(actionMutation.action.id)
    expect(feedbackMutation.feedback?.outcomeId).toBe(outcomeMutation.outcome?.id)
    expect(feedbackMutation.feedback?.factualCorrection).toBe('the result was broader than the requested scope')
    expect(feedbackMutation.feedback?.taskOutcome).toBe(-0.6)
    expect(feedbackMutation.feedback?.predictionAccuracy).toBe(-0.8)
    expect(feedbackMutation.feedback?.userResponse).toBe('corrected')
    expect(feedbackMutation.feedback?.relationshipConsequence).toBe(-0.3)
    expect(feedbackMutation.feedback?.boundaryRespect).toBe('changed')
    expect(feedbackMutation.feedback?.autonomyEffect).toBe(-0.2)
    expect(feedbackMutation.feedback?.safetyEffect).toBe(-0.4)
    expect(feedbackMutation.feedback?.delayed).toBe(true)
    const directDispositionFact = mapRuntimeSessionEvent('session-runtime', event('user/message', 9, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'that disposition is too broad' }],
      feedback: {
        kind: 'correct',
        dispositionId: String(dispositionId),
        taskOutcome: -0.5,
        actionCost: 0.1,
        explanation: 'the disposition needs a narrower condition',
      },
    }, 1767225604000))
    if (directDispositionFact === null) throw new Error('expected direct disposition feedback fact')
    const directDispositionMutation = mapRuntimeBehaviorFact(directDispositionFact, {
      cycleId: 'later-cycle',
      workspaceHash: 'later-workspace',
      actions: [actionMutation.action],
    })
    expect(directDispositionMutation.feedback?.actionId).toBe(actionMutation.action.id)
    expect(directDispositionMutation.feedback?.dispositionId).toBe(dispositionId)
    expect(directDispositionMutation.feedback?.outcomeId).toBeUndefined()
  })
  test('binds feedback to the outcome prediction when an action has multiple predictions', () => {
    const cycleId = createWorkspaceCycleId('runtime-multiple-predictions-cycle')
    const predictionA = {
      id: createPredictionId('runtime-multiple-predictions-a'),
      cycleId,
      statement: 'the first prediction',
      sourceMemoryIds: [],
      expectedOutcome: 'first outcome',
      epistemic: 'hypothesized' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const
    const predictionB = {
      ...predictionA,
      id: createPredictionId('runtime-multiple-predictions-b'),
      statement: 'the second prediction',
      expectedOutcome: 'second outcome',
    } as const
    const action = {
      id: createActionId('runtime-multiple-predictions-action'),
      cycleId,
      sessionId: 'runtime-origin-session',
      workspaceHash: 'runtime-origin-workspace',
      actor: createParticipantId('rin'),
      description: 'perform the action',
      correlationKey: 'runtime-multiple-predictions-call',
      goalIds: [],
      sourceMemoryIds: [],
      predictionIds: [predictionA.id, predictionB.id],
      occurredAt: '2026-01-01T00:00:01.000Z',
    } as const
    const outcome = {
      id: createOutcomeId('runtime-multiple-predictions-outcome'),
      cycleId,
      sessionId: 'runtime-later-session',
      actionId: action.id,
      predictionId: predictionB.id,
      status: 'observed' as const,
      description: 'second outcome arrived',
      occurredAt: '2026-01-01T00:00:02.000Z',
      delayed: true,
    }
    const ambiguousOutcomeFact = mapRuntimeSessionEvent('runtime-later-session', event('tool/result', 9, {
      callId: 'runtime-multiple-predictions-call',
      message: { content: [{ type: 'text', text: 'ambiguous outcome arrived' }] },
    }, 1767225602000))
    if (ambiguousOutcomeFact === null) throw new Error('expected ambiguous outcome fact')
    const ambiguousOutcomeMutation = mapRuntimeBehaviorFact(ambiguousOutcomeFact, {
      cycleId: 'runtime-later-cycle',
      workspaceHash: 'runtime-later-workspace',
      actions: [action],
      predictions: [predictionA, predictionB],
    })
    expect(ambiguousOutcomeMutation.outcome?.predictionId).toBeUndefined()
    const explicitOutcomeFact = mapRuntimeSessionEvent('runtime-later-session', event('tool/result', 10, {
      callId: 'runtime-multiple-predictions-call',
      predictionId: String(predictionB.id),
      message: { content: [{ type: 'text', text: 'explicit second outcome arrived' }] },
    }, 1767225602500))
    if (explicitOutcomeFact === null) throw new Error('expected explicitly bound outcome fact')
    const explicitOutcomeMutation = mapRuntimeBehaviorFact(explicitOutcomeFact, {
      cycleId: 'runtime-later-cycle',
      workspaceHash: 'runtime-later-workspace',
      actions: [action],
      predictions: [predictionA, predictionB],
    })
    expect(explicitOutcomeMutation.outcome?.predictionId).toBe(predictionB.id)
    const fact = mapRuntimeSessionEvent('runtime-later-session', event('user/message', 2, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the delayed result needs correction' }],
      feedback: {
        kind: 'correct',
        actionId: String(action.id),
        outcomeId: String(outcome.id),
        taskOutcome: -0.4,
        actionCost: 0.1,
        factualCorrection: 'the second prediction was wrong',
        explanation: 'feedback follows the delayed outcome',
      },
    }, 1767225603000))
    if (fact === null) throw new Error('expected multiple-prediction feedback fact')
    const mutation = mapRuntimeBehaviorFact(fact, {
      cycleId: 'runtime-later-cycle',
      workspaceHash: 'runtime-later-workspace',
      actions: [action],
      outcomes: [outcome],
      predictions: [predictionA, predictionB],
    })
    expect(mutation.feedback?.predictionId).toBe(predictionB.id)

    const ambiguousFact = mapRuntimeSessionEvent('runtime-later-session', event('user/message', 3, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the action needs correction without an outcome' }],
      feedback: { kind: 'correct', actionId: String(action.id), taskOutcome: -0.3 },
    }, 1767225604000))
    if (ambiguousFact === null) throw new Error('expected ambiguous feedback fact')
    const ambiguousMutation = mapRuntimeBehaviorFact(ambiguousFact, {
      cycleId: 'runtime-later-cycle',
      workspaceHash: 'runtime-later-workspace',
      actions: [action],
      outcomes: [],
      predictions: [predictionA, predictionB],

    })
    expect(ambiguousMutation.feedback?.predictionId).toBeUndefined()

    const outcomeOnlyFact = mapRuntimeSessionEvent('runtime-later-session', event('user/message', 4, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the identified outcome needs follow-up' }],
      feedback: {
        kind: 'correct',
        outcomeId: String(outcome.id),
        taskOutcome: -0.2,
      },
    }, 1767225605000))
    if (outcomeOnlyFact === null) throw new Error('expected outcome-only feedback fact')
    const outcomeOnlyMutation = mapRuntimeBehaviorFact(outcomeOnlyFact, {
      cycleId: 'runtime-later-cycle',
      workspaceHash: 'runtime-later-workspace',
      actions: [action],
      outcomes: [outcome],
      predictions: [predictionA, predictionB],
    })
    expect(outcomeOnlyMutation.feedback?.actionId).toBe(action.id)
    expect(outcomeOnlyMutation.feedback?.outcomeId).toBe(outcome.id)
    expect(outcomeOnlyMutation.feedback?.predictionId).toBe(predictionB.id)
  })
  test('rejects out-of-range multidimensional feedback', () => {

    expect(() => mapRuntimeSessionEvent('session-invalid-feedback', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'invalid feedback' }],
      feedback: {
        kind: 'accept',
        actionId: 'action-invalid-feedback',
        taskOutcome: 0,
        predictionAccuracy: 1.1,
      },
    }))).toThrow('predictionAccuracy must be between -1 and 1')
  })
  test('drops feedback when an explicit prediction or outcome is not bound to the action', () => {
    const cycleId = createWorkspaceCycleId('feedback-target-cycle')
    const prediction = {
      id: createPredictionId('feedback-target-prediction'),
      cycleId,
      statement: 'the action will preserve the requested scope',
      sourceMemoryIds: [],
      expectedOutcome: 'scope is preserved',
      epistemic: 'hypothesized' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const action = {
      id: createActionId('feedback-target-action'),
      cycleId,
      workspaceHash: 'feedback-target-workspace',
      actor: createParticipantId('rin'),
      description: 'preserve the requested scope',
      goalIds: [],
      sourceMemoryIds: [],
      predictionIds: [prediction.id],
      occurredAt: '2026-01-01T00:00:01.000Z',
    }
    const outcome = {
      id: createOutcomeId('feedback-target-outcome'),
      cycleId,
      actionId: action.id,
      predictionId: prediction.id,
      status: 'observed' as const,
      description: 'scope was preserved',
      occurredAt: '2026-01-01T00:00:02.000Z',
      delayed: false,
    }
    const context = {
      cycleId: 'later-cycle',
      workspaceHash: 'later-workspace',
      actions: [action],
      outcomes: [outcome],
      predictions: [prediction],
    }
    const invalidPredictionFact = mapRuntimeSessionEvent('session-later', event('user/message', 9, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the prediction target is invalid' }],
      feedback: {
        kind: 'correct',
        actionId: String(action.id),
        predictionId: 'missing-prediction',
        outcomeId: String(outcome.id),
      },
    }))
    if (invalidPredictionFact === null) throw new Error('expected invalid prediction feedback fact')
    expect(mapRuntimeBehaviorFact(invalidPredictionFact, context)).toEqual({})
    const invalidOutcomeFact = mapRuntimeSessionEvent('session-later', event('user/message', 10, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the outcome target is invalid' }],
      feedback: {
        kind: 'correct',
        actionId: String(action.id),
        predictionId: String(prediction.id),
        outcomeId: 'missing-outcome',
      },
    }))
    if (invalidOutcomeFact === null) throw new Error('expected invalid outcome feedback fact')
    expect(mapRuntimeBehaviorFact(invalidOutcomeFact, context)).toEqual({})
  })

  test('binds an ambiguous runtime action to the highest-value matching candidate', () => {
    const shortLowerValue = {
      action: 'act',
      sourceMemoryIds: [createMemoryId('candidate-short')],
      utility: 0.2,
      inhibition: 0.1,
      selectionValue: 0.8,
      reasons: ['low value'],
    } as const
    const longHigherValue = {
      action: 'act carefully',
      sourceMemoryIds: [createMemoryId('candidate-long')],
      utility: -0.1,
      inhibition: 0.2,
      selectionValue: 0.2,
      reasons: ['high current-field value'],
    } as const
    expect(selectCandidateActionSources(
      'I will act carefully within the requested scope.',
      [shortLowerValue, longHigherValue],
    )).toEqual([shortLowerValue])
  })

  test('does not guess an action when an outcome or feedback binding is ambiguous', () => {
    const cycleId = createWorkspaceCycleId('runtime-ambiguous-action-cycle')
    const action = (id: string) => ({
      id: createActionId(id),
      cycleId,
      sessionId: 'runtime-ambiguous-origin',
      correlationKey: 'runtime-ambiguous-call',
      workspaceHash: 'runtime-ambiguous-workspace',
      actor: createParticipantId('rin'),
      description: 'perform an ambiguous action',
      goalIds: [],
      sourceMemoryIds: [],
      predictionIds: [],
      occurredAt: '2026-01-01T00:00:01.000Z',
    } as const)
    const actions = [
      action('runtime-ambiguous-action-a'),
      action('runtime-ambiguous-action-b'),
    ]
    const context = {
      cycleId,
      workspaceHash: 'runtime-ambiguous-workspace',
      actions,
    }
    const uncorrelatedOutcome = mapRuntimeSessionEvent('runtime-ambiguous-later', event('tool/result', 1, {
      message: { content: [{ type: 'text', text: 'an outcome without a call binding' }] },
    }))
    if (uncorrelatedOutcome === null) throw new Error('expected uncorrelated outcome fact')
    expect(mapRuntimeBehaviorFact(uncorrelatedOutcome, context)).toEqual({})

    const duplicateCorrelationOutcome = mapRuntimeSessionEvent('runtime-ambiguous-later', event('tool/result', 2, {
      callId: 'runtime-ambiguous-call',
      message: { content: [{ type: 'text', text: 'an outcome with a duplicate call binding' }] },
    }))
    if (duplicateCorrelationOutcome === null) throw new Error('expected duplicate correlation outcome fact')
    expect(mapRuntimeBehaviorFact(duplicateCorrelationOutcome, context)).toEqual({})

    const duplicateCorrelationFeedback = mapRuntimeSessionEvent('runtime-ambiguous-later', event('user/message', 3, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the ambiguous action needs correction' }],
      feedback: {
        kind: 'correct',
        correlationKey: 'runtime-ambiguous-call',
        taskOutcome: -0.4,
      },
    }))
    if (duplicateCorrelationFeedback === null) throw new Error('expected duplicate correlation feedback fact')
    expect(mapRuntimeBehaviorFact(duplicateCorrelationFeedback, context)).toEqual({})
  })

  test('keeps feedback action-level when an action has multiple outcomes', () => {
    const cycleId = createWorkspaceCycleId('runtime-multiple-outcomes-cycle')
    const action = {
      id: createActionId('runtime-multiple-outcomes-action'),
      cycleId,
      workspaceHash: 'runtime-multiple-outcomes-workspace',
      actor: createParticipantId('rin'),
      description: 'perform an action with multiple outcomes',
      goalIds: [],
      sourceMemoryIds: [],
      predictionIds: [],
      occurredAt: '2026-01-01T00:00:01.000Z',
    }
    const outcomes = [
      {
        id: createOutcomeId('runtime-multiple-outcomes-first'),
        cycleId,
        actionId: action.id,
        status: 'observed' as const,
        description: 'the first outcome arrived',
        occurredAt: '2026-01-01T00:00:02.000Z',
        delayed: false,
      },
      {
        id: createOutcomeId('runtime-multiple-outcomes-second'),
        cycleId,
        actionId: action.id,
        status: 'observed' as const,
        description: 'the second outcome arrived',
        occurredAt: '2026-01-01T00:00:03.000Z',
        delayed: true,
      },
    ]
    const fact = mapRuntimeSessionEvent('runtime-multiple-outcomes-session', event('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the action needs correction' }],
      feedback: { kind: 'correct', actionId: String(action.id), taskOutcome: -0.4 },
    }))
    if (fact === null) throw new Error('expected multiple-outcomes feedback fact')
    const mutation = mapRuntimeBehaviorFact(fact, {
      cycleId,
      workspaceHash: 'runtime-multiple-outcomes-workspace',
      actions: [action],
      outcomes,
    })
    expect(mutation.feedback?.actionId).toBe(action.id)
    expect(mutation.feedback?.outcomeId).toBeUndefined()
  })
})
