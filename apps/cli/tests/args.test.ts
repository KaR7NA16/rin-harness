/**
 * rin launcher — args parsing contract tests.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test
 * (tests/args.smoke.ts) is run during development.
 *
 * @module @rin/cli
 */

import { describe, expect, test } from 'vitest'
import { parseArgs } from '../src/args.ts'

describe('parseArgs commands', () => {
  test('defaults when no argument is given', () => {
    expect(parseArgs([]).command).toBe('default')
  })

  test('parses the web command', () => {
    expect(parseArgs(['web']).command).toBe('web')
  })

  test('stops parsing at the -- terminator', () => {
    expect(parseArgs(['--', 'web']).command).toBe('default')
    expect(parseArgs(['web', '--', '--port']).command).toBe('web')
  })
})

describe('parseArgs help and version', () => {
  test('parses every help form', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['help']).help).toBe(true)
  })

  test('parses every version form', () => {
    expect(parseArgs(['--version']).version).toBe(true)
    expect(parseArgs(['-v']).version).toBe(true)
    expect(parseArgs(['-V']).version).toBe(true)
    expect(parseArgs(['version']).version).toBe(true)
  })
})

describe('parseArgs value flags', () => {
  test('parses --port in space and = forms as a number', () => {
    expect(parseArgs(['--port', '9000']).port).toBe(9000)
    expect(parseArgs(['--port=9001']).port).toBe(9001)
  })

  test('parses --host as a string', () => {
    expect(parseArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0')
    expect(parseArgs(['--host=localhost']).host).toBe('localhost')
  })

  test('parses --url as a string', () => {
    expect(parseArgs(['--url', 'http://x:1']).url).toBe('http://x:1')
    expect(parseArgs(['--url=http://x:2']).url).toBe('http://x:2')
  })

  test('combines a command with flags', () => {
    expect(parseArgs(['web', '--port', '9002', '--host', '127.0.0.1'])).toMatchObject({
      command: 'web',
      port: 9002,
      host: '127.0.0.1',
    })
  })
})

describe('parseArgs failures', () => {
  test('rejects a second command', () => {
    expect(() => parseArgs(['web', 'web'])).toThrow('at most one command')
  })

  test('rejects an unknown positional and an unknown option', () => {
    expect(() => parseArgs(['tui'])).toThrow('unexpected argument')
    expect(() => parseArgs(['unknown'])).toThrow('unexpected argument')
    expect(() => parseArgs(['--bogus'])).toThrow('unknown option')
  })

  test('rejects a malformed port', () => {
    expect(() => parseArgs(['--port'])).toThrow('requires a value')
    expect(() => parseArgs(['--port', 'abc'])).toThrow('must be an integer')
    expect(() => parseArgs(['--port', '70000'])).toThrow('must be an integer')
    expect(() => parseArgs(['--port', '0'])).toThrow('must be an integer')
  })
})
