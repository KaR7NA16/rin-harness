import { useCallback, useEffect, useState } from 'react'
import { notesApi } from '../../api/notes'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'

type Props = {
  path: string
  onChanged: () => void
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

/**
 * Note frontmatter properties editor.
 *
 * Keeps unknown frontmatter keys intact; edits title, tags, and aliases only.
 */
export function PropertiesPanel({ path, onChanged }: Props) {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [properties, setProperties] = useState<Record<string, unknown> | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [aliases, setAliases] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    void notesApi.properties(path)
      .then((res) => {
        const next = res.properties ?? {}
        setProperties(next)
        setTitle(typeof next.title === 'string' ? next.title : '')
        setTags(stringList(next.tags).join(', '))
        setAliases(stringList(next.aliases).join(', '))
      })
      .catch((error) => addToast({ type: 'error', message: String(error) }))
      .finally(() => setLoading(false))
  }, [path, addToast])

  const save = useCallback(async () => {
    const base = properties ?? {}
    const next: Record<string, unknown> = { ...base }
    const trimmedTitle = title.trim()
    if (trimmedTitle) next.title = trimmedTitle
    else delete next.title
    const nextTags = stringList(tags)
    if (nextTags.length > 0) next.tags = nextTags
    else delete next.tags
    const nextAliases = stringList(aliases)
    if (nextAliases.length > 0) next.aliases = nextAliases
    else delete next.aliases

    setSaving(true)
    try {
      await notesApi.updateProperties(path, next)
      setProperties(next)
      onChanged()
      addToast({ type: 'success', message: t('notes.saving') })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setSaving(false)
    }
  }, [properties, title, tags, aliases, path, onChanged, addToast, t])

  if (loading) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <label className="flex flex-col gap-[5px]">
        <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">{t('notes.properties.title')}</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[9px] py-[6px] text-[12.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-accent)]"
        />
      </label>
      <label className="flex flex-col gap-[5px]">
        <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">{t('notes.properties.tags')}</span>
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="project, idea"
          className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[9px] py-[6px] text-[12.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-accent)]"
        />
      </label>
      <label className="flex flex-col gap-[5px]">
        <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">{t('notes.properties.aliases')}</span>
        <input
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          placeholder="alias one, alias two"
          className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[9px] py-[6px] text-[12.5px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-accent)]"
        />
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-[4px] rounded-[8px] bg-[var(--color-btn-primary-bg)] px-[10px] py-[7px] text-[12px] font-semibold text-[var(--color-btn-primary-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {saving ? t('notes.saving') : t('common.save')}
      </button>
    </div>
  )
}
