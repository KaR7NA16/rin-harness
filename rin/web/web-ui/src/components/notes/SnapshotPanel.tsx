import { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import { notesApi, type NoteSnapshot } from '../../api/notes'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'

export function SnapshotPanel({
  path,
  onRestore,
  onChanged,
}: {
  path: string
  onRestore: () => void
  onChanged: () => void
}) {
  const t = useTranslation()
  const addToast = useUIStore(s => s.addToast)
  const locale = useSettingsStore(s => s.locale)
  const [snapshots, setSnapshots] = useState<NoteSnapshot[]>([])
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    void notesApi.snapshots(path).then(r => setSnapshots(r.snapshots)).catch(() => {})
    const timer = setInterval(() => {
      void notesApi.snapshots(path).then(r => setSnapshots(r.snapshots)).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [path])

  const confirmRestore = async () => {
    const id = pendingRestoreId
    if (!id) return
    setIsRestoring(true)
    try {
      const { content } = await notesApi.readSnapshot(path, id)
      await notesApi.write(path, content)
      onRestore()
      onChanged()
      setPendingRestoreId(null)
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setIsRestoring(false)
    }
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-[20px] text-[12px] text-[var(--color-text-tertiary)]">
        <History size={18} />
        {t('notes.noSnapshots')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {snapshots.map(snap => (
        <div key={snap.id} className="flex items-center justify-between rounded-[7px] px-[8px] py-[6px] hover:bg-[var(--color-surface-hover)]">
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {new Date(snap.createdAt).toLocaleString(locale)}
          </span>
          <button
            onClick={() => setPendingRestoreId(snap.id)}
            title={t('notes.restore')}
            className="rounded-[6px] p-[4px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      ))}
      <ConfirmDialog
        open={pendingRestoreId !== null}
        onClose={() => {
          if (!isRestoring) setPendingRestoreId(null)
        }}
        onConfirm={() => void confirmRestore()}
        title={t('notes.restore')}
        body={t('notes.restoreConfirm')}
        confirmLabel={t('notes.restore')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isRestoring}
      />
    </div>
  )
}
