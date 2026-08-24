/**
 * rin skill-memory — strip-types smoke test for the skills-seam projection.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 *
 * @module @rin/memory/skill
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SKILL_MEMORY_PROVIDER_NAME,
  registerSkillMemorySeam,
} from '../../src/skill/seam.ts'
import { skillMemoryDshName } from '../../src/skill/catalog.ts'
import { createSkillMemoryStore } from '../../src/skill/store.ts'

/** Minimal fake skills registry exposing registerProvider + the created provider. */
function fakeSkillsRegistry() {
  let provider = null
  let control = null
  const skills = {
    registerProvider(factory) {
      control = {
        signal: new AbortController().signal,
        invalidate: () => {},
      }
      provider = factory(control)
      return () => { provider = null }
    },
  }
  return {
    skills,
    get provider() { return provider },
    get control() { return control },
  }
}

const fixture = await mkdtemp(join(tmpdir(), 'rin-skill-memory-seam-'))
try {
  const roots = {
    globalConfigRoot: join(fixture, 'global'),
    projectConfigRoot: join(fixture, 'project'),
  }
  const store = createSkillMemoryStore(roots)
  const verificationRef = { skillName: 'verification', source: 'plugin', loadedFrom: 'skills' }
  await store.writeSkillMemorySummary(
    verificationRef,
    'global',
    '# Verification\n\nAlways verify the observable result before reporting success.',
  )
  const archivedRef = { skillName: 'archived-skill' }
  await store.writeSkillMemorySummary(archivedRef, 'global', 'Should stay hidden.')
  await store.setSkillLifecycleStatus({ ref: archivedRef, scope: 'global', status: 'archived' })
  await store.writeSkillMemorySummary(
    { skillName: 'deploy-check' },
    'project',
    'Verify deployment health before finishing.',
  )

  const registry = fakeSkillsRegistry()
  registerSkillMemorySeam({ skills: registry.skills }, { roots })

  if (registry.provider === null) throw new Error('provider was not registered')
  if (registry.provider.name !== SKILL_MEMORY_PROVIDER_NAME) {
    throw new Error('wrong provider name: ' + registry.provider.name)
  }

  const candidates = await registry.provider.list({})
  const names = candidates.map(candidate => candidate.name)
  if (names.length !== 2) {
    throw new Error('expected 2 candidates, got ' + names.length + ': ' + names.join(','))
  }
  const verificationName = skillMemoryDshName('verification', 'plugin', 'skills')
  const projectName = skillMemoryDshName('deploy-check')
  const archivedName = skillMemoryDshName('archived-skill')
  if (!names.includes(verificationName)) throw new Error('missing verification memory, got ' + names.join(','))
  if (!names.includes(projectName)) throw new Error('missing project memory, got ' + names.join(','))
  if (names.includes(archivedName)) throw new Error('archived memory should be gated out')

  const verificationCandidate = candidates.find(candidate => candidate.name === verificationName)
  if (verificationCandidate === undefined) throw new Error('verification candidate missing')
  const definition = await registry.provider.get(verificationCandidate, {})
  if (definition === undefined) throw new Error('get() returned undefined')
  if (!definition.content.includes('Always verify the observable result')) {
    throw new Error('get() returned wrong body: ' + definition.content)
  }
  if (definition.name !== verificationName) throw new Error('get() returned wrong name: ' + definition.name)
  if (definition.provider !== SKILL_MEMORY_PROVIDER_NAME) throw new Error('wrong definition provider')

  // A missing memory directory is not loadable after discovery.
  const gone = await registry.provider.get(
    { ...verificationCandidate, locator: { dir: '/nonexistent', scope: 'global' } },
    {},
  )
  if (gone !== undefined) throw new Error('expected undefined for a missing memory directory')

  // dispose stops future discovery.
  registry.provider.dispose()
  const afterDispose = await registry.provider.list({})
  if (afterDispose.length !== 0) throw new Error('dispose should empty the catalog')

  console.log('SEAM-SMOKE-OK', JSON.stringify({ candidates: names, provider: registry.provider.name }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}
