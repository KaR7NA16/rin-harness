import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICONS } from './Icon'

const webUiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('Codicon font asset', () => {
  it('loads a self-hosted WOFF2 font through the global stylesheet', () => {
    const fontPath = resolve(webUiRoot, 'public/fonts/codicon.woff2')
    const globalCss = readFileSync(resolve(webUiRoot, 'src/theme/globals.css'), 'utf8')

    expect(existsSync(fontPath)).toBe(true)
    expect(statSync(fontPath).size).toBeGreaterThan(10_000)
    expect(globalCss).toContain('@vscode/codicons/dist/codicon.css')
    expect(globalCss).toContain("font-family: 'codicon-fixed'")
    expect(globalCss).toContain("url('/fonts/codicon.woff2')")
    expect(globalCss).toContain("font-family: 'codicon-fixed' !important")

    const fontHeader = readFileSync(fontPath).subarray(0, 4).toString('ascii')
    expect(fontHeader).toBe('wOF2')
  })

  it('maps every application icon to a glyph shipped by the pinned Codicon CSS', () => {
    const codiconCss = readFileSync(
      resolve(webUiRoot, 'node_modules/@vscode/codicons/dist/codicon.css'),
      'utf8',
    )

    for (const codiconName of Object.values(ICONS)) {
      expect(codiconCss).toContain(`.codicon-${codiconName}:before`)
    }
  })
})
