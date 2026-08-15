import { describe, expect, it } from 'vitest'
import type { RepositoryAgentInput } from '../api/agents'
import type { RepositoryConnection, RepositoryInstallPlan } from '../api/repositories'
import type { SandboxProfile } from '../api/sandboxes'
import { buildAgentConfigurationPrompt, buildSandboxConfigurationPrompt } from './aiConfigurationPrompts'

const repository: RepositoryConnection = {
  id: 'repo-1',
  name: 'Research repo',
  rootPath: 'E:/research-repo',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  storage: { mode: 'development', workingPath: 'E:/research-repo', seedStatus: 'development', localModificationCount: 0 },
  manifest: { version: 1, name: 'Research repo', categories: [] },
}

describe('AI configuration prompts', () => {
  it('scopes Agent configuration to a repository-backed typed configuration', () => {
    const draft: RepositoryAgentInput = {
      name: 'research-analyst',
      description: 'Review evidence',
      systemPrompt: 'Preserve provenance.',
      model: 'inherit',
      permissionMode: 'plan',
      tools: ['Read'],
      resources: { environmentProfileId: 'scientific-base', skillIds: ['literature'], workflowIds: ['review'] },
    }

    const prompt = buildAgentConfigurationPrompt({ repository, draft })

    expect(prompt).toContain('E:/research-repo')
    expect(prompt).toContain('agents')
    expect(prompt).toContain('Preserve typed resource references as environmentProfileId')
    expect(prompt).toContain('skillIds')
    expect(prompt).toContain('workflowIds')
    expect(prompt).toContain('research-analyst')
    expect(prompt).toMatch(/static|静态/i)
    expect(prompt).toMatch(/runtime|运行时/i)
  })

  it('scopes sandbox configuration to the linked profile and forbids host installation', () => {
    const profile: SandboxProfile = {
      id: 'sandbox-1',
      name: 'Scientific sandbox',
      type: 'container',
      repositoryId: repository.id,
      repositoryPath: repository.rootPath,
      container: { image: 'ubuntu:24.04', workdir: '/workspace' },
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }
    const installPlan: RepositoryInstallPlan = {
      repositoryId: repository.id,
      repositoryPath: repository.rootPath,
      manifestPath: 'E:/research-repo/repository.yaml',
      packageCount: 2,
      commands: ['python -m pip install numpy', 'Rscript install.R'],
    }

    const prompt = buildSandboxConfigurationPrompt({ profile, repository, installPlan })

    expect(prompt).toContain('sandbox-1')
    expect(prompt).toContain('Scientific sandbox')
    expect(prompt).toContain('E:/research-repo')
    expect(prompt).toContain('2')
    expect(prompt).toContain('python -m pip install numpy')
    expect(prompt).toMatch(/host|宿主机/i)
    expect(prompt).toMatch(/confirm|确认/i)
    expect(prompt).toMatch(/large image|大型镜像/i)
  })
})
