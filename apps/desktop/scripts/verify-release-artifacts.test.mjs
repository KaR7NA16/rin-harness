import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const verifier = fileURLToPath(new URL('./verify-release-artifacts.mjs', import.meta.url))

const CASES = [
  {
    platform: 'linux',
    target: 'x86_64-unknown-linux-gnu',
    key: 'linux-x86_64',
    relative: 'bundle/appimage/rin_1.2.3_amd64.AppImage',
  },
  {
    platform: 'windows',
    target: 'x86_64-pc-windows-msvc',
    key: 'windows-x86_64',
    relative: 'bundle/nsis/rin_1.2.3_x64-setup.exe',
  },
  {
    platform: 'macos',
    target: 'aarch64-apple-darwin',
    key: 'darwin-aarch64',
    relative: 'bundle/macos/rin.app.tar.gz',
  },
]

async function fixture(spec) {
  const directory = await mkdtemp(join(tmpdir(), 'rin-release-verifier-'))
  const root = join(directory, 'target')
  const artifact = join(root, spec.relative)
  await mkdir(dirname(artifact), { recursive: true })
  await writeFile(artifact, 'artifact')
  await writeFile(artifact + '.sig', 'fixture-signature\n')
  const manifest = join(directory, 'latest.json')
  await writeFile(manifest, JSON.stringify({
    version: '1.2.3',
    notes: 'fixture',
    pub_date: '2026-08-24T00:00:00.000Z',
    platforms: {
      [spec.key]: {
        url: 'https://downloads.example.invalid/' + basename(artifact),
        signature: await readFile(artifact + '.sig', 'utf8'),
      },
    },
  }))
  return { directory, root, artifact, manifest }
}

function run(spec, paths, overrides = {}) {
  return spawnSync(process.execPath, [verifier], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RIN_RELEASE_BUNDLE_ROOT: paths.root,
      RIN_RELEASE_PLATFORM: spec.platform,
      RIN_RELEASE_TARGET: spec.target,
      RIN_RELEASE_UPDATER_JSON: paths.manifest,
      RIN_RELEASE_VERSION: 'rin-v1.2.3',
      ...overrides,
    },
  })
}

for (const spec of CASES) {
  test('accepts a coherent ' + spec.platform + ' updater manifest', async (t) => {
    const paths = await fixture(spec)
    t.after(() => rm(paths.directory, { recursive: true, force: true }))
    const result = run(spec, paths)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, new RegExp('updater platform: ' + spec.key))
  })

  test('rejects a mismatched ' + spec.platform + ' signature', async (t) => {
    const paths = await fixture(spec)
    t.after(() => rm(paths.directory, { recursive: true, force: true }))
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
    manifest.platforms[spec.key].signature = 'wrong'
    await writeFile(paths.manifest, JSON.stringify(manifest))
    const result = run(spec, paths)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /does not match a local/u)
  })
}

test('does not send GITHUB_TOKEN to an untrusted API origin', async (t) => {
  const spec = CASES[0]
  const paths = await fixture(spec)
  t.after(() => rm(paths.directory, { recursive: true, force: true }))
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
  manifest.platforms[spec.key].url =
    'https://attacker.example.invalid/repos/o/r/releases/assets/123'
  await writeFile(paths.manifest, JSON.stringify(manifest))
  const result = run(spec, paths, {
    GITHUB_TOKEN: 'fixture-token',
    RIN_RELEASE_VERIFY_REMOTE_ASSET: 'true',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must use https:\/\/api\.github\.com/u)
})
