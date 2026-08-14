import { useState } from 'react'
import type { Mounted } from '../api'
import type { SessionBrowseResult, SessionDiscoverResult, SessionReadResult, SessionSearchHit, SessionSearchMessage } from '../types'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { KeyValue } from '../components/KeyValue'

type SessionListRequest = { mode: 'browse' } | { mode: 'discover'; query: string }

function hitLabel(hit: SessionSearchHit): { title: string; subtitle: string } {
  return {
    title: hit.title || hit.sessionId,
    subtitle: hit.projectPath + ' · ' + hit.matchCount + ' matches',
  }
}

export default function SessionSearchPage() {
  const [query, setQuery] = useState('')
  const [request, setRequest] = useState<SessionListRequest | null>(null)
  const [readTarget, setReadTarget] = useState<{ sessionId: string; projectPath?: string } | null>(null)

  const listPath = request === null
    ? null
    : request.mode === 'browse'
      ? '/api/sessions/browse'
      : '/api/sessions/discover?query=' + encodeURIComponent(request.query)
  const readPath = readTarget === null
    ? null
    : '/api/sessions/read?sessionId=' + encodeURIComponent(readTarget.sessionId)
      + (readTarget.projectPath ? '&projectPath=' + encodeURIComponent(readTarget.projectPath) : '')

  const listState = useApi<Mounted<SessionBrowseResult | SessionDiscoverResult>>(listPath)
  const readState = useApi<Mounted<SessionReadResult>>(readPath)

  return (
    <div className="page">
      <h1 className="page-title">SessionSearch</h1>
      <div className="page-toolbar">
        <button type="button" onClick={() => { setReadTarget(null); setRequest({ mode: 'browse' }) }}>Browse</button>
        <label className="field-label" htmlFor="s-query">query</label>
        <input id="s-query" type="text" value={query} onChange={event => setQuery(event.target.value)} placeholder="search sessions" />
        <button
          type="button"
          disabled={query.trim() === ''}
          onClick={() => { setReadTarget(null); setRequest({ mode: 'discover', query: query.trim() }) }}
        >
          Discover
        </button>
      </div>

      <div className="two-pane">
        <div className="list-pane">
          {request === null ? (
            <div className="muted">Browse recent sessions or search by keyword.</div>
          ) : (
            <ServiceGate state={listState}>
              {data => (
                <HitList
                  hits={data.results}
                  onSelect={hit => setReadTarget({ sessionId: hit.sessionId, projectPath: hit.projectPath })}
                />
              )}
            </ServiceGate>
          )}
        </div>
        <div className="detail-pane">
          {readTarget === null ? (
            <div className="muted">Select a session to read it.</div>
          ) : (
            <ServiceGate state={readState}>
              {data => <ReadView data={data} />}
            </ServiceGate>
          )}
        </div>
      </div>
    </div>
  )
}

function HitList({ hits, onSelect }: { hits: SessionSearchHit[]; onSelect: (hit: SessionSearchHit) => void }) {
  if (hits.length === 0) {
    return <div className="muted">no sessions</div>
  }
  return (
    <ul className="item-list">
      {hits.map((hit, index) => {
        const entry = hitLabel(hit)
        return (
          <li key={index}>
            <button type="button" className="item-button" onClick={() => onSelect(hit)}>
              <span className="item-title">{entry.title}</span>
              <span className="item-subtitle">{entry.subtitle}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ReadView({ data }: { data: SessionReadResult }) {
  if (typeof data.sessionId !== 'string') {
    return <div className="muted">no result for this session key</div>
  }
  const messages = Array.isArray(data.messages) ? (data.messages as SessionSearchMessage[]) : []
  return (
    <>
      <div className="detail-header">{String(data.title ?? data.sessionId)}</div>
      <div className="card">
        <KeyValue name="sessionId" value={data.sessionId} />
        <KeyValue name="projectPath" value={data.projectPath} />
        <KeyValue name="count" value={data.count} />
        <KeyValue name="messagesBefore" value={data.messagesBefore} />
        <KeyValue name="messagesAfter" value={data.messagesAfter} />
      </div>
      <h3 className="section-title">messages ({messages.length})</h3>
      {messages.length === 0 ? (
        <div className="muted">no messages</div>
      ) : (
        messages.map(message => (
          <div key={message.id} className="stage">
            <div className="stage-head">
              <span className="mono stage-id">{message.role}</span>
              <span className="muted">line {message.line}</span>
            </div>
            <pre className="stage-commands">{message.content}</pre>
          </div>
        ))
      )}
    </>
  )
}
