import { describe, expect, test } from 'vitest'
import { planLegacyRepositoryMigration } from '../src/migration.ts'

describe('planLegacyRepositoryMigration', () => {
  test('plans a root manifest plus per-ecosystem catalogs', () => {
    const plan = planLegacyRepositoryMigration({
      version: 1,
      name: 'My Repo',
      categories: [{
        id: 'environment',
        packages: [
          { id: 'numpy', name: 'numpy', ecosystem: 'python', version: '>=2.0', description: 'Numeric' },
          { id: 'libc6', name: 'libc6', ecosystem: 'system' },
          { id: 'unknown-eco', name: 'X', ecosystem: 'bogus' },
        ],
      }],
    })
    expect(plan.sourceVersion).toBe(1)
    expect(plan.targetVersion).toBe(1)
    expect(plan.packageCount).toBe(3)
    const paths = plan.files.map(file => file.path)
    expect(paths).toContain('repository.yaml')
    expect(paths).toContain('environments/packages/python.yaml')
    expect(paths).toContain('environments/packages/system.yaml')
    expect(paths).toContain('environments/packages/other.yaml')
    const rootManifest = plan.files.find(file => file.path === 'repository.yaml')
    expect(rootManifest?.document.metadata.id).toBe('my-repo')
    const pythonCatalog = plan.files.find(file => file.path === 'environments/packages/python.yaml')
    if (pythonCatalog && 'spec' in pythonCatalog.document) {
      expect(pythonCatalog.document.spec.packages[0]).toMatchObject({ id: 'numpy', version: '>=2.0', description: 'Numeric' })
    }
  })

  test('plans only the root manifest when there are no environment packages', () => {
    const plan = planLegacyRepositoryMigration({ version: 1, name: 'R', categories: [] })
    expect(plan.packageCount).toBe(0)
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]?.path).toBe('repository.yaml')
  })

  test('rejects non-object, wrong-version, and category-less inputs', () => {
    expect(() => planLegacyRepositoryMigration(null)).toThrow(/Expected legacy repository manifest/)
    expect(() => planLegacyRepositoryMigration({ version: 2 })).toThrow(/version 1/)
    expect(() => planLegacyRepositoryMigration({ version: 1 })).toThrow(/categories/)
  })
})
