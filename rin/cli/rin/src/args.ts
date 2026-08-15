/**
 * rin launcher — command-line argument parsing.
 *
 * Pure argv parsing shared by the bin entry and the tests: it maps the
 * positional command (none / web) and the flags (--port/--host/--url/--version/
 * --help) onto a typed result without touching process state, so every branch
 * is unit-testable and strip-types-smoke-testable. Both commands boot the
 * @rin/bundle host; `web` is an explicit alias of the default.
 *
 * @module @rin/cli/args
 */

/** The invocation modes the launcher supports (both boot the host). */
export type RinCommand = 'default' | 'web'

/** Parsed launcher arguments. */
export interface RinArgs {
  /** The positional command; 'default' and 'web' are equivalent. */
  command: RinCommand
  /** Web-server listen port (from --port). */
  port?: number
  /** Web-server listen host (from --host). */
  host?: string
  /** Base URL to advertise (from --url); overrides the derived http://host:port. */
  url?: string
  /** Print usage and exit without booting. */
  help: boolean
  /** Print the version and exit without booting. */
  version: boolean
}

/** Usage text printed by --help and by a malformed invocation. */
export const USAGE = `usage: rin [web] [--port <n>] [--host <h>] [--url <u>] [--version] [--help]

  rin          boot the @rin/bundle host on 8320 and print its URL
  rin web      alias of the default
  --url <u>    advertise this URL instead of http://host:port (GUI shell hook)
`

/** A value-flag key and the argument that supplies its value. */
type ValueFlag = 'port' | 'host' | 'url'

/**
 * Parse the launcher argv (everything after the bin name).
 *
 * Fail-loud on an unknown flag, an unknown positional, a repeated positional,
 * or a malformed port: a launcher argument the parser cannot interpret is a
 * misconfiguration, never a silent fallback.
 * @param argv - process arguments after the executable and script path.
 * @returns the parsed invocation.
 * @throws when the invocation is malformed.
 */
export function parseArgs(argv: readonly string[]): RinArgs {
  const result: RinArgs = { command: 'default', help: false, version: false }
  let commandSeen = false

  const setCommand = (command: RinCommand): void => {
    if (commandSeen) throw new Error('rin: expected at most one command (web)')
    commandSeen = true
    result.command = command
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (token === '--') break

    if (token === '--help' || token === '-h') {
      result.help = true
      continue
    }
    if (token === '--version' || token === '-v' || token === '-V') {
      result.version = true
      continue
    }
    if (token === 'web') {
      setCommand('web')
      continue
    }
    if (token === 'help') {
      result.help = true
      continue
    }
    if (token === 'version') {
      result.version = true
      continue
    }

    if (token.startsWith('--')) {
      const parsed = parseValueFlag(token, argv[index + 1])
      if (parsed === undefined) throw new Error(`rin: unknown option ${token}`)
      if (parsed.key === 'port') result.port = parsed.value as number
      else if (parsed.key === 'host') result.host = parsed.value as string
      else result.url = parsed.value as string
      if (parsed.consumedNext) index += 1
      continue
    }

    throw new Error(`rin: unexpected argument ${token}`)
  }

  return result
}

/** A parsed value flag: the key plus the value it carries. */
interface ParsedValueFlag {
  key: ValueFlag
  value: string | number
  consumedNext: boolean
}

/**
 * Parse one `--name value` or `--name=value` flag.
 *
 * The port flag validates and coerces to a number here so the result carries a
 * ready-to-use value; host and url stay strings.
 * @param token - the flag token, starting with `--`.
 * @param next - the following argv token, used for the space form.
 * @returns the parsed flag, or undefined when the name is unknown.
 * @throws when --port is not a valid TCP port number.
 */
function parseValueFlag(token: string, next: string | undefined): ParsedValueFlag | undefined {
  const equals = token.indexOf('=')
  const name = equals < 0 ? token.slice(2) : token.slice(2, equals)
  const inline = equals < 0 ? undefined : token.slice(equals + 1)
  const key = (name === 'port' || name === 'host' || name === 'url') ? name : undefined
  if (key === undefined) return undefined

  const raw = inline ?? next
  if (raw === undefined || raw === '') throw new Error(`rin: --${key} requires a value`)
  if (key === 'port') {
    const port = Number(raw)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`rin: --port must be an integer in 1..65535, got ${raw}`)
    }
    return { key, value: port, consumedNext: inline === undefined }
  }
  return { key, value: raw, consumedNext: inline === undefined }
}
