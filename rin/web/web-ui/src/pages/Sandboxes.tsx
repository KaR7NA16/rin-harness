import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Bot,
  CirclePlay,
  CircleStop,
  Container,
  LoaderCircle,
  Package,
  Pencil,
  PlugZap,
  Plus,
  Star,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import {
  sandboxesApi,
  type ContainerState,
  type EnvironmentInstallRun,
  type SandboxProfile,
  type SandboxRuntimeInfo,
} from '../api/sandboxes'
import { repositoriesApi, type EnvironmentProfile, type RepositoryConnection } from '../api/repositories'
import { sessionsApi } from '../api/sessions'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'
import { useTabStore } from '../stores/tabStore'
import { Modal } from '../components/shared/Modal'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { buildSandboxConfigurationPrompt } from './aiConfigurationPrompts'

type EditorState = {
  id?: string
  type: 'container' | 'remote'
  name: string
  image: string
  workdir: string
  shell: string
  mountsText: string
  envText: string
  portsText: string
  runtime: string
  host: string
  user: string
  port: string
  identityFile: string
  useDocker: boolean
  repositoryId?: string
  repositoryPath?: string
  environmentProfileId?: string
}

const EMPTY_EDITOR: EditorState = {
  type: 'container',
  name: '',
  image: '',
  workdir: '',
  shell: '',
  mountsText: '',
  envText: '',
  portsText: '',
  runtime: 'auto',
  host: '',
  user: '',
  port: '22',
  identityFile: '',
  useDocker: false,
  repositoryId: undefined,
  repositoryPath: '',
  environmentProfileId: undefined,
}

function parseMounts(text: string) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [host, guest, ro] = l.split(':')
      return { host: host!, guest: guest!, ro: ro === 'ro' }
    })
    .filter(m => m.host && m.guest)
}

function parseEnv(text: string) {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

function parsePorts(text: string) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [host, guest] = l.split(':')
      const h = Number(host)
      const g = Number(guest)
      return Number.isInteger(h) && h > 0 && Number.isInteger(g) && g > 0 ? { host: h, guest: g } : null
    })
    .filter((p): p is { host: number; guest: number } => p !== null)
}

export function Sandboxes() {
  const t = useTranslation()
  const addToast = useUIStore(s => s.addToast)
  const openTerminalTab = useTabStore(s => s.openTerminalTab)

  const [runtime, setRuntime] = useState<SandboxRuntimeInfo | null>(null)
  const [profiles, setProfiles] = useState<SandboxProfile[]>([])
  const [repositories, setRepositories] = useState<RepositoryConnection[]>([])
  const [environmentProfiles, setEnvironmentProfiles] = useState<Record<string, EnvironmentProfile[]>>({})
  const [installRuns, setInstallRuns] = useState<Record<string, EnvironmentInstallRun | undefined>>({})
  const [reviewRun, setReviewRun] = useState<EnvironmentInstallRun | null>(null)
  const [states, setStates] = useState<Record<string, ContainerState>>({})
  const [remoteStates, setRemoteStates] = useState<Record<string, { reachable: boolean; running?: boolean; containerId?: string }>>({})
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [{ profiles: list }, rt, repositoryResponse] = await Promise.all([
        sandboxesApi.list(),
        sandboxesApi.runtime().catch(() => ({ runtime: null, version: null }) as SandboxRuntimeInfo),
        repositoriesApi.list().catch(() => ({ repositories: [] })),
      ])
      setProfiles(list)
      setRuntime(rt)
      setRepositories(repositoryResponse.repositories)
      const [remoteEntries, stateEntries, environmentEntries, runEntries] = await Promise.all([
        Promise.all(
          list.filter(p => p.type === 'remote').map(async p => {
            try {
              return [p.id, await sandboxesApi.remoteState(p.id)] as const
            } catch {
              return [p.id, { reachable: false }] as const
            }
          }),
        ),
        Promise.all(
          list.filter(p => p.type === 'container').map(async p => {
            try {
              return [p.id, await sandboxesApi.state(p.id)] as const
            } catch {
              return [p.id, { exists: false, running: false }] as const
            }
          }),
        ),
        Promise.all(repositoryResponse.repositories.map(async repository => {
          try {
            const response = await repositoriesApi.environmentProfiles(repository.id)
            return [repository.id, response.profiles] as const
          } catch {
            return [repository.id, []] as const
          }
        })),
        Promise.all(list.filter(p => p.type === 'container').map(async p => {
          try {
            const response = await sandboxesApi.environmentRuns(p.id)
            return [p.id, response.runs[0]] as const
          } catch {
            return [p.id, undefined] as const
          }
        })),
      ])
      setRemoteStates(Object.fromEntries(remoteEntries))
      setStates(Object.fromEntries(stateEntries))
      setEnvironmentProfiles(Object.fromEntries(environmentEntries))
      setInstallRuns(Object.fromEntries(runEntries))
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const editorOpenRef = useRef(false)
  editorOpenRef.current = editor !== null

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (!editorOpenRef.current) void refresh()
    }, 8000)
    return () => clearInterval(timer)
  }, [refresh])

  const saveEditor = useCallback(async () => {
    if (!editor) return
    try {
      const existing = editor.id ? profiles.find(p => p.id === editor.id) : undefined
      const payload: Partial<SandboxProfile> & { name: string } = {
        name: editor.name.trim(),
        type: editor.type,
        ...(editor.repositoryId ? {
          repositoryId: editor.repositoryId,
          repositoryPath: editor.repositoryPath,
          ...(editor.environmentProfileId ? { environmentProfileId: editor.environmentProfileId } : {}),
        } : {}),
      }
      if (editor.type === 'container') {
        payload.container = {
          ...(existing?.container ?? {}),
          image: editor.image.trim(),
          ...(editor.workdir.trim() ? { workdir: editor.workdir.trim() } : {}),
          ...(editor.shell.trim() ? { shell: editor.shell.trim() } : {}),
          mounts: parseMounts(editor.mountsText),
          env: parseEnv(editor.envText),
          ...(editor.portsText.trim() ? { ports: parsePorts(editor.portsText) } : { ports: [] }),
          ...(editor.runtime === 'auto' ? { runtime: undefined } : { runtime: editor.runtime as 'docker' | 'podman' }),
        }
        if (!payload.name || !payload.container!.image) {
          addToast({ type: 'error', message: t('sandbox.nameImageRequired') })
          return
        }
      } else {
        payload.remote = {
          host: editor.host.trim(),
          user: editor.user.trim(),
          port: Number(editor.port) || 22,
          ...(editor.identityFile.trim() ? { identityFile: editor.identityFile.trim() } : {}),
          useDocker: editor.useDocker,
        }
        if (editor.useDocker) {
          payload.container = {
            ...(existing?.container ?? {}),
            image: editor.image.trim() || existing?.container?.image || 'docker.io/library/alpine:latest',
            ...(editor.shell.trim() ? { shell: editor.shell.trim() } : existing?.container?.shell ? { shell: existing.container.shell } : {}),
          }
        }
        if (!payload.name || !payload.remote.host || !payload.remote.user) {
          addToast({ type: 'error', message: t('sandbox.nameHostUserRequired') })
          return
        }
      }
      if (editor.id) {
        await sandboxesApi.update(editor.id, payload)
      } else {
        await sandboxesApi.create(payload)
      }
      setEditor(null)
      await refresh()
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    }
  }, [editor, addToast, refresh, t, profiles])

  const action = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await refresh()
      return true
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
      return false
    } finally {
      setBusy(null)
    }
  }, [addToast, refresh])

  const testRemote = useCallback(async (id: string) => {
    setBusy(id)
    try {
      const res = await sandboxesApi.testConnection(id)
      addToast({
        type: res.ok ? 'success' : 'error',
        message: res.ok
          ? t('sandbox.testOk', { ms: String(res.latencyMs ?? 0), info: res.hostInfo ?? '' })
          : t('sandbox.testFail', { error: res.error ?? '' }),
      })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, t])

  const openTerminal = useCallback((profile: SandboxProfile) => {
    void action(profile.id, async () => {
      const { command } = await sandboxesApi.interactiveCommand(profile.id)
      openTerminalTab({ title: `${profile.name}`, spawnCommand: command })
    })
  }, [action, openTerminalTab])

  const configureWithAi = useCallback(async (profile: SandboxProfile) => {
    const repository = repositories.find(item => item.id === profile.repositoryId)
    if (!repository) {
      addToast({ type: 'error', message: t('repository.empty') })
      return
    }
    setBusy(profile.id)
    try {
      const created = await sessionsApi.create({ workDir: repository.rootPath })
      const prompt = buildSandboxConfigurationPrompt({ profile, repository })
      useTabStore.getState().openTab(created.sessionId, `${profile.name} · Sandbox`, 'session', repository.rootPath)
      await useChatStore.getState().ensureSessionReady(created.sessionId, repository.rootPath)
      useChatStore.getState().queueComposerPrefill(created.sessionId, { text: prompt })
      useUIStore.getState().setActiveView('code')
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast, repositories, t])

  const prepareEnvironment = useCallback(async (profile: SandboxProfile) => {
    setBusy(profile.id)
    try {
      const run = await sandboxesApi.prepareEnvironment(profile.id)
      setInstallRuns(current => ({ ...current, [profile.id]: run }))
      setReviewRun(run)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast])

  const approveEnvironment = useCallback(async (run: EnvironmentInstallRun) => {
    setBusy(run.sandboxProfileId)
    try {
      const updated = await sandboxesApi.approveEnvironment(run.sandboxProfileId, run.id)
      setInstallRuns(current => ({ ...current, [run.sandboxProfileId]: updated }))
      setReviewRun(updated)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }, [addToast])

  if (loading) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={26} /></div>
  }

  return (
    <div className="h-full overflow-y-auto p-[24px]">
      <div className="mx-auto flex max-w-[860px] flex-col gap-[16px]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{t('sandbox.title')}</h1>
            <p className="mt-[2px] text-[12px] text-[var(--color-text-tertiary)]">
              {runtime?.runtime
                ? t('sandbox.runtimeOk', { runtime: runtime.runtime, version: runtime.version ?? '' })
                : t('sandbox.runtimeMissing')}
            </p>
          </div>
          <Button size="sm" onClick={() => setEditor({ ...EMPTY_EDITOR })}>
            <Plus size={14} className="mr-1" />{t('sandbox.new')}
          </Button>
        </div>

        {!runtime?.runtime && (
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--color-warning)] bg-[var(--color-surface-container-low)] px-[14px] py-[10px] text-[12.5px] text-[var(--color-text-secondary)]">
            <TriangleAlert size={15} className="text-[var(--color-warning)]" />
            {t('sandbox.noRuntimeHint')}
          </div>
        )}

        {profiles.length === 0 && (
          <div className="rounded-[12px] border border-dashed border-[var(--color-border)] py-[40px] text-center text-[13px] text-[var(--color-text-tertiary)]">
            <Container size={26} className="mx-auto mb-3 opacity-50" />
            {t('sandbox.empty')}
          </div>
        )}

        {profiles.map(profile => {
          const state = states[profile.id]
          const environmentProfile = environmentProfiles[profile.repositoryId ?? '']?.find(item => item.metadata.id === profile.environmentProfileId)
          const installRun = installRuns[profile.id]
          const isRemote = profile.type === 'remote'
          const isActive = isRemote ? (remoteStates[profile.id]?.reachable ?? false) : (state?.running ?? false)
          const isBusy = busy === profile.id
          return (
            <div key={profile.id} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
                          <div className="flex items-center gap-[10px]">
                <Box size={17} className="shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{profile.name}</span>
                {profile.isDefault && <Star size={13} className="fill-[var(--color-warning)] text-[var(--color-warning)]" />}
                <span className={`ml-1 rounded-full px-[8px] py-[1px] text-[11px] ${
                  isActive
                    ? 'bg-[var(--color-success-subtle,rgba(46,160,67,0.15))] text-[var(--color-success)]'
                    : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)]'
                }`}>
                  {isRemote
                    ? (remoteStates[profile.id]?.reachable
                        ? (remoteStates[profile.id]?.running
                            ? t('sandbox.running', { id: remoteStates[profile.id]?.containerId ?? '' })
                            : t('sandbox.reachable'))
                        : t('sandbox.unreachable'))
                    : state?.running
                      ? t('sandbox.running', { id: state.containerId ?? '' })
                      : state?.exists
                        ? t('sandbox.stopped')
                        : t('sandbox.notCreated')}
                </span>
                <div className="flex-1" />
                {isBusy && <LoaderCircle size={15} className="animate-spin text-[var(--color-text-tertiary)]" />}
              </div>
              <div className="mt-[8px] truncate font-mono text-[12px] text-[var(--color-text-tertiary)]">
                {profile.type === 'remote'
                  ? `${profile.remote?.user}@${profile.remote?.host}${profile.remote?.port && profile.remote.port !== 22 ? `:${profile.remote.port}` : ''}${profile.remote?.useDocker ? ' · docker' : ''}`
                  : `${profile.container?.image}${profile.container?.workdir ? ` · ${profile.container.workdir}` : ''}`}
              </div>
              {profile.type === 'container' && profile.repositoryId && (
                <div className="mt-[8px] flex flex-wrap items-center gap-[6px] text-[11.5px] text-[var(--color-text-secondary)]">
                  <span className="rounded-full bg-[var(--color-surface-container-low)] px-[8px] py-[2px]">
                    {environmentProfile?.metadata.name ?? t('sandbox.environmentProfileEmpty')}
                  </span>
                  {installRun && (
                    <button
                      type="button"
                      className="rounded-full bg-[var(--color-surface-container-low)] px-[8px] py-[2px] hover:bg-[var(--color-surface-hover)]"
                      onClick={() => setReviewRun(installRun)}
                    >
                      {t('sandbox.installStatus')}: {installRun.status}
                    </button>
                  )}
                </div>
              )}
              <div className="mt-[12px] flex flex-wrap gap-[6px]">
                {profile.type === 'remote' && (
                  <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void testRemote(profile.id)}>
                    <PlugZap size={14} className="mr-1" />{t('sandbox.test')}
                  </Button>
                )}
                {profile.type !== 'remote' && (!state?.running ? (
                  <Button size="sm" variant="secondary" disabled={isBusy || !runtime?.runtime} onClick={() => void action(profile.id, () => sandboxesApi.start(profile.id))}>
                    <CirclePlay size={14} className="mr-1" />{t('sandbox.start')}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void action(profile.id, () => sandboxesApi.stop(profile.id))}>
                    <CircleStop size={14} className="mr-1" />{t('sandbox.stop')}
                  </Button>
                ))}
                <Button size="sm" disabled={isBusy || (!isRemote && !runtime?.runtime)} onClick={() => openTerminal(profile)}>
                  <TerminalSquare size={14} className="mr-1" />{t('sandbox.openTerminal')}
                </Button>
                {!profile.isDefault && (
                  <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void action(profile.id, () => sandboxesApi.setDefault(profile.id))}>
                    <Star size={14} className="mr-1" />{t('sandbox.setDefault')}
                  </Button>
                )}
                <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => setEditor({
                  id: profile.id,
                  type: profile.type === 'remote' ? 'remote' : 'container',
                  name: profile.name,
                  image: profile.container?.image ?? '',
                  workdir: profile.container?.workdir ?? '',
                  shell: profile.container?.shell ?? '',
                  mountsText: (profile.container?.mounts ?? []).map(m => `${m.host}:${m.guest}${m.ro ? ':ro' : ''}`).join('\n'),
                  envText: Object.entries(profile.container?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
                  portsText: (profile.container?.ports ?? []).map(p => `${p.host}:${p.guest}`).join('\n'),
                  runtime: profile.container?.runtime ?? 'auto',
                  host: profile.remote?.host ?? '',
                  user: profile.remote?.user ?? '',
                  port: String(profile.remote?.port ?? 22),
                  identityFile: profile.remote?.identityFile ?? '',
                  useDocker: profile.remote?.useDocker ?? false,
                  repositoryId: profile.repositoryId,
                  repositoryPath: profile.repositoryPath ?? '',
                  environmentProfileId: profile.environmentProfileId,
                })}>
                  <Pencil size={14} className="mr-1" />{t('sandbox.edit')}
                </Button>
                <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => setDeleteId(profile.id)}>
                  <Trash2 size={14} className="mr-1" />{t('sandbox.delete')}
                </Button>
                {profile.type === 'container' && profile.repositoryId && (
                  <>
                    <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void configureWithAi(profile)}>
                      <Bot size={14} className="mr-1" />{t('repository.aiConfigure')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={isBusy || !profile.environmentProfileId} onClick={() => void prepareEnvironment(profile)}>
                      <Package size={14} className="mr-1" />{t('sandbox.prepareEnvironment')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 编辑对话框 */}
      <Modal open={editor !== null} onClose={() => setEditor(null)} title={editor?.id ? t('sandbox.edit') : t('sandbox.new')} width={520}>
        {editor && (
          <div className="flex flex-col gap-[12px] p-[20px]">
            <div className="flex gap-[6px]">
              {(['container', 'remote'] as const).map(tp => (
                <button
                  key={tp}
                  onClick={() => {
                    if (editor.id) return
                    setEditor({ ...editor, type: tp })
                  }}
                  disabled={editor.id !== undefined}
                  className={`flex-1 rounded-[8px] px-[10px] py-[7px] text-[12.5px] transition-colors ${
                    editor.type === tp
                      ? 'bg-[var(--color-surface-container-low)] font-semibold text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]'
                  } ${editor.id ? 'cursor-not-allowed opacity-60' : ''}`}
                  title={editor.id ? t('sandbox.typeLocked') : undefined}
                >
                  {tp === 'container' ? t('sandbox.type.container') : t('sandbox.type.remote')}
                </button>
              ))}
            </div>
            <Input label={t('sandbox.field.name')} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder="dev-node" />
            {editor.type === 'remote' && (
              <>
                <div className="grid grid-cols-3 gap-[8px]">
                  <div className="col-span-2">
                    <Input label={t('sandbox.field.host')} value={editor.host} onChange={e => setEditor({ ...editor, host: e.target.value })} placeholder="1.2.3.4 / example.com" />
                  </div>
                  <Input label={t('sandbox.field.port')} value={editor.port} onChange={e => setEditor({ ...editor, port: e.target.value })} placeholder="22" />
                </div>
                <Input label={t('sandbox.field.user')} value={editor.user} onChange={e => setEditor({ ...editor, user: e.target.value })} placeholder="root / ubuntu" />
                <Input label={t('sandbox.field.identityFile')} value={editor.identityFile} onChange={e => setEditor({ ...editor, identityFile: e.target.value })} placeholder="~/.ssh/id_ed25519 (留空用默认)" />
                <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
                  <input type="checkbox" checked={editor.useDocker} onChange={e => setEditor({ ...editor, useDocker: e.target.checked })} />
                  {t('sandbox.field.useDocker')}
                </label>
              </>
            )}
            {editor.type === 'container' && (
              <>
                <Input label={t('sandbox.field.image')} value={editor.image} onChange={e => setEditor({ ...editor, image: e.target.value })} placeholder="docker.io/library/node:22" />
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('repository.title')}</span>
                  <select
                    value={editor.repositoryId ?? ''}
                    onChange={e => {
                      const repository = repositories.find(item => item.id === e.target.value)
                      setEditor({
                        ...editor,
                        repositoryId: repository?.id,
                        repositoryPath: repository?.rootPath ?? '',
                        environmentProfileId: undefined,
                      })
                    }}
                    className="h-[40px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[12px] text-[13px] text-[var(--color-text-primary)] outline-none"
                  >
                    <option value="">{t('repository.empty')}</option>
                    {repositories.map(repository => <option key={repository.id} value={repository.id}>{repository.name} — {repository.rootPath}</option>)}
                  </select>
                  {editor.repositoryPath && <span className="font-mono text-[10.5px] text-[var(--color-text-tertiary)]">{t('repository.linked')}: {editor.repositoryPath}</span>}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('sandbox.environmentProfile')}</span>
                  <select
                    value={editor.environmentProfileId ?? ''}
                    disabled={!editor.repositoryId}
                    onChange={e => setEditor({ ...editor, environmentProfileId: e.target.value || undefined })}
                    className="h-[40px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[12px] text-[13px] text-[var(--color-text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{t('sandbox.environmentProfileEmpty')}</option>
                    {(environmentProfiles[editor.repositoryId ?? ''] ?? []).map(profile => (
                      <option key={profile.metadata.id} value={profile.metadata.id}>{profile.metadata.name} · {profile.metadata.version}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-[8px]">
                  <Input label={t('sandbox.field.runtime')} value={editor.runtime} onChange={e => setEditor({ ...editor, runtime: e.target.value })} placeholder="auto" />
                  <Input label={t('sandbox.field.workdir')} value={editor.workdir} onChange={e => setEditor({ ...editor, workdir: e.target.value })} placeholder="/workspace" />
                </div>
                <Input label={t('sandbox.field.shell')} value={editor.shell} onChange={e => setEditor({ ...editor, shell: e.target.value })} placeholder="/bin/bash" />
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('sandbox.field.mounts')}</span>
                  <textarea
                    value={editor.mountsText}
                    onChange={e => setEditor({ ...editor, mountsText: e.target.value })}
                    rows={3}
                    placeholder={'/home/me/project:/workspace\n/home/me/.config:/etc/app:ro'}
                    className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] font-mono text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('sandbox.field.env')}</span>
                  <textarea
                    value={editor.envText}
                    onChange={e => setEditor({ ...editor, envText: e.target.value })}
                    rows={3}
                    placeholder={'NODE_ENV=development\nFOO=bar'}
                    className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] font-mono text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('sandbox.field.ports')}</span>
                  <textarea
                    value={editor.portsText}
                    onChange={e => setEditor({ ...editor, portsText: e.target.value })}
                    rows={2}
                    placeholder={'8080:80\n3000:3000'}
                    className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] font-mono text-[12px] outline-none"
                  />
                </label>
              </>
            )}
            {editor.type === 'remote' && editor.useDocker && (
              <>
                <Input label={t('sandbox.field.image')} value={editor.image} onChange={e => setEditor({ ...editor, image: e.target.value })} placeholder="docker.io/library/alpine:latest" />
                <Input label={t('sandbox.field.shell')} value={editor.shell} onChange={e => setEditor({ ...editor, shell: e.target.value })} placeholder="/bin/bash" />
              </>
            )}
            <div className="flex justify-end gap-[8px]">
              <Button variant="secondary" onClick={() => setEditor(null)}>{t('common.cancel')}</Button>
              <Button onClick={() => void saveEditor()}>{t('common.save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={reviewRun !== null} onClose={() => setReviewRun(null)} title={t('sandbox.environmentReview')} width={720}>
        {reviewRun && (
          <div className="flex max-h-[72vh] flex-col gap-[14px] overflow-y-auto p-[20px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                  {environmentProfiles[reviewRun.repositoryId]?.find(profile => profile.metadata.id === reviewRun.environmentProfileId)?.metadata.name ?? reviewRun.environmentProfileId}
                </div>
                <div className="mt-1 text-[11.5px] text-[var(--color-text-tertiary)]">{t('sandbox.installStatus')}: {reviewRun.status}</div>
              </div>
              <span className="rounded-full bg-[var(--color-surface-container-low)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-secondary)]">
                {reviewRun.plan.packageCount} {t('sandbox.packages')}
              </span>
            </div>

            <div className="grid gap-[6px]">
              {reviewRun.plan.preflight.map(check => (
                <div key={check.id} className="flex items-start justify-between gap-4 rounded-[8px] bg-[var(--color-surface-container-low)] px-[10px] py-[7px] text-[11.5px]">
                  <span className="text-[var(--color-text-secondary)]">{check.message}</span>
                  <span className="shrink-0 font-mono text-[var(--color-text-tertiary)]">{check.status}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[10px]">
              {reviewRun.plan.stages.filter(stage => stage.commands.length > 0).map(stage => (
                <section key={stage.id} className="rounded-[9px] border border-[var(--color-border)] p-[10px]">
                  <div className="mb-[7px] text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{stage.id}</div>
                  <div className="flex flex-col gap-[6px]">
                    {stage.commands.map((command, index) => (
                      <code key={`${stage.id}-${index}`} className="overflow-x-auto rounded-[6px] bg-[var(--color-surface-container-low)] px-[9px] py-[7px] text-[11px] text-[var(--color-text-secondary)]">{command}</code>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {reviewRun.logs.length > 0 && (
              <div className="flex flex-col gap-[6px]">
                {reviewRun.logs.map((log, index) => (
                  <div key={`${log.stageId}-${index}`} className="rounded-[8px] border border-[var(--color-border)] px-[10px] py-[8px] text-[11px]">
                    <div className="flex justify-between gap-3"><code>{log.command}</code><span>{log.status}</span></div>
                    {log.stderr && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[var(--color-danger)]">{log.stderr}</pre>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-[8px]">
              <Button variant="secondary" onClick={() => setReviewRun(null)}>{t('common.close')}</Button>
              {reviewRun.status === 'resolved' && (
                <Button disabled={busy === reviewRun.sandboxProfileId} onClick={() => void approveEnvironment(reviewRun)}>
                  {busy === reviewRun.sandboxProfileId && <LoaderCircle size={14} className="mr-1 animate-spin" />}
                  {t('sandbox.approveEnvironment')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return
          const ok = await action(deleteId, () => sandboxesApi.remove(deleteId))
          if (ok) setDeleteId(null)
        }}
        title={t('sandbox.delete')}
        body={t('sandbox.deleteConfirm')}
        confirmLabel={t('sandbox.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={deleteId !== null && busy === deleteId}
      />
    </div>
  )
}
