import { useCallback, useEffect, useRef, useState } from 'react'
import { Columns2, Rows2 } from 'lucide-react'
import { TerminalPane } from './TerminalPane'
import { useTranslation } from '../../i18n'

type Leaf = { kind: 'leaf'; id: number }
type Branch = {
  kind: 'branch'
  direction: 'row' | 'column'
  ratio: number // 0..1 第一子节点占比
  a: Node
  b: Node
}
type Node = Leaf | Branch

function countLeaves(node: Node): number {
  return node.kind === 'leaf' ? 1 : countLeaves(node.a) + countLeaves(node.b)
}

function findLeafIds(node: Node): number[] {
  return node.kind === 'leaf' ? [node.id] : [...findLeafIds(node.a), ...findLeafIds(node.b)]
}

function splitLeaf(node: Node, id: number, direction: 'row' | 'column', newId: number): Node {
  if (node.kind === 'leaf') {
    if (node.id !== id) return node
    return { kind: 'branch', direction, ratio: 0.5, a: { kind: 'leaf', id }, b: { kind: 'leaf', id: newId } }
  }
  return { ...node, a: splitLeaf(node.a, id, direction, newId), b: splitLeaf(node.b, id, direction, newId) }
}

function removeLeaf(node: Node, id: number): Node | null {
  if (node.kind === 'leaf') return node.id === id ? null : node
  const a = removeLeaf(node.a, id)
  const b = removeLeaf(node.b, id)
  if (a === null) return b
  if (b === null) return a
  return { ...node, a, b }
}

function setRatio(node: Node, path: ('a' | 'b')[], ratio: number): Node {
  if (path.length === 0 || node.kind === 'leaf') return node
  const [head, ...rest] = path
  if (head === 'a') return { ...node, ratio, a: setRatio(node.a, rest, ratio) }
  return { ...node, ratio, b: setRatio(node.b, rest, ratio) }
}

export function SplitTerminal({
  active,
  spawnCommand,
  firstPaneTestId,
}: {
  active: boolean
  spawnCommand?: string[]
  firstPaneTestId?: string
}) {
  const t = useTranslation()
  const nextId = useRef(2)
  const [root, setRoot] = useState<Node>({ kind: 'leaf', id: 1 })
  const [focusedId, setFocusedId] = useState(1)
  const leafCount = countLeaves(root)

  const doSplit = useCallback((direction: 'row' | 'column') => {
    const id = nextId.current++
    setRoot(prev => splitLeaf(prev, focusedId, direction, id))
    setFocusedId(id)
  }, [focusedId])

  const doClose = useCallback((id: number) => {
    setRoot(prev => {
      const next = removeLeaf(prev, id)
      if (next === null) return { kind: 'leaf', id: 1 }
      return next
    })
    setFocusedId(prev => {
      if (prev !== id) return prev
      const remaining = findLeafIds(root).filter(x => x !== id)
      return remaining[0] ?? 1
    })
  }, [root])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'd') {
        e.preventDefault()
        doSplit('column')
      } else if (key === 's') {
        e.preventDefault()
        doSplit('row')
      } else if (key === 'w') {
        e.preventDefault()
        if (leafCount > 1) doClose(focusedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doSplit, doClose, focusedId, leafCount])

  const renderNode = (node: Node, path: ('a' | 'b')[]): React.ReactNode => {
    if (node.kind === 'leaf') {
      return (
        <TerminalPane
          key={node.id}
          active={active}
          focused={focusedId === node.id}
          spawnCommand={spawnCommand}
          onFocus={() => setFocusedId(node.id)}
          onClose={() => doClose(node.id)}
          showClose={leafCount > 1}
          testId={node.id === 1 ? firstPaneTestId : undefined}
        />
      )
    }
    return (
      <div className={`flex h-full min-h-0 ${node.direction === 'row' ? 'flex-col' : 'flex-row'}`}>
        <div style={{ flexBasis: `${node.ratio * 100}%` }} className="min-h-0 min-w-0">
          {renderNode(node.a, [...path, 'a'])}
        </div>
        <SplitDivider
          direction={node.direction}
          ratio={node.ratio}
          onDragTo={ratio => {
            setRoot(prev => setRatio(prev, path, clampRatio(ratio)))
          }}
        />
        <div style={{ flexBasis: `${(1 - node.ratio) * 100}%` }} className="min-h-0 min-w-0">
          {renderNode(node.b, [...path, 'b'])}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex h-[30px] shrink-0 items-center gap-[6px] border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-[8px]">
        <button onClick={() => doSplit('column')} title={t('terminal.splitRight')} className="flex items-center gap-1 rounded-[6px] px-[8px] py-[3px] text-[11px] text-[var(--color-terminal-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
          <Columns2 size={12} />{t('terminal.splitRight')}
        </button>
        <button onClick={() => doSplit('row')} title={t('terminal.splitDown')} className="flex items-center gap-1 rounded-[6px] px-[8px] py-[3px] text-[11px] text-[var(--color-terminal-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">
          <Rows2 size={12} />{t('terminal.splitDown')}
        </button>
        <span className="ml-2 text-[10.5px] text-[var(--color-terminal-muted)]">
          Ctrl+Shift+D / Ctrl+Shift+S{leafCount > 1 ? ' / Ctrl+Shift+W' : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {renderNode(root, [])}
      </div>
    </div>
  )
}

function clampRatio(r: number): number {
  return Math.min(Math.max(r, 0.15), 0.85)
}

function SplitDivider({
  direction,
  ratio,
  onDragTo,
}: {
  direction: 'row' | 'column'
  ratio: number
  onDragTo: (ratio: number) => void
}) {
  const isRow = direction === 'row'
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    dragCleanupRef.current?.()
  }, [])

  return (
    <div
      onMouseDown={e => {
        e.preventDefault()
        const parent = e.currentTarget.parentElement as HTMLElement
        const total = isRow ? parent.clientHeight : parent.clientWidth
        const start = isRow ? e.clientY : e.clientX
        const startRatio = ratio
        const onMove = (ev: MouseEvent) => {
          const delta = ((isRow ? ev.clientY : ev.clientX) - start) / Math.max(total, 1)
          onDragTo(startRatio + delta)
        }
        const onUp = () => {
          dragCleanupRef.current?.()
        }
        dragCleanupRef.current = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          dragCleanupRef.current = null
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        document.body.style.cursor = isRow ? 'row-resize' : 'col-resize'
      }}
      className={`shrink-0 bg-[var(--color-terminal-border)] transition-colors hover:bg-[var(--color-text-accent)] ${
        isRow ? 'h-[4px] cursor-row-resize' : 'w-[4px] cursor-col-resize'
      }`}
    />
  )
}
