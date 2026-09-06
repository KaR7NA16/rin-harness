import { describe, expect, test } from 'vitest'

type InvariantScenario = {
  id: string
  blueprintAnchor: string
  statement: string
  executableAssertion: string
  implementationWave: string
}

const BLUEPRINT_INVARIANT_SCENARIOS = [
  {
    id: 'INV-001',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/1',
    statement: 'Model output may propose an interpretation but cannot create an observed fact.',
    executableAssertion: 'Submit a model proposal and assert that epistemic state is not observed.',
    implementationWave: 'Wave 1',
  },
  {
    id: 'INV-002',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/2',
    statement: 'Repeated recall cannot promote hypothesized to observed.',
    executableAssertion: 'Replay repeated recall without new evidence and compare epistemic state.',
    implementationWave: 'Wave 4',
  },
  {
    id: 'INV-003',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/3',
    statement: 'Activation changes cannot directly change confidence.',
    executableAssertion: 'Increase accessibility through recall and assert confidence is unchanged.',
    implementationWave: 'Wave 3',
  },
  {
    id: 'INV-004',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/4',
    statement: 'Superseded representations remain available for historical queries but not current fact recall.',
    executableAssertion: 'Supersede a representation and assert current and historical queries diverge.',
    implementationWave: 'Wave 4',
  },
  {
    id: 'INV-005',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/5',
    statement: 'Revocation stops influence; erasure requires owner authorization and bounded propagation.',
    executableAssertion: 'Attempt influence after revoke and attempt erase without an authorization.',
    implementationWave: 'Wave 7',
  },
  {
    id: 'INV-006',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/6',
    statement: 'A single ambiguous inference cannot stabilize a high-impact self or relationship change.',
    executableAssertion: 'Submit one ambiguous candidate and assert that durable high-impact state is unchanged.',
    implementationWave: 'Wave 5',
  },
  {
    id: 'INV-007',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §5.3/7',
    statement: 'Dreams, counterfactuals, and prospects remain hypothesized and cannot enter observed history.',
    executableAssertion: 'Commit a simulation candidate and assert that no observed scene is created.',
    implementationWave: 'Wave 5',
  },
  {
    id: 'INV-008',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §10',
    statement: 'Automatic decay, inhibition, and archive cannot escalate to hard erase.',
    executableAssertion: 'Run automatic forgetting and assert content and history remain recoverable.',
    implementationWave: 'Wave 4',
  },
  {
    id: 'INV-009',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §10',
    statement: 'Only the memory owner can authorize hard erase.',
    executableAssertion: 'Submit authorization from model, plugin, and background actors and assert rejection.',
    implementationWave: 'Wave 7',
  },
  {
    id: 'INV-010',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §10',
    statement: 'Erase propagation follows actual support and derive edges only.',
    executableAssertion: 'Erase one root and assert dependent projections change while unrelated scenes remain.',
    implementationWave: 'Wave 7',
  },
  {
    id: 'INV-011',
    blueprintAnchor: 'MEMORY-BLUEPRINT.md §10',
    statement: 'Independent support allows a derived representation to survive scoped erase with reduced support.',
    executableAssertion: 'Erase one support edge and assert independent support is retained and recomputed.',
    implementationWave: 'Wave 7',
  },
] as const satisfies readonly InvariantScenario[]

describe('M0-03 blueprint invariant contract', () => {
  test('maps every transfer and erasure invariant to a unique executable scenario ID', () => {
    const ids = BLUEPRINT_INVARIANT_SCENARIOS.map(scenario => scenario.id)

    expect(BLUEPRINT_INVARIANT_SCENARIOS).toHaveLength(11)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining([
      'INV-001',
      'INV-002',
      'INV-003',
      'INV-004',
      'INV-005',
      'INV-006',
      'INV-007',
      'INV-008',
      'INV-009',
      'INV-010',
      'INV-011',
    ]))
  })

  test.each(BLUEPRINT_INVARIANT_SCENARIOS)('$id is an executable implementation contract', scenario => {
    expect(scenario.blueprintAnchor).toMatch(/^MEMORY-BLUEPRINT\.md §/)
    expect(scenario.statement.trim()).not.toBe('')
    expect(scenario.executableAssertion.trim()).not.toBe('')
    expect(scenario.implementationWave).toMatch(/^Wave [1-7]$/)
  })
})
