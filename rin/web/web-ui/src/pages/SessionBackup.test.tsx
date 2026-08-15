import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionBackup } from './SessionBackup'

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    listBackups: vi.fn(),
    getBackupSettings: vi.fn(),
    runBackup: vi.fn(),
    exportSessions: vi.fn(),
    importSessions: vi.fn(),
    restoreBackup: vi.fn(),
    updateBackupSettings: vi.fn(),
  },
}))

import { sessionsApi } from '../api/sessions'
import { useSettingsStore } from '../stores/settingsStore'
const mocked = sessionsApi as unknown as {
  listBackups: ReturnType<typeof vi.fn>
  getBackupSettings: ReturnType<typeof vi.fn>
  runBackup: ReturnType<typeof vi.fn>
  exportSessions: ReturnType<typeof vi.fn>
  restoreBackup: ReturnType<typeof vi.fn>
  updateBackupSettings: ReturnType<typeof vi.fn>
}

describe('SessionBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' as never })
    mocked.listBackups.mockResolvedValue({ backups: [] })
    mocked.getBackupSettings.mockResolvedValue({ settings: { enabled: false, intervalDays: 7, maxKeep: 10 } })
  })

  it('renders empty state', async () => {
    render(<SessionBackup />)
    expect(await screen.findByText(/No backups yet/i)).toBeInTheDocument()
    expect(mocked.listBackups).toHaveBeenCalled()
  })

  it('lists backups with name and size', async () => {
    mocked.listBackups.mockResolvedValue({
      backups: [{ name: 'backup-2026-08-10.cybersession.zip', createdAt: new Date().toISOString(), sizeBytes: 2048 }],
    })
    render(<SessionBackup />)
    expect(await screen.findByText(/backup-2026-08-10\.cybersession\.zip/)).toBeInTheDocument()
    expect(await screen.findByText(/2\.0 KB/)).toBeInTheDocument()
  })

  it('runs a backup on click', async () => {
    mocked.runBackup.mockResolvedValue({ ok: true, backup: { name: 'backup-run.cybersession.zip', createdAt: '', sizeBytes: 1 } })
    render(<SessionBackup />)
    await screen.findByText(/No backups yet/i)
    fireEvent.click(screen.getByText(/Back up now/i))
    await waitFor(() => expect(mocked.runBackup).toHaveBeenCalled())
  })

  it('saves settings', async () => {
    mocked.updateBackupSettings.mockResolvedValue({ settings: { enabled: true, intervalDays: 7, maxKeep: 10 } })
    render(<SessionBackup />)
    await screen.findByText(/No backups yet/i)
    fireEvent.click(screen.getByText(/Save settings/i))
    await waitFor(() =>
      expect(mocked.updateBackupSettings).toHaveBeenCalledWith({
        enabled: true,
        intervalDays: 7,
        maxKeep: 10,
      }),
    )
  })
})