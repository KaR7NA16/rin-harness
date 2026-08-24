import { LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GRAPH_NODE_KINDS,
  GRAPH_SOURCES,
  knowledgeGraphApi,
  type GraphNode,
  type GraphNodeKind,
  type GraphSnapshot,
  type GraphSource,
} from '../api/knowledgeGraph'
import { ATLAS_KIND_COLORS, AtlasGraphView, type AtlasLayoutMode } from '../components/atlas/AtlasGraphView'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'

const EMPTY_GRAPH: GraphSnapshot = { nodes: [], edges: [], refreshedAt: '' }

export function Atlas() {
  const t = useTranslation()
  const [graph, setGraph] = useState<GraphSnapshot>(EMPTY_GRAPH)
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState<GraphSource[]>([])
  const [kinds, setKinds] = useState<GraphNodeKind[]>([])
  const [nodeSearch, setNodeSearch] = useState('')
  const [layoutMode, setLayoutMode] = useState<AtlasLayoutMode>('clusters')
  const [pathPrefix, setPathPrefix] = useState('')
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [related, setRelated] = useState<GraphSnapshot | null>(null)
  const [relatedLoading, setRelatedLoading] = useState(false)
  const searchMatches = useMemo(() => {
    const query = nodeSearch.trim().toLocaleLowerCase()
    if (!query) return []
    return graph.nodes
      .filter((node) => [node.label, node.path ?? '', node.id].join(' ').toLocaleLowerCase().includes(query))
      .slice(0, 8)
  }, [graph.nodes, nodeSearch])

  const notifyError = useCallback((error: unknown, fallback: string) => {
    useUIStore.getState().addToast({
      type: 'error',
      message: error instanceof Error ? error.message : fallback,
    })
  }, [])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    try {
      const response = await knowledgeGraphApi.graph({
        ...(sources.length ? { sources } : {}),
        ...(kinds.length ? { kinds } : {}),
        ...(pathPrefix.trim() ? { pathPrefix: pathPrefix.trim() } : {}),
        limit: 500,
      })
      setGraph(response.graph)
    } catch (error) {
      notifyError(error, t('atlas.errors.load'))
      setGraph(EMPTY_GRAPH)
    } finally {
      setLoading(false)
    }
  }, [kinds, notifyError, pathPrefix, sources, t])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  const selectNode = useCallback((node: GraphNode) => {
    setNodeSearch(node.label)
    setSelectedNode(node)
    setRelated(null)
    setRelatedLoading(true)
    void knowledgeGraphApi.related(node.id, 1)
      .then((response) => setRelated(response.graph))
      .catch(() => setRelated(EMPTY_GRAPH))
      .finally(() => setRelatedLoading(false))
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--color-border-separator)] bg-[var(--color-background)]">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-[12px] border-b border-[var(--color-border-separator)] px-[16px] py-[10px] md:px-[20px]">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">{t('atlas.title')}</h1>
            <p className="mt-[2px] truncate text-[10px] text-[var(--color-text-tertiary)]">{t('atlas.subtitle')}</p>
          </div>
          <span className="hidden text-[10px] text-[var(--color-text-tertiary)] sm:inline">
            {t('atlas.summary', { nodes: graph.nodes.length, edges: graph.edges.length })}
          </span>
          <button
            type="button"
            title={t('atlas.refresh')}
            aria-label={t('atlas.refresh')}
            onClick={() => void loadGraph()}
            className="flex h-[32px] w-[32px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-[10px] border-b border-[var(--color-border-separator)] px-[16px] py-[10px] md:px-[20px]">
          <FilterGroup label={t('atlas.filters.sources')}>
            {GRAPH_SOURCES.map((source) => (
              <Chip
                key={source}
                active={sources.includes(source)}
                label={t(`atlas.source.${source}` as never)}
                onClick={() => setSources((current) => toggle(current, source))}
              />
            ))}
          </FilterGroup>
          <FilterGroup label={t('atlas.filters.kinds')}>
            {GRAPH_NODE_KINDS.map((kind) => (
              <Chip
                key={kind}
                active={kinds.includes(kind)}
                label={t(`atlas.kind.${kind}` as never)}
                onClick={() => setKinds((current) => toggle(current, kind))}
              />
            ))}
          </FilterGroup>
          <FilterGroup label={t('atlas.filters.layout')}>
            <Chip active={layoutMode === 'clusters'} label={t('atlas.layout.clusters')} onClick={() => setLayoutMode('clusters')} />
            <Chip active={layoutMode === 'grid'} label={t('atlas.layout.grid')} onClick={() => setLayoutMode('grid')} />
          </FilterGroup>
          <AtlasNodeSearch
            value={nodeSearch}
            matches={searchMatches}
            onChange={setNodeSearch}
            onSelect={selectNode}
          />
          <label className="relative ml-auto w-full min-w-[180px] sm:w-[220px]">
            <Search className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" size={14} />
            <input
              type="text"
              value={pathPrefix}
              onChange={(event) => setPathPrefix(event.target.value)}
              placeholder={t('atlas.filters.pathPrefix')}
              aria-label={t('atlas.filters.pathPrefix')}
              className="h-[32px] w-full rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] pl-[30px] pr-[8px] text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[10px] px-[16px] py-[12px] md:px-[20px]">
          {loading && graph.nodes.length === 0 ? (
            <div className="flex h-full min-h-[360px] items-center justify-center">
              <LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={24} />
            </div>
          ) : (
            <AtlasGraphView nodes={graph.nodes} edges={graph.edges} onSelectNode={selectNode} layoutMode={layoutMode} focusNodeId={selectedNode?.id ?? null} />
          )}
        </div>
      </main>

      {selectedNode && (
        <aside className="flex w-[min(300px,82%)] shrink-0 flex-col border-l border-[var(--color-border-separator)] bg-[var(--color-background)]">
          <header className="flex items-start justify-between gap-[10px] border-b border-[var(--color-border-separator)] px-[16px] py-[14px]">
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase text-[var(--color-text-tertiary)]">
                {t(`atlas.kind.${selectedNode.kind}` as never)} · {t(`atlas.source.${selectedNode.source}` as never)}
              </div>
              <h2 className="mt-[5px] truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{selectedNode.label}</h2>
              {selectedNode.path && (
                <p className="mt-[3px] truncate text-[10px] text-[var(--color-text-tertiary)]">{selectedNode.path}</p>
              )}
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={() => setSelectedNode(null)}
              className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
            >
              <X size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[14px]">
            <div className="text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">{t('atlas.inspector.related')}</div>
            {relatedLoading ? (
              <div className="mt-[14px] flex justify-center">
                <LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={18} />
              </div>
            ) : !related || related.nodes.length === 0 ? (
              <p className="mt-[10px] text-[11px] text-[var(--color-text-tertiary)]">{t('atlas.inspector.noRelations')}</p>
            ) : (
              <div className="mt-[8px] divide-y divide-[var(--color-border-separator)]">
                {related.nodes
                  .filter((node) => node.id !== selectedNode.id)
                  .map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => selectNode(node)}
                      className="flex w-full items-center gap-[8px] py-[9px] text-left hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: ATLAS_KIND_COLORS[node.kind] }} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-primary)]">{node.label}</span>
                      <span className="shrink-0 font-mono text-[8px] uppercase text-[var(--color-text-tertiary)]">{t(`atlas.kind.${node.kind}` as never)}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

function AtlasNodeSearch({
  value,
  matches,
  onChange,
  onSelect,
}: {
  value: string
  matches: GraphNode[]
  onChange: (value: string) => void
  onSelect: (node: GraphNode) => void
}) {
  const t = useTranslation()
  const chooseFirst = () => {
    if (matches[0]) onSelect(matches[0])
  }
  return (
    <label className="relative ml-auto w-full min-w-[180px] sm:w-[220px]">
      <Search className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" size={14} />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') chooseFirst() }}
        placeholder={t('atlas.filters.entitySearch')}
        aria-label={t('atlas.filters.entitySearch')}
        className="h-[32px] w-full rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] pl-[30px] pr-[8px] text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
      />
    </label>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[6px]">
      <span className="text-[10px] font-medium text-[var(--color-text-tertiary)]">{label}</span>
      <div className="flex flex-wrap items-center gap-[4px]">{children}</div>
    </div>
  )
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-[26px] items-center rounded-[6px] border px-[9px] text-[10px] font-medium transition-colors ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]'
          : 'border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {label}
    </button>
  )
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
