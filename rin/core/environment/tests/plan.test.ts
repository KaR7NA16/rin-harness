import { describe, expect, test } from 'vitest'
import type { AssetRepository, EnvironmentPackage, EnvironmentProfile, ResolverCapabilities } from '@rin/repository'
import { buildInstallPlan, resolveEnvironment } from '../src/plan.ts'

const CAPABILITIES: ResolverCapabilities = {
  platform: 'linux',
  runtimes: { apt: true, python: true, pip: true, r: true, npm: true, tlmgr: true },
}

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
  test('emits a dependency-ordered pip stage and a verification stage', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas'], { pythonImports: ['pandas'] })],
      [
        { id: 'numpy', name: 'numpy', ecosystem: 'python' },
        { id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['numpy'] },
      ],
    )
    const plan = buildInstallPlan(repo, 'ml', CAPABILITIES)
    expect(plan.status).toBe('ready')
    expect(plan.packageCount).toBe(2)
    expect(plan.stages).toEqual([
      { id: 'python', commands: ['python -m pip install numpy', 'python -m pip install pandas'] },
      { id: 'verification', commands: ['python -c "import pandas"'] },
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
    expect(buildInstallPlan(repo, 'ml', CAPABILITIES).packageCount).toBe(2)
  })

  test('blocks when a required runtime is missing', () => {
    const repo = makeRepo([profile('ml', ['numpy'])], [{ id: 'numpy', name: 'numpy', ecosystem: 'python' }])
    const plan = buildInstallPlan(repo, 'ml', {
      platform: 'linux',
      runtimes: { ...CAPABILITIES.runtimes, pip: false },
    })
    expect(plan.status).toBe('blocked')
    expect(plan.stages).toEqual([])
    expect(plan.preflight.some(c => c.status === 'missing')).toBe(true)
  })

  test('marks system packages unsupported off Linux', () => {
    const repo = makeRepo([profile('ml', ['gcc'])], [{ id: 'gcc', name: 'gcc', ecosystem: 'system' }])
    const plan = buildInstallPlan(repo, 'ml', { platform: 'win32', runtimes: CAPABILITIES.runtimes })
    expect(plan.status).toBe('blocked')
    expect(plan.preflight[0]?.status).toBe('unsupported')
  })

  test('rejects a package depending on an unknown package', () => {
    const repo = makeRepo(
      [profile('ml', ['pandas'])],
      [{ id: 'pandas', name: 'pandas', ecosystem: 'python', dependencies: ['missing'] }],
    )
    expect(() => buildInstallPlan(repo, 'ml', CAPABILITIES)).toThrow(/depends on unknown package/)
  })

  test('rejects a dependency cycle', () => {
    const repo = makeRepo(
      [profile('ml', ['a', 'b'])],
      [
        { id: 'a', name: 'a', ecosystem: 'python', dependencies: ['b'] },
        { id: 'b', name: 'b', ecosystem: 'python', dependencies: ['a'] },
      ],
    )
    expect(() => buildInstallPlan(repo, 'ml', CAPABILITIES)).toThrow(/cycle/)
  })
})
