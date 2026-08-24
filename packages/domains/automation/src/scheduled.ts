/**
 * rin scheduled tasks — file-backed cron task and run storage.
 *
 * Scheduled tasks are persisted below the configured automation root. The
 * execution callback is supplied by Host so this package stays independent of
 * the dsh agent graph.
 *
 * @module @rin/automation
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Notification channels supported by the ScheduledTasks UI. */
export type TaskNotificationConfig = {
  enabled: boolean
  channels: ('telegram' | 'feishu')[]
}

/** One persisted scheduled prompt task. */
export type CronTask = {
  id: string
  name: string
  description?: string
  cron: string
  prompt: string
  enabled: boolean
  recurring?: boolean
  permanent?: boolean
  createdAt: number
  lastRunAt?: number
  lastFiredAt?: string
  nextRunAt?: number
  permissionMode?: string
  model?: string
  providerId?: string | null
  contextWindow?: number | null
  folderPath?: string
  useWorktree?: boolean
  notification?: TaskNotificationConfig
}

/** Fields accepted when creating a scheduled task. */
export type CreateScheduledTaskInput = Omit<
  CronTask,
  'id' | 'createdAt' | 'lastRunAt' | 'lastFiredAt' | 'nextRunAt' | 'enabled' | 'recurring' | 'permanent'
> & {
  enabled?: boolean
  recurring?: boolean
  permanent?: boolean
}

/** Fields accepted when updating a scheduled task. */
export type ScheduledTaskPatch = Partial<Omit<CronTask, 'id' | 'createdAt'>>

/** One execution record shown by the ScheduledTasks run panel. */
export type TaskRun = {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string
  error?: string
  exitCode?: number
  durationMs?: number
  sessionId?: string
}

/** Result returned by Host's agent execution bridge. */
export type ScheduledTaskExecutionResult = {
  output?: string
  sessionId?: string
}

/** Callback used by Host to execute a task without coupling this package to dsh. */
export type ScheduledTaskExecutor = (
  task: CronTask,
) => Promise<ScheduledTaskExecutionResult>

/** File-backed scheduled-task operations exposed by TaskStore. */
export interface ScheduledTaskStore {
  list(): Promise<CronTask[]>
  get(id: string): Promise<CronTask | null>
  create(input: CreateScheduledTaskInput): Promise<CronTask>
  update(id: string, patch: ScheduledTaskPatch): Promise<CronTask | null>
  delete(id: string): Promise<boolean>
  run(id: string, executor: ScheduledTaskExecutor): Promise<TaskRun | null>
  listRuns(limit?: number): Promise<TaskRun[]>
  listTaskRuns(taskId: string): Promise<TaskRun[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTaskRunStatus(value: unknown): value is TaskRun['status'] {
  return value === 'running' || value === 'completed' || value === 'failed' || value === 'timeout'
}

function parseCron(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().split(/\s+/).length !== 5) {
    throw new TypeError('cron must contain five non-empty fields')
  }
  return value.trim()
}

function parseNotification(value: unknown): TaskNotificationConfig | undefined {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.channels)) return undefined
  const channels = value.channels.filter(
    (channel): channel is 'telegram' | 'feishu' => channel === 'telegram' || channel === 'feishu',
  )
  return { enabled: value.enabled, channels }
}

function parseTask(value: unknown): CronTask | null {
  if (!isRecord(value)) return null
  const id = value.id
  const name = value.name
  const prompt = value.prompt
  const cron = value.cron
  const createdAt = value.createdAt
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof prompt !== 'string' ||
    typeof createdAt !== 'number'
  ) return null

  try {
    const task: CronTask = {
      id,
      name,
      cron: parseCron(cron),
      prompt,
      enabled: value.enabled !== false,
      recurring: value.recurring !== false,
      permanent: value.permanent === true,
      createdAt,
    }
    if (typeof value.description === 'string') task.description = value.description
    if (typeof value.lastRunAt === 'number') task.lastRunAt = value.lastRunAt
    if (typeof value.lastFiredAt === 'string') task.lastFiredAt = value.lastFiredAt
    if (typeof value.nextRunAt === 'number') task.nextRunAt = value.nextRunAt
    if (typeof value.permissionMode === 'string') task.permissionMode = value.permissionMode
    if (typeof value.model === 'string') task.model = value.model
    if (typeof value.providerId === 'string' || value.providerId === null) task.providerId = value.providerId
    if (typeof value.contextWindow === 'number' || value.contextWindow === null) task.contextWindow = value.contextWindow
    if (typeof value.folderPath === 'string') task.folderPath = value.folderPath
    if (value.useWorktree === true) task.useWorktree = true
    const notification = parseNotification(value.notification)
    if (notification !== undefined) task.notification = notification
    return task
  } catch {
    return null
  }
}

function parseRun(value: unknown): TaskRun | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.taskId !== 'string' ||
    typeof value.taskName !== 'string' ||
    typeof value.startedAt !== 'string' ||
    typeof value.prompt !== 'string' ||
    !isTaskRunStatus(value.status)
  ) return null
  const run: TaskRun = {
    id: value.id,
    taskId: value.taskId,
    taskName: value.taskName,
    startedAt: value.startedAt,
    status: value.status,
    prompt: value.prompt,
  }
  if (typeof value.completedAt === 'string') run.completedAt = value.completedAt
  if (typeof value.output === 'string') run.output = value.output
  if (typeof value.error === 'string') run.error = value.error
  if (typeof value.exitCode === 'number') run.exitCode = value.exitCode
  if (typeof value.durationMs === 'number') run.durationMs = value.durationMs
  if (typeof value.sessionId === 'string') run.sessionId = value.sessionId
  return run
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

/** File-backed scheduled task and run store. */
export class FileScheduledTaskStore implements ScheduledTaskStore {
  private readonly root: string
  private readonly runsRoot: string

  /** @param root - directory holding scheduled task JSON files. */
  constructor(root: string) {
    this.root = root
    this.runsRoot = join(root, 'runs')
  }

  async list(): Promise<CronTask[]> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const tasks: CronTask[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const task = await this.readTask(name)
      if (task !== null) tasks.push(task)
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<CronTask | null> {
    return this.readTask(this.fileName(id))
  }

  async create(input: CreateScheduledTaskInput): Promise<CronTask> {
    if (typeof input.name !== 'string' || input.name.trim() === '') throw new TypeError('task name is required')
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') throw new TypeError('task prompt is required')
    const task: CronTask = {
      ...input,
      id: randomUUID(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      cron: parseCron(input.cron),
      createdAt: Date.now(),
      enabled: input.enabled !== false,
      recurring: input.recurring !== false,
      permanent: input.permanent === true,
    }
    await this.writeTask(task)
    return task
  }

  async update(id: string, patch: ScheduledTaskPatch): Promise<CronTask | null> {
    const existing = await this.get(id)
    if (existing === null) return null
    const updated: CronTask = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      name: typeof patch.name === 'string' && patch.name.trim() !== '' ? patch.name.trim() : existing.name,
      prompt: typeof patch.prompt === 'string' && patch.prompt.trim() !== '' ? patch.prompt.trim() : existing.prompt,
      cron: patch.cron === undefined ? existing.cron : parseCron(patch.cron),
    }
    await this.writeTask(updated)
    return updated
  }

  async delete(id: string): Promise<boolean> {
    try {
      await unlink(join(this.root, this.fileName(id)))
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  async run(id: string, executor: ScheduledTaskExecutor): Promise<TaskRun | null> {
    const task = await this.get(id)
    if (task === null) return null
    if (!task.enabled) throw new Error('scheduled task is disabled')

    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    const running: TaskRun = {
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      startedAt,
      status: 'running',
      prompt: task.prompt,
    }
    await this.writeRun(running)
    await this.update(task.id, { lastRunAt: startMs, lastFiredAt: startedAt })

    try {
      const result = await executor(task)
      const completed: TaskRun = {
        ...running,
        completedAt: new Date().toISOString(),
        status: 'completed',
        durationMs: Date.now() - startMs,
      }
      if (result.output !== undefined) completed.output = result.output
      if (result.sessionId !== undefined) completed.sessionId = result.sessionId
      await this.writeRun(completed)
      return completed
    } catch (error) {
      const failed: TaskRun = {
        ...running,
        completedAt: new Date().toISOString(),
        status: 'failed',
        durationMs: Date.now() - startMs,
        error: error instanceof Error ? error.message : String(error),
      }
      await this.writeRun(failed)
      return failed
    }
  }

  async listRuns(limit = 50): Promise<TaskRun[]> {
    const runs = await this.readRuns()
    return runs
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.max(1, Math.min(limit, 200)))
  }

  async listTaskRuns(taskId: string): Promise<TaskRun[]> {
    const runs = await this.readRuns()
    return runs
      .filter(run => run.taskId === taskId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  private fileName(id: string): string {
    return id.replace(/[^A-Za-z0-9_-]/g, '-') + '.json'
  }

  private async readTask(name: string): Promise<CronTask | null> {
    try {
      return parseTask(JSON.parse(await readFile(join(this.root, name), 'utf8')))
    } catch {
      return null
    }
  }

  private async writeTask(task: CronTask): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, this.fileName(task.id)), JSON.stringify(task, null, 2) + '\n')
  }

  private async readRuns(): Promise<TaskRun[]> {
    let names: string[]
    try {
      names = await readdir(this.runsRoot)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const runs: TaskRun[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const run = parseRun(JSON.parse(await readFile(join(this.runsRoot, name), 'utf8')))
        if (run !== null) runs.push(run)
      } catch {
        // Ignore an incomplete or malformed historical run record.
      }
    }
    return runs
  }

  private async writeRun(run: TaskRun): Promise<void> {
    await mkdir(this.runsRoot, { recursive: true })
    await writeFile(join(this.runsRoot, this.fileName(run.id)), JSON.stringify(run, null, 2) + '\n')
  }
}
