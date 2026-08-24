export type ProviderCatalogRow = {
  key: string
  name?: string
  isActive: boolean
  isConfigured: boolean
}

export function groupProviderCatalogRows<T extends ProviderCatalogRow>(rows: T[]) {
  return rows.reduce<{
    active: T[]
    configured: T[]
    available: T[]
  }>((groups, row) => {
    if (row.isActive) groups.active.push(row)
    else if (row.isConfigured) groups.configured.push(row)
    else groups.available.push(row)
    return groups
  }, { active: [], configured: [], available: [] })
}
