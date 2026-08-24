/**
 * rin agents — proposal store.
 *
 * File-backed JSON store for pending agent-change proposals: prepare (record a
 * generated candidate), approve (write the agent + mark approved), reject, get,
 * and list. Ported from the legacy desktop agentProposalService, re-encoded as JSON
 * (the legacy store was YAML). Cordis-free: node: builtins only.
 *
 * @module @rin/workspace/agents
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RepositoryAgentInput } from './types.ts'

export type ProposalStatus = 'proposed' | 'blocked' | 'stale' | 'approved' | 'rejected'

/** One durable agent-change proposal. */
export interface StoredProposal {
  id: string
  repositoryId: string
  currentName?: string
  instructions: string
  candidate: RepositoryAgentInput
  baseRevision: string | null
  validationIssues: string[]
  status: ProposalStatus
  createdAt: string
  updatedAt: string
}

interface ProposalFile {
  version: 1
  proposals: StoredProposal[]
}

/** Resolve the proposal store path under the agents home. */
export function proposalStorePath(agentsHome: string): string {
  return join(agentsHome, 'agent-proposals.json')
}

/** Read every proposal from disk, defaulting to an empty list. */
export async function loadProposals(path: string): Promise<StoredProposal[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as Partial<ProposalFile>
    return Array.isArray(parsed.proposals) ? parsed.proposals : []
  } catch {
    return []
  }
}

/** Persist the full proposal list to disk. */
export async function saveProposals(path: string, proposals: StoredProposal[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ version: 1, proposals }, null, 2) + '\n', 'utf-8')
}

/** Update-or-insert one proposal in place, returning the stored list. */
export async function upsertProposal(path: string, proposal: StoredProposal): Promise<StoredProposal[]> {
  const proposals = await loadProposals(path)
  const index = proposals.findIndex(item => item.id === proposal.id)
  if (index >= 0) proposals[index] = proposal
  else proposals.push(proposal)
  await saveProposals(path, proposals)
  return proposals
}
