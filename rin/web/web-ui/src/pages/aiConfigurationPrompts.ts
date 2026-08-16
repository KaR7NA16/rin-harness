import type { RepositoryAgentInput } from '../api/agents'
import type { RepositoryConnection } from '../api/repositories'
import type { SandboxProfile } from '../api/sandboxes'

export function buildAgentConfigurationPrompt({ repository, draft }: {
  repository: RepositoryConnection
  draft: RepositoryAgentInput
}) {
  return [
    'Configure an Agent for this connected repository.',
    `Repository: ${repository.name} (${repository.rootPath})`,
    'Read repository.yaml and inspect the agents directory before proposing changes.',
    'Create or update one auditable *.agent.yaml configuration. Preserve typed resource references as environmentProfileId, skillIds, and workflowIds, and verify every referenced ID exists in the repository.',
    `Current form draft:\n${JSON.stringify(draft, null, 2)}`,
    'First clarify any missing responsibility, permission, model, or tool requirements. Show the proposed configuration and validation result before writing it.',
    'A saved Agent file is static configuration only. Do not claim runtime activation until a separate runtime load or dispatch has actually been verified.',
  ].join('\n\n')
}

export function buildSandboxConfigurationPrompt({ profile, repository }: {
  profile: SandboxProfile
  repository: RepositoryConnection
}) {
  return [
    'Configure the selected sandbox using its linked repository.',
    `Sandbox: ${profile.name} (id: ${profile.id}, type: ${profile.type})`,
    `Repository: ${repository.name} (${repository.rootPath})`,
    'Inspect the current sandbox profile and runtime state first. Explain the exact plan and wait for explicit confirmation before running any command.',
    'Never install packages on the host. Execute installation only inside this selected sandbox profile.',
    'Do not pull or build a large image, replace the base image, or start an expensive environment build without separate explicit approval.',
  ].join('\n\n')
}
