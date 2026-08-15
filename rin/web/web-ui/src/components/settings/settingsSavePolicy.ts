export type SettingsSaveMode = 'immediate' | 'form' | 'confirmed'

export const SETTINGS_SAVE_POLICIES: Record<SettingsSaveMode, {
  label: string
  description: string
}> = {
  immediate: {
    label: 'settings.savePolicy.immediate.label',
    description: 'settings.savePolicy.immediate.description',
  },
  form: {
    label: 'settings.savePolicy.form.label',
    description: 'settings.savePolicy.form.description',
  },
  confirmed: {
    label: 'settings.savePolicy.confirmed.label',
    description: 'settings.savePolicy.confirmed.description',
  },
}
