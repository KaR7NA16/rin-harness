/**
 * Doc gate for workspace package READMEs: every package must carry a "Known
 * Limitations" section. This relaxes dsh's verbatim `## Known Limitations and
 * Deferred Work` heading + top-level bullet requirement
 * (scripts/verify-package-readme-limitations.ts) to "any limitations-like
 * heading", while reusing the shared Markdown heading parser so section
 * detection matches the rest of the repo.
 */

// Package documentation is mandatory for every canonical workspace package.
import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { markdownHeadingLines } from '../lib/markdown.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const manifestPatterns = ['apps/*/package.json', 'packages/*/*/package.json']

/** Whether a rendered heading reads as a limitations section. */
function isLimitationsLike(heading: string): boolean {
  return (
    /\blimitations?\b/i.test(heading)
    || /deferred work/i.test(heading)
    || /what is not here/i.test(heading)
    || /^non-goals?\b/i.test(heading)
  )
}

if (import.meta.main) {
  process.exitCode = main()
}

function main(): number {
  const manifests = globSync(manifestPatterns, { cwd: repoRoot })
    .map(path => path.split(sep).join('/'))
    .sort()
  const failures: string[] = []
  for (const manifestPath of manifests) {
    const pkg = manifestPath.slice(0, -'/package.json'.length)
    const readme = `${pkg}/README.md`
    if (!existsSync(resolve(repoRoot, readme))) {
      failures.push(`${readme}: package has no sibling README with a Known Limitations section`)
      continue
    }
    const headings = markdownHeadingLines(readFileSync(resolve(repoRoot, readme), 'utf8'))
    if (!headings.some(heading => isLimitationsLike(heading.text))) {
      failures.push(`${readme}: missing a Known Limitations section`)
    }
  }
  if (failures.length > 0) {
    console.error('verify-readme: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`verify-readme: ${manifests.length} workspace package READMEs have a Known Limitations section.`)
  return 0
}
