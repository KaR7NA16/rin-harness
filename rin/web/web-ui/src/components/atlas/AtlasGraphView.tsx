import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphEdge, GraphNode, GraphNodeKind } from '../../api/knowledgeGraph'
import { useTranslation } from '../../i18n'

export type PositionedAtlasNode = GraphNode & { x: number; y: number; radius: number }

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
): PositionedAtlasNode[] {
  if (nodes.length === 0) return []
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }

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

export function AtlasGraphView({
  nodes,
  edges,
  onSelectNode,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onSelectNode: (node: GraphNode) => void
}) {
  const t = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 900, height: 620 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const positioned = useMemo(() => layoutAtlasGraph(nodes, edges, size.width, size.height), [nodes, edges, size])
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
    drawAtlas(context, positioned, edges, nodeById, hoveredId, size)
  }, [positioned, edges, nodeById, hoveredId, size])

  const pickNode = (clientX: number, clientY: number): PositionedAtlasNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    let best: PositionedAtlasNode | null = null
    let bestDistance = 20
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
        className="block h-full w-full cursor-pointer"
        onMouseMove={(event) => setHoveredId(pickNode(event.clientX, event.clientY)?.id ?? null)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={(event) => {
          const node = pickNode(event.clientX, event.clientY)
          if (node) onSelectNode(node)
        }}
      />
      {hovered && (
        <div className="pointer-events-none absolute bottom-[12px] left-[12px] rounded-[8px] bg-[var(--color-graph-panel-bg)] px-[10px] py-[7px] text-[11px] text-[var(--color-graph-text)] shadow-[var(--shadow-dropdown)]">
          <span className="font-semibold">{hovered.label}</span>
          <span className="ml-[7px] font-mono text-[9px] uppercase text-[var(--color-graph-text-muted)]">{hovered.kind}</span>
        </div>
      )}
      <AtlasLegend />
    </div>
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
  size: { width: number; height: number },
) {
  context.clearRect(0, 0, size.width, size.height)

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
