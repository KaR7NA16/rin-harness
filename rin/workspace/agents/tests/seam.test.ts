import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createRepositoryAgent, updateRepositoryAgent } from '../src/repository-agents.ts'
import { COMPOSITION_FILE } from '../src/projection.ts'
import {
  AgentProjectionCore,
  AUTO_PROJECT_EVENT,
  computeRepositoryFingerprint,
  registerAgentsSeam,
  type AgentCreatedPayload,
  type AgentsSeam,
} from '../src/seam.ts'

const manifest = [
  'apiVersion: rin.dev/v1',
  'kind: AssetRepository',
  'metadata: { id: "t", name: "T", version: "1.0.0" }',
  'spec:',
  '  mutable: true',
  '  roots:',
  '    agents: agents',
].join('\n')

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'rin-agents-seam-'))
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'repository.yaml'), manifest)
  return { root, repo }
}

function fakeSeam() {
  const listeners = new Map<string, (payload: AgentCreatedPayload) => unknown>()
  const errors: string[] = []
  const seam: AgentsSeam = {
    on(event, listener) {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    },
    logger: { error: (...args: unknown[]) => { errors.push(args.map(String).join(' ')) } },
  }
  return { seam, listeners, errors }
}

describe('computeRepositoryFingerprint', () => {
  test('is empty for a repository with no agents', async () => {
    const { repo } = await makeRepo()
    expect(await computeRepositoryFingerprint(repo)).toBe('')
  })

  test('lists one name:revision line per agent in name order', async () => {
    const { repo } = await makeRepo()
    await createRepositoryAgent(repo, { name: 'beta', description: 'B', systemPrompt: 'B.' })
    await createRepositoryAgent(repo, { name: 'alpha', description: 'A', systemPrompt: 'A.' })
    expect(await computeRepositoryFingerprint(repo)).toMatch(/^alpha:[0-9a-f]{12}\nbeta:[0-9a-f]{12}$/)
  })

  test('changes when an agent is created or edited', async () => {
    const { repo } = await makeRepo()
    await createRepositoryAgent(repo, { name: 'coder', description: 'D', systemPrompt: 'S.' })
    const first = await computeRepositoryFingerprint(repo)
    await updateRepositoryAgent(repo, 'coder', { description: 'D', systemPrompt: 'Changed.' })
    expect(await computeRepositoryFingerprint(repo)).not.toBe(first)
  })
})

describe('AgentProjectionCore', () => {
  test('no-ops when no repository root is configured', async () => {
    const core = new AgentProjectionCore({})
    await expect(core.onAgentCreated()).resolves.toBeUndefined()
  })

  test('projects agents into the configured preset root', async () => {
    const { repo, root } = await makeRepo()
    const preset = join(root, 'presets')
    await createRepositoryAgent(repo, { name: 'coder', description: 'A coding agent', systemPrompt: 'You are a coding agent.', tools: ['bash'] })
    const core = new AgentProjectionCore({ defaultRepositoryRoot: repo, presetRoot: preset })
    await core.onAgentCreated()
    const file = await readFile(join(preset, 'coder', COMPOSITION_FILE), 'utf8')
    expect(file).toContain('id: persona')
    expect(file).toContain('You are a coding agent.')
  })

  test('skips a second projection while the fingerprint is unchanged', async () => {
    const { repo, root } = await makeRepo()
    const preset = join(root, 'presets')
    await createRepositoryAgent(repo, { name: 'coder', description: 'A', systemPrompt: 'You code.' })
    const core = new AgentProjectionCore({ defaultRepositoryRoot: repo, presetRoot: preset })
    await core.onAgentCreated()
    const path = join(preset, 'coder', COMPOSITION_FILE)
    const before = await stat(path)
    await new Promise(resolve => setTimeout(resolve, 25))
    await core.onAgentCreated()
    const after = await stat(path)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })
})

describe('registerAgentsSeam', () => {
  test('registers a disposer-returning listener on the auto-projection event', async () => {
    const { repo, root } = await makeRepo()
    const preset = join(root, 'presets')
    await createRepositoryAgent(repo, { name: 'coder', description: 'A', systemPrompt: 'You code.' })
    const { seam, listeners } = fakeSeam()
    const dispose = registerAgentsSeam(seam, { defaultRepositoryRoot: repo, presetRoot: preset })
    expect(listeners.has(AUTO_PROJECT_EVENT)).toBe(true)
    await listeners.get(AUTO_PROJECT_EVENT)!({ agent: {} })
    const file = await readFile(join(preset, 'coder', COMPOSITION_FILE), 'utf8')
    expect(file).toContain('id: persona')
    dispose()
    expect(listeners.has(AUTO_PROJECT_EVENT)).toBe(false)
  })

  test('registers nothing when autoProject is false', () => {
    const { seam, listeners } = fakeSeam()
    const dispose = registerAgentsSeam(seam, { autoProject: false })
    expect(listeners.size).toBe(0)
    dispose()
  })

  test('logs a projection failure without re-throwing', async () => {
    const { repo, root } = await makeRepo()
    const preset = join(root, 'presets')
    // Uppercase passes assertAgentName but fails assertValidPresetId.
    await createRepositoryAgent(repo, { name: 'BadAgent', description: 'A', systemPrompt: 'You code.' })
    const { seam, listeners, errors } = fakeSeam()
    registerAgentsSeam(seam, { defaultRepositoryRoot: repo, presetRoot: preset })
    await listeners.get(AUTO_PROJECT_EVENT)!({ agent: {} })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('cannot be projected')
  })
})
