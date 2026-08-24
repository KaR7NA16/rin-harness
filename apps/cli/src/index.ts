/**
 * @rin/cli — the rin launcher's programmatic surface.
 *
 * Re-exports the argument parser and the host assembly so a caller (the future
 * GUI desktop shell, or a test) can boot the @rin/host host in-process as the
 * "equivalent host assembly" without spawning the bin entry. src/bin.ts is the
 * CLI; this module is the library face.
 *
 * @module @rin/cli
 */

export {
  parseArgs,
  USAGE,
  type RinArgs,
  type RinCommand,
} from './args.ts'
export {
  runCli,
  waitForShutdown,
  VERSION,
  type CliProcess,
  type CliRuntime,
} from './cli.ts'
export { startHost, type HostOptions, type RinHost } from '@rin/host/launcher'
