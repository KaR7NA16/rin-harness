import { Button } from '../../../components/shared/Button'
import { useTranslation } from '../../../i18n'
import { Icon } from '../../../components/shared/Icon'

type Props = {
  onCreateTask: () => void
}

export function TaskEmptyState({ onCreateTask }: Props) {
  const t = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6 py-20">
      <div className="relative mb-4">
        <div className="w-16 h-16 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center">
          <Icon name="schedule" size={32} className="text-[var(--color-brand)]" />
        </div>
      </div>

      <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-1">
        {t('tasks.emptyTitle')}
      </h3>
      <p className="text-[12px] text-[var(--color-text-tertiary)] mb-4 text-center max-w-sm">
        {t('tasks.emptyDesc')}
      </p>

      <Button onClick={onCreateTask}>{t('tasks.newTask')}</Button>
    </div>
  )
}
