import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { repositoriesApi, type RepositoryConnection } from '../api/repositories'
import { sandboxesApi, type SandboxProfile } from '../api/sandboxes'
import { useSettingsStore } from '../stores/settingsStore'
import { Sandboxes } from './Sandboxes'

vi.mock('../api/repositories', () => ({
  repositoriesApi: { list: vi.fn(), environmentProfiles: vi.fn() },
}))

vi.mock('../api/sandboxes', () => ({
  sandboxesApi: {
    list: vi.fn(),
    runtime: vi.fn(),
    state: vi.fn(),
    environmentRuns: vi.fn(),
    prepareEnvironment: vi.fn(),
    approveEnvironment: vi.fn(),
  },
}))

const repository: RepositoryConnection = {
  id: 'repo-1',
  name: 'Research repo',
  rootPath: 'E:/research-repo',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  environmentPackages: [],
  environmentProfiles: [],
}

const profile: SandboxProfile = {
  id: 'sandbox-1',
  name: 'Scientific sandbox',
  type: 'container',
  repositoryId: repository.id,
  repositoryPath: repository.rootPath,
  environmentProfileId: 'scientific-base',
  container: { image: 'ubuntu:24.04', workdir: '/workspace' },
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
}

describe('Sandboxes AI configuration entry', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.mocked(sandboxesApi.list).mockResolvedValue({ profiles: [profile] })
    vi.mocked(sandboxesApi.runtime).mockResolvedValue({ runtime: 'docker', version: '29.4.1' })
    vi.mocked(sandboxesApi.state).mockResolvedValue({ exists: false, running: false })
    vi.mocked(repositoriesApi.list).mockResolvedValue({ repositories: [repository] })
    vi.mocked(repositoriesApi.environmentProfiles).mockResolvedValue({
      repositoryId: repository.id,
      profiles: [{
        apiVersion: 'rin.dev/v1', kind: 'EnvironmentProfile',
        metadata: { id: 'scientific-base', name: 'Scientific base', version: '1.0.0' },
        spec: { packages: ['system-git', 'python-numpy'] },
      }],
    })
    vi.mocked(sandboxesApi.environmentRuns).mockResolvedValue({ runs: [] })
    vi.mocked(sandboxesApi.prepareEnvironment).mockResolvedValue({
      id: 'run-1', sandboxProfileId: profile.id, repositoryId: repository.id,
      environmentProfileId: 'scientific-base', status: 'resolved', createdAt: '', updatedAt: '', logs: [],
      plan: {
        profileId: 'scientific-base', profileVersion: '1.0.0', status: 'ready', packageCount: 2,
        preflight: [{ id: 'runtime-python', status: 'ready', message: 'ready' }],
        stages: [{ id: 'python', commands: ['python -m pip install numpy'] }],
      },
    })
    vi.mocked(sandboxesApi.approveEnvironment).mockResolvedValue({
      id: 'run-1', sandboxProfileId: profile.id, repositoryId: repository.id,
      environmentProfileId: 'scientific-base', status: 'ready', createdAt: '', updatedAt: '',
      plan: { profileId: 'scientific-base', profileVersion: '1.0.0', status: 'ready', packageCount: 2, preflight: [], stages: [] },
      logs: [{ stageId: 'python', command: 'python -m pip install numpy', status: 'succeeded', code: 0, startedAt: '', finishedAt: '', retryable: false }],
    })
  })

  it('shows the migrated AI action on a repository-linked sandbox profile', async () => {
    render(<Sandboxes />)

    await waitFor(() => expect(screen.getByText('Scientific sandbox')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Ask AI to configure sandbox' })).toBeInTheDocument()
  })

  it('prepares a profile plan and requires a second explicit approval', async () => {
    render(<Sandboxes />)

    await waitFor(() => expect(screen.getByText('Scientific base')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Prepare environment' }))

    await waitFor(() => expect(screen.getByText('python -m pip install numpy')).toBeInTheDocument())
    expect(sandboxesApi.approveEnvironment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and install' }))
    await waitFor(() => expect(sandboxesApi.approveEnvironment).toHaveBeenCalledWith(profile.id, 'run-1'))
  })
})
