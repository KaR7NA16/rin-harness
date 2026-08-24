import { describe, expect, test } from 'vitest'
import { handle } from '../../src/web-server/routes/notes.ts'

const config = { port: 8320, host: '127.0.0.1' }

function services(notes?: unknown) {
  return { notes: () => notes }
}

describe('notes routes', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/notes/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('root returns the service vault root', async () => {
    const res = await handle('/api/notes/root', '', 'GET', undefined, services({ vaultRoot: () => '/home/rin/.rin/notes' }), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, root: '/home/rin/.rin/notes' } })
  })

  test('list unmounted returns notMounted', async () => {
    const res = await handle('/api/notes', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list returns notes', async () => {
    const s = services({ async list() { return [{ path: 'a.md' }] } })
    const res = await handle('/api/notes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, notes: [{ path: 'a.md' }] } })
  })

  test('list failure returns 500', async () => {
    const s = services({ async list() { throw new Error('boom') } })
    const res = await handle('/api/notes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('read requires path', async () => {
    const res = await handle('/api/notes/read', '', 'GET', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'path is required; pass ?path=<note.md>' } })
  })

  test('read returns note', async () => {
    let path = ''
    const s = services({ async read(p: string) { path = p; return { content: 'hi' } } })
    const res = await handle('/api/notes/read', '?path=a.md', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, note: { content: 'hi' } } })
    expect(path).toBe('a.md')
  })

  test('properties GET/POST forwards to the service', async () => {
    let path = ''
    let props: Record<string, unknown> = {}
    const s = services({
      properties: async (p: string) => { path = p; return { tags: ['a'] } },
      updateProperties: async (p: string, next: Record<string, unknown>) => {
        path = p
        props = next
        return { content: '---\ntags: [a]\n---\n# Hi' }
      },
    })
    expect(await handle('/api/notes/properties', '?path=a.md', 'GET', undefined, s, config))
      .toEqual({ status: 200, body: { mounted: true, properties: { tags: ['a'] } } })
    expect(path).toBe('a.md')
    expect(await handle('/api/notes/properties', '', 'POST', { path: 'a.md', properties: { tags: ['b'] } }, s, config))
      .toEqual({ status: 200, body: { mounted: true, note: { content: '---\ntags: [a]\n---\n# Hi' } } })
    expect(props).toEqual({ tags: ['b'] })
  })

  test('properties requires path and a JSON object', async () => {
    const s = services({})
    expect(await handle('/api/notes/properties', '', 'GET', undefined, s, config)).toEqual({ status: 400, body: { error: 'path is required' } })
    expect(await handle('/api/notes/properties', '', 'POST', { path: 'a.md' }, s, config)).toEqual({ status: 400, body: { error: 'properties must be a JSON object' } })
  })

  test('read ENOENT returns 404', async () => {
    const s = services({ async read() { throw new Error('ENOENT: no such file') } })
    const res = await handle('/api/notes/read', '?path=a.md', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'note not found' } })
  })

  test('read other error returns 500', async () => {
    const s = services({ async read() { throw new Error('boom') } })
    const res = await handle('/api/notes/read', '?path=a.md', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('write requires path and content', async () => {
    const s = services({})
    expect(await handle('/api/notes/write', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'path is required' } })
    expect(await handle('/api/notes/write', '', 'POST', { path: 'a.md' }, s, config)).toEqual({ status: 400, body: { error: 'content is required' } })
  })

  test('write forwards to service', async () => {
    let args: string[] = []
    const s = services({ async write(p: string, c: string) { args = [p, c]; return { path: p } } })
    const res = await handle('/api/notes/write', '', 'POST', { path: 'a.md', content: 'body' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, note: { path: 'a.md' } } })
    expect(args).toEqual(['a.md', 'body'])
  })

  test('write wrong method returns 405', async () => {
    const res = await handle('/api/notes/write', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('delete forwards to service', async () => {
    let path = ''
    const s = services({ async delete(p: string) { path = p } })
    const res = await handle('/api/notes/delete', '', 'POST', { path: 'a.md' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, deleted: true } })
    expect(path).toBe('a.md')
  })

  test('delete requires path', async () => {
    const res = await handle('/api/notes/delete', '', 'POST', {}, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'path is required' } })
  })

  test('backup requires title and content', async () => {
    const s = services({})
    expect(await handle('/api/notes/backup', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'title is required' } })
    expect(await handle('/api/notes/backup', '', 'POST', { title: 't' }, s, config)).toEqual({ status: 400, body: { error: 'content is required' } })
  })

  test('backup forwards to service', async () => {
    let args: string[] = []
    const s = services({ async backupSession(t: string, c: string) { args = [t, c]; return { path: 'x' } } })
    const res = await handle('/api/notes/backup', '', 'POST', { title: 't', content: 'c' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, note: { path: 'x' } } })
    expect(args).toEqual(['t', 'c'])
  })
})
