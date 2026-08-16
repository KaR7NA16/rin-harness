import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import type { UIMessage } from '../../types/chat'
import { collectSessionDiffs } from '../../utils/sessionReview'
import { SuspendedDiffViewer } from './lazyRenderers'
import { Icon } from '../shared/Icon'

type Props = {
  messages: UIMessage[]
  onClose: () => void
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export function SessionReviewView({ messages, onClose }: Props) {
  const t = useTranslation()
  const summary = useMemo(() => collectSessionDiffs(messages), [messages])
  const [expandedPath, setExpandedPath] = useState<string | null>(null)

  useEffect(() => {
    if (summary.files.length === 0) return
    if (!expandedPath || !summary.files.some((file) => file.filePath === expandedPath)) {
      setExpandedPath(summary.files[0]?.filePath ?? null)
    }
  }, [summary.files, expandedPath])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const expandedFile = summary.files.find((file) => file.filePath === expandedPath) ?? null

  return createPortal(    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('review.title')}
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-hidden bg-[rgba(0,0,0,0.4)] p-[24px] pt-[48px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[calc(100vh-96px)] w-full max-w-[980px] flex-col overflow-hidden rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[20px] py-[14px]">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {summary.files.length > 0
                ? t('review.titleWithCount', { count: summary.files.length })
                : t('review.title')}
            </h2>
            {summary.files.length > 0 && (
              <p className="mt-[2px] text-[12px] text-[var(--color-text-tertiary)]">
                <span className="font-medium text-[var(--color-success)]">+{summary.totalInsertions}</span>
                {'  '}
                <span className="font-medium text-[var(--color-error)]">-{summary.totalDeletions}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* File list */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[var(--color-border-separator)] bg-[var(--color-background)]">
            {summary.files.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-[12px] px-[24px] text-center">
                <Icon name="check_circle" size={22} className="text-[var(--color-text-tertiary)]" />
                <p className="text-[13px] text-[var(--color-text-tertiary)]">{t('review.empty')}</p>
              </div>
            ) : (
              <ul>
                {summary.files.map((file) => (
                  <li key={file.filePath}>
                    <button
                      type="button"
                      onClick={() => setExpandedPath(file.filePath)}
                      className={`flex w-full flex-col gap-[2px] px-[16px] py-[10px] text-left transition-colors ${
                        file.filePath === expandedPath
                          ? 'bg-[var(--color-surface-container-high)]'
                          : 'hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <span className="truncate font-mono text-[12px] text-[var(--color-text-primary)]">
                        {fileName(file.filePath)}
                      </span>
                      <span className="flex items-center gap-[10px] text-[11px]">
                        <span className="truncate text-[var(--color-text-tertiary)]">{file.filePath}</span>
                        {file.editCount > 1 && (
                          <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-[6px] py-[1px] text-[10px] text-[var(--color-text-secondary)]">
                            {file.editCount}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Diff detail */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-[var(--color-background)] p-[20px]">
            {expandedFile ? (
              <div className="space-y-[24px]">
                {expandedFile.edits.map((edit, index) => (
                  <div key={`${edit.seq}-${index}`}>
                    <div className="mb-[6px] flex items-center gap-[8px]">
                      <span
                        className={`inline-flex items-center gap-[4px] rounded-full px-[8px] py-[1px] text-[10px] font-medium ${
                          edit.toolName === 'Write'
                            ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                            : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {edit.toolName === 'Write' ? t('review.newFile') : t('review.edit')}
                        {expandedFile.editCount > 1 && ` ${index + 1}/${expandedFile.editCount}`}
                      </span>
                    </div>
                    <SuspendedDiffViewer
                      filePath={expandedFile.filePath}
                      oldString={edit.oldString}
                      newString={edit.newString}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
                {summary.files.length === 0 ? '' : t('review.selectFile')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}