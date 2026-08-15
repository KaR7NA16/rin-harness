/**
 * rin web-server — skill-memory write-path strip-types smoke.
 *
 * Exercises the skill-memory dispatcher directly with a stateful fake store
 * (plain object, no cordis, no @rin runtime modules) and a real tmp skill-memory
 * directory layout for enumeration, asserting each newly wired endpoint returns
 * real data instead of the old 404/empty stubs. Run from the package directory:
 *
 *   node --experimental-strip-types tests/skill-memory-write.smoke.ts
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { handle } from '../src/routes/skill-memory.ts'

let failures = 0
function expect(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log('PASS ' + label)
  } catch (err) {
    failures += 1
    console.error('FAIL ' + label)
    console.error('  expected:', inspect(expected))
    console.error('  actual:  ', inspect(actual))
  }
}

/** Stateful fake skill-memory store mirroring the 11-method surface the route calls. */
function makeFakeStore(globalDir, projectDir) {
  const statuses = new Map()      // source:skillName:scope -> status
  const pending = new Map()       // source:skillName:scope -> entries
  const calls = []                // record of store methods the routes actually hit

  const key = (ref, scope) => (ref.source ?? 'unknown') + ':' + ref.skillName + ':' + scope

  pending.set('user:my-skill:global', [
    {
      version: 1,
      id: 'cand-global',
      skillId: 'skill-a',
      rawKey: 'user:my-skill',
      skillName: 'my-skill',
      source: 'user',
      observedAt: '2026-01-01T00:00:00.000Z',
      trigger: 'invoked',
      excerpt: 'used the my-skill memory',
    },
  ])
  pending.set('project:project-skill:project', [
    {
      version: 1,
      id: 'cand-project',
      skillId: 'skill-b',
      rawKey: 'project:project-skill',
      skillName: 'project-skill',
      source: 'project',
      observedAt: '2026-01-02T00:00:00.000Z',
      trigger: 'manual',
      excerpt: 'observe the project skill',
      sessionId: 'sess-1',
    },
  ])

  return {
    calls,
    async readSkillMemorySummaries(ref) {
      calls.push(['readSkillMemorySummaries', ref])
      return [{
        scope: 'global',
        path: join(globalDir, 'SUMMARY.md'),
        content: '# My Skill\n\nDoes a thing.',
      }]
    },
    async readSkillMemorySummary(_ref, scope) {
      return { scope, path: join(globalDir, 'SUMMARY.md'), content: '# My Skill\n\nDoes a thing.' }
    },
    async readSkillMemoryStats(ref, scope) {
      calls.push(['readSkillMemoryStats', ref, scope])
      return {
        version: 1,
        skillId: 'skill-a',
        rawKey: key(ref, scope),
        skillName: ref.skillName,
        ...(ref.source === undefined ? {} : { source: ref.source }),
        status: statuses.get(key(ref, scope)) ?? 'active',
        useCount: 5,
        pendingCount: 1,
        evidenceCount: 0,
      }
    },
    async readSkillMemoryPending(ref, scope) {
      calls.push(['readSkillMemoryPending', ref, scope])
      return pending.get(key(ref, scope)) ?? []
    },
    async setSkillLifecycleStatus({ ref, scope, status }) {
      calls.push(['setSkillLifecycleStatus', ref, scope, status])
      statuses.set(key(ref, scope), status)
      return this.readSkillMemoryStats(ref, scope)
    },
    async appendSkillMemoryPending(ref, scope, entry) {
      calls.push(['appendSkillMemoryPending', ref, scope, entry])
      const full = {
        version: 1,
        id: entry.id,
        skillId: 'skill-a',
        rawKey: (ref.source ?? 'unknown') + ':' + ref.skillName,
        skillName: ref.skillName,
        ...(ref.source === undefined ? {} : { source: ref.source }),
        ...entry,
      }
      const list = pending.get(key(ref, scope)) ?? []
      list.push(full)
      pending.set(key(ref, scope), list)
      return full
    },
    async completeReview({ ref, scope, consumedCount, summary }) {
      calls.push(['completeReview', ref, scope, consumedCount, summary])
    },
    async movePendingToEvidence({ ref, scope, consumedCount }) {
      calls.push(['movePendingToEvidence', ref, scope, consumedCount])
    },
    async recordSkillLifecycleUsage() {},
    async updateSkillMemoryStats() { return {} },
    async writeSkillMemorySummary() {},
  }
}

async function main() {
  const tmp = await mkdtemp(join(tmpdir(), 'rin-web-sm-smoke-'))
  const globalRoot = join(tmp, 'global')
  const projectRoot = join(tmp, 'project')
  const globalDir = join(globalRoot, 'skill-memory', 'skill-a')
  const projectDir = join(projectRoot, 'skill-memory', 'skill-b')

  try {
    await mkdir(globalDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(globalDir, 'STATS.json'),
      JSON.stringify({ version: 1, skillId: 'skill-a', rawKey: 'user:my-skill', skillName: 'my-skill', source: 'user', status: 'active', useCount: 5, pendingCount: 1, evidenceCount: 0 }),
      'utf-8',
    )
    await writeFile(join(globalDir, 'SUMMARY.md'), '# My Skill\n\nDoes a thing.\n', 'utf-8')
    await writeFile(
      join(projectDir, 'STATS.json'),
      JSON.stringify({ version: 1, skillId: 'skill-b', rawKey: 'project:project-skill', skillName: 'project-skill', source: 'project', status: 'active', useCount: 2, pendingCount: 1, evidenceCount: 0 }),
      'utf-8',
    )
    await writeFile(join(projectDir, 'SUMMARY.md'), '# Project Skill\n', 'utf-8')

    const store = makeFakeStore(globalDir, projectDir)
    const services = {
      skillMemory: () => ({ createStore() { return store } }),
    }
    const config = {
      port: 8320,
      host: '127.0.0.1',
      skillMemoryRoots: { globalConfigRoot: globalRoot, projectConfigRoot: projectRoot },
    }

    let res

    // GET /api/skills/detail -> real SkillDetail body
    res = await handle('/api/skills/detail', '?source=user&name=my-skill', 'GET', undefined, services, config)
    expect('detail status', res.status, 200)
    expect('detail meta name', res.body.detail.meta.name, 'my-skill')
    expect('detail meta enabled', res.body.detail.meta.enabled, true)
    expect('detail file content', res.body.detail.files[0].content, '# My Skill\n\nDoes a thing.')
    expect('detail skillRoot', res.body.detail.skillRoot, globalDir)

    // GET /api/skills/detail missing name -> 400
    res = await handle('/api/skills/detail', '', 'GET', undefined, services, config)
    expect('detail missing name status', res.status, 400)

    // GET /api/skills/learning -> overview with pending candidates + memories + config
    res = await handle('/api/skills/learning', '?cwd=/proj', 'GET', undefined, services, config)
    expect('learning status', res.status, 200)
    expect('learning config default mode', res.body.overview.config.mode, 'off')
    expect('learning pending candidate count', res.body.overview.pendingCandidates.length, 2)
    expect('learning has global candidate', res.body.overview.pendingCandidates.some(c => c.id === 'cand-global'), true)
    expect('learning memories count', res.body.overview.memories.length, 2)

    // PATCH /api/skills/learning -> config update persisted + returned
    res = await handle('/api/skills/learning', '', 'PATCH', { mode: 'auto' }, services, config)
    expect('learning config patch status', res.status, 200)
    expect('learning config patch ok', res.body.ok, true)
    expect('learning config patch mode', res.body.config.mode, 'auto')

    // POST /api/skills/learning -> create candidate (appendSkillMemoryPending)
    res = await handle('/api/skills/learning', '', 'POST', { name: 'new-skill', source: 'user', excerpt: 'a fresh observation' }, services, config)
    expect('learning create status', res.status, 200)
    expect('learning create ok', res.body.ok, true)
    expect('learning create name', res.body.candidate.name, 'new-skill')
    expect('learning create status field', res.body.candidate.status, 'pending')

    // POST /api/skills/learning/:id/approve -> completeReview
    res = await handle('/api/skills/learning/cand-global/approve', '', 'POST', {}, services, config)
    expect('approve status', res.status, 200)
    expect('approve ok', res.body.ok, true)
    expect('approve candidate id', res.body.candidate.id, 'cand-global')
    expect('approve candidate status', res.body.candidate.status, 'approved')
    expect('approve hit completeReview', store.calls.some(c => c[0] === 'completeReview'), true)

    // POST /api/skills/learning/:id/reject -> movePendingToEvidence
    res = await handle('/api/skills/learning/cand-project/reject', '', 'POST', {}, services, config)
    expect('reject status', res.status, 200)
    expect('reject ok', res.body.ok, true)
    expect('reject candidate status', res.body.candidate.status, 'rejected')
    expect('reject hit movePendingToEvidence', store.calls.some(c => c[0] === 'movePendingToEvidence'), true)

    // POST /api/skills/learning/:id/approve unknown -> 404
    res = await handle('/api/skills/learning/nope/approve', '', 'POST', {}, services, config)
    expect('approve unknown status', res.status, 404)

    // PATCH /api/skills/enabled -> setSkillLifecycleStatus + disabled list
    res = await handle('/api/skills/enabled', '', 'PATCH', { source: 'user', name: 'my-skill', enabled: false }, services, config)
    expect('enabled patch status', res.status, 200)
    expect('enabled patch ok', res.body.ok, true)
    expect('enabled disabledSkills contains my-skill', res.body.disabledSkills.includes('my-skill'), true)
    expect('enabled disabledSkills excludes project-skill', res.body.disabledSkills.includes('project-skill'), false)
    expect('enabled hit setSkillLifecycleStatus', store.calls.some(c => c[0] === 'setSkillLifecycleStatus'), true)

    // PATCH /api/skills/enabled re-enable clears the disabled entry
    res = await handle('/api/skills/enabled', '', 'PATCH', { source: 'user', name: 'my-skill', enabled: true }, services, config)
    expect('enabled re-enable status', res.status, 200)
    expect('enabled re-enable disabledSkills', res.body.disabledSkills, [])

    // unmounted service keeps the notMounted envelope
    const unmounted = { skillMemory: () => undefined }
    res = await handle('/api/skills/detail', '?name=my-skill', 'GET', undefined, unmounted, config)
    expect('detail unmounted', res.body, { mounted: false })

    if (failures > 0) {
      console.error('skill-memory-write smoke: ' + failures + ' failure(s)')
      process.exitCode = 1
    } else {
      console.log('skill-memory-write smoke: all assertions passed')
      console.log('SKILL-MEMORY-WRITE-SMOKE-OK')
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

await main()
