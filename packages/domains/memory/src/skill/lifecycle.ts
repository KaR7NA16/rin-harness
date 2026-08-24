/**
 * rin skill memory — skill lifecycle policy.
 *
 * Derives a skill's status (active/stale/archived/pinned) from its usage
 * record and age. Pure and deterministic: it reads only the record and the
 * injected now, touching no filesystem and no wall clock.
 *
 * @module @rin/memory/skill
 */

export const SKILL_STALE_AFTER_DAYS = 30
export const SKILL_ARCHIVE_AFTER_DAYS = 90
export const SKILL_LOW_USE_COUNT = 3
export const SKILL_HIGH_USE_COUNT = 10

export type SkillLifecycleStatus = 'active' | 'stale' | 'archived' | 'pinned'

export interface SkillLifecycleRecord {
  status: SkillLifecycleStatus
  useCount: number
  lastUsedAt?: string
  summaryUpdatedAt?: string
}

/** Whole days elapsed since value, or null when absent or unparseable. */
const daysSince = (value: string | undefined, now: Date): number | null => {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return Math.max(0, (now.getTime() - time) / 86_400_000)
}

/**
 * Evaluate the current lifecycle status for a skill record.
 *
 * Pinned and frequently used skills stay active; low-use skills age stale
 * after SKILL_STALE_AFTER_DAYS and archived after SKILL_ARCHIVE_AFTER_DAYS
 * unless a recent summary update defers archival.
 *
 * @param record - the skill usage record.
 * @param now - evaluation instant (defaults to the current time).
 */
export function evaluateSkillLifecycleStatus(
  record: SkillLifecycleRecord,
  now: Date = new Date(),
): SkillLifecycleStatus {
  if (record.status === 'pinned') return 'pinned'

  const lastUsedDays = daysSince(record.lastUsedAt, now)
  if (lastUsedDays === null) {
    return record.status === 'archived' ? 'archived' : 'active'
  }
  if (record.useCount >= SKILL_HIGH_USE_COUNT) return 'active'

  const summaryUpdatedDays = daysSince(record.summaryUpdatedAt, now)
  const hasRecentSummary =
    summaryUpdatedDays !== null && summaryUpdatedDays < SKILL_ARCHIVE_AFTER_DAYS

  if (
    lastUsedDays >= SKILL_ARCHIVE_AFTER_DAYS &&
    record.useCount <= SKILL_LOW_USE_COUNT &&
    !hasRecentSummary
  ) {
    return 'archived'
  }

  if (
    lastUsedDays >= SKILL_STALE_AFTER_DAYS &&
    record.useCount <= SKILL_LOW_USE_COUNT
  ) {
    return 'stale'
  }

  return 'active'
}
