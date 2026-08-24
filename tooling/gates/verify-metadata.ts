/** Verify public repository metadata does not contain release placeholders. */
import { globSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const forbiddenTokens = [
  'your-name/rin-harness',
  'your-domain.example',
  'security@your-domain.example',
  'conduct@your-domain.example',
  'REPLACE_ME',
]

function packageManifests(): string[] {
  return globSync([
    'apps/*/package.json',
    'packages/*/*/package.json',
  ], { cwd: repositoryRoot })
    .map(path => resolve(repositoryRoot, path))
    .sort()
}

const manifests = packageManifests()
const files = [
  join(repositoryRoot, 'README.md'),
  join(repositoryRoot, 'README.zh.md'),
  join(repositoryRoot, 'SECURITY.md'),
  join(repositoryRoot, 'CODE_OF_CONDUCT.md'),
  join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'),
  ...manifests,
]

const violations: string[] = []
for (const file of files) {
  const contents = readFileSync(file, 'utf8')
  for (const token of forbiddenTokens) {
    if (contents.includes(token)) {
      violations.push(relative(repositoryRoot, file) + ': ' + token)
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden pre-release metadata found:')
  for (const violation of violations) console.error('  ' + violation)
  process.exitCode = 1
} else {
  console.log('metadata check passed: ' + manifests.length + ' workspace package manifests checked')
}
