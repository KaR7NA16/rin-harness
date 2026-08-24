import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { repositoriesApi, type RepositoryConnection } from '../api/repositories'
import { useSettingsStore } from '../stores/settingsStore'
import { RepositoryWorkspace } from './RepositoryWorkspace'

vi.mock('../api/repositories', () => ({
  repositoriesApi: {
    list: vi.fn(),
    connect: vi.fn(),
    create: vi.fn(),
    disconnect: vi.fn(),
  },
}))

const repository: RepositoryConnection = {
  id: 'repo-1',
  name: 'Research repo',
  rootPath: 'E:/research-repo',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  environmentPackages: [
    { id: 'numpy', name: 'numpy', ecosystem: 'python', version: '2.0.0' },
    { id: 'ggplot2', name: 'ggplot2', ecosystem: 'r' },
  ],
  environmentProfiles: [
    {
      apiVersion: 'rin.dev/v1',
      kind: 'EnvironmentProfile',
      metadata: { id: 'sci', name: 'Scientific', version: '1.0.0' },
      spec: { packages: ['numpy'] },
    },
  ],
}

describe('RepositoryWorkspace', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.mocked(repositoriesApi.list).mockResolvedValue({ repositories: [repository] })
  })

  it('shows the connected repository packages and environment profiles', async () => {
    render(<RepositoryWorkspace />)

    await waitFor(() => expect(screen.getByText('Research repo')).toBeInTheDocument())
    expect(screen.getAllByText('E:/research-repo').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('numpy').length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByRole('button', { name: 'R' }))
    expect(screen.getByText('ggplot2')).toBeInTheDocument()
    expect(screen.getByText('Scientific')).toBeInTheDocument()
  })

  it('displays the default built-in repository without requiring a manual connect', async () => {
    vi.mocked(repositoriesApi.list).mockResolvedValue({
      repositories: [{
        id: 'built-in',
        name: 'Built-in repository',
        rootPath: '/home/user/packages/domains/assets/builtin',
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z',
        environmentPackages: [],
        environmentProfiles: [],
      }],
    })

    render(<RepositoryWorkspace />)

    await waitFor(() => expect(screen.getByText('Built-in repository')).toBeInTheDocument())
    expect(screen.getByText('0 packages')).toBeInTheDocument()
    expect(repositoriesApi.connect).not.toHaveBeenCalled()
    expect(screen.queryByText('No repository connected')).not.toBeInTheDocument()
  })

  it('keeps the empty state free of the stale "no repository connected" claim', async () => {
    vi.mocked(repositoriesApi.list).mockResolvedValue({ repositories: [] })

    render(<RepositoryWorkspace />)

    await waitFor(() => expect(screen.getByText('No repository to display')).toBeInTheDocument())
    expect(screen.queryByText('No repository connected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect existing folder' })).toBeInTheDocument()
  })
})
