/**
 * rin notes — file vault contract tests.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test is run
 * during development.
 *
 * @module @rin/notes
 */

import { afterEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesVault } from '../src/vault.ts'

const cleanups: string[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createVault(): Promise<{ root: string; vault: NotesVault }> {
  const root = await mkdtemp(join(tmpdir(), 'rin-notes-'))
  cleanups.push(root)
  return { root, vault: new NotesVault(root) }
}

describe('NotesVault write/read/list', () => {
  test('round-trips a note with parsed title, tags, and links', async () => {
    const { vault } = await createVault()
    await vault.write('work/ideas.md', [
      '---',
      'tags: [project, idea]',
      '---',
      '# Big Idea',
      '',
      'See [[other]] for context.',
    ].join('\n'))

    const doc = await vault.read('work/ideas.md')
    expect(doc.path).toBe('work/ideas.md')
    expect(doc.name).toBe('ideas')
    expect(doc.folder).toBe('work')
    expect(doc.title).toBe('Big Idea')
    expect(doc.tags).toEqual(['idea', 'project'])
    expect(doc.links).toEqual([{ raw: '[[other]]', target: 'other' }])
    expect(doc.content).toContain('# Big Idea')

    const list = await vault.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.path).toBe('work/ideas.md')
  })

  test('lists notes newest-first and skips internal directories', async () => {
    const { root, vault } = await createVault()
    await vault.write('a.md', '# A')
    await vault.write('b.md', '# B')
    await mkdir(join(root, '.history'), { recursive: true })
    await writeFile(join(root, '.history', 'stale.md'), 'ignored')
    await mkdir(join(root, 'backups'), { recursive: true })
    await writeFile(join(root, 'backups', 'session.md'), '# Session')
    await mkdir(join(root, '.templates'), { recursive: true })
    await writeFile(join(root, '.templates', 'daily.md'), '# Daily')

    const list = await vault.list()
    expect(list.map(note => note.path).sort()).toEqual(['a.md', 'b.md'])
  })

  test('rejects a note over the 4 MiB limit', async () => {
    const { vault } = await createVault()
    await expect(vault.write('big.md', '# Big\n' + 'x'.repeat(4 * 1024 * 1024))).rejects.toThrow(/4 MiB/)
  })
})

describe('path containment', () => {
  test('rejects upward traversal on read and write', async () => {
    const { vault } = await createVault()
    await expect(vault.read('../outside.md')).rejects.toThrow(/escapes the vault/)
    await expect(vault.write('a/../../escape.md', '# x')).rejects.toThrow(/escapes the vault/)
  })

  test('rejects an absolute path', async () => {
    const { vault } = await createVault()
    await expect(vault.read('/etc/passwd.md')).rejects.toThrow(/absolute/)
  })
})

describe('frontmatter properties', () => {
  test('reads absent properties as null and updates while preserving the body', async () => {
    const { vault } = await createVault()
    await vault.write('note.md', '# Title\n\nBody stays.\n')

    expect(await vault.properties('note.md')).toBeNull()

    const updated = await vault.updateProperties('note.md', { title: 'Titled', tags: ['a', 'b'] })
    expect(updated.content.startsWith('---\n')).toBe(true)
    expect(updated.content).toContain('# Title\n\nBody stays.\n')
    expect(await vault.properties('note.md')).toEqual({ title: 'Titled', tags: ['a', 'b'] })
  })
})

describe('tag rename', () => {
  test('renames frontmatter and inline tags without changing fenced code', async () => {
    const { vault } = await createVault()
    await vault.write('note.md', [
      '---',
      'tags: [old, keep]',
      'custom: value',
      '---',
      '# Note',
      '',
      '#old #keep',
      '',
      '~~~md',
      '#old',
      '~~~',
    ].join('\n'))

    const result = await vault.renameTag('#old', '#new')
    expect(result).toEqual({ renamed: 1, paths: ['note.md'] })
    const document = await vault.read('note.md')
    expect(document.content).toContain('tags:\n  - new\n  - keep')
    expect(document.content).toContain('custom: value')
    expect(document.content).toContain('#new #keep')
    expect(document.content).toContain('~~~md\n#old\n~~~')
    expect(await vault.listSnapshots('note.md')).toHaveLength(1)
  })

  test('rejects invalid tag names', async () => {
    const { vault } = await createVault()
    await expect(vault.renameTag('old', 'bad tag')).rejects.toThrow(/tag names/)
  })
})
describe('history snapshots', () => {
  test('keeps the latest 10 snapshots and prunes the oldest', async () => {
    const { root, vault } = await createVault()
    await vault.write('note.md', '# v0')
    for (let i = 1; i <= 12; i++) await vault.write('note.md', '# v' + i)

    const historyDir = join(root, '.history', 'note.md')
    const snapshots = (await readdir(historyDir)).filter(name => name.endsWith('.md'))
    expect(snapshots).toHaveLength(10)
    // The first snapshot must be the oldest version still retained.
    const oldest = snapshots.sort()[0]!
    expect(await readFile(join(historyDir, oldest), 'utf8')).toBe('# v2')
  })

  test('delete removes the note and its snapshots', async () => {
    const { root, vault } = await createVault()
    await vault.write('note.md', '# v0')
    await vault.write('note.md', '# v1')

    await vault.delete('note.md')
    await expect(vault.read('note.md')).rejects.toThrow()
    const historyDir = join(root, '.history', 'note.md')
    await expect(readdir(historyDir)).rejects.toThrow()
  })
})

describe('search', () => {
  test('ranks name hits above title hits above body hits', async () => {
    const { vault } = await createVault()
    await vault.write('needles.md', '# First')
    await vault.write('t.md', '# Needles')
    await vault.write('c.md', '# Other\n\nThe haystack holds needles today.')

    const results = await vault.search('needles')
    expect(results.map(result => result.path)).toEqual(['needles.md', 't.md', 'c.md'])
    expect(results[0]?.score).toBe(3)
    expect(results[1]?.score).toBe(2)
    expect(results[2]?.score).toBe(1)
    expect(results[2]?.snippet).toContain('needles')
  })

  test('returns nothing for a blank query', async () => {
    const { vault } = await createVault()
    await vault.write('a.md', '# A')
    expect(await vault.search('   ')).toEqual([])
  })
})

describe('graph and todos and templates', () => {
  test('resolves wikilink edges between notes', async () => {
    const { vault } = await createVault()
    await vault.write('a.md', '# A\n\nLink to [[b]].')
    await vault.write('b.md', '# B')

    const graph = await vault.graph()
    expect(graph.nodes.map(node => node.id).sort()).toEqual(['a.md', 'b.md'])
    expect(graph.edges).toEqual([{ from: 'a.md', to: 'b.md' }])
  })

  test('extracts line-level checkboxes, unfinished first', async () => {
    const { vault } = await createVault()
    await vault.write('t.md', '# T\n\n- [ ] todo one\n- [x] done one\n- [ ] todo two\n')

    const todos = await vault.todos()
    expect(todos.map(todo => todo.text)).toEqual(['todo one', 'todo two', 'done one'])
    expect(todos[2]?.done).toBe(true)
    expect(todos[0]?.line).toBe(3)
  })

  test('lists templates under .templates', async () => {
    const { root, vault } = await createVault()
    await mkdir(join(root, '.templates'), { recursive: true })
    await writeFile(join(root, '.templates', 'meeting.md'), '# Meeting')
    await writeFile(join(root, '.templates', 'daily.md'), '# Daily')

    expect(await vault.templates()).toEqual([
      { name: 'daily', path: '.templates/daily.md' },
      { name: 'meeting', path: '.templates/meeting.md' },
    ])
  })
})

describe('backupSession', () => {
  test('writes a titled backup note under backups/', async () => {
    const { vault } = await createVault()
    const doc = await vault.backupSession('My Session', 'transcript body')

    expect(doc.path.startsWith('backups/')).toBe(true)
    expect(doc.title).toBe('My Session')
    expect(doc.content).toBe('# My Session\n\ntranscript body')
    // Backups are not regular notes.
    expect(await vault.list()).toEqual([])
  })
})

describe('assets', () => {
  test('saveAsset writes a timestamped file under assets/ and returns path + url', async () => {
    const { root, vault } = await createVault()
    const saved = await vault.saveAsset('photo.png', Buffer.from('png-bytes'))

    expect(saved.path).toMatch(/^assets\/\d+-photo\.png$/)
    expect(saved.url).toBe('/api/notes/assets/' + saved.path)
    expect(await readFile(join(root, saved.path), 'utf8')).toBe('png-bytes')
  })

  test('saveAsset sanitizes the file name and keeps the extension', async () => {
    const { root, vault } = await createVault()
    const saved = await vault.saveAsset('a/../../evil "name"?.txt', Buffer.from('x'))

    expect(saved.path.startsWith('assets/')).toBe(true)
    expect(saved.path).not.toContain('..')
    expect(saved.path.endsWith('.txt')).toBe(true)
    expect(await readFile(join(root, saved.path), 'utf8')).toBe('x')
  })

  test('readAsset returns the bytes and the extension-derived mime type', async () => {
    const { vault } = await createVault()
    const saved = await vault.saveAsset('note.md', Buffer.from('# asset'))

    const asset = await vault.readAsset(saved.path)
    expect(asset.content.toString('utf8')).toBe('# asset')
    expect(asset.mimeType).toBe('text/markdown')
    expect(await vault.readAsset(saved.path)).toEqual(asset)
  })

  test('PDF assets keep application/pdf mime and their original bytes', async () => {
    const { vault } = await createVault()
    const pdf = Buffer.from('%PDF-1.4 notes-test')
    const saved = await vault.saveAsset('research/paper.pdf', pdf)

    expect(saved.path).toMatch(/^assets\/\d+-paper\.pdf$/)
    const asset = await vault.readAsset(saved.path)
    expect(asset.mimeType).toBe('application/pdf')
    expect(asset.content.equals(pdf)).toBe(true)
  })

  test('readAsset rejects traversal and non-asset paths', async () => {
    const { vault } = await createVault()
    await vault.write('note.md', '# n')

    await expect(vault.readAsset('../escape.png')).rejects.toThrow(/escapes the vault/)
    await expect(vault.readAsset('note.md')).rejects.toThrow(/assets/)
  })

  test('assets are not listed as notes', async () => {
    const { vault } = await createVault()
    await vault.saveAsset('image.png', Buffer.from('x'))

    expect(await vault.list()).toEqual([])
  })
})
