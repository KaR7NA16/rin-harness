/**
 * rin tasks — file-backed storage engine.
 *
 * Tasks live as one JSON file per task under `<root>/<taskListId>/<taskId>.json`,
 * mirroring the legacy CLI V2 layout. This module is Cordis-free: it imports
 * only node builtins and the domain model, so it runs under
 * `node --experimental-strip-types`.
 *
 * @module @rin/automation
 */

import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  isTaskStatus,
  type Task,
  type TaskInput,
  type TaskListSummary,
  type TaskPatch,
  type TaskRecord,
  type TaskStatus,
} from './types.ts'

/** The default tasks root: `~/.rin/automation`. */
export function defaultTasksRoot(): string {
  return join(homedir(), '.rin', 'tasks')
}

/**
 * Resolve the configured tasks root, falling back to `~/.rin/automation`.
 * @param configured - the `Config.tasksRoot` value, when set.
 * @returns the absolute tasks root path.
 */
export function resolveTasksRoot(configured?: string): string {
  return configured && configured.trim() ? resolve(configured) : defaultTasksRoot()
}

/**
 * Sanitize an id for use as a single filesystem path segment, blocking traversal.
 * @param id - the raw task-list or task id.
 * @returns the id with any character outside `[A-Za-z0-9_-]` replaced by `-`.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** @param err - the thrown error. @param code - the node errno to match. @returns true on match. */
function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code
}

/** @param value - the candidate. @returns true for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param value - the candidate. @returns the string members, or an empty array. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** @param value - the candidate status. @returns the status, throwing on invalid input. */
function assertStatus(value: unknown): TaskStatus {
  if (!isTaskStatus(value)) throw new TypeError('invalid task status: ' + String(value))
  return value
}

/**
 * Parse one legacy task JSON document into a `TaskRecord`.
 * @param data - the parsed JSON value.
 * @returns the record, or null when it is not a task (missing id/subject, or internal).
 */
export function parseTaskRecord(data: unknown): TaskRecord | null {
  if (!isRecord(data)) return null
  const id = data['id']
  const subject = data['subject']
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof subject !== 'string') return null
  const metadata = data['metadata']
  if (isRecord(metadata) && metadata['_internal'] === true) return null
  const record: TaskRecord = {
    id: String(id),
    subject,
    description: typeof data['description'] === 'string' ? data['description'] : '',
    status: isTaskStatus(data['status']) ? data['status'] : 'pending',
    blocks: stringArray(data['blocks']),
    blockedBy: stringArray(data['blockedBy']),
  }
  if (typeof data['activeForm'] === 'string') record.activeForm = data['activeForm']
  if (typeof data['owner'] === 'string') record.owner = data['owner']
  if (isRecord(metadata)) record.metadata = metadata
  return record
}

/**
 * Strip the derived `taskListId` before persisting, matching the legacy layout.
 * @param task - the full task.
 * @returns the on-disk record.
 */
export function toTaskRecord(task: Task): TaskRecord {
  const record: TaskRecord = {
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status,
    blocks: task.blocks,
    blockedBy: task.blockedBy,
  }
  if (task.activeForm !== undefined) record.activeForm = task.activeForm
  if (task.owner !== undefined) record.owner = task.owner
  if (task.metadata !== undefined) record.metadata = task.metadata
  return record
}

/** Sort tasks by numeric id when possible, else lexicographically. */
function sortTasks(tasks: Task[]): Task[] {
  return tasks.sort((a, b) => {
    const numA = Number.parseInt(a.id, 10)
    const numB = Number.parseInt(b.id, 10)
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
    return a.id.localeCompare(b.id)
  })
}

/** Roll up one task list's status counts. */
function summarizeTaskList(id: string, tasks: readonly Task[]): TaskListSummary {
  return {
    id,
    taskCount: tasks.length,
    completedCount: tasks.filter((task) => task.status === 'completed').length,
    inProgressCount: tasks.filter((task) => task.status === 'in_progress').length,
    pendingCount: tasks.filter((task) => task.status === 'pending').length,
  }
}

/** File-backed task-list / task CRUD engine. */
export class FileTaskStore {
  private readonly root: string

  /** @param root - absolute or cwd-relative path to the tasks root. */
  constructor(root: string) {
    this.root = resolve(root)
  }

  private listDir(taskListId: string): string {
    return join(this.root, sanitizeId(taskListId))
  }

  private taskPath(taskListId: string, taskId: string): string {
    return join(this.listDir(taskListId), sanitizeId(taskId) + '.json')
  }

  /** @returns every non-empty task list with its status rollups. */
  async listTaskLists(): Promise<TaskListSummary[]> {
    let entries: Dirent[] = []
    try {
      entries = await readdir(this.root, { withFileTypes: true })
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return []
      throw err
    }
    const summaries: TaskListSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const tasks = await this.getTasksForList(entry.name)
      if (tasks.length === 0) continue
      summaries.push(summarizeTaskList(entry.name, tasks))
    }
    return summaries
  }

  /** @param taskListId - the task-list id. @returns its tasks, sorted by id. */
  async getTasksForList(taskListId: string): Promise<Task[]> {
    const listId = sanitizeId(taskListId)
    const dir = join(this.root, listId)
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return []
      throw err
    }
    const tasks: Task[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const task = await this.readTaskFile(dir, name, listId)
      if (task !== null) tasks.push(task)
    }
    return sortTasks(tasks)
  }

  /** @returns every task across all task lists. */
  async listTasks(): Promise<Task[]> {
    const lists = await this.listTaskLists()
    const all: Task[] = []
    for (const list of lists) all.push(...(await this.getTasksForList(list.id)))
    return all
  }

  /** @param taskListId - the task-list id. @param taskId - the task id. @returns the task or null. */
  async getTask(taskListId: string, taskId: string): Promise<Task | null> {
    const listId = sanitizeId(taskListId)
    const path = join(this.root, listId, sanitizeId(taskId) + '.json')
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return null
      throw err
    }
    const record = parseTaskRecord(this.parseJson(raw))
    return record === null ? null : { ...record, taskListId: listId }
  }

  /**
   * Create a task, assigning the next numeric id in its list.
   * @param taskListId - the task-list id.
   * @param input - the task fields.
   * @returns the created task.
   */
  async createTask(taskListId: string, input: TaskInput): Promise<Task> {
    if (typeof input.subject !== 'string') throw new TypeError('task subject must be a string')
    const listId = sanitizeId(taskListId)
    const dir = join(this.root, listId)
    await mkdir(dir, { recursive: true })
    const id = String((await this.nextNumericId(listId)) + 1)
    const task: Task = {
      id,
      subject: input.subject,
      description: input.description ?? '',
      status: input.status === undefined ? 'pending' : assertStatus(input.status),
      blocks: input.blocks ?? [],
      blockedBy: input.blockedBy ?? [],
      taskListId: listId,
    }
    if (input.activeForm !== undefined) task.activeForm = input.activeForm
    if (input.owner !== undefined) task.owner = input.owner
    if (input.metadata !== undefined) task.metadata = input.metadata
    await this.writeTask(task)
    return task
  }

  /**
   * Merge `patch` onto a task; `undefined` fields are left unchanged.
   * @param taskListId - the task-list id.
   * @param taskId - the task id.
   * @param patch - the fields to update.
   * @returns the updated task, or null when the task is missing.
   */
  async updateTask(taskListId: string, taskId: string, patch: TaskPatch): Promise<Task | null> {
    const existing = await this.getTask(taskListId, taskId)
    if (existing === null) return null
    if (patch.status !== undefined) assertStatus(patch.status)
    const updated: Task = {
      id: existing.id,
      subject: patch.subject ?? existing.subject,
      description: patch.description ?? existing.description,
      status: patch.status ?? existing.status,
      blocks: patch.blocks ?? existing.blocks,
      blockedBy: patch.blockedBy ?? existing.blockedBy,
      taskListId: existing.taskListId,
    }
    const activeForm = patch.activeForm ?? existing.activeForm
    if (activeForm !== undefined) updated.activeForm = activeForm
    const owner = patch.owner ?? existing.owner
    if (owner !== undefined) updated.owner = owner
    const metadata = patch.metadata ?? existing.metadata
    if (metadata !== undefined) updated.metadata = metadata
    await this.writeTask(updated)
    return updated
  }

  /** @param taskListId - the task-list id. @param taskId - the task id. @returns true when removed. */
  async deleteTask(taskListId: string, taskId: string): Promise<boolean> {
    try {
      await unlink(this.taskPath(taskListId, taskId))
      return true
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return false
      throw err
    }
  }

  /**
   * Transition a task's status.
   * @param taskListId - the task-list id.
   * @param taskId - the task id.
   * @param next - the new status.
   * @returns the updated task, or null when the task is missing.
   */
  async status(taskListId: string, taskId: string, next: TaskStatus): Promise<Task | null> {
    return this.updateTask(taskListId, taskId, { status: next })
  }

  /** @param listId - the sanitized list id. @returns the highest numeric task id, or 0. */
  private async nextNumericId(listId: string): Promise<number> {
    const dir = join(this.root, listId)
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return 0
      throw err
    }
    let highest = 0
    for (const name of names) {
      const match = /^(\d+)\.json$/.exec(name)
      if (match === null || match[1] === undefined) continue
      const value = Number(match[1])
      if (value > highest) highest = value
    }
    return highest
  }

  /** @param task - the task to persist. */
  private async writeTask(task: Task): Promise<void> {
    await writeFile(this.taskPath(task.taskListId, task.id), JSON.stringify(toTaskRecord(task), null, 2) + '\n')
  }

  /**
   * Read one task file, skipping unreadable or malformed files.
   * @param dir - the list directory.
   * @param name - the file name.
   * @param listId - the sanitized list id.
   * @returns the parsed task, or null when the file is not a valid task.
   */
  private async readTaskFile(dir: string, name: string, listId: string): Promise<Task | null> {
    let raw: string
    try {
      raw = await readFile(join(dir, name), 'utf-8')
    } catch {
      // Skip files that cannot be read; the legacy reader ignored them too.
      return null
    }
    const record = parseTaskRecord(this.parseJson(raw))
    return record === null ? null : { ...record, taskListId: listId }
  }

  /** @param raw - the file contents. @returns the parsed value, or null on malformed JSON. */
  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw)
    } catch {
      // Skip malformed JSON task files; the legacy reader ignored them too.
      return null
    }
  }
}
