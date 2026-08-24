import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { notesApi, type NoteGraph } from '../../api/notes'
import { useTranslation } from '../../i18n'

type SimNode = { id: string; name: string; tag: string | null; x: number; y: number; vx: number; vy: number }

const TAG_COLORS = ['#39d0d8', '#8fb6d9', '#c3a6ff', '#7fd8a4', '#ffb86b', '#ff8fa3', '#ffd166']

function colorFor(tag: string | null): string {
  if (!tag) return '#8fb6d9'
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]!
}

export function NoteGraphView({ onOpenNote }: { onOpenNote: (path: string) => void }) {
  const t = useTranslation()
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<NoteGraph['edges']>([])
  const rafRef = useRef(0)

  useEffect(() => {
    void notesApi.graph().then(setGraph).catch(() => setGraph({ nodes: [], edges: [] }))
  }, [])

  // 初始化布局 + 力导向模拟
  useEffect(() => {
    if (!graph) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const W = Math.max(rect.width, 400)
    const H = Math.max(rect.height, 300)

    nodesRef.current = graph.nodes.map((n, i) => {
      const angle = (i / Math.max(graph.nodes.length, 1)) * Math.PI * 2
      const radius = Math.min(W, H) * 0.3
      return {
        id: n.id,
        name: n.name,
        tag: n.tag,
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      }
    })
    edgesRef.current = graph.edges

    const byId = new Map(nodesRef.current.map(n => [n.id, n]))
    let iteration = 0

    const tick = () => {
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const nodes = nodesRef.current
      // 斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!
          const b = nodes[j]!
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5 }
          const force = 4000 / d2
          const fx = (dx / Math.sqrt(d2)) * force
          const fy = (dy / Math.sqrt(d2)) * force
          a.vx += fx; a.vy += fy
          b.vx -= fx; b.vy -= fy
        }
      }
      // 引力 (边)
      for (const e of edgesRef.current) {
        const a = byId.get(e.from)
        const b = byId.get(e.to)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = (d - 130) * 0.004
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }
      // 向心力 + 阻尼
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.0012
        n.vy += (H / 2 - n.y) * 0.0012
        n.vx *= 0.86
        n.vy *= 0.86
        n.x += n.vx
        n.y += n.vy
      }
      draw(canvas, nodes, edgesRef.current, byId, hover)
      iteration++
      if (iteration < 400) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // hover 重绘
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !graph) return
    const byId = new Map(nodesRef.current.map(n => [n.id, n]))
    draw(canvas, nodesRef.current, edgesRef.current, byId, hover)
  }, [hover, graph])

  const pickNode = (e: React.MouseEvent): SimNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let best: SimNode | null = null
    let bestD = 18
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - x, n.y - y)
      if (d < bestD) { best = n; bestD = d }
    }
    return best
  }

  if (!graph) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={26} /></div>
  }
  if (graph.nodes.length === 0) {
    return <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">{t('notes.graphEmpty')}</div>
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onMouseMove={e => setHover(pickNode(e)?.id ?? null)}
        onClick={e => {
          const node = pickNode(e)
          if (node) onOpenNote(node.id)
        }}
      />
      {hover && (
        <div className="pointer-events-none absolute bottom-[14px] left-[14px] rounded-[8px] bg-[var(--color-surface-container-lowest)] px-[10px] py-[6px] text-[12px] text-[var(--color-text-primary)] shadow-[var(--shadow-dropdown)]">
          {hover}
        </div>
      )}
    </div>
  )
}

function draw(
  canvas: HTMLCanvasElement,
  nodes: SimNode[],
  edges: { from: string; to: string }[],
  byId: Map<string, SimNode>,
  hover: string | null,
) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const W = Math.max(Math.floor(rect.width * dpr), 1)
  const H = Math.max(Math.floor(rect.height * dpr), 1)
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, rect.width, rect.height)

  const linked = new Set<string>()
  if (hover) {
    linked.add(hover)
    for (const e of edges) {
      if (e.from === hover) linked.add(e.to)
      if (e.to === hover) linked.add(e.from)
    }
  }

  for (const e of edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    const active = !hover || (linked.has(a.id) && linked.has(b.id) && (a.id === hover || b.id === hover))
    ctx.strokeStyle = active ? 'rgba(120,150,190,0.55)' : 'rgba(120,150,190,0.12)'
    ctx.lineWidth = active ? 1.4 : 1
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  for (const n of nodes) {
    const dim = hover && !linked.has(n.id)
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.fillStyle = colorFor(n.tag)
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.id === hover ? 8 : 5.5, 0, Math.PI * 2)
    ctx.fill()
    if (n.id === hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.fillStyle = dim ? 'rgba(140,150,165,0.5)' : 'rgba(226,232,240,0.9)'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(n.name, n.x, n.y + 18)
  }
  ctx.restore()
}
