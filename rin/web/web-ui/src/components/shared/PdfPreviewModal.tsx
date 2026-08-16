import { Download, ExternalLink } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Modal } from './Modal'

type Props = {
  open: boolean
  url: string
  fileName?: string
  onClose: () => void
}

/**
 * Native PDF preview modal.
 *
 * Uses the browser/WebView PDF viewer through a same-origin iframe, so the
 * notes plugin does not need a PDF rendering dependency. Download and
 * external-open actions remain available for WebViews without a built-in
 * viewer.
 */
export function PdfPreviewModal({ open, url, fileName, onClose }: Props) {
  const t = useTranslation()
  const title = fileName || t('notes.pdf.title')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
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
            {t('notes.pdf.openExternal')}
          </a>
          <a
            href={url}
            download={fileName}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-btn-primary-bg)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-btn-primary-fg)] transition-opacity hover:opacity-90"
          >
            <Download size={14} />
            {t('notes.pdf.download')}
          </a>
        </>
      )}
    >
      <iframe
        src={url}
        title={title}
        className="h-[70vh] w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]"
      />
    </Modal>
  )
}
