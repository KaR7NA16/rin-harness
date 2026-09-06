import { useCallback, useEffect, useState } from 'react'
import { Brain, Clock, Database, Layers, ShieldAlert } from 'lucide-react'
import type {
  MemoryCurrentField,
  MemoryErasePreviewDto,
  MemoryRepresentationFormDto,
  MemorySceneSummaryDto,
} from '@rin/contracts'
import { memoryApi } from '../api/memory'
import { Button } from '../components/shared/Button'
import { EmptyState } from '../components/shared/EmptyState'
import { PageHeader } from '../components/shared/PageHeader'
import { useTranslation } from '../i18n'

const OWNER_ID = 'rin-owner'

type IntentFeedback = { kind: 'ok' | 'error'; text: string }

/**
 * Memory Center — the unified owner surface over Rin's cognition state.
 *
 * Renders the current field, the scene timeline, recent recall explanations,
 * and the owner controls (corrections, influence restrictions and revocations,
 * and the preview → authorize → commit erase flow). Every control maps to one
 * owner-only intent API.
 */
export function MemoryCenter() {
  const t = useTranslation()
  const [field, setField] = useState<MemoryCurrentField | null>(null)
  const [scenes, setScenes] = useState<MemorySceneSummaryDto[]>([])
  const [recallCycles, setRecallCycles] = useState<Array<{ cycleId: string; createdAt: string; itemCount: number }>>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [eraseRootIds, setEraseRootIds] = useState('')
  const [preview, setPreview] = useState<MemoryErasePreviewDto | null>(null)
  const [correctionId, setCorrectionId] = useState('')
  const [correctionForm, setCorrectionForm] = useState<MemoryRepresentationFormDto>('scene')
  const [correctionData, setCorrectionData] = useState('')
  const [correctionExplanation, setCorrectionExplanation] = useState('')
  const [feedback, setFeedback] = useState<IntentFeedback | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [nextField, nextScenes, nextCycles] = await Promise.all([
      memoryApi.field(),
      memoryApi.scenes(),
      memoryApi.recallCycles(20),
    ])
    setField(nextField)
    setScenes(nextScenes)
    setRecallCycles(nextCycles.map((cycle) => ({
      cycleId: cycle.cycleId,
      createdAt: cycle.createdAt,
      itemCount: cycle.itemCount,
    })))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runIntent = useCallback(async (action: () => Promise<string>) => {
    setBusy(true)
    setFeedback(null)
    try {
      const text = await action()
      setFeedback({ kind: 'ok', text })
      await refresh()
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const loadCorrection = (memoryId: string) => {
    void runIntent(async () => {
      const representation = await memoryApi.representation(memoryId)
      if (representation === null) return t('memoryCenter.notMounted')
      setCorrectionId(String(representation.id))
      setCorrectionForm(representation.form)
      setCorrectionData(JSON.stringify(representation.data, null, 2))
      setCorrectionExplanation('')
      return t('memoryCenter.correction.loaded', { id: String(representation.id) })
    })
  }

  const submitCorrection = () => {
    void runIntent(async () => {
      await memoryApi.correct({
        memoryId: correctionId,
        replacement: { form: correctionForm, data: JSON.parse(correctionData) as Record<string, unknown> },
        explanation: correctionExplanation,
        ownerId: OWNER_ID,
      })
      return t('memoryCenter.correction.done', { id: correctionId })
    })
  }

  const restrictScene = (memoryId: string) => {
    void runIntent(async () => {
      await memoryApi.restrictInfluence({
        memoryId,
        surfaces: ['recall'],
        reason: t('memoryCenter.restrictReason'),
        ownerId: OWNER_ID,
      })
      return t('memoryCenter.restrictDone', { id: memoryId })
    })
  }

  const revokeScene = (memoryId: string) => {
    void runIntent(async () => {
      await memoryApi.revokeInfluence({
        memoryId,
        reason: t('memoryCenter.revokeReason'),
        ownerId: OWNER_ID,
      })
      return t('memoryCenter.revokeDone', { id: memoryId })
    })
  }

  const computePreview = () => {
    const roots = eraseRootIds.split(',').map((id) => id.trim()).filter((id) => id.length > 0)
    if (roots.length === 0) {
      setFeedback({ kind: 'error', text: t('memoryCenter.erase.rootsRequired') })
      return
    }
    void runIntent(async () => {
      const nextPreview = await memoryApi.erasePreview(roots)
      setPreview(nextPreview)
      return nextPreview === null
        ? t('memoryCenter.notMounted')
        : t('memoryCenter.erase.previewDone', {
            erased: nextPreview.erasedMemoryIds.length,
            dependents: nextPreview.dependentMemoryIds.length,
            unaffected: nextPreview.unaffectedMemoryIds.length,
          })
    })
  }

  const authorizeAndCommit = () => {
    if (preview === null) return
    void runIntent(async () => {
      const authorized = await memoryApi.eraseAuthorize({
        rootMemoryIds: [...preview.rootMemoryIds],
        ownerId: OWNER_ID,
      })
      if (authorized === null) return t('memoryCenter.notMounted')
      const committed = await memoryApi.eraseCommit({
        authorizationId: authorized.authorization.authorizationId,
        ownerId: OWNER_ID,
      })
      setPreview(null)
      return committed === null
        ? t('memoryCenter.notMounted')
        : t('memoryCenter.erase.commitDone', { count: committed.erasedMemoryIds.length })
    })
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <PageHeader
        eyebrow={t('memoryCenter.eyebrow')}
        eyebrowIcon={<Brain size={14} />}
        title={t('memoryCenter.title')}
        description={t('memoryCenter.subtitle')}
        actions={(
          <Button size="sm" variant="secondary" onClick={() => void refresh()} loading={busy}>
            {t('common.refresh')}
          </Button>
        )}
      />

      <section aria-label={t('memoryCenter.field.title')} className="rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          <Layers size={16} className="text-[var(--color-signal)]" />
          {t('memoryCenter.field.title')}
        </h2>
        {field === null
          ? <p className="text-[13px] text-[var(--color-text-tertiary)]">{t('memoryCenter.notMounted')}</p>
          : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FieldStat label={t('memoryCenter.field.version')} value={String(field.version)} />
                <FieldStat label={t('memoryCenter.field.scene')} value={field.sceneId ?? t('memoryCenter.common.none')} />
                <FieldStat label={t('memoryCenter.field.openLoops')} value={String(field.activeOpenLoops.length)} />
                <FieldStat label={t('memoryCenter.field.coalition')} value={String(field.activeMemoryCoalition.length)} />
              </div>
            )}
      </section>

      <section aria-label={t('memoryCenter.scenes.title')} className="rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          <Clock size={16} className="text-[var(--color-signal)]" />
          {t('memoryCenter.scenes.title')}
        </h2>
        {scenes.length === 0
          ? (
              <EmptyState
                icon={<Clock size={20} />}
                title={t('memoryCenter.scenes.empty')}
                description={t('memoryCenter.scenes.emptyHint')}
                minHeight={160}
              />
            )
          : (
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
                    <th className="pb-2 pr-3 font-semibold">{t('memoryCenter.scenes.scene')}</th>
                    <th className="pb-2 pr-3 font-semibold">{t('memoryCenter.scenes.status')}</th>
                    <th className="pb-2 pr-3 font-semibold">{t('memoryCenter.scenes.observations')}</th>
                    <th className="pb-2 font-semibold">{t('memoryCenter.scenes.controls')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scenes.map((scene) => (
                    <tr
                      key={scene.id}
                      data-scene-row={scene.id}
                      className={`border-t border-[var(--color-border-separator)] ${selectedSceneId === scene.id ? 'font-semibold' : ''}`}
                      onClick={() => setSelectedSceneId(scene.id)}
                    >
                      <td className="py-2.5 pr-3 font-mono text-[12px]">{scene.id}</td>
                      <td className="py-2.5 pr-3">{scene.status}</td>
                      <td className="py-2.5 pr-3">{scene.observationCount}</td>
                      <td className="py-2.5">
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => loadCorrection(scene.id)} disabled={busy}>
                            {t('memoryCenter.scenes.correct')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => restrictScene(scene.id)} disabled={busy}>
                            {t('memoryCenter.scenes.restrict')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => revokeScene(scene.id)} disabled={busy}>
                            {t('memoryCenter.scenes.revoke')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </section>

      <section aria-label={t('memoryCenter.recall.title')} className="rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          <Database size={16} className="text-[var(--color-signal)]" />
          {t('memoryCenter.recall.title')}
        </h2>
        {recallCycles.length === 0
          ? (
              <EmptyState
                icon={<Database size={20} />}
                title={t('memoryCenter.recall.empty')}
                description={t('memoryCenter.recall.emptyHint')}
                minHeight={160}
              />
            )
          : (
              <ul className="flex flex-col gap-1.5 text-[12.5px]">
                {recallCycles.map((cycle) => (
                  <li key={cycle.cycleId} className="flex items-center gap-3 rounded-[10px] px-3 py-2 hover:bg-[var(--color-surface-hover)]">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--color-text-secondary)]" title={cycle.cycleId}>
                      {cycle.cycleId}
                    </code>
                    <span className="shrink-0 text-[var(--color-text-tertiary)]">
                      {t('memoryCenter.recall.itemCount', { count: cycle.itemCount })}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">
                      {formatTimestamp(cycle.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
      </section>

      <section aria-label={t('memoryCenter.correction.title')} className="rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          <Brain size={16} className="text-[var(--color-signal)]" />
          {t('memoryCenter.correction.title')}
        </h2>
        <p className="mb-3 text-[12.5px] text-[var(--color-text-tertiary)]">{t('memoryCenter.correction.hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t('memoryCenter.correction.idLabel')}
            value={correctionId}
            onChange={(event) => setCorrectionId(event.target.value)}
            placeholder="memory-id"
            className="w-56 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <input
            aria-label={t('memoryCenter.correction.formLabel')}
            value={correctionForm}
            onChange={(event) => setCorrectionForm(event.target.value as MemoryRepresentationFormDto)}
            className="w-44 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <Button size="sm" variant="secondary" onClick={() => selectedSceneId !== null && loadCorrection(selectedSceneId)} disabled={busy || selectedSceneId === null}>
            {t('memoryCenter.correction.loadSelected')}
          </Button>
        </div>
        <textarea
          aria-label={t('memoryCenter.correction.dataLabel')}
          value={correctionData}
          onChange={(event) => setCorrectionData(event.target.value)}
          rows={6}
          placeholder="{}"
          className="mt-2 w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 font-mono text-[12px] text-[var(--color-text-primary)]"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label={t('memoryCenter.correction.explanationLabel')}
            value={correctionExplanation}
            onChange={(event) => setCorrectionExplanation(event.target.value)}
            placeholder={t('memoryCenter.correction.explanationPlaceholder')}
            className="flex-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <Button size="sm" onClick={submitCorrection} disabled={busy || correctionId === '' || correctionData.trim() === ''}>
            {t('memoryCenter.correction.submit')}
          </Button>
        </div>
      </section>

      <section aria-label={t('memoryCenter.erase.title')} className="rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          <ShieldAlert size={16} className="text-[var(--color-danger, #e04040)]" />
          {t('memoryCenter.erase.title')}
        </h2>
        <p className="mb-3 text-[12.5px] text-[var(--color-text-tertiary)]">{t('memoryCenter.erase.hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t('memoryCenter.erase.rootsLabel')}
            value={eraseRootIds}
            onChange={(event) => setEraseRootIds(event.target.value)}
            placeholder="memory-id, memory-id"
            className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <Button size="sm" variant="secondary" onClick={computePreview} disabled={busy}>
            {t('memoryCenter.erase.preview')}
          </Button>
          <Button size="sm" variant="danger" onClick={authorizeAndCommit} disabled={busy || preview === null}>
            {t('memoryCenter.erase.commit')}
          </Button>
        </div>
        {preview !== null && (
          <div className="mt-3 rounded-[10px] bg-[var(--color-surface-container-low)] p-3 text-[12.5px]" data-erase-preview="true">
            <p><span className="text-[var(--color-text-tertiary)]">{t('memoryCenter.erase.erased')}:</span> {preview.erasedMemoryIds.join(', ')}</p>
            <p><span className="text-[var(--color-text-tertiary)]">{t('memoryCenter.erase.dependents')}:</span> {preview.dependentMemoryIds.join(', ') || t('memoryCenter.common.none')}</p>
            <p><span className="text-[var(--color-text-tertiary)]">{t('memoryCenter.erase.unaffected')}:</span> {preview.unaffectedMemoryIds.length}</p>
            <p><span className="text-[var(--color-text-tertiary)]">{t('memoryCenter.erase.retracted')}:</span> {preview.retractedLinkIds.length}</p>
          </div>
        )}
      </section>

      {feedback !== null && (
        <p role="status" className={`text-[12.5px] ${feedback.kind === 'ok' ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-error)]'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  )
}

function FieldStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--color-surface-container-low)] px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{label}</div>
      <div className="mt-1 truncate text-[14px] font-semibold text-[var(--color-text-primary)]" title={value}>{value}</div>
    </div>
  )
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export default MemoryCenter
