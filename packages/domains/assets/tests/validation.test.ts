import { describe, expect, test } from 'vitest'
import {
  assertSafePackageName,
  assertSafePackageVersion,
  assertSafePythonImport,
  assertSafeRPackage,
  assertSafeReviewableCommand,
} from '../src/validation.ts'

describe('assertSafePackageName', () => {
  test('accepts safe names for every ecosystem', () => {
    expect(() => assertSafePackageName('lodash', 'node')).not.toThrow()
    expect(() => assertSafePackageName('@scope/pkg', 'node')).not.toThrow()
    expect(() => assertSafePackageName('libc6', 'system')).not.toThrow()
    expect(() => assertSafePackageName('numpy', 'python')).not.toThrow()
    expect(() => assertSafePackageName('ggplot2', 'r')).not.toThrow()
  })

  test('rejects names with unsafe characters', () => {
    expect(() => assertSafePackageName('bad;name', 'python')).toThrow(/unsafe python package name/)
    expect(() => assertSafePackageName('rm -rf', 'system')).toThrow(/unsafe system package name/)
    expect(() => assertSafePackageName('@scope/bad name', 'node')).toThrow(/unsafe node package name/)
  })
})

describe('assertSafePackageVersion', () => {
  test('accepts install-argument-safe versions', () => {
    expect(() => assertSafePackageVersion('>=2.0')).not.toThrow()
    expect(() => assertSafePackageVersion('1.0.0~rc1')).not.toThrow()
  })

  test('rejects versions with shell metacharacters', () => {
    expect(() => assertSafePackageVersion('1.0; rm')).toThrow(/unsafe package version/)
  })
})

describe('assertSafePythonImport', () => {
  test('accepts dotted identifiers', () => {
    expect(() => assertSafePythonImport('numpy')).not.toThrow()
    expect(() => assertSafePythonImport('numpy.linalg')).not.toThrow()
  })

  test('rejects non-identifier imports', () => {
    expect(() => assertSafePythonImport('numpy; os')).toThrow(/unsafe Python import name/)
    expect(() => assertSafePythonImport('9lives')).toThrow(/unsafe Python import name/)
  })
})

describe('assertSafeRPackage', () => {
  test('accepts R package names and rejects unsafe ones', () => {
    expect(() => assertSafeRPackage('ggplot2')).not.toThrow()
    expect(() => assertSafeRPackage('bad-name')).toThrow(/unsafe R verifier package/)
  })
})

describe('assertSafeReviewableCommand', () => {
  test('accepts ordinary commands', () => {
    expect(() => assertSafeReviewableCommand('python -c "import numpy"')).not.toThrow()
  })

  test('rejects control characters and overly long commands', () => {
    expect(() => assertSafeReviewableCommand('a\nb')).toThrow(/unsafe verifier command text/)
    expect(() => assertSafeReviewableCommand('x'.repeat(4097))).toThrow(/unsafe verifier command text/)
  })

  test('rejects shell metacharacters', () => {
    for (const command of [
      'python -c "1"; rm -rf /',
      'cat /etc/passwd | less',
      'cmd & cmd2',
      'echo $HOME',
      'echo `id`',
      'echo $(id)',
      'cat < /etc/passwd',
      'echo x > /tmp/y',
    ]) {
      expect(() => assertSafeReviewableCommand(command)).toThrow(/unsafe verifier command text/)
    }
  })
})
