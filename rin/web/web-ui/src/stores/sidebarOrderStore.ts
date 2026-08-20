import { create } from 'zustand'
import { readStoredJson, writeStoredJson } from '../lib/storage'

const SESSION_ORDER_STORAGE_KEY = 'rin.sidebar.sessionOrder.v1'
const PROJECT_ORDER_STORAGE_KEY = 'rin.sidebar.projectOrder.v1'
const ORDER_BY_STORAGE_KEY = 'rin.sidebar.orderBy.v1'
const ARCHIVED_STORAGE_KEY = 'rin.sidebar.archivedSessions.v1'

export type SidebarOrderBy = 'updated' | 'manual'

function readOrderMap(): Record<string, string[]> {
  const parsed = readStoredJson<unknown>(SESSION_ORDER_STORAGE_KEY, {})
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      result[key] = value.filter((item): item is string => typeof item === 'string')
    }
  }
  return result
}

function readProjectOrder(): string[] {
  const parsed = readStoredJson<unknown>(PROJECT_ORDER_STORAGE_KEY, [])
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : []
}

function readOrderBy(): SidebarOrderBy {
  const stored = readStoredJson<unknown>(ORDER_BY_STORAGE_KEY, 'updated')
  return stored === 'manual' ? 'manual' : 'updated'
}

function readArchivedKeys(): string[] {
  const parsed = readStoredJson<unknown>(ARCHIVED_STORAGE_KEY, [])
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : []
}

type SidebarOrderStore = {
  orderBy: SidebarOrderBy
  sessionOrder: Record<string, string[]>
  projectOrder: string[]
  archivedKeys: string[]
  setOrderBy: (orderBy: SidebarOrderBy) => void
  /** 归档/恢复一条会话（key 为 `id:projectPath`）。 */
  toggleArchived: (key: string) => void
  /** 把一条会话移到同一项目组内的锚点前；anchor 为 null 表示组末尾。 */
  moveSession: (projectKey: string, sessionId: string, anchorId: string | null) => void
  /** 把一个项目组移到锚点项目前；anchor 为 null 表示末尾。 */
  moveProject: (projectPath: string, anchorPath: string | null) => void
}

export const useSidebarOrderStore = create<SidebarOrderStore>((set) => ({
  orderBy: readOrderBy(),
  sessionOrder: readOrderMap(),
  projectOrder: readProjectOrder(),
  archivedKeys: readArchivedKeys(),

  toggleArchived: (key) => set((state) => {
    const next = state.archivedKeys.includes(key)
      ? state.archivedKeys.filter((candidate) => candidate !== key)
      : [...state.archivedKeys, key]
    writeStoredJson(ARCHIVED_STORAGE_KEY, next)
    return { archivedKeys: next }
  }),

  setOrderBy: (orderBy) => {
    writeStoredJson(ORDER_BY_STORAGE_KEY, orderBy)
    set({ orderBy })
  },

  moveSession: (projectKey, sessionId, anchorId) => set((state) => {
    const current = state.sessionOrder[projectKey] ?? []
    const next = current.filter((id) => id !== sessionId)
    if (anchorId !== null) {
      const anchorIndex = next.indexOf(anchorId)
      const insertAt = anchorIndex === -1 ? next.length : anchorIndex
      next.splice(insertAt, 0, sessionId)
    } else {
      next.push(sessionId)
    }
    const sessionOrder = { ...state.sessionOrder, [projectKey]: next }
    writeStoredJson(SESSION_ORDER_STORAGE_KEY, sessionOrder)
    return { sessionOrder }
  }),

  moveProject: (projectPath, anchorPath) => set((state) => {
    const next = state.projectOrder.filter((path) => path !== projectPath)
    if (anchorPath !== null) {
      const anchorIndex = next.indexOf(anchorPath)
      const insertAt = anchorIndex === -1 ? next.length : anchorIndex
      next.splice(insertAt, 0, projectPath)
    } else {
      next.push(projectPath)
    }
    writeStoredJson(PROJECT_ORDER_STORAGE_KEY, next)
    return { projectOrder: next }
  }),
}))

/** 按存储顺序重排 id 列表；未收录的 id 按给定顺序追加。 */
export function applyStoredOrder(ids: string[], stored: string[] | undefined): string[] {
  if (stored === undefined || stored.length === 0) return ids
  const byId = new Set(ids)
  const ordered: string[] = []
  const included = new Set<string>()
  for (const id of stored) {
    if (!byId.has(id) || included.has(id)) continue
    ordered.push(id)
    included.add(id)
  }
  for (const id of ids) {
    if (included.has(id)) continue
    ordered.push(id)
    included.add(id)
  }
  return ordered
}
