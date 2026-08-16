import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  Download,
  FileUp,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react'
import { sessionsApi, type BackupListEntry, type SessionBackupSettings } from '../api/sessions'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { Button } from '../components/shared/Button'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { SettingsPage } from '../components/settings/SettingsLayout'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString()
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function SessionBackup({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)

  const [backups, setBackups] = useState<BackupListEntry[]>([])
  const [settings, setSettings] = useState<SessionBackupSettings>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [draftInterval, setDraftInterval] = useState('7')
  const [draftMaxKeep, setDraftMaxKeep] = useState('10')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [{ backups: list }, { settings: s }] = await Promise.all([
        sessionsApi.listBackups(),
        sessionsApi.getBackupSettings().catch(() => ({ settings: {} as SessionBackupSettings })),
      ])
      setBackups(list)
      setSettings(s)
      setDraftInterval(String(s.intervalDays ?? 7))
      setDraftMaxKeep(String(s.maxKeep ?? 10))
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy !== null
  }, [busy])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (!busyRef.current) void refresh()
    }, 15000)
    return () => clearInterval(timer)
  }, [refresh])

  const runBackup = useCallback(async () => {
    setBusy('run')
    try {
      const res = await sessionsApi.runBackup()
      addToast({
        type: 'success',
        message: t('backup.created', { name: res.backup.name }),
      })
      await refresh()
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, refresh, t])

  const exportAll = useCallback(async () => {
    setBusy('export')
    try {
      const blob = await sessionsApi.exportSessions({ includeAgentNotes: true })
      downloadBlob(blob, `rin-sessions-${new Date().toISOString().slice(0, 10)}.rinbackup.gz`)
      addToast({ type: 'success', message: t('backup.exported') })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, t])

  const onPickFile = useCallback(async (file?: File | null) => {
    if (!file) return
    setBusy('import')
    try {
      const result = await sessionsApi.importSessions(file)
      addToast({
        type: 'success',
        message: t('backup.imported', { imported: String(result.imported), skipped: String(result.skipped) }),
      })
      await refresh()
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [addToast, refresh, t])

  const confirmRestore = useCallback(async (name: string) => {
    setBusy(`restore:${name}`)
    try {
      const result = await sessionsApi.restoreBackup(name)
      addToast({
        type: 'success',
        message: t('backup.restored', { imported: String(result.imported) }),
      })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
      setRestoreName(null)
    }
  }, [addToast, t])

  const saveSettings = useCallback(async () => {
    setBusy('settings')
    try {
      const intervalDays = Math.max(1, Number(draftInterval) || 7)
      const maxKeep = Math.max(1, Number(draftMaxKeep) || 10)
      const next = await sessionsApi.updateBackupSettings({
        enabled: true,
        intervalDays,
        maxKeep,
      })
      setSettings(next.settings)
      addToast({ type: 'success', message: t('backup.settingsSaved') })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, draftInterval, draftMaxKeep, t])

  const toggleEnabled = useCallback(async () => {
    setBusy('toggle')
    try {
      const next = await sessionsApi.updateBackupSettings({ enabled: !settings.enabled })
      setSettings(next.settings)
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, settings.enabled, t])

  if (loading) {
    const spinner = <div className="flex min-h-[180px] items-center justify-center"><LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={26} /></div>
    return embedded
      ? <SettingsPage title={t('backup.title')} description={t('backup.subtitle')} saveMode="form">{spinner}</SettingsPage>
      : <div className="flex h-full items-center justify-center">{spinner}</div>
  }

  const pageContent = (
    <div className="flex flex-col gap-[16px]">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{t('backup.title')}</h1>
            <p className="mt-[2px] text-[12px] text-[var(--color-text-tertiary)]">{t('backup.subtitle')}</p>
          </div>
        </div>
      )}

        {/* 自动备份设置 */}
        <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]" data-setting-id="data.sessionBackup">
          <div className="flex items-center gap-[10px]">
            <Archive size={17} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{t('backup.autoTitle')}</span>
            <label className="ml-2 flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={settings.enabled === true}
                onChange={() => void toggleEnabled()}
                disabled={busy === 'toggle'}
              />
              {t('backup.enabled')}
            </label>
            {busy === 'toggle' && <LoaderCircle size={14} className="animate-spin text-[var(--color-text-tertiary)]" />}
          </div>
          <div className="mt-[12px] flex flex-wrap items-end gap-[12px]">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-[var(--color-text-primary)]">{t('backup.intervalDays')}</span>
              <input
                type="number"
                min={1}
                value={draftInterval}
                onChange={(e) => setDraftInterval(e.target.value)}
                className="w-[110px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] py-[7px] text-[13px] outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-[var(--color-text-primary)]">{t('backup.maxKeep')}</span>
              <input
                type="number"
                min={1}
                value={draftMaxKeep}
                onChange={(e) => setDraftMaxKeep(e.target.value)}
                className="w-[110px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] py-[7px] text-[13px] outline-none"
              />
            </label>
            <Button size="sm" disabled={busy !== null} onClick={() => void saveSettings()}>
              {busy === 'settings' ? <LoaderCircle size={14} className="mr-1 animate-spin" /> : null}
              {t('backup.saveSettings')}
            </Button>
          </div>
          {settings.enabled && (
            <p className="mt-[8px] text-[12px] text-[var(--color-text-tertiary)]">
              {t('backup.autoHint', { interval: String(settings.intervalDays ?? 7), keep: String(settings.maxKeep ?? 10) })}
            </p>
          )}
        </div>

        {/* 操作区 */}
        <div className="flex flex-wrap gap-[8px]">
          <Button disabled={busy !== null} onClick={() => void runBackup()}>
            {busy === 'run' ? <LoaderCircle size={14} className="mr-1 animate-spin" /> : <Archive size={14} className="mr-1" />}
            {t('backup.runNow')}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => void exportAll()}>
            {busy === 'export' ? <LoaderCircle size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />}
            {t('backup.exportAll')}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
            {busy === 'import' ? <LoaderCircle size={14} className="mr-1 animate-spin" /> : <FileUp size={14} className="mr-1" />}
            {t('backup.import')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".rinbackup.gz,.gz,application/gzip"
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </div>

        {/* 备份列表 */}
        <div>
          <div className="mb-[8px] flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('backup.listTitle')}</span>
            <span className="text-[12px] text-[var(--color-text-tertiary)]">{backups.length}</span>
          </div>
          {backups.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--color-border)] py-[32px] text-center text-[13px] text-[var(--color-text-tertiary)]">
              {t('backup.empty')}
            </div>
          ) : (
            <div className="flex flex-col gap-[8px]">
              {backups.map((b) => (
                <div key={b.name} className="flex items-center gap-[10px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[14px] py-[10px]">
                  <Archive size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] text-[var(--color-text-primary)]">{b.name}</div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)]">{formatDate(b.createdAt)} · {formatBytes(b.sizeBytes)}</div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setRestoreName(b.name)}>
                    <RotateCcw size={13} className="mr-1" />{t('backup.restore')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      <ConfirmDialog
        open={restoreName !== null}
        onClose={() => setRestoreName(null)}
        onConfirm={async () => {
          if (restoreName) await confirmRestore(restoreName)
        }}
        title={t('backup.restoreConfirmTitle')}
        body={t('backup.restoreConfirmBody', { name: restoreName ?? '' })}
        confirmLabel={t('backup.restore')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={restoreName !== null && busy === `restore:${restoreName}`}
      />
    </div>
  )

  return embedded ? (
    <SettingsPage title={t('backup.title')} description={t('backup.subtitle')} saveMode="form">
      {pageContent}
    </SettingsPage>
  ) : (
    <div className="h-full overflow-y-auto p-[24px]">
      <div className="mx-auto flex max-w-[820px] flex-col gap-[16px]">{pageContent}</div>
    </div>
  )
}
