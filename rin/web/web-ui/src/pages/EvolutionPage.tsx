import type { Mounted } from '../api'
import type { EvolutionOverview, SkillCandidate, SkillLearningEvent } from '../types'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { KeyValue } from '../components/KeyValue'
import { ListDetail } from '../components/ListDetail'
import type { ListItemLabel } from '../components/ListDetail'

function candidateLabel(candidate: SkillCandidate): ListItemLabel {
  return {
    title: candidate.name,
    subtitle: [candidate.status, candidate.scope, 'conf ' + candidate.confidence].join(' · '),
  }
}

function eventLabel(event: SkillLearningEvent): ListItemLabel {
  return {
    title: event.kind,
    subtitle: event.createdAt + (event.skillName !== undefined ? ' · ' + event.skillName : ''),
  }
}

export default function EvolutionPage() {
  const state = useApi<Mounted<EvolutionOverview>>('/api/evolution/overview')

  return (
    <div className="page">
      <h1 className="page-title">Evolution</h1>
      <ServiceGate state={state}>
        {data => (
          <>
            <div className="card">
              <h3 className="section-title">config</h3>
              <KeyValue name="mode" value={data.config.mode} />
              <KeyValue name="minToolUses" value={data.config.minToolUses} />
              <KeyValue name="minConfidence" value={data.config.minConfidence} />
              <KeyValue name="autoApproveConfidence" value={data.config.autoApproveConfidence} />
            </div>
            <div className="card">
              <h3 className="section-title">pendingCandidates ({data.pendingCandidates.length})</h3>
              <ListDetail items={data.pendingCandidates} label={candidateLabel} empty="no pending candidates" />
            </div>
            <div className="card">
              <h3 className="section-title">recentCandidates ({data.recentCandidates.length})</h3>
              <ListDetail items={data.recentCandidates} label={candidateLabel} empty="no recent candidates" />
            </div>
            <div className="card">
              <h3 className="section-title">events ({data.events.length})</h3>
              <ListDetail items={data.events} label={eventLabel} empty="no events" />
            </div>
          </>
        )}
      </ServiceGate>
    </div>
  )
}
