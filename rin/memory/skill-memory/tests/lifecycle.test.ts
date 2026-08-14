import { describe, expect, test } from 'vitest'
import { evaluateSkillLifecycleStatus } from '../src/lifecycle.ts'

const now = new Date('2026-08-12T00:00:00.000Z')

describe('skill lifecycle policy', () => {
  test('keeps pinned and frequently used skills active', () => {
    expect(evaluateSkillLifecycleStatus({
      status: 'pinned',
      useCount: 0,
      lastUsedAt: '2025-01-01T00:00:00.000Z',
    }, now)).toBe('pinned')
    expect(evaluateSkillLifecycleStatus({
      status: 'active',
      useCount: 10,
      lastUsedAt: '2025-01-01T00:00:00.000Z',
    }, now)).toBe('active')
  })

  test('marks low-use skills stale and then archived', () => {
    expect(evaluateSkillLifecycleStatus({
      status: 'active',
      useCount: 2,
      lastUsedAt: '2026-06-01T00:00:00.000Z',
    }, now)).toBe('stale')
    expect(evaluateSkillLifecycleStatus({
      status: 'active',
      useCount: 2,
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    }, now)).toBe('archived')
  })

  test('recent learned evidence prevents automatic archival', () => {
    expect(evaluateSkillLifecycleStatus({
      status: 'active',
      useCount: 1,
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      summaryUpdatedAt: '2026-08-01T00:00:00.000Z',
    }, now)).toBe('stale')
  })
})
