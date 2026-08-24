import { lazy, Suspense, type ComponentProps } from 'react'
import { useTranslation } from '../../i18n'

const CodeViewer = lazy(() => import('./CodeViewer').then((module) => ({ default: module.CodeViewer })))
const DiffViewer = lazy(() => import('./DiffViewer').then((module) => ({ default: module.DiffViewer })))

const fallbackClass = 'rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]'

function CodeFallback() {
  const t = useTranslation()
  return <div className={`my-2 ${fallbackClass}`}>{t('chat.codeViewer.loading')}</div>
}

function DiffFallback() {
  const t = useTranslation()
  return <div className={`my-4 ${fallbackClass}`}>{t('chat.diffViewer.loading')}</div>
}

/** CodeViewer behind a Suspense boundary, so react-shiki/shiki stay out of the main chunk. */
export function SuspendedCodeViewer(props: ComponentProps<typeof CodeViewer>) {
  return (
    <Suspense fallback={<CodeFallback />}>
      <CodeViewer {...props} />
    </Suspense>
  )
}

/** DiffViewer behind a Suspense boundary, so prism/react-diff-viewer stay out of the main chunk. */
export function SuspendedDiffViewer(props: ComponentProps<typeof DiffViewer>) {
  return (
    <Suspense fallback={<DiffFallback />}>
      <DiffViewer {...props} />
    </Suspense>
  )
}
