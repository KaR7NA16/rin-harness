import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
    isConnected: vi.fn(() => true),
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('../../stores/teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: vi.fn(() => null),
      sendMessageToMember: vi.fn(async () => {}),
      handleTeamCreated: vi.fn(),
      handleTeamUpdate: vi.fn(),
      handleTeamDeleted: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      updateTabStatus: vi.fn(),
      updateTabTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      updateSessionTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/cliTaskStore', () => ({
  useCLITaskStore: {
    getState: () => ({
      fetchSessionTasks: vi.fn(),
      tasks: [],
      clearTasks: vi.fn(),
      setTasksFromTodos: vi.fn(),
      markCompletedAndDismissed: vi.fn(),
      resetCompletedTasks: vi.fn(async () => {}),
      refreshTasks: vi.fn(),
    }),
  },
}))

import { useChatStore } from '../../stores/chatStore'
import { ComputerUsePermissionModal } from './ComputerUsePermissionModal'

describe('ComputerUsePermissionModal', () => {
  beforeEach(() => {
    sendMock.mockReset()
    useChatStore.setState({ sessions: {} })
  })

  it('returns a full approval payload for resolved apps and requested flags', () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={{
          requestId: 'cu-1',
          reason: 'Open Finder and inspect a file',
          apps: [
            {
              requestedName: 'Finder',
              resolved: {
                bundleId: 'com.apple.finder',
                displayName: 'Finder',
              },
              isSentinel: false,
              alreadyGranted: false,
              proposedTier: 'full',
            },
            {
              requestedName: 'Missing App',
              isSentinel: false,
              alreadyGranted: false,
              proposedTier: 'full',
            },
          ],
          requestedFlags: {
            clipboardRead: true,
            systemKeyCombos: true,
          },
          screenshotFiltering: 'native',
          willHide: [{ bundleId: 'com.apple.TextEdit', displayName: 'TextEdit' }],
          autoUnhideEnabled: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /本次会话允许|Allow for session/ }))

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [
          expect.objectContaining({
            bundleId: 'com.apple.finder',
            displayName: 'Finder',
            tier: 'full',
          }),
        ],
        denied: [
          {
            bundleId: 'Missing App',
            reason: 'not_installed',
          },
        ],
        flags: {
          clipboardRead: true,
          clipboardWrite: false,
          systemKeyCombos: true,
        },
        userConsented: true,
      },
    })
  })

  it('renders macOS permission states without OS settings buttons', () => {
    render(
      <ComputerUsePermissionModal
        sessionId="session-1"
        request={{
          requestId: 'cu-1',
          reason: '',
          apps: [],
          requestedFlags: {},
          screenshotFiltering: 'native',
          tccState: {
            accessibility: false,
            screenRecording: true,
          },
        }}
      />,
    )

    expect(screen.queryByText(/Open Accessibility/)).toBeNull()
    expect(screen.queryByText(/Open Screen Recording/)).toBeNull()
  })
})
