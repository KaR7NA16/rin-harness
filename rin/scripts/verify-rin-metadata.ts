import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const rinRoot = join(repositoryRoot, 'rin')
const forbiddenTokens = [
  'your-name/rin-harness',
  'your-domain.example',
  'security@your-domain.example',
  'conduct@your-domain.example',
  'REPLACE_ME',
]

function packageManifests(): string[] {
  const manifests: string[] = []
  for (const group of readdirSync(rinRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupRoot = join(rinRoot, group.name)
    for (const pkg of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const manifest = join(groupRoot, pkg.name, 'package.json')
      try {
        readFileSync(manifest)
        manifests.push(manifest)
      } catch {
        // A group entry without a manifest is not a package.
      }
    }
  }
  return manifests.sort()
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
  console.log('rin metadata check passed: ' + manifests.length + ' package manifests checked')
}
