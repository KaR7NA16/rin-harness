import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { useMcpStore } from '../stores/mcpStore'
import { useSessionStore } from '../stores/sessionStore'
import type { McpServerRecord, McpUpsertPayload } from '../types/mcp'
import { Icon } from '../components/shared/Icon'
import { Avatar } from '../components/shared/Avatar'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { SettingsPage, SettingsSection, Switch, SegmentedControl } from '../components/settings/SettingsLayout'

type EditorMode =
  | { type: 'list' }
  | { type: 'create' }
  | { type: 'edit'; server: McpServerRecord }
  | { type: 'details'; server: McpServerRecord }

type TransportKind = 'stdio' | 'http' | 'sse'

type StringRow = {
  id: string
  value: string
}

type KeyValueRow = {
  id: string
  key: string
  value: string
}

type McpDraft = {
  name: string
  transport: TransportKind
  command: string
  args: StringRow[]
  env: KeyValueRow[]
  url: string
  headers: KeyValueRow[]
  headersHelper: string
  oauthClientId: string
  oauthCallbackPort: string
}

type McpGroupKey =
  | 'plugin'
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'enterprise'
  | 'claudeai'
  | 'dynamic'

const MCP_GROUP_ORDER: McpGroupKey[] = [
  'plugin',
  'user',
  'project',
  'local',
  'managed',
  'enterprise',
  'claudeai',
  'dynamic',
]

const STATUS_TONE: Record<McpServerRecord['status'], string> = {
  connected: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20',
  checking: 'bg-[var(--color-surface-container)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  'needs-auth': 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20',
  failed: 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/20',
  disabled: 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createStringRow(value = ''): StringRow {
  return { id: createId(), value }
}

function createKeyValueRow(key = '', value = ''): KeyValueRow {
  return { id: createId(), key, value }
}

function createEmptyDraft(): McpDraft {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: [createStringRow('')],
    env: [createKeyValueRow()],
    url: '',
    headers: [createKeyValueRow()],
    headersHelper: '',
    oauthClientId: '',
    oauthCallbackPort: '',
  }
}

function isStdioConfig(config: McpServerRecord['config']): config is Extract<McpServerRecord['config'], { type: 'stdio' }> {
  return config.type === 'stdio'
}

function isRemoteConfig(config: McpServerRecord['config']): config is Extract<McpServerRecord['config'], { type: 'http' | 'sse' }> {
  return config.type === 'http' || config.type === 'sse'
}

function draftFromServer(server: McpServerRecord): McpDraft {
  const base = createEmptyDraft()
  base.name = server.name

  if (isStdioConfig(server.config)) {
    return {
      ...base,
      transport: 'stdio',
      command: server.config.command,
      args: (server.config.args.length ? server.config.args : ['']).map((value) => createStringRow(value)),
      env: Object.entries(server.config.env ?? {}).map(([key, value]) => createKeyValueRow(key, value)).concat(
        Object.keys(server.config.env ?? {}).length === 0 ? [createKeyValueRow()] : [],
      ),
    }
  }

  if (isRemoteConfig(server.config)) {
    return {
      ...base,
      transport: server.config.type,
      url: server.config.url,
      headers: Object.entries(server.config.headers ?? {}).map(([key, value]) => createKeyValueRow(key, value)).concat(
        Object.keys(server.config.headers ?? {}).length === 0 ? [createKeyValueRow()] : [],
      ),
      headersHelper: server.config.headersHelper ?? '',
      oauthClientId: server.config.oauth?.clientId ?? '',
      oauthCallbackPort: server.config.oauth?.callbackPort ? String(server.config.oauth.callbackPort) : '',
    }
  }

  return base
}

function draftSignature(draft: McpDraft): string {
  return JSON.stringify({
    name: draft.name,
    transport: draft.transport,
    command: draft.command,
    args: draft.args.map((row) => row.value),
    env: draft.env.map((row) => [row.key, row.value]),
    url: draft.url,
    headers: draft.headers.map((row) => [row.key, row.value]),
    headersHelper: draft.headersHelper,
    oauthClientId: draft.oauthClientId,
    oauthCallbackPort: draft.oauthCallbackPort,
  })
}

function rowsToRecord(rows: KeyValueRow[]) {
  const entries: Array<[string, string]> = []
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    entries.push([key, row.value])
  }
  return Object.fromEntries(entries)
}

function rowsToList(rows: StringRow[]) {
  return rows.map((row) => row.value.trim()).filter(Boolean)
}

function isValidCallbackPort(value: string) {
  if (!value) return true
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

function buildPayload(draft: McpDraft): McpUpsertPayload {
  if (draft.transport === 'stdio') {
    return {
      scope: 'user',
      config: {
        type: 'stdio',
        command: draft.command.trim(),
        args: rowsToList(draft.args),
        env: rowsToRecord(draft.env),
      },
    }
  }

  const oauthCallbackPort = draft.oauthCallbackPort.trim()
  const callbackPortNumber = isValidCallbackPort(oauthCallbackPort) && oauthCallbackPort
    ? Number(oauthCallbackPort)
    : undefined
  const oauthClientId = draft.oauthClientId.trim()

  return {
    scope: 'user',
    config: {
      type: draft.transport,
      url: draft.url.trim(),
      headers: rowsToRecord(draft.headers),
      ...(draft.headersHelper.trim() ? { headersHelper: draft.headersHelper.trim() } : {}),
      ...(oauthClientId || callbackPortNumber
        ? {
            oauth: {
              ...(oauthClientId ? { clientId: oauthClientId } : {}),
              ...(callbackPortNumber ? { callbackPort: callbackPortNumber } : {}),
            },
          }
        : {}),
    },
  }
}

function isDraftValid(draft: McpDraft) {
  if (!draft.name.trim()) return false
  if (draft.transport === 'stdio') return draft.command.trim().length > 0
  return draft.url.trim().length > 0
}

function transportLabel(transport: string, t: ReturnType<typeof useTranslation>) {
  switch (transport) {
    case 'stdio':
      return t('settings.mcp.transport.stdio')
    case 'http':
      return t('settings.mcp.transport.http')
    case 'sse':
      return t('settings.mcp.transport.sse')
    default:
      return transport
  }
}

function mcpIconFor(transport: string) {
  switch (transport) {
    case 'stdio': return 'terminal'
    case 'http': return 'language'
    case 'sse': return 'sensors'
    default: return 'hub'
  }
}

function getServerGroupKey(server: McpServerRecord): McpGroupKey {
  if (server.name.startsWith('plugin:')) return 'plugin'
  switch (server.scope) {
    case 'user':
    case 'project':
    case 'local':
    case 'managed':
    case 'enterprise':
    case 'claudeai':
    case 'dynamic':
      return server.scope
    default:
      return 'dynamic'
  }
}

function scopeLabel(server: McpServerRecord, t: ReturnType<typeof useTranslation>) {
  const group = getServerGroupKey(server)
  if (group === 'plugin') return t('settings.mcp.scope.plugin')
  return t(`settings.mcp.scope.${group}`)
}

function StatusBadge({ server }: { server: McpServerRecord }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-[8px] py-[2px] text-[11px] font-semibold ${STATUS_TONE[server.status]}`}>
      {server.statusLabel}
    </span>
  )
}

function getServerIdentityKey(server: Pick<McpServerRecord, 'name' | 'scope' | 'projectPath'>) {
  if (server.scope === 'local' || server.scope === 'project') {
    return `${server.scope}:${server.projectPath ?? ''}:${server.name}`
  }

  return `${server.scope}:${server.name}`
}

function ArraySection({
  title,
  rows,
  onChange,
  onAdd,
  onRemove,
  keyPlaceholder,
  valuePlaceholder,
  singleValue = false,
  addLabel,
  removeLabel,
}: {
  title: string
  rows: KeyValueRow[] | StringRow[]
  onChange: (id: string, field: 'key' | 'value', value: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  keyPlaceholder?: string
  valuePlaceholder: string
  singleValue?: boolean
  addLabel: string
  removeLabel: string
}) {
  return (
    <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
      <div className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[12px]">{title}</div>
      <div className="space-y-[10px]">
        {rows.map((row) => (
          <div key={row.id} className={`grid gap-[10px] ${singleValue ? 'grid-cols-[minmax(0,1fr)_32px]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px]'}`}>
            {!singleValue && 'key' in row && (
              <Input
                value={row.key}
                onChange={(event) => onChange(row.id, 'key', event.target.value)}
                placeholder={keyPlaceholder}
              />
            )}
            <Input
              value={row.value}
              onChange={(event) => onChange(row.id, 'value', event.target.value)}
              placeholder={valuePlaceholder}
            />
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              className="mt-[2px] flex h-[32px] w-[32px] items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label={removeLabel}
            >
              <Icon name="delete" size={17} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="flex h-[36px] w-full items-center justify-center gap-[6px] rounded-[10px] bg-[var(--color-surface-hover)] text-[12px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <Icon name="add" size={16} />
          {addLabel}
        </button>
      </div>
    </section>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[12px]">
      <div className="flex items-center gap-[8px] text-[var(--color-text-tertiary)] mb-[6px]">
        <Icon name={icon} size={16} />
        <span className="text-[12px] font-semibold">{label}</span>
      </div>
      <div className="text-[24px] font-semibold leading-tight text-[var(--color-text-primary)] tabular-nums">{value}</div>
    </div>
  )
}

function ServerRow({
  server,
  isBusy,
  onOpen,
  onToggle,
  t,
}: {
  server: McpServerRecord
  isBusy: boolean
  onOpen: () => void
  onToggle: () => void
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <div className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-[14px] px-[20px] py-[12px]">
      <Avatar seed={server.name} icon={mcpIconFor(server.transport)} variant="circle" size={36} active={server.enabled && server.status === 'connected'} />
      <div className="min-w-0">
        <div className="flex items-center gap-[10px] mb-[4px] min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{server.name}</div>
          <StatusBadge server={server} />
        </div>
        <div className="flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--color-text-tertiary)]">
          <span className="rounded-full bg-[var(--color-surface-hover)] px-[8px] py-[2px] font-medium text-[var(--color-text-secondary)]">
            {transportLabel(server.transport, t)}
          </span>
          <span className="rounded-full bg-[var(--color-surface-hover)] px-[8px] py-[2px] font-medium text-[var(--color-text-secondary)]">
            {scopeLabel(server, t)}
          </span>
          <span className="truncate">{server.summary}</span>
        </div>
        {server.statusDetail && (
          <div className="mt-[4px] text-[12px] text-[var(--color-text-tertiary)] truncate">{server.statusDetail}</div>
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        aria-label={t('settings.mcp.open', { name: server.name })}
      >
        <Icon name="settings" size={18} />
      </button>

      <Switch checked={server.enabled} disabled={isBusy || !server.canToggle} onChange={() => onToggle()} ariaLabel={server.name} />
    </div>
  )
}

export function McpSettings() {
  const { servers, selectedServer, isLoading, error, fetchServers, createServer, updateServer, deleteServer, toggleServer, reconnectServer, refreshServerStatus, selectServer } = useMcpStore()
  const addToast = useUIStore((s) => s.addToast)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const [view, setView] = useState<EditorMode>({ type: 'list' })
  const [draft, setDraft] = useState<McpDraft>(createEmptyDraft)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [busyServerName, setBusyServerName] = useState<string | null>(null)
  const [pendingDeleteServer, setPendingDeleteServer] = useState<McpServerRecord | null>(null)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const refreshInFlightRef = useRef(new Set<string>())

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const resolveOperationCwd = (server?: McpServerRecord) => server?.projectPath ?? currentWorkDir

  useEffect(() => {
    void fetchServers(undefined, currentWorkDir)
  }, [fetchServers, currentWorkDir])

  const groupedServers = useMemo(() => {
    const groups: Partial<Record<McpGroupKey, McpServerRecord[]>> = {}
    for (const server of servers) {
      const key = getServerGroupKey(server)
      ;(groups[key] ??= []).push(server)
    }
    return groups
  }, [servers])

  const stats = useMemo(() => ({
    total: servers.length,
    connected: servers.filter((server) => server.status === 'connected').length,
    attention: servers.filter((server) => server.status === 'failed' || server.status === 'needs-auth').length,
  }), [servers])

  const backToList = () => {
    const hasUnsavedChanges = (() => {
      if (view.type === 'create') return draftSignature(draft) !== draftSignature(createEmptyDraft())
      if (view.type === 'edit' && view.server) return draftSignature(draft) !== draftSignature(draftFromServer(view.server))
      return false
    })()
    if (hasUnsavedChanges) {
      setDiscardConfirmOpen(true)
      return
    }
    setView({ type: 'list' })
    selectServer(null)
  }

  const confirmDiscardChanges = () => {
    setDiscardConfirmOpen(false)
    setView({ type: 'list' })
    selectServer(null)
  }

  const beginCreate = () => {
    setDraft(createEmptyDraft())
    setView({ type: 'create' })
  }

  const beginEdit = (server: McpServerRecord) => {
    selectServer(server)
    if (!server.canEdit) {
      setView({ type: 'details', server })
      return
    }
    setDraft(draftFromServer(server))
    setView({ type: 'edit', server })
  }

  useEffect(() => {
    if (!selectedServer) return
    if (selectedServer.canEdit) {
      setDraft(draftFromServer(selectedServer))
      setView({ type: 'edit', server: selectedServer })
    } else {
      setView({ type: 'details', server: selectedServer })
    }
  }, [selectedServer])

  useEffect(() => {
    const pendingServers = servers.filter((server) => (
      server.enabled &&
      server.status === 'checking' &&
      !refreshInFlightRef.current.has(getServerIdentityKey(server))
    ))

    if (pendingServers.length === 0) return

    let cancelled = false
    const queue = [...pendingServers]
    const workerCount = Math.min(2, queue.length)

    const runWorker = async () => {
      while (!cancelled) {
        const server = queue.shift()
        if (!server) return

        const key = getServerIdentityKey(server)
        refreshInFlightRef.current.add(key)
        try {
          const updated = await refreshServerStatus(server, resolveOperationCwd(server))
          if (cancelled) return

          setView((current) => {
            if (current.type !== 'details' && current.type !== 'edit') return current
            if (getServerIdentityKey(current.server) !== key) return current
            return { ...current, server: updated }
          })
        } catch {
          // Keep passive checks silent. Explicit reconnect remains the action that
          // surfaces failures to the user.
        } finally {
          refreshInFlightRef.current.delete(key)
        }
      }
    }

    void Promise.all(Array.from({ length: workerCount }, () => runWorker()))

    return () => {
      cancelled = true
    }
  }, [servers, refreshServerStatus, currentWorkDir])

  const handleToggle = async (server: McpServerRecord) => {
    setBusyServerName(server.name)
    try {
      const updated = await toggleServer(server, resolveOperationCwd(server))
      addToast({
        type: 'success',
        message: updated.enabled ? t('settings.mcp.toast.enabled', { name: server.name }) : t('settings.mcp.toast.disabled', { name: server.name }),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.toast.toggleFailed'),
      })
    } finally {
      setBusyServerName(null)
    }
  }

  const handleReconnect = async (server: McpServerRecord) => {
    const optimistic = {
      ...server,
      status: 'checking' as const,
      statusLabel: t('status.reconnecting'),
      statusDetail: undefined,
    }

    setBusyServerName(server.name)
    setView((current) => {
      if (current.type !== 'details' && current.type !== 'edit') return current
      if (getServerIdentityKey(current.server) !== getServerIdentityKey(server)) return current
      return { ...current, server: optimistic }
    })
    try {
      const updated = await reconnectServer(server, resolveOperationCwd(server))
      addToast({
        type: updated.status === 'connected' ? 'success' : 'warning',
        message: updated.status === 'connected'
          ? t('settings.mcp.toast.reconnected', { name: server.name })
          : updated.statusDetail || updated.statusLabel,
      })
      if (view.type === 'edit') setView({ type: 'edit', server: updated })
      if (view.type === 'details') setView({ type: 'details', server: updated })
    } catch (error) {
      setView((current) => {
        if (current.type !== 'details' && current.type !== 'edit') return current
        if (getServerIdentityKey(current.server) !== getServerIdentityKey(server)) return current
        return { ...current, server }
      })
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.toast.reconnectFailed'),
      })
    } finally {
      setBusyServerName(null)
    }
  }

  const handleDelete = (server: McpServerRecord) => {
    setPendingDeleteServer(server)
  }

  const confirmDelete = async () => {
    const server = pendingDeleteServer
    if (!server) return
    setIsDeleting(true)
    try {
      await deleteServer(server, resolveOperationCwd(server))
      addToast({
        type: 'success',
        message: t('settings.mcp.toast.deleted', { name: server.name }),
      })
      setView({ type: 'list' })
      selectServer(null)
      setPendingDeleteServer(null)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.toast.deleteFailed'),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const deleteModal = (
    <ConfirmDialog
      open={pendingDeleteServer !== null}
      onClose={() => {
        if (isDeleting) return
        setPendingDeleteServer(null)
      }}
      onConfirm={confirmDelete}
      title={t('settings.mcp.form.deleteTitle')}
      body={pendingDeleteServer ? t('settings.mcp.form.deleteConfirmBody', { name: pendingDeleteServer.name }) : ''}
      confirmLabel={t('settings.mcp.form.confirmDelete')}
      cancelLabel={t('settings.mcp.form.cancel')}
      confirmVariant="danger"
      loading={isDeleting}
    />
  )

  const discardModal = (
    <ConfirmDialog
      open={discardConfirmOpen}
      onClose={() => setDiscardConfirmOpen(false)}
      onConfirm={confirmDiscardChanges}
      title={t('settings.mcp.form.discardTitle')}
      body={t('settings.mcp.form.discardBody')}
      confirmLabel={t('settings.mcp.form.discardConfirm')}
      cancelLabel={t('settings.mcp.form.cancel')}
      confirmVariant="danger"
    />
  )

  const handleSave = async () => {
    if (!isDraftValid(draft)) return
    if (!isValidCallbackPort(draft.oauthCallbackPort.trim())) {
      addToast({ type: 'error', message: t('settings.mcp.form.invalidCallbackPort') })
      return
    }
    setIsSaving(true)
    try {
      const payload = buildPayload(draft)
      const saved = view.type === 'edit'
        ? await updateServer(view.server, payload, resolveOperationCwd(view.server))
        : await createServer(draft.name.trim(), payload, currentWorkDir)

      addToast({
        type: 'success',
        message: view.type === 'edit'
          ? t('settings.mcp.toast.saved', { name: saved.name })
          : t('settings.mcp.toast.created', { name: saved.name }),
      })
      setView({ type: 'list' })
      selectServer(null)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('settings.mcp.toast.saveFailed'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const setDraftField = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const updateStringRows = (key: 'args', id: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((row) => (row.id === id ? { ...row, value } : row)),
    }))
  }

  const updateKeyValueRows = (key: 'env' | 'headers', id: string, field: 'key' | 'value', value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    }))
  }

  const addRow = (key: 'args' | 'env' | 'headers') => {
    setDraft((current) => ({
      ...current,
      [key]: [...current[key], key === 'args' ? createStringRow() : createKeyValueRow()],
    }))
  }

  const removeRow = (key: 'args' | 'env' | 'headers', id: string) => {
    setDraft((current) => {
      const next = current[key].filter((row) => row.id !== id)
      return {
        ...current,
        [key]: next.length > 0 ? next : [key === 'args' ? createStringRow() : createKeyValueRow()],
      }
    })
  }

  if (view.type === 'details') {
    const server = view.server
    return (
      <>
        <SettingsPage
          title={server.name}
          description={server.summary}
          action={server.canReconnect ? (
            <Button variant="secondary" size="sm" onClick={() => handleReconnect(server)} loading={busyServerName === server.name}>
              <Icon name="sync" size={16} />
              {t('settings.mcp.form.reconnect')}
            </Button>
          ) : undefined}
        >
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-[6px] text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            <Icon name="arrow_back" size={16} />
            {t('settings.mcp.form.back')}
          </button>

          <div className="flex flex-wrap items-center gap-[10px]">
            <StatusBadge server={server} />
            {server.statusDetail && (
              <span className="text-[12px] text-[var(--color-text-tertiary)]">{server.statusDetail}</span>
            )}
          </div>

          <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
            <div className="grid gap-[10px] md:grid-cols-2">
              <InfoPair label={t('settings.mcp.form.transport')} value={transportLabel(server.transport, t)} />
              <InfoPair label={t('settings.mcp.form.scope')} value={scopeLabel(server, t)} />
              <InfoPair label={t('settings.mcp.form.status')} value={server.statusLabel} />
              <InfoPair label={t('settings.mcp.form.location')} value={server.configLocation} />
            </div>
            <div className="mt-[16px]">
              <div className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[8px]">{t('settings.mcp.form.rawConfig')}</div>
              <pre className="overflow-x-auto rounded-[10px] bg-[var(--color-surface-container-low)] p-[14px] text-[12px] text-[var(--color-text-secondary)] font-mono">
                {JSON.stringify(server.config, null, 2)}
              </pre>
            </div>
          </section>
        </SettingsPage>
        {deleteModal}
        {discardModal}
      </>
    )
  }

  if (view.type === 'create' || view.type === 'edit') {
    const editing = view.type === 'edit'
    const targetServer = editing ? view.server : null
    const transportLocked = editing
    const isBusy = isSaving || isDeleting

    return (
      <>
        <SettingsPage
          title={editing ? t('settings.mcp.form.editTitle', { name: targetServer!.name }) : t('settings.mcp.form.createTitle')}
          description={editing ? t('settings.mcp.form.editHint') : t('settings.mcp.form.createHint')}
          action={(
            <>
              {editing && targetServer?.canReconnect && (
                <Button variant="secondary" size="sm" onClick={() => handleReconnect(targetServer)} loading={busyServerName === targetServer.name}>
                  <Icon name="sync" size={16} />
                  {t('settings.mcp.form.reconnect')}
                </Button>
              )}
              {editing && targetServer?.canRemove && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(targetServer)}
                  loading={isDeleting}
                >
                  <Icon name="delete" size={16} />
                  {t('settings.mcp.form.uninstall')}
                </Button>
              )}
            </>
          )}
        >
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-[6px] text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            <Icon name="arrow_back" size={16} />
            {t('settings.mcp.form.back')}
          </button>

          {editing && targetServer && (
            <div className="flex flex-wrap items-center gap-[10px]">
              <StatusBadge server={targetServer} />
              {targetServer.statusDetail && (
                <span className="text-[12px] text-[var(--color-text-tertiary)]">{targetServer.statusDetail}</span>
              )}
            </div>
          )}

          <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
            <Input
              label={t('settings.mcp.form.name')}
              value={draft.name}
              onChange={(event) => setDraftField('name', event.target.value)}
              placeholder={t('settings.mcp.form.namePlaceholder')}
              disabled={editing}
              required
            />
          </section>

          <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
            <div className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[4px]">
              {t('settings.mcp.form.scope')}
            </div>
            <p className="text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
              {t('settings.mcp.globalOnlyHint')}
            </p>
          </section>

          <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
            <div className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[4px]">
              {t('settings.mcp.form.transport')}
            </div>
            <SegmentedControl
              items={(['stdio', 'http', 'sse'] as TransportKind[]).map((transport) => ({
                value: transport,
                label: transportLabel(transport, t),
              }))}
              value={draft.transport}
              onChange={(transport) => setDraftField('transport', transport)}
              ariaLabel={t('settings.mcp.form.transport')}
              disabled={transportLocked}
            />
            {editing && (
              <p className="mt-[8px] text-[12px] text-[var(--color-text-tertiary)]">
                {t('settings.mcp.form.transportLocked')}
              </p>
            )}
          </section>

          {draft.transport === 'stdio' ? (
            <>
              <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
                <Input
                  label={t('settings.mcp.form.command')}
                  value={draft.command}
                  onChange={(event) => setDraftField('command', event.target.value)}
                  placeholder={t('settings.mcp.form.commandPlaceholder')}
                  required
                />
                <p className="mt-[8px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
                  {t('settings.mcp.form.commandHostHint')}
                </p>
              </section>

              <ArraySection
                title={t('settings.mcp.form.arguments')}
                rows={draft.args}
                onChange={(id, _field, value) => updateStringRows('args', id, value)}
                onAdd={() => addRow('args')}
                onRemove={(id) => removeRow('args', id)}
                singleValue
                valuePlaceholder={t('settings.mcp.form.argumentPlaceholder')}
                addLabel={t('settings.mcp.form.addArgument')}
                removeLabel={t('settings.mcp.form.removeArgument')}
              />

              <ArraySection
                title={t('settings.mcp.form.environmentVariables')}
                rows={draft.env}
                onChange={(id, field, value) => updateKeyValueRows('env', id, field, value)}
                onAdd={() => addRow('env')}
                onRemove={(id) => removeRow('env', id)}
                keyPlaceholder={t('settings.mcp.form.keyPlaceholder')}
                valuePlaceholder={t('settings.mcp.form.valuePlaceholder')}
                addLabel={t('settings.mcp.form.addEnv')}
                removeLabel={t('settings.mcp.form.removeEnv')}
              />
            </>
          ) : (
            <>
              <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
                <Input
                  label={draft.transport === 'http' ? t('settings.mcp.form.url') : t('settings.mcp.form.sseUrl')}
                  value={draft.url}
                  onChange={(event) => setDraftField('url', event.target.value)}
                  placeholder={t('settings.mcp.form.urlPlaceholder')}
                  required
                />
              </section>

              <ArraySection
                title={t('settings.mcp.form.headers')}
                rows={draft.headers}
                onChange={(id, field, value) => updateKeyValueRows('headers', id, field, value)}
                onAdd={() => addRow('headers')}
                onRemove={(id) => removeRow('headers', id)}
                keyPlaceholder={t('settings.mcp.form.keyPlaceholder')}
                valuePlaceholder={t('settings.mcp.form.valuePlaceholder')}
                addLabel={t('settings.mcp.form.addHeader')}
                removeLabel={t('settings.mcp.form.removeHeader')}
              />

              <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[16px]">
                <div className="grid gap-[12px] md:grid-cols-2">
                  <Input
                    label={t('settings.mcp.form.oauthClientId')}
                    value={draft.oauthClientId}
                    onChange={(event) => setDraftField('oauthClientId', event.target.value)}
                    placeholder={t('settings.mcp.form.oauthClientIdPlaceholder')}
                  />
                  <Input
                    label={t('settings.mcp.form.oauthCallbackPort')}
                    value={draft.oauthCallbackPort}
                    onChange={(event) => setDraftField('oauthCallbackPort', event.target.value)}
                    placeholder={t('settings.mcp.form.oauthCallbackPortPlaceholder')}
                  />
                </div>
                <div className="mt-[12px]">
                  <Input
                    label={t('settings.mcp.form.headersHelper')}
                    value={draft.headersHelper}
                    onChange={(event) => setDraftField('headersHelper', event.target.value)}
                    placeholder={t('settings.mcp.form.headersHelperPlaceholder')}
                  />
                </div>
              </section>
            </>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!isDraftValid(draft) || isBusy} loading={isSaving}>
              {t('settings.mcp.form.save')}
            </Button>
          </div>
        </SettingsPage>
        {deleteModal}
        {discardModal}
      </>
    )
  }

  return (
    <SettingsPage
      title={t('settings.tab.mcp')}
      action={(
        <Button variant="secondary" size="sm" onClick={beginCreate}>
          <Icon name="add" size={16} />
          {t('settings.mcp.addServer')}
        </Button>
      )}
    >
      {stats.total > 0 && (
        <div className="grid gap-[12px] md:grid-cols-3">
          <StatCard label={t('settings.mcp.stats.total')} value={stats.total} icon="dns" />
          <StatCard label={t('settings.mcp.stats.connected')} value={stats.connected} icon="check_circle" />
          <StatCard label={t('settings.mcp.stats.attention')} value={stats.attention} icon="error" />
        </div>
      )}

      {isLoading && servers.length === 0 ? (
        <div className="flex justify-center py-[64px]">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[24px] py-[64px] text-center">
          <Icon name="error" size={32} className="text-[var(--color-error)] mb-[12px] block" />
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[4px]">{error}</p>
          <button
            type="button"
            onClick={() => void fetchServers(undefined, currentWorkDir)}
            className="mt-[8px] text-[13px] text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[24px] py-[64px] text-center">
          <div className="mb-[12px] flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[var(--color-surface-container)]">
            <Icon name="dns" size={28} className="text-[var(--color-text-tertiary)]" />
          </div>
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-[4px]">{t('settings.mcp.empty')}</p>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.mcp.emptyHint')}</p>
        </div>
      ) : (
        <>
          {MCP_GROUP_ORDER.map((group) => {
            const groupServers = groupedServers[group]
            if (!groupServers?.length) return null

            return (
              <SettingsSection
                key={group}
                title={group === 'plugin' ? t('settings.mcp.scope.plugin') : t(`settings.mcp.scope.${group}`)}
                action={<span className="text-[12px] text-[var(--color-text-tertiary)] tabular-nums">{groupServers.length}</span>}
              >
                {groupServers.map((server) => (
                  <ServerRow
                    key={getServerIdentityKey(server)}
                    server={server}
                    isBusy={busyServerName === server.name}
                    onOpen={() => beginEdit(server)}
                    onToggle={() => void handleToggle(server)}
                    t={t}
                  />
                ))}
              </SettingsSection>
            )
          })}
        </>
      )}
      {deleteModal}
        {discardModal}
    </SettingsPage>
  )
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] bg-[var(--color-surface-container-low)] px-[14px] py-[10px]">
      <div className="text-[11px] font-semibold text-[var(--color-text-tertiary)] mb-[4px]">{label}</div>
      <div className="text-[13px] text-[var(--color-text-primary)] break-all">{value}</div>
    </div>
  )
}
