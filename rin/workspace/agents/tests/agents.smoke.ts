/**
 * rin agents — strip-types smoke script.
 *
 * Exercises the smoke-testable modules end to end — repository-agent CRUD,
 * runtime-definition CRUD, projection into a preset root, and the proposal
 * adapter — without importing cordis. Run from the package directory with:
 *
 *   node --experimental-strip-types tests/agents.smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeRevision } from '../src/revision.ts'
import {
  createRepositoryAgent,
  deleteRepositoryAgent,
  getRepositoryAgent,
  listRepositoryAgents,
  updateRepositoryAgent,
} from '../src/repository-agents.ts'
import {
  createRuntimeAgent,
  deleteRuntimeAgent,
  getRuntimeAgent,
  listRuntimeAgents,
  updateRuntimeAgent,
} from '../src/runtime-agents.ts'
import { COMPOSITION_FILE, projectRepositoryAgents } from '../src/projection.ts'
import { proposeAgent } from '../src/proposal.ts'

const manifest = [
  'apiVersion: rin.dev/v1',
  'kind: AssetRepository',
  'metadata: { id: "smoke", name: "Smoke", version: "1.0.0" }',
  'spec:',
  '  mutable: true',
  '  roots:',
  '    agents: agents',
].join('\n')

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'rin-agents-'))
  const repo = join(root, 'repo')
  const preset = join(root, 'presets')
  const home = join(root, 'home')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'repository.yaml'), manifest)

  // revision
  assert.match(computeRevision('abc'), /^[0-9a-f]{12}$/)

  // repository CRUD
  const created = await createRepositoryAgent(repo, {
    name: 'coder',
    description: 'A coding agent',
    systemPrompt: 'You are a coding agent.',
    tools: ['bash', 'fs'],
  })
  assert.equal(created.name, 'coder')
  assert.match(created.revision, /^[0-9a-f]{12}$/)
  assert.equal(created.revision, computeRevision(await readFile(join(repo, 'agents', 'coder.agent.yaml'), 'utf8')))

  const listed = await listRepositoryAgents(repo)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'coder')

  const got = await getRepositoryAgent(repo, 'coder')
  assert.equal(got && got.systemPrompt, 'You are a coding agent.')

  const updated = await updateRepositoryAgent(repo, 'coder', {
    description: 'Updated',
    systemPrompt: 'You are an updated coding agent.',
    tools: ['bash'],
  })
  assert.equal(updated.systemPrompt, 'You are an updated coding agent.')
  assert.notEqual(updated.revision, created.revision)

  await deleteRepositoryAgent(repo, 'coder')
  assert.equal(await getRepositoryAgent(repo, 'coder'), undefined)

  // runtime CRUD
  const rt = await createRuntimeAgent(home, {
    name: 'reviewer',
    description: 'A code reviewer',
    systemPrompt: 'You review code.',
    tools: ['fs'],
    color: '#ff0000',
  })
  assert.equal(rt.name, 'reviewer')
  assert.equal(rt.color, '#ff0000')
  assert.equal((await listRuntimeAgents(home)).length, 1)
  assert.equal((await getRuntimeAgent(home, 'reviewer')) && (await getRuntimeAgent(home, 'reviewer')).description, 'A code reviewer')

  const rtUpdated = await updateRuntimeAgent(home, 'reviewer', {
    description: 'A stricter reviewer',
    systemPrompt: 'You review code strictly.',
    tools: [],
  })
  assert.equal(rtUpdated.description, 'A stricter reviewer')
  await deleteRuntimeAgent(home, 'reviewer')
  assert.equal(await getRuntimeAgent(home, 'reviewer'), undefined)

  // projection
  await createRepositoryAgent(repo, { name: 'coder', description: 'A', systemPrompt: 'You are a coding agent.', tools: ['bash'] })
  await createRepositoryAgent(repo, { name: 'researcher', description: 'B', systemPrompt: 'You research.', tools: [] })

  const result = await projectRepositoryAgents(repo, preset)
  assert.deepEqual(result.ids, ['coder', 'researcher'])

  const cordis = await readFile(join(preset, 'coder', COMPOSITION_FILE), 'utf8')
  assert.match(cordis, /id: persona/)
  assert.match(cordis, /dsh-persona/)
  assert.match(cordis, /complete: true/)
  assert.match(cordis, /id: tool-bash/)
  assert.match(cordis, /You are a coding agent./)

  // idempotent re-projection
  const again = await projectRepositoryAgents(repo, preset)
  assert.deepEqual(again.ids, ['coder', 'researcher'])

  // conflict: a hand-edited preset with different content is never overwritten
  await writeFile(join(preset, 'coder', COMPOSITION_FILE), '# hand-edited\n')
  let threw = false
  try {
    await projectRepositoryAgents(repo, preset)
  } catch {
    threw = true
  }
  assert.equal(threw, true)

  // proposal adapter with a fake
  const proposal = await proposeAgent('a polite greeter', async () =>
    JSON.stringify({ name: 'greeter', description: 'Greets people', systemPrompt: 'You greet people warmly.', tools: [] }),
  )
  assert.equal(proposal.name, 'greeter')
  assert.equal(proposal.systemPrompt, 'You greet people warmly.')

  await rm(root, { recursive: true, force: true })
  console.log('AGENTS-SMOKE-OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
