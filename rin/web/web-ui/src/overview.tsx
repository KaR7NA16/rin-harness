import { KeyValue } from './components/KeyValue'
import { ListDetail } from './components/ListDetail'
import type { ListItemLabel } from './components/ListDetail'

/** True for a plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Extract the first array-valued field from a mounted envelope. List endpoints
 * (sources, documents, search results, review logs) wrap their array under a
 * key; this reads whichever key the server chose.
 */
export function extractList(data: Record<string, unknown>): unknown[] {
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value
  }
  return []
}

/** Best-effort human label for a generic list item. */
function summaryTitle(item: unknown): string {
  if (isRecord(item)) {
    const candidates = [item.name, item.skillName, item.title, item.id, item.sessionId, item.relativePath, item.kind]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate)
    }
  }
  if (typeof item === 'string' || typeof item === 'number') return String(item)
  return JSON.stringify(item).slice(0, 80)
}

function itemLabel(item: unknown): ListItemLabel {
  return { title: summaryTitle(item) }
}

/**
 * Structured renderer for an unknown overview payload: scalars become key/value
 * rows, arrays become list+detail sections, and nested objects are flattened
 * one level. Keeps the page readable without hard-coding the server's keys.
 */
export function Overview({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([key]) => key !== 'mounted')
  const scalars = entries.filter(([, value]) => value === null || typeof value !== 'object')
  const arrays = entries.filter(([, value]) => Array.isArray(value))
  const objects = entries.filter(([, value]) => isRecord(value))

  return (
    <>
      {scalars.length > 0 ? (
        <div className="card">
          {scalars.map(([key, value]) => (
            <KeyValue key={key} name={key} value={value} />
          ))}
        </div>
      ) : null}

      {objects.map(([key, value]) => (
        <div key={key} className="card">
          <h3 className="section-title">{key}</h3>
          {Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => (
            <KeyValue key={childKey} name={childKey} value={childValue} />
          ))}
        </div>
      ))}

      {arrays.map(([key, value]) => (
        <div key={key} className="card">
          <h3 className="section-title">{key} ({(value as unknown[]).length})</h3>
          <ListDetail items={value as unknown[]} label={itemLabel} />
        </div>
      ))}
    </>
  )
}
