import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { createMock, updateMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('../tasksClient', () => ({
  tasksApi: {
    list: vi.fn(),
    create: createMock,
    update: updateMock,
    delete: vi.fn(),
    runTask: vi.fn(),
    getRecentRuns: vi.fn(),
    getTaskRuns: vi.fn(),
  },
}))

vi.mock('../../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(async () => ({})),
    updateConfig: vi.fn(),
    generatePairingCode: vi.fn(),
    removePairedUser: vi.fn(),
  },
}))

// PromptEditor pulls in ModelSelector / DirectoryPicker (Tauri); replace it
// with a bare textarea so the modal's own logic is what gets tested.
vi.mock('./PromptEditor', () => ({
  PromptEditor: ({ value, onChange, placeholder }: {
    value: string
    onChange: (v: string) => void
    placeholder?: string
  }) => (
    <textarea
      aria-label="Prompt"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

import { NewTaskModal } from './NewTaskModal'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useSessionStore } from '../../../stores/sessionStore'

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'My task' } })
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Does things' } })
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Run the thing' } })
}

describe('NewTaskModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({ sessions: [], activeSessionId: null })
    createMock.mockImplementation(async (input: Record<string, unknown>) => ({
      task: { id: 'task-1', createdAt: 1, enabled: true, ...input },
    }))
  })

  it('submits a daily task with the correct cron expression', async () => {
    const onClose = vi.fn()
    render(<NewTaskModal open onClose={onClose} />)

    fillRequiredFields()
    fireEvent.change(document.querySelector('input[type="time"]')!, {
      target: { value: '10:30' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My task',
        description: 'Does things',
        prompt: 'Run the thing',
        cron: '30 10 * * *',
        enabled: true,
        recurring: true,
      }),
    )
  })

  it('builds weekday and specific-day cron expressions', async () => {
    const onClose = vi.fn()
    render(<NewTaskModal open onClose={onClose} />)

    fillRequiredFields()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'specificDays' } })

    // Default selection is Monday; add Wednesday and Friday
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }))

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ cron: '0 9 * * 1,3,5' }),
    )
  })

  it('cannot be submitted after the time input is cleared (NaN cron guard)', () => {
    render(<NewTaskModal open onClose={vi.fn()} />)

    fillRequiredFields()
    const submit = screen.getByRole('button', { name: 'Create task' })
    expect(submit).toBeEnabled()

    fireEvent.change(document.querySelector('input[type="time"]')!, {
      target: { value: '' },
    })

    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('blocks submission when required fields are empty', () => {
    render(<NewTaskModal open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled()
    expect(createMock).not.toHaveBeenCalled()
  })
})
