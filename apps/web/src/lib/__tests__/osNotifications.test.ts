import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../desktopRuntime', () => ({
  isTauriRuntime: () => true,
}))

import { invoke } from '@tauri-apps/api/core'
import { notifyWhenUnfocused } from '../osNotifications'

const mockedInvoke = vi.mocked(invoke)

describe('notifyWhenUnfocused', () => {
  beforeEach(() => {
    mockedInvoke.mockResolvedValue(undefined)
  })

  afterEach(() => {
    mockedInvoke.mockClear()
    vi.restoreAllMocks()
  })

  it('sends a notification when the window is unfocused', async () => {
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
    await notifyWhenUnfocused('Title', 'Body')
    expect(mockedInvoke).toHaveBeenCalledTimes(1)
    expect(mockedInvoke).toHaveBeenCalledWith('show_notification', {
      title: 'Title',
      body: 'Body',
    })
  })

  it('does nothing when the window is focused', async () => {
    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true })
    await notifyWhenUnfocused('Title', 'Body')
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('deduplicates identical keys within the dedup window', async () => {
    Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true })
    await notifyWhenUnfocused('Title', 'Body', 'key:1')
    await notifyWhenUnfocused('Title', 'Body', 'key:1')
    expect(mockedInvoke).toHaveBeenCalledTimes(1)
  })
})