import { describe, expect, test } from 'vitest'
import { evaluateSkillCreationCandidate, rankSkillGateMatches } from '../../src/skill/gate.ts'

describe('skill creation gate', () => {
  test('reuses a skill with the same normalized identity', () => {
    const result = evaluateSkillCreationCandidate({
      candidate: {
        name: 'frontend-design',
        description: 'Create production grade frontend interfaces',
      },
      existingSkills: [{
        name: 'frontend-design',
        description: 'Build production grade frontend interfaces',
      }],
    })

    expect(result.decision).toBe('reuse')
  })

  test('merges a candidate with strongly overlapping guidance', () => {
    const result = evaluateSkillCreationCandidate({
      candidate: {
        name: 'frontend-ui-polish',
        description: 'Improve React UI polish layout quality responsive components',
      },
      existingSkills: [{
        name: 'react-ui-quality',
        description: 'Improve React UI polish layout quality accessible components',
      }],
    })

    expect(result.decision).toBe('merge')
  })

  test('creates a candidate from a different domain', () => {
    const result = evaluateSkillCreationCandidate({
      candidate: {
        name: 'database-migration',
        description: 'Plan relational database schema migrations',
      },
      existingSkills: [{
        name: 'frontend-design',
        description: 'Create production grade frontend interfaces',
      }],
    })

    expect(result.decision).toBe('create')
  })

  test('preserves adapter metadata without depending on adapter types', () => {
    const [match] = rankSkillGateMatches({
      candidate: { name: 'verify-ui' },
      existingSkills: [{
        name: 'verify-ui',
        source: 'plugin',
        loadedFrom: 'skills',
      }],
    })

    expect(match).toMatchObject({
      skillName: 'verify-ui',
      source: 'plugin',
      loadedFrom: 'skills',
    })
  })
})
