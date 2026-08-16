import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { settingsApi, type AddPermissionRuleInput, type PermissionRuleEntry } from '../../api/settings'
import { useUIStore } from '../../stores/uiStore'
import { SettingsSection } from './SettingsLayout'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'

type Props = {
  forceRefresh?: number
}

const SOURCE_LABELS: Array<{ value: AddPermissionRuleInput['source']; label: string }> = [
  { value: 'userSettings', label: 'User' },
  { value: 'projectSettings', label: 'Project' },
  { value: 'localSettings', label: 'Local' },
]

function behaviorIcon(b: PermissionRuleEntry['behavior']): string {
  if (b === 'allow') return 'check_circle'
  if (b === 'deny') return 'close'
  return 'help'
}

function behaviorClass(b: PermissionRuleEntry['behavior']): string {
  if (b === 'allow') return 'text-[var(--color-success)]'
  if (b === 'deny') return 'text-[var(--color-error)]'
  return 'text-[var(--color-warning)]'
}

export function PermissionRules({ forceRefresh }: Props) {
  const t = useTranslation()
  const [rules, setRules] = useState<PermissionRuleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [toolName, setToolName] = useState('')
  const [ruleContent, setRuleContent] = useState('')
  const [behavior, setBehavior] = useState<'allow' | 'deny' | 'ask'>('allow')
  const [source, setSource] = useState<AddPermissionRuleInput['source']>('userSettings')
  const [adding, setAdding] = useState(false)
  const mountedRef = useRef(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await settingsApi.getPermissionRules()
      if (mountedRef.current) setRules(res.rules)
    } catch {
      if (mountedRef.current) useUIStore.getState().addToast({ type: 'error', message: t('permission.rules.loadFailed') })
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceRefresh])

  const handleDelete = async (rule: PermissionRuleEntry) => {
    try {
      const res = await settingsApi.deletePermissionRule(rule)
      if (res.ok) {
        useUIStore.getState().addToast({ type: 'success', message: t('permission.rules.deleted') })
        setRules((prev) => prev.filter((r) => r !== rule))
      } else {
        useUIStore.getState().addToast({ type: 'error', message: t('permission.rules.deleteFailed') })
      }
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: t('permission.rules.deleteFailed') })
    }
  }

  const handleAdd = async () => {
    const trimmed = toolName.trim()
    if (!trimmed) {
      useUIStore.getState().addToast({ type: 'warning', message: t('permission.rules.requireTool') })
      return
    }
    setAdding(true)
    try {
      const content = ruleContent.trim() || undefined
      await settingsApi.addPermissionRule({ toolName: trimmed, ruleContent: content, behavior, source })
      useUIStore.getState().addToast({ type: 'success', message: t('permission.rules.added') })
      setToolName('')
      setRuleContent('')
      setShowAdd(false)
      await load()
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: t('permission.rules.addFailed') })
    } finally {
      setAdding(false)
    }
  }

  return (
    <SettingsSection
      title={t('permission.rules.title')}
      description={t('permission.rules.description')}
      action={
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setShowAdd((v) => !v)}
        >
          <span className="text-[13px] leading-none">+</span>
          {t('permission.rules.add')}
        </Button>
      }
    >
      {showAdd && (
        <div className="flex flex-col gap-2 border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder={t('permission.rules.toolPlaceholder')}
              className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
            <input
              type="text"
              value={ruleContent}
              onChange={(e) => setRuleContent(e.target.value)}
              placeholder={t('permission.rules.contentPlaceholder')}
              className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={behavior}
              onChange={(e) => setBehavior(e.target.value as 'allow' | 'deny' | 'ask')}
              className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="allow">{t('permission.rules.allow')}</option>
              <option value="deny">{t('permission.rules.deny')}</option>
              <option value="ask">{t('permission.rules.ask')}</option>
            </select>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as AddPermissionRuleInput['source'])}
              className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none"
            >
              {SOURCE_LABELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={adding}
              onClick={handleAdd}
            >
              {adding ? t('permission.rules.saving') : t('permission.rules.confirmAdd')}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-[20px] py-[16px] text-[12px] text-[var(--color-text-tertiary)]">
          {t('permission.rules.loading')}
        </div>
      ) : rules.length === 0 ? (
        <div className="px-[20px] py-[16px] text-[12px] text-[var(--color-text-tertiary)]">
          {t('permission.rules.empty')}
        </div>
      ) : (
        rules.map((rule) => (
          <div
            key={`${rule.source}-${rule.behavior}-${rule.ruleString}`}
            className="flex min-h-[48px] items-center gap-3 px-[20px] py-[10px]"
          >
            <Icon name={behaviorIcon(rule.behavior)} size={15} className={`shrink-0 ${behaviorClass(rule.behavior)}`} />
            <div className="min-w-0 flex-1">
              <div className="break-all font-[var(--font-mono)] text-[12px] text-[var(--color-text-primary)]">
                {rule.ruleString}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {rule.source} · {rule.behavior}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(rule)}
              aria-label={t('permission.rules.deleteRule')}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)] transition-colors"
            >
              <span className="text-[13px] leading-none">×</span>
            </button>
          </div>
        ))
      )}
    </SettingsSection>
  )
}