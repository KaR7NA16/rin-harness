import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, FolderGit2, LoaderCircle, Plus, Save, Search, Shield, Sparkles, Trash2, Workflow } from 'lucide-react'
import {
  agentsApi,
  type AgentDefinition,
  type AgentProposal,
  type RepositoryAgentConfiguration,
  type RepositoryAgentInput,
} from '../api/agents'
import {
  repositoriesApi,
  type EnvironmentProfile,
  type RepositoryConnection,
  type RepositoryPackage,
} from '../api/repositories'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'
import { Modal } from '../components/shared/Modal'
import { Textarea } from '../components/shared/Textarea'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const EMPTY_DRAFT: RepositoryAgentInput = {
  name: '',
  description: '',
  systemPrompt: '',
  model: 'inherit',
  permissionMode: 'workspace-write',
  tools: [],
  resources: { skillIds: [], workflowIds: [] },
}

export function AgentWorkspace() {
  const locale = useSettingsStore(state => state.locale)
  const addToast = useUIStore(state => state.addToast)
  const copy = useCallback((zh: string, en: string) => locale === 'zh' ? zh : en, [locale])
  const [repositories, setRepositories] = useState<RepositoryConnection[]>([])
  const [repositoryId, setRepositoryId] = useState('')
  const [agents, setAgents] = useState<RepositoryAgentConfiguration[]>([])
  const [runtimeAgents, setRuntimeAgents] = useState<AgentDefinition[]>([])
  const [environmentProfiles, setEnvironmentProfiles] = useState<EnvironmentProfile[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [draft, setDraft] = useState<RepositoryAgentInput>(EMPTY_DRAFT)
  const [toolsText, setToolsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [manualBypassAcknowledged, setManualBypassAcknowledged] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposalInstructions, setProposalInstructions] = useState('')
  const [proposal, setProposal] = useState<AgentProposal | null>(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [acknowledgeBypassRisk, setAcknowledgeBypassRisk] = useState(false)

  const repository = useMemo(
    () => repositories.find(item => item.id === repositoryId) ?? null,
    [repositories, repositoryId],
  )

  const loadRepositoryData = useCallback(async (nextRepositoryId: string) => {
    if (!nextRepositoryId) {
      setAgents([])
      setRuntimeAgents([])
      setEnvironmentProfiles([])
      return
    }
    const [agentResponse, profileResponse, runtimeResponse] = await Promise.all([
      agentsApi.listRepository(nextRepositoryId),
      repositoriesApi.environmentProfiles(nextRepositoryId),
      agentsApi.list().catch(() => ({ activeAgents: [], allAgents: [] })),
    ])
    setAgents(agentResponse.agents)
    setEnvironmentProfiles(profileResponse.profiles)
    setRuntimeAgents(runtimeResponse.activeAgents)
  }, [])

  useEffect(() => {
    let cancelled = false
    void repositoriesApi.list()
      .then(async response => {
        if (cancelled) return
        setRepositories(response.repositories)
        const firstId = response.repositories[0]?.id ?? ''
        setRepositoryId(firstId)
        await loadRepositoryData(firstId)
      })
      .catch(error => addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [addToast, loadRepositoryData])

  const selectAgent = (agent: RepositoryAgentConfiguration) => {
    setSelectedName(agent.name)
    setDraft({
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: agent.model ?? 'inherit',
      permissionMode: agent.permissionMode ?? 'workspace-write',
      tools: agent.tools,
      resources: agent.resources,
    })
    setToolsText(agent.tools.join(', '))
    setManualBypassAcknowledged(false)
  }

  const startCreating = () => {
    setSelectedName(null)
    setDraft(EMPTY_DRAFT)
    setToolsText('')
    setManualBypassAcknowledged(false)
  }

  const changeRepository = async (nextRepositoryId: string) => {
    setRepositoryId(nextRepositoryId)
    startCreating()
    setLoading(true)
    try {
      await loadRepositoryData(nextRepositoryId)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }

  const normalizedDraft = (): RepositoryAgentInput => ({
    ...draft,
    tools: toolsText.split(',').map(item => item.trim()).filter(Boolean),
  })

  const saveAgent = async () => {
    if (!repositoryId) return
    if (draft.permissionMode === 'danger-full-access' && !manualBypassAcknowledged) {
      addToast({ type: 'error', message: copy('请先确认绕过权限模式的风险', 'Acknowledge bypass permission risk before saving') })
      return
    }
    setSaving(true)
    try {
      const saved = selectedName
        ? await agentsApi.updateRepository(repositoryId, selectedName, normalizedDraft())
        : await agentsApi.createRepository(repositoryId, normalizedDraft())
      await loadRepositoryData(repositoryId)
      selectAgent(saved)
      addToast({ type: 'success', message: copy('Agent 配置已写入仓库；尚未验证运行时激活', 'Agent configuration written; runtime activation is not yet verified') })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const deleteAgent = async () => {
    if (!repositoryId || !selectedName) return
    setSaving(true)
    try {
      await agentsApi.deleteRepository(repositoryId, selectedName)
      await loadRepositoryData(repositoryId)
      startCreating()
      addToast({ type: 'success', message: copy('Agent 配置已移除', 'Agent configuration removed') })
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const openProposal = () => {
    setProposal(null)
    setProposalInstructions('')
    setAcknowledgeBypassRisk(false)
    setProposalOpen(true)
  }

  const generateProposal = async () => {
    if (!repository || !proposalInstructions.trim()) return
    setProposalBusy(true)
    try {
      setProposal(await agentsApi.prepareProposal(repository.id, {
        instructions: proposalInstructions.trim(),
        draft: normalizedDraft(),
        ...(selectedName ? { currentName: selectedName } : {}),
      }))
      setAcknowledgeBypassRisk(false)
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setProposalBusy(false)
    }
  }

  const approveProposal = async () => {
    if (!repository || !proposal) return
    setProposalBusy(true)
    try {
      const approved = await agentsApi.approveProposal(repository.id, proposal.id, acknowledgeBypassRisk)
      setProposal(approved)
      if (approved.savedAgent) {
        await loadRepositoryData(repository.id)
        selectAgent(approved.savedAgent)
        addToast({ type: 'success', message: copy('Agent 提案已批准并写入仓库；尚未验证运行时激活', 'Agent proposal approved and written; runtime activation is not yet verified') })
      }
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setProposalBusy(false)
    }
  }

  if (loading && repositories.length === 0) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" /></div>
  }

  // Skills and workflows live in separate rin stores (skill-memory / workspace),
  // not in the repository manifest; wiring those stores here is a separate task.
  const skills: RepositoryPackage[] = []
  const workflows: RepositoryPackage[] = []
  const canSave = Boolean(draft.name.trim() && draft.description.trim() && draft.systemPrompt.trim())
  const selectedRuntimeAgent = selectedName
    ? runtimeAgents.find(agent =>
      agent.source === 'repository'
      && agent.repositoryId === repositoryId
      && agent.agentType === selectedName)
    : undefined

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] p-[24px]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-[18px]">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-signal)]"><Bot size={14} />{copy('Agent 工作台', 'Agent Studio')}</div>
            <h1 className="mt-1 text-[22px] font-semibold text-[var(--color-text-primary)]">{copy('Agent 配置', 'Agent configuration')}</h1>
            <p className="mt-1 max-w-[720px] text-[13px] leading-5 text-[var(--color-text-tertiary)]">
              {copy('创建可审计的静态 Agent 定义，并引用仓库中的环境配置、Skill 与工作流。', 'Create auditable static Agent definitions that reference environment profiles, Skills, and workflows.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={copy('仓库', 'Repository')} value={repositoryId} onChange={event => void changeRepository(event.target.value)} className="h-[36px] max-w-[340px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-primary)]">
              {repositories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" onClick={openProposal} disabled={!repository}><Sparkles size={14} className="mr-1" />{copy('AI 配置 Agent', 'Configure with AI')}</Button>
            <Button size="sm" onClick={startCreating}><Plus size={14} className="mr-1" />{copy('新建 Agent', 'New Agent')}</Button>
          </div>
        </header>

        {!repository ? (
          <div className="border-t border-[var(--color-border)] py-20 text-center text-[13px] text-[var(--color-text-tertiary)]">{copy('请先连接一个资产仓库。', 'Connect an asset repository first.')}</div>
        ) : (
          <div className="grid min-h-[620px] grid-cols-[230px_minmax(0,1fr)] border-y border-[var(--color-border-separator)] bg-[var(--color-surface)]">
            <aside className="border-r border-[var(--color-border-separator)] p-3">
              <div className="mb-4 px-2 py-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text-primary)]"><FolderGit2 size={15} />{repository.name}</div>
                <div className="mt-2 break-all font-mono text-[10.5px] leading-4 text-[var(--color-text-tertiary)]">{repository.rootPath.replace(/\\/g, '/')}/agents</div>
              </div>
              <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{copy('仓库配置', 'Repository configurations')}</div>
              <div className="flex flex-col gap-1">
                {agents.map(agent => (
                  <button key={agent.name} type="button" onClick={() => selectAgent(agent)} className={`border-l-2 px-3 py-2.5 text-left transition-colors ${selectedName === agent.name ? 'border-[var(--color-brand)] bg-[var(--color-surface-selected)]' : 'border-transparent hover:bg-[var(--color-surface-hover)]'}`}>
                    <div className="truncate text-[12.5px] font-semibold text-[var(--color-text-primary)]">{agent.name}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-tertiary)]">{agent.description}</div>
                  </button>
                ))}
                {agents.length === 0 && <div className="px-3 py-8 text-center text-[11px] text-[var(--color-text-tertiary)]">{copy('该仓库暂无 Agent', 'No Agents in this repository')}</div>}
              </div>
            </aside>

            <main className="min-w-0 p-[22px]">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-separator)] pb-4">
                <div>
                  <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{selectedName ?? copy('新 Agent', 'New Agent')}</h2>
                  <p className="mt-1 text-[11.5px] text-[var(--color-text-tertiary)]">{copy('静态配置保存与运行时加载是两个独立状态', 'Static save and runtime activation are separate states')}</p>
                  {selectedName && <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]">
                    <span className="rounded-full bg-[var(--color-success)]/10 px-2 py-1 text-[var(--color-success)]">{copy('静态定义：已解析', 'Static definition: parsed')}</span>
                    <span className={`rounded-full px-2 py-1 ${selectedRuntimeAgent ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)]'}`}>
                      {selectedRuntimeAgent ? copy('运行时：已进入调度列表', 'Runtime: in dispatch list') : copy('运行时：未加载', 'Runtime: not loaded')}
                    </span>
                    <span className="text-[var(--color-text-tertiary)]">{copy('尚未执行调用探测', 'No execution probe has been run')}</span>
                  </div>}
                </div>
                <div className="flex gap-2">
                  {selectedName && <Button size="sm" variant="ghost" onClick={() => void deleteAgent()} disabled={saving}><Trash2 size={14} className="mr-1" />{copy('删除', 'Delete')}</Button>}
                  <Button size="sm" onClick={() => void saveAgent()} loading={saving} disabled={!canSave}><Save size={14} className="mr-1" />{copy('保存配置', 'Save configuration')}</Button>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{copy('基本定义', 'Definition')}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label={copy('标识名', 'Identifier')} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} disabled={Boolean(selectedName)} placeholder="research-analyst" />
                  <Input label={copy('模型', 'Model')} value={draft.model ?? ''} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder="inherit" />
                  <div className="md:col-span-2"><Input label={copy('职责描述', 'Responsibility')} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder={copy('说明何时调用该 Agent', 'Describe when this Agent should be used')} /></div>
                  <div className="md:col-span-2"><Textarea label={copy('系统指令', 'System instructions')} value={draft.systemPrompt} onChange={event => setDraft({ ...draft, systemPrompt: event.target.value })} rows={7} placeholder={copy('定义目标、证据边界与完成标准', 'Define goals, evidence boundaries, and completion criteria')} /></div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{copy('能力与权限', 'Capabilities and permissions')}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label={copy('工具（逗号分隔）', 'Tools (comma separated)')} value={toolsText} onChange={event => setToolsText(event.target.value)} placeholder="Read, Grep, WebFetch" />
                  <label className="flex flex-col gap-1 text-[13px] font-medium text-[var(--color-text-primary)]">
                    {copy('权限模式', 'Permission mode')}
                    <select value={draft.permissionMode} onChange={event => { setDraft({ ...draft, permissionMode: event.target.value as RepositoryAgentInput['permissionMode'] }); setManualBypassAcknowledged(false) }} className="h-[40px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 text-[13px]">
                      <option value="read-only">Read only</option><option value="workspace-write">Workspace write</option><option value="danger-full-access">Full access</option>
                    </select>
                  </label>
                </div>
              </div>

              {draft.permissionMode === 'danger-full-access' && (
                <label className="mt-4 flex items-start gap-2 border-l-2 border-[var(--color-danger)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={manualBypassAcknowledged} onChange={event => setManualBypassAcknowledged(event.target.checked)} />
                  {copy('我理解该模式可能绕过文件与命令确认，仅为此 Agent 显式启用。', 'I understand this mode may bypass file and command confirmations and explicitly enable it for this Agent.')}
                </label>
              )}

              <div className="mt-6 flex flex-col gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{copy('仓库资源引用', 'Repository resources')}</p>
                <div className="grid gap-3 lg:grid-cols-3">
                  <EnvironmentProfileSelector profiles={environmentProfiles} selected={draft.resources.environmentProfileId} onChange={environmentProfileId => setDraft({ ...draft, resources: { ...draft.resources, ...(environmentProfileId ? { environmentProfileId } : { environmentProfileId: undefined }) } })} copy={copy} />
                  <ResourceSelector icon={Sparkles} title="Skills" items={skills} selected={draft.resources.skillIds} onChange={skillIds => setDraft({ ...draft, resources: { ...draft.resources, skillIds } })} empty={copy('仓库中暂无 Skill', 'No Skills in repository')} />
                  <ResourceSelector icon={Workflow} title={copy('工作流', 'Workflows')} items={workflows} selected={draft.resources.workflowIds} onChange={workflowIds => setDraft({ ...draft, resources: { ...draft.resources, workflowIds } })} empty={copy('仓库中暂无工作流', 'No workflows in repository')} />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 border-t border-[var(--color-border-separator)] px-1 pt-4 text-[11.5px] text-[var(--color-text-tertiary)]">
                <Shield size={14} />{copy('保存只证明静态定义有效；运行时加载或调度必须单独验证。', 'Saving proves only that the static definition is valid; runtime load or dispatch requires separate verification.')}
              </div>
            </main>
          </div>
        )}
      </div>

      <Modal open={proposalOpen} onClose={() => setProposalOpen(false)} title={copy('AI Agent 提案', 'AI Agent proposal')} width={760}>
        <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-5">
          <Textarea label={copy('AI 配置要求', 'AI instructions')} value={proposalInstructions} onChange={event => setProposalInstructions(event.target.value)} rows={4} placeholder={copy('描述职责、边界、模型与所需仓库能力', 'Describe responsibilities, boundaries, model, and required repository capabilities')} />
          {!proposal && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setProposalOpen(false)}>{copy('取消', 'Cancel')}</Button>
              <Button onClick={() => void generateProposal()} loading={proposalBusy} disabled={!proposalInstructions.trim()}>{copy('生成提案', 'Generate proposal')}</Button>
            </div>
          )}
          {proposal && (
            <>
              <div className="flex items-center justify-between border-y border-[var(--color-border-separator)] py-3 text-[12px]">
                <span className="font-semibold text-[var(--color-text-primary)]">{proposal.candidate.name}</span>
                <span className="font-mono text-[var(--color-text-tertiary)]">{proposal.status}</span>
              </div>
              {proposal.validationIssues.length > 0 && (
                <div className="border-l-2 border-[var(--color-danger)] px-3 py-2 text-[12px] text-[var(--color-danger)]">{proposal.validationIssues.join('\n')}</div>
              )}
              <div className="flex flex-col gap-2">
                {proposal.diff.length === 0 ? <p className="text-[12px] text-[var(--color-text-tertiary)]">{copy('没有变化', 'No changes')}</p> : proposal.diff.map(change => (
                  <div key={change.path} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-[var(--color-border-separator)] py-2 text-[11.5px]">
                    <code className="text-[var(--color-text-tertiary)]">{change.path}</code>
                    <div className="min-w-0">
                      {change.before !== undefined && <div className="break-words text-[var(--color-danger)] line-through">{displayDiffValue(change.before)}</div>}
                      {change.after !== undefined && <div className="break-words text-[var(--color-success)]">{displayDiffValue(change.after)}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {proposal.candidate.permissionMode === 'danger-full-access' && proposal.status === 'proposed' && (
                <label className="flex items-start gap-2 border-l-2 border-[var(--color-danger)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked={acknowledgeBypassRisk} onChange={event => setAcknowledgeBypassRisk(event.target.checked)} />
                  {copy('我确认批准提案中的绕过权限模式。', 'I explicitly acknowledge the bypass permission mode in this proposal.')}
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setProposalOpen(false)}>{copy('关闭', 'Close')}</Button>
                {proposal.status === 'proposed' && (
                  <Button onClick={() => void approveProposal()} loading={proposalBusy} disabled={proposal.candidate.permissionMode === 'danger-full-access' && !acknowledgeBypassRisk}>{copy('批准变更', 'Approve changes')}</Button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}

function EnvironmentProfileSelector({ profiles, selected, onChange, copy }: {
  profiles: EnvironmentProfile[]
  selected?: string
  onChange: (id?: string) => void
  copy: (zh: string, en: string) => string
}) {
  return (
    <section className="min-h-[180px] border-t border-[var(--color-border)] pt-3">
      <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">{copy('环境配置', 'Environment profile')}</h3>
      <p className="mt-1 text-[10.5px] text-[var(--color-text-tertiary)]">{copy('选择任务级套件，不再逐包勾选', 'Select one task-level profile instead of individual packages')}</p>
      <select aria-label={copy('环境配置', 'Environment profile')} value={selected ?? ''} onChange={event => onChange(event.target.value || undefined)} className="mt-3 h-[40px] w-full rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] text-[var(--color-text-primary)]">
        <option value="">{copy('不绑定环境配置', 'No environment profile')}</option>
        {profiles.map(profile => <option key={profile.metadata.id} value={profile.metadata.id}>{profile.metadata.name} · {profile.metadata.version}</option>)}
      </select>
    </section>
  )
}

function ResourceSelector({ icon: Icon, title, items, selected, onChange, empty }: {
  icon: typeof Sparkles
  title: string
  items: RepositoryPackage[]
  selected: string[]
  onChange: (ids: string[]) => void
  empty: string
}) {
  const [query, setQuery] = useState('')
  const filtered = items.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id])
  return (
    <section className="min-h-[180px] border-t border-[var(--color-border)] pt-3">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text-primary)]"><Icon size={14} />{title}<span className="ml-auto font-mono text-[10px] text-[var(--color-text-tertiary)]">{selected.length}/{items.length}</span></h3>
      {items.length > 0 && (
        <label className="mt-2 flex items-center gap-2 border-b border-[var(--color-border-separator)] px-1 py-1.5"><Search size={12} className="text-[var(--color-text-tertiary)]" /><input aria-label={`Search ${title}`} value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" /></label>
      )}
      <div className="mt-2 flex max-h-[210px] flex-col gap-1 overflow-y-auto">
        {items.length === 0 ? <p className="py-8 text-center text-[10.5px] text-[var(--color-text-tertiary)]">{empty}</p> : filtered.map(item => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
            <span className="min-w-0 truncate">{item.name}</span>
            {item.version && <code className="ml-auto text-[9px] text-[var(--color-text-tertiary)]">{item.version}</code>}
          </label>
        ))}
      </div>
    </section>
  )
}

function displayDiffValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
