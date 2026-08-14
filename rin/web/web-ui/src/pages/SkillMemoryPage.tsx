import type { Mounted } from '../api'
import type { SkillMemoryOverviewPayload, SkillMemoryOverviewRecord } from '../types'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { ListDetail } from '../components/ListDetail'
import type { ListItemLabel } from '../components/ListDetail'

function skillLabel(skill: SkillMemoryOverviewRecord): ListItemLabel {
  return {
    title: skill.skillName,
    subtitle: [skill.scope, skill.status, 'used ' + skill.useCount].join(' · '),
  }
}

export default function SkillMemoryPage() {
  const state = useApi<Mounted<SkillMemoryOverviewPayload>>('/api/skill-memory/overview')

  return (
    <div className="page">
      <h1 className="page-title">SkillMemory</h1>
      <ServiceGate state={state}>
        {data => <ListDetail items={data.skills} label={skillLabel} empty="no skills" />}
      </ServiceGate>
    </div>
  )
}
