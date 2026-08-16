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
  storage: {
    mode: 'working',
    seedPath: 'E:/Cyberpsychosis/resources/repository',
    workingPath: 'E:/Cyberpsychosis/data/repository',
    seedStatus: 'upgraded',
    localModificationCount: 2,
  },
  manifest: {
    version: 1,
    name: 'Research repo',
    categories: [
      {
        id: 'environment',
        name: 'Environment',
        packages: [
          { id: 'numpy', name: 'numpy', ecosystem: 'python', version: '2.0.0' },
          { id: 'ggplot2', name: 'ggplot2', ecosystem: 'r' },
        ],
      },
      { id: 'tools', name: 'Tools', packages: [] },
      { id: 'knowledge', name: 'Knowledge', packages: [] },
      { id: 'outputs', name: 'Outputs', packages: [] },
    ],
  },
}

describe('RepositoryWorkspace', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.mocked(repositoriesApi.list).mockResolvedValue({ repositories: [repository] })
  })

  it('shows the connected repository and separates environment packages from empty future categories', async () => {
    render(<RepositoryWorkspace />)

    await waitFor(() => expect(screen.getByText('Research repo')).toBeInTheDocument())
    expect(screen.getAllByText('E:/research-repo').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Writable working repository')).toBeInTheDocument()
    expect(screen.getByText('E:/Cyberpsychosis/data/repository')).toBeInTheDocument()
    expect(screen.getByText('2 local changes')).toBeInTheDocument()
    expect(screen.getByText('numpy')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'R' }))
    expect(screen.getByText('ggplot2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tools/ })).toBeInTheDocument()
    expect(screen.queryByText('Ask AI to configure sandbox')).not.toBeInTheDocument()
  })
})
