/**
 * Resolve an environment profile and build its dependency-ordered install plan.
 *
 * @module @rin/environment
 */

import type {
  AssetRepository,
  EnvironmentPackage,
  InstallPlanStage,
  InstallPreflightCheck,
  ResolvedEnvironmentPlan,
  ResolverCapabilities,
} from '@rin/repository'
import type { ResolvedEnvironment } from './types.ts'

const STAGE_ORDER: Array<Exclude<InstallPlanStage['id'], 'verification'>> = [
  'system', 'python', 'r', 'node', 'latex',
]
const ECOSYSTEM_PRIORITY: Record<string, number> = {
  system: 0, python: 1, node: 2, r: 3, latex: 4, other: 5,
}

/**
 * Resolve one profile plus the transitive closure of its packages' declared
 * dependencies. Fails loud on an unknown profile or an unknown package.
 *
 * @param repo - the asset repository read from disk.
 * @param profileId - the profile metadata id to resolve.
 * @returns the profile plus its resolved packages, in breadth-first order.
 */
export function resolveEnvironment(repo: AssetRepository, profileId: string): ResolvedEnvironment {
  const profile = repo.environmentProfiles.find(p => p.metadata.id === profileId)
  if (profile === undefined) {
    throw new Error('rin environment: unknown profile "' + profileId + '"')
  }
  const byId = new Map(repo.environmentPackages.map(p => [p.id, p]))
  const resolved = new Map<string, EnvironmentPackage>()
  const seen = new Set<string>()
  const queue: Array<[id: string, dependent: string | null]> = profile.spec.packages.map(id => [id, null])

  while (queue.length > 0) {
    const [id, dependent] = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const pkg = byId.get(id)
    if (pkg === undefined) {
      if (dependent === null) {
        throw new Error('rin environment: profile "' + profileId + '" references unknown package "' + id + '"')
      }
      throw new Error('rin environment: package "' + dependent + '" depends on unknown package "' + id + '"')
    }
    resolved.set(id, pkg)
    for (const dep of pkg.dependencies ?? []) queue.push([dep, id])
  }

  return { profile, packages: [...resolved.values()] }
}

/**
 * Build the install plan: resolve the profile, topologically order its packages,
 * run capability preflight, and emit per-ecosystem command stages plus a
 * verification stage. A failed preflight yields a blocked plan with empty stages.
 *
 * @param repo - the asset repository read from disk.
 * @param profileId - the profile metadata id to plan.
 * @param capabilities - the sandbox runtimes the plan will execute against.
 * @returns the ready or blocked plan.
 */
export function buildInstallPlan(
  repo: AssetRepository,
  profileId: string,
  capabilities: ResolverCapabilities,
): ResolvedEnvironmentPlan {
  const { profile, packages } = resolveEnvironment(repo, profileId)
  const preflight = buildPreflight(packages, capabilities)
  if (preflight.some(check => check.status !== 'ready')) {
    return {
      profileId,
      profileVersion: profile.metadata.version,
      status: 'blocked',
      packageCount: packages.length,
      preflight,
      stages: [],
    }
  }

  const stages = groupIntoStages(topologicalOrder(packages))
  const verification = verificationCommands(profile)
  if (verification.length) stages.push({ id: 'verification', commands: verification })

  return {
    profileId,
    profileVersion: profile.metadata.version,
    status: 'ready',
    packageCount: packages.length,
    preflight,
    stages,
  }
}

/** Kahn's algorithm over declared dependencies; stable and cycle-detecting. */
function topologicalOrder(packages: EnvironmentPackage[]): EnvironmentPackage[] {
  const byId = new Map(packages.map(p => [p.id, p]))
  const indegree = new Map(packages.map(p => [p.id, 0]))
  const dependents = new Map<string, string[]>()

  for (const pkg of packages) {
    for (const dep of pkg.dependencies ?? []) {
      if (dep === pkg.id) {
        throw new Error('rin environment: package "' + pkg.id + '" depends on itself')
      }
      indegree.set(pkg.id, (indegree.get(pkg.id) ?? 0) + 1)
      const list = dependents.get(dep) ?? []
      list.push(pkg.id)
      dependents.set(dep, list)
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((a, b) => compare(a, b, byId))

  const ordered: EnvironmentPackage[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(byId.get(id)!)
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, next)
      if (next === 0) queue.push(dependent)
    }
    queue.sort((a, b) => compare(a, b, byId))
  }

  if (ordered.length !== packages.length) {
    const cyclic = packages.filter(p => !ordered.includes(p)).map(p => p.id)
    throw new Error('rin environment: dependency cycle involving: ' + cyclic.join(', '))
  }
  return ordered
}

/** Deterministic tie-break: ecosystem priority, then package id. */
function compare(a: string, b: string, byId: Map<string, EnvironmentPackage>): number {
  const pa = ECOSYSTEM_PRIORITY[byId.get(a)!.ecosystem] ?? 99
  const pb = ECOSYSTEM_PRIORITY[byId.get(b)!.ecosystem] ?? 99
  if (pa !== pb) return pa - pb
  return a < b ? -1 : a > b ? 1 : 0
}

/** Group the topo-ordered packages into per-ecosystem command stages. */
function groupIntoStages(packages: EnvironmentPackage[]): InstallPlanStage[] {
  const byEcosystem = new Map<string, string[]>()
  for (const pkg of packages) {
    const command = packageCommand(pkg)
    if (command === null) continue
    const list = byEcosystem.get(pkg.ecosystem) ?? []
    list.push(command)
    byEcosystem.set(pkg.ecosystem, list)
  }
  return STAGE_ORDER.flatMap(id => {
    const commands = byEcosystem.get(id)
    return commands?.length ? [{ id, commands }] : []
  })
}

function buildPreflight(packages: EnvironmentPackage[], capabilities: ResolverCapabilities): InstallPreflightCheck[] {
  const ecosystems = new Set(packages.map(pkg => pkg.ecosystem))
  const checks: InstallPreflightCheck[] = []
  if (ecosystems.has('system')) {
    checks.push(capabilities.platform === 'linux'
      ? check('platform-system', capabilities.runtimes.apt, 'apt is required')
      : { id: 'platform-system', status: 'unsupported', message: 'system packages require a Linux sandbox' })
  }
  if (ecosystems.has('python')) {
    checks.push(check('runtime-python', capabilities.runtimes.python && capabilities.runtimes.pip, 'Python and pip are required'))
  }
  if (ecosystems.has('r')) checks.push(check('runtime-r', capabilities.runtimes.r, 'Rscript is required'))
  if (ecosystems.has('node')) checks.push(check('runtime-node', capabilities.runtimes.npm, 'npm is required'))
  if (ecosystems.has('latex')) checks.push(check('runtime-latex', capabilities.runtimes.tlmgr, 'tlmgr is required'))
  return checks
}

function check(id: string, ready: boolean, missingMessage: string): InstallPreflightCheck {
  return { id, status: ready ? 'ready' : 'missing', message: ready ? 'ready' : missingMessage }
}

function packageCommand(pkg: EnvironmentPackage): string | null {
  const version = pkg.version?.trim()
  if (pkg.ecosystem === 'system') {
    return 'apt-get install -y ' + pkg.name + (version && isExactVersion(version) ? '=' + version : '')
  }
  if (pkg.ecosystem === 'python') {
    if (!version) return 'python -m pip install ' + pkg.name
    return isExactVersion(version)
      ? 'python -m pip install ' + pkg.name + '==' + version
      : 'python -m pip install "' + pkg.name + version + '"'
  }
  if (pkg.ecosystem === 'r') return 'Rscript -e "' + rInstallExpression(pkg.name) + '"'
  if (pkg.ecosystem === 'node') {
    if (!version) return 'npm install --global ' + pkg.name
    return isExactVersion(version)
      ? 'npm install --global ' + pkg.name + '@' + version
      : 'npm install --global "' + pkg.name + '@' + version + '"'
  }
  if (pkg.ecosystem === 'latex') return 'tlmgr install ' + pkg.name
  return null
}

/** True when a version specifier is a bare exact version (no range operators). */
function isExactVersion(version: string): boolean {
  return /^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)
}

function verificationCommands(profile: ResolvedEnvironment['profile']): string[] {
  return [
    ...(profile.spec.verify?.pythonImports?.length
      ? ['python -c "' + profile.spec.verify.pythonImports.map(name => 'import ' + name).join('; ') + '"']
      : []),
    ...(profile.spec.verify?.rPackages?.length
      ? ['Rscript -e "' + profile.spec.verify.rPackages.map(rLibraryExpression).join('; ') + '"']
      : []),
    ...(profile.spec.verify?.commands ?? []),
  ]
}

function rInstallExpression(pkgName: string): string {
  return "install.packages('" + escapeR(pkgName) + "', repos='https://cloud.r-project.org')"
}

function rLibraryExpression(pkgName: string): string {
  return "library('" + escapeR(pkgName) + "')"
}

function escapeR(value: string): string {
  return value.replaceAll("'", "\\'")
}
