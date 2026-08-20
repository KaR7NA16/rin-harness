import type { EffortLevel } from '../types/settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useTranslation, type TranslationKey } from '../i18n'
import {
  SegmentedControl,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../components/settings/SettingsLayout'

const EFFORT_LEVELS: Array<{ value: EffortLevel; labelKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { value: 'low', labelKey: 'settings.general.effort.low', descriptionKey: 'settings.execution.effort.low.description' },
  { value: 'medium', labelKey: 'settings.general.effort.medium', descriptionKey: 'settings.execution.effort.medium.description' },
  { value: 'high', labelKey: 'settings.general.effort.high', descriptionKey: 'settings.execution.effort.high.description' },
  { value: 'max', labelKey: 'settings.general.effort.max', descriptionKey: 'settings.execution.effort.max.description' },
]

export function ExecutionBehaviorSettings() {
  const { effortLevel, setEffort } = useSettingsStore()
  const t = useTranslation()
  const selected = EFFORT_LEVELS.find(level => level.value === effortLevel)

  return (
    <SettingsPage
      title={t('settings.tab.behavior')}
      description={t('settings.category.execution')}
      saveMode="immediate"
    >
      <SettingsSection
        title={t('settings.execution.effortSectionTitle')}
        description={t('settings.execution.effortSectionDescription')}
      >
        <SettingsRow
          settingId="execution.effort"
          label={t('settings.execution.effortTitle')}
          hint={t('settings.execution.effortDescription')}
          align="start"
        >
          <SegmentedControl
            items={EFFORT_LEVELS.map(level => ({ value: level.value, label: t(level.labelKey) }))}
            value={effortLevel}
            onChange={(next) => void setEffort(next)}
          />
        </SettingsRow>
        {selected && (
          <div className="flex items-start gap-[10px] px-[20px] pb-[14px]">
            <span aria-hidden="true" className="mt-[2px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-info)]" />
            <p className="text-[11px] leading-[17px] text-[var(--color-text-secondary)]">
              {t(selected.descriptionKey)}
            </p>
          </div>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
