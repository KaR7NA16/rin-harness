import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { getRecentProjectsMock } = vi.hoisted(() => ({
  getRecentProjectsMock: vi.fn(),
}))

vi.mock('../../api/sessions', async () => {
  const actual = await vi.importActual<typeof import('../../api/sessions')>('../../api/sessions')
  return {
    ...actual,
    sessionsApi: {
      ...actual.sessionsApi,
      getRecentProjects: getRecentProjectsMock,
    },
  }
})

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.allProjects': 'All projects',
      'sidebar.temporarySessions': 'Temporary sessions',
      'sidebar.other': 'Other',
      'sidebar.noSessions': 'No sessions',
      'common.loading': 'Loading',
    }

    return translations[key] ?? key
  },
}))

import { useSessionStore } from '../../stores/sessionStore'
import { ProjectFilter } from './ProjectFilter'

describe('ProjectFilter', () => {
  beforeEach(() => {
    getRecentProjectsMock.mockReset()
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      selectedSessionScope: 'all',
      projectDisplayNames: {},
      availableProjects: [
        'Users-dev-workspace-myself_code-OpenCutSkill',
        'Users-dev-workspace-myself_code-demo-repo',
      ],
    })
  })

  it('renders recent project metadata instead of bare fallback folder names', async () => {
    getRecentProjectsMock.mockResolvedValue({
      projects: [
        {
          projectPath: 'Users-dev-workspace-myself_code-demo-repo',
          realPath: '/path/to/demo-repo',
          projectName: 'demo-repo',
          isGit: true,
          repoName: 'example-user/demo-repo',
          branch: 'main',
          modifiedAt: '2026-04-20T10:00:00.000Z',
          sessionCount: 4,
        },
        {
          projectPath: 'Users-dev-workspace-myself_code-OpenCutSkill',
          realPath: '/Users/dev/workspace/myself_code/OpenCutSkill',
          projectName: 'OpenCutSkill',
          isGit: true,
          repoName: 'example-user/OpenCutSkill',
          branch: 'main',
          modifiedAt: '2026-04-20T09:00:00.000Z',
          sessionCount: 2,
        },
      ],
    })

    render(<ProjectFilter />)

    fireEvent.click(screen.getByRole('button', { name: /All projects/i }))

    await waitFor(() => {
      expect(screen.getByText('example-user/demo-repo')).toBeInTheDocument()
      expect(screen.queryByText('/path/to/demo-repo')).not.toBeInTheDocument()
      expect(screen.getByText('example-user/OpenCutSkill')).toBeInTheDocument()
    })

    const demoRepoProject = screen.getByRole('button', { name: /example-user\/demo-repo/i })
    expect(demoRepoProject).toHaveAttribute('title', '/path/to/demo-repo')
    fireEvent.click(demoRepoProject)

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual(['Users-dev-workspace-myself_code-demo-repo'])
      expect(useSessionStore.getState().selectedSessionScope).toBe('project')
    })

    act(() => {
      useSessionStore.getState().renameProject(
        'Users-dev-workspace-myself_code-demo-repo',
        'Demo Workspace',
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Demo Workspace/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Demo Workspace/i }))
    fireEvent.click(screen.getByRole('button', { name: /example-user\/OpenCutSkill/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual(['Users-dev-workspace-myself_code-OpenCutSkill'])
      expect(useSessionStore.getState().selectedSessionScope).toBe('project')
    })

    fireEvent.click(screen.getByRole('button', { name: /example-user\/OpenCutSkill/i }))
    fireEvent.click(screen.getByRole('button', { name: /Temporary sessions/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual([])
      expect(useSessionStore.getState().selectedSessionScope).toBe('temporary')
    })

    fireEvent.click(screen.getByRole('button', { name: /Temporary sessions/i }))
    fireEvent.click(screen.getByRole('button', { name: /All projects/i }))

    await waitFor(() => {
      expect(useSessionStore.getState().selectedProjects).toEqual([])
      expect(useSessionStore.getState().selectedSessionScope).toBe('all')
    })
  })
})
