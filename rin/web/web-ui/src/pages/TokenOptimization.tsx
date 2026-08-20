import {
  ArrowLeft,
  ChevronDown,
  Network,
  RefreshCw,
  Scissors,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  tokenOptimizationApi,
  type CodeGraphData,
  type CodeGraphState,
  type CodeGraphStatus,
  type LiteOptimizationStatus,
  type RtkStatus,
  type SmartPruningLevel,
  type SmartPruningStatus,
} from '../api/tokenOptimization'
import { CodeGraphVisualization } from '../components/codegraph/CodeGraphVisualization'
import { Button } from '../components/shared/Button'
import {
  SettingsPage,
  SettingsSection,
  Switch,
} from '../components/settings/SettingsLayout'
import { useTranslation } from '../i18n'
import { formatBytes } from '../lib/formatBytes'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'

const POLL_INTERVAL_MS = 800

type TokenOptimizationProps = {
  initialView?: 'overview' | 'graph'
}

export function TokenOptimizationContent({ initialView = 'overview' }: TokenOptimizationProps = {}) {
  const t = useTranslation()
  const activeTabId = useTabStore((state) => state.activeTabId)
  const tabs = useTabStore((state) => state.tabs)
  const sessions = useSessionStore((state) => state.sessions)
  const [status, setStatus] = useState<CodeGraphStatus | null>(null)
  const [codeGraphGlobalEnabled, setCodeGraphGlobalEnabled] = useState<boolean | null>(null)
  const [graph, setGraph] = useState<CodeGraphData | null>(null)
  const [showGraph, setShowGraph] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<'context' | 'tools'>>(() => new Set(['context']))
  const [codeGraphDetailsOpen, setCodeGraphDetailsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rtkStatus, setRtkStatus] = useState<RtkStatus | null>(null)
  const [rtkLoading, setRtkLoading] = useState(false)
  const [rtkError, setRtkError] = useState<string | null>(null)
  const [liteStatus, setLiteStatus] = useState<LiteOptimizationStatus | null>(null)
  const [liteLoading, setLiteLoading] = useState(false)
  const [liteError, setLiteError] = useState<string | null>(null)
  const [pruningStatus, setPruningStatus] = useState<SmartPruningStatus | null>(null)
  const [pruningLoading, setPruningLoading] = useState(false)
  const [pruningError, setPruningError] = useState<string | null>(null)
  const autoOpenedGraphProjectRef = useRef<string | null>(null)
  const statusRequestProjectRef = useRef<string | null>(null)
  const activeProjectPathRef = useRef<string | null>(null)
  const projectVersionRef = useRef(0)
  const graphLoadingProjectRef = useRef<string | null>(null)
  const statusLoadingRequestRef = useRef<{ projectPath: string; requestId: number } | null>(null)
  const statusRequestIdRef = useRef(0)
  const graphRequestIdRef = useRef(0)
  const loadingOperationIdRef = useRef(0)
  const toggleRequestIdRef = useRef(0)
  const projectOperationPathRef = useRef<string | null>(null)

  const projectPath = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
    if (!activeTab || activeTab.type !== 'session') return null
    const session = sessions.find((candidate) =>
      candidate.id === activeTab.sessionId
      && (!activeTab.projectPath || candidate.projectPath === activeTab.projectPath),
    )
    return session?.isTemporary ? null : session?.workDir || null
  }, [activeTabId, sessions, tabs])

  useEffect(() => {
    activeProjectPathRef.current = projectPath
    projectVersionRef.current += 1
    statusRequestIdRef.current += 1
    statusLoadingRequestRef.current = null
    graphRequestIdRef.current += 1
    loadingOperationIdRef.current += 1
    projectOperationPathRef.current = null
  }, [projectPath])

  const loadStatus = useCallback(async (quiet = false) => {
    const requestedProjectPath = projectPath
    const requestedProjectVersion = projectVersionRef.current
    if (quiet && projectOperationPathRef.current === requestedProjectPath) return
    if (quiet && statusLoadingRequestRef.current?.projectPath === requestedProjectPath) return
    const requestId = ++statusRequestIdRef.current
    if (!requestedProjectPath) {
      statusLoadingRequestRef.current = null
      statusRequestProjectRef.current = null
      setStatus(null)
      return
    }
    statusLoadingRequestRef.current = { projectPath: requestedProjectPath, requestId }
    if (!quiet) setError(null)
    try {
      const nextStatus = await tokenOptimizationApi.status(requestedProjectPath)
      if (
        activeProjectPathRef.current !== requestedProjectPath
        || projectVersionRef.current !== requestedProjectVersion
        || statusRequestIdRef.current !== requestId
      ) return
      statusRequestProjectRef.current = requestedProjectPath
      setStatus(nextStatus)
    } catch (loadError) {
      if (
        activeProjectPathRef.current !== requestedProjectPath
        || projectVersionRef.current !== requestedProjectVersion
        || statusRequestIdRef.current !== requestId
      ) return
      if (!quiet) setError(getErrorMessage(loadError, t('tokenOptimization.loadFailed')))
    } finally {
      if (statusLoadingRequestRef.current?.requestId === requestId) {
        statusLoadingRequestRef.current = null
      }
    }
  }, [projectPath, t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.codeGraphGlobalStatus()
      .then((nextStatus) => {
        if (active) setCodeGraphGlobalEnabled(nextStatus.enabled)
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError, t('tokenOptimization.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.rtkStatus()
      .then((nextStatus) => {
        if (active) setRtkStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setRtkError(getErrorMessage(loadError, t('tokenOptimization.rtk.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.liteStatus()
      .then((nextStatus) => {
        if (active) setLiteStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setLiteError(getErrorMessage(loadError, t('tokenOptimization.lite.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void tokenOptimizationApi.pruningStatus()
      .then((nextStatus) => {
        if (active) setPruningStatus(nextStatus)
      })
      .catch((loadError) => {
        if (active) setPruningError(getErrorMessage(loadError, t('tokenOptimization.pruning.loadFailed')))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    autoOpenedGraphProjectRef.current = null
    statusRequestProjectRef.current = null
    graphLoadingProjectRef.current = null
    projectOperationPathRef.current = null
    setGraph(null)
    setShowGraph(false)
    setGraphLoading(false)
    setLoading(false)
    setError(null)
    setStatus(null)
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (
      !projectPath
      || codeGraphGlobalEnabled !== true
      || statusRequestProjectRef.current !== projectPath
      || status?.enabled !== false
    ) return
    void loadStatus()
  }, [codeGraphGlobalEnabled, loadStatus, projectPath, status?.enabled])

  useEffect(() => {
    if (initialView === 'graph') return
    autoOpenedGraphProjectRef.current = null
    graphRequestIdRef.current += 1
    graphLoadingProjectRef.current = null
    setGraphLoading(false)
    setGraph(null)
    setShowGraph(false)
  }, [initialView])

  useEffect(() => {
    if (
      status?.state !== 'preparing'
      && status?.state !== 'indexing'
      && status?.state !== 'empty'
    ) return
    const interval = status.state === 'empty' ? 2_000 : POLL_INTERVAL_MS
    const timer = window.setInterval(() => void loadStatus(true), interval)
    return () => window.clearInterval(timer)
  }, [loadStatus, status?.state])

  const invalidateGraphRequest = useCallback(() => {
    graphRequestIdRef.current += 1
    graphLoadingProjectRef.current = null
    setGraphLoading(false)
    setGraph(null)
    setShowGraph(false)
  }, [])

  const toggleCodeGraph = async (enabled: boolean) => {
    if (codeGraphGlobalEnabled === null || loading) return
    const requestedProjectPath = projectPath
    const requestedProjectVersion = projectVersionRef.current
    const loadingOperationId = ++loadingOperationIdRef.current
    const toggleRequestId = ++toggleRequestIdRef.current
    statusRequestIdRef.current += 1
    statusLoadingRequestRef.current = null
    projectOperationPathRef.current = requestedProjectPath
    invalidateGraphRequest()
    setLoading(true)
    setError(null)
    try {
      if (enabled && requestedProjectPath) {
        const nextStatus = await tokenOptimizationApi.enable(requestedProjectPath)
        if (toggleRequestId === toggleRequestIdRef.current) {
          setCodeGraphGlobalEnabled(true)
        }
        if (
          activeProjectPathRef.current === requestedProjectPath
          && projectVersionRef.current === requestedProjectVersion
          && loadingOperationIdRef.current === loadingOperationId
        ) {
          statusRequestProjectRef.current = requestedProjectPath
          setStatus(nextStatus)
        }
      } else if (enabled) {
        const nextStatus = await tokenOptimizationApi.enableCodeGraphGlobally()
        if (toggleRequestId === toggleRequestIdRef.current) {
          setCodeGraphGlobalEnabled(nextStatus.enabled)
        }
      } else {
        const nextStatus = await tokenOptimizationApi.disableCodeGraphGlobally()
        if (toggleRequestId === toggleRequestIdRef.current) {
          setCodeGraphGlobalEnabled(nextStatus.enabled)
          setStatus((current) => current ? {
            ...current,
            enabled: false,
            state: 'disabled',
            progress: null,
            error: null,
          } : null)
        }
      }
    } catch (toggleError) {
      if (toggleRequestId === toggleRequestIdRef.current) {
        setError(getErrorMessage(toggleError, t('tokenOptimization.updateFailed')))
      }
    } finally {
      if (loadingOperationIdRef.current === loadingOperationId) {
        projectOperationPathRef.current = null
        setLoading(false)
      }
    }
  }

  const rebuild = async () => {
    if (!projectPath || loading) return
    const requestedProjectPath = projectPath
    const requestedProjectVersion = projectVersionRef.current
    const loadingOperationId = ++loadingOperationIdRef.current
    statusRequestIdRef.current += 1
    statusLoadingRequestRef.current = null
    projectOperationPathRef.current = requestedProjectPath
    invalidateGraphRequest()
    setLoading(true)
    setError(null)
    try {
      const nextStatus = await tokenOptimizationApi.rebuild(requestedProjectPath)
      if (
        activeProjectPathRef.current === requestedProjectPath
        && projectVersionRef.current === requestedProjectVersion
        && loadingOperationIdRef.current === loadingOperationId
      ) {
        statusRequestProjectRef.current = requestedProjectPath
        setStatus(nextStatus)
      }
    } catch (rebuildError) {
      if (
        activeProjectPathRef.current === requestedProjectPath
        && projectVersionRef.current === requestedProjectVersion
        && loadingOperationIdRef.current === loadingOperationId
      ) {
        setError(getErrorMessage(rebuildError, t('tokenOptimization.rebuildFailed')))
      }
    } finally {
      if (loadingOperationIdRef.current === loadingOperationId) {
        projectOperationPathRef.current = null
        setLoading(false)
      }
    }
  }

  const openGraph = useCallback(async () => {
    const requestedProjectPath = projectPath
    const requestedProjectVersion = projectVersionRef.current
    if (!requestedProjectPath || graphLoadingProjectRef.current === requestedProjectPath) return
    const requestId = ++graphRequestIdRef.current
    graphLoadingProjectRef.current = requestedProjectPath
    setGraphLoading(true)
    setError(null)
    try {
      const data = await tokenOptimizationApi.graph(requestedProjectPath)
      if (
        activeProjectPathRef.current !== requestedProjectPath
        || projectVersionRef.current !== requestedProjectVersion
        || graphRequestIdRef.current !== requestId
      ) return
      setGraph(data)
      setShowGraph(true)
    } catch (graphError) {
      if (
        activeProjectPathRef.current !== requestedProjectPath
        || projectVersionRef.current !== requestedProjectVersion
        || graphRequestIdRef.current !== requestId
      ) return
      setError(getErrorMessage(graphError, t('tokenOptimization.graph.loadFailed')))
    } finally {
      if (
        activeProjectPathRef.current !== requestedProjectPath
        || projectVersionRef.current !== requestedProjectVersion
        || graphRequestIdRef.current !== requestId
      ) return
      graphLoadingProjectRef.current = null
      setGraphLoading(false)
    }
  }, [projectPath, t])

  useEffect(() => {
    if (
      initialView !== 'graph'
      || !projectPath
      || statusRequestProjectRef.current !== projectPath
      || status?.state !== 'ready'
      || autoOpenedGraphProjectRef.current === projectPath
    ) return
    autoOpenedGraphProjectRef.current = projectPath
    void openGraph()
  }, [initialView, openGraph, projectPath, status])

  const toggleRtk = async (enabled: boolean) => {
    if (rtkLoading) return
    setRtkLoading(true)
    setRtkError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enableRtk()
        : await tokenOptimizationApi.disableRtk()
      setRtkStatus(nextStatus)
    } catch (toggleError) {
      setRtkError(getErrorMessage(toggleError, t('tokenOptimization.rtk.updateFailed')))
    } finally {
      setRtkLoading(false)
    }
  }

  const toggleLite = async (enabled: boolean) => {
    if (liteLoading) return
    setLiteLoading(true)
    setLiteError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enableLite()
        : await tokenOptimizationApi.disableLite()
      setLiteStatus(nextStatus)
    } catch (toggleError) {
      setLiteError(getErrorMessage(toggleError, t('tokenOptimization.lite.updateFailed')))
    } finally {
      setLiteLoading(false)
    }
  }

  const togglePruning = async (enabled: boolean) => {
    if (pruningLoading) return
    setPruningLoading(true)
    setPruningError(null)
    try {
      const nextStatus = enabled
        ? await tokenOptimizationApi.enablePruning()
        : await tokenOptimizationApi.disablePruning()
      setPruningStatus(nextStatus)
    } catch (toggleError) {
      setPruningError(getErrorMessage(toggleError, t('tokenOptimization.pruning.updateFailed')))
    } finally {
      setPruningLoading(false)
    }
  }

  const updatePruningLevel = async (level: SmartPruningLevel) => {
    if (!pruningStatus || pruningLoading || pruningStatus.level === level) return
    setPruningLoading(true)
    setPruningError(null)
    try {
      setPruningStatus(await tokenOptimizationApi.setPruningLevel(level))
    } catch (updateError) {
      setPruningError(getErrorMessage(updateError, t('tokenOptimization.pruning.updateFailed')))
    } finally {
      setPruningLoading(false)
    }
  }

  const optimizerEstimates = getOptimizerEstimates(
    liteStatus,
    pruningStatus,
    rtkStatus,
    codeGraphGlobalEnabled ?? false,
  )
  const savingsEstimate = getCombinedSavingsEstimate(optimizerEstimates)
  const activeOptimizerCount = [
    liteStatus?.enabled,
    pruningStatus?.enabled,
    rtkStatus?.enabled,
    codeGraphGlobalEnabled,
  ].filter(Boolean).length
  const groupActiveCounts = {
    context: [liteStatus?.enabled, pruningStatus?.enabled].filter(Boolean).length,
    tools: [rtkStatus?.enabled, codeGraphGlobalEnabled].filter(Boolean).length,
  }

  const toggleAllOptimizers = async (enabled: boolean) => {
    await Promise.all([
      toggleLite(enabled),
      togglePruning(enabled),
      toggleRtk(enabled),
      toggleCodeGraph(enabled),
    ])
  }

  if (showGraph && graph) {
    return (
      <div className="mx-auto flex min-h-[680px] w-full max-w-[920px] flex-col gap-[16px]">
        <header className="flex items-center justify-between gap-[16px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <button
              type="button"
              aria-label={t('tokenOptimization.graph.back')}
              title={t('tokenOptimization.graph.back')}
              onClick={() => setShowGraph(false)}
              className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-[17px] font-semibold text-[var(--color-text-primary)]">
                {t('tokenOptimization.graph.title')}
              </h1>
              <p className="mt-[3px] truncate text-[12px] text-[var(--color-text-tertiary)]">
                {projectPath}
              </p>
            </div>
          </div>
        </header>
        <CodeGraphVisualization data={graph} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* 总览行：预计节省 + 启用计数 + 一键全部启用/关闭 */}
      <div
        data-testid="savings-overview"
        className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-[16px] gap-y-[6px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
            {t('tokenOptimization.savings.title')}
          </div>
          <p className="mt-[3px] text-[11px] leading-[16px] text-[var(--color-text-tertiary)]">
            <span className="font-bold tabular-nums text-[var(--color-text-secondary)]">{activeOptimizerCount}/4</span>
            {' '}
            {t('tokenOptimization.savings.active')}
            {savingsEstimate.enabled
              ? ` · ${t('tokenOptimization.savings.estimated')} ${savingsEstimate.display}`
              : ` · ${t('tokenOptimization.savings.off')}`}
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <Button size="sm" variant="secondary" onClick={() => void toggleAllOptimizers(true)}>
            {t('tokenOptimization.savings.enableAll')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void toggleAllOptimizers(false)}>
            {t('tokenOptimization.savings.disableAll')}
          </Button>
        </div>
      </div>

      {/* 上下文控制组 */}
      <OptimizerGroupToggle
        title={t('tokenOptimization.groups.context.title')}
        description={t('tokenOptimization.groups.context.description')}
        activeCount={groupActiveCounts.context}
        totalCount={2}
        expanded={expandedGroups.has('context')}
        onToggle={() => setExpandedGroups((current) => {
          const next = new Set(current)
          if (next.has('context')) next.delete('context')
          else next.add('context')
          return next
        })}
      />
      {expandedGroups.has('context') && (
        <div data-testid="token-group-context">
          <OptimizerRow
            testId="lite-toolbar"
            icon={<Sparkles size={17} />}
            title={t('tokenOptimization.lite.title')}
            description={t('tokenOptimization.lite.description')}
            active={liteStatus?.enabled ?? false}
            control={(
              <Switch
                checked={liteStatus?.enabled ?? false}
                disabled={liteStatus === null || liteLoading}
                onChange={(enabled) => void toggleLite(enabled)}
                ariaLabel={t('tokenOptimization.lite.toggle')}
              />
            )}
          />
          <OptimizerRow
            testId="pruning-toolbar"
            icon={<Scissors size={17} />}
            title={t('tokenOptimization.pruning.title')}
            description={t('tokenOptimization.pruning.description')}
            active={pruningStatus?.enabled ?? false}
            metrics={(
              <PruningLevelControl
                level={pruningStatus?.level ?? 'balanced'}
                disabled={pruningStatus === null || pruningLoading}
                onChange={(level) => void updatePruningLevel(level)}
              />
            )}
            control={(
              <Switch
                checked={pruningStatus?.enabled ?? false}
                disabled={pruningStatus === null || pruningLoading}
                onChange={(enabled) => void togglePruning(enabled)}
                ariaLabel={t('tokenOptimization.pruning.toggle')}
              />
            )}
          />
        </div>
      )}

      {/* 工具与代码组 */}
      <OptimizerGroupToggle
        title={t('tokenOptimization.groups.tools.title')}
        description={t('tokenOptimization.groups.tools.description')}
        activeCount={groupActiveCounts.tools}
        totalCount={2}
        expanded={expandedGroups.has('tools')}
        onToggle={() => setExpandedGroups((current) => {
          const next = new Set(current)
          if (next.has('tools')) next.delete('tools')
          else next.add('tools')
          return next
        })}
      />
      {expandedGroups.has('tools') && (
        <div data-testid="token-group-tools">
          <OptimizerRow
            testId="rtk-toolbar"
            icon={<Terminal size={17} />}
            title={t('tokenOptimization.rtk.title')}
            description={t('tokenOptimization.rtk.description')}
            active={rtkStatus?.enabled ?? false}
            meta={rtkStatus?.version ? `v${rtkStatus.version}` : undefined}
            control={(
              <Switch
                checked={rtkStatus?.enabled ?? false}
                disabled={rtkStatus === null || rtkLoading || (!rtkStatus.available && !rtkStatus.enabled)}
                onChange={(enabled) => void toggleRtk(enabled)}
                ariaLabel={t('tokenOptimization.rtk.toggle')}
              />
            )}
          />
          <OptimizerRow
            testId="codegraph-toolbar"
            icon={<Network size={17} />}
            title={t('tokenOptimization.codeGraph.title')}
            description={!projectPath || status?.indexable === false
              ? t('tokenOptimization.noProject')
              : t('tokenOptimization.codeGraph.description')}
            active={codeGraphGlobalEnabled ?? false}
            actions={(
              <button
                type="button"
                aria-label={t('tokenOptimization.details')}
                title={t('tokenOptimization.details')}
                aria-expanded={codeGraphDetailsOpen}
                onClick={() => setCodeGraphDetailsOpen((open) => !open)}
                className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                <ChevronDown size={15} className={`transition-transform ${codeGraphDetailsOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
            control={(
              <Switch
                checked={codeGraphGlobalEnabled ?? false}
                disabled={codeGraphGlobalEnabled === null || loading}
                onChange={(enabled) => void toggleCodeGraph(enabled)}
                ariaLabel={t('tokenOptimization.codeGraph.toggle')}
              />
            )}
          />
          {codeGraphDetailsOpen && (
            <div data-testid="codegraph-details" className="flex flex-col gap-[10px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[10px]">
                <div className="flex min-w-0 flex-wrap items-center gap-x-[16px] gap-y-[5px]">
                  <StatusLabel state={status?.state ?? 'disabled'} />
                  {status?.stats && (
                    <div className="grid grid-cols-2 gap-x-[16px] gap-y-[5px] sm:grid-cols-4 sm:gap-[18px]">
                      <CompactMetric label={t('tokenOptimization.stats.files')} value={status.stats.fileCount} />
                      <CompactMetric label={t('tokenOptimization.stats.symbols')} value={status.stats.nodeCount} />
                      <CompactMetric label={t('tokenOptimization.stats.relations')} value={status.stats.edgeCount} />
                      <CompactMetric label={t('tokenOptimization.stats.size')} value={formatBytes(status.stats.dbSizeBytes)} />
                    </div>
                  )}
                  {status && (status.state === 'preparing' || status.state === 'indexing') && (
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {progressLabel(status, t)}
                      {status.progress && status.progress.total > 0
                        ? ` ${status.progress.current}/${status.progress.total}`
                        : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-[8px]">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!status?.enabled || !['ready', 'empty'].includes(status.state) || loading}
                  onClick={() => void rebuild()}
                >
                  <RefreshCw size={13} className={`mr-1 ${loading || status?.state === 'indexing' ? 'animate-spin' : ''}`} />
                  {t('tokenOptimization.rebuild')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={status?.state !== 'ready' || graphLoading}
                  onClick={() => void openGraph()}
                >
                  <Network size={13} className={`mr-1 ${graphLoading ? 'animate-pulse' : ''}`} />
                  {t('tokenOptimization.visualize')}
                </Button>
              </div>
              </div>
            </div>
          )}
        </div>
      )}

      {[liteError, pruningError, rtkError, error].filter(Boolean).map((message) => (
        <div
          key={message}
          role="alert"
          className="rounded-[12px] border border-[var(--color-error)]/25 bg-[var(--color-error)]/5 px-[14px] py-[11px] text-[12px] text-[var(--color-error)]"
        >
          {message}
        </div>
      ))}
    </div>
  )
}

/** Standalone token-optimization settings page (kept for compatibility). */
export function TokenOptimization(props: TokenOptimizationProps = {}) {
  const t = useTranslation()
  return (
    <SettingsPage
      title={t('tokenOptimization.title')}
      description={t('tokenOptimization.description')}
      saveMode="immediate"
    >
      <SettingsSection>
        <TokenOptimizationContent {...props} />
      </SettingsSection>
    </SettingsPage>
  )
}

function OptimizerRow({
  testId,
  icon,
  title,
  description,
  active,
  status,
  estimate,
  metrics,
  meta,
  actions,
  control,
}: {
  testId: string
  icon: ReactNode
  title: string
  description: string
  active: boolean
  status?: ReactNode
  estimate?: ReactNode
  metrics?: ReactNode
  meta?: string
  actions?: ReactNode
  control: ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className="grid min-h-[64px] min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] gap-x-[12px] gap-y-[10px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px] last:border-b-0 sm:grid-cols-[36px_minmax(180px,1fr)_minmax(180px,auto)_auto] sm:items-center"
    >
      <div className={`flex h-[36px] w-[36px] items-center justify-center rounded-[8px] transition-colors ${
        active
          ? 'bg-[var(--color-text-primary)] text-[var(--color-surface-container)]'
          : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
      }`}>
        {icon}
      </div>
      <div className="min-w-0 self-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          <h2 className="text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">{title}</h2>
          {status !== undefined && (
            <div className={`flex items-center gap-[5px] text-[11px] font-semibold ${
              active ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]'
            }`}>
              <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${active ? 'bg-current' : 'bg-[var(--color-border)]'}`} />
              {status}
            </div>
          )}
          {estimate !== undefined && estimate}
        </div>
        <p className="mt-[3px] max-w-[460px] text-[11px] leading-[1.45] text-[var(--color-text-tertiary)]">
          {description}
        </p>
      </div>
      <div className="col-span-2 col-start-2 min-w-0 sm:col-span-1 sm:col-start-auto">
        {metrics}
      </div>
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-[7px] self-center sm:col-start-auto sm:row-start-auto">
        {meta && <span className="text-[11px] text-[var(--color-text-tertiary)]">{meta}</span>}
        {actions}
        {control}
      </div>
    </div>
  )
}


type OptimizerEstimate = {
  min: number
  max: number
  display: string
  enabled: boolean
}

function getOptimizerEstimates(
  lite: LiteOptimizationStatus | null,
  pruning: SmartPruningStatus | null,
  rtk: RtkStatus | null,
  codeGraphGlobalEnabled: boolean,
) {
  return {
    lite: createEstimate(2, 8, lite?.enabled ?? false),
    pruning: createEstimate(
      pruning?.level === 'conservative' ? 4 : pruning?.level === 'aggressive' ? 15 : 8,
      pruning?.level === 'conservative' ? 12 : pruning?.level === 'aggressive' ? 40 : 24,
      pruning?.enabled ?? false,
    ),
    // RTK reports 60–90% command-output reduction. At an estimated 30% share
    // of a coding-agent cycle, that contributes roughly 18–27% end to end.
    rtk: createEstimate(18, 27, rtk?.enabled ?? false),
    codeGraph: createEstimate(23, 64, codeGraphGlobalEnabled),
  }
}

function PruningLevelControl({
  level,
  disabled,
  onChange,
}: {
  level: SmartPruningLevel
  disabled: boolean
  onChange: (level: SmartPruningLevel) => void
}) {
  const t = useTranslation()
  const levels: SmartPruningLevel[] = ['conservative', 'balanced', 'aggressive']

  return (
    <div
      role="group"
      aria-label={t('tokenOptimization.pruning.level')}
      className="inline-grid h-[32px] grid-cols-3 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[3px]"
    >
      {levels.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={candidate === level}
          disabled={disabled}
          onClick={() => onChange(candidate)}
          className={`min-w-[52px] rounded-full px-[12px] text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            candidate === level
              ? 'bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-[0_3px_10px_rgba(0,0,0,0.10)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {t(`tokenOptimization.pruning.level.${candidate}`)}
        </button>
      ))}
    </div>
  )
}

function createEstimate(min: number, max: number, enabled: boolean): OptimizerEstimate {
  return {
    min,
    max,
    enabled,
    display: min === max ? `${min}%` : `${min}–${max}%`,
  }
}

function getCombinedSavingsEstimate(estimates: ReturnType<typeof getOptimizerEstimates>) {
  const enabled = Object.values(estimates).some((estimate) => estimate.enabled)
  if (!enabled) {
    return {
      display: '0%',
      min: 0,
      max: 0,
      enabled: false,
      hasCycleEstimate: false,
    }
  }

  // Add the full-cycle ranges as a best-case portfolio estimate. Individual
  // optimizers target different token pools, and the cap avoids implying that
  // any combination can eliminate the entire cycle.
  const cycleEstimates = Object.values(estimates)
    .filter((estimate) => estimate.enabled)

  const min = combineEstimatedPercentages(cycleEstimates.map((estimate) => estimate.min))
  const max = combineEstimatedPercentages(cycleEstimates.map((estimate) => estimate.max))
  return {
    display: min === max ? `${min}%` : `${min}–${max}%`,
    min,
    max,
    enabled: true,
    hasCycleEstimate: true,
  }
}

function combineEstimatedPercentages(percentages: number[]) {
  const total = percentages.reduce((sum, percentage) => sum + percentage, 0)
  if (total <= 92) return Math.max(0, Math.round(total))

  // Above 92%, overlap rises quickly. Compress each additional 20 points of
  // raw estimates into one visible percentage point. The count-aware ceiling
  // keeps every additional optimizer visible regardless of activation order:
  // three can reach 93%, four 94%, five 95%, and all six 96%.
  const countAwareCeiling = Math.min(96, 90 + percentages.length)
  return Math.min(countAwareCeiling, 92 + Math.ceil((total - 92) / 20))
}


/** 优化器分组折叠头：组名 + 启用计数 + 展开箭头。 */
function OptimizerGroupToggle({
  title,
  description,
  activeCount,
  totalCount,
  expanded,
  onToggle,
}: {
  title: string
  description: string
  activeCount: number
  totalCount: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-[12px] border-t border-[var(--color-border-separator)] px-[20px] py-[12px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-[8px]">
          <span className="text-[12px] font-semibold leading-[16px] text-[var(--color-text-secondary)]">{title}</span>
          <span className="rounded-full bg-[var(--color-surface-container-low)] px-[8px] py-[1px] text-[10px] font-semibold tabular-nums text-[var(--color-text-tertiary)]">
            {activeCount}/{totalCount}
          </span>
        </span>
        <span className="mt-[3px] block text-[11px] leading-[16px] text-[var(--color-text-tertiary)]">{description}</span>
      </span>
      <ChevronDown size={16} className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  )
}


function StatusLabel({ state }: { state: CodeGraphState }) {
  const t = useTranslation()
  const tone = state === 'ready'
    ? 'text-[var(--color-success)]'
    : state === 'empty'
      ? 'text-[var(--color-warning)]'
    : state === 'error'
      ? 'text-[var(--color-error)]'
      : 'text-[var(--color-text-tertiary)]'
  return (
    <span className={`shrink-0 whitespace-nowrap text-[11px] font-semibold ${tone}`}>
      {t(`tokenOptimization.state.${state}`)}
    </span>
  )
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex min-w-0 flex-col">
      <strong className="truncate text-[12px] font-bold leading-none text-[var(--color-text-primary)] tabular-nums">{value}</strong>
      <span className="mt-[3px] truncate text-[11px] text-[var(--color-text-tertiary)]">{label}</span>
    </span>
  )
}

function progressLabel(
  status: CodeGraphStatus,
  t: ReturnType<typeof useTranslation>,
) {
  if (status.state === 'preparing') return t('tokenOptimization.state.preparing')
  const phase = status.progress?.phase
  if (phase === 'scanning') return t('tokenOptimization.phase.scanning')
  if (phase === 'parsing') return t('tokenOptimization.phase.parsing')
  if (phase === 'resolving') return t('tokenOptimization.phase.resolving')
  return t('tokenOptimization.state.indexing')
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
