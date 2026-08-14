/**
 * rin web-server — strip-types smoke script.
 *
 * Exercises the pure HTTP helpers and static-path resolution without importing
 * cordis. Run with:
 *
 *   node --experimental-strip-types tests/smoke.ts
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { join, resolve as resolvePath } from 'node:path'
import {
  RIN_WEB_NAME,
  RIN_WEB_VERSION,
  parseBoolean,
  parseRepositoryQuery,
  parseEnvironmentPlanQuery,
  healthResponse,
  error,
  smartPruningStatusResponse,
  errorMessage,
} from '../src/http.ts'
import { resolveStaticPath } from '../src/static.ts'

let failures = 0
function expect(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log('PASS ' + label)
  } catch (err) {
    failures += 1
    console.error('FAIL ' + label)
    console.error('  expected:', inspect(expected))
    console.error('  actual:  ', inspect(actual))
  }
}

// product identity
expect('RIN_WEB_NAME', RIN_WEB_NAME, 'rin-web')
expect('RIN_WEB_VERSION', RIN_WEB_VERSION, '0.1.0')

// parseBoolean
expect('parseBoolean "true"', parseBoolean('true'), true)
expect('parseBoolean "TRUE"', parseBoolean('TRUE'), true)
expect('parseBoolean "1"', parseBoolean('1'), true)
expect('parseBoolean "yes"', parseBoolean('yes'), true)
expect('parseBoolean "on"', parseBoolean('on'), true)
expect('parseBoolean "false"', parseBoolean('false'), false)
expect('parseBoolean "0"', parseBoolean('0'), false)
expect('parseBoolean "no"', parseBoolean('no'), false)
expect('parseBoolean ""', parseBoolean(''), false)
expect('parseBoolean null', parseBoolean(null), false)

// parseRepositoryQuery
expect('parseRepositoryQuery root', parseRepositoryQuery('?root=C%3A%5Cfoo'), { root: 'C:\\foo' })
expect('parseRepositoryQuery empty', parseRepositoryQuery(''), { root: undefined })
expect('parseRepositoryQuery blank root', parseRepositoryQuery('?root='), { root: undefined })

// parseEnvironmentPlanQuery
expect('parseEnvironmentPlanQuery full', parseEnvironmentPlanQuery(
  '?profile=p1&root=r1&platform=linux&apt=true&python=1&pip=yes&r=on&npm=false&tlmgr=true',
  'win32',
), {
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
expect('parseEnvironmentPlanQuery defaults', parseEnvironmentPlanQuery('', 'darwin'), {
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

// response shaping
expect('healthResponse', healthResponse({ repository: true, environment: true, smartPruning: false }), {
  status: 200,
  body: {
    ok: true,
    name: 'rin-web',
    version: '0.1.0',
    services: { repository: true, environment: true, smartPruning: false },
  },
})
expect('error envelope', error(400, 'repository root not configured; pass ?root='), {
  status: 400,
  body: { error: 'repository root not configured; pass ?root=' },
})
expect('smart-pruning not mounted', smartPruningStatusResponse({ mounted: false }), {
  status: 200,
  body: { mounted: false },
})
expect('smart-pruning mounted', smartPruningStatusResponse({ mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' }), {
  status: 200,
  body: { mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' },
})
expect('errorMessage Error', errorMessage(new Error('boom')), 'boom')
expect('errorMessage string', errorMessage('plain'), 'plain')

// static path resolution
const root = resolvePath('smoke-web-root')
expect('static index', resolveStaticPath(root, '/'), join(root, 'index.html'))
expect('static nested', resolveStaticPath(root, '/assets/app.js'), join(root, 'assets', 'app.js'))
expect('static traversal', resolveStaticPath(root, '/../secret.txt'), null)
expect('static nested traversal', resolveStaticPath(root, '/a/../../b'), null)
expect('static encoded traversal', resolveStaticPath(root, '/%2e%2e/secret.txt'), null)
expect('static encoded backslash', resolveStaticPath(root, '/a%5Cb'), null)
expect('static encoded null byte', resolveStaticPath(root, '/a%00b'), null)
expect('static dot segment', resolveStaticPath(root, '/a/./b'), null)
expect('static empty segment', resolveStaticPath(root, '/a//b'), null)

console.log('')
console.log('sample health body:', inspect(healthResponse({ repository: true, environment: false, smartPruning: true }).body))

if (failures > 0) {
  console.error('smoke: ' + failures + ' failure(s)')
  process.exitCode = 1
} else {
  console.log('smoke: all assertions passed')
}
