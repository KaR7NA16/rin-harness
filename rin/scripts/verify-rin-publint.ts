/**
 * Publint gate for rin: run publint over the @rin/* library packages' exact
 * manifest-declared publication view and fail on any error. The gui/web-ui
 * product layer is excluded — it publishes no npm entry points.
 *
 * Reuses the root publint-all runner's rin-scoped discovery and lint, so the
 * publication view (files + npm's always-published set) stays in one place.
 *
 * Run: node --import tsx/esm rin/scripts/verify-rin-publint.ts
 */
import { resolve } from 'node:path'
import { printResult, publintTargets, rinWorkspacePackages } from '../../scripts/publint-all.ts'

const repoRoot = resolve(import.meta.dirname, '../..')

if (import.meta.main) {
  process.exitCode = await main()
}

async function main(): Promise<number> {
  const targets = rinWorkspacePackages(repoRoot)
  const results = await publintTargets(targets)
  for (const result of results) printResult(result)
  const failed = results.filter(result => result.status === 'failed').length
  if (failed > 0) {
    console.error(`verify-rin-publint: ${failed} rin package(s) failed publint.`)
    return 1
  }
  console.log(`verify-rin-publint: ${results.length} rin package(s) pass publint.`)
  return 0
}
