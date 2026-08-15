import { describe, expect, it } from 'vitest'
import { groupProviderCatalogRows, type ProviderCatalogRow } from './providerCatalog'

const rows: ProviderCatalogRow[] = [
  { key: 'active', name: 'Active', isActive: true, isConfigured: true },
  { key: 'configured', name: 'Configured', isActive: false, isConfigured: true },
  { key: 'available', name: 'Available', isActive: false, isConfigured: false },
]

describe('groupProviderCatalogRows', () => {
  it('separates active, configured, and available providers', () => {
    expect(groupProviderCatalogRows(rows)).toEqual({
      active: [rows[0]],
      configured: [rows[1]],
      available: [rows[2]],
    })
  })
})
