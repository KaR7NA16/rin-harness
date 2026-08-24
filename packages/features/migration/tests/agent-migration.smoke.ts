/**
 * rin agent-migration — strip-types smoke script.
 *
 * Exercises the scan core against a simulated home directory: claude/codex
 * agents directories are detected with the right id/name/source/status, and a
 * home with no external-agent directories yields an empty list. Run from the
 * package directory with:
 *
 *   node --experimental-strip-types tests/agent-migration.smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanAgentMigration } from '../src/scan.ts'

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'rin-agent-migration-'))

  await mkdir(join(home, '.claude', 'agents'), { recursive: true })
  await writeFile(join(home, '.claude', 'agents', 'reviewer.md'), '# Reviewer agent\n')
  await mkdir(join(home, '.codex', 'agents'), { recursive: true })
  await writeFile(join(home, '.codex', 'agents', 'planner.md'), '# Planner agent\n')

  const scan = await scanAgentMigration(home)
  assert.equal(scan.targetAgentId, 'claude-code')
  assert.match(scan.scannedAt, /^\d{4}-\d{2}-\d{2}T/)

  assert.equal(scan.agents.length, 2)
  const claude = scan.agents.find(agent => agent.id === 'claude-code')
  assert.ok(claude)
  assert.equal(claude.name, 'Claude Code')
  assert.equal(claude.source, join(home, '.claude'))
  assert.equal(claude.status, 'detected')

  const codex = scan.agents.find(agent => agent.id === 'codex')
  assert.ok(codex)
  assert.equal(codex.name, 'Codex')
  assert.equal(codex.source, join(home, '.codex'))
  assert.equal(codex.status, 'detected')

  // A home with no external-agent config directories yields an empty list.
  const empty = await mkdtemp(join(tmpdir(), 'rin-agent-migration-empty-'))
  const emptyScan = await scanAgentMigration(empty)
  assert.deepEqual(emptyScan.agents, [])

  await rm(home, { recursive: true, force: true })
  await rm(empty, { recursive: true, force: true })
  console.log('AGENT-MIGRATION-SMOKE-OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
