/**
 * SandboxesPage — sandbox-profile management and environment execution.
 *
 * Lists profiles, creates/edits them (container + remote fields), sets the
 * default, removes, probes capabilities, and executes an environment plan to
 * show the InstallRun status with per-stage logs. aiConfigure is deferred
 * (see README Known Limitations).
 */

import { useCallback, useEffect, useState } from 'react'
import type { Mounted } from '../api'
import { apiGet, apiPost } from '../api'
import type {
  CapabilitiesPayload,
  ContainerRuntime,
  InstallRun,
  InstallRunPayload,
  RemovedPayload,
  ResolverCapabilities,
  SandboxPayload,
  SandboxProfile,
  SandboxProfileInput,
  SandboxType,
  SandboxesPayload,
} from '../types'
import { ErrorBox } from '../components/ErrorBox'
import { Loading } from '../components/Loading'
import { Badge, toneForStatus } from '../components/Badge'
import { KeyValue } from '../components/KeyValue'

function failMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const TYPES: SandboxType[] = ['local-sandbox', 'container', 'remote']
const RUNTIMES: ContainerRuntime[] = ['auto', 'docker', 'podman']

interface SandboxFormState {
  name: string
  type: SandboxType
  runtime: string
  image: string
  workdir: string
  shell: string
  mounts: string
  env: string
  ports: string
  host: string
  user: string
  port: string
  identityFile: string
}

const EMPTY_FORM: SandboxFormState = {
  name: '',
  type: 'local-sandbox',
  runtime: 'auto',
  image: '',
  workdir: '',
  shell: '',
  mounts: '',
  env: '',
  ports: '',
  host: '',
  user: '',
  port: '',
  identityFile: '',
}

function parseJsonField(text: string, label: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    return { ok: false, message: label + ' must be valid JSON' }
  }
}

export default function SandboxesPage() {
  const [profiles, setProfiles] = useState<SandboxProfile[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<SandboxFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<ResolverCapabilities | null>(null)

  const [repositoryRoot, setRepositoryRoot] = useState('')
  const [environmentProfileId, setEnvironmentProfileId] = useState('')
  const [run, setRun] = useState<InstallRun | null>(null)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const data = await apiGet<Mounted<SandboxesPayload>>('/api/sandboxes')
      if (data.mounted === true) {
        setProfiles(data.sandboxes)
        setSelectedId(prev => prev ?? (data.sandboxes[0]?.id ?? null))
      } else {
        setListError('sandboxes service not mounted')
        setProfiles([])
      }
    } catch (cause) {
      setListError(failMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const selected = profiles.find(profile => profile.id === selectedId) ?? null

  const startEdit = (profile: SandboxProfile) => {
    setEditingId(profile.id)
    setForm({
      name: profile.name,
      type: profile.type,
      runtime: profile.container?.runtime ?? 'auto',
      image: profile.container?.image ?? '',
      workdir: profile.container?.workdir ?? '',
      shell: profile.container?.shell ?? '',
      mounts: profile.container?.mounts !== undefined ? JSON.stringify(profile.container.mounts) : '',
      env: profile.container?.env !== undefined ? JSON.stringify(profile.container.env) : '',
      ports: profile.container?.ports !== undefined ? JSON.stringify(profile.container.ports) : '',
      host: profile.remote?.host ?? '',
      user: profile.remote?.user ?? '',
      port: profile.remote?.port !== undefined ? String(profile.remote.port) : '',
      identityFile: profile.remote?.identityFile ?? '',
    })
  }

  const buildInput = (): SandboxProfileInput | string => {
    const input: SandboxProfileInput = { name: form.name.trim(), type: form.type }
    if (input.name === '') return 'name is required'
    if (form.type === 'container') {
      const container: NonNullable<SandboxProfileInput['container']> = { image: form.image.trim() }
      if (container.image === '') return 'container image is required'
      if (form.runtime !== '' && form.runtime !== 'auto') container.runtime = form.runtime as ContainerRuntime
      if (form.workdir.trim() !== '') container.workdir = form.workdir.trim()
      if (form.shell.trim() !== '') container.shell = form.shell.trim()
      const mounts = parseJsonField(form.mounts, 'mounts')
      if (!mounts.ok) return mounts.message
      if (mounts.value !== undefined) container.mounts = mounts.value as NonNullable<SandboxProfileInput['container']>['mounts']
      const env = parseJsonField(form.env, 'env')
      if (!env.ok) return env.message
      if (env.value !== undefined) container.env = env.value as Record<string, string>
      const ports = parseJsonField(form.ports, 'ports')
      if (!ports.ok) return ports.message
      if (ports.value !== undefined) container.ports = ports.value as NonNullable<SandboxProfileInput['container']>['ports']
      input.container = container
    }
    if (form.type === 'remote') {
      const remote: NonNullable<SandboxProfileInput['remote']> = { host: form.host.trim(), user: form.user.trim() }
      if (remote.host === '') return 'remote host is required'
      if (remote.user === '') return 'remote user is required'
      if (form.port.trim() !== '') {
        const port = Number(form.port)
        if (!Number.isInteger(port) || port <= 0) return 'remote port must be a positive integer'
        remote.port = port
      }
      if (form.identityFile.trim() !== '') remote.identityFile = form.identityFile.trim()
      input.remote = remote
    }
    return input
  }

  const submit = async () => {
    const input = buildInput()
    if (typeof input === 'string') {
      setActionError(input)
      return
    }
    setActionError(null)
    try {
      if (editingId === null) {
        const data = await apiPost<Mounted<SandboxPayload>>('/api/sandboxes', input)
        if (data.mounted === true) setSelectedId(data.sandbox.id)
      } else {
        const data = await apiPost<Mounted<SandboxPayload>>('/api/sandboxes/' + encodeURIComponent(editingId) + '/update', input)
        if (data.mounted === true) setSelectedId(data.sandbox.id)
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      void loadProfiles()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const setDefault = async (id: string) => {
    setActionError(null)
    try {
      await apiPost<Mounted<SandboxPayload>>('/api/sandboxes/' + encodeURIComponent(id) + '/default', {})
      void loadProfiles()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const remove = async (id: string) => {
    setActionError(null)
    try {
      await apiPost<Mounted<RemovedPayload>>('/api/sandboxes/' + encodeURIComponent(id) + '/remove', {})
      setSelectedId(null)
      void loadProfiles()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const probe = async (id: string) => {
    setActionError(null)
    setCapabilities(null)
    try {
      const data = await apiPost<Mounted<CapabilitiesPayload>>('/api/sandboxes/' + encodeURIComponent(id) + '/probe', {})
      if (data.mounted === true) setCapabilities(data.capabilities)
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const execute = async () => {
    if (selectedId === null || repositoryRoot.trim() === '' || environmentProfileId.trim() === '') {
      setActionError('select a profile and enter repositoryRoot + environmentProfileId')
      return
    }
    setActionError(null)
    setRun(null)
    try {
      const data = await apiPost<Mounted<InstallRunPayload>>('/api/sandboxes/execute', {
        profileId: selectedId,
        repositoryId: selected?.repositoryId ?? '',
        environmentProfileId: environmentProfileId.trim(),
        root: repositoryRoot.trim(),
      })
      if (data.mounted === true) setRun(data.run)
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Sandboxes</h1>
      {actionError !== null ? <ErrorBox message={actionError} /> : null}

      <div className="two-pane">
        <div className="list-pane">
          {loading ? (
            <Loading />
          ) : listError !== null ? (
            <ErrorBox message={listError} />
          ) : (
            <ul className="item-list">
              {profiles.map(profile => (
                <li key={profile.id}>
                  <button
                    type="button"
                    className={profile.id === selectedId ? 'item-button item-button-active' : 'item-button'}
                    onClick={() => { setSelectedId(profile.id); startEdit(profile) }}
                  >
                    <span className="item-title">{profile.name}</span>
                    <span className="item-subtitle">
                      {profile.type}{profile.isDefault ? ' · default' : ''}{profile.repositoryId !== undefined ? ' · ' + profile.repositoryId : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="detail-pane">
          {selected !== null ? (
            <>
              <div className="card">
                <KeyValue name="id" value={selected.id} />
                <KeyValue name="type" value={selected.type} />
                <KeyValue name="isDefault" value={selected.isDefault} />
                <div className="button-row">
                  <button type="button" onClick={() => void setDefault(selected.id)}>Set default</button>
                  <button type="button" onClick={() => void probe(selected.id)}>Probe</button>
                  <button type="button" onClick={() => void remove(selected.id)}>Delete</button>
                </div>
              </div>
              {capabilities !== null ? <CapabilitiesView capabilities={capabilities} /> : null}
            </>
          ) : (
            <div className="muted">No profile selected.</div>
          )}
        </div>
      </div>

      <SandboxForm form={form} setForm={setForm} editingId={editingId} onSubmit={() => void submit()} />

      <div className="card">
        <h3 className="section-title">execute environment plan</h3>
        <div className="form-grid">
          <label className="field-label" htmlFor="sb-root">repositoryRoot</label>
          <input id="sb-root" type="text" value={repositoryRoot} onChange={event => setRepositoryRoot(event.target.value)} />
          <label className="field-label" htmlFor="sb-env">environmentProfileId</label>
          <input id="sb-env" type="text" value={environmentProfileId} onChange={event => setEnvironmentProfileId(event.target.value)} />
          <button
            type="button"
            disabled={selectedId === null || repositoryRoot.trim() === '' || environmentProfileId.trim() === ''}
            onClick={() => void execute()}
          >
            Execute
          </button>
        </div>
        {run !== null ? <InstallRunView run={run} /> : null}
      </div>
    </div>
  )
}

function SandboxForm(props: {
  form: SandboxFormState
  setForm: (form: SandboxFormState) => void
  editingId: string | null
  onSubmit: () => void
}) {
  const { form, setForm, editingId, onSubmit } = props
  const patch = (fields: Partial<SandboxFormState>) => setForm({ ...form, ...fields })
  return (
    <div className="card">
      <h3 className="section-title">{editingId === null ? 'new profile' : 'edit profile'}</h3>
      <div className="form-grid">
        <label className="field-label" htmlFor="sb-name">name</label>
        <input id="sb-name" type="text" value={form.name} onChange={event => patch({ name: event.target.value })} />

        <label className="field-label" htmlFor="sb-type">type</label>
        <select id="sb-type" value={form.type} onChange={event => patch({ type: event.target.value as SandboxType })}>
          {TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>

        {form.type === 'container' ? (
          <>
            <label className="field-label" htmlFor="sb-runtime">runtime</label>
            <select id="sb-runtime" value={form.runtime} onChange={event => patch({ runtime: event.target.value })}>
              {RUNTIMES.map(runtime => <option key={runtime} value={runtime}>{runtime}</option>)}
            </select>
            <label className="field-label" htmlFor="sb-image">image</label>
            <input id="sb-image" type="text" value={form.image} onChange={event => patch({ image: event.target.value })} />
            <label className="field-label" htmlFor="sb-workdir">workdir</label>
            <input id="sb-workdir" type="text" value={form.workdir} onChange={event => patch({ workdir: event.target.value })} />
            <label className="field-label" htmlFor="sb-shell">shell</label>
            <input id="sb-shell" type="text" value={form.shell} onChange={event => patch({ shell: event.target.value })} />
            <label className="field-label" htmlFor="sb-mounts">mounts (JSON)</label>
            <textarea id="sb-mounts" className="editor-textarea" value={form.mounts} onChange={event => patch({ mounts: event.target.value })} />
            <label className="field-label" htmlFor="sb-env">env (JSON)</label>
            <textarea id="sb-env" className="editor-textarea" value={form.env} onChange={event => patch({ env: event.target.value })} />
            <label className="field-label" htmlFor="sb-ports">ports (JSON)</label>
            <textarea id="sb-ports" className="editor-textarea" value={form.ports} onChange={event => patch({ ports: event.target.value })} />
          </>
        ) : form.type === 'remote' ? (
          <>
            <label className="field-label" htmlFor="sb-host">host</label>
            <input id="sb-host" type="text" value={form.host} onChange={event => patch({ host: event.target.value })} />
            <label className="field-label" htmlFor="sb-user">user</label>
            <input id="sb-user" type="text" value={form.user} onChange={event => patch({ user: event.target.value })} />
            <label className="field-label" htmlFor="sb-port">port</label>
            <input id="sb-port" type="text" value={form.port} onChange={event => patch({ port: event.target.value })} />
            <label className="field-label" htmlFor="sb-identity">identityFile</label>
            <input id="sb-identity" type="text" value={form.identityFile} onChange={event => patch({ identityFile: event.target.value })} />
          </>
        ) : null}
        <button type="button" onClick={onSubmit}>{editingId === null ? 'Create' : 'Save'}</button>
      </div>
    </div>
  )
}

function CapabilitiesView({ capabilities }: { capabilities: ResolverCapabilities }) {
  return (
    <div className="card">
      <h3 className="section-title">capabilities</h3>
      <KeyValue name="platform" value={capabilities.platform} />
      {Object.entries(capabilities.runtimes).map(([key, value]) => (
        <KeyValue key={key} name={key} value={value} />
      ))}
    </div>
  )
}

function InstallRunView({ run }: { run: InstallRun }) {
  return (
    <div className="card">
      <div className="kv-row">
        <span className="kv-key">status</span>
        <Badge value={run.status} tone={toneForStatus(run.status)} />
      </div>
      <KeyValue name="id" value={run.id} />
      <KeyValue name="sandboxProfileId" value={run.sandboxProfileId} />
      <KeyValue name="environmentProfileId" value={run.environmentProfileId} />
      <h3 className="section-title">logs ({run.logs.length})</h3>
      {run.logs.length === 0 ? (
        <div className="muted">no stage logs</div>
      ) : (
        run.logs.map((log, index) => (
          <div key={index} className="stage">
            <div className="stage-head">
              <span className="mono stage-id">{log.stageId}</span>
              <Badge value={log.status} tone={toneForStatus(log.status)} />
            </div>
            <pre className="stage-commands">{log.command}</pre>
            {log.stdout !== undefined && log.stdout !== '' ? <pre className="stage-commands">{log.stdout}</pre> : null}
            {log.stderr !== undefined && log.stderr !== '' ? <pre className="stage-commands">{log.stderr}</pre> : null}
          </div>
        ))
      )}
    </div>
  )
}
