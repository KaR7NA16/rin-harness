import { describe, expect, test } from 'vitest'
import {
  PROMPT_MEMORY_SECTION_NAME,
  registerPromptMemorySeam,
  type PromptAssembly,
  type PromptMemorySeam,
} from '../src/seam.ts'
import type { MemoryItem, MemoryListOptions } from '@rin/memory'
import type { PromptMemoryFile, PromptMemoryStatus } from '../src/types.ts'

function promptFile(
  target: PromptMemoryFile['target'],
  filename: string,
  content: string,
): PromptMemoryFile {
  return {
    target,
    filename,
    path: `/tmp/${filename}`,
    exists: true,
    content,
    entries: [],
    format: 'plain',
    charCount: content.length,
    limit: 3000,
    overLimit: false,
  }
}

describe('prompt-memory seam', () => {
  test('records the versions actually projected into system prompt', async () => {
    const status: PromptMemoryStatus = {
      files: {
        soul: promptFile('soul', 'SOUL.md', 'A stable identity.'),
        brief: promptFile('brief', 'BRIEF.md', 'A current brief.'),
        user: promptFile('user', 'USER.md', 'A user preference.'),
      },
    }
    const upserted: string[] = []
    const injections: Array<{ memoryIds: string[]; memoryVersions: Record<string, string> }> = []
    const catalog = new Map<string, MemoryItem>()
    const deleted: string[] = []
    let listener: ((assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly> | void) | undefined
    const ctx: PromptMemorySeam = {
      systemPrompt: {
        section: () => () => {},
      },
      on: (_event, nextListener) => {
        listener = nextListener
        return () => {}
      },
      effect: () => {},
      promptMemory: {
        getStatus: async () => status,
      },
      memory: {
        list(options: MemoryListOptions = {}) {
          return [...catalog.values()].filter(item =>
            (options.projection === undefined || item.projection === options.projection)
            && (options.status === undefined || item.status === options.status)
            && (options.sourceId === undefined || item.source.id === options.sourceId),
          )
        },
        get(id: string) { return catalog.get(id) },
        upsert(input) {
          const item = {
            id: input.id ?? 'generated',
            projection: input.projection,
            kind: input.kind,
            content: input.content,
            version: `version:${input.content}`,
            status: 'active' as const,
            visibility: input.visibility ?? 'model',
            source: input.source,
            createdAt: 'now',
            updatedAt: 'now',
          }
          catalog.set(item.id, item)
          upserted.push(item.id)
          return item
        },
        delete(id: string) { deleted.push(id); return catalog.delete(id) },
        recordInjection(input) {
          injections.push({ memoryIds: input.memoryIds, memoryVersions: input.memoryVersions })
          return {
            ...input,
            id: input.id ?? 'injection',
            createdAt: input.createdAt ?? 'now',
          }
        },
      },
    }
    await registerPromptMemorySeam(ctx, { injectSoul: true, injectBrief: true })
    expect(upserted).toEqual([
      'prompt-memory:soul',
      'prompt-memory:brief',
      'prompt-memory:user',
    ])
    expect(injections).toHaveLength(0)
    expect(listener).toBeDefined()

    const assembled = await listener?.(
      { sections: [{ name: PROMPT_MEMORY_SECTION_NAME, text: 'old' }], contexts: [], tools: [], variables: {} },
      undefined,
      async () => ({ sections: [{ name: PROMPT_MEMORY_SECTION_NAME, text: 'old' }], contexts: [], tools: [], variables: {} }),
    )
    expect(assembled?.sections[0]?.text).toContain('User memory')
    expect(injections[0]?.memoryIds).toEqual([
      'prompt-memory:soul',
      'prompt-memory:brief',
      'prompt-memory:user',
    ])
    expect(injections[0]?.memoryVersions['prompt-memory:user']).toBe('version:A user preference.')
    status.files.user.content = ''
    await listener?.({ sections: [], contexts: [], tools: [], variables: {} }, undefined, async () => ({ sections: [], contexts: [], tools: [], variables: {} }))
    expect(deleted).toContain('prompt-memory:user')
  })
})
