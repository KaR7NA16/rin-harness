# @rin/automation

File-backed task-list / task storage for the rin desktop bridge, exposed as a
Cordis `ctx.tasks` service.

## Responsibilities

- Persist task lists and tasks as JSON files under a configurable root
  (default `~/.rin/automation`), one file per task:
  `<root>/<taskListId>/<taskId>.json`.
- Read the legacy CLI V2 task layout (id, subject, description, activeForm,
  owner, status, blocks, blockedBy, metadata). The `taskListId` field is
  derived from the directory, not stored.
- Provide list / create / update / delete and `pending` / `in_progress` /
  `completed` status transitions.

## API

`ctx.tasks` (class `TaskStore`) exposes:

| Method | Returns | Notes |
| --- | --- | --- |
| `listTaskLists()` | `TaskListSummary[]` | Non-empty lists only, with per-status counts. |
| `getTasksForList(taskListId)` | `Task[]` | Sorted by numeric id. |
| `listTasks()` | `Task[]` | Every task across all lists. |
| `getTask(taskListId, taskId)` | `Task \| null` | |
| `createTask(taskListId, input)` | `Task` | Assigns the next numeric id. |
| `updateTask(taskListId, taskId, patch)` | `Task \| null` | `undefined` fields are left unchanged. |
| `deleteTask(taskListId, taskId)` | `boolean` | `true` when removed. |
| `status(taskListId, taskId, next)` | `Task \| null` | Status transition. |

Plugin configuration (`Config.tasksRoot`, optional): the storage root,
defaulting to `~/.rin/automation`.

## Smoke test

```sh
node --experimental-strip-types tests/automation.smoke.ts
```

## Known Limitations and Deferred Work

- No cross-process synchronization: concurrent writers in separate processes can
  race on id assignment and file writes.
- No priority ordering or dependency-graph resolution: `blocks` / `blockedBy`
  are stored verbatim for format compatibility but are not interpreted.
