export function StatusDot({ on }: { on: boolean }) {
  return <span className={on ? 'dot dot-on' : 'dot dot-off'} />
}
