import { useState } from 'react'
import type { Mounted } from '../api'
import type {
  PromptMemoryFile,
  PromptMemoryLogsPayload,
  PromptMemoryReviewLogEntry,
  PromptMemoryStatus,
  PromptMemoryTarget,
} from '../types'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { KeyValue } from '../components/KeyValue'
import { ListDetail } from '../components/ListDetail'
import type { ListItemLabel } from '../components/ListDetail'

type PromptMode = 'status' | 'file' | 'review-logs'

const TARGETS: PromptMemoryTarget[] = ['soul', 'brief', 'user']

function logLabel(log: PromptMemoryReviewLogEntry): ListItemLabel {
  return {
    title: log.action + ' · ' + log.target,
    subtitle: log.timestamp + ' · ' + log.sessionId,
  }
}

function buildPath(request: PromptMode, target: PromptMemoryTarget, limit: string): string {
  switch (request) {
    case 'status':
      return '/api/prompt-memory/status'
    case 'file':
      return '/api/prompt-memory/file?target=' + target
    case 'review-logs':
      return limit === ''
        ? '/api/prompt-memory/review-logs'
        : '/api/prompt-memory/review-logs?limit=' + encodeURIComponent(limit)
  }
}

export default function PromptMemoryPage() {
  const [target, setTarget] = useState<PromptMemoryTarget>('user')
  const [limit, setLimit] = useState('')
  const [request, setRequest] = useState<PromptMode | null>(null)

  const path = request === null ? null : buildPath(request, target, limit.trim())
  const state = useApi<Mounted<Record<string, unknown>>>(path)

  return (
    <div className="page">
      <h1 className="page-title">PromptMemory</h1>
      <div className="page-toolbar">
        <button type="button" onClick={() => setRequest('status')}>Status</button>
        <label className="field-label" htmlFor="pm-target">target</label>
        <select id="pm-target" value={target} onChange={event => setTarget(event.target.value as PromptMemoryTarget)}>
          {TARGETS.map(value => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <button type="button" onClick={() => setRequest('file')}>Read file</button>
        <label className="field-label" htmlFor="pm-limit">limit</label>
        <input id="pm-limit" type="text" value={limit} onChange={event => setLimit(event.target.value)} placeholder="review-log limit" />
        <button type="button" onClick={() => setRequest('review-logs')}>Review logs</button>
      </div>

      {request === null ? (
        <div className="muted">Choose an action to inspect prompt memory.</div>
      ) : (
        <ServiceGate state={state}>
          {data => <PromptResult mode={request} data={data} />}
        </ServiceGate>
      )}
    </div>
  )
}

function PromptResult({ mode, data }: { mode: PromptMode; data: Record<string, unknown> }) {
  if (mode === 'status') {
    return <StatusView data={data as unknown as PromptMemoryStatus} />
  }
  if (mode === 'file') {
    return <FileView data={data as unknown as PromptMemoryFile} />
  }
  return (
    <ListDetail
      items={(data as unknown as PromptMemoryLogsPayload).logs}
      label={logLabel}
      empty="no review logs"
    />
  )
}

function StatusView({ data }: { data: PromptMemoryStatus }) {
  return (
    <div className="card">
      {TARGETS.map(value => {
        const file = data.files[value]
        return (
          <div key={value}>
            <h3 className="section-title">{value}</h3>
            <KeyValue name="filename" value={file.filename} />
            <KeyValue name="exists" value={file.exists} />
            <KeyValue name="format" value={file.format} />
            <KeyValue name="charCount" value={file.charCount + ' / ' + file.limit} />
            <KeyValue name="overLimit" value={file.overLimit} />
            <KeyValue name="entries" value={file.entries.length} />
          </div>
        )
      })}
    </div>
  )
}

function FileView({ data }: { data: PromptMemoryFile }) {
  return (
    <>
      <div className="card">
        <KeyValue name="target" value={data.target} />
        <KeyValue name="filename" value={data.filename} />
        <KeyValue name="path" value={data.path} />
        <KeyValue name="exists" value={data.exists} />
        <KeyValue name="format" value={data.format} />
        <KeyValue name="charCount" value={data.charCount + ' / ' + data.limit} />
        <KeyValue name="overLimit" value={data.overLimit} />
        <KeyValue name="entries" value={data.entries.length} />
      </div>
      <div className="card">
        <h3 className="section-title">content</h3>
        <pre className="stage-commands">{data.content}</pre>
      </div>
    </>
  )
}
