/**
 * Project an append-only history log (Claude Code style) into searchable
 * sessions. The runtime supplies the working-directory -> project-path
 * normalization policy; this module owns grouping, filtering, and timestamp
 * fallback only.
 *
 * @module @rin/memory/session-search
 */

import { sessionKey } from './db.ts'
import type {
  ParsedSessionTranscript,
  SessionHistoryOptions,
  SessionHistorySource,
  TranscriptSearchMessage,
} from './types.ts'

type HistoryLogEntry = {
  display?: string
  timestamp?: number | string
  project?: string
  sessionId?: string
}

export function isSessionHistoryFilePath(filePath: string): boolean {
  return filePath.includes('/history.jsonl#') || filePath.includes('\\history.jsonl#')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseTimestamp(value: number | string | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function parseJsonLines(raw: string): Array<{ entry: HistoryLogEntry; lineNo: number }> {
  const entries: Array<{ entry: HistoryLogEntry; lineNo: number }> = []
  for (const [index, line] of raw.split('\n').entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push({ entry: JSON.parse(trimmed) as HistoryLogEntry, lineNo: index + 1 })
    } catch {
      // The append-only history can end with a partial line after interruption.
    }
  }
  return entries
}

/** Convert an append-only history projection into searchable sessions. */
export function buildSessionHistoryTranscripts(
  raw: string,
  source: SessionHistorySource,
  options: SessionHistoryOptions,
): ParsedSessionTranscript[] {
  const grouped = new Map<
    string,
    {
      sessionId: string
      projectPath: string
      workDir: string
      messages: TranscriptSearchMessage[]
    }
  >()

  for (const { entry, lineNo } of parseJsonLines(raw)) {
    const display = typeof entry.display === 'string' ? entry.display.trim() : ''
    const workDir = typeof entry.project === 'string' ? entry.project.trim() : ''
    const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : ''
    if (!display || !workDir || !UUID_RE.test(sessionId)) continue

    const projectPath = options.projectPathForWorkingDirectory(workDir)
    if (options.projectFilter && projectPath !== options.projectFilter) continue

    const key = sessionKey(projectPath, sessionId)
    const group = grouped.get(key) ?? {
      sessionId,
      projectPath,
      workDir,
      messages: [],
    }
    group.messages.push({
      messageUuid: `history:${sessionId}:${lineNo}`,
      role: 'user',
      type: 'user',
      contentText: display,
      timestamp: parseTimestamp(entry.timestamp),
      model: null,
      lineNo,
      isSidechain: false,
    })
    grouped.set(key, group)
  }

  return [...grouped.values()].map(group => {
    const timestamps = group.messages
      .map(message => message.timestamp)
      .filter((value): value is string => Boolean(value))
    const title = group.messages[0]?.contentText.trim() || group.sessionId
    const key = sessionKey(group.projectPath, group.sessionId)
    return {
      sessionId: group.sessionId,
      projectPath: group.projectPath,
      filePath: `${source.filePath}#${key}`,
      workDir: group.workDir,
      isTemporary: false,
      title: title.length > 80 ? `${title.slice(0, 80)}...` : title,
      createdAt: timestamps[0] ?? source.birthtime.toISOString(),
      modifiedAt: timestamps.at(-1) ?? source.mtime.toISOString(),
      fileMtimeMs: source.mtimeMs,
      fileSize: source.size,
      messages: group.messages,
    }
  })
}
