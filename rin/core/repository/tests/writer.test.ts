import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { applyRepositoryMigration, createAssetRepository, writeEnvironmentPackages } from '../src/writer.ts'
import { readAssetRepository } from '../src/reader.ts'
import { planLegacyRepositoryMigration } from '../src/migration.ts'
import type { EnvironmentPackage } from '../src/types.ts'

describe('createAssetRepository', () => {
  test('writes the manifest and creates every partition root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-writer-'))
    await createAssetRepository(root, 'my-repo', 'My Repo')
    const manifest = await readFile(join(root, 'repository.yaml'), 'utf8')
    expect(manifest).toContain('kind: AssetRepository')
    expect(manifest).toContain('my-repo')
    const entries = (await readdir(root)).sort()
    expect(entries).toEqual([
      'agents', 'bundles', 'environments', 'knowledge', 'outputs', 'policies',
      'repository.yaml', 'skills', 'tools', 'workflows',
    ])
    expect(await readdir(join(root, 'environments'))).toEqual(['packages'])
    const repo = await readAssetRepository(root)
    expect(repo.manifest.metadata.id).toBe('my-repo')
  })
})

describe('writeEnvironmentPackages', () => {
  test('writes per-ecosystem catalogs and drops the ecosystem field', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-writer-'))
    await createAssetRepository(root, 'r', 'R')
    const packages: EnvironmentPackage[] = [
      { id: 'numpy', name: 'numpy', ecosystem: 'python' },
      { id: 'libc6', name: 'libc6', ecosystem: 'system' },
    ]
    await writeEnvironmentPackages(root, packages)
    const pythonYaml = await readFile(join(root, 'environments', 'packages', 'python.yaml'), 'utf8')
    expect(pythonYaml).toContain('numpy')
    expect(pythonYaml).toContain('ecosystem: python')
    // The per-package entry drops its ecosystem field; only the catalog carries it.
    expect(pythonYaml.match(/ecosystem:/g)).toHaveLength(1)
    const repo = await readAssetRepository(root)
    expect(repo.environmentPackages).toHaveLength(2)
    expect(repo.environmentPackages.map(pkg => pkg.ecosystem).sort()).toEqual(['python', 'system'])
  })
})

describe('applyRepositoryMigration', () => {
  test('writes every file produced by a migration plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-writer-'))
    const plan = planLegacyRepositoryMigration({
      version: 1,
      name: 'Migrated',
      categories: [{ id: 'environment', packages: [{ id: 'numpy', name: 'numpy', ecosystem: 'python' }] }],
    })
    await applyRepositoryMigration(root, plan)
    expect(await readFile(join(root, 'repository.yaml'), 'utf8')).toContain('AssetRepository')
    expect(await readFile(join(root, 'environments', 'packages', 'python.yaml'), 'utf8')).toContain('numpy')
  })
})
