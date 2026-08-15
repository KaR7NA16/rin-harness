export type SettingsSearchEntry = {
  id: string
  label: string
  description: string
  keywords: string[]
  sectionLabel: string
  tab: string
  target?: string
  advanced?: boolean
}

export function searchSettings(query: string, entries: SettingsSearchEntry[]): SettingsSearchEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []

  return entries.filter((entry) => [
    entry.label,
    entry.description,
    entry.sectionLabel,
    ...entry.keywords,
  ].join(' ').toLocaleLowerCase().includes(normalizedQuery))
}
