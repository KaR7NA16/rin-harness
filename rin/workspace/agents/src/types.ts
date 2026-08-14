/**
 * rin agents — domain model.
 *
 * @rin/agents bridges the asset repository's agent records and the dsh
 * agent-presets seam. It owns two durable stores — repository agents
 * (RepositoryAgentConfiguration records under a repository's agents/ root)
 * and runtime agent definitions (YAML files under the rin agents home) —
 * plus the projection that materialises repository agents as dsh presets,
 * and the AI-proposal helper that drafts new agent records for review.
 *
 * This module carries types only; every constant, validator, and function
 * lives in its owning module.
 *
 * @module @rin/agents
 */

import type { AgentPermissionMode, RepositoryAgentConfiguration } from '@rin/repository'

/** Input for creating one repository agent record (version/kind are fixed). */
export interface RepositoryAgentInput {
  /** Stable id, also the record's file name; matches [A-Za-z0-9_-]. */
  name: string
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: AgentPermissionMode
  tools?: string[]
  resources?: {
    environmentProfileId?: string
    skillIds?: string[]
    workflowIds?: string[]
  }
}

/** Input for replacing one repository agent record; the id is the method argument. */
export type RepositoryAgentUpdateInput = Omit<RepositoryAgentInput, 'name'>

/** A repository agent with its on-disk content revision. */
export interface RepositoryAgentRecord extends RepositoryAgentConfiguration {
  /** First 12 hex digits of the file's SHA-256 digest. */
  revision: string
}

/** A runtime agent definition stored under the rin agents home. */
export interface RuntimeAgentDefinition {
  name: string
  description: string
  systemPrompt: string
  model?: string
  tools: string[]
  color?: string
}

/** Input for creating one runtime agent definition. */
export interface RuntimeAgentInput {
  name: string
  description: string
  systemPrompt: string
  model?: string
  tools?: string[]
  color?: string
}

/** Input for replacing one runtime agent definition; the name is the method argument. */
export type RuntimeAgentUpdateInput = Omit<RuntimeAgentInput, 'name'>

/** A proposal produced from user instructions, pending human review. */
export interface AgentProposal {
  name: string
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: AgentPermissionMode
  tools: string[]
}

/** text→configuration adapter; the LLM call is the adapter's responsibility. */
export type AgentGenerate = (prompt: string) => Promise<unknown>

/** Options for projecting repository agents into a preset root. */
export interface ProjectOptions {
  /** Explicit preset root; absent resolves the default user preset root. */
  presetRoot?: string
}

/** Result of projecting one repository's agents into a preset root. */
export interface ProjectionResult {
  /** Preset ids materialised, in repository order. */
  ids: string[]
}
