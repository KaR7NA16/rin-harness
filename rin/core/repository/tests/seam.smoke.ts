/**
 * rin repository — strip-types smoke test for the seam-projected tools.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 *
 * Builds the two tool definitions and fake-registers them on a minimal
 * registry, then exercises the browse logic against the real built-in
 * repository. The `import type` in tools.ts is erased by type stripping, so
 * this stays free of dsh-* runtime imports.
 *
 * @module @rin/repository
 */

import { fileURLToPath } from 'node:url'
import { readAssetRepository } from '../src/reader.ts'
import {
  buildRepositoryTools,
  REPOSITORY_READ_TOOL_NAME,
  REPOSITORY_SEARCH_TOOL_NAME,
} from '../src/tools.ts'
import {
  clampSearchLimit,
  readRepositoryAsset,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  searchRepository,
} from '../src/browse.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition, message) {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

const builtinRoot = fileURLToPath(new URL('../builtin/', import.meta.url))

// 1. Fake tools registry: both tools register with the expected names.
const registered = []
const registry = {
  register(tool) {
    registered.push(tool)
    return () => {}
  },
}
const [searchTool, readTool] = buildRepositoryTools(() => readAssetRepository(builtinRoot))
registry.register(searchTool)
registry.register(readTool)
check(registered.length === 2, 'two tools registered, got ' + registered.length)
check(registered[0].name === REPOSITORY_SEARCH_TOOL_NAME, 'first tool is repository_search')
check(registered[1].name === REPOSITORY_READ_TOOL_NAME, 'second tool is repository_read')
check(searchTool.name === REPOSITORY_SEARCH_TOOL_NAME, 'search tool name')
check(readTool.name === REPOSITORY_READ_TOOL_NAME, 'read tool name')

// 2. repository_search over the real built-in repository.
const repo = await readAssetRepository(builtinRoot)
const search = searchRepository(repo, { category: 'environments', query: 'scientific' })
check(!('error' in search), 'search returned an error')
if (!('error' in search)) {
  check(search.results.some(hit => hit.name === 'scientific-base'), 'scientific-base found by search')
  check(search.results[0].path.endsWith('scientific-base.environment.yaml'), 'scientific-base path present')
  check(search.results[0].category === 'environments', 'hit category is environments')
}

const all = searchRepository(repo, {})
check(!('error' in all), 'unfiltered search errored')
if (!('error' in all)) {
  check(all.results.some(hit => hit.category === 'agents' && hit.name === 'rin-base'), 'rin-base agent listed')
  check(all.results.some(hit => hit.category === 'environments' && hit.name === 'scientific-base'), 'scientific-base profile listed')
}

// 3. repository_read over the real built-in repository.
const read = readRepositoryAsset(repo, 'environments', 'scientific-base')
check(!('error' in read), 'read returned an error')
if (!('error' in read)) {
  check(read.frontmatter.kind === 'EnvironmentProfile', 'profile kind')
  check(read.frontmatter.id === 'scientific-base', 'profile id')
  check(read.body.includes('python-numpy'), 'profile body lists python-numpy')
  check(read.truncated === false, 'profile body not truncated')
  check(read.path.endsWith('scientific-base.environment.yaml'), 'profile path present')
}

const agentRead = readRepositoryAsset(repo, 'agents', 'rin-base')
check(!('error' in agentRead), 'agent read errored')
if (!('error' in agentRead)) {
  check(agentRead.frontmatter.kind === 'AgentConfiguration', 'agent kind')
  check(agentRead.body.includes('scientific-base'), 'agent body references scientific-base')
}

// 4. Error branches and limit clamp.
check('error' in searchRepository(repo, { category: 'bogus' }), 'bogus category rejected')
check('error' in readRepositoryAsset(repo, 'skills', 'x'), 'unreadable category rejected')
check('error' in readRepositoryAsset(repo, 'environments', 'does-not-exist'), 'missing profile rejected')
check(clampSearchLimit(undefined) === SEARCH_LIMIT_DEFAULT, 'default limit')
check(clampSearchLimit(0) === 1, 'lower clamp')
check(clampSearchLimit(9999) === SEARCH_LIMIT_MAX, 'upper clamp')

console.log('SEAM-SMOKE-OK', registered.length, 'tools', repo.environmentProfiles.length, 'profiles')
