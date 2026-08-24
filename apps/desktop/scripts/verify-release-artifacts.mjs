#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(process.env.RIN_RELEASE_BUNDLE_ROOT || 'apps/desktop/src-tauri/target')
const platform = process.env.RIN_RELEASE_PLATFORM?.trim()
const target = process.env.RIN_RELEASE_TARGET?.trim()
const updaterJsonPath = resolve(process.env.RIN_RELEASE_UPDATER_JSON || 'latest.json')
const verifyRemoteAsset = process.env.RIN_RELEASE_VERIFY_REMOTE_ASSET === 'true'

if (!platform) throw new Error('RIN_RELEASE_PLATFORM is required')

function filesUnder(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}

function normalizeVersion(version) {
  return version.replace(/^v/, '')
}

function expectedUpdaterKey() {
  const explicit = process.env.RIN_RELEASE_UPDATER_KEY?.trim()
  if (explicit) return explicit
  if (!target) throw new Error('RIN_RELEASE_TARGET or RIN_RELEASE_UPDATER_KEY is required')

  const os = platform === 'macos' ? 'darwin' : platform
  const architecture = target.split('-', 1)[0]
  const normalizedArchitecture = {
    amd64: 'x86_64',
    x64: 'x86_64',
    arm64: 'aarch64',
  }[architecture] || architecture
  return `${os}-${normalizedArchitecture}`
}

function isUpdaterArtifact(file, expectedPlatform) {
  if (expectedPlatform === 'linux') return file.endsWith('.AppImage')
  if (expectedPlatform === 'windows') {
    return (
      file.endsWith('.exe') &&
      (file === basename(file) || /[\\/]bundle[\\/]nsis[\\/]/u.test(file))
    )
  }
  if (expectedPlatform === 'macos') return file.endsWith('.app.tar.gz')
  return false
}

function isReleaseArtifactUrl(url, artifact) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`updater URL must use HTTPS: ${url}`)
  if (parsed.username || parsed.password) throw new Error(`updater URL must not contain credentials: ${url}`)
  if (!parsed.pathname || parsed.pathname.endsWith('/')) {
    throw new Error(`updater URL has no asset path: ${url}`)
  }

  const githubApiAsset = /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/u.test(parsed.pathname)
  if (githubApiAsset) {
    const githubApiOrigin = new URL(process.env.GITHUB_API_URL || 'https://api.github.com').origin
    if (parsed.origin !== githubApiOrigin) {
      throw new Error(`updater GitHub API URL must use ${githubApiOrigin}: ${url}`)
    }
    return { kind: 'github-api', url: parsed }
  }

  const urlAsset = decodeURIComponent(parsed.pathname.split('/').pop() || '')
  if (urlAsset !== basename(artifact)) {
    throw new Error(`updater URL does not point to ${basename(artifact)}: ${url}`)
  }
  return { kind: 'download', url: parsed }
}

function parseUpdaterJson(contents) {
  let manifest
  try {
    manifest = JSON.parse(contents)
  } catch (error) {
    throw new Error(`invalid updater latest.json: ${error.message}`)
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('updater latest.json must contain a JSON object')
  }
  if (typeof manifest.version !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(manifest.version)) {
    throw new Error(`updater latest.json has invalid version: ${String(manifest.version)}`)
  }
  if (manifest.notes !== undefined && typeof manifest.notes !== 'string') {
    throw new Error('updater latest.json notes must be a string when present')
  }
  if (manifest.pub_date !== undefined && (typeof manifest.pub_date !== 'string' || Number.isNaN(Date.parse(manifest.pub_date)))) {
    throw new Error('updater latest.json pub_date must be an RFC 3339 date when present')
  }
  if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    throw new Error('updater latest.json platforms must be an object')
  }
  const platformKeys = Object.keys(manifest.platforms)
  if (platformKeys.length === 0) throw new Error('updater latest.json platforms must not be empty')

  for (const key of platformKeys) {
    const entry = manifest.platforms[key]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`updater latest.json platform ${key} must be an object`)
    }
    if (typeof entry.url !== 'string' || entry.url.trim() === '') {
      throw new Error(`updater latest.json platform ${key} has no URL`)
    }
    if (typeof entry.signature !== 'string' || entry.signature.trim() === '') {
      throw new Error(`updater latest.json platform ${key} has no signature`)
    }
    try {
      new URL(entry.url)
    } catch {
      throw new Error(`updater latest.json platform ${key} has an invalid URL: ${entry.url}`)
    }
  }
  return manifest
}

async function verifyRemoteGithubAsset(url, artifact, expectedPlatform) {
  if (!verifyRemoteAsset) return
  const token = process.env.GITHUB_TOKEN?.trim()
  if (!token) throw new Error(`GITHUB_TOKEN is required to verify updater asset URL: ${url}`)

  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`updater asset URL returned ${response.status}: ${url}`)

  let metadata
  try {
    metadata = await response.json()
  } catch (error) {
    throw new Error(`updater asset URL did not return GitHub asset metadata: ${error.message}`)
  }
  if (!metadata || typeof metadata !== 'object' || typeof metadata.name !== 'string') {
    throw new Error(`updater asset URL returned no asset name: ${url}`)
  }
  if (!isUpdaterArtifact(metadata.name, expectedPlatform)) {
    throw new Error(`updater asset URL points to ${metadata.name}, not a ${expectedPlatform} updater artifact`)
  }
  if (typeof metadata.size !== 'number' || metadata.size !== statSync(artifact).size) {
    throw new Error(`updater asset size does not match ${basename(artifact)}: ${url}`)
  }
}

async function main() {
  const files = filesUnder(root)
  const signatures = files.filter((file) => file.endsWith('.sig'))
  if (signatures.length === 0) throw new Error(`no updater signatures found under ${root}`)

  for (const signature of signatures) {
    if (statSync(signature).size === 0) throw new Error(`empty updater signature: ${signature}`)
    const artifact = signature.slice(0, -4)
    if (!files.includes(artifact)) {
      throw new Error(`signature has no matching updater artifact: ${signature}`)
    }
  }

  const installers = {
    linux: files.filter((file) => file.endsWith('.deb') || file.endsWith('.AppImage')),
    windows: files.filter((file) => file.endsWith('.exe')),
    macos: files.filter((file) => file.endsWith('.dmg') || file.endsWith('.app.tar.gz')),
  }[platform]
  if (!installers || installers.length === 0) {
    throw new Error(`no ${platform} installer/updater artifacts found under ${root}`)
  }

  let manifest
  try {
    manifest = parseUpdaterJson(readFileSync(updaterJsonPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`updater latest.json not found: ${updaterJsonPath}`)
    throw error
  }

  const expectedVersion = process.env.RIN_RELEASE_VERSION?.trim()
  if (expectedVersion && normalizeVersion(manifest.version) !== normalizeVersion(expectedVersion.replace(/^refs\/tags\//, '').replace(/^rin-v/, ''))) {
    throw new Error(`updater latest.json version ${manifest.version} does not match release ${expectedVersion}`)
  }

  const updaterKey = expectedUpdaterKey()
  const updaterEntry = manifest.platforms[updaterKey]
  if (!updaterEntry) throw new Error(`updater latest.json has no platform entry for ${updaterKey}`)

  const matchingSignatures = signatures.filter((signature) => {
    if (readFileSync(signature, 'utf8') !== updaterEntry.signature) return false
    return isUpdaterArtifact(signature.slice(0, -4), platform)
  })
  if (matchingSignatures.length === 0) {
    throw new Error(`updater latest.json signature for ${updaterKey} does not match a local ${platform} updater artifact`)
  }
  if (matchingSignatures.length > 1) {
    throw new Error(`updater latest.json signature for ${updaterKey} matches multiple local updater artifacts`)
  }

  const signature = matchingSignatures[0]
  const artifact = signature.slice(0, -4)
  const urlInfo = isReleaseArtifactUrl(updaterEntry.url, artifact)
  if (urlInfo.kind === 'github-api') await verifyRemoteGithubAsset(updaterEntry.url, artifact, platform)

  console.log(`release artifacts: ${installers.length} installer/update bundle(s)`)
  console.log(`updater signatures: ${signatures.length}`)
  console.log(`updater manifest: ${updaterJsonPath}`)
  console.log(`updater platform: ${updaterKey} -> ${basename(artifact)}`)
  for (const file of [...installers, ...signatures]) console.log(file)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
