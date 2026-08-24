#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.env.RIN_RELEASE_BUNDLE_ROOT || 'apps/desktop/src-tauri/target')
const platform = process.env.RIN_RELEASE_PLATFORM?.trim()
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

console.log(`release artifacts: ${installers.length} installer/update bundle(s)`)
console.log(`updater signatures: ${signatures.length}`)
for (const file of [...installers, ...signatures]) console.log(file)
