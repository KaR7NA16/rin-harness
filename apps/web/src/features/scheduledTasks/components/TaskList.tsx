import { useState } from 'react'
import type { CronTask } from '../taskTypes'
import { TaskRow } from './TaskRow'
import { useTranslation } from '../../../i18n'

type Props = {
  tasks: CronTask[]
}

export function TaskList({ tasks }: Props) {
  const t = useTranslation()
  const enabledCount = tasks.filter((task) => task.enabled).length
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-[24px]">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-[12px]">
        <StatCard label={t('tasks.totalTasks')} value={String(tasks.length)} />
        <StatCard label={t('tasks.active')} value={String(enabledCount)} />
        <StatCard label={t('tasks.disabled')} value={String(tasks.length - enabledCount)} />
      </div>

      {/* Task rows — accordion: only one logs panel open at a time */}
      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            showLogs={expandedLogsId === task.id}
            onToggleLogs={() => setExpandedLogsId(expandedLogsId === task.id ? null : task.id)}
          />
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[20px] py-[12px]">
      <div className="text-[24px] font-semibold leading-tight text-[var(--color-text-primary)] tabular-nums">{value}</div>
      <div className="mt-[4px] text-[12px] text-[var(--color-text-tertiary)]">{label}</div>
    </div>
  )
}
