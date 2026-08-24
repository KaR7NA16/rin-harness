/**
 * rin filesystem — path-contained file reading core.
 *
 * Provides stat, bounded text reads, and binary reads for files inside the
 * same containment roots as browse. Cordis-free: node: builtins only.
 *
 * @module @rin/workspace/filesystem
 */

import { readFileSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { assertAllowedPath } from './browse.ts'

export const DEFAULT_TEXT_READ_BYTES = 256 * 1024
export const MAX_TEXT_READ_BYTES = 4 * 1024 * 1024

/** Metadata for one file or directory. */
export interface FileStat {
  path: string
  name: string
  isDirectory: boolean
  sizeBytes: number
  /** Unix epoch milliseconds. */
  modifiedAt: number
  mimeType: string
}

/** A bounded UTF-8 file read. */
export interface TextFileRead {
  path: string
  content: string
  truncated: boolean
  sizeBytes: number
  mimeType: string
}

/** A raw binary file read. */
export interface BinaryFileRead {
  path: string
  content: Buffer
  sizeBytes: number
  mimeType: string
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  rs: 'text/x-rust',
  go: 'text/x-go',
  java: 'text/x-java',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  xml: 'application/xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
  gz: 'application/gzip',
  wasm: 'application/wasm',
}

/** Derive a mime type from a file name. */
export function mimeTypeForPath(path: string): string {
  const extension = extname(path).slice(1).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/** Resolve and validate one path, returning its canonical absolute form. */
export function resolveAllowedFile(path: string): string {
  return assertAllowedPath(resolve(path))
}

/** Read metadata for one contained path (directory or file). */
export function statFile(path: string): FileStat {
  const resolved = assertAllowedPath(resolve(path))
  const stat = statSync(resolved)
  return {
    path: resolved,
    name: basename(resolved),
    isDirectory: stat.isDirectory(),
    sizeBytes: stat.size,
    modifiedAt: stat.mtimeMs,
    mimeType: stat.isDirectory() ? 'inode/directory' : mimeTypeForPath(resolved),
  }
}

/**
 * Read a text file with a bounded byte budget.
 *
 * @param path - the path to read.
 * @param maxBytes - optional read budget, clamped to [1, MAX_TEXT_READ_BYTES].
 * @returns the decoded content and whether the file was truncated.
 */
export function readTextFile(path: string, maxBytes = DEFAULT_TEXT_READ_BYTES): TextFileRead {
  const resolved = assertAllowedPath(resolve(path))
  const stat = statSync(resolved)
  if (stat.isDirectory()) throw new Error('Not a file')
  const budget = Math.min(Math.max(Math.trunc(maxBytes), 1), MAX_TEXT_READ_BYTES)
  const truncated = stat.size > budget
  const content = readFileSync(resolved, { encoding: 'utf8', flag: 'r' }).slice(0, budget)
  return {
    path: resolved,
    content,
    truncated,
    sizeBytes: stat.size,
    mimeType: mimeTypeForPath(resolved),
  }
}

/** Read one contained file as raw bytes. */
export function readBinaryFile(path: string): BinaryFileRead {
  const resolved = assertAllowedPath(resolve(path))
  const stat = statSync(resolved)
  if (stat.isDirectory()) throw new Error('Not a file')
  const content = readFileSync(resolved)
  return {
    path: resolved,
    content,
    sizeBytes: stat.size,
    mimeType: mimeTypeForPath(resolved),
  }
}
