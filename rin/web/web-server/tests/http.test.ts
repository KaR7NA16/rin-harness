import { describe, expect, test } from 'vitest'
import {
  parseBoolean,
  parseRepositoryQuery,
  parseEnvironmentPlanQuery,
  queryParam,
  parsePositiveInt,
  parsePromptMemoryTarget,
  healthResponse,
  error,
  smartPruningStatusResponse,
  notMounted,
  mounted,
  mountedValue,
  errorMessage,
} from '../src/http.ts'

describe('parseBoolean', () => {
  test('accepts truthy-looking values', () => {
    expect(parseBoolean('true')).toBe(true)
    expect(parseBoolean('TRUE')).toBe(true)
    expect(parseBoolean('1')).toBe(true)
    expect(parseBoolean('yes')).toBe(true)
    expect(parseBoolean('on')).toBe(true)
  })
  test('treats everything else as false', () => {
    expect(parseBoolean('false')).toBe(false)
    expect(parseBoolean('0')).toBe(false)
    expect(parseBoolean('no')).toBe(false)
    expect(parseBoolean('')).toBe(false)
    expect(parseBoolean(null)).toBe(false)
  })
})

describe('parseRepositoryQuery', () => {
  test('reads a percent-encoded root', () => {
    expect(parseRepositoryQuery('?root=C%3A%5Cfoo')).toEqual({ root: 'C:\\foo' })
  })
  test('returns undefined root when absent or blank', () => {
    expect(parseRepositoryQuery('')).toEqual({ root: undefined })
    expect(parseRepositoryQuery('?root=')).toEqual({ root: undefined })
  })
})

describe('parseEnvironmentPlanQuery', () => {
  test('parses all fields', () => {
    expect(parseEnvironmentPlanQuery(
      '?profile=p1&root=r1&platform=linux&apt=true&python=1&pip=yes&r=on&npm=false&tlmgr=true',
      'win32',
    )).toEqual({
      profile: 'p1',
      root: 'r1',
      platform: 'linux',
      apt: true,
      python: true,
      pip: true,
      r: true,
      npm: false,
      tlmgr: true,
    })
  })
  test('applies defaults', () => {
    expect(parseEnvironmentPlanQuery('', 'darwin')).toEqual({
      profile: undefined,
      root: undefined,
      platform: 'darwin',
      apt: false,
      python: false,
      pip: false,
      r: false,
      npm: false,
      tlmgr: false,
    })
  })
})

describe('queryParam', () => {
  test('reads a value and treats blank/absent as undefined', () => {
    expect(queryParam('?db=/tmp/kb', 'db')).toBe('/tmp/kb')
    expect(queryParam('', 'db')).toBeUndefined()
    expect(queryParam('?db=', 'db')).toBeUndefined()
  })
})

describe('parsePositiveInt', () => {
  test('accepts positive integers only', () => {
    expect(parsePositiveInt('?limit=10', 'limit')).toBe(10)
    expect(parsePositiveInt('?limit=0', 'limit')).toBeUndefined()
    expect(parsePositiveInt('?limit=-1', 'limit')).toBeUndefined()
    expect(parsePositiveInt('?limit=abc', 'limit')).toBeUndefined()
    expect(parsePositiveInt('', 'limit')).toBeUndefined()
  })
})

describe('parsePromptMemoryTarget', () => {
  test('accepts soul/brief/user and rejects others', () => {
    expect(parsePromptMemoryTarget('?target=brief')).toBe('brief')
    expect(parsePromptMemoryTarget('?target=user')).toBe('user')
    expect(parsePromptMemoryTarget('?target=soul')).toBe('soul')
    expect(parsePromptMemoryTarget('?target=bad')).toBeUndefined()
    expect(parsePromptMemoryTarget('')).toBeUndefined()
  })
})

describe('response shaping', () => {
  test('health body reports mounted services', () => {
    expect(healthResponse({
      repository: true,
      environment: false,
      smartPruning: true,
      knowledge: false,
      sessionSearch: true,
      promptMemory: false,
      evolution: true,
      skillMemory: false,
    })).toEqual({
      status: 200,
      body: {
        ok: true,
        name: 'rin-web',
        version: '0.1.0',
        services: {
          repository: true,
          environment: false,
          smartPruning: true,
          knowledge: false,
          sessionSearch: true,
          promptMemory: false,
          evolution: true,
          skillMemory: false,
        },
      },
    })
  })
  test('error envelope', () => {
    expect(error(400, 'nope')).toEqual({ status: 400, body: { error: 'nope' } })
  })
  test('smart-pruning status, mounted and unmounted', () => {
    expect(smartPruningStatusResponse({ mounted: false })).toEqual({ status: 200, body: { mounted: false } })
    expect(smartPruningStatusResponse({ mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' })).toEqual({
      status: 200,
      body: { mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' },
    })
  })
  test('v2 mounted envelopes', () => {
    expect(notMounted()).toEqual({ status: 200, body: { mounted: false } })
    expect(mounted({ a: 1, b: 'x' })).toEqual({ status: 200, body: { mounted: true, a: 1, b: 'x' } })
    expect(mountedValue('sources', [{ id: 's1' }])).toEqual({
      status: 200,
      body: { mounted: true, sources: [{ id: 's1' }] },
    })
  })
  test('errorMessage coerces thrown values', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
  })
})
