import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { readBinaryFile, readTextFile, statFile } from '../../src/filesystem/file.ts'

const root = mkdtempSync(join(tmpdir(), 'rin-filesystem-file-'))

afterAll(() => {
  // The files are small and test-owned; leaving the temp directory is harmless.
})

describe('filesystem file core', () => {
  test('stat reports file metadata and mime type', () => {
    const path = join(root, 'paper.pdf')
    writeFileSync(path, '%PDF-1.4 test')
    const stat = statFile(path)
    expect(stat.name).toBe('paper.pdf')
    expect(stat.isDirectory).toBe(false)
    expect(stat.sizeBytes).toBe(13)
    expect(stat.mimeType).toBe('application/pdf')
  })

  test('readText reads bounded content and marks truncation', () => {
    const path = join(root, 'note.txt')
    writeFileSync(path, 'hello world')
    const read = readTextFile(path, 5)
    expect(read.content).toBe('hello')
    expect(read.truncated).toBe(true)
    expect(read.mimeType).toBe('text/plain')
  })

  test('readBinary returns original bytes for PDFs', () => {
    const path = join(root, 'paper.pdf')
    writeFileSync(path, '%PDF-1.4 test')
    const read = readBinaryFile(path)
    expect(read.mimeType).toBe('application/pdf')
    expect(read.content.toString('utf8')).toBe('%PDF-1.4 test')
  })

  test('rejects directories and paths outside containment', () => {
    mkdirSync(join(root, 'folder'))
    expect(() => readTextFile(join(root, 'folder'))).toThrow(/Not a file/)
    expect(() => readTextFile('/etc/passwd')).toThrow(/Access denied/)
  })
})
