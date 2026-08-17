import { useEffect, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { filesystemApi, type FileStat, type TextFileRead } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import { Modal } from './Modal'

type Props = {
  open: boolean
  file: FileStat | null
  onClose: () => void
}

const TEXT_PREVIEW_BYTES = 256 * 1024

function isTextPreview(stat: FileStat): boolean {
  return stat.mimeType.startsWith('text/')
    || stat.mimeType === 'application/json'
    || stat.mimeType === 'application/xml'
    || stat.mimeType === 'application/yaml'
    || stat.mimeType === 'application/toml'
}

/**
 * Generic local-file preview modal.
 *
 * PDFs, images, text/code, audio, and video use the browser's native
 * rendering path via /api/filesystem/file. Unsupported binaries expose
 * download/open-external actions only.
 */
export function AssetPreviewModal({ open, file, onClose }: Props) {
  const t = useTranslation()
  const [text, setText] = useState<TextFileRead | null>(null)

  useEffect(() => {
    setText(null)
    if (!open || file === null || file.isDirectory || !isTextPreview(file)) return
    let cancelled = false
    void filesystemApi.text(file.path, TEXT_PREVIEW_BYTES)
      .then((read) => { if (!cancelled) setText(read) })
      .catch(() => { if (!cancelled) setText(null) })
    return () => { cancelled = true }
  }, [open, file])

  if (file === null) return null

  const url = filesystemApi.fileUrl(file.path)
  const downloadUrl = filesystemApi.fileUrl(file.path, true)
  const preview = (
    file.mimeType === 'application/pdf' ? (
      <iframe src={url} title={file.name} className="h-[70vh] w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]" />
    ) : file.mimeType.startsWith('image/') ? (
      <img src={url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full rounded-[10px] object-contain" />
    ) : file.mimeType.startsWith('audio/') ? (
      <audio controls src={url} className="w-full" />
    ) : file.mimeType.startsWith('video/') ? (
      <video controls src={url} className="max-h-[70vh] w-full rounded-[10px]" />
    ) : text !== null ? (
      <div className="max-h-[70vh] overflow-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.7] text-[var(--color-text-primary)]">{text.content}</pre>
        {text.truncated && (
          <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">
            {t('files.textTruncated', { count: TEXT_PREVIEW_BYTES })}
          </p>
        )}
      </div>
    ) : (
      <div className="flex min-h-[200px] items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
        {t('files.unsupported')}
      </div>
    )
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file.name}
      width={960}
      footer={(
        <>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <ExternalLink size={14} />
            {t('files.openExternal')}
          </a>
          <a
            href={downloadUrl}
            download={file.name}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-btn-primary-bg)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-btn-primary-fg)] transition-opacity hover:opacity-90"
          >
            <Download size={14} />
            {t('files.download')}
          </a>
        </>
      )}
    >
      {preview}
    </Modal>
  )
}
