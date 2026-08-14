import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  ASSET_REPOSITORY_MANIFEST_FILENAME,
  type AssetRepository,
  type AssetRepositoryManifest,
  type EnvironmentPackageCatalog,
  type EnvironmentProfile,
  type RepositoryAgentConfiguration,
  type RepositoryRoot,
} from './types.ts'

/**
 * Read and parse an Asset Repository from a root directory.
 *
 * The repository is the file-backed single source of truth: this reader never
 * mutates files and never writes projections back. It resolves each partition
 * directory from the root manifest's `spec.roots` map and parses every
 * recognized asset file, keeping unknown kinds intact for the caller.
 *
 * @param rootPath - absolute or cwd-relative path to the repository root.
 */
export async function readAssetRepository(rootPath: string): Promise<AssetRepository> {
  const root = resolve(rootPath)
  const manifestPath = join(root, ASSET_REPOSITORY_MANIFEST_FILENAME)
  const manifest = parseManifest(await readYaml(manifestPath), manifestPath)

  const resolveRoot = (key: RepositoryRoot): string | null => {
    const dir = manifest.spec.roots[key]
    if (dir === undefined) return null
    return isAbsolute(dir) ? dir : join(root, dir)
  }

  const environmentRoot = resolveRoot('environments')
  const environmentCatalogs: EnvironmentPackageCatalog[] = []
  const environmentProfiles: EnvironmentProfile[] = []

  if (environmentRoot !== null) {
    const packagesRoot = join(environmentRoot, 'packages')
    const catalogPaths = await listYamlFiles(packagesRoot)
    for (const path of catalogPaths) {
      const doc = await readYaml(path)
      const catalog = doc as EnvironmentPackageCatalog
      if (catalog.kind === 'EnvironmentPackageCatalog') environmentCatalogs.push(catalog)
    }
    const profilesRoot = join(environmentRoot, 'profiles')
    const profilePaths = await listYamlFiles(profilesRoot)
    for (const path of profilePaths) {
      const doc = await readYaml(path)
      const profile = doc as EnvironmentProfile
      if (profile.kind === 'EnvironmentProfile') environmentProfiles.push(profile)
    }
  }

  const agentsRoot = resolveRoot('agents')
  const agents: RepositoryAgentConfiguration[] = []
  if (agentsRoot !== null) {
    for (const path of await listYamlFiles(agentsRoot)) {
      const doc = await readYaml(path)
      const agent = doc as RepositoryAgentConfiguration
      if (agent.kind === 'AgentConfiguration') agents.push(agent)
    }
  }

  const environmentPackages = environmentCatalogs.flatMap(catalog =>
    catalog.spec.packages.map(pkg => ({ ...pkg, ecosystem: catalog.spec.ecosystem })),
  )

  return {
    rootPath: root,
    manifestPath,
    manifest,
    environmentCatalogs,
    environmentPackages,
    environmentProfiles,
    agents,
  }
}

/** Read a YAML file as a plain object. */
async function readYaml(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8')
  return parseYaml(text) as unknown
}

/** Parse and structurally validate a root manifest. */
function parseManifest(doc: unknown, path: string): AssetRepositoryManifest {
  const m = doc as AssetRepositoryManifest
  if (m === null || typeof m !== 'object') throw new Error(`rin repository: manifest is not an object: ${path}`)
  if (m.kind !== 'AssetRepository') throw new Error(`rin repository: expected kind AssetRepository, got ${String(m.kind)}: ${path}`)
  if (m.spec === null || typeof m.spec !== 'object') throw new Error(`rin repository: manifest missing spec: ${path}`)
  if (m.metadata === null || typeof m.metadata !== 'object') throw new Error(`rin repository: manifest missing metadata: ${path}`)
  return m
}

/** List *.yaml/*.yml files in a directory (empty list when the dir is absent). */
async function listYamlFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(e => e.isFile() && /\.ya?ml$/i.test(e.name))
    .map(e => join(dir, e.name))
    .sort()
}
