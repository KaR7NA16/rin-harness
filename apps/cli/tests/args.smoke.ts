/**
 * rin launcher — args parsing strip-types smoke.
 *
 * Exercises every parseArgs branch without the Cordis runtime: the positional
 * commands, value flags in both space and = forms, help/version, and the
 * fail-loud rejection of unknown or malformed input.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/args.smoke.ts
 */

import { parseArgs } from '../src/args.ts'

// 1. Positional commands and defaults.
if (parseArgs([]).command !== 'default') throw new Error('no args should default')
if (parseArgs(['web']).command !== 'web') throw new Error('web command not parsed')

// 2. Help and version flags (short and long forms).
if (!parseArgs(['--help']).help) throw new Error('--help not parsed')
if (!parseArgs(['-h']).help) throw new Error('-h not parsed')
if (!parseArgs(['help']).help) throw new Error('help positional not parsed')
if (!parseArgs(['--version']).version) throw new Error('--version not parsed')
if (!parseArgs(['-v']).version) throw new Error('-v not parsed')
if (!parseArgs(['-V']).version) throw new Error('-V not parsed')
if (!parseArgs(['version']).version) throw new Error('version positional not parsed')

// 3. Value flags: space form and = form.
if (parseArgs(['--port', '9000']).port !== 9000) throw new Error('--port space form not parsed')
if (parseArgs(['--port=9001']).port !== 9001) throw new Error('--port = form not parsed')
if (parseArgs(['--host', '0.0.0.0']).host !== '0.0.0.0') throw new Error('--host not parsed')
if (parseArgs(['--host=localhost']).host !== 'localhost') throw new Error('--host = form not parsed')
if (parseArgs(['--url', 'http://x:1']).url !== 'http://x:1') throw new Error('--url not parsed')
if (parseArgs(['--url=http://x:2']).url !== 'http://x:2') throw new Error('--url = form not parsed')

// 4. Combined invocation: command + flags.
const combined = parseArgs(['web', '--port', '9002', '--host', '127.0.0.1'])
if (combined.command !== 'web' || combined.port !== 9002 || combined.host !== '127.0.0.1') {
  throw new Error('combined invocation not parsed')
}

// 5. Fail-loud rejections.
const rejects = (argv, needle) => {
  try {
    parseArgs(argv)
  } catch (error) {
    if (String(error).includes(needle)) return
    throw new Error('wrong error for ' + JSON.stringify(argv) + ': ' + String(error))
  }
  throw new Error('expected ' + JSON.stringify(argv) + ' to throw')
}
rejects(['web', 'web'], 'at most one command')
rejects(['tui'], 'unexpected argument')
rejects(['unknown'], 'unexpected argument')
rejects(['--bogus'], 'unknown option')
rejects(['--port'], 'requires a value')
rejects(['--port', 'abc'], 'must be an integer')
rejects(['--port', '70000'], 'must be an integer')
rejects(['--port', '0'], 'must be an integer')

console.log('ARGS-SMOKE-OK', { commands: 2, flags: 7, valueFlags: 6, rejections: 8 })
