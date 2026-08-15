import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  ASSET_REPOSITORY_API_VERSION,
  ASSET_REPOSITORY_MANIFEST_FILENAME,
  type AssetMetadata,
  type AssetRepository,
  type AssetRepositoryManifest,
  type EnvironmentPackageCatalog,
  type EnvironmentProfile,
  type RepositoryAgentConfiguration,
  type RepositoryPackageEcosystem,
  type RepositoryRoot,
} from './types.ts'
import {
  assertSafePackageName,
  assertSafePackageVersion,
  assertSafePythonImport,
  assertSafeRPackage,
  assertSafeReviewableCommand,
} from './validation.ts'

const ECOSYSTEMS = new Set<RepositoryPackageEcosystem>(['python', 'r', 'node', 'system', 'latex', 'other'])
const REPOSITORY_ROOTS = new Set<RepositoryRoot>([
  'environments', 'agents', 'skills', 'workflows', 'tools', 'knowledge', 'policies', 'outputs', 'bundles',
])

/**
 * Read and parse an Asset Repository from a root directory.
 *
 * The repository is the file-backed single source of truth: this reader never
 * mutates files and never writes projections back. It validates every parsed
 * document (safe package names, apiVersion, path containment, unique ids) and
 * fails loud on a malformed asset.
 *
 * @param rootPath - absolute or cwd-relative path to the repository root.
 * @returns the parsed repository with its environments, profiles, and agents.
 */
export async function readAssetRepository(rootPath: string): Promise<AssetRepository> {
  const root = resolve(rootPath)
  const manifestPath = join(root, ASSET_REPOSITORY_MANIFEST_FILENAME)
  const manifest = await readAssetRepositoryManifest(root)

  const environmentRoot = resolveRepositoryChild(root, manifest.spec.roots.environments, 'environments')
  const packagesRoot = join(environmentRoot, 'packages')
  const catalogPaths = (await readDirectory(packagesRoot))
    .filter(entry => entry.isFile() && /[.]ya?ml$/i.test(entry.name))
    .map(entry => join(packagesRoot, entry.name))
    .sort((a, b) => a.localeCompare(b))
  const environmentCatalogs = await Promise.all(catalogPaths.map(async path =>
    parseEnvironmentCatalog(await readYamlDocument(path), path, repoRelative(root, path))))

  const stableIds = new Set<string>()
  const environmentPackages = environmentCatalogs.flatMap(catalog =>
    catalog.spec.packages.map(pkg => {
      assertUniqueId(stableIds, pkg.id)
      return { ...pkg, ecosystem: catalog.spec.ecosystem }
    }))

  const profilesRoot = join(environmentRoot, 'profiles')
  const profilePaths = (await readDirectory(profilesRoot))
    .filter(entry => entry.isFile() && /[.]environment[.]ya?ml$/i.test(entry.name))
    .map(entry => join(profilesRoot, entry.name))
    .sort((a, b) => a.localeCompare(b))
  const environmentProfiles = await Promise.all(profilePaths.map(async path =>
    parseEnvironmentProfile(await readYamlDocument(path), path, repoRelative(root, path))))
  for (const profile of environmentProfiles) assertUniqueId(stableIds, profile.metadata.id)

  const agentsRoot = manifest.spec.roots.agents
    ? resolveRepositoryChild(root, manifest.spec.roots.agents, 'agents')
    : null
  const agentPaths = agentsRoot
    ? (await readDirectory(agentsRoot))
      .filter(entry => entry.isFile() && /[.]agent[.]ya?ml$/i.test(entry.name))
      .map(entry => join(agentsRoot, entry.name))
      .sort((a, b) => a.localeCompare(b))
    : []
  const agents = await Promise.all(agentPaths.map(async path =>
    parseRepositoryAgent(await readYamlDocument(path), path, repoRelative(root, path))))
  for (const agent of agents) assertUniqueId(stableIds, agent.name)

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

/** Read and validate just the root manifest. */
export async function readAssetRepositoryManifest(rootPath: string): Promise<AssetRepositoryManifest> {
  const root = resolve(rootPath)
  const manifestPath = join(root, ASSET_REPOSITORY_MANIFEST_FILENAME)
  return parseRepositoryManifest(await readYamlDocument(manifestPath), manifestPath)
}

/** Resolve one partition root from the manifest. */
export async function resolveAssetRepositoryRoot(rootPath: string, key: RepositoryRoot): Promise<string> {
  const root = resolve(rootPath)
  const manifest = await readAssetRepositoryManifest(root)
  return resolveRepositoryChild(root, manifest.spec.roots[key], key)
}

function parseRepositoryManifest(input: unknown, source: string): AssetRepositoryManifest {
  const value = requireRecord(input, source)
  if (value.apiVersion !== ASSET_REPOSITORY_API_VERSION) {
    throw new Error('rin repository: unsupported apiVersion in ' + source)
  }
  if (value.kind !== 'AssetRepository') throw new Error('rin repository: expected AssetRepository in ' + source)
  const spec = requireRecord(value.spec, source + ' spec')
  const rawRoots = requireRecord(spec.roots, source + ' spec.roots')
  const roots: Partial<Record<RepositoryRoot, string>> = {}
  for (const [key, path] of Object.entries(rawRoots)) {
    if (!isRepositoryRoot(key)) throw new Error('rin repository: unknown root "' + key + '" in ' + source)
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('rin repository: invalid root "' + key + '" in ' + source)
    }
    roots[key] = path.trim()
  }
  if (!roots.environments) throw new Error('rin repository: missing environments root in ' + source)
  return {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'AssetRepository',
    metadata: parseMetadata(value.metadata, source),
    spec: { mutable: spec.mutable !== false, roots },
  }
}

function parseEnvironmentCatalog(input: unknown, source: string, sourcePath?: string): EnvironmentPackageCatalog {
  const value = requireRecord(input, source)
  if (value.apiVersion !== ASSET_REPOSITORY_API_VERSION || value.kind !== 'EnvironmentPackageCatalog') {
    throw new Error('rin repository: expected EnvironmentPackageCatalog in ' + source)
  }
  const spec = requireRecord(value.spec, source + ' spec')
  if (!isEcosystem(spec.ecosystem)) throw new Error('rin repository: invalid ecosystem in ' + source)
  const ecosystem = spec.ecosystem
  if (!Array.isArray(spec.packages)) throw new Error('rin repository: expected packages array in ' + source)
  return {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'EnvironmentPackageCatalog',
    metadata: parseMetadata(value.metadata, source, sourcePath),
    spec: {
      ecosystem,
      packages: spec.packages.map((raw, index) => {
        const pkg = requireRecord(raw, source + ' package ' + index)
        const id = requireText(pkg.id, source + ' package ' + index + ' id')
        const name = requireText(pkg.name, source + ' package ' + index + ' name')
        assertSafePackageName(name, ecosystem)
        if (typeof pkg.version === 'string' && pkg.version.trim()) assertSafePackageVersion(pkg.version.trim())
        return {
          id,
          name,
          ...(typeof pkg.version === 'string' && pkg.version.trim() ? { version: pkg.version.trim() } : {}),
          ...(typeof pkg.description === 'string' && pkg.description.trim() ? { description: pkg.description.trim() } : {}),
        }
      }),
    },
  }
}

function parseEnvironmentProfile(input: unknown, source: string, sourcePath?: string): EnvironmentProfile {
  const value = requireRecord(input, source)
  if (value.apiVersion !== ASSET_REPOSITORY_API_VERSION || value.kind !== 'EnvironmentProfile') {
    throw new Error('rin repository: expected EnvironmentProfile in ' + source)
  }
  const spec = requireRecord(value.spec, source + ' spec')
  if (!Array.isArray(spec.packages)) throw new Error('rin repository: expected package references in ' + source)
  const verify = spec.verify && typeof spec.verify === 'object' && !Array.isArray(spec.verify)
    ? spec.verify as Record<string, unknown>
    : undefined
  return {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'EnvironmentProfile',
    metadata: parseMetadata(value.metadata, source, sourcePath),
    spec: {
      packages: spec.packages.map((id, index) => requireText(id, source + ' package reference ' + index)),
      ...(verify ? { verify: {
        ...(Array.isArray(verify.pythonImports) ? { pythonImports: verify.pythonImports.map((name, index) => {
          const normalized = requireText(name, source + ' python import ' + index)
          assertSafePythonImport(normalized)
          return normalized
        }) } : {}),
        ...(Array.isArray(verify.rPackages) ? { rPackages: verify.rPackages.map((name, index) => {
          const normalized = requireText(name, source + ' R package ' + index)
          assertSafeRPackage(normalized)
          return normalized
        }) } : {}),
        ...(Array.isArray(verify.commands) ? { commands: verify.commands.map((command, index) => {
          const normalized = requireText(command, source + ' verify command ' + index)
          assertSafeReviewableCommand(normalized)
          return normalized
        }) } : {}),
      } } : {}),
    },
  }
}

function parseRepositoryAgent(input: unknown, source: string, sourcePath?: string): RepositoryAgentConfiguration {
  const value = requireRecord(input, source)
  if (value.version !== 2 || value.kind !== 'AgentConfiguration') {
    throw new Error('rin repository: expected AgentConfiguration v2 in ' + source)
  }
  const name = requireText(value.name, source + ' Agent name')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) throw new Error('rin repository: invalid Agent name in ' + source)
  const description = requireText(value.description, source + ' Agent description')
  if (typeof value.systemPrompt !== 'string' || !value.systemPrompt.trim()) {
    throw new Error('rin repository: Agent instructions are required in ' + source)
  }
  const resources = value.resources === undefined ? {} : requireRecord(value.resources, source + ' Agent resources')
  const permissionMode = value.permissionMode
  if (permissionMode !== undefined && !isAgentPermissionMode(permissionMode)) {
    throw new Error('rin repository: invalid Agent permission mode in ' + source)
  }
  return {
    version: 2,
    kind: 'AgentConfiguration',
    name,
    description,
    systemPrompt: value.systemPrompt.trim(),
    ...(sourcePath === undefined ? {} : { source: sourcePath }),
    ...(typeof value.model === 'string' && value.model.trim() ? { model: value.model.trim() } : {}),
    ...(isAgentPermissionMode(permissionMode) ? { permissionMode } : {}),
    tools: parseTextList(value.tools, source + ' Agent tools'),
    resources: {
      ...(typeof resources.environmentProfileId === 'string' && resources.environmentProfileId.trim()
        ? { environmentProfileId: resources.environmentProfileId.trim() }
        : {}),
      skillIds: parseTextList(resources.skillIds, source + ' Agent Skill references'),
      workflowIds: parseTextList(resources.workflowIds, source + ' Agent workflow references'),
    },
  }
}

function parseMetadata(input: unknown, source: string, sourcePath?: string): AssetMetadata {
  const metadata = requireRecord(input, source + ' metadata')
  return {
    id: requireText(metadata.id, source + ' metadata.id'),
    name: requireText(metadata.name, source + ' metadata.name'),
    version: requireText(metadata.version, source + ' metadata.version'),
    ...(sourcePath === undefined ? {} : { source: sourcePath }),
  }
}

function resolveRepositoryChild(root: string, configuredPath: string | undefined, key: string): string {
  if (!configuredPath || isAbsolute(configuredPath)) {
    throw new Error('rin repository: root "' + key + '" must be relative')
  }
  const child = resolve(root, configuredPath)
  const relation = relative(root, child)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('rin repository: root "' + key + '" escapes the repository')
  }
  return child
}

/** POSIX-normalized repository-relative path of one file under the root. */
function repoRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

async function readYamlDocument(path: string): Promise<unknown> {
  return parseYaml(await readFile(path, 'utf8')) as unknown
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('rin repository: expected object for ' + label)
  }
  return value as Record<string, unknown>
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('rin repository: expected non-empty string for ' + label)
  }
  return value.trim()
}

function parseTextList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('rin repository: expected array for ' + label)
  return [...new Set(value.map((item, index) => requireText(item, label + ' ' + index)))]
}

function isAgentPermissionMode(value: unknown): value is NonNullable<RepositoryAgentConfiguration['permissionMode']> {
  return value === 'default' || value === 'acceptEdits' || value === 'plan' || value === 'bypassPermissions'
}

function isEcosystem(value: unknown): value is RepositoryPackageEcosystem {
  return typeof value === 'string' && ECOSYSTEMS.has(value as RepositoryPackageEcosystem)
}

function isRepositoryRoot(value: unknown): value is RepositoryRoot {
  return typeof value === 'string' && REPOSITORY_ROOTS.has(value as RepositoryRoot)
}

function assertUniqueId(ids: Set<string>, id: string): void {
  if (ids.has(id)) throw new Error('rin repository: duplicate asset id: ' + id)
  ids.add(id)
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function readDirectory(path: string) {
  return readdir(path, { withFileTypes: true }).catch(error => {
    if (isMissingPathError(error)) return []
    throw error
  })
}
