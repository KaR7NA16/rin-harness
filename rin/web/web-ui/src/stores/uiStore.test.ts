import { beforeEach, describe, expect, it } from 'vitest'

import { useUIStore } from './uiStore'

describe('uiStore settings routes', () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      pendingSettingsTab: null,
      activeSettingsTab: 'overview',
    })
  })

  it('normalizes a settings page into the shared settings panel', () => {
    useUIStore.getState().openSettings('memory')

    expect(useUIStore.getState()).toMatchObject({
      settingsOpen: true,
      pendingSettingsTab: 'memory',
      activeSettingsTab: 'memory',
    })
  })

  it('opens the settings home from the settings shell view', () => {
    useUIStore.getState().openSettings('settings')

    expect(useUIStore.getState()).toMatchObject({
      settingsOpen: true,
      pendingSettingsTab: 'overview',
      activeSettingsTab: 'overview',
    })
  })
})
