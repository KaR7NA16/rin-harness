/**
 * rin notes — strip-types smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/notes.smoke.ts
 *
 * Exercises the pure file engine (write/read/search/update/delete + snapshot)
 * and the `notes` tool schema without loading the Cordis runtime. The
 * `import type` in schema.ts is erased by type stripping, so this stays free
 * of dsh-* runtime imports.
 *
 * @module @rin/notes
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HISTORY_DIRNAME, NotesVault } from '../src/vault.ts'
import {
  NOTES_TOOL_NAME,
  notesToolOutputSchema,
  notesToolParameters,
  renderNotesResult,
} from '../src/schema.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

const root = await mkdtemp(join(tmpdir(), 'rin-notes-smoke-'))
try {
  const vault = new NotesVault(root)

  // write + read with parsed title/tags/links
  await vault.write('work/ideas.md', [
    '---',
    'tags: [project, idea]',
    '---',
    '# Big Idea',
    '',
    'See [[other]] for context.',
  ].join('\n'))
  const doc = await vault.read('work/ideas.md')
  check(doc.title === 'Big Idea', 'title parsed as first H1')
  check(doc.tags.join(',') === 'idea,project', 'frontmatter tags parsed: ' + doc.tags.join(','))
  check(doc.links.length === 1 && doc.links[0]?.target === 'other', 'wikilink parsed')
  check((await vault.list()).length === 1, 'one note listed')

  // update -> snapshot under .history
  await vault.write('work/ideas.md', '# Updated Idea\n')
  const snapshots = (await readdir(join(root, HISTORY_DIRNAME, 'work', 'ideas.md')))
    .filter(name => name.endsWith('.md'))
  check(snapshots.length === 1, 'update snapshots the previous content')

  // search ranking: name > title > body
  await vault.write('needles.md', '# First')
  await vault.write('t.md', '# Needles')
  await vault.write('c.md', '# Other\n\nThe haystack holds needles.')
  const results = await vault.search('needles')
  check(results.length === 3, 'three search hits')
  check(results[0]?.path === 'needles.md', 'name hit ranks first')
  check(results[1]?.path === 't.md', 'title hit ranks second')
  check(results[2]?.path === 'c.md', 'body hit ranks third')
  check(results[2]?.snippet?.includes('needles') === true, 'body hit has a snippet')

  // delete removes the note and its history
  await vault.delete('work/ideas.md')
  let missing = false
  try {
    await vault.read('work/ideas.md')
  } catch {
    missing = true
  }
  check(missing, 'delete removes the note')

  // assets: save + read with mime detection and sanitized names
  const saved = await vault.saveAsset('paste.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  check(saved.path.startsWith('assets/'), 'asset saved under assets/')
  check(saved.path.includes('-paste.png'), 'asset name carries timestamp and safe name')
  check(saved.url === '/api/notes/assets/' + saved.path, 'asset url served from /api/notes/assets')
  const asset = await vault.readAsset(saved.path)
  check(asset.mimeType === 'image/png', 'png mime detected')
  check(asset.content.length === 4 && asset.content[0] === 0x89, 'asset bytes round-trip')
  const sanitized = await vault.saveAsset('a/../../evil "name"?.txt', Buffer.from('x'))
  check(!sanitized.path.includes('..'), 'saveAsset sanitizes the file name')
  check((await vault.readAsset(sanitized.path)).mimeType === 'text/plain', 'txt mime detected')
  let assetTraversal = false
  try {
    await vault.readAsset('../escape.png')
  } catch {
    assetTraversal = true
  }
  check(assetTraversal, 'asset path traversal rejected')
  let nonAssetRejected = false
  try {
    await vault.readAsset('work/ideas.md')
  } catch {
    nonAssetRejected = true
  }
  check(nonAssetRejected, 'readAsset rejects non-asset paths')

  // tool schema smoke
  check(NOTES_TOOL_NAME === 'notes', 'tool name is notes')
  check(notesToolParameters.action.enum.join(',') === 'list,search,read', 'action enum')
  check(notesToolParameters.action.required === true, 'action required')
  check(notesToolOutputSchema.properties.action.type === 'string', 'output action is a string')
  check(notesToolOutputSchema.properties.document.properties.content.type === 'string', 'document content field')
  const listText = renderNotesResult({
    action: 'list',
    notes: [{ path: 'a.md', name: 'a', folder: '', title: 'A', tags: [], modifiedAt: 'now' }],
  })
  check(listText.includes('Listed 1 note(s)'), 'list render')
  const errorText = renderNotesResult({ action: 'search', error: 'query is required for the search action' })
  check(errorText.includes('failed'), 'error render')

  console.log('NOTES-SMOKE-OK', results.length, 'hits', snapshots.length, 'snapshot')
} finally {
  await rm(root, { recursive: true, force: true })
}
