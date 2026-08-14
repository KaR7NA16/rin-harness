import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvolution, projectPromptMemoryInsights } from '../src/evolution.ts'
import {
  evaluateSkillReviewEligibility,
  parseSkillCandidateResponse,
  shouldAutoApproveSkillCandidate,
} from '../src/reviewer.ts'
import { DEFAULT_SKILL_LEARNING_CONFIG } from '../src/types.ts'
import type { EvolutionMessage, EvolutionSkill } from '../src/types.ts'

function buildSkillMarkdown(name: string, body = 'Follow the verified steps.'): string {
  return [
    '---',
    'name: ' + name,
    'description: "Reusable project verification workflow"',
    'when_to_use: "Use when verifying this project after a change."',
    'user-invocable: true',
    '---',
    '',
    '# Verification Workflow',
    '',
    body,
    '',
  ].join('\n')
}

function taskMessages(toolUseCount: number, userText = 'Implement and verify the fix.'): EvolutionMessage[] {
  return [
    {
      type: 'user',
      message: { role: 'user', content: userText },
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: Array.from({ length: toolUseCount }, (_, index) => ({
          type: 'tool_use',
          id: 'tool-' + index,
          name: index % 2 === 0 ? 'Read' : 'Edit',
          input: { path: 'src/file-' + index + '.ts' },
        })),
      },
    },
  ]
}

function candidateResponse(name: string): string {
  return [
    '<candidate>{"name":"' + name + '","description":"Verify project changes consistently","whenToUse":"Use when completing a code change in this project.","scope":"project","reason":"The workflow was repeated and verified","confidence":0.94,"evidence":["Tests and build both passed"]}</candidate>',
    '<skill_body># Project Verification\n\n## Steps\n\n1. Run the focused tests.\n2. Run the production build.\n\n## Verification\n\nBoth commands must exit successfully.</skill_body>',
  ].join('\n')
}

describe('rin evolution', () => {
  let fixture: string
  let projectRoot: string

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'rin-evolution-'))
    projectRoot = join(fixture, 'project')
  })

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true })
  })

  function makeEvolution(response: string) {
    return createEvolution({
      roots: { globalConfigRoot: join(fixture, 'global'), projectConfigRoot: projectRoot },
      adapters: { reviewModel: async () => response },
    })
  }

  test('defaults to auto mode and persists mode changes', async () => {
    const ev = makeEvolution('')
    expect(await ev.readConfig()).toEqual(DEFAULT_SKILL_LEARNING_CONFIG)
    const updated = await ev.updateConfig({ mode: 'suggest' })
    expect(updated.mode).toBe('suggest')
    expect((await ev.readConfig()).mode).toBe('suggest')
  })

  test('auto mode only approves candidates above the configured confidence', () => {
    expect(shouldAutoApproveSkillCandidate(DEFAULT_SKILL_LEARNING_CONFIG, {
      action: 'create',
      scope: 'project',
      confidence: 0.91,
    })).toBe(false)
    expect(shouldAutoApproveSkillCandidate(DEFAULT_SKILL_LEARNING_CONFIG, {
      action: 'update',
      scope: 'global',
      confidence: 0.95,
      duplicate: { skillName: 'existing', score: 0.9, decision: 'merge' },
    })).toBe(true)
  })

  test('evaluates eligibility from tool use and correction signals', () => {
    const simple = evaluateSkillReviewEligibility(taskMessages(1), DEFAULT_SKILL_LEARNING_CONFIG, {
      sessionId: 'session-1',
      projectRoot,
    })
    expect(simple.eligible).toBe(false)
    expect(simple.toolUseCount).toBe(1)

    const complex = evaluateSkillReviewEligibility(taskMessages(6), DEFAULT_SKILL_LEARNING_CONFIG, {
      sessionId: 'session-1',
      projectRoot,
    })
    expect(complex.eligible).toBe(true)
    expect(complex.reason).toContain('tool-use learning threshold')

    const corrected = evaluateSkillReviewEligibility(
      taskMessages(3, '不要这样做，必须在每次修改后先运行验证。'),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-2', projectRoot },
    )
    expect(corrected.eligible).toBe(true)
    expect(corrected.correctionSignal).toBe(true)
  })

  test('redacts credentials before a task reaches the review model', () => {
    const secret = 'ghp_' + 'a'.repeat(36)
    const result = evaluateSkillReviewEligibility(
      taskMessages(6, 'Use ' + secret + ' while testing.'),
      DEFAULT_SKILL_LEARNING_CONFIG,
      { sessionId: 'session-secret', projectRoot },
    )
    expect(result.excerpt).not.toContain(secret)
    expect(result.excerpt).toContain('[REDACTED]')
  })

  test('parses a structured model response into a complete SKILL.md draft', () => {
    const parsed = parseSkillCandidateResponse(candidateResponse('project-verification'), {
      sessionId: 'session-3',
    })
    expect(parsed.candidate?.name).toBe('project-verification')
    expect(parsed.candidate?.body).toContain('name: project-verification')
    expect(parsed.candidate?.body).toContain('created_by: skill-learning')
    expect(parsed.candidate?.body).toContain('source_session: "session-3"')
  })

  test('deduplicates a candidate from the same completed task', async () => {
    const ev = makeEvolution('')
    const input = {
      action: 'create' as const,
      scope: 'project' as const,
      projectRoot,
      name: 'project-verification',
      description: 'Reusable project verification workflow',
      whenToUse: 'Use after changing this project.',
      reason: 'Repeated workflow',
      evidence: ['Tests passed'],
      confidence: 0.93,
      markdown: buildSkillMarkdown('project-verification'),
      sourceSessionId: 'session-4',
      sourceFingerprint: 'same-task-fingerprint',
      sourceToolUses: 8,
    }
    const first = await ev.saveCandidate(input)
    const second = await ev.saveCandidate(input)
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.candidate.id).toBe(first.candidate.id)
  })

  test('approves a project draft by writing SKILL.md', async () => {
    const ev = makeEvolution('')
    const { candidate } = await ev.saveCandidate({
      action: 'create',
      scope: 'project',
      projectRoot,
      name: 'project-verification',
      description: 'Reusable project verification workflow',
      whenToUse: 'Use after changing this project.',
      reason: 'Repeated workflow',
      evidence: ['Tests passed'],
      confidence: 0.93,
      markdown: buildSkillMarkdown('project-verification'),
      sourceSessionId: 'session-5',
      sourceFingerprint: 'approval-fingerprint',
      sourceToolUses: 8,
    })
    const approved = await ev.approveCandidate(candidate.id)
    const skillPath = join(projectRoot, 'skills', 'project-verification', 'SKILL.md')
    expect(approved.status).toBe('approved')
    expect(approved.outputPath).toBe(skillPath)
    expect(await readFile(skillPath, 'utf-8')).toContain('# Verification Workflow')
    expect((await stat(skillPath)).mode & 0o777).toBe(0o600)
    expect((await ev.getCandidate(candidate.id))?.status).toBe('approved')
  })

  test('blocks credentials from being written and allows rejecting the draft', async () => {
    const ev = makeEvolution('')
    const secret = 'ghp_' + 'b'.repeat(36)
    const { candidate } = await ev.saveCandidate({
      action: 'create',
      scope: 'project',
      projectRoot,
      name: 'unsafe-skill',
      description: 'Unsafe workflow',
      whenToUse: 'Never',
      reason: 'Test secret safety',
      evidence: [],
      confidence: 0.99,
      markdown: buildSkillMarkdown('unsafe-skill', 'Use ' + secret + '.'),
      sourceSessionId: 'session-7',
      sourceFingerprint: 'secret-fingerprint',
      sourceToolUses: 6,
    })
    await expect(ev.approveCandidate(candidate.id)).rejects.toThrow('possible credentials')
    const rejected = await ev.rejectCandidate(candidate.id)
    expect(rejected.status).toBe('rejected')
  })

  test('runs the full review loop and auto-approves a confident candidate', async () => {
    const ev = makeEvolution(candidateResponse('project-verification'))
    await ev.executeReview({
      querySource: 'sdk',
      sessionId: 'session-loop',
      projectRoot,
      messages: taskMessages(6),
      toolUseContext: {
        agentId: undefined,
        options: { commands: [] as EvolutionSkill[], mainLoopModel: 'test-model' },
      },
    })
    const state = await ev.readState()
    expect(state.candidates).toHaveLength(1)
    expect(state.candidates[0]?.status).toBe('approved')
    const skillPath = join(projectRoot, 'skills', 'project-verification', 'SKILL.md')
    expect(await readFile(skillPath, 'utf-8')).toContain('# Project Verification')
  })

  test('records a no-candidate event when the model declines', async () => {
    const ev = makeEvolution('<no_skill>too trivial to reuse</no_skill>')
    await ev.executeReview({
      querySource: 'sdk',
      sessionId: 'session-noop',
      projectRoot,
      messages: taskMessages(6),
      toolUseContext: {
        agentId: undefined,
        options: { commands: [] as EvolutionSkill[], mainLoopModel: 'test-model' },
      },
    })
    const state = await ev.readState()
    expect(state.events).toContainEqual(expect.objectContaining({ kind: 'no-candidate' }))
  })

  test('projects prompt memory insights from user and brief entries', async () => {
    const promptRoot = join(fixture, 'prompt')
    await mkdir(join(promptRoot, 'prompt-memory'), { recursive: true })
    await writeFile(
      join(promptRoot, 'prompt-memory', 'USER.md'),
      'call me Alex\n§\nreply in Chinese\n',
      'utf-8',
    )
    await writeFile(join(promptRoot, 'prompt-memory', 'BRIEF.md'), 'always run the tests\n', 'utf-8')
    const insights = await projectPromptMemoryInsights({ roots: { configRoot: promptRoot } })
    expect(insights.insights.length).toBeGreaterThanOrEqual(2)
    expect(insights.stats.total).toBeGreaterThanOrEqual(2)
  })
})
