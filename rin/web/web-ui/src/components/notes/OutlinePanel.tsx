import { useEffect, useState } from 'react'
import { notesApi } from '../../api/notes'
import { useTranslation } from '../../i18n'

type Heading = { level: number; text: string; slug: string }

function parseHeadings(content: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (m) {
      out.push({
        level: m[1]!.length,
        text: m[2]!.trim(),
        slug: m[2]!.trim().toLowerCase().replace(/\s+/g, '-'),
      })
    }
  }
  return out
}

export function OutlinePanel({ path, onJump }: { path: string; onJump: (slug: string | null) => void }) {
  const t = useTranslation()
  const [headings, setHeadings] = useState<Heading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    void notesApi.read(path).then(doc => {
      if (!cancelled) setHeadings(parseHeadings(doc.content))
    }).catch(() => {
      if (!cancelled) setError(true)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [path])

  // 编辑器内容变化时局部刷新: 定时轻量同步 (2s)
  useEffect(() => {
    const timer = setInterval(() => {
      void notesApi.read(path).then(doc => setHeadings(parseHeadings(doc.content))).catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [path])

  if (loading) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }
  if (error) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-error)]">{t('notes.loadFailed')}</div>
  }
  if (headings.length === 0) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('notes.outlineEmpty')}</div>
  }

  return (
    <div className="flex flex-col gap-[1px]">
      {headings.map((h, i) => (
        <button
          key={`${h.slug}-${i}`}
          onClick={() => onJump(h.slug)}
          className="truncate rounded-[6px] px-[8px] py-[5px] text-left text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          style={{ paddingLeft: `${8 + (h.level - 1) * 14}px` }}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}
