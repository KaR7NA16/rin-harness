import { api } from './client'

export type RepositoryPackageEcosystem = 'python' | 'r' | 'node' | 'system' | 'latex' | 'other'

export type RepositoryPackage = {
  id: string
  name: string
  ecosystem: RepositoryPackageEcosystem
  version?: string
  description?: string
}

export type RepositoryConnection = {
  id: string
  name: string
  rootPath: string
  environmentPackages: RepositoryPackage[]
  environmentProfiles: EnvironmentProfile[]
  createdAt: string
  updatedAt: string
}

export type EnvironmentProfile = {
  apiVersion: 'rin.dev/v1'
  kind: 'EnvironmentProfile'
  metadata: { id: string; name: string; version: string }
  spec: {
    packages: string[]
    verify?: { pythonImports?: string[]; rPackages?: string[]; commands?: string[] }
  }
}

export type ResolverCapabilities = {
  platform: string
  runtimes: { apt: boolean; python: boolean; pip: boolean; r: boolean; npm: boolean; tlmgr: boolean }
}

export type ResolvedEnvironmentPlan = {
  profileId: string
  profileVersion: string
  status: 'ready' | 'blocked'
  packageCount: number
  preflight: Array<{ id: string; status: 'ready' | 'missing' | 'unsupported'; message: string }>
  stages: Array<{ id: 'system' | 'python' | 'r' | 'node' | 'latex' | 'verification'; commands: string[] }>
}

export const repositoriesApi = {
  list: () => api.get<{ repositories: RepositoryConnection[] }>('/api/repositories'),
  get: (id: string) => api.get<RepositoryConnection>(`/api/repositories/${encodeURIComponent(id)}`),
  connect: (path: string, name?: string) =>
    api.post<RepositoryConnection>('/api/repositories/connect', { path, ...(name?.trim() ? { name: name.trim() } : {}) }),
  create: (parentDir: string, name: string) =>
    api.post<RepositoryConnection>('/api/repositories/create', { parentDir, name }),
  disconnect: (id: string) =>
    api.delete<{ disconnected: boolean }>(`/api/repositories/${encodeURIComponent(id)}`),
  environmentProfiles: (id: string) =>
    api.get<{ repositoryId: string; profiles: EnvironmentProfile[] }>(`/api/repositories/${encodeURIComponent(id)}/environment-profiles`),
  resolveEnvironment: (id: string, profileId: string, capabilities: ResolverCapabilities) =>
    api.post<ResolvedEnvironmentPlan>(`/api/repositories/${encodeURIComponent(id)}/resolve-environment`, { profileId, capabilities }),
}
