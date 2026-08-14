export type BadgeTone = 'ok' | 'bad' | 'muted' | 'warn'

export function Badge({ value, tone = 'muted' }: { value: string; tone?: BadgeTone }) {
  return <span className={'badge badge-' + tone}>{value}</span>
}

/** Map a domain status string to a badge tone. */
export function toneForStatus(value: string): BadgeTone {
  if (value === 'ready' || value === 'active' || value === 'approved' || value === 'pinned') return 'ok'
  if (value === 'blocked' || value === 'missing' || value === 'error' || value === 'rejected' || value === 'failed') return 'bad'
  if (value === 'unsupported' || value === 'off' || value === 'archived' || value === 'empty' || value === 'stale') return 'muted'
  return 'warn'
}
