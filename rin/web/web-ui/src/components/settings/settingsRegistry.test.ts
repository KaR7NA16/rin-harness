import { describe, expect, it } from 'vitest'
import { searchSettings, type SettingsSearchEntry } from './settingsRegistry'

const entries: SettingsSearchEntry[] = [
  {
    id: 'general.appearance',
    label: '外观',
    description: '选择浅色或深色主题',
    keywords: ['主题', '亮色', '暗色'],
    sectionLabel: '常规',
    tab: 'general',
  },
  {
    id: 'backup.interval',
    label: '自动备份间隔',
    description: '设置会话备份频率',
    keywords: ['备份', '会话', '恢复'],
    sectionLabel: '记忆与数据',
    tab: 'sessionBackup',
  },
]

describe('searchSettings', () => {
  it('matches setting labels, descriptions, and translated keywords', () => {
    expect(searchSettings('主题', entries)).toEqual([entries[0]])
    expect(searchSettings('会话', entries)).toEqual([entries[1]])
  })

  it('returns no result text separately from the search placeholder', () => {
    expect(searchSettings('不存在', entries)).toEqual([])
  })
})
