#!/usr/bin/env node
/**
 * rin launcher — process entry.
 *
 * Boots the @rin/host host assembly on 8320 and prints its URL, then waits
 * until a signal or stdin end before disposing the host. The GUI desktop shell
 * spawns this launcher to own the host lifetime; `rin web` is the explicit
 * alias of the default. --url overrides the advertised URL so a shell that
 * reaches the host through a different address can read one canonical line.
 * There is no terminal frontend here — rin's interactive surface is the Web UI
 * (8320) and the future GUI shell.
 *
 * @module @rin/cli/bin
 */

import { runCli } from './cli.ts'

// Fail-loud: an uncaught launcher error is a configuration failure, not a
// silent exit; the message names the misconfiguration.
runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error('rin:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
