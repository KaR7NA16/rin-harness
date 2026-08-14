/**
 * rin agents — AI proposal.
 *
 * proposeAgent is a pure function over an injected text→configuration adapter:
 * the adapter owns the LLM call (and may be backed by the dsh llm seam), while
 * this module owns the prompt and the parsing/validation of whatever the model
 * returns. The prompt wording is original, not ported from the legacy
 * generateAgent.
 *
 * @module @rin/agents
 */

import type { AgentPermissionMode } from '@rin/repository'
import type { AgentGenerate, AgentProposal } from './types.ts'
import { assertAgentName, isAgentPermissionMode, normalizeTextList, requireRecord, requireText } from './validation.ts'

/**
 * Build the prompt that asks a model for one AgentConfiguration draft.
 * @param instructions - the user's free-form description of the wanted agent.
 * @returns the prompt text.
 */
export function buildAgentProposalPrompt(instructions: string): string {
  return [
    'You are drafting one agent configuration for the rin asset repository.',
    '',
    'Return a single JSON object — no prose, no markdown fences — with exactly these fields:',
    '- name: a short stable id, lowercase letters, digits, and hyphens only (no spaces or underscores).',
    '- description: one sentence on what the agent is for.',
    '- systemPrompt: the complete first-person system prompt the agent runs under.',
    '- tools: an array of tool ids the agent may call (e.g. ["bash", "fs"]); omit unknown tools.',
    '- model: optional model id, only when the request names one.',
    '- permissionMode: one of "default", "acceptEdits", "plan", "bypassPermissions", only when the request asks for one.',
    '',
    'Infer everything not stated. Keep the systemPrompt self-contained and imperative.',
    '',
    'User request:',
    instructions.trim(),
  ].join('\n')
}

/**
 * Parse and validate whatever the adapter returned into a proposal.
 *
 * Accepts a JSON object, a JSON string (optionally inside code fences), or a
 * chat-completion envelope carrying a text/content string, so adapters may
 * return the raw model text or a structured result.
 * @param raw - the adapter result.
 * @returns the validated proposal.
 * @throws when the value cannot be parsed or lacks required fields.
 */
export function parseAgentProposal(raw: unknown): AgentProposal {
  const value = extractProposalRecord(raw)
  if (value.permissionMode !== undefined && !isAgentPermissionMode(value.permissionMode)) {
    throw new Error('rin agents: proposal permissionMode must be one of default, acceptEdits, plan, bypassPermissions')
  }
  return {
    name: assertAgentName(value.name, 'proposal name'),
    description: requireText(value.description, 'proposal description'),
    systemPrompt: requireText(value.systemPrompt, 'proposal systemPrompt'),
    tools: normalizeTextList(value.tools, 'proposal tools'),
    ...(typeof value.model === 'string' && value.model.trim() !== '' ? { model: value.model.trim() } : {}),
    ...(value.permissionMode !== undefined ? { permissionMode: value.permissionMode as AgentPermissionMode } : {}),
  }
}

/**
 * Propose one agent from user instructions through the injected adapter.
 * @param instructions - the user's description of the wanted agent.
 * @param generate - the text→configuration adapter that runs the model.
 * @returns the validated proposal, ready for review and createRepositoryAgent.
 */
export async function proposeAgent(instructions: string, generate: AgentGenerate): Promise<AgentProposal> {
  return parseAgentProposal(await generate(buildAgentProposalPrompt(instructions)))
}

/** Unwrap a string, an object, or a chat envelope into the proposal record. */
function extractProposalRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    return requireRecord(parseJson(stripCodeFences(raw)), 'proposal')
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    for (const key of ['text', 'content', 'message']) {
      const nested = record[key]
      if (typeof nested === 'string') return extractProposalRecord(nested)
      if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
        const inner = nested as Record<string, unknown>
        if (typeof inner.content === 'string') return extractProposalRecord(inner.content)
      }
    }
    return record
  }
  throw new Error('rin agents: proposal adapter returned no parseable object')
}

/** Strip a fenced JSON block or surrounding prose, keeping the JSON span. */
function stripCodeFences(text: string): string {
  const fenced = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/.exec(text)
  const captured = fenced?.[1]
  if (captured !== undefined) return captured
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}

/** Parse a JSON string, rethrowing parse failures with a readable reason. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim())
  } catch (error) {
    throw new Error(`rin agents: proposal adapter returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}
