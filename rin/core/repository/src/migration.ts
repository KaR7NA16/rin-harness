import {
  ASSET_REPOSITORY_API_VERSION,
  type AssetRepositoryManifest,
  type EnvironmentPackageCatalog,
  type RepositoryMigrationPlan,
  type RepositoryPackageEcosystem,
} from './types.ts'

type LegacyPackage = {
  id?: unknown
  name?: unknown
  ecosystem?: unknown
  version?: unknown
  description?: unknown
}

type LegacyCategory = { id?: unknown; packages?: unknown }
type LegacyManifest = { version?: unknown; name?: unknown; categories?: unknown }

const ECOSYSTEM_ORDER: RepositoryPackageEcosystem[] = ['system', 'python', 'r', 'node', 'latex', 'other']

/** Plan the migration of a legacy (v1) repository manifest to the v2 layout. */
export function planLegacyRepositoryMigration(input: unknown): RepositoryMigrationPlan {
  const legacy = requireLegacyManifest(input)
  const name = typeof legacy.name === 'string' && legacy.name.trim() ? legacy.name.trim() : 'Repository'
  const environment = legacy.categories.find(category => category.id === 'environment')
  const packages = Array.isArray(environment?.packages) ? environment.packages as LegacyPackage[] : []
  const grouped = new Map<RepositoryPackageEcosystem, EnvironmentPackageCatalog['spec']['packages']>()

  for (const raw of packages) {
    if (!raw || typeof raw !== 'object') continue
    const ecosystem = normalizeEcosystem(raw.ecosystem)
    const id = requireText(raw.id, 'legacy package id')
    const packageName = requireText(raw.name, 'legacy package ' + id + ' name')
    const entries = grouped.get(ecosystem) ?? []
    entries.push({
      id,
      name: packageName,
      ...(typeof raw.version === 'string' && raw.version.trim() ? { version: raw.version.trim() } : {}),
      ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim() } : {}),
    })
    grouped.set(ecosystem, entries)
  }

  const rootManifest: AssetRepositoryManifest = {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'AssetRepository',
    metadata: { id: slug(name), name, version: '1.0.0' },
    spec: {
      mutable: true,
      roots: {
        environments: 'environments', agents: 'agents', skills: 'skills', workflows: 'workflows',
        tools: 'tools', knowledge: 'knowledge', policies: 'policies', outputs: 'outputs', bundles: 'bundles',
      },
    },
  }
  const files: RepositoryMigrationPlan['files'] = [{ path: 'repository.yaml', document: rootManifest }]
  for (const ecosystem of ECOSYSTEM_ORDER) {
    const ecosystemPackages = grouped.get(ecosystem)
    if (!ecosystemPackages?.length) continue
    files.push({
      path: 'environments/packages/' + ecosystem + '.yaml',
      document: {
        apiVersion: ASSET_REPOSITORY_API_VERSION,
        kind: 'EnvironmentPackageCatalog',
        metadata: { id: ecosystem + '-packages', name: ecosystem + ' packages', version: '1.0.0' },
        spec: { ecosystem, packages: ecosystemPackages },
      },
    })
  }
  return { sourceVersion: 1, targetVersion: 1, packageCount: packages.length, files }
}

function requireLegacyManifest(input: unknown): LegacyManifest & { categories: LegacyCategory[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected legacy repository manifest')
  const manifest = input as LegacyManifest
  if (manifest.version !== 1) throw new Error('Expected legacy repository version 1')
  if (!Array.isArray(manifest.categories)) throw new Error('Expected legacy repository categories')
  return { ...manifest, categories: manifest.categories as LegacyCategory[] }
}

function normalizeEcosystem(value: unknown): RepositoryPackageEcosystem {
  return value === 'python' || value === 'r' || value === 'node' || value === 'system' || value === 'latex'
    ? value
    : 'other'
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected non-empty string for ' + label)
  return value.trim()
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return normalized || 'repository'
}
