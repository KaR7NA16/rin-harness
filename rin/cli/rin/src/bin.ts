/**
 * rin launcher — process entry.
 *
 * Boots the @rin/bundle host assembly on 8320 and prints its URL, then waits
 * until a signal or stdin end before disposing the host. The GUI desktop shell
 * spawns this launcher to own the host lifetime; `rin web` is the explicit
 * alias of the default. --url overrides the advertised URL so a shell that
 * reaches the host through a different address can read one canonical line.
 * There is no terminal frontend here — rin's interactive surface is the Web UI
 * (8320) and the future GUI shell.
 *
 * @module @rin/cli/bin
 */

import { parseArgs, USAGE } from './args.ts'
import { startHost, type RinHost } from './host.ts'

/** Launcher version, mirrored from package.json. */
const VERSION = '0.1.0'

/** Wait until a signal or stdin end, then dispose the host. */
function waitForShutdown(host: RinHost): void {
  let exiting = false
  const disposeAndExit = (code: number): void => {
    if (exiting) return
    exiting = true
    void host.close().finally(() => { process.exit(code) })
  }
  process.on('SIGINT', () => { disposeAndExit(130) })
  process.on('SIGTERM', () => { disposeAndExit(0) })
  process.stdin.on('end', () => { disposeAndExit(0) })
}

/** Boot the host, print its URL, and hand process lifetime to signals. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  if (args.version) {
    console.log(`rin ${VERSION}`)
    return
  }

  const host = await startHost(args)
  const advertised = args.url ?? host.baseUrl
  console.log(`rin host on ${advertised}`)
  waitForShutdown(host)
}

// Fail-loud: an uncaught launcher error is a configuration failure, not a
// silent exit; the message names the misconfiguration.
main().catch((error: unknown) => {
  console.error('rin:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
