/**
 * rin web-server — notes routes.
 *
 * List/read plus write/delete/session-backup over ctx.notes. All @rin/notes
 * imports are type-only, so this module stays
 * runtime-dependency-free. Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  mountedValue,
  notMounted,
  queryParam,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the notes pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/notes/root':
      return notesRootRoute(services)
    case '/api/notes':
      return notesListRoute(services)
    case '/api/notes/read':
      return notesReadRoute(search, services)
    case '/api/notes/write':
      return notesWriteRoute(method, body, services)
    case '/api/notes/delete':
      return notesDeleteRoute(method, body, services)
    case '/api/notes/backup':
      return notesBackupRoute(method, body, services)
    default:
      return null
  }
}

async function notesRootRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  return mountedValue('root', notes.vaultRoot())
}

async function notesListRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  try {
    return mountedValue('notes', await notes.list())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesReadRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  const path = queryParam(search, 'path')
  if (path === undefined) return error(400, 'path is required; pass ?path=<note.md>')
  try {
    return mountedValue('note', await notes.read(path))
  } catch (err) {
    if (isMissingNoteError(err)) return error(404, 'note not found')
    return error(500, errorMessage(err))
  }
}

async function notesWriteRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/notes/write')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const path = stringField(fields, 'path')
  const content = stringField(fields, 'content')
  if (path === undefined || path.trim() === '') return error(400, 'path is required')
  if (content === undefined) return error(400, 'content is required')
  try {
    return mountedValue('note', await notes.write(path, content))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesDeleteRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/notes/delete')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const path = stringField(fields, 'path')
  if (path === undefined || path.trim() === '') return error(400, 'path is required')
  try {
    await notes.delete(path)
    return mountedValue('deleted', true)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function notesBackupRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const notes = services.notes()
  if (notes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/notes/backup')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const title = stringField(fields, 'title')
  const content = stringField(fields, 'content')
  if (title === undefined) return error(400, 'title is required')
  if (content === undefined) return error(400, 'content is required')
  try {
    return mountedValue('note', await notes.backupSession(title, content))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Whether a thrown value is a missing-file (ENOENT) error. */
function isMissingNoteError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('ENOENT')
}
