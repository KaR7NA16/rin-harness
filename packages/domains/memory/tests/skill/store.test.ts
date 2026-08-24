import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSkillMemoryStore } from '../../src/skill/store.ts'
import type { SkillMemoryRef } from '../../src/skill/types.ts'

const ref: SkillMemoryRef = {
  skillName: 'verification',
  source: 'plugin',
  loadedFrom: 'skills',
}

describe('Skill Memory store', () => {
  let fixture: string
  let store: ReturnType<typeof createSkillMemoryStore>

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), 'rin-skill-memory-store-'))
    store = createSkillMemoryStore({
      globalConfigRoot: path.join(fixture, 'global'),
      projectConfigRoot: path.join(fixture, 'project'),
    })
  })

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true })
  })

  test('serializes concurrent usage and reactivates archived skills', async () => {
    await Promise.all(Array.from({ length: 20 }, () =>
      store.recordSkillLifecycleUsage({ ref, scope: 'global' }),
    ))
    expect((await store.readSkillMemoryStats(ref, 'global')).useCount).toBe(20)

    await store.setSkillLifecycleStatus({
      ref,
      scope: 'global',
      status: 'archived',
    })
    await store.recordSkillLifecycleUsage({ ref, scope: 'global' })
    expect(await store.readSkillMemoryStats(ref, 'global')).toMatchObject({
      status: 'active',
      useCount: 21,
    })
  })

  test('limits summaries and hides archived content by default', async () => {
    await store.writeSkillMemorySummary(ref, 'global', 'x'.repeat(3_000))
    const summary = await store.readSkillMemorySummary(ref, 'global')
    expect(summary?.content.length).toBeLessThanOrEqual(2_500)

    await store.setSkillLifecycleStatus({
      ref,
      scope: 'global',
      status: 'archived',
    })
    expect(await store.readSkillMemorySummary(ref, 'global')).toBeNull()
    expect(await store.readSkillMemorySummary(
      ref,
      'global',
      { includeArchived: true },
    )).not.toBeNull()
  })

  test('retains bounded observations and completes a review in order', async () => {
    for (let index = 0; index < 85; index++) {
      await store.appendSkillMemoryPending(ref, 'project', {
        id: `observation-${index}`,
        observedAt: new Date(2026, 0, index + 1).toISOString(),
        trigger: 'review',
        excerpt: `evidence ${index}`,
      })
    }
    expect(await store.readSkillMemoryPending(ref, 'project')).toHaveLength(80)

    await store.completeReview({
      ref,
      scope: 'project',
      consumedCount: 12,
      summary: 'Always verify the observable result.',
    })

    expect(await store.readSkillMemoryPending(ref, 'project')).toHaveLength(68)
    expect(await store.readSkillMemorySummary(ref, 'project')).toMatchObject({
      content: 'Always verify the observable result.',
    })
    expect(await store.readSkillMemoryStats(ref, 'project')).toMatchObject({
      pendingCount: 68,
      evidenceCount: 12,
    })
  })
})
