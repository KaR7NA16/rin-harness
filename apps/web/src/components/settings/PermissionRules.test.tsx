import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const {
  getRulesMock,
  addRuleMock,
  deleteRuleMock,
} = vi.hoisted(() => ({
  getRulesMock: vi.fn(),
  addRuleMock: vi.fn(),
  deleteRuleMock: vi.fn(),
}))

vi.mock('../../api/settings', () => ({
  settingsApi: {
    getPermissionMode: vi.fn(),
    setPermissionMode: vi.fn(),
    getPermissionRules: getRulesMock,
    addPermissionRule: addRuleMock,
    deletePermissionRule: deleteRuleMock,
    getUser: vi.fn(),
    updateUser: vi.fn(),
    getCliLauncherStatus: vi.fn(),
  },
}))

vi.mock('../../stores/uiStore', async () => ({
  useUIStore: {
    getState: () => ({
      addToast: vi.fn(),
    }),
  },
}))

import { PermissionRules } from './PermissionRules'
import { useSettingsStore } from '../../stores/settingsStore'

describe('PermissionRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    getRulesMock.mockResolvedValue({ rules: [] })
    addRuleMock.mockResolvedValue({ ok: true })
    deleteRuleMock.mockResolvedValue({ ok: true })
  })

  it('renders the empty state when no rules exist', async () => {
    render(<PermissionRules />)
    await waitFor(() => {
      expect(screen.getByText('No persisted permission rules yet.')).toBeInTheDocument()
    })
  })

  it('renders persisted rules with allow/deny actions', async () => {
    getRulesMock.mockResolvedValue({
      rules: [
        {
          source: 'userSettings',
          behavior: 'allow',
          ruleString: 'Bash(npm test)',
          toolName: 'Bash',
          ruleContent: 'npm test',
        },
        {
          source: 'localSettings',
          behavior: 'deny',
          ruleString: 'Read(/tmp/**)',
          toolName: 'Read',
          ruleContent: '/tmp/**',
        },
      ],
    })
    render(<PermissionRules />)
    await waitFor(() => {
      expect(screen.getByText('Bash(npm test)')).toBeInTheDocument()
      expect(screen.getByText('Read(/tmp/**)')).toBeInTheDocument()
    })
  })

  it('opens the add form and submits a new rule', async () => {
    render(<PermissionRules />)
    await waitFor(() => {
      expect(screen.getByText('No persisted permission rules yet.')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add rule'))
    fireEvent.change(screen.getByPlaceholderText('Tool (e.g. Bash)'), {
      target: { value: 'Bash' },
    })
    fireEvent.change(screen.getByPlaceholderText('Content (e.g. npm test) — optional'), {
      target: { value: 'npm test' },
    })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => {
      expect(addRuleMock).toHaveBeenCalledWith({
        toolName: 'Bash',
        ruleContent: 'npm test',
        behavior: 'allow',
        source: 'userSettings',
      })
    })
  })

  it('deletes a rule when the × button is clicked', async () => {
    getRulesMock.mockResolvedValue({
      rules: [
        {
          source: 'userSettings',
          behavior: 'allow',
          ruleString: 'Bash(npm test)',
          toolName: 'Bash',
          ruleContent: 'npm test',
        },
      ],
    })
    render(<PermissionRules />)
    await waitFor(() => {
      expect(screen.getByText('Bash(npm test)')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete rule'))
    await waitFor(() => {
      expect(deleteRuleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'userSettings',
          behavior: 'allow',
          toolName: 'Bash',
          ruleContent: 'npm test',
        }),
      )
    })
  })
})