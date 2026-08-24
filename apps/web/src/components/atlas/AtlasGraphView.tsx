import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Minus, Plus, Scan } from 'lucide-react'
import type { GraphEdge, GraphNode, GraphNodeKind } from '../../api/knowledgeGraph'
import { useTranslation } from '../../i18n'

export type PositionedAtlasNode = GraphNode & { x: number; y: number; radius: number }
export type AtlasLayoutMode = 'clusters' | 'grid'
type AtlasViewport = { zoom: number; offsetX: number; offsetY: number }

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const DEFAULT_VIEWPORT: AtlasViewport = { zoom: 1, offsetX: 0, offsetY: 0 }

export const ATLAS_KIND_COLORS: Record<GraphNodeKind, string> = {
  note: '#39d0d8',
  tag: '#c3a6ff',
  knowledge_source: '#ffb86b',
  knowledge_document: '#8fb6d9',
  repository_agent: '#7fd8a4',
  repository_environment: '#62d6ee',
  repository_package: '#ff8fa3',
  code_file: '#ffd166',
  code_symbol: '#ff9868',
  session: '#b69cff',
  file: '#9fb4bf',
}

export const ATLAS_EDGE_STYLES: Record<GraphEdge['kind'], { color: string; dash: number[] }> = {
  wikilink: { color: '#39d0d8', dash: [] },
  tag: { color: '#c3a6ff', dash: [4, 4] },
  contains: { color: '#7d8f9b', dash: [] },
  cites: { color: '#ffb86b', dash: [2, 5] },
  uses: { color: '#7fd8a4', dash: [] },
  depends_on: { color: '#ff8fa3', dash: [2, 4] },
  defined_in: { color: '#9aadb5', dash: [] },
  code_ref: { color: '#ff9868', dash: [4, 5] },
  mentions: { color: '#c3a6ff', dash: [1, 3] },
  derived_from: { color: '#b69cff', dash: [3, 3] },
  child: { color: '#9fb4bf', dash: [] },
}

/**
 * Deterministic ring layout: one cluster per node kind, nodes placed on rings
 * around the cluster centre. Degree (incident edge count) scales node radius.
 * Pure so it is testable without a canvas.
 */
export function layoutAtlasGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 900,
  height = 620,
  mode: AtlasLayoutMode = 'clusters',
): PositionedAtlasNode[] {
  if (nodes.length === 0) return []
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }

  if (mode === 'grid') return layoutAtlasGrid(nodes, degree, width, height)
  const groups = new Map<GraphNodeKind, GraphNode[]>()
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? []
    list.push(node)
    groups.set(node.kind, list)
  }

  const kinds = [...groups.keys()]
  const columns = Math.ceil(Math.sqrt(kinds.length))
  const rows = Math.ceil(kinds.length / columns)
  const cellWidth = width / columns
  const cellHeight = height / rows

  const positioned: PositionedAtlasNode[] = []
  kinds.forEach((kind, kindIndex) => {
    const group = groups.get(kind) ?? []
    const column = kindIndex % columns
    const row = Math.floor(kindIndex / columns)
    const centerX = cellWidth * column + cellWidth / 2
    const centerY = cellHeight * row + cellHeight / 2
    const clusterRadius = Math.max(40, Math.min(cellWidth, cellHeight) * 0.36)
    group.forEach((node, nodeIndex) => {
      const angle = (nodeIndex / Math.max(1, group.length)) * Math.PI * 2
      const distance = group.length === 1 ? 0 : clusterRadius
      const nodeDegree = degree.get(node.id) ?? 0
      positioned.push({
        ...node,
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        radius: 6 + Math.min(7, Math.sqrt(nodeDegree) * 1.4),
      })
    })
  })
  return positioned
}

function layoutAtlasGrid(
  nodes: GraphNode[],
  degree: Map<string, number>,
  width: number,
  height: number,
): PositionedAtlasNode[] {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  const rows = Math.ceil(nodes.length / columns)
  const cellWidth = width / columns
  const cellHeight = height / rows
  return nodes.map((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const nodeDegree = degree.get(node.id) ?? 0
    return {
      ...node,
      x: cellWidth * column + cellWidth / 2,
      y: cellHeight * row + cellHeight / 2,
      radius: 6 + Math.min(7, Math.sqrt(nodeDegree) * 1.4),
    }
  })
}
export function AtlasGraphView({
  nodes,
  edges,
  onSelectNode,
  layoutMode = 'clusters',
  focusNodeId = null,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layoutMode?: AtlasLayoutMode
  focusNodeId?: string | null
  onSelectNode: (node: GraphNode) => void
}) {
  const t = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<AtlasViewport>(DEFAULT_VIEWPORT)
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)
  const wasDraggedRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 900, height: 620 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const positioned = useMemo(() => layoutAtlasGraph(nodes, edges, size.width, size.height, layoutMode), [nodes, edges, layoutMode, size])
  const nodeById = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => {
      setSize({
        width: Math.max(320, container.clientWidth),
        height: Math.max(360, container.clientHeight),
      })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(container)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => {
    const focused = focusNodeId ? nodeById.get(focusNodeId) : null
    if (!focused) return
    const zoom = 1.65
    setViewport({ zoom, offsetX: size.width / 2 - focused.x * zoom, offsetY: size.height / 2 - focused.y * zoom })
  }, [focusNodeId, nodeById, size])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, size.width, size.height)
    context.save()
    context.translate(viewport.offsetX, viewport.offsetY)
    context.scale(viewport.zoom, viewport.zoom)
    drawAtlas(context, positioned, edges, nodeById, hoveredId, focusNodeId)
    context.restore()
  }, [positioned, edges, nodeById, hoveredId, focusNodeId, size, viewport])

  const pickNode = (clientX: number, clientY: number): PositionedAtlasNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left - viewport.offsetX) / viewport.zoom
    const y = (clientY - rect.top - viewport.offsetY) / viewport.zoom
    let best: PositionedAtlasNode | null = null
    let bestDistance = 20 / viewport.zoom
    for (const node of positioned) {
      const distance = Math.hypot(node.x - x, node.y - y)
      if (distance < bestDistance) {
        best = node
        bestDistance = distance
      }
    }
    return best
  }

  const hovered = hoveredId ? nodeById.get(hoveredId) ?? null : null
  const fitView = useCallback(() => {
    if (positioned.length === 0) return
    const xs = positioned.map((node) => node.x)
    const ys = positioned.map((node) => node.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const padding = 48
    const zoom = clampZoom(Math.min(
      (size.width - padding * 2) / Math.max(1, maxX - minX),
      (size.height - padding * 2) / Math.max(1, maxY - minY),
    ))
    setViewport({
      zoom,
      offsetX: size.width / 2 - ((minX + maxX) / 2) * zoom,
      offsetY: size.height / 2 - ((minY + maxY) / 2) * zoom,
    })
  }, [positioned, size])

  const zoomBy = useCallback((factor: number) => {
    setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom * factor) }))
  }, [])

  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
        {t('atlas.empty')}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative min-h-[360px] w-full flex-1 overflow-hidden rounded-[10px] border border-[var(--color-graph-border)] bg-[var(--color-graph-bg)]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        onMouseMove={(event) => {
          const drag = dragRef.current
          if (!drag) {
            setHoveredId(pickNode(event.clientX, event.clientY)?.id ?? null)
            return
          }
          const deltaX = event.clientX - drag.startX
          const deltaY = event.clientY - drag.startY
          if (Math.hypot(deltaX, deltaY) > 3) drag.moved = true
          if (!drag.moved) return
          wasDraggedRef.current = true
          setViewport((current) => ({ ...current, offsetX: drag.offsetX + deltaX, offsetY: drag.offsetY + deltaY }))
        }}
        onMouseDown={(event) => {
          wasDraggedRef.current = false
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            offsetX: viewport.offsetX,
            offsetY: viewport.offsetY,
            moved: false,
          }
        }}
        onWheel={(event) => {
          event.preventDefault()
          zoomBy(event.deltaY < 0 ? 1.1 : 0.9)
        }}
        onMouseLeave={() => { setHoveredId(null); dragRef.current = null }}
        onMouseUp={() => { dragRef.current = null }}
        onClick={(event) => {
          const node = pickNode(event.clientX, event.clientY)
          if (wasDraggedRef.current) {
            wasDraggedRef.current = false
            return
          }
          if (node) onSelectNode(node)
        }}
      />
      {hovered && (
        <div className="pointer-events-none absolute bottom-[12px] left-[12px] rounded-[8px] bg-[var(--color-graph-panel-bg)] px-[10px] py-[7px] text-[11px] text-[var(--color-graph-text)] shadow-[var(--shadow-dropdown)]">
          <span className="font-semibold">{hovered.label}</span>
          <span className="ml-[7px] font-mono text-[9px] uppercase text-[var(--color-graph-text-muted)]">{t(('atlas.kind.' + hovered.kind) as never)}</span>
        </div>
      )}
      <AtlasControls
        viewport={viewport}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(0.8)}
        onReset={() => setViewport(DEFAULT_VIEWPORT)}
        onFit={fitView}
      />
      <AtlasLegend />
    </div>
  )
}

function AtlasControls({
  viewport,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
}: {
  viewport: AtlasViewport
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
}) {
  const t = useTranslation()
  return (
    <div className="absolute bottom-[12px] right-[12px] flex items-center gap-[3px] rounded-[8px] bg-[var(--color-graph-panel-bg)] p-[4px] shadow-[var(--shadow-dropdown)]">
      <IconButton label={t('atlas.zoomOut')} onClick={onZoomOut}><Minus size={13} /></IconButton>
      <span className="min-w-[38px] text-center font-mono text-[9px] text-[var(--color-graph-text-muted)]">{Math.round(viewport.zoom * 100)}%</span>
      <IconButton label={t('atlas.zoomIn')} onClick={onZoomIn}><Plus size={13} /></IconButton>
      <IconButton label={t('atlas.resetView')} onClick={onReset}><Scan size={13} /></IconButton>
      <IconButton label={t('atlas.fitView')} onClick={onFit}><Maximize2 size={13} /></IconButton>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-[var(--color-graph-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-graph-text)]">
      {children}
    </button>
  )
}

function AtlasLegend() {
  const t = useTranslation()
  return (
    <div className="pointer-events-none absolute right-[12px] top-[12px] flex flex-col gap-[5px] rounded-[8px] bg-[var(--color-graph-panel-bg)] px-[8px] py-[7px] font-mono text-[9px] text-[var(--color-graph-text-muted)]">
      {(Object.keys(ATLAS_KIND_COLORS) as GraphNodeKind[]).map((kind) => (
        <span key={kind} className="flex items-center gap-[6px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: ATLAS_KIND_COLORS[kind] }} />
          {t(`atlas.kind.${kind}` as never)}
        </span>
      ))}
    </div>
  )
}

function drawAtlas(
  context: CanvasRenderingContext2D,
  nodes: PositionedAtlasNode[],
  edges: GraphEdge[],
  nodeById: Map<string, PositionedAtlasNode>,
  hoveredId: string | null,
  focusNodeId: string | null,
) {

  const neighborhood = new Set<string>()
  if (hoveredId) {
    neighborhood.add(hoveredId)
    for (const edge of edges) {
      if (edge.from === hoveredId) neighborhood.add(edge.to)
      if (edge.to === hoveredId) neighborhood.add(edge.from)
    }
  }

  for (const edge of edges) {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) continue
    const style = ATLAS_EDGE_STYLES[edge.kind]
    const active = !hoveredId || (neighborhood.has(from.id) && neighborhood.has(to.id))
    context.save()
    context.globalAlpha = active ? 0.7 : 0.08
    context.strokeStyle = style.color
    context.setLineDash(style.dash)
    context.lineWidth = active ? 1.3 : 0.9
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
    context.restore()
  }

  for (const node of nodes) {
    const dimmed = Boolean(hoveredId) && !neighborhood.has(node.id)
    context.save()
    context.globalAlpha = dimmed ? 0.18 : 1
    context.fillStyle = ATLAS_KIND_COLORS[node.kind]
    context.beginPath()
    context.arc(node.x, node.y, node.id === hoveredId ? node.radius + 2.5 : node.radius, 0, Math.PI * 2)
    context.fill()
    if (node.id === hoveredId) {
      context.strokeStyle = 'rgba(255,255,255,0.85)'
      context.lineWidth = 1.6
      context.stroke()
    }
    if (node.id === focusNodeId) {
      context.strokeStyle = 'rgba(255,255,255,0.55)'
      context.lineWidth = 1.4
      context.beginPath()
      context.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2)
      context.stroke()
    }
    context.restore()

    context.save()
    context.globalAlpha = dimmed ? 0.3 : 0.92
    context.fillStyle = '#dbe4ea'
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    context.textAlign = 'center'
    context.fillText(truncate(node.label, 22), node.x, node.y + node.radius + 13)
    context.restore()
  }
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value
}
function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}
