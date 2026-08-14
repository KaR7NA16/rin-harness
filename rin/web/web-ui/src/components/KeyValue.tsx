function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function KeyValue({ name, value }: { name: string; value: unknown }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{name}</span>
      <code>{formatValue(value)}</code>
    </div>
  )
}
