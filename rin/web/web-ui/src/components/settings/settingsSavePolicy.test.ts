import { describe, expect, it } from 'vitest'

import {
  SETTINGS_SAVE_POLICIES,
  type SettingsSaveMode,
} from './settingsSavePolicy'

describe('settings save policy', () => {
  it('defines the three save modes with explicit user-facing rules', () => {
    const modes: SettingsSaveMode[] = ['immediate', 'form', 'confirmed']

    for (const mode of modes) {
      expect(SETTINGS_SAVE_POLICIES[mode].label).toBeTruthy()
      expect(SETTINGS_SAVE_POLICIES[mode].description).toBeTruthy()
    }
  })

  it('keeps the policy names stable for page-level routing and analytics', () => {
    expect(Object.keys(SETTINGS_SAVE_POLICIES)).toEqual(['immediate', 'form', 'confirmed'])
  })
})
