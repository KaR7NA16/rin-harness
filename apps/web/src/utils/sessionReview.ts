import type { UIMessage } from '../types/chat'

/**
 * 会话审查中心的聚合工具：从可见的 UIMessage[] 中抽取所有 Edit / Write
 * 文件改动，按文件聚合，供「会话审查视图」渲染。
 *
 * 数据来自每条 tool_use 的 input（与聊天流里 DiffViewer 相同的数据源），
 * 因此无需额外服务端接口即可在桌面端还原整个会话的文件改动目录。
 */

export type ReviewFileDiff = {
  filePath: string
  /** 该文件在会话中被触碰的次数（每个 Edit/Write 计一次）。 */
  editCount: number
  linesAdded: number
  linesRemoved: number
  /** 该文件最后一次改动的消息顺序号（越大越新），用于排序。 */
  lastSeq: number
  /** 保留按时间顺序的每次改动的原文，供逐条 DiffViewer 渲染。 */
  edits: Array<{
    toolName: 'Edit' | 'Write'
    oldString: string
    newString: string
    seq: number
  }>
}

export type SessionReviewSummary = {
  filesChanged: number
  totalInsertions: number
  totalDeletions: number
  files: ReviewFileDiff[]
}

type EditInput = { file_path: string; old_string: string; new_string: string }
type WriteInput = { file_path: string; content: string }

function isFileEditInput(input: unknown): input is EditInput {
  if (!input || typeof input !== 'object') return false
  const obj = input as Record<string, unknown>
  return (
    typeof obj.file_path === 'string' &&
    typeof obj.old_string === 'string' &&
    typeof obj.new_string === 'string'
  )
}

function isFileWriteInput(input: unknown): input is WriteInput {
  if (!input || typeof input !== 'object') return false
  const obj = input as Record<string, unknown>
  return typeof obj.file_path === 'string' && typeof obj.content === 'string'
}

function countLines(text: string): number {
  if (!text) return 0
  const trimmed = text.replace(/\r\n/g, '\n')
  // 空字符串视为 0 行；结尾换行不计入新增行。
  return trimmed === '' ? 0 : trimmed.split('\n').filter((line) => line.length > 0).length
}

/** 从 UIMessage[] 汇总会话中的文件改动（按文件路径聚合）。 */
export function collectSessionDiffs(messages: UIMessage[]): SessionReviewSummary {
  const byPath = new Map<string, ReviewFileDiff>()

  let seq = 0
  for (const message of messages) {
    if (message.type !== 'tool_use') continue
    seq++
    const inputToolName = message.toolName
    const { input } = message

    let filePath: string
    let oldString: string
    let newString: string
    let toolName: 'Edit' | 'Write'

    if (inputToolName === 'Edit' && isFileEditInput(input)) {
      filePath = input.file_path
      oldString = input.old_string
      newString = input.new_string
      toolName = 'Edit'
    } else if (inputToolName === 'Write' && isFileWriteInput(input)) {
      filePath = input.file_path
      oldString = ''
      newString = input.content
      toolName = 'Write'
    } else {
      continue
    }

    const additions = countLines(newString)
    const removals = oldString === '' ? 0 : countLines(oldString)

    const existing = byPath.get(filePath)
    if (existing) {
      existing.editCount += 1
      existing.linesAdded += additions
      existing.linesRemoved += removals
      existing.lastSeq = seq
      existing.edits.push({ toolName, oldString, newString, seq })
    } else {
      byPath.set(filePath, {
        filePath,
        editCount: 1,
        linesAdded: additions,
        linesRemoved: removals,
        lastSeq: seq,
        edits: [{ toolName, oldString, newString, seq }],
      })
    }
  }

  const files = [...byPath.values()].sort((a, b) => b.lastSeq - a.lastSeq)

  return {
    filesChanged: files.length,
    totalInsertions: files.reduce((sum, file) => sum + file.linesAdded, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.linesRemoved, 0),
    files,
  }
}