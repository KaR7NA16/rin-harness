import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Box,
  Check,
  Database,
  FileOutput,
  FolderGit2,
  FolderOpen,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  Workflow,
} from 'lucide-react'
import { repositoriesApi, type RepositoryConnection, type RepositoryInstallPlan, type RepositoryPackage, type RepositoryPackageEcosystem } from '../api/repositories'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'
import { Modal } from '../components/shared/Modal'
import { isTauriRuntime } from '../lib/desktopRuntime'
import { useTranslation } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

type CategoryId = 'environment' | 'tools' | 'knowledge' | 'outputs' | 'skills' | 'workflows' | 'agents'
type ConnectionDialogMode = 'connect' | 'create'
type EnvironmentEcosystem = 'python' | 'r' | 'system' | 'node' | 'latex'

const CATEGORY_IDS: CategoryId[] = ['environment', 'tools', 'knowledge', 'outputs', 'skills', 'workflows', 'agents']
const ENVIRONMENT_ECOSYSTEMS: EnvironmentEcosystem[] = ['python', 'r', 'system', 'node', 'latex']
const EMPTY_DRAFT = { name: '', version: '', description: '', ecosystem: 'python' as RepositoryPackageEcosystem }

function categoryIcon(id: string) {
  if (id === 'environment') return Package
  if (id === 'tools') return Wrench
  if (id === 'knowledge') return Database
  if (id === 'skills') return Sparkles
  if (id === 'workflows') return Workflow
  if (id === 'agents') return Bot
  return FileOutput
}

function replaceRepository(list: RepositoryConnection[], next: RepositoryConnection) {
  return list.map(item => item.id === next.id ? next : item)
}

export function RepositoryWorkspace() {
  const t = useTranslation()
  const locale = useSettingsStore(state => state.locale)
  const addToast = useUIStore(state => state.addToast)
  const [repositories, setRepositories] = useState<RepositoryConnection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<CategoryId>('environment')
  const [ecosystem, setEcosystem] = useState<EnvironmentEcosystem>('python')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dialogMode, setDialogMode] = useState<ConnectionDialogMode | null>(null)
  const [path, setPath] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [repositoryName, setRepositoryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [packageDraft, setPackageDraft] = useState(EMPTY_DRAFT)
  const [showPackageForm, setShowPackageForm] = useState(false)
  const [plan, setPlan] = useState<RepositoryInstallPlan | null>(null)

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

  const updateSelected = useCallback(async (nextManifest: RepositoryConnection['manifest']) => {
    if (!selected) return
    setSaving(true)
    try {
      const next = await repositoriesApi.updateManifest(selected.id, nextManifest)
      setRepositories(current => replaceRepository(current, next))
      addToast({ type: 'success', message: t('repository.saved') })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }, [addToast, selected, t])

  const addPackage = useCallback(async () => {
    if (!selected || !packageDraft.name.trim()) return
    const environment = selected.manifest.categories.find(category => category.id === 'environment')
    if (!environment) return
    const packageRecord: RepositoryPackage = {
      id: `${packageDraft.ecosystem}-${packageDraft.name.trim()}-${Date.now()}`,
      name: packageDraft.name.trim(),
      ecosystem: packageDraft.ecosystem,
      ...(packageDraft.version.trim() ? { version: packageDraft.version.trim() } : {}),
      ...(packageDraft.description.trim() ? { description: packageDraft.description.trim() } : {}),
    }
    await updateSelected({
      ...selected.manifest,
      categories: selected.manifest.categories.map(category => category.id === 'environment'
        ? { ...category, packages: [...category.packages, packageRecord] }
        : category),
    })
    setPackageDraft(EMPTY_DRAFT)
    setShowPackageForm(false)
  }, [packageDraft, selected, updateSelected])

  const removePackage = useCallback(async (packageId: string) => {
    if (!selected) return
    await updateSelected({
      ...selected.manifest,
      categories: selected.manifest.categories.map(category => category.id === 'environment'
        ? { ...category, packages: category.packages.filter(pkg => pkg.id !== packageId) }
        : category),
    })
  }, [selected, updateSelected])

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

  const showInstallPlan = async () => {
    if (!selected) return
    try {
      setPlan(await repositoriesApi.installPlan(selected.id))
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle size={24} className="animate-spin text-[var(--color-text-tertiary)]" /></div>
  }

  const category = selected?.manifest.categories.find(item => item.id === categoryId)
  const categoryPackages = category?.packages ?? []
  const visiblePackages = categoryId === 'environment'
    ? categoryPackages.filter(pkg => pkg.ecosystem === ecosystem)
    : []

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] p-[24px]">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-[18px]">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-signal)]">
              <FolderGit2 size={14} /> {t('repository.title')}
            </div>
            <h1 className="mt-1 text-[22px] font-semibold text-[var(--color-text-primary)]">{t('repository.title')}</h1>
            <p className="mt-1 max-w-[680px] text-[13px] leading-5 text-[var(--color-text-tertiary)]">{t('repository.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refresh(true)} loading={refreshing}>
              <RefreshCw size={14} className="mr-1" />{t('common.retry')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openConnectionDialog('connect')}>
              <FolderOpen size={14} className="mr-1" />{t('repository.connect')}
            </Button>
            <Button size="sm" onClick={() => openConnectionDialog('create')}>
              <Plus size={14} className="mr-1" />{t('repository.create')}
            </Button>
          </div>
        </header>

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
          <div className="grid min-h-[520px] grid-cols-[238px_minmax(0,1fr)] overflow-hidden rounded-[16px] border border-[var(--color-border-separator)] bg-[var(--color-surface)] shadow-[0_16px_36px_rgba(0,0,0,0.05)]">
            <aside className="border-r border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-3">
              <div className="mb-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <div className="flex items-center gap-2">
                  <FolderGit2 size={17} className="text-[var(--color-signal)]" />
                  <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{selected.name}</span>
                </div>
                <div className="mt-2 inline-flex rounded-full bg-[var(--color-surface-container-low)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                  {storageModeLabel(t, selected.storage.mode)}
                </div>
                <dl className="mt-2 space-y-2 text-[10.5px] leading-4">
                  {selected.storage.seedPath && selected.storage.seedPath !== selected.storage.workingPath && (
                    <div>
                      <dt className="font-semibold text-[var(--color-text-secondary)]">{t('repository.seedPath')}</dt>
                      <dd className="break-all font-mono text-[var(--color-text-tertiary)]">{selected.storage.seedPath}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-semibold text-[var(--color-text-secondary)]">{t('repository.workingPath')}</dt>
                    <dd className="break-all font-mono text-[var(--color-text-tertiary)]">{selected.storage.workingPath}</dd>
                  </div>
                </dl>
                <div className={`mt-2 text-[10.5px] font-medium ${selected.storage.localModificationCount > 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  {t('repository.localChanges', { count: selected.storage.localModificationCount })}
                </div>
              </div>
              <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{t('repository.title')}</div>
              <div className="flex flex-col gap-1">
                {CATEGORY_IDS.map(id => {
                  const item = selected.manifest.categories.find(categoryItem => categoryItem.id === id)
                  const Icon = categoryIcon(id)
                  const count = item?.packages.length ?? 0
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCategoryId(id)}
                      className={`flex items-center gap-2 rounded-[9px] px-3 py-2.5 text-left text-[12.5px] transition-colors ${categoryId === id ? 'bg-[var(--color-surface-selected)] font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
                    >
                      <Icon size={15} />
                      <span className="flex-1">{categoryLabel(t, id)}</span>
                      <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">{count}</span>
                    </button>
                  )
                })}
              </div>
            </aside>

            <main className="min-w-0 p-[22px]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-separator)] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{categoryLabel(t, categoryId)}</h2>
                    <span className="rounded-full bg-[var(--color-surface-container-low)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)]">{t('repository.configuredPackages', { count: category?.packages.length ?? 0 })}</span>
                  </div>
                  {categoryId === 'environment' && <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{t('repository.environmentDetail')}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {categoryId === 'environment' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setShowPackageForm(value => !value)}>
                        <Plus size={14} className="mr-1" />{t('repository.addPackage')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void showInstallPlan()}>
                        <Box size={14} className="mr-1" />{t('repository.installPlan')}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {categoryId === 'environment' ? (
                <>
                  <div className="mt-4 flex gap-1 rounded-[10px] bg-[var(--color-surface-container-low)] p-1">
                      {ENVIRONMENT_ECOSYSTEMS.map(item => (
                      <button key={item} type="button" onClick={() => setEcosystem(item)} className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold ${ecosystem === item ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)]'}`}>
                        {ecosystemLabel(t, item)}
                      </button>
                    ))}
                  </div>

                  {showPackageForm && (
                    <div className="mt-4 rounded-[12px] border border-[var(--color-border-focus)] bg-[var(--color-surface-container-low)] p-3">
                      <div className="grid gap-2 md:grid-cols-[1.1fr_0.75fr_1.2fr_auto] md:items-end">
                        <Input label={t('repository.packageName')} value={packageDraft.name} onChange={event => setPackageDraft({ ...packageDraft, name: event.target.value })} placeholder="numpy" />
                        <Input label={t('repository.version')} value={packageDraft.version} onChange={event => setPackageDraft({ ...packageDraft, version: event.target.value })} placeholder="2.0.0" />
                        <Input label={t('repository.description')} value={packageDraft.description} onChange={event => setPackageDraft({ ...packageDraft, description: event.target.value })} placeholder="Scientific computing" />
                        <div className="flex gap-1">
                          <select value={packageDraft.ecosystem} onChange={event => setPackageDraft({ ...packageDraft, ecosystem: event.target.value as RepositoryPackageEcosystem })} className="h-[40px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12px] text-[var(--color-text-primary)]">
                            <option value="python">Python</option>
                            <option value="r">R</option>
                            <option value="system">{t('repository.system')}</option>
                            <option value="node">Node.js</option>
                            <option value="latex">LaTeX</option>
                          </select>
                          <Button size="sm" onClick={() => void addPackage()} disabled={!packageDraft.name.trim()}>{t('repository.save')}</Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2">
                    {visiblePackages.length === 0 ? (
                      <div className="rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-12 text-center text-[12px] text-[var(--color-text-tertiary)]">{t('repository.noPackages')}</div>
                    ) : visiblePackages.map(pkg => <PackageRow key={pkg.id} packageItem={pkg} onRemove={() => void removePackage(pkg.id)} />)}
                  </div>
                </>
              ) : categoryId === 'agents' ? (
                <div className="mt-8 rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-14 text-center">
                  <Bot size={28} className="mx-auto mb-3 text-[var(--color-signal)]" />
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{locale === 'zh' ? 'Agent 配置保存在该仓库的 agents 文件夹中。' : 'Agent configurations are stored in this repository\'s agents folder.'}</p>
                  <Button className="mt-4" size="sm" onClick={() => useUIStore.getState().openWorkspaceView('agents')}>
                    {t('sidebar.agentConfiguration')}
                  </Button>
                </div>
              ) : (
                <div className="mt-8 rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-16 text-center">
                  <Check size={26} className="mx-auto mb-3 text-[var(--color-text-tertiary)]" />
                  <p className="text-[13px] text-[var(--color-text-tertiary)]">{categoryLabel(t, categoryId)} {t('repository.noPackages')}</p>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-separator)] pt-4 text-[11px] text-[var(--color-text-tertiary)]">
                <span>{t('repository.root')}: <code className="font-mono">{selected.rootPath}</code></span>
                <span className="mx-1">·</span>
                <span>{t('repository.linked')}</span>
              </div>
            </main>
          </div>
        )}
      </div>

      <Modal open={dialogMode !== null} onClose={() => setDialogMode(null)} title={dialogMode === 'connect' ? t('repository.connectTitle') : t('repository.createTitle')} width={520}>
        <div className="flex flex-col gap-4">
          {dialogMode === 'connect' ? (
            <div className="flex gap-2">
              <Input label={t('repository.path')} value={path} onChange={event => setPath(event.target.value)} placeholder="E:\\projects\\research-repository" className="flex-1" />
              {isTauriRuntime() && <Button size="sm" variant="secondary" className="mt-[24px]" onClick={() => void chooseFolder(setPath)}><FolderOpen size={14} /></Button>}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input label={t('repository.parentDir')} value={parentDir} onChange={event => setParentDir(event.target.value)} placeholder="E:\\projects" className="flex-1" />
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

      <Modal open={plan !== null} onClose={() => setPlan(null)} title={t('repository.installPlan')} width={620}>
        {plan && (
          <div className="flex flex-col gap-3">
            <div className="rounded-[10px] bg-[var(--color-surface-container-low)] p-3 text-[12px] text-[var(--color-text-secondary)]">
              {plan.packageCount} packages · <code className="font-mono">{plan.repositoryPath}</code>
            </div>
            <div className="flex flex-col gap-2">
              {plan.commands.length === 0 ? <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('repository.noPackages')}</p> : plan.commands.map(command => <code key={command} className="break-all rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">{command}</code>)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function categoryLabel(t: ReturnType<typeof useTranslation>, id: string) {
  if (id === 'environment') return t('repository.environment')
  if (id === 'tools') return t('repository.tools')
  if (id === 'knowledge') return t('repository.knowledge')
  if (id === 'skills') return t('repository.skills')
  if (id === 'workflows') return t('repository.workflows')
  if (id === 'agents') return t('sidebar.agentConfiguration')
  return t('repository.outputs')
}

function ecosystemLabel(t: ReturnType<typeof useTranslation>, ecosystem: EnvironmentEcosystem) {
  if (ecosystem === 'python') return t('repository.python')
  if (ecosystem === 'r') return t('repository.r')
  if (ecosystem === 'system') return t('repository.system')
  if (ecosystem === 'node') return t('repository.node')
  return t('repository.latex')
}

function storageModeLabel(t: ReturnType<typeof useTranslation>, mode: RepositoryConnection['storage']['mode']) {
  if (mode === 'working') return t('repository.storageWorking')
  if (mode === 'development') return t('repository.storageDevelopment')
  return t('repository.storageConnected')
}

function PackageRow({ packageItem, onRemove }: { packageItem: RepositoryPackage; onRemove: () => void }) {
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
      <button type="button" aria-label={`Remove ${packageItem.name}`} onClick={onRemove} className="rounded-full p-2 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)]"><Trash2 size={14} /></button>
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
