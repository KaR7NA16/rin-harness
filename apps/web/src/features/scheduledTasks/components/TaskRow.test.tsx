import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { deleteMock, updateMock, runMock, getTaskRunsMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  updateMock: vi.fn(),
  runMock: vi.fn(),
  getTaskRunsMock: vi.fn(),
}))

vi.mock('../tasksClient', () => ({
  tasksApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: updateMock,
    delete: deleteMock,
    runTask: runMock,
    getRecentRuns: vi.fn(),
    getTaskRuns: getTaskRunsMock,
  },
}))

import { TaskRow } from './TaskRow'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useUIStore } from '../../../stores/uiStore'
import type { CronTask } from '../taskTypes'

function makeTask(overrides: Partial<CronTask> = {}): CronTask {
  return {
    id: 'task-1',
    name: 'Nightly backup',
    description: 'Backs up the vault',
    cron: '0 9 * * *',
    prompt: 'Do the backup',
    enabled: true,
    createdAt: 1700000000000,
    ...overrides,
  }
}

describe('TaskRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ toasts: [] })
  })

  it('renders the task name and an enabled status dot', () => {
    const { container } = render(
      <TaskRow task={makeTask()} showLogs={false} onToggleLogs={vi.fn()} />,
    )

    expect(screen.getByText('Nightly backup')).toBeInTheDocument()
    const dot = container.querySelector('span.w-2.h-2.rounded-full')
    expect(dot?.className).toContain('bg-[var(--color-success)]')
  })

  it('renders a gray status dot for disabled tasks', () => {
    const { container } = render(
      <TaskRow task={makeTask({ enabled: false })} showLogs={false} onToggleLogs={vi.fn()} />,
    )

    const dot = container.querySelector('span.w-2.h-2.rounded-full')
    expect(dot?.className).toContain('bg-[var(--color-text-tertiary)]')
  })

  it('disables the run button on a disabled task', () => {
    const { container } = render(
      <TaskRow task={makeTask({ enabled: false })} showLogs={false} onToggleLogs={vi.fn()} />,
    )

    const buttons = [...container.querySelectorAll('button')]
    const runButton = buttons.find((b) => b.className.includes('cursor-not-allowed'))
    expect(runButton).toBeDefined()
    expect(runButton).toBeDisabled()
  })

  it('deletes the task after confirming in the popover', async () => {
    deleteMock.mockResolvedValue({ ok: true })
    render(<TaskRow task={makeTask()} showLogs={false} onToggleLogs={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    // Confirm popover appears; the store is not called yet
    expect(screen.getByText('Permanently delete this task and all its logs?')).toBeInTheDocument()
    expect(deleteMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('task-1'))
  })

  it('shows an error toast when deletion fails', async () => {
    const addToast = vi.fn()
    useUIStore.setState({ addToast })
    deleteMock.mockRejectedValue(new Error('server exploded'))

    render(<TaskRow task={makeTask()} showLogs={false} onToggleLogs={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'server exploded' }),
    )
  })
})
