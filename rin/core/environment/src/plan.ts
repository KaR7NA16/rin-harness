/**
 * Resolve an environment profile and build its dependency-ordered install plan.
 *
 * @module @rin/environment
 */

import type { AssetRepository, EnvironmentPackage } from '@rin/repository'
import type { EnvironmentInstallPlan, EnvironmentInstallStep, ResolvedEnvironment } from './types.ts'

const ECOSYSTEM_PRIORITY: Record<string, number> = {
  system: 0,
  python: 1,
  node: 2,
  r: 3,
  latex: 4,
  other: 5,
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
 * Build the install plan: resolve the profile, topologically order its packages
 * by their declared dependencies, and group consecutive same-ecosystem runs into
 * steps. Throws on an unknown package, a missing dependency, or a cycle.
 *
 * @param repo - the asset repository read from disk.
 * @param profileId - the profile metadata id to plan.
 * @returns ordered install steps plus the profile's verify block.
 */
export function buildInstallPlan(repo: AssetRepository, profileId: string): EnvironmentInstallPlan {
  const { profile, packages } = resolveEnvironment(repo, profileId)
  return {
    profileId,
    steps: groupByEcosystem(topologicalOrder(packages)),
    verify: profile.spec.verify,
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

/** Group a topologically ordered package list into consecutive same-ecosystem runs. */
function groupByEcosystem(packages: EnvironmentPackage[]): EnvironmentInstallStep[] {
  const steps: EnvironmentInstallStep[] = []
  for (const pkg of packages) {
    const last = steps[steps.length - 1]
    if (last !== undefined && last.ecosystem === pkg.ecosystem) {
      last.packageIds.push(pkg.id)
    } else {
      steps.push({ ecosystem: pkg.ecosystem, packageIds: [pkg.id] })
    }
  }
  return steps
}
