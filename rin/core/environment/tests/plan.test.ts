import { describe, expect, test } from 'vitest'
import type { AssetRepository, EnvironmentPackage, EnvironmentProfile } from '@rin/repository'
import { buildInstallPlan, resolveEnvironment } from '../src/plan.ts'

function makeRepo(profiles: EnvironmentProfile[], packages: EnvironmentPackage[]): AssetRepository {
  return {
    rootPath: '/repo',
    manifestPath: '/repo/repository.yaml',
    manifest: {
      apiVersion: 'rin.dev/v1',
      kind: 'AssetRepository',
      metadata: { id: 'built-in', name: 'Built-in', version: '1.0.0' },
      spec: { mutable: true, roots: {} },
    },
    environmentCatalogs: [],
    environmentPackages: packages,
    environmentProfiles: profiles,
    agents: [],
  }
}

function profile(id: string, packages: string[], verify?: EnvironmentProfile['spec']['verify']): EnvironmentProfile {
  return {
    apiVersion: 'rin.dev/v1',
    kind: 'EnvironmentProfile',
    metadata: { id, name: id, version: '1.0.0' },
    spec: { packages, verify },
  }
}

describe('resolveEnvironment', () => {
  test('resolves a profile to its declared packages', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas', 'numpy'])],
      [
        { id: 'numpy', name: 'numpy', ecosystem: 'python' },
        { id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['numpy'] },
      ],
    )
    const resolved = resolveEnvironment(repo, 'ml')
    expect(resolved.packages.map(p => p.id)).toEqual(['pandas', 'numpy'])
  })

  test('rejects an unknown profile id', () => {
    const repo = makeRepo([], [])
    expect(() => resolveEnvironment(repo, 'missing')).toThrow(/unknown profile/)
  })

  test('rejects a profile referencing an unknown package', () => {
    const repo = makeRepo(
      [profile('ml', ['numpy', 'does-not-exist'])],
      [{ id: 'numpy', name: 'numpy', ecosystem: 'python' }],
    )
    expect(() => resolveEnvironment(repo, 'ml')).toThrow(/unknown package/)
  })
})

describe('buildInstallPlan', () => {
  test('orders a dependency before its dependent', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas', 'numpy'])],
      [
        { id: 'numpy', name: 'numpy', ecosystem: 'python' },
        { id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['numpy'] },
      ],
    )
    const ids = buildInstallPlan(repo, 'ml').steps.flatMap(s => s.packageIds)
    expect(ids.indexOf('numpy')).toBeLessThan(ids.indexOf('pandas'))
  })

  test('groups consecutive same-ecosystem packages into one step', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas', 'numpy'])],
      [
        { id: 'numpy', name: 'numpy', ecosystem: 'python' },
        { id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['numpy'] },
      ],
    )
    expect(buildInstallPlan(repo, 'ml').steps).toEqual([
      { ecosystem: 'python', packageIds: ['numpy', 'pandas'] },
    ])
  })

  test('includes transitive dependencies not listed in the profile', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas'])],
      [
        { id: 'numpy', name: 'numpy', ecosystem: 'python' },
        { id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['numpy'] },
      ],
    )
    expect(buildInstallPlan(repo, 'ml').steps.flatMap(s => s.packageIds)).toEqual(['numpy', 'pandas'])
  })

  test('orders a system package before a python package that depends on it', () => {
    const repo = makeRepo(
      [profile('ml', ['matplotlib', 'gcc'])],
      [
        { id: 'gcc', name: 'gcc', ecosystem: 'system' },
        { id: 'matplotlib', name: 'matplotlib', ecosystem: 'python', dependencies: ['gcc'] },
      ],
    )
    const ids = buildInstallPlan(repo, 'ml').steps.flatMap(s => s.packageIds)
    expect(ids).toEqual(['gcc', 'matplotlib'])
  })

  test('rejects a package depending on an unknown package', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas'])],
      [{ id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['missing'] }],
    )
    expect(() => buildInstallPlan(repo, 'ml')).toThrow(/depends on unknown package/)
  })

  test('rejects a dependency cycle', () => {
    const repo = makeRepo(
      [profile('ml', ['a', 'b'])],
      [
        { id: 'a', name: 'a', ecosystem: 'python', dependencies: ['b'] },
        { id: 'b', name: 'b', ecosystem: 'python', dependencies: ['a'] },
      ],
    )
    expect(() => buildInstallPlan(repo, 'ml')).toThrow(/cycle/)
  })

  test('carries the profile verify block through to the plan', () => {
    const repo = makeRepo(
      [profile('ml', ['numpy'], { pythonImports: ['numpy'] })],
      [{ id: 'numpy', name: 'numpy', ecosystem: 'python' }],
    )
    expect(buildInstallPlan(repo, 'ml').verify).toEqual({ pythonImports: ['numpy'] })
  })
})
