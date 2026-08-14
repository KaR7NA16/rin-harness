/**
 * @rin/cli — the rin launcher's programmatic surface.
 *
 * Re-exports the argument parser and the host assembly so a caller (the future
 * GUI desktop shell, or a test) can boot the @rin/bundle host in-process as the
 * "equivalent host assembly" without spawning the bin entry. src/bin.ts is the
 * CLI; this module is the library face.
 *
 * @module @rin/cli
 */

export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  parseArgs,
  USAGE,
  type RinArgs,
  type RinCommand,
} from './args.ts'
export { startHost, type RinHost } from './host.ts'
