export function Loading({ label = 'loading…' }: { label?: string }) {
  return <div className="muted">{label}</div>
}
