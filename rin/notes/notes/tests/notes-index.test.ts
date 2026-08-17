import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { NotesIndex } from '../src/notes-index.ts'
import { NotesVault } from '../src/vault.ts'

const cleanups: string[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createVault() {
  const root = await mkdtemp(join(tmpdir(), 'rin-notes-index-'))
  cleanups.push(root)
  const vault = new NotesVault(root)
  return { root, vault, index: new NotesIndex(root) }
}

describe('NotesIndex', () => {
  test('indexes notes, headings, blocks, tasks, tags, and links', async () => {
    const { root, index } = await createVault()
    await writeFile(join(root, 'a.md'), [
      '---',
      'title: Alpha',
      'tags: [project, idea]',
      'aliases: [A]',
      '---',
      '# Heading One',
      'Body ^block-one',
      '- [ ] todo item',
      'See [[b]] and [[missing]].',
    ].join('\n'))
    await writeFile(join(root, 'b.md'), '# Beta\n\nLinked from [[a]].\n')

    expect(index.rebuild()).toBe(2)
    expect(index.search('Heading')).toHaveLength(1)
    expect(index.search('project')).toHaveLength(1)
    expect(index.headings('a.md')).toEqual([{ notePath: 'a.md', line: 6, level: 1, text: 'Heading One', slug: 'heading-one' }])
    expect(index.blocks('a.md')).toEqual([{ notePath: 'a.md', blockId: 'block-one', line: 7, text: 'Body' }])
    expect(index.todos()).toEqual([{ notePath: 'a.md', noteName: 'a', line: 8, text: 'todo item', done: false }])
    expect(index.graph().edges).toEqual([
      { from: 'a.md', to: 'b.md' },
      { from: 'b.md', to: 'a.md' },
    ])
    expect(index.backlinks('a.md')).toEqual([{ path: 'b.md', name: 'b', folder: '', title: 'Beta' }])
  })

  test('refreshes when a note mtime changes', async () => {
    const { root, index } = await createVault()
    await writeFile(join(root, 'a.md'), '# One')
    index.rebuild()
    expect(index.search('One')).toHaveLength(1)

    await writeFile(join(root, 'a.md'), '# One\n\nnewtoken')
    expect(index.refresh()).toBe(1)
    expect(index.search('newtoken')).toHaveLength(1)
  })

  test('scales to a few hundred indexed notes', async () => {
    const { root, index } = await createVault()
    await Promise.all(Array.from({ length: 200 }, (_, i) =>
      writeFile(join(root, `note-${i}.md`), `# Note ${i}\n\ntoken-${i} [[note-${(i + 1) % 200}]]`),
    ))
    const started = Date.now()
    expect(index.rebuild()).toBe(200)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(index.search('token-123')).toEqual([expect.objectContaining({ path: 'note-123.md' })])
    expect(index.graph().nodes).toHaveLength(200)
  })

  test('vault search/graph/todos delegate to the index', async () => {
    const { vault } = await createVault()
    await vault.write('a.md', '# Apple\n\n- [ ] indexed task\n\n[[b]]')
    await vault.write('b.md', '# Banana')

    expect((await vault.search('indexed')).map(hit => hit.path)).toEqual(['a.md'])
    expect((await vault.graph()).edges).toEqual([{ from: 'a.md', to: 'b.md' }])
    expect(await vault.todos()).toEqual([{ notePath: 'a.md', noteName: 'a', line: 3, text: 'indexed task', done: false }])
  })
})
