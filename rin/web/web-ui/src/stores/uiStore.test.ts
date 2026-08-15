import { beforeEach, describe, expect, it } from 'vitest'

import { useUIStore } from './uiStore'

describe('uiStore settings routes', () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      activeSettingsTab: 'overview',
    })
  })

  it('normalizes a settings page into the shared settings panel', () => {
    useUIStore.getState().openSettings('memory')

    expect(useUIStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsPanelView: 'settings',
      pendingSettingsTab: 'memory',
      activeSettingsTab: 'memory',
    })
  })

  it('keeps workspace panels outside the settings route', () => {
    useUIStore.getState().openSettings('codeGraph')

    expect(useUIStore.getState()).toMatchObject({
      settingsOpen: false,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      workspaceView: 'codeGraph',
    })
  })
})
