/**
 * @rin/host ºw^~)Þt real memory continuity smoke.
 *
 * Boots the actual host assembly twice against one isolated RIN_HOME, publishes
 * one user message per sequential session, and verifies that the memory domain
 * preserves one scene across the host restart while the host-wide canonical
 * prompt seam remains registered and projection-ready.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  createEvidenceId,
  createFeedbackId,
  createGoalId,
  createMemory,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryId,
  createMemoryTransactionId,
  createMemoryTransitionTransaction,
  createRuntimeActor,
  MemoryCognitionDatabase,
  transitionMemory,
  type MemoryTransition,
  type RinMemory,
} from '@rin/memory'
import { registerRinPromptMemorySeam } from '../src/host.ts'
import {
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  defaultConfig,
  dshHome,
  rinHome,
  sessionRoot,
  settingsPath,
  credentialsPath,
  webUiDistRoot,
} from '@rin/host'

process.env.RIN_PACKAGED_RUNTIME = '1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function buildPatches() {
  return [
    ...loadOverlayPatches('rin', baseBundlePatchPath()),
    {
      id: 'web-server',
      config: { ...defaultConfig['web-server'], enabled: false, port: 0 },
    },
    { id: 'session-persistence-jsonl', config: { root: sessionRoot() } },
    { id: 'settings', config: { path: settingsPath(), dshHome: dshHome() } },
    { id: 'credentials', config: { path: credentialsPath(), dshHome: dshHome() } },
    {
      id: 'session-query-sqlite',
      config: { path: rinHome('sessions/search.sqlite'), openAt: 'first-search' },
    },
    { id: 'tools', config: { mode: 'both' } },
    { id: 'tool-bash', disabled: true },
    { id: 'hmr', disabled: true },
  ]
}

async function bootRinHost() {
  return boot(
    'rin',
    configPath(),
    buildPatches(),
    hostCtx => {
      hostCtx.provide('rinHome', rinHome)
      hostCtx.provide('dshHome', dshHome)
      hostCtx.provide('sessionRoot', sessionRoot)
      hostCtx.provide('settingsPath', settingsPath)
      hostCtx.provide('credentialsPath', credentialsPath)
      hostCtx.provide('builtinRepositoryRoot', builtinRepositoryRoot)
      hostCtx.provide('webUiDistRoot', webUiDistRoot)
    },
    undefined,
  )
}

async function publishUserMessage(ctx: Awaited<ReturnType<typeof bootRinHost>>, id: string, text: string) {
  const session = ctx.sessions.prepare(id)
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  await new Promise<void>(resolve => setImmediate(resolve))
  await ctx.sessions.flush(session)
  return { session, detach }
}

function sceneSnapshot(ctx: Awaited<ReturnType<typeof bootRinHost>>) {
  const state = ctx.memory.readCognitionState()
  const scenes = state.memories.filter(memory => memory.form === 'scene')
  return { state, scenes }
}

function appendCanonicalTransition(
  database: MemoryCognitionDatabase,
  current: RinMemory,
  transition: MemoryTransition,
  key: string,
): RinMemory {
  const next = transitionMemory(current, transition)
  const actor = createRuntimeActor('wave6-host-fixture')
  database.appendTransaction(createMemoryTransitionTransaction({
    actor,
    memoryId: current.id,
    memory: next,
    transition,
    commandId: createMemoryCommandId('wave6-host-transition-command-' + key),
    eventId: createMemoryEventId('wave6-host-transition-event-' + key),
    transactionId: createMemoryTransactionId('wave6-host-transition-' + key),
    correlationId: createMemoryCorrelationId('wave6-host-transition-' + key),
    issuedAt: transition.at,
    committedAt: transition.at,
  }))
  return next
}

function seedPermittedDisposition(
  ctx: Awaited<ReturnType<typeof bootRinHost>>,
  database: MemoryCognitionDatabase,
  disposition: RinMemory,
  key: string,
): RinMemory {
  ctx.memory.recordModelProposal({
    memory: disposition,
    basis: 'model-inference',
    evidenceIds: [createEvidenceId('wave6-host-seed-evidence-' + key)],
    rationale: 'a repeated behavior pattern is proposed for controller review',
  })
  let current = disposition
  for (const [type, at] of [
    ['encode', '2026-01-01T00:00:01.000Z'],
    ['durable', '2026-01-01T00:00:02.000Z'],
    ['link', '2026-01-01T00:00:03.000Z'],
    ['consolidate', '2026-01-01T00:00:04.000Z'],
    ['integrate', '2026-01-01T00:00:05.000Z'],
  ] as const) {
    current = appendCanonicalTransition(database, current, { type, at }, key + '-' + type)
  }
  const permission = ctx.memory.permitInfluence({
    memoryId: current.id,
    previousVersion: current.updatedAt,
    surfaces: ['model-input', 'action-selection'],
    reason: 'owner explicitly permits this disposition to guide the next action',
    ownerId: 'wave6-owner-' + key,
    at: '2026-01-01T00:00:06.000Z',
  })
  assert(permission.actor.kind === 'owner', 'behavioral permission must be owner-issued')
  const permitted = ctx.memory.readCognitionState().memories.find(item => item.id === disposition.id)
  assert(permitted?.state.influence === 'permitted', 'owner permission must produce a permitted disposition')
  assert(
    permitted?.dynamics.influenceSurfaces.includes('action-selection'),
    'owner permission must name action-selection as an influence surface',
  )
  assert(permitted !== undefined, 'permitted disposition must remain in the cognition journal')
  return permitted
}

async function main(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'rin-wave1-memory-'))
  const previous = {
    RIN_HOME: process.env.RIN_HOME,
    DSH_HOME: process.env.DSH_HOME,
  }
  process.env.RIN_HOME = join(sandbox, 'rin-home')
  process.env.DSH_HOME = join(sandbox, 'dsh-home')

  let firstCtx: Awaited<ReturnType<typeof bootRinHost>> | undefined
  let secondCtx: Awaited<ReturnType<typeof bootRinHost>> | undefined
  let firstDetach: (() => unknown) | undefined
  let secondDetach: (() => unknown) | undefined
  let thirdDetach: (() => unknown) | undefined
  let permittedDispositionId: ReturnType<typeof createMemoryId> | undefined
  try {
    firstCtx = await bootRinHost()
    await registerRinPromptMemorySeam(firstCtx)
    const first = await publishUserMessage(firstCtx, 'wave1-session-a', 'wave1 first session observation')
    firstDetach = first.detach
    const firstSnapshot = sceneSnapshot(firstCtx)
    assert(firstSnapshot.scenes.length === 1, 'first real session must open one scene')
    assert(
      firstSnapshot.scenes[0]?.data.runtimeEventRefs.some(ref => ref.sessionId === 'wave1-session-a'),
      'first scene must retain the first session reference',
    )

    const disposition = createMemory({
      id: createMemoryId('wave6-host-permitted-disposition'),
      form: 'disposition',
      data: {
        triggeringContexts: ['wave6 positive behavior request'],
        intendedGoal: createGoalId('wave6-host-behavior-goal'),
        actionPattern: ['ask_before_acting'],
        expectedOutcomes: ['the user confirms the scope before the next tool call'],
        observedOutcomes: [],
        applicabilityConditions: ['the user asks for a scoped action'],
        failureModes: ['acting before the user confirms scope'],
        utilityByGoal: [],
      },
      state: {
        persistence: 'transient',
        activation: 'active',
        integration: 'raw',
        epistemic: 'inferred',
        influence: 'blocked',
      },
      dynamics: {
        activation: 0.6,
        accessibility: 0.7,
        salience: 0.6,
        stability: 0.6,
        confidence: 0.7,
        integrationStrength: 0.1,
        novelty: 0.2,
        surprise: 0.2,
        affect: { valence: 0, arousal: 0.2, control: 0.7 },
        validity: { startsAt: '2026-01-01T00:00:00.000Z' },
        utilityByGoal: [],
        inhibition: 0,
        influenceSurfaces: [],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const alternativeDisposition = createMemory({
      ...disposition,
      id: createMemoryId('wave6-host-alternative-disposition'),
      data: {
        ...disposition.data,
        actionPattern: ['proceed_without_confirmation'],
        utilityByGoal: [{ goalId: disposition.data.intendedGoal, value: 0.1 }],
      },
      dynamics: {
        ...disposition.dynamics,
        accessibility: 0.5,
        salience: 0.4,
        utilityByGoal: [{ goalId: disposition.data.intendedGoal, value: 0.1 }],
      },
    })
    const cognition = new MemoryCognitionDatabase(rinHome('memory/memory.db'))
    const permitted = seedPermittedDisposition(firstCtx, cognition, disposition, 'primary')
    const permittedAlternative = seedPermittedDisposition(firstCtx, cognition, alternativeDisposition, 'alternative')
    const permittedId = permitted.id
    const permittedAlternativeId = permittedAlternative.id
    permittedDispositionId = permittedId

    await firstCtx.fiber.dispose()
    firstCtx = undefined

    secondCtx = await bootRinHost()
    await registerRinPromptMemorySeam(secondCtx)
    const restored = sceneSnapshot(secondCtx)
    assert(restored.scenes.length === 1, 'scene must survive host restart')
    assert(
      restored.scenes[0]?.data.runtimeEventRefs.some(ref => ref.sessionId === 'wave1-session-a'),
      'restored scene must retain the first session reference',
    )

    const second = await publishUserMessage(
      secondCtx,
      'wave1-session-b',
      'wave1 continuation after restart; wave6 positive behavior request',
    )
    secondDetach = second.detach
    const continued = sceneSnapshot(secondCtx)
    assert(continued.scenes.length === 1, 'sequential sessions must continue one open scene')
    const refs = continued.scenes[0]?.data.runtimeEventRefs ?? []
    assert(refs.some(ref => ref.sessionId === 'wave1-session-a'), 'continued scene lost the first session')
    assert(refs.some(ref => ref.sessionId === 'wave1-session-b'), 'continued scene lost the second session')

    const assembly = await secondCtx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === 'rin:prompt-memory')
    assert(section !== undefined, 'real Host assembly must include rin:prompt-memory')
    assert(
      !section.text.includes('wave1 first session observation'),
      'blocked runtime scenes must not leak raw transcript into Prompt',
    )
    const checkpoint = secondCtx.memory.getProjectionCheckpoint('prompt-memory')
    assert(checkpoint.status === 'clean', 'Prompt projection checkpoint must be clean')
    assert(
      checkpoint.materializedVersion === continued.state.version,
      'Prompt checkpoint must match the materialized cognition version',
    )

    const recall = await secondCtx.memory.recall({
      cycleId: 'wave3-host-cycle',
      query: { sessionId: 'wave1-session-b', text: 'wave1 continuation' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    assert(recall.trace.cycleId === 'wave3-host-cycle', 'Host recall must preserve its cycle id')
    try {
      const stream = secondCtx.llm.stream({
        provider: 'wave3-smoke-provider',
        model: 'wave3-smoke-model',
        messages: [],
        sessionId: 'wave1-session-b' as never,
      })
      for await (const _chunk of stream) {}
    } catch {}
    const modelInputs = secondCtx.memory.listModelInputs('wave3-host-cycle')
    assert(modelInputs.length === 1, 'llm/stream must append one model-input record')
    assert(modelInputs[0]?.sessionId === 'wave1-session-b', 'model-input record must retain its session')
    assert(modelInputs[0]?.workspaceHash === recall.workspace.hash, 'model-input record must bind the recalled workspace')
    assert(modelInputs[0]?.inputHash.length === 64, 'model-input record must contain a SHA-256 input hash')

    const positiveField = secondCtx.memory.getCurrentField()
    assert(
      positiveField.candidateActions.includes('ask_before_acting'),
      'permitted disposition must expose its action candidate in the next current field',
    )
    assert(
      positiveField.candidateActions.length === 2
        && positiveField.candidateActions[0] === 'ask_before_acting'
        && positiveField.candidateActions[1] === 'proceed_without_confirmation',
      'current field must order both permitted action candidates by selection value',
    )
    assert(
      positiveField.candidateActionSources?.some(source =>
        source.action === 'ask_before_acting'
        && source.sourceMemoryIds.includes(permittedDispositionId ?? createMemoryId('missing')),
      ),
      'current field must retain the permitted disposition as the action source',
    )
    assert(
      positiveField.candidateActionSources?.some(source =>
        source.action === 'proceed_without_confirmation'
        && source.sourceMemoryIds.includes(permittedAlternativeId),
      ),
      'current field must retain the alternative disposition as the action source',
    )

    second.session.append('tool/call', {
      callId: 'wave6-positive-choice',
      name: 'ask_before_acting',
      arguments: '{"scope":"workspace"}',
      prediction: {
        statement: 'asking before acting will preserve the requested scope',
        expectedOutcome: 'the user confirms the scope before the next tool call',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-positive-choice', content: 'the user confirmed the scope' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const positiveState = secondCtx.memory.readCognitionState()
    const positiveAction = positiveState.actions.find(item =>
      item.correlationKey === 'wave6-positive-choice',
    )
    assert(positiveAction !== undefined, 'real Host permitted action must append an action record')
    assert(
      positiveAction.sourceMemoryIds.includes(permittedDispositionId ?? createMemoryId('missing')),
      'real Host permitted action must bind its disposition source',
    )
    const positiveOutcome = positiveState.outcomes.find(item => item.actionId === positiveAction.id)
    assert(positiveOutcome !== undefined, 'real Host permitted action must append its outcome')
    assert(positiveOutcome.status === 'observed', 'real Host permitted action outcome must be observed')
    const positiveUses = secondCtx.memory.listMemoryUseTraces(undefined, positiveAction.cycleId)
      .filter(use =>
        use.surface === 'action-selection'
        && use.id.includes(String(positiveAction.id)),
      )
    assert(
      positiveUses.some(use => use.memoryId === permittedDispositionId),
      'real Host permitted action must register action-selection use',
    )

    second.session.append('tool/call', {
      callId: 'wave6-alternative-choice',
      name: 'proceed_without_confirmation',
      arguments: '{"scope":"workspace"}',
      prediction: {
        statement: 'the alternative action will proceed without confirming the requested scope',
        expectedOutcome: 'the action remains attributable to the alternative disposition',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-alternative-choice', content: 'alternative action completed' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const alternativeState = secondCtx.memory.readCognitionState()
    const alternativeAction = alternativeState.actions.find(item =>
      item.correlationKey === 'wave6-alternative-choice',
    )
    assert(alternativeAction !== undefined, 'real Host alternative action must append an action record')
    assert(
      alternativeAction.sourceMemoryIds.includes(permittedAlternativeId),
      'real Host alternative action must bind the alternative disposition source',
    )
    assert(
      !alternativeAction.sourceMemoryIds.includes(permittedId),
      'real Host alternative action must not inherit the primary disposition source',
    )
    const alternativeUses = secondCtx.memory.listMemoryUseTraces(undefined, alternativeAction.cycleId)
      .filter(use =>
        use.surface === 'action-selection'
        && use.id.includes(String(alternativeAction.id)),
      )
    assert(
      alternativeUses.some(use => use.memoryId === permittedAlternativeId),
      'real Host alternative action must register the alternative action-selection use',
    )

    const permittedVersionBeforeFeedback = secondCtx.memory.readCognitionState().memories
      .find(item => item.id === permittedId)?.updatedAt
    assert(permittedVersionBeforeFeedback !== undefined, 'permitted disposition version must be readable before feedback')
    second.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the permitted action respected the requested scope' }],
      feedback: {
        kind: 'accept',
        actionId: String(positiveAction.id),
        outcomeId: String(positiveOutcome.id),
        dispositionId: String(permittedId),
        taskOutcome: 0.9,
        actionCost: 0.1,
        explanation: 'the permitted action asked before acting and preserved the requested scope',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const feedbackState = secondCtx.memory.readCognitionState()
    const positiveFeedback = feedbackState.feedback.find(item =>
      item.actionId === positiveAction.id
      && item.outcomeId === positiveOutcome.id,
    )
    assert(positiveFeedback !== undefined, 'real Host feedback must reconnect to the permitted action and outcome')
    const learnedDisposition = feedbackState.memories.find(item => item.id === permittedId)
    assert(learnedDisposition?.form === 'disposition', 'feedback maintenance must retain the disposition representation')
    assert(
      learnedDisposition.updatedAt !== permittedVersionBeforeFeedback,
      'feedback maintenance must create a new disposition version',
    )
    assert(
      learnedDisposition.data.supportingFeedbackIds?.includes(positiveFeedback.id),
      'feedback maintenance must bind the feedback id to the disposition',
    )
    const learnedGoalUtility = learnedDisposition.dynamics.utilityByGoal.find(item =>
      String(item.goalId) === 'wave6-host-behavior-goal',
    )
    assert(
      learnedGoalUtility?.value !== undefined && learnedGoalUtility.value > 0.8,
      'real Host feedback must update the learned disposition goal utility',
    )
    assert(
      learnedDisposition.data.utilityByGoal.some(item => String(item.goalId) === 'wave6-host-behavior-goal' && item.value > 0.8),
      'real Host feedback must update the disposition data utility',
    )

    const followupRecall = await secondCtx.memory.recall({
      cycleId: 'wave6-after-feedback',
      query: { sessionId: 'wave1-session-b', text: 'wave6 positive behavior request' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    assert(
      followupRecall.workspace.currentField?.candidateActions.includes('ask_before_acting'),
      'next recall must retain the learned action candidate',
    )
    const followupDisposition = followupRecall.trace.candidates.find(item => item.id === String(permittedId))
    assert(
      followupDisposition?.score.utility !== undefined && followupDisposition.score.utility > 0.8,
      'next recall must use the learned goal utility in its score',
    )
    try {
      const stream = secondCtx.llm.stream({
        provider: 'wave6-followup-provider',
        model: 'wave6-followup-model',
        messages: [],
        sessionId: 'wave1-session-b' as never,
      })
      for await (const _chunk of stream) {}
    } catch {}
    const followupModelInputs = secondCtx.memory.listModelInputs('wave6-after-feedback')
    assert(followupModelInputs.length === 1, 'next recall must bind one follow-up model input')
    assert(
      followupModelInputs[0]?.workspaceHash === followupRecall.workspace.hash,
      'follow-up model input must retain the post-feedback workspace hash',
    )
    second.session.append('tool/call', {
      callId: 'wave6-positive-choice-after-feedback',
      name: 'ask_before_acting',
      arguments: '{"scope":"workspace"}',
      prediction: {
        statement: 'asking before acting will preserve the requested scope after feedback',
        expectedOutcome: 'the user confirms the scope before the next tool call',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-positive-choice-after-feedback', content: 'the user confirmed the scope again' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const followupState = secondCtx.memory.readCognitionState()
    const followupAction = followupState.actions.find(item =>
      item.correlationKey === 'wave6-positive-choice-after-feedback',
    )
    assert(followupAction !== undefined, 'post-feedback Host action must be recorded')
    assert(
      followupAction.sourceMemoryIds.includes(permittedId),
      'post-feedback Host action must retain the learned disposition source',
    )
    const followupOutcome = followupState.outcomes.find(item => item.actionId === followupAction.id)
    assert(followupOutcome?.status === 'observed', 'post-feedback Host action outcome must be observed')
    const followupUses = secondCtx.memory.listMemoryUseTraces(undefined, followupAction.cycleId)
      .filter(use =>
        use.surface === 'action-selection'
        && use.id.includes(String(followupAction.id)),
      )
    assert(
      followupUses.some(use => use.memoryId === permittedId),
      'post-feedback Host action must register action-selection use',
    )

    second.session.append('tool/call', {
      callId: 'wave6-primary-rejected',
      name: 'ask_before_acting',
      arguments: '{"scope":"workspace"}',
      prediction: {
        statement: 'asking before acting will preserve the requested scope after the earlier result',
        expectedOutcome: 'the user confirms the scope after the earlier result',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-primary-rejected', content: 'the action exceeded the requested scope' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const rejectedState = secondCtx.memory.readCognitionState()
    const rejectedAction = rejectedState.actions.find(item =>
      item.correlationKey === 'wave6-primary-rejected',
    )
    assert(rejectedAction !== undefined, 'real Host rejected primary action must append an action record')
    const rejectedOutcome = rejectedState.outcomes.find(item => item.actionId === rejectedAction.id)
    assert(rejectedOutcome?.status === 'observed', 'rejected primary action must retain its observed tool outcome')
    second.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the primary action exceeded the requested scope' }],
      feedback: {
        kind: 'reject',
        actionId: String(rejectedAction.id),
        outcomeId: String(rejectedOutcome.id),
        dispositionId: String(permittedId),
        taskOutcome: -0.9,
        actionCost: 0.2,
        explanation: 'the primary action was rejected so the alternative should win the next competition',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const reorderedRecall = await secondCtx.memory.recall({
      cycleId: 'wave6-after-primary-rejection',
      query: { sessionId: 'wave1-session-b', text: 'wave6 positive behavior request' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    const reorderedSources = reorderedRecall.workspace.currentField?.candidateActionSources ?? []
    assert(
      reorderedSources[0]?.action === 'proceed_without_confirmation'
        && reorderedSources[1]?.action === 'ask_before_acting',
      'primary rejection must reorder the alternative ahead of the primary candidate',
    )
    assert(
      (reorderedSources[0]?.selectionValue ?? -1) > (reorderedSources[1]?.selectionValue ?? 1),
      'reordered alternative must have the higher selection value',
    )
    const reorderedPrimary = reorderedSources.find(source => source.action === 'ask_before_acting')
    assert(
      reorderedPrimary?.inhibition !== undefined && reorderedPrimary.inhibition > 0,
      'primary rejection must raise the primary candidate inhibition',
    )
    try {
      const stream = secondCtx.llm.stream({
        provider: 'wave6-reordered-provider',
        model: 'wave6-reordered-model',
        messages: [],
        sessionId: 'wave1-session-b' as never,
      })
      for await (const _chunk of stream) {}
    } catch {}
    const reorderedInputs = secondCtx.memory.listModelInputs('wave6-after-primary-rejection')
    assert(reorderedInputs.length === 1, 'reordered competition must bind one model input')
    assert(
      reorderedInputs[0]?.workspaceHash === reorderedRecall.workspace.hash,
      'reordered model input must retain the post-rejection workspace hash',
    )
    const persistedBehaviorEvaluation = secondCtx.memory.evaluatePersistedRecallBehavior({
      beforeCycleId: followupRecall.trace.cycleId,
      afterCycleId: reorderedRecall.trace.cycleId,
      actionId: rejectedAction.id,
      choices: [
        {
          id: 'wave6-host-permitted-choice',
          description: 'ask_before_acting',
          sourceMemoryIds: [permittedId],
        },
        {
          id: 'wave6-host-alternative-choice',
          description: 'proceed_without_confirmation',
          sourceMemoryIds: [permittedAlternativeId],
        },
      ],
    })
    assert(
      persistedBehaviorEvaluation.passed,
      'real Host persisted recall-to-behavior evaluation must pass after primary rejection',
    )
    assert(
      persistedBehaviorEvaluation.executedChoiceId === 'wave6-host-permitted-choice',
      'persisted evaluator must identify the rejected primary choice',
    )
    assert(
      persistedBehaviorEvaluation.recall.afterChoiceId === 'wave6-host-alternative-choice',
      'persisted evaluator must observe the alternative as the next top choice',
    )
    assert(
      persistedBehaviorEvaluation.actionSelectionUseIds.length > 0
        && persistedBehaviorEvaluation.outcomeIds.length > 0
        && persistedBehaviorEvaluation.feedbackIds.length > 0,
      'persisted evaluator must require the complete action-selection outcome feedback chain',
    )

    second.session.append('tool/call', {
      callId: 'wave6-tool-call',
      name: 'read_file',
      arguments: '{"path":"docs"}',
      prediction: {
        statement: 'the scoped workspace read will preserve the requested scope',
        expectedOutcome: 'the result contains only the requested workspace scope',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-tool-call', content: 'scoped workspace read completed' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const behaviorState = secondCtx.memory.readCognitionState()
    const action = behaviorState.actions.find(item =>
      item.correlationKey === 'wave6-tool-call',
    )
    assert(action !== undefined, 'real Host tool call must append an action bound to the recalled workspace')
    const prediction = behaviorState.predictions.find(item => action.predictionIds.includes(item.id))
    assert(prediction !== undefined, 'real Host tool call must append its explicit prediction')
    assert(prediction.epistemic === 'hypothesized', 'runtime prediction must remain hypothesized')
    assert(
      action.workspaceHash === reorderedRecall.workspace.hash,
      'runtime action must retain the exact latest recalled workspace hash',
    )
    assert(action.correlationKey === 'wave6-tool-call', 'runtime action must retain its tool correlation key')
    const outcome = behaviorState.outcomes.find(item => item.actionId === action.id)
    assert(outcome !== undefined, 'real Host tool result must append an outcome linked to the action')
    assert(outcome.predictionId === prediction.id, 'runtime outcome must close the action prediction')
    assert(outcome.status === 'observed', 'successful real Host tool result must be observed')
    assert(secondCtx.memory.getCurrentField().predictionErrors.some(error => error.actual === outcome.description), 'real Host current field must expose the outcome prediction error')
    const journalTransactions = new MemoryCognitionDatabase(rinHome('memory/memory.db')).listTransactions(10_000)
    const behaviorTransaction = journalTransactions.find(transaction => transaction.command.type === 'record-behavior' && transaction.events.some(event =>
      event.type === 'action-recorded' && String(event.payload.action.id) === String(action.id),
    ))
    assert(behaviorTransaction !== undefined, 'real Host action must be persisted as a behavior transaction')
    assert(
      behaviorTransaction.events.map(event => event.type).join(',') === 'prediction-recorded,action-recorded',
      'real Host prediction and action must share one ordered behavior batch',
    )
    const outcomeTransaction = journalTransactions.find(transaction => transaction.command.type === 'record-behavior' && transaction.events.some(event =>
      event.type === 'outcome-recorded' && String(event.payload.outcome.actionId) === String(action.id),
    ))
    assert(outcomeTransaction !== undefined, 'real Host outcome must be persisted as a behavior transaction')
    assert(
      outcomeTransaction.events.map(event => event.type).join(',') === 'outcome-recorded',
      'real Host outcome must remain an ordered behavior batch',
    )
    const actionSelectionUses = secondCtx.memory.listMemoryUseTraces(undefined, action.cycleId)
      .filter(use =>
        use.surface === 'action-selection'
        && use.id.includes(String(action.id)),
      )
    assert(actionSelectionUses.length === 0, 'unmatched runtime action must not register candidate action-selection use')

    secondCtx.memory.recordFeedback({
      id: createFeedbackId('wave6-host-feedback'),
      cycleId: action.cycleId,
      sessionId: 'wave1-session-b',
      kind: 'accept',
      actionId: action.id,
      outcomeId: outcome.id,
      taskOutcome: 0.8,
      actionCost: 0.2,
      explanation: 'the host-observed tool result preserved the requested scope',
      occurredAt: new Date().toISOString(),
      delayed: false,

    })
    assert(secondCtx.memory.readCognitionState().feedback.some(item => item.actionId === action.id), 'real Host feedback must enter the same cognition state')

    second.session.append('tool/call', {
      callId: 'wave6-delayed-call',
      name: 'read_file',
      arguments: '{"path":"docs/roadmap"}',
      prediction: {
        statement: 'the delayed workspace read will preserve the requested scope',
        expectedOutcome: 'the delayed result contains only the requested workspace scope',
      },
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const delayedAction = secondCtx.memory.readCognitionState().actions.find(item => item.correlationKey === 'wave6-delayed-call')
    assert(delayedAction?.sessionId === 'wave1-session-b', 'delayed action must originate in the first session')
    assert(delayedAction !== undefined, 'delayed action must be available for cross-session linkage')
    const originSceneId = secondCtx.memory.getCurrentField().sceneId
    assert(originSceneId !== undefined, 'the delayed action must have an origin current-field scene')

    const third = await publishUserMessage(secondCtx, 'wave1-session-c', 'wave1 delayed result session')
    thirdDetach = third.detach
    const nextSceneId = secondCtx.memory.getCurrentField().sceneId
    assert(nextSceneId !== undefined && nextSceneId !== originSceneId, 'delayed result must arrive in a different current-field scene')
    third.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-delayed-call', content: 'delayed scoped workspace read completed' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(third.session)
    const delayedOutcome = secondCtx.memory.readCognitionState().outcomes.find(item => item.correlationKey === 'wave6-delayed-call')
    assert(delayedOutcome?.actionId === delayedAction?.id, 'new session result must reconnect to the original action')
    assert(delayedOutcome?.cycleId === delayedAction?.cycleId, 'delayed result must retain the original action cycle')
    assert(delayedOutcome?.delayed === true, 'cross-session result must be marked delayed')

    third.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the identified delayed outcome needs follow-up' }],
      feedback: {
        kind: 'correct',
        outcomeId: String(delayedOutcome.id),
        taskOutcome: -0.2,
        explanation: 'the user referred to the delayed outcome directly',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(third.session)
    const outcomeOnlyFeedback = secondCtx.memory.readCognitionState().feedback.find(item =>
      item.outcomeId === delayedOutcome.id && item.explanation === 'the user referred to the delayed outcome directly',
    )
    assert(outcomeOnlyFeedback?.actionId === delayedAction.id, 'outcome-only feedback must reconnect through the delayed outcome')

    third.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the explicit action id must win over a conflicting correlation key' }],
      feedback: {
        kind: 'correct',
        actionId: action.id,
        correlationKey: 'wave6-delayed-call',
        factualCorrection: 'explicit action id selected the immediate action',
        explanation: 'the user supplied both an action id and a conflicting correlation key',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(third.session)
    const explicitCorrection = secondCtx.memory.readCognitionState().feedback.find(item =>
      item.factualCorrection === 'explicit action id selected the immediate action',
    )
    assert(explicitCorrection?.actionId === action.id, 'explicit feedback action id must take precedence over correlation key')

    third.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the delayed result needs correction' }],
      feedback: {
        kind: 'correct',
        correlationKey: 'wave6-delayed-call',
        factualCorrection: 'the delayed tool result exceeded the requested scope',
        explanation: 'the user corrected a delayed action result',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(third.session)
    const delayedCorrection = secondCtx.memory.readCognitionState().feedback.find(item =>
      item.kind === 'correct' && item.actionId === delayedAction.id && item.delayed,
    )
    assert(delayedCorrection?.sceneId === originSceneId, 'delayed feedback must retain the origin action scene')

    second.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the result was broader than requested' }],
      feedback: {
        kind: 'correct',
        correlationKey: 'wave6-tool-call',
        factualCorrection: 'the tool result exceeded the requested scope',
        explanation: 'the user corrected the immediate action result',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const corrected = secondCtx.memory.readCognitionState().feedback.find(item => item.kind === 'correct')
    assert(corrected?.actionId === action.id, 'real Host user correction must link to the tool action')
    assert(corrected.factualCorrection === 'the tool result exceeded the requested scope', 'real Host correction must retain its content')
    third.session.append('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'the alternative disposition needs direct correction' }],
      feedback: {
        kind: 'correct',
        dispositionId: String(permittedAlternativeId),
        taskOutcome: -0.4,
        actionCost: 0.1,
        explanation: 'the user corrected a disposition without naming an action or outcome',
      },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(third.session)
    const directDispositionFeedback = secondCtx.memory.readCognitionState().feedback.find(item =>
      item.dispositionId === permittedAlternativeId
      && item.actionId === alternativeAction.id,
    )
    assert(directDispositionFeedback?.outcomeId === undefined, 'direct disposition feedback must not invent an outcome')

    const ambiguousRecallA = await secondCtx.memory.recall({
      cycleId: 'wave6-ambiguous-cycle-a',
      query: { sessionId: 'wave1-session-b', text: 'wave6 ambiguous action request A' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    const ambiguousRecallB = await secondCtx.memory.recall({
      cycleId: 'wave6-ambiguous-cycle-b',
      query: { sessionId: 'wave1-session-b', text: 'wave6 ambiguous action request B' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    for (const [cycleId, provider] of [
      ['wave6-ambiguous-cycle-a', 'wave6-ambiguous-provider-a'],
      ['wave6-ambiguous-cycle-b', 'wave6-ambiguous-provider-b'],
    ] as const) {
      try {
        const stream = secondCtx.llm.stream({
          provider,
          model: 'wave6-ambiguous-model',
          messages: [],
          sessionId: 'wave1-session-b' as never,
        })
        for await (const _chunk of stream) {}
      } catch {}
      assert(
        secondCtx.memory.listModelInputs(cycleId).length === 1,
        'each ambiguous recall must persist its own model-input binding',
      )
    }
    second.session.append('tool/call', {
      callId: 'wave6-ambiguous-choice',
      name: 'ambiguous_action',
      arguments: '{"scope":"workspace"}',
      prediction: {
        statement: 'the ambiguous action will preserve the requested scope',
        expectedOutcome: 'the result remains attributable to one recalled workspace',
      },
    })
    second.session.append('tool/result', {
      message: { content: [{ toolCallId: 'wave6-ambiguous-choice', content: 'ambiguous action completed' }] },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await secondCtx.sessions.flush(second.session)
    const ambiguousState = secondCtx.memory.readCognitionState()
    assert(
      !ambiguousState.actions.some(item => item.correlationKey === 'wave6-ambiguous-choice'),
      'multiple pending recalls must not guess an action workspace',
    )
    assert(
      !ambiguousState.outcomes.some(item => item.correlationKey === 'wave6-ambiguous-choice'),
      'an unbound ambiguous action must not produce a linked outcome',
    )
    assert(
      ambiguousRecallA.workspace.hash !== ambiguousRecallB.workspace.hash
        || ambiguousRecallA.trace.cycleId !== ambiguousRecallB.trace.cycleId,
      'ambiguous regression must exercise two distinct recall cycles',
    )
    console.log('REAL-HOST-MEMORY-SMOKE-OK', JSON.stringify({
      scenes: continued.scenes.length,
      sessionRefs: [...new Set(refs.map(ref => ref.sessionId))].sort(),
      cognitionVersion: continued.state.version,
      promptSection: section.text,
      checkpointStatus: checkpoint.status,
      permittedDisposition: permittedDispositionId,
      positiveAction: positiveAction.id,
      followupAction: followupAction.id,
    }))
  } finally {
    if (thirdDetach !== undefined) await thirdDetach()
    if (secondDetach !== undefined) await secondDetach()
    if (secondCtx !== undefined) await secondCtx.fiber.dispose()
    if (firstDetach !== undefined) await firstDetach()
    if (firstCtx !== undefined) await firstCtx.fiber.dispose()
    if (previous.RIN_HOME === undefined) delete process.env.RIN_HOME
    else process.env.RIN_HOME = previous.RIN_HOME
    if (previous.DSH_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.DSH_HOME
    await rm(sandbox, { recursive: true, force: true })
  }
}

await main()
