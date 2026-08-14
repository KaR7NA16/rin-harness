import { useState } from 'react'
import type {
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeSource,
} from '../types'
import type { Mounted } from '../api'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { KeyValue } from '../components/KeyValue'
import { ListDetail } from '../components/ListDetail'
import type { ListItemLabel } from '../components/ListDetail'
import { extractList } from '../overview'

type KnowledgeMode = 'sources' | 'documents' | 'search' | 'stats'

interface KnowledgeRequest {
  mode: KnowledgeMode
  db: string
  query: string
  sourceId: string
}

function buildPath(request: KnowledgeRequest): string | null {
  if (request.db === '') return null
  const params = new URLSearchParams({ db: request.db })
  switch (request.mode) {
    case 'sources':
      return '/api/knowledge/sources?' + params.toString()
    case 'documents':
      if (request.sourceId !== '') params.set('sourceId', request.sourceId)
      return '/api/knowledge/documents?' + params.toString()
    case 'search':
      if (request.query === '') return null
      params.set('query', request.query)
      if (request.sourceId !== '') params.set('sourceId', request.sourceId)
      return '/api/knowledge/search?' + params.toString()
    case 'stats':
      return '/api/knowledge/stats?' + params.toString()
  }
}

function sourceLabel(source: KnowledgeSource): ListItemLabel {
  return {
    title: source.name,
    subtitle: [source.kind, source.status, source.documentCount + ' docs'].join(' · '),
  }
}

function documentLabel(doc: KnowledgeDocument): ListItemLabel {
  return {
    title: doc.relativePath || doc.title,
    subtitle: [doc.indexMode, doc.sizeBytes + ' bytes'].join(' · '),
  }
}

function searchLabel(result: KnowledgeSearchResult): ListItemLabel {
  return {
    title: result.title,
    subtitle: result.sourceName + ' · ' + result.path,
  }
}

export default function KnowledgePage() {
  const [db, setDb] = useState('')
  const [query, setQuery] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [request, setRequest] = useState<KnowledgeRequest | null>(null)

  const path = request === null ? null : buildPath(request)
  const state = useApi<Mounted<Record<string, unknown>>>(path)

  const run = (mode: KnowledgeMode) => {
    setRequest({ mode, db: db.trim(), query: query.trim(), sourceId: sourceId.trim() })
  }

  return (
    <div className="page">
      <h1 className="page-title">Knowledge</h1>
      <div className="page-toolbar">
        <label className="field-label" htmlFor="k-db">db</label>
        <input id="k-db" type="text" value={db} onChange={event => setDb(event.target.value)} placeholder="path to knowledge.db" />
        <label className="field-label" htmlFor="k-query">query</label>
        <input id="k-query" type="text" value={query} onChange={event => setQuery(event.target.value)} placeholder="search query" />
        <label className="field-label" htmlFor="k-source">sourceId</label>
        <input id="k-source" type="text" value={sourceId} onChange={event => setSourceId(event.target.value)} placeholder="optional" />
        <button type="button" onClick={() => run('sources')}>Sources</button>
        <button type="button" onClick={() => run('documents')}>Documents</button>
        <button type="button" onClick={() => run('search')}>Search</button>
        <button type="button" onClick={() => run('stats')}>Stats</button>
      </div>

      {request === null || request.db === '' ? (
        <div className="muted">Enter a database path and choose an action.</div>
      ) : (
        <ServiceGate state={state}>
          {data => <KnowledgeResult mode={request.mode} data={data} />}
        </ServiceGate>
      )}
    </div>
  )
}

function KnowledgeResult({ mode, data }: { mode: KnowledgeMode; data: Record<string, unknown> }) {
  if (mode === 'stats') {
    const entries = Object.entries(data).filter(([key]) => key !== 'mounted')
    return (
      <div className="card">
        {entries.map(([key, value]) => (
          <KeyValue key={key} name={key} value={value} />
        ))}
      </div>
    )
  }

  if (mode === 'sources') {
    return (
      <ListDetail items={extractList(data) as KnowledgeSource[]} label={sourceLabel} empty="no sources" />
    )
  }

  if (mode === 'documents') {
    return (
      <ListDetail items={extractList(data) as KnowledgeDocument[]} label={documentLabel} empty="no documents" />
    )
  }

  return (
    <ListDetail items={extractList(data) as KnowledgeSearchResult[]} label={searchLabel} empty="no matches" />
  )
}
