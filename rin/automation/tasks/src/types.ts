/**
 * rin tasks — domain model.
 *
 * Owns the values crossing the tasks module seam: the task status enum, the
 * task / task-list records (matching the legacy CLI V2 JSON layout), the
 * create/update inputs, and the plugin configuration. The file-backed engine
 * owns persistence; this module owns the model only.
 *
 * @module @rin/tasks
 */

/** The three task statuses shared with the legacy CLI V2 format. */
export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const

/** A single task status. */
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** @param value - the candidate. @returns true when it is a valid task status. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

/** One task, matching the legacy CLI V2 JSON layout plus its owning list id. */
export interface Task {
  id: string
  subject: string
  description: string
  /** Present-continuous form for spinners, e.g. `Running tests`. */
  activeForm?: string
  /** Agent id owning the task. */
  owner?: string
  status: TaskStatus
  /** Task ids this task blocks. */
  blocks: string[]
  /** Task ids blocking this task. */
  blockedBy: string[]
  metadata?: Record<string, unknown>
  /** The task list this task belongs to (the directory it lives in). */
  taskListId: string
}

/** The on-disk JSON record; `taskListId` is derived from the directory, not stored. */
export type TaskRecord = Omit<Task, 'taskListId'>

/** A task-list rollup returned by `listTaskLists`. */
export interface TaskListSummary {
  id: string
  taskCount: number
  completedCount: number
  inProgressCount: number
  pendingCount: number
}

/** Fields accepted when creating a task. */
export interface TaskInput {
  subject: string
  description?: string
  activeForm?: string
  owner?: string
  status?: TaskStatus
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

/** Fields accepted when updating a task; `undefined` leaves a field unchanged. */
export interface TaskPatch {
  subject?: string
  description?: string
  activeForm?: string
  owner?: string
  status?: TaskStatus
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

/** Plugin configuration for `@rin/tasks`. */
export interface Config {
  /** Absolute or cwd-relative path to the tasks root; defaults to `~/.rin/tasks`. */
  tasksRoot?: string
}
