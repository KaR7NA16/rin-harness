/**
 * localStorage helpers shared by web-ui stores.
 *
 * All persisted state uses the `rin` namespace. There is no legacy-key
 * fallback: rin-harness is the new base and does not migrate old browser data.
 */

/** Read one string value. */
export function readStoredValue(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Write one string value; failures are intentionally silent. */
export function writeStoredValue(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in private browsing or packaged webviews.
  }
}

/** Remove one key; failures are intentionally silent. */
export function removeStoredValue(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in private browsing or packaged webviews.
  }
}

/** Read and parse JSON; returns `fallback` when absent or unparseable. */
export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStoredValue(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Persist JSON under the new rin key; failures are intentionally silent. */
export function writeStoredJson(key: string, value: unknown): void {
  writeStoredValue(key, JSON.stringify(value))
}
