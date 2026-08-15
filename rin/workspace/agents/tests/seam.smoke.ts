/**
 * rin agents — auto-projection seam strip-types smoke script.
 *
 * Exercises the `agent/created` auto-projection seam without importing
 * Cordis: registration on a fake ctx, projection on trigger, fingerprint
 * idempotence (no rewrite for unchanged content), fail-loud divergence, and
 * the autoProject=false / missing-root paths. Run from the package directory
 * with:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepositoryAgent, updateRepositoryAgent } from '../src/repository-agents.ts'
import { AUTO_PROJECT_EVENT, computeRepositoryFingerprint, registerAgentsSeam } from '../src/seam.ts'
import { COMPOSITION_FILE } from '../src/projection.ts'

const manifest = [
  'apiVersion: rin.dev/v1',
  'kind: AssetRepository',
  'metadata: { id: "smoke", name: "Smoke", version: "1.0.0" }',
  'spec:',
  '  mutable: true',
  '  roots:',
  '    agents: agents',
].join('\n')

/** A fake seam ctx that records listeners and log lines, mirroring cordis's on()/logger. */
function fakeSeam() {
  const listeners = new Map()
  const errors = []
  return {
    listeners,
    errors,
    on(event, listener) {
      listeners.set(event, listener)
      return () => { listeners.delete(event) }
    },
    logger: { error: (...args) => { errors.push(args.map(String).join(' ')) } },
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'rin-agents-seam-'))
  const repo = join(root, 'repo')
  const preset = join(root, 'presets')
  await mkdir(repo, { recursive: true })
  await writeFile(join(repo, 'repository.yaml'), manifest)
  await createRepositoryAgent(repo, { name: 'coder', description: 'A coding agent', systemPrompt: 'You are a coding agent.', tools: ['bash', 'fs'] })

  // register the seam and confirm the agent/created listener is installed
  const seam = fakeSeam()
  const dispose = registerAgentsSeam(seam, { defaultRepositoryRoot: repo, presetRoot: preset })
  assert.equal(seam.listeners.has(AUTO_PROJECT_EVENT), true)
  const listener = seam.listeners.get(AUTO_PROJECT_EVENT)
  assert.equal(typeof listener, 'function')

  // trigger → materialise the preset under <presetRoot>/coder/agent.cordis.yml
  await listener({ agent: {} })
  const filePath = join(preset, 'coder', COMPOSITION_FILE)
  let rendered = await readFile(filePath, 'utf8')
  assert.match(rendered, /id: persona/)
  assert.match(rendered, /dsh-persona/)
  assert.match(rendered, /id: tool-fs/)
  assert.match(rendered, /You are a coding agent\./)
  assert.equal(seam.errors.length, 0)

  // idempotent: unchanged content does not rewrite the file
  const firstStat = await stat(filePath)
  await new Promise(resolve => setTimeout(resolve, 25))
  await listener({ agent: {} })
  const secondStat = await stat(filePath)
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs)
  assert.equal(seam.errors.length, 0)

  // divergence: an edited repository agent fails loud but never blocks the trigger
  await updateRepositoryAgent(repo, 'coder', { description: 'A coding agent', systemPrompt: 'You are a strict coding agent.', tools: ['bash'] })
  await listener({ agent: {} })
  assert.equal(seam.errors.length, 1)
  assert.match(seam.errors[0], /already exists with different content/)
  rendered = await readFile(filePath, 'utf8')
  assert.match(rendered, /You are a coding agent\./)
  assert.doesNotMatch(rendered, /strict coding agent/)

  // fingerprint: content digest changes with the repository, not monotonic
  const fA = await computeRepositoryFingerprint(repo)
  assert.match(fA, /^coder:[0-9a-f]{12}$/)
  await updateRepositoryAgent(repo, 'coder', { description: 'A coding agent', systemPrompt: 'You are a strict coding agent.', tools: ['bash', 'web'] })
  assert.notEqual(await computeRepositoryFingerprint(repo), fA)

  // disposer removes the listener
  dispose()
  assert.equal(seam.listeners.has(AUTO_PROJECT_EVENT), false)

  // autoProject: false registers nothing
  const disabled = fakeSeam()
  const disposeDisabled = registerAgentsSeam(disabled, { defaultRepositoryRoot: repo, presetRoot: preset, autoProject: false })
  assert.equal(disabled.listeners.size, 0)
  disposeDisabled()

  // missing repository root is a no-op (no throw, no log)
  const noRoot = fakeSeam()
  registerAgentsSeam(noRoot, { presetRoot: preset })
  await noRoot.listeners.get(AUTO_PROJECT_EVENT)({ agent: {} })
  assert.equal(noRoot.errors.length, 0)

  await rm(root, { recursive: true, force: true })
  console.log('AGENTS-SEAM-SMOKE-OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
