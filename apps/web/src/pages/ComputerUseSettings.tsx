import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { computerUseApi, type ComputerUseStatus, type SetupResult, type InstalledApp, type AuthorizedApp } from '../api/computerUse'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { SettingsPage, SettingsRow, SettingsSection, Switch } from '../components/settings/SettingsLayout'
import { Button } from '../components/shared/Button'
import { Icon } from '../components/shared/Icon'

type CheckState = 'loading' | 'ready' | 'error'
const PYTHON_DOWNLOAD_URLS: Record<string, string> = {
  darwin: 'https://www.python.org/downloads/macos/',
  win32: 'https://www.python.org/downloads/windows/',
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <Icon name="help" size={18} className="text-[var(--color-text-tertiary)]" />
  }
  return ok ? (
    <Icon name="check_circle" size={18} className="text-[var(--color-success)]" />
  ) : (
    <Icon name="cancel" size={18} className="text-[var(--color-error)]" />
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex min-h-[56px] items-center gap-[12px] px-[20px] py-[10px]">
      <StatusIcon ok={ok} />
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{label}</span>
        <span className="ml-2 text-[12px] text-[var(--color-text-tertiary)]">{detail}</span>
      </div>
    </div>
  )
}

async function openExternalUrl(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ComputerUseSettings() {
  const t = useTranslation()
  const addToast = useUIStore((s) => s.addToast)
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null)

  // App authorization state
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsError, setAppsError] = useState(false)
  const [appsSaved, setAppsSaved] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [clipboardAccess, setClipboardAccess] = useState(true)
  const [systemKeys, setSystemKeys] = useState(true)

  const fetchStatus = useCallback(async () => {
    setCheckState('loading')
    try {
      const s = await computerUseApi.getStatus()
      setStatus(s)
      setCheckState('ready')
    } catch {
      setCheckState('error')
    }
  }, [])

  const fetchApps = useCallback(async () => {
    setAppsLoading(true)
    setAppsError(false)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      setInstalledApps(appsResult.apps)
      setAuthorizedApps(configResult.authorizedApps)
      setAuthorizedBundleIds(new Set(configResult.authorizedApps.map(a => a.bundleId)))
      setClipboardAccess(configResult.grantFlags.clipboardRead)
      setSystemKeys(configResult.grantFlags.systemKeyCombos)
    } catch {
      setAppsError(true)
    } finally {
      setAppsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Load apps when environment is ready
  const envReady = status?.venv.created && status?.dependencies.installed
  useEffect(() => {
    if (envReady) fetchApps()
  }, [envReady, fetchApps])

  const handleSetup = async () => {
    setSetupRunning(true)
    setSetupResult(null)
    try {
      const result = await computerUseApi.runSetup()
      setSetupResult(result)
      await fetchStatus()
      if (result.success) await fetchApps()
    } catch {
      setSetupResult({ success: false, steps: [{ name: 'error', ok: false, message: 'Request failed' }] })
    } finally {
      setSetupRunning(false)
    }
  }

  const toggleApp = (app: InstalledApp) => {
    const newSet = new Set(authorizedBundleIds)
    let newAuthorized = [...authorizedApps]
    if (newSet.has(app.bundleId)) {
      newSet.delete(app.bundleId)
      newAuthorized = newAuthorized.filter(a => a.bundleId !== app.bundleId)
    } else {
      newSet.add(app.bundleId)
      newAuthorized.push({
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      })
    }
    setAuthorizedBundleIds(newSet)
    setAuthorizedApps(newAuthorized)

    // Auto-save
    computerUseApi.setAuthorizedApps({
      authorizedApps: newAuthorized,
      grantFlags: { clipboardRead: clipboardAccess, clipboardWrite: clipboardAccess, systemKeyCombos: systemKeys },
    }).then(() => {
      setAppsSaved(true)
      setTimeout(() => setAppsSaved(false), 1500)
    }).catch(() => {
      setAuthorizedBundleIds(authorizedBundleIds)
      setAuthorizedApps(authorizedApps)
      addToast({ type: 'error', message: t('settings.computerUse.saveFailed') })
    })
  }

  const toggleFlag = (flag: 'clipboard' | 'systemKeys', value: boolean) => {
    if (flag === 'clipboard') setClipboardAccess(value)
    else setSystemKeys(value)

    computerUseApi.setAuthorizedApps({
      authorizedApps,
      grantFlags: {
        clipboardRead: flag === 'clipboard' ? value : clipboardAccess,
        clipboardWrite: flag === 'clipboard' ? value : clipboardAccess,
        systemKeyCombos: flag === 'systemKeys' ? value : systemKeys,
      },
    }).catch(() => {
      if (flag === 'clipboard') setClipboardAccess(!value)
      else setSystemKeys(!value)
      addToast({ type: 'error', message: t('settings.computerUse.saveFailed') })
    })
  }

  const allReady =
    status?.supported &&
    status.python.installed &&
    status.venv.created &&
    status.dependencies.installed

  const screenRecordingReady = status ? status.permissions.screenRecording !== false : null
  const pythonDownloadUrl = status
    ? PYTHON_DOWNLOAD_URLS[status.platform] ?? 'https://www.python.org/downloads/'
    : 'https://www.python.org/downloads/'

  // Filter apps by search query
  const filteredApps = useMemo(() => {
    if (!searchQuery) return installedApps
    const q = searchQuery.toLowerCase()
    return installedApps.filter(
      a => a.displayName.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q)
    )
  }, [installedApps, searchQuery])

  // Sort order snapshot: authorized-first ordering is captured when the list
  // loads or the search query changes, so toggling a checkbox never reorders
  // rows under the cursor. Re-sorted on refresh / search exit.
  const sortAuthRef = useRef<Set<string>>(new Set())
  const sortInputsRef = useRef<{ apps: InstalledApp[]; query: string } | null>(null)
  if (sortInputsRef.current?.apps !== installedApps || sortInputsRef.current?.query !== searchQuery) {
    sortInputsRef.current = { apps: installedApps, query: searchQuery }
    sortAuthRef.current = new Set(authorizedBundleIds)
  }

  // Sort: authorized apps first, then alphabetical
  const sortedApps = useMemo(() => {
    return [...filteredApps].sort((a, b) => {
      const aAuth = sortAuthRef.current.has(a.bundleId) ? 0 : 1
      const bAuth = sortAuthRef.current.has(b.bundleId) ? 0 : 1
      if (aAuth !== bAuth) return aAuth - bAuth
      return a.displayName.localeCompare(b.displayName)
    })
  }, [filteredApps])

  return (
    <SettingsPage icon="mouse" title={t('settings.computerUse.title')} description={t('settings.computerUse.description')}>
      <div className="flex flex-col gap-[24px]">
        {checkState === 'loading' ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">
          {t('common.loading')}
        </div>
      ) : checkState === 'error' ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-error)]">
          {t('settings.computerUse.checkFailed')}
          <button onClick={fetchStatus} className="ml-2 underline">{t('common.retry')}</button>
        </div>
      ) : status ? (
        <>
          {!status.supported && (
            <div className="px-[16px] py-[12px] rounded-[12px] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/40 text-[13px] text-[var(--color-warning)]">
              {t('settings.computerUse.notSupported')}
            </div>
          )}

          {/* Status checks */}
          <SettingsSection>
            <StatusRow
              label={t('settings.computerUse.python')}
              ok={status.python.installed}
              detail={
                status.python.installed
                  ? `${t('settings.computerUse.pythonFound')} — ${status.python.version} (${status.python.path})`
                  : t('settings.computerUse.pythonNotFound')
              }
            />
            <StatusRow
              label={t('settings.computerUse.venv')}
              ok={status.venv.created}
              detail={status.venv.created ? `${t('settings.computerUse.venvReady')} — ${status.venv.path}` : t('settings.computerUse.venvNotReady')}
            />
            <StatusRow
              label={t('settings.computerUse.deps')}
              ok={status.dependencies.installed}
              detail={status.dependencies.installed ? t('settings.computerUse.depsReady') : t('settings.computerUse.depsNotReady')}
            />
          </SettingsSection>

          {/* macOS Permissions — only shown on macOS (darwin) */}
          {envReady && status.platform === 'darwin' && (
            <>
              <SettingsSection>
              <StatusRow
                label={t('settings.computerUse.accessibility')}
                ok={status.permissions.accessibility}
                detail={
                  status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                    : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                      : t('settings.computerUse.permDenied')
                }
              />
              <StatusRow
                label={t('settings.computerUse.screenRecording')}
                ok={screenRecordingReady}
                detail={
                  status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                    : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                      : t('settings.computerUse.permScreenRecordingUnknownSoft')
                }
              />
              </SettingsSection>
            </>
          )}

          {allReady && (status.platform !== 'darwin' || (status.permissions.accessibility && screenRecordingReady)) && (
            <div className="px-[16px] py-[12px] rounded-[12px] bg-[var(--color-success)]/10 border border-[var(--color-brand)]/40 text-[13px] text-[var(--color-success)] flex items-center gap-2">
              <Icon name="verified" size={18} />
              {t('settings.computerUse.allReady')}
            </div>
          )}

          {setupResult && (
            <div className={`rounded-[12px] border px-[16px] py-[12px] space-y-2 ${setupResult.success ? 'bg-[var(--color-success)]/5 border-[var(--color-success)]/30' : 'bg-[var(--color-error)]/5 border-[var(--color-error)]/30'}`}>
              <div className={`text-[13px] font-semibold ${setupResult.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {setupResult.success ? t('settings.computerUse.setupSuccess') : t('settings.computerUse.setupFail')}
              </div>
              {setupResult.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                  <StatusIcon ok={step.ok} />
                  <span>{step.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {!status.python.installed && (
              <Button
                type="button"
                onClick={() => openExternalUrl(pythonDownloadUrl)}
                icon={<Icon name="open_in_new" size={18} />}
              >
                {t('settings.computerUse.downloadPython')}
              </Button>
            )}
            {!envReady && status.python.installed && (
              <Button
                type="button"
                onClick={handleSetup}
                disabled={setupRunning}
                icon={<Icon name={setupRunning ? 'hourglass_empty' : 'download'} size={18} />}
              >
                {setupRunning ? t('settings.computerUse.setupRunning') : t('settings.computerUse.setupBtn')}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={fetchStatus}
              icon={<Icon name="refresh" size={18} />}
            >
              {t('settings.computerUse.recheckBtn')}
            </Button>
          </div>

          {/* ─── App Authorization Section ─── */}
          {envReady && (
            <SettingsSection
              title={t('settings.computerUse.appsTitle')}
              description={t('settings.computerUse.appsDescription')}
              action={appsSaved ? (
                <span className="text-[12px] font-medium text-[var(--color-success)] flex items-center gap-1">
                  <Icon name="check" size={14} />
                  {t('settings.computerUse.appsSaved')}
                </span>
              ) : undefined}
            >
              <SettingsRow label={t('settings.computerUse.flagClipboard')}>
                <Switch
                  checked={clipboardAccess}
                  onChange={(v) => toggleFlag('clipboard', v)}
                  ariaLabel={t('settings.computerUse.flagClipboard')}
                />
              </SettingsRow>
              <SettingsRow label={t('settings.computerUse.flagSystemKeys')}>
                <Switch
                  checked={systemKeys}
                  onChange={(v) => toggleFlag('systemKeys', v)}
                  ariaLabel={t('settings.computerUse.flagSystemKeys')}
                />
              </SettingsRow>

              <div className="px-[20px] py-[12px]">
                <div className="relative">
                  <Icon name="search" size={16} className="text-[var(--color-text-tertiary)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('settings.computerUse.appsSearch')}
                    className="h-[32px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] py-2 pl-9 pr-4 text-[13px] font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
                  />
                </div>
              </div>

              {/* App list */}
              {appsLoading ? (
                <div className="px-[20px] py-[24px] text-center text-[13px] text-[var(--color-text-tertiary)]">
                  {t('settings.computerUse.appsLoading')}
                </div>
              ) : appsError ? (
                <div className="flex flex-col items-center justify-center px-[20px] py-[40px] text-center">
                  <p className="text-[13px] font-semibold text-[var(--color-error)]">{t('settings.computerUse.checkFailed')}</p>
                  <button onClick={fetchApps} className="mt-2 text-[13px] underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">{t('common.retry')}</button>
                </div>
              ) : installedApps.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-[20px] py-[40px] text-center">
                  <Icon name="computer" size={28} className="text-[var(--color-text-tertiary)] mb-[8px]" />
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('settings.computerUse.appsEmpty')}</p>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto border-t border-[var(--color-border-separator)]">
                  {sortedApps.map(app => {
                    const isAuthorized = authorizedBundleIds.has(app.bundleId)
                    return (
                      <button
                        key={app.bundleId}
                        role="checkbox"
                        aria-checked={isAuthorized}
                        aria-label={app.displayName}
                        onClick={() => toggleApp(app)}
                        className={`w-full flex min-h-[56px] items-center gap-[12px] px-[20px] py-[10px] text-left transition-colors hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border-separator)] last:border-b-0 ${
                          isAuthorized ? 'bg-[var(--color-accent-glow)]' : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${
                          isAuthorized
                            ? 'bg-[var(--color-brand)] border-[var(--color-brand)] shadow-[0_0_0_3px_var(--color-accent-glow)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {isAuthorized && (
                            <Icon name="check" size={14} className="text-[var(--color-on-primary)]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                            {app.displayName}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)] truncate font-mono">
                            {app.bundleId}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </SettingsSection>
          )}
        </>
      ) : null}
      </div>
    </SettingsPage>
  )
}
