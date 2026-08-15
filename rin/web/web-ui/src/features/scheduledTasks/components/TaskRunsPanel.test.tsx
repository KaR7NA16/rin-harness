import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const { getTaskRunsMock } = vi.hoisted(() => ({
  getTaskRunsMock: vi.fn(),
}))

vi.mock('../tasksClient', () => ({
  tasksApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    runTask: vi.fn(),
    getRecentRuns: vi.fn(),
    getTaskRuns: getTaskRunsMock,
  },
}))

import { TaskRunsPanel } from './TaskRunsPanel'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { TaskRun } from '../taskTypes'

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    taskName: 'Nightly backup',
    startedAt: '2026-08-05T09:00:00.000Z',
    completedAt: '2026-08-05T09:00:05.000Z',
    status: 'completed',
    prompt: 'Do the backup',
    durationMs: 5000,
    ...overrides,
  }
}

function renderPanel() {
  return render(<TaskRunsPanel taskId="task-1" onClose={vi.fn()} refreshKey={0} />)
}

describe('TaskRunsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
  })

  it('shows the empty state when there are no runs', async () => {
    getTaskRunsMock.mockResolvedValue({ runs: [] })

    renderPanel()

    expect(await screen.findByText('No execution logs yet')).toBeInTheDocument()
    expect(getTaskRunsMock).toHaveBeenCalledWith('task-1')
  })

  it('shows the load failure state and retries on click', async () => {
    getTaskRunsMock.mockRejectedValueOnce(new Error('network down'))

    renderPanel()

    expect(await screen.findByText('Failed to load execution logs')).toBeInTheDocument()

    getTaskRunsMock.mockResolvedValue({ runs: [makeRun()] })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(getTaskRunsMock).toHaveBeenCalledTimes(2)
  })

  it('renders status, duration, and output rows for each run', async () => {
    getTaskRunsMock.mockResolvedValue({
      runs: [
        makeRun({ output: 'Backup finished successfully' }),
        makeRun({
          id: 'run-2',
          status: 'failed',
          error: 'disk full',
          durationMs: undefined,
          sessionId: undefined,
        }),
      ],
    })

    renderPanel()

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('5s')).toBeInTheDocument()

    // Output is collapsed until the summary toggle is clicked
    expect(screen.queryByText('Backup finished successfully')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Summary' })[0]!)
    expect(await screen.findByText('Backup finished successfully')).toBeInTheDocument()

    // Error runs render their error in the expanded view (the first toggle
    // now reads "Hide", so the remaining "Summary" belongs to the failed run)
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
  })

  it('offers opening the conversation for completed runs with a session', async () => {
    getTaskRunsMock.mockResolvedValue({ runs: [makeRun({ sessionId: 'session-9' })] })

    renderPanel()

    expect(await screen.findByRole('button', { name: 'View conversation' })).toBeInTheDocument()
  })
})
