import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { handle } from '../../src/web-server/routes/skill-memory.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

async function makeRoots(withSkill = false) {
  const root = await mkdtemp(join(tmpdir(), 'rin-sm-'))
  cleanups.push(async () => { try { await import('node:fs/promises').then(m => m.rm(root, { recursive: true, force: true })) } catch {} })
  if (withSkill) {
    const dir = join(root, 'skill-memory', 'skill-a')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'STATS.json'), JSON.stringify({ skillName: 'skill-a', status: 'active', useCount: 2, pendingCount: 1, evidenceCount: 0, lastUsedAt: '2026-01-02T00:00:00.000Z' }))
    await writeFile(join(dir, 'SUMMARY.md'), '# Skill A\n\nsummary text')
  }
  return { globalConfigRoot: root }
}

function summary(overrides: Partial<{ scope: string; path: string; content: string }> = {}) {
  return { scope: 'global', path: '/tmp/skill-a/SUMMARY.md', content: '# Skill A\n\nsummary text', ...overrides }
}

function stats(overrides: Record<string, unknown> = {}) {
  return { version: 1, skillId: 'skill-a', rawKey: 'skill-a', skillName: 'skill-a', status: 'active', useCount: 2, pendingCount: 0, evidenceCount: 0, ...overrides }
}

function pendingEntry(overrides: Record<string, unknown> = {}) {
  return { version: 1, id: 'cand-1', skillId: 'skill-a', rawKey: 'skill-a', skillName: 'skill-a', observedAt: '2026-01-01T00:00:00.000Z', trigger: 'manual', ...overrides }
}

function services(store?: unknown) {
  const skillMemory = store === undefined ? undefined : { createStore(_roots: unknown) { return store } }
  return { skillMemory: () => skillMemory }
}

describe('skill-memory: dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/skills/x', '', 'GET', undefined, services(), { port: 1, host: '' })).toBeNull()
  })
})

describe('skill-memory: detail', () => {
  test('unmounted returns notMounted', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/detail', '?name=s', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('missing roots returns 400', async () => {
    const config = { port: 1, host: '' }
    const res = await handle('/api/skills/detail', '?name=s', 'GET', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'skill memory roots not configured; set Config.skillMemoryRoots' } })
  })

  test('missing name returns 400', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/detail', '', 'GET', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'name is required; pass ?name=' } })
  })

  test('empty summaries returns 404', async () => {
    const store = { async readSkillMemorySummaries() { return [] } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/detail', '?name=s', 'GET', undefined, services(store), config)
    expect(res).toEqual({ status: 404, body: { error: 'skill memory not found' } })
  })

  test('returns detail with preferred scope', async () => {
    let statsRef: unknown
    let statsScope: unknown
    const store = {
      async readSkillMemorySummaries() {
        return [
          summary({ scope: 'project', path: '/p/SUMMARY.md' }),
          summary({ scope: 'global', path: '/g/SUMMARY.md' }),
        ]
      },
      async readSkillMemoryStats(ref: unknown, scope: unknown) { statsRef = ref; statsScope = scope; return stats() },
    }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/detail', '?name=skill-a&source=project&cwd=/w', 'GET', undefined, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.detail.meta.name).toBe('skill-a')
    expect(res?.body.detail.meta.description).toBe('Skill A')
    expect(res?.body.detail.meta.enabled).toBe(true)
    expect(res?.body.detail.files.length).toBe(1)
    expect(statsScope).toBe('project')
    void statsRef
  })

  test('detail failure returns 500', async () => {
    const store = { async readSkillMemorySummaries() { throw new Error('boom') } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/detail', '?name=s', 'GET', undefined, services(store), config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('skill-memory: enabled', () => {
  test('wrong method returns 405', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/enabled', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('missing name or enabled returns 400', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/enabled', '', 'PATCH', {}, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'name and enabled are required' } })
  })

  test('sets lifecycle and lists disabled skills', async () => {
    let params: unknown
    const store = {
      async setSkillLifecycleStatus(p: unknown) { params = p; return stats() },
      async readSkillMemoryStats() { return stats({ status: 'archived' }) },
    }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots(true) }
    const res = await handle('/api/skills/enabled', '', 'PATCH', { name: 'skill-a', enabled: false }, services(store), config)
    expect(res).toEqual({ status: 200, body: { ok: true, disabledSkills: ['skill-a'] } })
    expect(params).toEqual({ ref: { skillName: 'skill-a' }, scope: 'global', status: 'archived' })
  })

  test('enabled failure returns 500', async () => {
    const store = { async setSkillLifecycleStatus() { throw new Error('boom') } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/enabled', '', 'PATCH', { name: 'skill-a', enabled: true }, services(store), config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('skill-memory: learning', () => {
  test('wrong method returns 405', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'DELETE', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('GET returns overview with empty dirs', async () => {
    const store = { async readSkillMemoryPending() { return [] } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'GET', undefined, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.overview.config.mode).toBe('off')
    expect(res?.body.overview.pendingCandidates).toEqual([])
    expect(res?.body.overview.memories).toEqual([])
  })

  test('PATCH updates config with defaults and writes file', async () => {
    const store = { async readSkillMemoryPending() { return [] } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'PATCH', { mode: 'auto', minToolUses: 5 }, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.config.mode).toBe('auto')
    expect(res?.body.config.minToolUses).toBe(5)
    expect(res?.body.config.minConfidence).toBe(0.6)
    expect(typeof res?.body.config.updatedAt).toBe('string')
  })

  test('PATCH invalid mode returns 400', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'PATCH', { mode: 'bad' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'mode must be off, suggest, or auto' } })
  })

  test('POST creates candidate', async () => {
    let captured: unknown
    const store = {
      async appendSkillMemoryPending(ref: unknown, scope: unknown, entry: Record<string, unknown>) {
        captured = { ref, scope, entry }
        return { version: 1, id: entry.id, skillId: 'skill-a', rawKey: 'skill-a', skillName: 'skill-a', observedAt: entry.observedAt, trigger: entry.trigger, excerpt: entry.excerpt, sessionId: entry.sessionId }
      },
    }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'POST', { name: 'skill-a', excerpt: 'ex', sessionId: 's1', trigger: 'invoked' }, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.candidate.name).toBe('skill-a')
    expect(res?.body.candidate.evidence).toEqual(['ex'])
    expect(res?.body.candidate.reason).toBe('invoked')
    expect((captured as { scope: string }).scope).toBe('global')
  })

  test('POST missing name returns 400', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning', '', 'POST', {}, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'name is required' } })
  })

  test('POST invalid trigger falls back to manual', async () => {
    let entry: unknown
    const store = { async appendSkillMemoryPending(_r: unknown, _s: unknown, e: unknown) { entry = e; return e } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    await handle('/api/skills/learning', '', 'POST', { name: 'skill-a', trigger: 'bogus' }, services(store), config)
    expect((entry as { trigger: string }).trigger).toBe('manual')
  })
})

describe('skill-memory: learning action', () => {
  test('wrong method returns 405', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning/cand-1/approve', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('malformed id returns 400', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skills/learning/%E0%A4%A/approve', '', 'POST', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'invalid learning candidate id' } })
  })

  test('missing candidate returns 404', async () => {
    const store = { async readSkillMemoryPending() { return [] } }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots(true) }
    const res = await handle('/api/skills/learning/cand-x/approve', '', 'POST', undefined, services(store), config)
    expect(res).toEqual({ status: 404, body: { error: 'learning candidate not found' } })
  })

  test('approve completes review', async () => {
    let completed: unknown
    const store = {
      async readSkillMemoryPending() { return [pendingEntry({ excerpt: 'excerpt' })] },
      async completeReview(p: unknown) { completed = p; return stats() },
    }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots(true) }
    const res = await handle('/api/skills/learning/cand-1/approve', '', 'POST', undefined, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.candidate.status).toBe('approved')
    expect((completed as { consumedCount: number }).consumedCount).toBe(1)
  })

  test('reject moves pending to evidence', async () => {
    let moved: unknown
    const store = {
      async readSkillMemoryPending() { return [pendingEntry()] },
      async movePendingToEvidence(p: unknown) { moved = p; return stats() },
    }
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots(true) }
    const res = await handle('/api/skills/learning/cand-1/reject', '', 'POST', undefined, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.candidate.status).toBe('rejected')
    expect((moved as { consumedCount: number }).consumedCount).toBe(1)
  })
})

describe('skill-memory: overview', () => {
  test('unmounted returns notMounted', async () => {
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots() }
    const res = await handle('/api/skill-memory/overview', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('missing roots returns 400', async () => {
    const config = { port: 1, host: '' }
    const res = await handle('/api/skill-memory/overview', '', 'GET', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'skill memory roots not configured; set Config.skillMemoryRoots' } })
  })

  test('lists skills from disk', async () => {
    const store = {}
    const config = { port: 1, host: '', skillMemoryRoots: await makeRoots(true) }
    const res = await handle('/api/skill-memory/overview', '', 'GET', undefined, services(store), config)
    expect(res?.status).toBe(200)
    expect(res?.body.mounted).toBe(true)
    expect(res?.body.skills.length).toBe(1)
    expect(res?.body.skills[0].skillName).toBe('skill-a')
    expect(res?.body.skills[0].status).toBe('active')
    expect(res?.body.skills[0].useCount).toBe(2)
  })
})
