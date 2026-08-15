import { api } from './client'
import type { ResolvedEnvironmentPlan } from './repositories'

export type ContainerMount = { host: string; guest: string; ro?: boolean }
export type ContainerPort = { host: number; guest: number }

export type SandboxProfile = {
  id: string
  name: string
  type: 'local-sandbox' | 'container' | 'remote'
  isDefault?: boolean
  repositoryId?: string
  repositoryPath?: string
  environmentProfileId?: string
  container?: {
    runtime?: 'docker' | 'podman' | 'auto'
    image: string
    workdir?: string
    mounts?: ContainerMount[]
    env?: Record<string, string>
    ports?: ContainerPort[]
    shell?: string
  }
  remote?: {
    host: string
    port?: number
    user: string
    identityFile?: string
    useDocker?: boolean
  }
  createdAt: string
  updatedAt: string
}

export type SandboxRuntimeInfo = { runtime: 'docker' | 'podman' | null; version: string | null }

export type ContainerState = {
  exists: boolean
  running: boolean
  containerId?: string
  image?: string
  status?: string
}

export type ContainerStats = {
  containerId: string
  cpuPercent: string
  memUsage: string
  memPercent: string
  netIO: string
  blockIO: string
}

export type EnvironmentInstallStatus = 'blocked' | 'resolved' | 'approved' | 'provisioning' | 'verifying' | 'ready' | 'failed' | 'rollback-needed'

export type EnvironmentInstallRun = {
  id: string
  sandboxProfileId: string
  repositoryId: string
  environmentProfileId: string
  status: EnvironmentInstallStatus
  plan: ResolvedEnvironmentPlan
  logs: Array<{
    stageId: string
    command: string
    status: 'running' | 'succeeded' | 'failed'
    code?: number
    stdout?: string
    stderr?: string
    containerId?: string
    startedAt: string
    finishedAt?: string
    retryable?: boolean
  }>
  createdAt: string
  updatedAt: string
}

export const sandboxesApi = {
  runtime: () => api.get<SandboxRuntimeInfo>('/api/sandboxes/runtime'),
  stats: () => api.get<{ stats: ContainerStats[] }>('/api/sandboxes/stats'),
  list: () => api.get<{ profiles: SandboxProfile[] }>('/api/sandboxes/profiles'),
  create: (profile: Partial<SandboxProfile> & { name: string }) =>
    api.post<SandboxProfile>('/api/sandboxes/profiles', profile),
  update: (id: string, profile: Partial<SandboxProfile>) =>
    api.put<SandboxProfile>(`/api/sandboxes/profile/${encodeURIComponent(id)}`, profile),
  remove: (id: string) => api.delete<{ removed: boolean }>(`/api/sandboxes/profile/${encodeURIComponent(id)}`),
  setDefault: (id: string) => api.post<{ ok: boolean }>('/api/sandboxes/default', { id }),
  state: (id: string) => api.get<ContainerState>(`/api/sandboxes/profile/${encodeURIComponent(id)}/state`),
  start: (id: string) => api.post<ContainerState>(`/api/sandboxes/profile/${encodeURIComponent(id)}/start`, {}),
  stop: (id: string) => api.post<{ stopped: boolean }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/stop`, {}),
  exec: (id: string, command: string) =>
    api.post<{ code: number; stdout: string; stderr: string }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/exec`, { command }),
  interactiveCommand: (id: string) =>
    api.post<{ command: string[]; containerId?: string }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/interactive-command`, {}),
  testConnection: (id: string) =>
    api.post<{ ok: boolean; latencyMs?: number; hostInfo?: string; error?: string }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/test`, {}),
  remoteState: (id: string) =>
    api.get<{ reachable: boolean; running?: boolean; containerId?: string }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/remote-state`),
  remoteExec: (id: string, command: string) =>
    api.post<{ code: number; stdout: string; stderr: string }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/remote-exec`, { command }),
  prepareEnvironment: (id: string) =>
    api.post<EnvironmentInstallRun>(`/api/sandboxes/profile/${encodeURIComponent(id)}/prepare-environment`, {}),
  approveEnvironment: (id: string, runId: string) =>
    api.post<EnvironmentInstallRun>(`/api/sandboxes/profile/${encodeURIComponent(id)}/approve-environment`, { runId }),
  environmentRuns: (id: string) =>
    api.get<{ runs: EnvironmentInstallRun[] }>(`/api/sandboxes/profile/${encodeURIComponent(id)}/environment-runs`),
}
