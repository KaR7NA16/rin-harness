import { describe, expect, it } from 'vitest'
import { resolveAboutVersion } from './aboutVersion'

describe('resolveAboutVersion', () => {
  it('prefers the local server version for the source web preview', async () => {
    await expect(
      resolveAboutVersion({
        server: async () => '1.4.9',
        desktop: async () => 'desktop-version',
      }),
    ).resolves.toBe('1.4.9')
  })

  it('falls back to the desktop runtime when the local server is unavailable', async () => {
    await expect(
      resolveAboutVersion({
        server: async () => {
          throw new Error('server unavailable')
        },
        desktop: async () => '1.4.9-desktop',
      }),
    ).resolves.toBe('1.4.9-desktop')
  })

  it('returns unknown only when both version sources are unavailable', async () => {
    await expect(
      resolveAboutVersion({
        server: async () => {
          throw new Error('server unavailable')
        },
        desktop: async () => {
          throw new Error('desktop unavailable')
        },
      }),
    ).resolves.toBe('unknown')
  })
})
