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
  isSmartPruningLevel,
  asRecord,
  stringField,
  booleanField,
  splitHostHeader,
  isAllowedHostHeader,
  isSameOrigin,
  extractBearerToken,
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
      filesystem: true,
      sessionBackup: false,
      smartPruning: true,
      knowledge: false,
      sessionSearch: true,
      promptMemory: false,
      evolution: true,
      skillMemory: false,
      agents: true,
      notes: true,
      sandboxes: false,
      tokenOptimization: true,
      codegraph: true,
      plugins: false,
      providerProbe: true,
      teams: false,
      tasks: true,
      mcp: false,
      computerUse: true,
      agentMigration: false,
    })).toEqual({
      status: 200,
      body: {
        ok: true,
        name: 'rin-web',
        version: '0.1.0',
        services: {
          repository: true,
          environment: false,
          filesystem: true,
          sessionBackup: false,
          smartPruning: true,
          knowledge: false,
          sessionSearch: true,
          promptMemory: false,
          evolution: true,
          skillMemory: false,
          agents: true,
          notes: true,
          sandboxes: false,
          tokenOptimization: true,
          codegraph: true,
          plugins: false,
          providerProbe: true,
          teams: false,
          tasks: true,
          mcp: false,
          computerUse: true,
          agentMigration: false,
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

describe('isSmartPruningLevel', () => {
  test('accepts the three levels and rejects everything else', () => {
    expect(isSmartPruningLevel('conservative')).toBe(true)
    expect(isSmartPruningLevel('balanced')).toBe(true)
    expect(isSmartPruningLevel('aggressive')).toBe(true)
    expect(isSmartPruningLevel('bogus')).toBe(false)
    expect(isSmartPruningLevel(1)).toBe(false)
    expect(isSmartPruningLevel(null)).toBe(false)
  })
})

describe('asRecord / stringField / booleanField', () => {
  test('asRecord narrows plain objects only', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
    expect(asRecord([1, 2])).toBeUndefined()
    expect(asRecord(null)).toBeUndefined()
    expect(asRecord('x')).toBeUndefined()
  })
  test('stringField and booleanField read typed values', () => {
    expect(stringField({ a: 'v' }, 'a')).toBe('v')
    expect(stringField({}, 'a')).toBeUndefined()
    expect(stringField({ a: 1 }, 'a')).toBeUndefined()
    expect(booleanField({ b: true }, 'b')).toBe(true)
    expect(booleanField({ b: 'yes' }, 'b')).toBeUndefined()
  })
})

describe('splitHostHeader', () => {
  test('parses host:port', () => {
    expect(splitHostHeader('127.0.0.1:8320')).toEqual({ hostname: '127.0.0.1', port: 8320 })
    expect(splitHostHeader('localhost:8320')).toEqual({ hostname: 'localhost', port: 8320 })
    expect(splitHostHeader('[::1]:8320')).toEqual({ hostname: '::1', port: 8320 })
  })
  test('parses hosts without a port', () => {
    expect(splitHostHeader('127.0.0.1')).toEqual({ hostname: '127.0.0.1', port: null })
    expect(splitHostHeader('localhost')).toEqual({ hostname: 'localhost', port: null })
    expect(splitHostHeader('[::1]')).toEqual({ hostname: '::1', port: null })
  })
  test('rejects malformed hosts', () => {
    expect(splitHostHeader('')).toBeNull()
    expect(splitHostHeader('[]')).toBeNull()
    expect(splitHostHeader('[::1')).toBeNull()
    expect(splitHostHeader('[::1]x')).toBeNull()
    expect(splitHostHeader('host:')).toBeNull()
    expect(splitHostHeader(':8320')).toBeNull()
    expect(splitHostHeader('127.0.0.1:99999')).toBeNull()
    expect(splitHostHeader('127.0.0.1:abc')).toBeNull()
    expect(splitHostHeader('::1')).toBeNull()
  })
})

describe('isAllowedHostHeader', () => {
  test('accepts loopback hosts on the bound port', () => {
    expect(isAllowedHostHeader('127.0.0.1:8320', 8320)).toBe(true)
    expect(isAllowedHostHeader('localhost:8320', 8320)).toBe(true)
    expect(isAllowedHostHeader('[::1]:8320', 8320)).toBe(true)
    expect(isAllowedHostHeader('LOCALHOST:8320', 8320)).toBe(true)
  })
  test('accepts loopback hosts without a port', () => {
    expect(isAllowedHostHeader('127.0.0.1', 8320)).toBe(true)
    expect(isAllowedHostHeader('localhost', 8320)).toBe(true)
  })
  test('rejects wrong port, non-loopback, missing, and malformed hosts', () => {
    expect(isAllowedHostHeader('127.0.0.1:9999', 8320)).toBe(false)
    expect(isAllowedHostHeader('evil.com:8320', 8320)).toBe(false)
    expect(isAllowedHostHeader('evil.com', 8320)).toBe(false)
    expect(isAllowedHostHeader(undefined, 8320)).toBe(false)
    expect(isAllowedHostHeader('', 8320)).toBe(false)
  })
})

describe('extractBearerToken', () => {
  test('reads the Authorization Bearer value', () => {
    expect(extractBearerToken('Bearer abc123', '')).toBe('abc123')
    expect(extractBearerToken('bearer abc123', '')).toBe('abc123')
  })
  test('falls back to ?token=', () => {
    expect(extractBearerToken(undefined, '?token=abc123')).toBe('abc123')
    expect(extractBearerToken('', '?token=abc123')).toBe('abc123')
  })
  test('prefers Authorization and rejects malformed values', () => {
    expect(extractBearerToken('Bearer header', '?token=query')).toBe('header')
    expect(extractBearerToken('Bearer', '?token=query')).toBe('query')
    expect(extractBearerToken('Basic abc', '')).toBeUndefined()
    expect(extractBearerToken(undefined, '')).toBeUndefined()
  })
})

describe('isSameOrigin', () => {
  test('accepts a matching origin', () => {
    expect(isSameOrigin('http://127.0.0.1:8320', '127.0.0.1:8320', 8320)).toBe(true)
    expect(isSameOrigin('http://localhost:8320', 'localhost:8320', 8320)).toBe(true)
  })
  test('rejects mismatched host, port, scheme, and null origins', () => {
    expect(isSameOrigin('http://evil.com:8320', '127.0.0.1:8320', 8320)).toBe(false)
    expect(isSameOrigin('http://127.0.0.1:9999', '127.0.0.1:8320', 8320)).toBe(false)
    expect(isSameOrigin('https://127.0.0.1:8320', '127.0.0.1:8320', 8320)).toBe(false)
    expect(isSameOrigin('null', '127.0.0.1:8320', 8320)).toBe(false)
    expect(isSameOrigin(undefined, '127.0.0.1:8320', 8320)).toBe(false)
  })
})
