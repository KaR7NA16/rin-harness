import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { zh } from './locales/zh'

describe('desktop product identity', () => {
  it.each([en, zh, ja, ko])(
    'uses Cyberpsychosis for the generic empty-session experience',
    locale => {
      expect(locale['empty.subtitle']).toContain('Cyberpsychosis')
      expect(locale['permMode.autoAcceptDesc']).toContain('Cyberpsychosis')
    },
  )

  it('uses Cyberpsychosis for generic permission prompts', () => {
    expect(en['permission.allowBash']).toContain('Cyberpsychosis')
    expect(en['permission.allowTool']).toContain('Cyberpsychosis')
    expect(zh['permission.allowBash']).toContain('Cyberpsychosis')
    expect(zh['permission.allowTool']).toContain('Cyberpsychosis')
  })
})
