import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { zh } from './locales/zh'

describe('desktop product identity', () => {
  it.each([en, zh, ja, ko])(
    'uses rin for the generic empty-session experience',
    locale => {
      expect(locale['empty.subtitle']).toContain('rin')
      expect(locale['permMode.autoAcceptDesc']).toContain('rin')
    },
  )

  it('uses rin for generic permission prompts', () => {
    expect(en['permission.allowBash']).toContain('rin')
    expect(en['permission.allowTool']).toContain('rin')
    expect(zh['permission.allowBash']).toContain('rin')
    expect(zh['permission.allowTool']).toContain('rin')
  })
})
