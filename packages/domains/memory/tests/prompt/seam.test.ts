import { describe, expect, test } from 'vitest'
import {
  PROMPT_MEMORY_SECTION_NAME,
  registerPromptMemorySeam,
  type PromptAssembly,
  type PromptAssemblyListener,
  type PromptMemorySeam,
} from '../../src/prompt/seam.ts'
import {
  buildCanonicalPromptMemorySectionText,
  hashCanonicalPromptMemoryProjection,
} from '../../src/prompt/projection.ts'
import type {
  MemoryMaterializedState,
  MemoryProjectionCheckpoint,
} from '@rin/memory'
import {
  createEmptyMaterializedState,
  createCurrentField,
  createMemory,
  createMemoryId,
  createParticipantId,
} from '../../src/index.ts'
import { MemoryRecallEngine } from '../../src/recall.ts'

describe('prompt-memory seam', () => {
function canonicalSelfMemory(
  id: string,
  epistemic: 'observed' | 'hypothesized',
  influence: 'permitted' | 'blocked',
): ReturnType<typeof createMemory> {
  return createMemory({
    id: createMemoryId(id),
    form: 'self-model',
    data: {
      values: [influence === 'permitted' ? 'protect user agency' : 'blocked candidate value'],
      abilities: ['long-horizon reasoning'],
      tendencies: ['state uncertainty explicitly'],
      historicalChanges: [],
    },
    state: {
      persistence: 'durable',
      activation: 'workspace',
      integration: 'integrated',
      epistemic,
      influence,
    },
    dynamics: {
      activation: 0.8,
      accessibility: 0.8,
      salience: 0.7,
      stability: 0.8,
      confidence: epistemic === 'observed' ? 0.9 : 0.2,
      integrationStrength: 0.8,
      novelty: 0.1,
      surprise: 0.1,
      affect: { valence: 0.2, arousal: 0.3, control: 0.8 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: influence === 'permitted' ? 0.1 : 1,
      influenceSurfaces: influence === 'permitted' ? ['model-input'] : [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: influence === 'permitted'
      ? '2026-01-01T00:00:01.000Z'
      : '2026-01-01T00:00:02.000Z',
  })
}

function cognitionState(memories: readonly ReturnType<typeof createMemory>[]): MemoryMaterializedState {
  return {
    ...createEmptyMaterializedState(),
    version: 1,
    eventCount: memories.length,
    memories,
  }
}

function makeCanonicalSeam(stateRef: { current: MemoryMaterializedState }, failFirstClean = false) {
  let section: { name: string; order: number; text: string } | undefined
  let listener: PromptAssemblyListener | undefined
  let statusCalls = 0
  let cleanCalls = 0
  let checkpoint: MemoryProjectionCheckpoint = {
    projection: 'prompt-memory',
    lastEventSeq: 1,
    materializedVersion: 0,
    stateHash: 'empty',
    status: 'dirty',
    dirtySinceEventSeq: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const ctx: PromptMemorySeam = {
    systemPrompt: {
      section(value) {
        section = value
        return () => { section = undefined }
      },
    },
    on(_event, value) {
      listener = value
      return () => { listener = undefined }
    },
    effect: () => {},
    promptMemory: {
      async getStatus() {
        statusCalls += 1
        throw new Error('static prompt files must not be read')
      },
    },
    memory: {
      list: () => [],
      get: () => undefined,
      upsert: () => { throw new Error('legacy catalog must not be written') },
      delete: () => false,
      recordInjection: () => { throw new Error('legacy injection audit must not be written') },
      readCognitionState: () => stateRef.current,
      getProjectionCheckpoint: () => checkpoint,
      requireProjectionReady: () => {
        if (checkpoint.status !== 'clean') throw new Error('projection is not ready')
        return checkpoint
      },
      markProjectionDirty: () => {
        checkpoint = {
          ...checkpoint,
          status: 'dirty',
          dirtySinceEventSeq: checkpoint.lastEventSeq,
        }
        return checkpoint
      },
      markProjectionCleanAtCurrent: (_projection, materializedVersion, stateHash) => {
        cleanCalls += 1
        if (failFirstClean && cleanCalls === 1) throw new Error('journal advanced during projection')
        checkpoint = {
          ...checkpoint,
          materializedVersion,
          stateHash,
          status: 'clean',
          dirtySinceEventSeq: undefined,
        }
        return checkpoint
      },
    },
  }
  return {
    ctx,
    getSection: () => section,
    getStatusCalls: () => statusCalls,
    getCleanCalls: () => cleanCalls,
    async assemble(): Promise<PromptAssembly> {
      if (listener === undefined) throw new Error('assemble listener was not registered')
      const result = await listener(
        { sections: [{ name: PROMPT_MEMORY_SECTION_NAME, text: 'stale static text' }], contexts: [], tools: [], variables: {} },
        undefined,
        async () => ({ sections: [{ name: PROMPT_MEMORY_SECTION_NAME, text: 'stale static text' }], contexts: [], tools: [], variables: {} }),
      )
      if (result === undefined) throw new Error('assemble listener did not return an assembly')
      return result
    },
  }
}

  test('requires the canonical cognition surface and refuses the legacy static projection', async () => {
    let listener: ((assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly> | void) | undefined
    const ctx: PromptMemorySeam = {
      systemPrompt: {
        section: () => () => {},
      },
      on: (_event, nextListener) => {
        listener = nextListener
        return () => {}
      },
      effect: () => {},
      memory: {},
    }
    await expect(registerPromptMemorySeam(ctx, { injectSoul: true, injectBrief: true }))
      .rejects.toThrow('canonical cognition surface is required')
    expect(listener).toBeUndefined()
  })
  test('uses canonical cognition state as the only model-input source', async () => {
    const permitted = canonicalSelfMemory('self-permitted', 'observed', 'permitted')
    const blocked = canonicalSelfMemory('candidate-blocked', 'hypothesized', 'blocked')
    const stateRef = { current: cognitionState([blocked, permitted]) }
    const text = buildCanonicalPromptMemorySectionText(stateRef.current)
    expect(text).toContain('protect user agency')
    expect(text).toContain('epistemic=observed')
    expect(text).not.toContain('blocked candidate value')
    expect(hashCanonicalPromptMemoryProjection(stateRef.current, text)).toHaveLength(64)

    const surface = makeCanonicalSeam(stateRef, true)
    await registerPromptMemorySeam(surface.ctx, { injectSoul: true, injectBrief: true })

    expect(surface.getStatusCalls()).toBe(0)
    expect(surface.getCleanCalls()).toBe(2)
    expect(surface.getSection()?.text).toContain('protect user agency')
    expect(surface.getSection()?.text).not.toContain('stale static text')

    const assembled = await surface.assemble()
    expect(assembled.sections[0]?.text).toContain('protect user agency')
    expect(assembled.sections[0]?.text).not.toContain('stale static text')
    expect(surface.getStatusCalls()).toBe(0)
  })

  test('keeps unrelated contextual person state out of fallback model input', () => {
    const sceneBase = canonicalSelfMemory('context-projection-scene', 'observed', 'permitted')
    const scene = createMemory({
      ...sceneBase,
      form: 'scene',
      data: {
        participants: [createParticipantId('user')],
        environment: 'active environment',
        goals: [],
        observations: ['the active scene'],
        interpretations: [],
        actions: [],
        outcomes: [],
        predictionErrors: [],
        affect: sceneBase.dynamics.affect,
      },
    })
    const personBase = canonicalSelfMemory('context-projection-person-base', 'observed', 'permitted')
    const matching = createMemory({
      ...personBase,
      id: createMemoryId('context-projection-person-matching'),
      form: 'person-model',
      data: {
        subject: createParticipantId('user'),
        claims: ['matching contextual claim'],
        observedPatterns: [],
        currentState: [],
        lastObservedAt: scene.updatedAt,
        contextConditions: ['active environment'],
      },
    })
    const unrelated = createMemory({
      ...matching,
      id: createMemoryId('context-projection-person-unrelated'),
      data: {
        ...matching.data,
        claims: ['unrelated contextual claim'],
        contextConditions: ['unrelated environment'],
      },
    })
    const state = {
      ...cognitionState([scene, matching, unrelated]),
      currentField: createCurrentField({
        ownerId: 'rin',
        version: 2,
        updatedAt: '2026-01-01T00:00:03.000Z',
        sceneId: scene.id,
        sceneVersion: scene.updatedAt,
        sceneStatus: 'open',
        participants: [createParticipantId('user')],
        goals: [],
        affect: scene.dynamics.affect,
        predictions: [],
        predictionErrors: [],
        activeOpenLoops: [],
        candidateActions: [],
        activeMemoryCoalition: [scene.id, matching.id, unrelated.id],
        uncertainty: [],
      }),
    }
    const text = buildCanonicalPromptMemorySectionText(state)
    expect(text).toContain('matching contextual claim')
    expect(text).not.toContain('unrelated contextual claim')
  })

  test('routes canonical prompt assembly through unified recall workspace', async () => {
    const permitted = canonicalSelfMemory('recall-permitted', 'observed', 'permitted')
    const blocked = canonicalSelfMemory('recall-blocked', 'hypothesized', 'blocked')
    const stateRef = { current: cognitionState([blocked, permitted]) }
    const recallEngine = new MemoryRecallEngine()
    const surface = makeCanonicalSeam(stateRef)
    const calls: Array<string | undefined> = []
    const memory = surface.ctx.memory
    if (memory === undefined) throw new Error('canonical memory surface missing')
    memory.recall = async input => {
      calls.push(input?.cycleId)
      return recallEngine.recall(stateRef.current, input)
    }
    await registerPromptMemorySeam(surface.ctx, { injectSoul: true, injectBrief: true })
    expect(calls).toHaveLength(1)
    expect(surface.getSection()?.text).toContain('Rin memory workspace')
    expect(surface.getSection()?.text).toContain('protect user agency')
    expect(surface.getSection()?.text).not.toContain('blocked candidate value')
    const assembled = await surface.assemble()
    expect(assembled.sections[0]?.text).toContain('Rin memory workspace')
    expect(assembled.sections[0]?.text).not.toContain('blocked candidate value')
    expect(calls).toHaveLength(2)
  })
  test('renders the ordered current-field action competition into model input', () => {
    const permitted = canonicalSelfMemory('action-competition-prompt', 'observed', 'permitted')
    const state = cognitionState([permitted])
    state.currentField = createCurrentField({
      ...state.currentField,
      version: 1,
      updatedAt: '2026-01-01T00:00:03.000Z',
      sceneId: permitted.id,
      sceneVersion: permitted.updatedAt,
      sceneStatus: 'open',
      candidateActions: ['ask before acting'],
      candidateActionSources: [{
        action: 'ask before acting',
        sourceMemoryIds: [permitted.id],
        utility: 0.8,
        inhibition: 0.1,
        selectionValue: 0.5,
        reasons: ['contextual utility=0.80', 'inhibition=0.10'],
      }],
    })
    const text = buildCanonicalPromptMemorySectionText(state)
    expect(text).toContain('candidate action competition:')
    expect(text).toContain('ask before acting [selection=0.5, utility=0.8, inhibition=0.1')
    expect(text).toContain('contextual utility=0.80')
  })

})
