import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adaptersApi } from '../api/adapters'
import { useSettingsStore } from '../stores/settingsStore'
import { useAdapterStore } from '../stores/adapterStore'
import { AdapterSettings } from './AdapterSettings'

vi.mock('../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  },
}))

describe('AdapterSettings', () => {
  beforeEach(() => {
    vi.mocked(adaptersApi.getConfig).mockResolvedValue({})
    vi.mocked(adaptersApi.updateConfig).mockResolvedValue({})
    useSettingsStore.setState({ locale: 'zh' })
    useAdapterStore.setState({
      config: {},
      isLoading: false,
      error: null,
    })
  })

  it('shows one full setup guide entry for each IM platform', async () => {
    render(<AdapterSettings />)

    expect((await screen.findAllByText('飞书接入教程')).length).toBe(1)
    expect(screen.getAllByRole('button', { name: '查看完整接入教程' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
    expect((await screen.findAllByText('Telegram 接入教程')).length).toBe(1)
    expect(screen.getAllByRole('button', { name: '查看完整接入教程' })).toHaveLength(1)
  })

  it('opens the Telegram full setup guide from the visible button', async () => {
    render(<AdapterSettings />)

    await screen.findByText('飞书接入教程')
    fireEvent.click(screen.getByRole('button', { name: 'Telegram' }))
    await screen.findByText('Telegram 接入教程')
    fireEvent.click(screen.getByRole('button', { name: '查看完整接入教程' }))

    expect(
      screen.getByRole('dialog', { name: 'Telegram 连接教程' }),
    ).toBeInTheDocument()
  })
})
