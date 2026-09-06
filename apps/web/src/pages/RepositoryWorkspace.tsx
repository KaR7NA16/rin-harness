import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FolderGit2,
  FolderOpen,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { repositoriesApi, type RepositoryConnection, type RepositoryPackage, type RepositoryPackageEcosystem } from '../api/repositories'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'
import { Modal } from '../components/shared/Modal'
import { PageHeader } from '../components/shared/PageHeader'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { useTranslation } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

type ConnectionDialogMode = 'connect' | 'create'
type EnvironmentEcosystem = 'python' | 'r' | 'system' | 'node' | 'latex'

const ENVIRONMENT_ECOSYSTEMS: EnvironmentEcosystem[] = ['python', 'r', 'system', 'node', 'latex']

function replaceRepository(list: RepositoryConnection[], next: RepositoryConnection) {
  return list.map(item => item.id === next.id ? next : item)
}

/** 展示层路径缩写：保留末两段，完整路径由 title 提示承载 */
function shortenPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 2) return normalized
  return `…/${segments.slice(-2).join('/')}`
}

export function RepositoryWorkspace() {
  const t = useTranslation()
  const locale = useSettingsStore(state => state.locale)
  const addToast = useUIStore(state => state.addToast)
  const [repositories, setRepositories] = useState<RepositoryConnection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ecosystem, setEcosystem] = useState<EnvironmentEcosystem>('python')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dialogMode, setDialogMode] = useState<ConnectionDialogMode | null>(null)
  const [path, setPath] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [repositoryName, setRepositoryName] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = useMemo(
    () => repositories.find(repository => repository.id === selectedId) ?? repositories[0] ?? null,
    [repositories, selectedId],
  )

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    try {
      const response = await repositoriesApi.list()
      setRepositories(response.repositories)
      setSelectedId(current => current && response.repositories.some(item => item.id === current)
        ? current
        : response.repositories[0]?.id ?? null)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [addToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openConnectionDialog = (mode: ConnectionDialogMode) => {
    setDialogMode(mode)
    setPath('')
    setParentDir('')
    setRepositoryName('')
  }

  const chooseFolder = async (setter: (value: string) => void) => {
    if (!isTauriRuntime()) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selectedFolder = await open({ directory: true, multiple: false, title: t('repository.chooseFolder') })
      if (typeof selectedFolder === 'string') setter(selectedFolder)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const submitConnection = async () => {
    setSaving(true)
    try {
      const next = dialogMode === 'connect'
        ? await repositoriesApi.connect(path, repositoryName)
        : await repositoriesApi.create(parentDir, repositoryName)
      setRepositories(current => current.some(item => item.id === next.id) ? replaceRepository(current, next) : [...current, next])
      setSelectedId(next.id)
      setDialogMode(null)
      addToast({ type: 'success', message: dialogMode === 'connect' ? t('repository.connected') : t('repository.saved') })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle size={24} className="animate-spin text-[var(--color-text-tertiary)]" /></div>
  }

  const packages = selected?.environmentPackages ?? []
  const visiblePackages = packages.filter(pkg => pkg.ecosystem === ecosystem)
  const profiles = selected?.environmentProfiles ?? []

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] p-[24px]">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-[18px]">
        <PageHeader
          title={t('repository.title')}
          description={t('repository.subtitle')}
          actions={(
            <>
              <Button size="sm" variant="secondary" onClick={() => void refresh(true)} loading={refreshing}>
                <RefreshCw size={14} className="mr-1" />{t('common.refresh')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openConnectionDialog('connect')}>
                <FolderOpen size={14} className="mr-1" />{t('repository.connect')}
              </Button>
              <Button size="sm" onClick={() => openConnectionDialog('create')}>
                <Plus size={14} className="mr-1" />{t('repository.create')}
              </Button>
            </>
          )}
        />

        {!selected ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6 text-center">
            <FolderGit2 size={42} className="mb-4 text-[var(--color-text-tertiary)]" />
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{t('repository.empty')}</h2>
            <p className="mt-2 max-w-[420px] text-[13px] leading-5 text-[var(--color-text-tertiary)]">{t('repository.emptyDetail')}</p>
            <div className="mt-5 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => openConnectionDialog('connect')}>{t('repository.connectExisting')}</Button>
              <Button size="sm" onClick={() => openConnectionDialog('create')}>{t('repository.createNew')}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[18px]">
            <section className="overflow-hidden rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-separator)] px-[20px] py-[14px]">
                <div className="flex items-center gap-2">
                  <FolderGit2 size={17} className="text-[var(--color-signal)]" />
                  <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">{selected.name}</span>
                  <span className="rounded-full bg-[var(--color-surface-container-low)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)]">
                    {t('repository.configuredPackages', { count: packages.length })}
                  </span>
                </div>
                <span className="text-[12px] text-[var(--color-text-tertiary)]" title={selected.rootPath}>{t('repository.root')}: <code className="font-mono">{shortenPath(selected.rootPath)}</code></span>
              </div>

              <div className="px-[20px] py-[16px]">
                <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('repository.environment')}</h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{t('repository.environmentDetail')}</p>

                <div className="mt-4 flex gap-1 rounded-[10px] bg-[var(--color-surface-container-low)] p-1">
                  {ENVIRONMENT_ECOSYSTEMS.map(item => (
                    <button key={item} type="button" onClick={() => setEcosystem(item)} className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold ${ecosystem === item ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}>
                      {ecosystemLabel(t, item)}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  {visiblePackages.length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-12 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('repository.noPackages')}</div>
                  ) : visiblePackages.map(pkg => <PackageRow key={pkg.id} packageItem={pkg} />)}
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)]">
              <div className="border-b border-[var(--color-border-separator)] px-[20px] py-[14px]">
                <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('repository.profiles')}</h2>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{t('repository.profilesHint')}</p>
              </div>
              <div className="flex flex-col p-[8px]">
                {profiles.length === 0 ? (
                  <div className="px-[12px] py-[16px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('repository.noProfiles')}</div>
                ) : profiles.map(profile => <ProfileRow key={profile.metadata.id} profile={profile} />)}
              </div>
            </section>
          </div>
        )}
      </div>

      <Modal open={dialogMode !== null} onClose={() => setDialogMode(null)} title={dialogMode === 'connect' ? t('repository.connectTitle') : t('repository.createTitle')} width={520}>
        <div className="flex flex-col gap-4">
          {dialogMode === 'connect' ? (
            <div className="flex gap-2">
              <Input label={t('repository.path')} value={path} onChange={event => setPath(event.target.value)} placeholder="E:/projects/research-repository" className="flex-1" />
              {isTauriRuntime() && <Button size="sm" variant="secondary" className="mt-[24px]" onClick={() => void chooseFolder(setPath)}><FolderOpen size={14} /></Button>}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input label={t('repository.parentDir')} value={parentDir} onChange={event => setParentDir(event.target.value)} placeholder="E:/projects" className="flex-1" />
                {isTauriRuntime() && <Button size="sm" variant="secondary" className="mt-[24px]" onClick={() => void chooseFolder(setParentDir)}><FolderOpen size={14} /></Button>}
              </div>
              <Input label={t('repository.name')} value={repositoryName} onChange={event => setRepositoryName(event.target.value)} placeholder="research-repository" />
            </>
          )}
          {dialogMode === 'connect' && <Input label={`${t('repository.name')} (${locale === 'zh' ? '可选' : 'optional'})`} value={repositoryName} onChange={event => setRepositoryName(event.target.value)} placeholder="Research repository" />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialogMode(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => void submitConnection()} loading={saving} disabled={dialogMode === 'connect' ? !path.trim() : !parentDir.trim() || !repositoryName.trim()}>{dialogMode === 'connect' ? t('repository.connectAction') : t('repository.createAction')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ecosystemLabel(t: ReturnType<typeof useTranslation>, ecosystem: EnvironmentEcosystem) {
  if (ecosystem === 'python') return t('repository.python')
  if (ecosystem === 'r') return t('repository.r')
  if (ecosystem === 'system') return t('repository.system')
  if (ecosystem === 'node') return t('repository.node')
  return t('repository.latex')
}

function PackageRow({ packageItem }: { packageItem: RepositoryPackage }) {
  return (
    <div className="flex items-center gap-3 rounded-[11px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface)] text-[10px] font-bold text-[var(--color-signal)]">{packageBadge(packageItem.ecosystem)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{packageItem.name}</span>
          {packageItem.version && <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{packageItem.version}</code>}
        </div>
        {packageItem.description && <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">{packageItem.description}</div>}
      </div>
    </div>
  )
}

function ProfileRow({ profile }: { profile: RepositoryConnection['environmentProfiles'][number] }) {
  return (
    <div className="flex items-center gap-3 rounded-[11px] px-[12px] py-[10px]">
      <Package size={16} className="shrink-0 text-[var(--color-signal)]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{profile.metadata.name}</span>
          <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">v{profile.metadata.version}</span>
        </div>
        <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">{profile.spec.packages.join(', ') || '—'}</div>
      </div>
    </div>
  )
}

function packageBadge(ecosystem: RepositoryPackageEcosystem) {
  if (ecosystem === 'python') return 'Py'
  if (ecosystem === 'r') return 'R'
  if (ecosystem === 'system') return 'Sys'
  if (ecosystem === 'node') return 'Node'
  if (ecosystem === 'latex') return 'TeX'
  return 'Pkg'
}
