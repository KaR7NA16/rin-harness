/**
 * rin knowledge — contract tests for the model-visible tool logic.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test is run
 * during development.
 *
 * @module @rin/knowledge
 */

import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeService } from '../../src/knowledge/service.ts'
import {
  clampSearchLimit,
  knowledgeStats,
  resolveKnowledgeDbPath,
  searchKnowledge,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
} from '../../src/knowledge/tools.ts'

const cleanupPaths: string[] = []
const services: KnowledgeService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  await Promise.all(cleanupPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('knowledge tool logic', () => {
  test('clamps the search limit into [1, SEARCH_LIMIT_MAX]', () => {
    expect(clampSearchLimit(undefined)).toBe(SEARCH_LIMIT_DEFAULT)
    expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_LIMIT_DEFAULT)
    expect(clampSearchLimit(0)).toBe(1)
    expect(clampSearchLimit(3)).toBe(3)
    expect(clampSearchLimit(999)).toBe(SEARCH_LIMIT_MAX)
  })

  test('reports the unmounted branch for both tools', () => {
    expect(searchKnowledge(null, { query: 'anything' })).toEqual({ error: expect.any(String) })
    expect(knowledgeStats(null)).toEqual({ error: expect.any(String) })
  })

  test('rejects a blank query before searching', async () => {
    const service = await createService()
    expect(searchKnowledge(service, { query: '   ' })).toEqual({ error: expect.any(String) })
  })

  test('reports an explicit error for an empty knowledge base', async () => {
    const service = await createService()
    expect(searchKnowledge(service, { query: 'anything' })).toEqual({ error: expect.any(String) })
    expect(knowledgeStats(service)).toEqual({
      stats: { sourceCount: 0, documentCount: 0, chunkCount: 0, sizeBytes: 0 },
    })
  })

  test('resolves the database path from dbPath or configHome', () => {
    const configHome = join('tmp', '.rin')
    expect(resolveKnowledgeDbPath(undefined, undefined)).toBeUndefined()
    expect(resolveKnowledgeDbPath('', undefined)).toBeUndefined()
    expect(resolveKnowledgeDbPath(configHome, undefined)).toBe(join(configHome, 'knowledge', 'knowledge.db'))
    expect(resolveKnowledgeDbPath(undefined, '/explicit/knowledge.db')).toBe('/explicit/knowledge.db')
    expect(resolveKnowledgeDbPath(configHome, '/explicit/knowledge.db')).toBe('/explicit/knowledge.db')
  })

  test('searches indexed content and projects the model-facing hit fields', async () => {
    const fixture = await createFixture()
    const project = join(fixture, 'project')
    await mkdir(project)
    await writeFile(join(project, 'README.md'), '# 架构设计\n\n订单服务通过事件总线处理付款。')
    const service = new KnowledgeService(join(fixture, 'knowledge.db'))
    services.push(service)

    await service.addSources([project], { waitForIndex: true })

    const value = searchKnowledge(service, { query: '事件总线', limit: 999 })
    expect('error' in value).toBe(false)
    if ('results' in value) {
      expect(value.results.length).toBeGreaterThan(0)
      const hit = value.results[0]!
      expect(hit.path).toContain('README.md')
      expect(hit.title).toBe('README.md')
      expect(typeof hit.snippet).toBe('string')
      expect(typeof hit.score).toBe('number')
    }

    const stats = knowledgeStats(service)
    expect(stats).toEqual({
      stats: {
        sourceCount: 1,
        documentCount: 1,
        chunkCount: expect.any(Number),
        sizeBytes: expect.any(Number),
      },
    })
  })
})

async function createFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'rin-knowledge-tool-'))
  cleanupPaths.push(path)
  return path
}

async function createService(): Promise<KnowledgeService> {
  const fixture = await createFixture()
  const service = new KnowledgeService(join(fixture, 'knowledge.db'))
  services.push(service)
  return service
}
