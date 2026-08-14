/**
 * rin skill memory — deterministic skill creation gate.
 *
 * Decides whether a proposed skill should reuse, merge with, or remain
 * distinct from existing skills by comparing normalized names and guidance
 * text. Runtime command values are adapters: callers pass only the comparable
 * fields exposed by SkillGateComparable, so this module never depends on CLI,
 * Tool, model, Server, or UI types.
 *
 * @module @rin/skill-memory
 */

export type SkillGateDecision = 'reuse' | 'merge' | 'create'

export interface SkillGateCandidate {
  name: string
  description?: string
  whenToUse?: string
}

export interface SkillGateComparable extends SkillGateCandidate {
  source?: string
  loadedFrom?: string
}

export interface SkillGateMatch {
  skillName: string
  score: number
  reason: string
  description?: string
  whenToUse?: string
  source?: string
  loadedFrom?: string
}

export interface SkillGateResult {
  decision: SkillGateDecision
  bestMatch?: SkillGateMatch
}

export const SKILL_GATE_REUSE_THRESHOLD = 0.88
export const SKILL_GATE_MERGE_THRESHOLD = 0.72

/** Split prose into normalized, lowercase tokens (length >= 2). */
function tokenize(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2),
  )
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  return intersection / (a.size + b.size - intersection)
}

/** Normalize a skill name to a stable slug for comparison. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Copy the adapter-only metadata from an existing skill onto a match. */
function enrichMatch(match: SkillGateMatch, existing: SkillGateComparable): SkillGateMatch {
  return {
    ...match,
    ...(existing.description === undefined ? {} : { description: existing.description }),
    ...(existing.whenToUse === undefined ? {} : { whenToUse: existing.whenToUse }),
    ...(existing.source === undefined ? {} : { source: existing.source }),
    ...(existing.loadedFrom === undefined ? {} : { loadedFrom: existing.loadedFrom }),
  }
}

/**
 * Score how closely a candidate overlaps an existing skill.
 *
 * The score is the maximum of the normalized-name similarity and the guidance
 * text (description + whenToUse) Jaccard similarity.
 *
 * @param candidate - the proposed skill.
 * @param existing - one skill already present.
 */
export function scoreSkillSimilarity(
  candidate: SkillGateCandidate,
  existing: SkillGateCandidate,
): SkillGateMatch {
  const candidateName = normalizeName(candidate.name)
  const existingName = normalizeName(existing.name)
  const nameScore =
    candidateName === existingName
      ? 1
      : jaccard(tokenize(candidateName.replace(/-/g, ' ')), tokenize(existingName.replace(/-/g, ' ')))

  const candidateText = [candidate.description, candidate.whenToUse].join(' ')
  const existingText = [existing.description, existing.whenToUse].join(' ')
  const textScore = jaccard(tokenize(candidateText), tokenize(existingText))
  const score = Math.max(nameScore, textScore)

  return {
    skillName: existing.name,
    score,
    reason:
      nameScore >= textScore
        ? 'similar skill name'
        : 'similar description or when_to_use',
  }
}

/**
 * Rank existing skills by similarity to a candidate, highest first.
 *
 * @param params.candidate - the proposed skill.
 * @param params.existingSkills - skills already present.
 * @param params.limit - maximum matches to return (default 5).
 */
export function rankSkillGateMatches(params: {
  candidate: SkillGateCandidate
  existingSkills: readonly SkillGateComparable[]
  limit?: number
}): SkillGateMatch[] {
  return params.existingSkills
    .map(existing => enrichMatch(scoreSkillSimilarity(params.candidate, existing), existing))
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit ?? 5)
}

/**
 * Decide whether a candidate reuses, merges with, or stays distinct from the
 * existing skills.
 *
 * @param params.candidate - the proposed skill.
 * @param params.existingSkills - skills already present.
 */
export function evaluateSkillCreationCandidate(params: {
  candidate: SkillGateCandidate
  existingSkills: readonly SkillGateComparable[]
}): SkillGateResult {
  const bestMatch = rankSkillGateMatches({
    candidate: params.candidate,
    existingSkills: params.existingSkills,
    limit: 1,
  })[0]

  if (!bestMatch) return { decision: 'create' }
  if (bestMatch.score >= SKILL_GATE_REUSE_THRESHOLD) {
    return { decision: 'reuse', bestMatch }
  }
  if (bestMatch.score >= SKILL_GATE_MERGE_THRESHOLD) {
    return { decision: 'merge', bestMatch }
  }
  return { decision: 'create', bestMatch }
}
