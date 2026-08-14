/**
 * rin web-server — static frontend serving.
 *
 * Serves files from the static root with path-traversal protection. The static/
 * directory is owned by the frontend package; this module only reads it and
 * returns null (→ 404) for anything missing.
 *
 * @module @rin/web-server
 */

import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

/** MIME types for the extensions the frontend emits. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Resolve a URL pathname to a file path under staticRoot.
 *
 * The root pathname "/" maps to web/index.html. Rejects traversal (".."),
 * backslash separators, and null bytes; returns null when the resolved path
 * would escape the static root.
 *
 * @param staticRoot - absolute path to the static frontend directory.
 * @param pathname - the decoded URL pathname (always starts with "/").
 * @returns the absolute file path, or null when unsafe or malformed.
 */
export function resolveStaticPath(staticRoot: string, pathname: string): string | null {
  if (pathname.includes('\0')) return null
  let relative: string
  try {
    relative = decodeURIComponent(pathname)
  } catch {
    return null
  }
  relative = relative.replace(/^\/+/, '')
  if (relative === '') relative = 'index.html'
  if (relative.includes('\\') || relative.includes('\0')) return null
  const segments = relative.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  const root = resolve(staticRoot)
  const full = resolve(root, relative)
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

/** Map a file path to a Content-Type header value. */
export function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** A static file ready to write to the response. */
export interface StaticFile {
  content: Buffer
  contentType: string
}

/**
 * Read a static file, or null when the path is unsafe or the file is missing.
 * @param staticRoot - absolute path to the static frontend directory.
 * @param pathname - the decoded URL pathname.
 * @returns the file content and content type, or null.
 */
export async function readStaticFile(
  staticRoot: string,
  pathname: string,
): Promise<StaticFile | null> {
  const filePath = resolveStaticPath(staticRoot, pathname)
  if (filePath === null) return null
  try {
    const content = await readFile(filePath)
    return { content, contentType: contentTypeFor(filePath) }
  } catch {
    return null
  }
}
