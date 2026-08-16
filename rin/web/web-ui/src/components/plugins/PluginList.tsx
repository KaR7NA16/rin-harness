import { useEffect, useMemo } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import type { PluginSummary } from '../../types/plugin'
import { Icon } from '../shared/Icon'
import { Spinner } from '../shared/Spinner'

type PluginBucket = 'attention' | 'enabled' | 'disabled'

export function PluginList() {
  const {
    plugins,
    marketplaces,
    summary,
    isLoading,
    error,
    fetchPlugins,
    fetchPluginDetail,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchPlugins(currentWorkDir)
  }, [fetchPlugins, currentWorkDir])

  const grouped = useMemo(() => {
    const buckets: Record<PluginBucket, PluginSummary[]> = {
      attention: [],
      enabled: [],
      disabled: [],
    }

    for (const plugin of plugins) {
      if (plugin.hasErrors) {
        buckets.attention.push(plugin)
      } else if (plugin.enabled) {
        buckets.enabled.push(plugin)
      } else {
        buckets.disabled.push(plugin)
      }
    }

    return buckets
  }, [plugins])

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return <div className="text-[14px] text-[var(--color-error)] py-4">{error}</div>
  }

  if (plugins.length === 0) {
    return (
      <div className="text-center py-12 rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
        <Icon name="extension" size={40} className="text-[var(--color-text-tertiary)] mb-2 block" />
        <p className="text-[14px] text-[var(--color-text-tertiary)]">
          {t('settings.plugins.empty')}
        </p>
        <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
          {t('settings.plugins.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-[24px]">
      <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        <div className="flex min-h-[64px] flex-wrap items-center justify-between gap-[12px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {t('settings.plugins.browserEyebrow')}
            </div>
            <h3 className="mt-[2px] text-[13px] font-semibold text-[var(--color-text-primary)]">
              {t('settings.plugins.browserTitle')}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchPlugins(currentWorkDir)}
            >
              <Icon name="refresh" size={16} />
              {t('settings.plugins.refresh')}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-[var(--color-border-separator)] sm:grid-cols-4">
          <SummaryCard
            label={t('settings.plugins.summary.total')}
            value={String(summary?.total ?? plugins.length)}
            icon="extension"
          />
          <SummaryCard
            label={t('settings.plugins.summary.enabled')}
            value={String(summary?.enabled ?? plugins.filter((plugin) => plugin.enabled).length)}
            icon="check_circle"
          />
          <SummaryCard
            label={t('settings.plugins.summary.attention')}
            value={String(grouped.attention.length)}
            icon="warning"
          />
          <SummaryCard
            label={t('settings.plugins.summary.marketplaces')}
            value={String(summary?.marketplaceCount ?? marketplaces.length)}
            icon="storefront"
          />
        </div>
      </section>

      {marketplaces.length > 0 && (
        <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
          <div className="min-h-[64px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
            <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
              {t('settings.plugins.marketplacesTitle')}
            </h4>
            <p className="text-[12px] text-[var(--color-text-tertiary)] mt-[4px]">
              {t('settings.plugins.marketplacesHint')}
            </p>
          </div>
          <div className="grid gap-[12px] p-[16px] md:grid-cols-2 xl:grid-cols-3">
            {marketplaces.map((marketplace) => (
              <div
                key={marketplace.name}
                className="min-h-[64px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[16px] py-[12px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {marketplace.name}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    marketplace.autoUpdate
                      ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
                  }`}>
                    {marketplace.autoUpdate
                      ? t('settings.plugins.marketplaceAutoUpdateOn')
                      : t('settings.plugins.marketplaceAutoUpdateOff')}
                  </span>
                </div>
                <div className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)] break-words">
                  {marketplace.source}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{t('settings.plugins.marketplaceInstalledCount', { count: String(marketplace.installedCount) })}</span>
                  {marketplace.lastUpdated && (
                    <span>{t('settings.plugins.marketplaceUpdatedAt', { value: new Date(marketplace.lastUpdated).toLocaleString() })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {renderGroup('attention', grouped.attention, fetchPluginDetail, currentWorkDir, t)}
      {renderGroup('enabled', grouped.enabled, fetchPluginDetail, currentWorkDir, t)}
      {renderGroup('disabled', grouped.disabled, fetchPluginDetail, currentWorkDir, t)}
    </div>
  )
}

function renderGroup(
  bucket: PluginBucket,
  items: PluginSummary[],
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>,
  cwd: string | undefined,
  t: ReturnType<typeof useTranslation>,
) {
  if (items.length === 0) return null

  const titleKey =
    bucket === 'attention'
      ? 'settings.plugins.group.attention'
      : bucket === 'enabled'
        ? 'settings.plugins.group.enabled'
        : 'settings.plugins.group.disabled'

  return (
    <section
      key={bucket}
      className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]"
    >
      <div className="flex min-h-[64px] items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {t(titleKey)}
          </h4>
          <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)] mt-[4px]">
            {t('settings.plugins.groupHint', { count: String(items.length) })}
          </p>
        </div>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">{items.length}</span>
      </div>
      <div className="flex flex-col p-[8px]">
        {items.map((plugin) => (
          <button
            key={plugin.id}
            onClick={() => void fetchPluginDetail(plugin.id, cwd)}
            className="group min-h-[64px] rounded-[10px] border border-transparent px-[12px] py-[12px] text-left transition-colors hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/15 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] dark:focus-visible:ring-white/20"
          >
            <div className="flex items-start gap-[12px]">
              <Icon
                name={plugin.hasErrors ? 'warning' : plugin.enabled ? 'extension' : 'extension_off'}
                size={18}
                className="mt-[2px] text-[var(--color-text-tertiary)]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)] break-all">
                    {plugin.name}
                  </span>
                  <StatusPill plugin={plugin} />
                  <ScopePill scope={plugin.scope} />
                  {plugin.version && (
                    <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                      v{plugin.version}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)] break-words">
                  {plugin.description || t('settings.plugins.noDescription')}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{plugin.marketplace}</span>
                  {plugin.componentCounts.skills > 0 && (
                    <span>{t('settings.plugins.capability.skills', { count: String(plugin.componentCounts.skills) })}</span>
                  )}
                  {plugin.componentCounts.agents > 0 && (
                    <span>{t('settings.plugins.capability.agents', { count: String(plugin.componentCounts.agents) })}</span>
                  )}
                  {plugin.componentCounts.mcpServers > 0 && (
                    <span>{t('settings.plugins.capability.mcpServers', { count: String(plugin.componentCounts.mcpServers) })}</span>
                  )}
                  {plugin.errors.length > 0 && (
                    <span className="text-[var(--color-error)]">
                      {t('settings.plugins.errorCount', { count: String(plugin.errors.length) })}
                    </span>
                  )}
                </div>
              </div>
              <Icon name="chevron_right" size={18} className="text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="min-h-[64px] min-w-0 bg-[var(--color-surface-container)] px-[16px] py-[12px]">
      <div className="flex min-w-0 items-center gap-[6px] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
        <Icon name={icon} size={14} className="flex-shrink-0" />
        <span className="min-w-0 truncate">
          {label}
        </span>
      </div>
      <div className="mt-[4px] truncate text-[16px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </div>
    </div>
  )
}

function StatusPill({ plugin }: { plugin: PluginSummary }) {
  const t = useTranslation()

  if (plugin.hasErrors) {
    return (
      <span className="rounded-full bg-[var(--color-error)]/12 px-2 py-0.5 text-[10px] font-medium text-[var(--color-error)]">
        {t('settings.plugins.status.attention')}
      </span>
    )
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
      plugin.enabled
        ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
        : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
    }`}>
      {plugin.enabled
        ? t('settings.plugins.status.enabled')
        : t('settings.plugins.status.disabled')}
    </span>
  )
}

function ScopePill({ scope }: { scope: PluginSummary['scope'] }) {
  const t = useTranslation()
  return (
    <span className="rounded-full border border-[var(--color-border)] px-[8px] py-[2px] text-[10px] font-medium text-[var(--color-text-tertiary)]">
      {t(`settings.plugins.scope.${scope}`)}
    </span>
  )
}
