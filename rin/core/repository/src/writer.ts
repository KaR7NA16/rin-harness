import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import {
  ASSET_REPOSITORY_API_VERSION,
  ASSET_REPOSITORY_MANIFEST_FILENAME,
  type AssetRepositoryManifest,
  type EnvironmentPackage,
  type EnvironmentPackageCatalog,
  type RepositoryMigrationPlan,
  type RepositoryPackageEcosystem,
} from './types.ts'

const ROOTS = {
  environments: 'environments', agents: 'agents', skills: 'skills', workflows: 'workflows',
  tools: 'tools', knowledge: 'knowledge', policies: 'policies', outputs: 'outputs', bundles: 'bundles',
} as const
const ECOSYSTEMS: RepositoryPackageEcosystem[] = ['system', 'python', 'r', 'node', 'latex', 'other']

/** Create a repository skeleton at root with the built-in manifest and empty roots. */
export async function createAssetRepository(root: string, id: string, name: string): Promise<void> {
  const manifest: AssetRepositoryManifest = {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'AssetRepository',
    metadata: { id, name, version: '1.0.0' },
    spec: { mutable: true, roots: { ...ROOTS } },
  }
  await Promise.all(Object.values(ROOTS).map(path => mkdir(join(root, path), { recursive: true })))
  await mkdir(join(root, ROOTS.environments, 'packages'), { recursive: true })
  await writeDocument(join(root, ASSET_REPOSITORY_MANIFEST_FILENAME), manifest)
}

/** Write packages to per-ecosystem catalog files. */
export async function writeEnvironmentPackages(root: string, packages: EnvironmentPackage[]): Promise<void> {
  const packageRoot = join(root, ROOTS.environments, 'packages')
  await mkdir(packageRoot, { recursive: true })
  await Promise.all(ECOSYSTEMS.map(async ecosystem => {
    const entries = packages
      .filter(pkg => pkg.ecosystem === ecosystem)
      .map(({ ecosystem: _ecosystem, ...pkg }) => pkg)
    const catalog: EnvironmentPackageCatalog = {
      apiVersion: ASSET_REPOSITORY_API_VERSION,
      kind: 'EnvironmentPackageCatalog',
      metadata: { id: ecosystem + '-packages', name: ecosystem + ' packages', version: '1.0.0' },
      spec: { ecosystem, packages: entries },
    }
    await writeDocument(join(packageRoot, ecosystem + '.yaml'), catalog)
  }))
}

/** Apply a migration plan by writing its files. */
export async function applyRepositoryMigration(root: string, plan: RepositoryMigrationPlan): Promise<void> {
  for (const file of plan.files) await writeDocument(join(root, file.path), file.document)
}

async function writeDocument(path: string, document: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, stringify(document), 'utf8')
}
