/**
 * rin prompt-memory — system prompt projection (pure, cordis-free).
 *
 * Builds the model-visible memory section text from a status snapshot, applying
 * the package's deterministic character budgets: the SOUL identity is bounded
 * to SOUL_CHAR_LIMIT, and BRIEF/USER share the combined prompt-memory budget.
 *
 * @module @rin/memory/prompt
 */

import { createHash } from 'node:crypto'
import { boundPromptMemoryText } from './budget.ts'
import {
  PROMPT_MEMORY_TOTAL_CHAR_LIMIT,
} from './types.ts'
import {
  isMemoryContextActiveForScene,
  isMemoryValidityActiveAt,
  type CurrentField,
  type MemoryAffect,
  type RinMemory,
} from '../model.ts'
import type { MemoryMaterializedState } from '../store.ts'

/** Resolved switches controlling what the projected section includes. */
export interface PromptMemoryProjectionOptions {
  /** Include the SOUL identity (default true). */
  injectSoul: boolean
  /** Include the BRIEF working memory (default true). */
  injectBrief: boolean
}

/**
 * Build the model-visible section from Rin's materialized cognition state.
 *
 * This is the canonical Prompt projection. It deliberately accepts only the
 * replayable cognition state, never prompt-memory files or catalog rows. A
 * representation enters this projection only when its lifecycle, epistemic
 * status, and model-input influence grant all allow it.
 */
export function buildCanonicalPromptMemorySectionText(
  state: MemoryMaterializedState,
  options: PromptMemoryProjectionOptions = { injectSoul: true, injectBrief: true },
): string {
  const currentScene = state.currentField.sceneId === undefined
    ? undefined
    : state.memories.find(memory => String(memory.id) === String(state.currentField.sceneId) && memory.form === 'scene') as Extract<RinMemory, { form: 'scene' }> | undefined
  const at = state.currentField.version === 0 ? undefined : state.currentField.updatedAt
  const eligible = state.memories
    .filter(memory =>
      canEnterModelInput(memory, at)
      && (currentScene === undefined || isMemoryContextActiveForScene(memory, currentScene)),
    )
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id))
  const byId = new Map(eligible.map(memory => [memory.id, memory]))
  const parts: string[] = ['# Rin canonical memory']

  if (options.injectSoul) {
    const selfModels = eligible.filter(memory => memory.form === 'self-model')
    if (selfModels.length > 0) {
      parts.push('## Self model\n\n' + selfModels.map(renderMemory).join('\n\n'))
    }
  }

  if (options.injectBrief) {
    const currentField = renderCurrentField(state.currentField, byId)
    if (currentField !== '') parts.push('## Current field\n\n' + currentField)

    const workingForms = new Set([
      'scene',
      'structure',
      'person-model',
      'relationship-model',
      'disposition',
      'open-loop',
    ])
    const workingMemories = eligible.filter(memory => workingForms.has(memory.form))
    if (workingMemories.length > 0) {
      parts.push('## Working cognition\n\n' + workingMemories.map(renderMemory).join('\n\n'))
    }
  }

  const raw = parts.length === 1 ? '' : parts.join('\n\n')
  return boundPromptMemoryText(
    'RIN-CANONICAL.md',
    raw,
    PROMPT_MEMORY_TOTAL_CHAR_LIMIT,
  ).content
}

/**
 * Hash exactly the state and text used by the Prompt projection checkpoint.
 * The hash is not a second source of truth; it detects an uncommitted or
 * stale projection before the text is allowed into model input.
 */
export function hashCanonicalPromptMemoryProjection(
  state: MemoryMaterializedState,
  text: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ state, text }))
    .digest('hex')
}

function canEnterModelInput(memory: RinMemory, at?: string): boolean {
  return memory.state.persistence !== 'archived'
    && memory.state.persistence !== 'erased'
    && memory.state.influence === 'permitted'
    && memory.dynamics.influenceSurfaces.includes('model-input')
    && memory.state.epistemic !== 'superseded'
    && memory.state.epistemic !== 'rejected'
    && (at === undefined || isMemoryValidityActiveAt(memory.dynamics.validity, at))
}

function renderMemory(memory: RinMemory): string {
  const header = '### ' + memory.form + ' `' + memory.id + '`\n' +
    'state: epistemic=' + memory.state.epistemic + ', persistence=' + memory.state.persistence +
    ', influence=model-input, confidence=' + formatNumber(memory.dynamics.confidence)
  const lines = renderMemoryData(memory)
  return header + (lines.length === 0 ? '' : '\n' + lines.map(line => '- ' + line).join('\n'))
}

function renderMemoryData(memory: RinMemory): string[] {
  switch (memory.form) {
    case 'scene':
      return [
        'environment: ' + memory.data.environment,
        'participants: ' + joinValues(memory.data.participants),
        'goals: ' + joinValues(memory.data.goals),
        'observations: ' + joinValues(memory.data.observations),
        'interpretations: ' + joinValues(memory.data.interpretations),
        'actions: ' + joinValues(memory.data.actions.map(action => action.actor + ' -> ' + action.description + (action.result === undefined ? '' : ' [' + action.result + ']'))),
        'outcomes: ' + joinValues(memory.data.outcomes.map(outcome => outcome.status + ': ' + outcome.description)),
        'prediction errors: ' + joinValues(memory.data.predictionErrors.map(error => error.expected + ' -> ' + error.actual + ' (' + formatNumber(error.magnitude) + ')')),
        'affect: ' + formatAffect(memory.data.affect),
        memory.data.lifecycle === undefined
          ? ''
          : 'lifecycle: ' + memory.data.lifecycle.status + ' (' + memory.data.lifecycle.continuityKey + ')',
      ].filter(Boolean)
    case 'structure':
      return [
        'entities: ' + joinValues(memory.data.entities),
        'concepts: ' + joinValues(memory.data.concepts),
        'relations: ' + joinValues(memory.data.relations.map(relation => relation.from + ' ' + relation.relation + ' ' + relation.to)),
        'causal patterns: ' + joinValues(memory.data.causalPatterns),
      ]
    case 'self-model':
      return [
        'values: ' + joinValues(memory.data.values),
        'abilities: ' + joinValues(memory.data.abilities),
        'tendencies: ' + joinValues(memory.data.tendencies),
        'historical changes: ' + joinValues(memory.data.historicalChanges),
      ]
    case 'person-model':
      return [
        'subject: ' + memory.data.subject,
        'claims: ' + joinValues(memory.data.claims),
        'observed patterns: ' + joinValues(memory.data.observedPatterns),
        'current state: ' + joinValues(memory.data.currentState),
        'context conditions: ' + joinValues(memory.data.contextConditions ?? []),
        'state by context: ' + joinValues((memory.data.stateByContext ?? []).map(entry => entry.context + ' => ' + joinValues(entry.state))),
        'last observed: ' + memory.data.lastObservedAt,
      ]
    case 'relationship-model':
      return [
        'participants: ' + joinValues(memory.data.participants),
        'shared memories: ' + joinValues(memory.data.sharedMemoryIds),
        'commitments: ' + joinValues(memory.data.commitments),
        'boundaries: ' + joinValues(memory.data.boundaries),
        'conflicts: ' + joinValues(memory.data.conflicts),
        'expectations: ' + joinValues(memory.data.expectations),
        'distance: ' + formatNumber(memory.data.distance),
      ]
    case 'disposition':
      return [
        'triggering contexts: ' + joinValues(memory.data.triggeringContexts),
        'intended goal: ' + memory.data.intendedGoal,
        'action pattern: ' + joinValues(memory.data.actionPattern),
        'expected outcomes: ' + joinValues(memory.data.expectedOutcomes),
        'observed outcomes: ' + joinValues(memory.data.observedOutcomes),
        'applicability: ' + joinValues(memory.data.applicabilityConditions),
        'failure modes: ' + joinValues(memory.data.failureModes),
      ]
    case 'open-loop':
      return [
        'goal: ' + memory.data.goal,
        'description: ' + memory.data.description,
        'status: ' + memory.data.status,
        'related memories: ' + joinValues(memory.data.relatedMemoryIds),
        memory.data.resolution === undefined
          ? ''
          : 'resolution: ' + memory.data.resolution.status + ': ' + memory.data.resolution.description,
      ].filter(Boolean)
    case 'prospect':
      return [
        'kind: ' + memory.data.kind,
        'premise: ' + memory.data.premise,
        'possible outcomes: ' + joinValues(memory.data.possibleOutcomes),
        'related memories: ' + joinValues(memory.data.relatedMemoryIds),
      ]
  }
}

function renderCurrentField(
  field: CurrentField,
  memories: ReadonlyMap<string, RinMemory>,
): string {
  if (field.sceneId === undefined || !memories.has(field.sceneId)) return ''
  return [
    'scene: ' + field.sceneId + ' (' + (field.sceneStatus ?? 'unknown') + ')',
    'participants: ' + joinValues(field.participants),
    'goals: ' + joinValues(field.goals),
    'affect: ' + formatAffect(field.affect),
    'predictions: ' + joinValues(field.predictions.filter(id => memories.has(id))),
    'active open loops: ' + joinValues(field.activeOpenLoops.filter(id => memories.has(id))),
    'active coalition: ' + joinValues(field.activeMemoryCoalition.filter(id => memories.has(id))),
    'candidate actions: ' + joinValues(field.candidateActions),
    'candidate action competition: ' + renderCandidateActionCompetition(field),
    'uncertainty: ' + joinValues(field.uncertainty),
    'prediction errors: ' + joinValues(field.predictionErrors.map(error => error.expected + ' -> ' + error.actual + ' (' + formatNumber(error.magnitude) + ')')),
  ].map(line => '- ' + line).join('\n')
}

function formatAffect(affect: MemoryAffect): string {
  return 'valence=' + formatNumber(affect.valence) +
    ', arousal=' + formatNumber(affect.arousal) +
    ', control=' + formatNumber(affect.control)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function joinValues(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join('; ')
}
function renderCandidateActionCompetition(field: CurrentField): string {
  const sources = field.candidateActionSources ?? []
  if (sources.length === 0) return '(none)'
  return sources.map(source =>
    source.action
      + ' [selection=' + formatNumber(source.selectionValue)
      + ', utility=' + formatNumber(source.utility)
      + ', inhibition=' + formatNumber(source.inhibition)
      + ', reasons=' + joinValues(source.reasons)
      + ']',
  ).join('; ')
}
