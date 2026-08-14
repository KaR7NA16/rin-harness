/**
 * rin knowledge — strip-types smoke test for the model-visible tool logic.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/tool.smoke.ts
 *
 * @module @rin/knowledge
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeService } from '../src/service.ts'
import {
  clampSearchLimit,
  knowledgeStats,
  searchKnowledge,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
} from '../src/tools.ts'

const fixture = await mkdtemp(join(tmpdir(), 'rin-knowledge-smoke-'))
try {
  const project = join(fixture, 'project')
  await mkdir(project)
  await writeFile(join(project, 'README.md'), '# 架构设计\n\n订单服务通过事件总线处理付款。')
  await writeFile(join(project, 'worker.ts'), 'export function settlePayment() { return "paid" }')

  const service = new KnowledgeService(join(fixture, 'knowledge.db'))
  try {
    await service.addSources([project], { waitForIndex: true })

    // Unmounted branch: a null service reports an explicit error.
    const unmounted = searchKnowledge(null, { query: 'x' })
    if (!('error' in unmounted)) throw new Error('expected unmounted error')

    // Empty branch: a never-indexed database reports an explicit error on search,
    // while stats return explicit zeroed counts.
    const emptyService = new KnowledgeService(join(fixture, 'empty.db'))
    try {
      const empty = searchKnowledge(emptyService, { query: 'x' })
      if (!('error' in empty)) throw new Error('expected empty-base error')
      const emptyStats = knowledgeStats(emptyService)
      if ('error' in emptyStats || emptyStats.stats.sourceCount !== 0) throw new Error('expected zeroed stats')
    } finally {
      emptyService.close()
    }

    // Real search over indexed content.
    const value = searchKnowledge(service, { query: '事件总线', limit: 999 })
    if ('error' in value) throw new Error('unexpected search error: ' + value.error)
    if (value.results.length < 1) throw new Error('expected at least one result')
    const hit = value.results[0]
    if (!hit.path.endsWith('README.md')) throw new Error('wrong hit path: ' + hit.path)
    if (hit.title !== 'README.md') throw new Error('wrong hit title: ' + hit.title)
    if (typeof hit.snippet !== 'string') throw new Error('hit snippet missing')
    if (typeof hit.score !== 'number') throw new Error('hit score missing')

    // Stats over the indexed source.
    const stats = knowledgeStats(service)
    if ('error' in stats) throw new Error('unexpected stats error: ' + stats.error)
    if (stats.stats.sourceCount !== 1) throw new Error('expected 1 source, got ' + stats.stats.sourceCount)
    if (stats.stats.documentCount !== 2) throw new Error('expected 2 documents, got ' + stats.stats.documentCount)

    // Limit clamp bounds.
    if (clampSearchLimit(undefined) !== SEARCH_LIMIT_DEFAULT) throw new Error('default limit mismatch')
    if (clampSearchLimit(0) !== 1) throw new Error('lower clamp mismatch')
    if (clampSearchLimit(999) !== SEARCH_LIMIT_MAX) throw new Error('upper clamp mismatch')

    console.log('TOOL-SMOKE-OK', stats.stats.documentCount, 'docs', value.results.length, 'hits')
  } finally {
    service.close()
  }
} finally {
  await rm(fixture, { recursive: true, force: true })
}
