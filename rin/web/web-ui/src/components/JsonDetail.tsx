export function JsonDetail({ value }: { value: unknown }) {
  return <pre className="json-detail">{JSON.stringify(value, null, 2)}</pre>
}
