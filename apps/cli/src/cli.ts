/** Testable command-line lifecycle for the rin launcher. */

import { parseArgs, USAGE } from './args.ts'
import { startHost, type HostOptions, type RinHost } from '@rin/host/launcher'

/** Launcher version, mirrored from package.json. */
export const VERSION = '0.1.0'

/** Minimal process surface used by the shutdown lifecycle. */
export interface CliProcess {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void
  stdin: { on(event: 'end', listener: () => void): void }
  exit(code: number): void
}

/** Injectable launcher dependencies used by contract tests and embedders. */
export interface CliRuntime {
  startHost(options: HostOptions): Promise<RinHost>
  log(message: string): void
  process: CliProcess
}

const defaultRuntime: CliRuntime = {
  startHost,
  log: message => { console.log(message) },
  process,
}

/** Wait until a signal or stdin end, then dispose the host exactly once. */
export function waitForShutdown(host: RinHost, cliProcess: CliProcess): void {
  let exiting = false
  const disposeAndExit = (code: number): void => {
    if (exiting) return
    exiting = true
    void host.close().finally(() => { cliProcess.exit(code) })
  }
  cliProcess.on('SIGINT', () => { disposeAndExit(130) })
  cliProcess.on('SIGTERM', () => { disposeAndExit(0) })
  cliProcess.stdin.on('end', () => { disposeAndExit(0) })
}

/** Parse one invocation and either print metadata or boot the host. */
export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime = defaultRuntime,
): Promise<void> {
  const args = parseArgs(argv)
  if (args.help) {
    runtime.log(USAGE)
    return
  }
  if (args.version) {
    runtime.log(`rin ${VERSION}`)
    return
  }

  const host = await runtime.startHost(args)
  const advertised = args.url ?? host.baseUrl
  runtime.log(`rin host on ${advertised}`)
  waitForShutdown(host, runtime.process)
}
