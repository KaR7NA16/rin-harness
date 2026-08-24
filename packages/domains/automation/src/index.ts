/**
 * rin tasks — Cordis plugin entry.
 *
 * Exposes a `ctx.tasks` service over the file-backed engine in storage.ts:
 * task-list rollups, per-list and cross-list reads, create/update/delete, and
 * status transitions. The storage root is configurable via `Config.tasksRoot`
 * (defaults to `~/.rin/automation`).
 *
 * @module @rin/automation
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileTaskStore, resolveTasksRoot } from './storage.ts'
import { FileScheduledTaskStore } from './scheduled.ts'
import { join } from 'node:path'
import type {
  Config as TasksConfig,
  Task,
  TaskInput,
  TaskListSummary,
  TaskPatch,
  TaskStatus,
} from './types.ts'
import type {
  CreateScheduledTaskInput,
  CronTask,
  ScheduledTaskExecutor,
  ScheduledTaskPatch,
  TaskRun,
} from './scheduled.ts'

export type * from './types.ts'
export type * from './scheduled.ts'
export { FileScheduledTaskStore } from './scheduled.ts'
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
  private readonly scheduled: FileScheduledTaskStore

  constructor(ctx: Context, config: TasksConfig = {}) {
    super(ctx, 'tasks')
    const root = resolveTasksRoot(config.tasksRoot)
    this.store = new FileTaskStore(root)
    this.scheduled = new FileScheduledTaskStore(join(root, 'scheduled'))
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

  /** @returns every persisted ScheduledTasks prompt. */
  listScheduledTasks(): Promise<CronTask[]> {
    return this.scheduled.list()
  }

  /** @param id - scheduled task id. @returns the task or null. */
  getScheduledTask(id: string): Promise<CronTask | null> {
    return this.scheduled.get(id)
  }

  /** @param input - scheduled task fields. @returns the created task. */
  createScheduledTask(input: CreateScheduledTaskInput): Promise<CronTask> {
    return this.scheduled.create(input)
  }

  /** @param id - scheduled task id. @param patch - fields to merge. @returns the updated task or null. */
  updateScheduledTask(id: string, patch: ScheduledTaskPatch): Promise<CronTask | null> {
    return this.scheduled.update(id, patch)
  }

  /** @param id - scheduled task id. @returns whether a task was deleted. */
  deleteScheduledTask(id: string): Promise<boolean> {
    return this.scheduled.delete(id)
  }

  /** @param id - scheduled task id. @param executor - Host-owned agent callback. @returns the run or null. */
  runScheduledTask(id: string, executor: ScheduledTaskExecutor): Promise<TaskRun | null> {
    return this.scheduled.run(id, executor)
  }

  /** @param limit - maximum number of runs. @returns recent runs. */
  listScheduledTaskRuns(limit?: number): Promise<TaskRun[]> {
    return this.scheduled.listRuns(limit)
  }

  /** @param taskId - scheduled task id. @returns that task's runs. */
  listScheduledTaskRunsForTask(taskId: string): Promise<TaskRun[]> {
    return this.scheduled.listTaskRuns(taskId)
  }
}

export const name = 'tasks'
export const inject: string[] = []

/** Plugin configuration: an optional tasks root (defaults to `~/.rin/automation`). */
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
