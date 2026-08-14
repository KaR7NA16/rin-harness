import { useCallback, useEffect, useState } from 'react'
import { apiGet } from './api'

/** State of one in-flight GET. */
export interface ApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/**
 * Fetch one GET endpoint and expose its state. Passing null suspends the fetch
 * (e.g. when a required query parameter is still missing). reload() re-runs
 * the current request.
 */
export function useApi<T>(path: string | null): ApiState<T> & { reload: () => void } {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    loading: path !== null,
  })
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => {
    setTick(value => value + 1)
  }, [])

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false })
      return
    }

    let cancelled = false
    setState(prev => ({ data: prev.data, error: null, loading: true }))
    apiGet<T>(path)
      .then(data => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: cause instanceof Error ? cause.message : String(cause),
            loading: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [path, tick])

  return { ...state, reload }
}
