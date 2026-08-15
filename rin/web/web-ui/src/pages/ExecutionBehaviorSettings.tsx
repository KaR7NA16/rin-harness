import type { EffortLevel } from '../types/settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useTranslation } from '../i18n'
import {
  SegmentedControl,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../components/settings/SettingsLayout'

export function ExecutionBehaviorSettings() {
  const { effortLevel, setEffort } = useSettingsStore()
  const t = useTranslation()
  const effortItems: Array<{ value: EffortLevel; label: string }> = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  return (
    <SettingsPage title={t('settings.tab.behavior')} description={t('settings.category.execution')} saveMode="immediate">
      <SettingsSection>
        <SettingsRow
          settingId="execution.effort"
          label={t('settings.execution.effortTitle')}
          hint={t('settings.execution.effortDescription')}
        >
          <SegmentedControl items={effortItems} value={effortLevel} onChange={(next) => void setEffort(next)} />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
