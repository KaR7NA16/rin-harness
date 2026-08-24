#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const overlayPath = resolve(desktopDir, 'src-tauri', 'tauri.release.conf.json')
const outputPath = resolve(
  process.env.RIN_RELEASE_CONFIG_OUTPUT ||
    resolve(desktopDir, 'src-tauri', 'tauri.release.generated.json'),
)

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing required release value: ${name}`)
  return value
}

function releaseVersion() {
  const raw = required('RIN_RELEASE_VERSION').replace(/^refs\/tags\//, '').replace(/^rin-v/, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(raw)) {
    throw new Error(`RIN_RELEASE_VERSION is not a semantic version: ${raw}`)
  }
  return raw
}

const config = JSON.parse(readFileSync(overlayPath, 'utf8'))
config.version = releaseVersion()
config.plugins ??= {}
config.plugins.updater ??= {}
config.plugins.updater.pubkey = required('TAURI_UPDATER_PUBLIC_KEY')

const windowsThumbprint = process.env.TAURI_WINDOWS_CERTIFICATE_THUMBPRINT?.trim()
if (windowsThumbprint) {
  config.bundle ??= {}
  config.bundle.windows ??= {}
  config.bundle.windows.certificateThumbprint = windowsThumbprint.replaceAll(' ', '')
  config.bundle.windows.digestAlgorithm =
    process.env.TAURI_WINDOWS_DIGEST_ALGORITHM?.trim() || 'sha256'
  config.bundle.windows.timestampUrl = required('TAURI_WINDOWS_TIMESTAMP_URL')
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
console.log(`release config: ${outputPath}`)
console.log(`release version: ${config.version}`)
console.log(`updater public key: configured (${config.plugins.updater.pubkey.length} chars)`)
console.log(`Windows Authenticode: ${windowsThumbprint ? 'configured' : 'not requested'}`)
