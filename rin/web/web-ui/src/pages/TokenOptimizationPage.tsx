/**
 * TokenOptimizationPage — the three live knobs of the token-saving family.
 *
 * Response-style switch + prompt-cleaner toggle (POST /api/token-optimization/set)
 * and the smart-pruning level slider + enabled toggle (POST /api/smart-pruning/set).
 * Every control submits immediately, updates optimistically, and rolls back on
 * failure. No polling, no charts.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Mounted } from '../api'
import { apiGet, apiPost } from '../api'
import type {
  ResponseStyle,
  SmartPruningLevel,
  SmartPruningStatus,
  TokenOptimizationStatus,
} from '../types'
import { ErrorBox } from '../components/ErrorBox'
import { Loading } from '../components/Loading'
import { MountedNotice } from '../components/MountedNotice'

const RESPONSE_STYLES: { value: ResponseStyle; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'caveman', label: 'caveman' },
  { value: 'ponytail', label: 'ponytail' },
]

const LEVEL_LABELS: Record<SmartPruningLevel, string> = {
  conservative: 'conservative',
  balanced: 'balanced',
  aggressive: 'aggressive',
}

/** Map a pruning level to its slider index (aggressive sits at the max, 3). */
function levelToIndex(level: SmartPruningLevel): number {
  return level === 'conservative' ? 0 : level === 'balanced' ? 1 : 3
}

/** Map a 0–3 slider index to a pruning level (3 saturates to aggressive). */
function indexToLevel(index: number): SmartPruningLevel {
  return index <= 0 ? 'conservative' : index === 1 ? 'balanced' : 'aggressive'
}

function failMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function TokenOptimizationPage() {
  const [token, setToken] = useState<TokenOptimizationStatus | null>(null)
  const [tokenMounted, setTokenMounted] = useState(true)
  const [pruning, setPruning] = useState<SmartPruningStatus | null>(null)
  const [pruningMounted, setPruningMounted] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tokenStatus, pruningStatus] = await Promise.all([
        apiGet<Mounted<TokenOptimizationStatus>>('/api/token-optimization/status'),
        apiGet<Mounted<SmartPruningStatus>>('/api/smart-pruning/status'),
      ])
      setTokenMounted(tokenStatus.mounted === true)
      setPruningMounted(pruningStatus.mounted === true)
      if (tokenStatus.mounted === true) setToken(tokenStatus)
      if (pruningStatus.mounted === true) setPruning(pruningStatus)
    } catch (cause) {
      setError(failMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setResponseStyle = async (style: ResponseStyle) => {
    if (token === null) return
    const previous = token
    setToken({ ...token, responseStyle: style })
    setError(null)
    try {
      const updated = await apiPost<Mounted<TokenOptimizationStatus>>('/api/token-optimization/set', { responseStyle: style })
      if (updated.mounted === true) setToken(updated)
    } catch (cause) {
      setToken(previous)
      setError(failMessage(cause))
    }
  }

  const setCleanPrompt = async (enabled: boolean) => {
    if (token === null) return
    const previous = token
    setToken({ ...token, cleanPrompt: enabled })
    setError(null)
    try {
      const updated = await apiPost<Mounted<TokenOptimizationStatus>>('/api/token-optimization/set', { cleanPrompt: enabled })
      if (updated.mounted === true) setToken(updated)
    } catch (cause) {
      setToken(previous)
      setError(failMessage(cause))
    }
  }

  const setPruningEnabled = async (enabled: boolean) => {
    if (pruning === null) return
    const previous = pruning
    setPruning({ ...pruning, enabled })
    setError(null)
    try {
      const updated = await apiPost<Mounted<SmartPruningStatus>>('/api/smart-pruning/set', { enabled })
      if (updated.mounted === true) setPruning(updated)
    } catch (cause) {
      setPruning(previous)
      setError(failMessage(cause))
    }
  }

  const setPruningLevel = async (index: number) => {
    if (pruning === null) return
    const level = indexToLevel(index)
    const previous = pruning
    setPruning({ ...pruning, level })
    setError(null)
    try {
      const updated = await apiPost<Mounted<SmartPruningStatus>>('/api/smart-pruning/set', { level })
      if (updated.mounted === true) setPruning(updated)
    } catch (cause) {
      setPruning(previous)
      setError(failMessage(cause))
    }
  }

  if (loading) return <div className="page"><h1 className="page-title">TokenOptimization</h1><Loading /></div>

  return (
    <div className="page">
      <h1 className="page-title">TokenOptimization</h1>
      {error !== null ? <ErrorBox message={error} /> : null}

      <section className="card">
        <h3 className="section-title">响应风格 (response style)</h3>
        {tokenMounted && token !== null ? (
          <div className="radio-group" role="radiogroup" aria-label="response style">
            {RESPONSE_STYLES.map(style => (
              <label key={style.value} className="radio-label">
                <input
                  type="radio"
                  name="response-style"
                  checked={token.responseStyle === style.value}
                  onChange={() => void setResponseStyle(style.value)}
                />
                <span>{style.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <MountedNotice />
        )}
      </section>

      <section className="card">
        <h3 className="section-title">Prompt 清理 (prompt cleaner)</h3>
        {tokenMounted && token !== null ? (
          <label className="switch-row">
            <input
              type="checkbox"
              checked={token.cleanPrompt}
              onChange={event => void setCleanPrompt(event.target.checked)}
            />
            <span>{token.cleanPrompt ? 'enabled' : 'disabled'}</span>
          </label>
        ) : (
          <MountedNotice />
        )}
      </section>

      <section className="card">
        <h3 className="section-title">智能裁剪 (smart pruning)</h3>
        {pruningMounted && pruning !== null ? (
          <>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={pruning.enabled}
                onChange={event => void setPruningEnabled(event.target.checked)}
              />
              <span>{pruning.enabled ? 'enabled' : 'disabled'}</span>
            </label>
            <div className="range-row">
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={levelToIndex(pruning.level)}
                onChange={event => void setPruningLevel(Number(event.target.value))}
              />
              <code className="range-value">{LEVEL_LABELS[pruning.level]}</code>
            </div>
            <div className="range-ticks mono">
              <span>conservative</span>
              <span>balanced</span>
              <span>aggressive</span>
            </div>
          </>
        ) : (
          <MountedNotice />
        )}
      </section>
    </div>
  )
}
