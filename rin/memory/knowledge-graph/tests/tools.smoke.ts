/**
 * rin knowledge-graph — strip-types smoke test for the model-visible tool logic.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/tools.smoke.ts
 *
 * Exercises the pure atlas tool functions (search/graph/clamps) without the
 * Cordis runtime. The `KnowledgeGraphService` import in tools.ts is type-only,
 * so this stays free of Cordis/dsh-tools runtime imports.
 *
 * @module @rin/knowledge-graph
 */

import { clampDepth, clampSearchLimit, graphNeighborhood, searchAtlasNodes } from '../src/tools.ts'

const snapshot = {
  refreshedAt: '2026-01-01T00:00:00.000Z',
  nodes: [
    { id: 'note:a.md', kind: 'note', label: 'Alpha', path: 'a.md', source: 'notes', metadata: {}, modifiedAt: null },
    { id: 'tag:alpha', kind: 'tag', label: 'alpha', path: null, source: 'notes', metadata: {}, modifiedAt: null },
    { id: 'repository_agent:rin-base', kind: 'repository_agent', label: 'rin-base', path: 'agents/rin-base.agent.yaml', source: 'repository', metadata: {}, modifiedAt: null },
  ],
  edges: [
    { from: 'note:a.md', to: 'tag:alpha', kind: 'tag', confidence: 1, provenance: 't' },
  ],
}

let failures = 0
function check(condition: boolean, label: string): void {
  if (!condition) {
    console.error('FAIL:', label)
    failures += 1
  } else {
    console.log('PASS:', label)
  }
}

check(clampSearchLimit(undefined) === 10, 'search limit default is 10')
check(clampSearchLimit(999) === 30, 'search limit capped at 30')
check(clampDepth(9) === 3, 'depth capped at 3')

const hits = searchAtlasNodes(snapshot, 'alpha', 10)
check(hits.length === 2, 'search matches label and id')
check(hits[0]?.neighbors.some(n => n.id === 'tag:alpha') === true, 'search attaches matched neighbors')

const neighborhood = graphNeighborhood(snapshot, 'note:a.md')
check(!('error' in neighborhood), 'graph finds known node')
if (!('error' in neighborhood)) {
  check(neighborhood.related[0]?.edgeKind === 'tag', 'graph reports edge kinds')
}

const missing = graphNeighborhood(snapshot, 'note:missing.md')
check('error' in missing, 'graph reports unknown node')

if (failures > 0) {
  console.error('ATLAS-TOOLS-SMOKE-FAIL', failures, 'check(s)')
  process.exit(1)
}
console.log('ATLAS-TOOLS-SMOKE-OK')
