import { describe, expect, it } from 'vitest'
import { collectSessionDiffs } from '../sessionReview'
import type { UIMessage } from '../../types/chat'

function toolUse(id: string, toolName: string, input: unknown): UIMessage {
  return { id, type: 'tool_use', toolName, toolUseId: id, input, timestamp: Date.now() }
}

describe('collectSessionDiffs', () => {
  it('aggregates Edit and Write diffs grouped by file path', () => {
    const messages: UIMessage[] = [
      toolUse('a', 'Edit', { file_path: 'src/a.ts', old_string: 'one', new_string: 'one\ntwo' }),
      toolUse('b', 'Write', { file_path: 'src/b.ts', content: 'fresh\nfile' }),
      toolUse('c', 'Edit', { file_path: 'src/a.ts', old_string: 'two', new_string: 'three' }),
    ]

    const summary = collectSessionDiffs(messages)

    expect(summary.filesChanged).toBe(2)
    expect(summary.totalInsertions).toBe(5)
    expect(summary.totalDeletions).toBe(2)
    expect(summary.files).toHaveLength(2)
    const aFile = summary.files[0]!
    const bFile = summary.files[1]!
    expect(aFile.filePath).toBe('src/a.ts')
    expect(aFile.editCount).toBe(2)
    expect(aFile.edits[0]!.toolName).toBe('Edit')
    expect(bFile.filePath).toBe('src/b.ts')
    expect(bFile.edits[0]!.toolName).toBe('Write')
  })

  it('sorts files by most recent edit first', () => {
    const messages: UIMessage[] = [
      toolUse('a', 'Edit', { file_path: 'old.ts', old_string: 'x', new_string: 'y' }),
      toolUse('b', 'Edit', { file_path: 'new.ts', old_string: 'x', new_string: 'y' }),
    ]

    const summary = collectSessionDiffs(messages)

    expect(summary.files.map((file) => file.filePath)).toEqual(['new.ts', 'old.ts'])
  })

  it('ignores non-Edit/Write tool uses and malformed inputs', () => {
    const messages: UIMessage[] = [
      toolUse('a', 'Bash', { command: 'ls' }),
      toolUse('b', 'Edit', { file_path: 'missing-strings.ts' }),
      toolUse('c', 'Read', { file_path: 'read.ts' }),
    ]

    const summary = collectSessionDiffs(messages)

    expect(summary.filesChanged).toBe(0)
    expect(summary.files).toEqual([])
  })

  it('counts a Write file as additions only', () => {
    const messages: UIMessage[] = [
      toolUse('a', 'Write', { file_path: 'x.md', content: 'a\nb\nc' }),
    ]

    const summary = collectSessionDiffs(messages)

    expect(summary.totalInsertions).toBe(3)
    expect(summary.totalDeletions).toBe(0)
  })
})