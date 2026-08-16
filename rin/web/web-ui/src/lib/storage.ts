/**
 * localStorage helpers shared by web-ui stores.
 *
 * rin migrated from an earlier product whose persisted keys used the
 * `cybercode*` prefix. Reads consult the new rin key first and then the
 * legacy key so one-time migration is automatic; writes always use the new
 * key and never resurrect the legacy namespace.
 */

/** Read one string value, preferring `key` and falling back to `legacyKey`. */
export function readStoredValue(key: string, legacyKey?: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key) ?? (legacyKey ? window.localStorage.getItem(legacyKey) : null)
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

/**
 * Read and parse JSON, preferring `key` and falling back to `legacyKey`.
 * Returns `fallback` when both keys are absent or unparseable.
 */
export function readStoredJson<T>(key: string, legacyKey: string | undefined, fallback: T): T {
  const raw = readStoredValue(key, legacyKey)
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
