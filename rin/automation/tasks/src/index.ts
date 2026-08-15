/**
 * rin tasks — Cordis plugin entry.
 *
 * Exposes a `ctx.tasks` service over the file-backed engine in storage.ts:
 * task-list rollups, per-list and cross-list reads, create/update/delete, and
 * status transitions. The storage root is configurable via `Config.tasksRoot`
 * (defaults to `~/.rin/tasks`).
 *
 * @module @rin/tasks
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileTaskStore, resolveTasksRoot } from './storage.ts'
import type {
  Config as TasksConfig,
  Task,
  TaskInput,
  TaskListSummary,
  TaskPatch,
  TaskStatus,
} from './types.ts'

export type * from './types.ts'
export {
  FileTaskStore,
  defaultTasksRoot,
  parseTaskRecord,
  resolveTasksRoot,
  sanitizeId,
  toTaskRecord,
} from './storage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tasks: TaskStore
  }
}

/** The tasks service exposed on the shared context. */
export class TaskStore extends Service {
  private readonly store: FileTaskStore

  constructor(ctx: Context, config: TasksConfig = {}) {
    super(ctx, 'tasks')
    this.store = new FileTaskStore(resolveTasksRoot(config.tasksRoot))
  }

  /** @returns every non-empty task list with its status rollups. */
  listTaskLists(): Promise<TaskListSummary[]> {
    return this.store.listTaskLists()
  }

  /** @param taskListId - the task-list id. @returns its tasks, sorted by id. */
  getTasksForList(taskListId: string): Promise<Task[]> {
    return this.store.getTasksForList(taskListId)
  }

  /** @returns every task across all task lists. */
  listTasks(): Promise<Task[]> {
    return this.store.listTasks()
  }

  /** @param taskListId - the task-list id. @param taskId - the task id. @returns the task or null. */
  getTask(taskListId: string, taskId: string): Promise<Task | null> {
    return this.store.getTask(taskListId, taskId)
  }

  /** @param taskListId - the task-list id. @param input - the task fields. @returns the created task. */
  createTask(taskListId: string, input: TaskInput): Promise<Task> {
    return this.store.createTask(taskListId, input)
  }

  /**
   * @param taskListId - the task-list id.
   * @param taskId - the task id.
   * @param patch - the fields to merge.
   * @returns the updated task, or null when the task is missing.
   */
  updateTask(taskListId: string, taskId: string, patch: TaskPatch): Promise<Task | null> {
    return this.store.updateTask(taskListId, taskId, patch)
  }

  /** @param taskListId - the task-list id. @param taskId - the task id. @returns true when removed. */
  deleteTask(taskListId: string, taskId: string): Promise<boolean> {
    return this.store.deleteTask(taskListId, taskId)
  }

  /**
   * @param taskListId - the task-list id.
   * @param taskId - the task id.
   * @param next - the new status.
   * @returns the updated task, or null when the task is missing.
   */
  status(taskListId: string, taskId: string, next: TaskStatus): Promise<Task | null> {
    return this.store.status(taskListId, taskId, next)
  }
}

export const name = 'tasks'
export const inject: string[] = []

/** Plugin configuration: an optional tasks root (defaults to `~/.rin/tasks`). */
export const Config: z<TasksConfig> = z.object({
  tasksRoot: z.string(),
})

/**
 * Install the file-backed tasks service.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: TasksConfig): void {
  ctx.plugin(TaskStore, config)
}
