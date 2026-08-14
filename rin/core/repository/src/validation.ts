import type { RepositoryPackageEcosystem } from './types.ts'

/** Reject a package name that cannot be a safe install argument. */
export function assertSafePackageName(name: string, ecosystem: RepositoryPackageEcosystem): void {
  const valid = ecosystem === 'node'
    ? /^@?[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(name)
    : ecosystem === 'system'
      ? /^[A-Za-z0-9][A-Za-z0-9+_.-]*$/.test(name)
      : /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)
  if (!valid) throw new Error('rin repository: unsafe ' + ecosystem + ' package name: ' + name)
}

/** Reject a version string that cannot be a safe install argument. */
export function assertSafePackageVersion(version: string): void {
  if (!/^[A-Za-z0-9_.+~:<>=!*,-]+$/.test(version)) {
    throw new Error('rin repository: unsafe package version: ' + version)
  }
}

/** Reject a Python import name that cannot be safely embedded in a verify command. */
export function assertSafePythonImport(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)) {
    throw new Error('rin repository: unsafe Python import name: ' + name)
  }
}

/** Reject an R package name that cannot be safely embedded in a verify command. */
export function assertSafeRPackage(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(name)) throw new Error('rin repository: unsafe R verifier package: ' + name)
}

/** Reject a verifier command that is too long or contains control characters. */
export function assertSafeReviewableCommand(command: string): void {
  if (command.length > 4096 || /[\0\r\n]/.test(command)) throw new Error('rin repository: unsafe verifier command text')
}
