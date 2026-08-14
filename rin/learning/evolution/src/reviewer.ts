/**
 * rin evolution — model-driven skill learning reviewer.
 *
 * Pure helpers decide review eligibility, parse a model's structured response,
 * and build the review prompt. createEvolutionReviewer(deps) owns the stateful
 * post-turn loop: eligibility → deterministic creation gate (from skill memory)
 * → model review → merge or create → save → auto-approve or notice. It depends
 * on no runtime types; the model call, notice, and debug log are injected.
 *
 * @module @rin/evolution
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluateSkillCreationCandidate } from '@rin/skill-memory'
import { redactSecrets } from './secrets.ts'
import type { EvolutionApproval } from './approval.ts'
import type { EvolutionStore } from './store.ts'
import type {
  EvolutionMessage,
  EvolutionMessageBlock,
  EvolutionReviewInput,
  EvolutionReviewModel,
  EvolutionSkill,
  SkillCandidate,
  SkillCandidateAction,
  SkillCandidateScope,
  SkillCandidateTarget,
  SkillLearningConfig,
} from './types.ts'

const REVIEW_EXCERPT_LIMIT = 14_000
const REVIEW_MESSAGE_LIMIT = 18
const REVIEWED_TURN_LIMIT = 500

type RawSkillCandidate = {
  name: string
  description: string
  whenToUse: string
  scope: SkillCandidateScope
  reason: string
  confidence: number
  evidence: string[]
  body: string
}

export type SkillReviewEligibility = {
  eligible: boolean
  reason: string
  toolUseCount: number
  userTurnCount: number
  correctionSignal: boolean
  fingerprint: string
  excerpt: string
}

/** Decide whether a candidate is approved without a human in the loop. */
export function shouldAutoApproveSkillCandidate(
  config: SkillLearningConfig,
  candidate: Pick<SkillCandidate, 'action' | 'scope' | 'confidence' | 'duplicate'>,
): boolean {
  return config.mode === 'auto' &&
    candidate.confidence >= config.autoApproveConfidence
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function getMessageText(message: EvolutionMessage): string {
  if (message.type !== 'user' && message.type !== 'assistant') return ''
  const content = message.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return extractTextContent(content)
}

function extractTextContent(blocks: EvolutionMessageBlock[]): string {
  return blocks
    .flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}

function isVisibleConversationMessage(message: EvolutionMessage): boolean {
  if (message.type !== 'user' && message.type !== 'assistant') return false
  return !(message as { isMeta?: boolean }).isMeta
}

function getContentBlocks(message: EvolutionMessage): EvolutionMessageBlock[] {
  if (message.type !== 'user' && message.type !== 'assistant') return []
  const content = message.message.content
  return Array.isArray(content)
    ? content.filter(
        (block): block is EvolutionMessageBlock =>
          Boolean(block) && typeof block === 'object',
      )
    : []
}

function countToolUses(messages: EvolutionMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      getContentBlocks(message).filter(block => block.type === 'tool_use').length,
    0,
  )
}

function hasCorrectionSignal(messages: EvolutionMessage[]): boolean {
  const recentUserText = messages
    .filter(message => message.type === 'user' && isVisibleConversationMessage(message))
    .slice(-4)
    .map(getMessageText)
    .join('\n')
    .toLowerCase()

  return /(?:\b(?:no|instead|always|never|actually|make sure|don't|do not|wrong)\b|不对|不要|改成|应该|必须|每次|总是|而不是|记住|修正|订正|いいえ|代わりに|必ず|아니|대신|항상)/i.test(
    recentUserText,
  )
}

function formatToolUse(block: EvolutionMessageBlock): string {
  const name = typeof block.name === 'string' ? block.name : 'Tool'
  let inputText = ''
  try {
    inputText = truncate(JSON.stringify(block.input), 500)
  } catch {
    inputText = '[unserializable input]'
  }
  const suffix = inputText ? ' ' + inputText : ''
  return 'Assistant tool: ' + name + suffix
}

function formatReviewExcerpt(messages: EvolutionMessage[]): string {
  const lines: string[] = []
  for (const message of messages.slice(-REVIEW_MESSAGE_LIMIT)) {
    if (!isVisibleConversationMessage(message)) continue
    const role = message.type === 'user' ? 'User' : 'Assistant'
    const text = truncate(getMessageText(message), role === 'User' ? 1_400 : 1_800)
    if (text) lines.push(role + ': ' + text)
    for (const block of getContentBlocks(message)) {
      if (block.type === 'tool_use') lines.push(formatToolUse(block))
      if (block.type === 'tool_result') {
        lines.push(
          'Tool result: ' + ((block as { is_error?: boolean }).is_error ? 'error' : 'success'),
        )
      }
    }
  }
  return truncate(redactSecrets(lines.join('\n\n')), REVIEW_EXCERPT_LIMIT)
}

function turnFingerprint(params: {
  sessionId: string
  projectRoot: string
  excerpt: string
}): string {
  return createHash('sha256')
    .update(`${params.sessionId}\0${params.projectRoot}\0${params.excerpt}`)
    .digest('hex')
}

/**
 * Evaluate whether a completed turn is worth reviewing for a new skill.
 *
 * @param messages - the visible conversation messages.
 * @param config - the active learning configuration.
 * @param params - session/project provenance for the turn fingerprint.
 */
export function evaluateSkillReviewEligibility(
  messages: EvolutionMessage[],
  config: SkillLearningConfig,
  params: { sessionId?: string; projectRoot?: string } = {},
): SkillReviewEligibility {
  const visibleMessages = messages.filter(isVisibleConversationMessage)
  const userIndexes = visibleMessages
    .map((message, index) => (message.type === 'user' ? index : -1))
    .filter(index => index >= 0)
  const reviewStart = userIndexes[Math.max(0, userIndexes.length - 3)] ?? 0
  const recentTaskMessages = visibleMessages.slice(reviewStart)
  const toolUseCount = countToolUses(recentTaskMessages)
  const userTurnCount = userIndexes.length
  const correctionSignal = hasCorrectionSignal(visibleMessages)
  const excerpt = formatReviewExcerpt(recentTaskMessages)
  const fingerprint = turnFingerprint({
    sessionId: params.sessionId ?? 'unknown-session',
    projectRoot: params.projectRoot ?? '',
    excerpt,
  })

  if (config.mode === 'off') {
    return {
      eligible: false,
      reason: 'Skill Learning is disabled.',
      toolUseCount,
      userTurnCount,
      correctionSignal,
      fingerprint,
      excerpt,
    }
  }
  if (!excerpt) {
    return {
      eligible: false,
      reason: 'No visible conversation content to review.',
      toolUseCount,
      userTurnCount,
      correctionSignal,
      fingerprint,
      excerpt,
    }
  }

  const correctionThreshold = Math.max(2, config.minToolUses - 3)
  const eligible =
    toolUseCount >= config.minToolUses ||
    (correctionSignal && toolUseCount >= correctionThreshold)

  return {
    eligible,
    reason: eligible
      ? correctionSignal
        ? 'Complex task with reusable user corrections.'
        : 'Complex task exceeded the tool-use learning threshold.'
      : `Task used ${toolUseCount} tools; ${config.minToolUses} required.`,
    toolUseCount,
    userTurnCount,
    correctionSignal,
    fingerprint,
    excerpt,
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value.trim())
}

function normalizeSkillName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function titleCase(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => (part[0]?.toUpperCase() ?? '') + part.slice(1))
    .join(' ')
}

function buildSkillMarkdown(params: {
  candidate: Omit<RawSkillCandidate, 'body'>
  body: string
  sessionId?: string
}): string {
  const title = titleCase(params.candidate.name)
  const sourceLine = params.sessionId
    ? '    source_session: ' + yamlString(params.sessionId)
    : undefined
  return [
    '---',
    'name: ' + params.candidate.name,
    'description: ' + yamlString(params.candidate.description),
    'when_to_use: ' + yamlString(params.candidate.whenToUse),
    'user-invocable: true',
    'metadata:',
    '  rin:',
    '    created_by: skill-learning',
    ...(sourceLine === undefined ? [] : [sourceLine]),
    '    confidence: ' + params.candidate.confidence.toFixed(2),
    '---',
    '',
    params.body.trim().startsWith('#')
      ? params.body.trim()
      : '# ' + title + '\n\n' + params.body.trim(),
    '',
  ].join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) return null

  const escapedTag = escapeRegExp(tagName)
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s+[^>]*)?>` + '([\\s\\S]*?)' + `<\\/${escapedTag}>`,
    'gi',
  )

  let match: RegExpExecArray | null
  let depth = 0
  let lastIndex = 0
  const openingTag = new RegExp(`<${escapedTag}(?:\\s+[^>]*?)?>`, 'gi')
  const closingTag = new RegExp(`<\\/${escapedTag}>`, 'gi')

  while ((match = pattern.exec(html)) !== null) {
    const content = match[1]
    const beforeMatch = html.slice(lastIndex, match.index)

    depth = 0
    openingTag.lastIndex = 0
    while (openingTag.exec(beforeMatch) !== null) depth++
    closingTag.lastIndex = 0
    while (closingTag.exec(beforeMatch) !== null) depth--

    if (depth === 0 && content) return content
    lastIndex = match.index + match[0].length
  }

  return null
}

/**
 * Parse a model's structured response into a complete SKILL.md draft.
 *
 * @param text - the model completion text.
 * @param params - optional session provenance written into frontmatter.
 */
export function parseSkillCandidateResponse(
  text: string,
  params: { sessionId?: string } = {},
): { candidate?: RawSkillCandidate; noSkillReason?: string } {
  const noSkillReason = extractTag(text, 'no_skill')?.trim()
  if (noSkillReason) return { noSkillReason }

  const metadataText = extractTag(text, 'candidate')?.trim()
  const body = extractTag(text, 'skill_body')?.trim()
  if (!metadataText || !body) {
    throw new Error('Skill Learning review returned no structured candidate.')
  }

  const metadata = JSON.parse(metadataText) as Record<string, unknown>
  const name = normalizeSkillName(metadata.name)
  const description = typeof metadata.description === 'string'
    ? metadata.description.trim()
    : ''
  const whenToUse = typeof metadata.whenToUse === 'string'
    ? metadata.whenToUse.trim()
    : ''
  const scope: SkillCandidateScope = metadata.scope === 'global' ? 'global' : 'project'
  const reason = typeof metadata.reason === 'string' ? metadata.reason.trim() : ''
  const confidence = typeof metadata.confidence === 'number'
    ? Math.max(0, Math.min(1, metadata.confidence))
    : 0
  const evidence = Array.isArray(metadata.evidence)
    ? metadata.evidence
        .filter((item): item is string => typeof item === 'string')
        .map(item => truncate(item, 300))
        .slice(0, 5)
    : []

  if (!name || !description || !whenToUse || !reason || confidence <= 0) {
    throw new Error('Skill Learning candidate metadata is incomplete.')
  }

  const candidateBase = {
    name,
    description,
    whenToUse,
    scope,
    reason,
    confidence,
    evidence,
  }
  return {
    candidate: {
      ...candidateBase,
      body: buildSkillMarkdown({
        candidate: candidateBase,
        body,
        ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      }),
    },
  }
}

function comparableSkills(skills: readonly EvolutionSkill[]): EvolutionSkill[] {
  return skills.filter(skill =>
    skill.source !== 'builtin' &&
    (skill.loadedFrom === 'skills' ||
      skill.loadedFrom === 'bundled' ||
      skill.loadedFrom === 'plugin' ||
      skill.loadedFrom === 'mcp' ||
      Boolean(skill.hasUserSpecifiedDescription) ||
      Boolean(skill.whenToUse))
  )
}

function formatSkillCatalog(skills: readonly EvolutionSkill[]): string {
  const lines = comparableSkills(skills)
    .slice(0, 120)
    .map(skill => {
      const when = skill.whenToUse ? ' | ' + truncate(skill.whenToUse, 180) : ''
      return '- /' + skill.name + ': ' + truncate(skill.description ?? '', 180) + when
    })
  return lines.join('\n') || '(none)'
}

/**
 * Build the conservative reviewer prompt for one completed task.
 *
 * @param params.excerpt - the redacted task excerpt.
 * @param params.projectRoot - the project root label.
 * @param params.existingSkills - the current comparable skill catalog.
 */
export function buildSkillLearningPrompt(params: {
  excerpt: string
  projectRoot: string
  existingSkills: readonly EvolutionSkill[]
}): string {
  return [
    'You are rin skill evolution, a conservative procedural-memory reviewer.',
    '',
    'Review the completed task below and decide whether it contains a durable workflow worth reusing in future sessions.',
    'A good Skill captures a repeatable multi-step procedure, verified troubleshooting method, recurring user correction, or environment-specific operating workflow.',
    'Do not create a Skill for one-off facts, transient plans, simple questions, generic coding knowledge, secrets, credentials, or an unfinished/failed task.',
    'Prefer improving or reusing an existing Skill over creating a near-duplicate.',
    '',
    'Project root: ' + params.projectRoot,
    '',
    'Existing Skills:',
    formatSkillCatalog(params.existingSkills),
    '',
    'Recent completed task:',
    params.excerpt,
    '',
    'If no durable Skill is justified, output:',
    '<no_skill>brief reason</no_skill>',
    '',
    'Otherwise output exactly two tags:',
    '<candidate>{"name":"english-kebab-case","description":"one sentence","whenToUse":"Use when... with trigger examples","scope":"project|global","reason":"why this is reusable","confidence":0.0,"evidence":["specific lesson"]}</candidate>',
    '<skill_body>Complete Markdown body with Goal, Inputs, Steps, per-step success criteria, Pitfalls, and Verification. Do not include YAML frontmatter.</skill_body>',
    '',
    'Use project scope for repository-specific commands, paths, architecture, or conventions. Use global scope only for a broadly reusable personal workflow.',
    'Confidence must reflect evidence quality. Never include API keys, tokens, private values, or raw conversation metadata.',
  ].join('\n')
}

function writableTarget(skill: EvolutionSkill | undefined): {
  target: SkillCandidateTarget
  root: string
  scope: SkillCandidateScope
} | null {
  if (!skill || !skill.skillRoot) return null
  if (skill.source === 'projectSettings') {
    return {
      target: { skillName: skill.name, source: 'project' },
      root: skill.skillRoot,
      scope: 'project',
    }
  }
  if (skill.source === 'userSettings') {
    return {
      target: { skillName: skill.name, source: 'user' },
      root: skill.skillRoot,
      scope: 'global',
    }
  }
  return null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Create the stateful skill learning reviewer bound to a store and adapters.
 *
 * @param deps.store - the candidate/event store.
 * @param deps.approval - the candidate approval.
 * @param deps.reviewModel - the injected model adapter.
 */
export function createEvolutionReviewer(deps: {
  store: EvolutionStore
  approval: EvolutionApproval
  reviewModel: EvolutionReviewModel
  appendNotice?: (text: string) => void
  logDebug?: (message: string) => void
}) {
  const { store, approval, reviewModel, appendNotice, logDebug } = deps

  const reviewedTurns = new Map<string, true>()
  const inFlightReviews = new Set<string>()
  const pendingReviews = new Map<string, EvolutionReviewInput>()
  const inFlightReviewPromises = new Set<Promise<void>>()

  function rememberReviewedTurn(fingerprint: string): boolean {
    if (reviewedTurns.has(fingerprint)) return false
    reviewedTurns.set(fingerprint, true)
    if (reviewedTurns.size > REVIEWED_TURN_LIMIT) {
      const oldest = reviewedTurns.keys().next().value
      if (oldest) reviewedTurns.delete(oldest)
    }
    return true
  }

  async function runReviewModel(prompt: string, model: string): Promise<string> {
    return (await reviewModel(prompt, model)).trim()
  }

  async function mergeWithExistingSkill(params: {
    skill: EvolutionSkill
    currentMarkdown: string
    proposedMarkdown: string
    reason: string
    model: string
  }): Promise<string> {
    const prompt = [
      'Update an existing rin SKILL.md with a newly learned durable workflow lesson.',
      'Preserve useful existing guidance and all frontmatter fields. Do not add credentials or broaden allowed-tools permissions.',
      'Return the complete updated file inside <updated_skill> tags.',
      '',
      'Skill: /' + params.skill.name,
      'Reason for update: ' + params.reason,
      '',
      '<current_skill>',
      params.currentMarkdown,
      '</current_skill>',
      '',
      '<proposed_learning>',
      params.proposedMarkdown,
      '</proposed_learning>',
    ].join('\n')
    const text = await runReviewModel(prompt, params.model)
    const updated = extractTag(text, 'updated_skill')?.trim()
    if (!updated) throw new Error('Skill merge review returned no updated Skill.')
    return updated + '\n'
  }

  async function reviewSkillLearningContext(input: EvolutionReviewInput): Promise<void> {
    const config = await store.readConfig()
    const projectRoot = input.projectRoot ?? ''
    const sessionId = input.sessionId
    const eligibility = evaluateSkillReviewEligibility(input.messages, config, {
      projectRoot,
      sessionId,
    })
    if (!eligibility.eligible) {
      if (
        config.mode !== 'off' &&
        eligibility.excerpt &&
        (eligibility.toolUseCount > 0 || eligibility.correctionSignal) &&
        rememberReviewedTurn(eligibility.fingerprint)
      ) {
        await store.recordEvent({
          kind: 'review-skipped',
          message: eligibility.reason,
          ...(projectRoot === '' ? {} : { projectRoot }),
          sessionId,
          toolUseCount: eligibility.toolUseCount,
        }).catch(() => {})
      }
      return
    }
    if (!rememberReviewedTurn(eligibility.fingerprint)) return

    await store.recordEvent({
      kind: 'review-started',
      message: eligibility.reason,
      ...(projectRoot === '' ? {} : { projectRoot }),
      sessionId,
      toolUseCount: eligibility.toolUseCount,
    }).catch(() => {})

    try {
      const commands = input.toolUseContext.options.commands
      const responseText = await runReviewModel(
        buildSkillLearningPrompt({
          excerpt: eligibility.excerpt,
          projectRoot,
          existingSkills: commands,
        }),
        input.toolUseContext.options.mainLoopModel,
      )
      const parsed = parseSkillCandidateResponse(responseText, { sessionId })
      if (!parsed.candidate) {
        await store.recordEvent({
          kind: 'no-candidate',
          message: parsed.noSkillReason || 'No durable workflow was found.',
          ...(projectRoot === '' ? {} : { projectRoot }),
          sessionId,
          toolUseCount: eligibility.toolUseCount,
        })
        return
      }
      if (parsed.candidate.confidence < config.minConfidence) {
        await store.recordEvent({
          kind: 'no-candidate',
          message: `Candidate confidence ${parsed.candidate.confidence.toFixed(2)} was below the ${config.minConfidence.toFixed(2)} threshold.`,
          ...(projectRoot === '' ? {} : { projectRoot }),
          sessionId,
          skillName: parsed.candidate.name,
          toolUseCount: eligibility.toolUseCount,
        })
        return
      }

      const existingSkills = comparableSkills(commands)
      const gate = evaluateSkillCreationCandidate({
        candidate: parsed.candidate,
        existingSkills,
      })
      let action: SkillCandidateAction = 'create'
      let scope = parsed.candidate.scope
      let name = parsed.candidate.name
      let description = parsed.candidate.description
      let whenToUse = parsed.candidate.whenToUse
      let markdown = parsed.candidate.body
      let target: SkillCandidateTarget | undefined

      if (gate.decision !== 'create' && gate.bestMatch) {
        const matchingSkill = existingSkills.find(
          skill => skill.name === gate.bestMatch?.skillName,
        )
        const writable = writableTarget(matchingSkill)
        if (!writable || !matchingSkill) {
          await store.recordEvent({
            kind: 'candidate-reused',
            message: `Existing protected Skill /${gate.bestMatch.skillName} already covers this workflow.`,
            ...(projectRoot === '' ? {} : { projectRoot }),
            sessionId,
            skillName: gate.bestMatch.skillName,
            toolUseCount: eligibility.toolUseCount,
          })
          return
        }

        const currentMarkdown = await readFile(join(writable.root, 'SKILL.md'), 'utf-8')
        markdown = await mergeWithExistingSkill({
          skill: matchingSkill,
          currentMarkdown,
          proposedMarkdown: markdown,
          reason: parsed.candidate.reason,
          model: input.toolUseContext.options.mainLoopModel,
        })
        action = 'update'
        scope = writable.scope
        name = matchingSkill.name
        description = matchingSkill.description ?? ''
        whenToUse = matchingSkill.whenToUse || parsed.candidate.whenToUse
        target = writable.target
      }

      const saved = await store.saveCandidate({
        action,
        scope,
        name,
        description,
        whenToUse,
        reason: parsed.candidate.reason,
        evidence: parsed.candidate.evidence,
        confidence: parsed.candidate.confidence,
        markdown,
        sourceSessionId: sessionId,
        sourceFingerprint: eligibility.fingerprint,
        sourceToolUses: eligibility.toolUseCount,
        ...(projectRoot === '' ? {} : { projectRoot }),
        ...(target === undefined ? {} : { target }),
        ...(gate.bestMatch && gate.decision !== 'create'
          ? {
              duplicate: {
                skillName: gate.bestMatch.skillName,
                score: gate.bestMatch.score,
                decision: gate.decision,
              },
            }
          : {}),
      })
      if (!saved.created) return

      await store.recordEvent({
        kind: 'candidate-created',
        message: action === 'update'
          ? 'Drafted an update for /' + name + '.'
          : 'Drafted a new Skill /' + name + '.',
        ...(projectRoot === '' ? {} : { projectRoot }),
        sessionId,
        candidateId: saved.candidate.id,
        skillName: name,
        toolUseCount: eligibility.toolUseCount,
      })

      const canAutoApprove = shouldAutoApproveSkillCandidate(config, saved.candidate)

      if (canAutoApprove) {
        try {
          await approval.approveCandidate(saved.candidate.id, { automatic: true })
        } catch (error) {
          await store.updateCandidate(saved.candidate.id, {
            status: 'failed',
            error: errorMessage(error),
          })
          throw error
        }
        appendNotice?.(`Skill Learning saved /${name} from this completed workflow.`)
      } else {
        appendNotice?.(`Skill draft ready for review: /${name}.`)
      }
    } catch (error) {
      reviewedTurns.delete(eligibility.fingerprint)
      await store.recordEvent({
        kind: 'review-failed',
        message: errorMessage(error),
        ...(projectRoot === '' ? {} : { projectRoot }),
        sessionId,
        toolUseCount: eligibility.toolUseCount,
      }).catch(() => {})
      logDebug?.(`[skill-learning] review failed: ${errorMessage(error)}`)
    }
  }

  async function executeReviewImpl(input: EvolutionReviewInput): Promise<void> {
    if (input.querySource !== 'repl_main_thread' && input.querySource !== 'sdk') {
      return
    }
    if (input.toolUseContext.agentId) return

    const sessionId = input.sessionId
    if (inFlightReviews.has(sessionId)) {
      pendingReviews.set(sessionId, input)
      return
    }

    inFlightReviews.add(sessionId)
    let nextInput: EvolutionReviewInput | undefined = input
    try {
      while (nextInput) {
        await reviewSkillLearningContext(nextInput)
        nextInput = pendingReviews.get(sessionId)
        pendingReviews.delete(sessionId)
      }
    } finally {
      inFlightReviews.delete(sessionId)
    }
  }

  async function executeReview(input: EvolutionReviewInput): Promise<void> {
    const review = executeReviewImpl(input)
    inFlightReviewPromises.add(review)
    try {
      await review
    } finally {
      inFlightReviewPromises.delete(review)
    }
  }

  async function drainPendingReviews(timeoutMs = 60_000): Promise<void> {
    if (inFlightReviewPromises.size === 0) return
    await Promise.race([
      Promise.all(inFlightReviewPromises).catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref()),
    ])
  }

  function resetForTesting(): void {
    reviewedTurns.clear()
    inFlightReviews.clear()
    pendingReviews.clear()
    inFlightReviewPromises.clear()
  }

  return { drainPendingReviews, executeReview, resetForTesting }
}

export type EvolutionReviewer = ReturnType<typeof createEvolutionReviewer>
