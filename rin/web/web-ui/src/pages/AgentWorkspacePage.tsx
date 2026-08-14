/**
 * AgentWorkspacePage — repository agent CRUD, projection, and AI proposals.
 *
 * Lists repository agents (with their content revision), creates/edits them,
 * projects them into a preset root, and drafts new records from an AI proposal
 * that the user reviews before saving.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Mounted } from '../api'
import { apiGet, apiPost } from '../api'
import type {
  AgentInput,
  AgentPayload,
  AgentPermissionMode,
  AgentProposal,
  AgentRecord,
  AgentsPayload,
  ProjectionPayload,
  ProposalPayload,
} from '../types'
import { ErrorBox } from '../components/ErrorBox'
import { Loading } from '../components/Loading'
import { KeyValue } from '../components/KeyValue'

const PERMISSION_MODES: (AgentPermissionMode | '')[] = ['', 'default', 'acceptEdits', 'plan', 'bypassPermissions']

function failMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

interface AgentFormState {
  name: string
  description: string
  systemPrompt: string
  model: string
  permissionMode: AgentPermissionMode | ''
  environmentProfileId: string
  tools: string
}

const EMPTY_FORM: AgentFormState = {
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  permissionMode: '',
  environmentProfileId: '',
  tools: '',
}

export default function AgentWorkspacePage() {
  const [root, setRoot] = useState('')
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [projection, setProjection] = useState<string[] | null>(null)
  const [instructions, setInstructions] = useState('')
  const [proposing, setProposing] = useState(false)

  const selected = agents.find(agent => agent.name === selectedId) ?? null

  const loadAgents = useCallback(async (repoRoot: string) => {
    setLoading(true)
    setListError(null)
    try {
      const path = repoRoot.trim() === '' ? '/api/agents' : '/api/agents?root=' + encodeURIComponent(repoRoot.trim())
      const data = await apiGet<Mounted<AgentsPayload>>(path)
      if (data.mounted === true) {
        setAgents(data.agents)
        setSelectedId(prev => prev ?? (data.agents[0]?.name ?? null))
      } else {
        setListError('agents service not mounted')
        setAgents([])
      }
    } catch (cause) {
      setListError(failMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAgents('')
  }, [loadAgents])

  const startEdit = (agent: AgentRecord) => {
    setEditingName(agent.name)
    setForm({
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: agent.model ?? '',
      permissionMode: agent.permissionMode ?? '',
      environmentProfileId: agent.resources.environmentProfileId ?? '',
      tools: agent.tools.join(', '),
    })
  }

  const withRoot = (extra: Record<string, unknown>): Record<string, unknown> => ({
    ...(root.trim() !== '' ? { root: root.trim() } : {}),
    ...extra,
  })

  const buildInput = (): AgentInput | string => {
    const name = form.name.trim()
    const description = form.description.trim()
    if (name === '') return 'name is required'
    if (description === '') return 'description is required'
    if (form.systemPrompt === '') return 'systemPrompt is required'
    return {
      name,
      description,
      systemPrompt: form.systemPrompt,
      ...(form.model.trim() !== '' ? { model: form.model.trim() } : {}),
      ...(form.permissionMode !== '' ? { permissionMode: form.permissionMode } : {}),
      tools: form.tools.split(',').map(tool => tool.trim()).filter(tool => tool !== ''),
      ...(form.environmentProfileId.trim() !== ''
        ? { resources: { environmentProfileId: form.environmentProfileId.trim() } }
        : {}),
    }
  }

  const submit = async () => {
    const input = buildInput()
    if (typeof input === 'string') {
      setActionError(input)
      return
    }
    setActionError(null)
    try {
      const path = editingName === null
        ? '/api/agents'
        : '/api/agents/' + encodeURIComponent(editingName) + '/update'
      const data = await apiPost<Mounted<AgentPayload>>(path, withRoot({ input }))
      if (data.mounted === true) setSelectedId(data.agent.name)
      setForm(EMPTY_FORM)
      setEditingName(null)
      void loadAgents(root)
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const remove = async (name: string) => {
    setActionError(null)
    try {
      await apiPost<Mounted<{ deleted: boolean }>>('/api/agents/' + encodeURIComponent(name) + '/delete', withRoot({}))
      setSelectedId(null)
      setEditingName(null)
      setForm(EMPTY_FORM)
      void loadAgents(root)
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const project = async () => {
    setActionError(null)
    setProjection(null)
    try {
      const data = await apiPost<Mounted<ProjectionPayload>>('/api/agents/project', withRoot({}))
      if (data.mounted === true) setProjection(data.ids)
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const propose = async () => {
    const text = instructions.trim()
    if (text === '') {
      setActionError('instructions is required')
      return
    }
    setActionError(null)
    setProposing(true)
    try {
      const data = await apiPost<Mounted<ProposalPayload>>('/api/agents/propose', withRoot({ instructions: text }))
      if (data.mounted === true) fillFromProposal(data.proposal)
    } catch (cause) {
      setActionError(failMessage(cause))
    } finally {
      setProposing(false)
    }
  }

  const fillFromProposal = (proposal: AgentProposal) => {
    setEditingName(null)
    setForm({
      name: proposal.name,
      description: proposal.description,
      systemPrompt: proposal.systemPrompt,
      model: proposal.model ?? '',
      permissionMode: proposal.permissionMode ?? '',
      environmentProfileId: '',
      tools: proposal.tools.join(', '),
    })
  }

  return (
    <div className="page">
      <h1 className="page-title">Agents</h1>
      {actionError !== null ? <ErrorBox message={actionError} /> : null}

      <div className="page-toolbar">
        <label className="field-label" htmlFor="agent-root">repositoryRoot</label>
        <input id="agent-root" type="text" value={root} onChange={event => setRoot(event.target.value)} placeholder="optional" />
        <button type="button" onClick={() => void loadAgents(root)}>Load</button>
        <button type="button" onClick={() => void project()}>Project</button>
      </div>

      {projection !== null ? (
        <div className="card">
          <h3 className="section-title">projection ids</h3>
          <pre className="json-detail">{JSON.stringify(projection, null, 2)}</pre>
        </div>
      ) : null}

      <div className="two-pane">
        <div className="list-pane">
          {loading ? (
            <Loading />
          ) : listError !== null ? (
            <ErrorBox message={listError} />
          ) : agents.length === 0 ? (
            <div className="muted">no agents — create one or ask for a proposal</div>
          ) : (
            <ul className="item-list">
              {agents.map(agent => (
                <li key={agent.name}>
                  <button
                    type="button"
                    className={agent.name === selectedId ? 'item-button item-button-active' : 'item-button'}
                    onClick={() => { setSelectedId(agent.name); startEdit(agent) }}
                  >
                    <span className="item-title">{agent.name}</span>
                    <span className="item-subtitle">
                      {[agent.model ?? 'default model', agent.permissionMode ?? 'default', agent.resources.environmentProfileId ?? 'no env']
                        .join(' · ')}
                      {' · rev ' + agent.revision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="detail-pane">
          {selected === null ? (
            <div className="muted">Select an agent to inspect it.</div>
          ) : (
            <div className="card">
              <KeyValue name="name" value={selected.name} />
              <KeyValue name="description" value={selected.description} />
              <KeyValue name="model" value={selected.model ?? '—'} />
              <KeyValue name="permissionMode" value={selected.permissionMode ?? '—'} />
              <KeyValue name="revision" value={selected.revision} />
              <KeyValue name="environmentProfileId" value={selected.resources.environmentProfileId ?? '—'} />
              <KeyValue name="tools" value={selected.tools.join(', ')} />
              <div className="button-row">
                <button type="button" onClick={() => void remove(selected.name)}>Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AgentForm form={form} setForm={setForm} editingName={editingName} onSubmit={() => void submit()} />

      <div className="card">
        <h3 className="section-title">AI proposal</h3>
        <div className="form-grid">
          <label className="field-label" htmlFor="agent-instructions">instructions</label>
          <textarea
            id="agent-instructions"
            className="editor-textarea"
            value={instructions}
            onChange={event => setInstructions(event.target.value)}
          />
          <button type="button" disabled={proposing || instructions.trim() === ''} onClick={() => void propose()}>
            {proposing ? 'proposing…' : 'Propose'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentForm(props: {
  form: AgentFormState
  setForm: (form: AgentFormState) => void
  editingName: string | null
  onSubmit: () => void
}) {
  const { form, setForm, editingName, onSubmit } = props
  const patch = (fields: Partial<AgentFormState>) => setForm({ ...form, ...fields })
  return (
    <div className="card">
      <h3 className="section-title">{editingName === null ? 'new agent' : 'edit agent'}</h3>
      <div className="form-grid">
        <label className="field-label" htmlFor="agent-name">name</label>
        <input id="agent-name" type="text" value={form.name} onChange={event => patch({ name: event.target.value })} />
        <label className="field-label" htmlFor="agent-desc">description</label>
        <input id="agent-desc" type="text" value={form.description} onChange={event => patch({ description: event.target.value })} />
        <label className="field-label" htmlFor="agent-model">model</label>
        <input id="agent-model" type="text" value={form.model} onChange={event => patch({ model: event.target.value })} />
        <label className="field-label" htmlFor="agent-perm">permissionMode</label>
        <select id="agent-perm" value={form.permissionMode} onChange={event => patch({ permissionMode: event.target.value as AgentPermissionMode | '' })}>
          {PERMISSION_MODES.map(mode => <option key={mode} value={mode}>{mode === '' ? '—' : mode}</option>)}
        </select>
        <label className="field-label" htmlFor="agent-env">environmentProfileId</label>
        <input id="agent-env" type="text" value={form.environmentProfileId} onChange={event => patch({ environmentProfileId: event.target.value })} />
        <label className="field-label" htmlFor="agent-tools">tools (comma-separated)</label>
        <input id="agent-tools" type="text" value={form.tools} onChange={event => patch({ tools: event.target.value })} />
        <label className="field-label" htmlFor="agent-prompt">systemPrompt</label>
        <textarea id="agent-prompt" className="editor-textarea" value={form.systemPrompt} onChange={event => patch({ systemPrompt: event.target.value })} />
        <button type="button" onClick={onSubmit}>{editingName === null ? 'Create' : 'Save'}</button>
      </div>
    </div>
  )
}
