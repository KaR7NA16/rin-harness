import type { Mounted } from '../api'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { Overview } from '../overview'

export default function SkillMemoryPage() {
  const state = useApi<Mounted<Record<string, unknown>>>('/api/skill-memory/overview')

  return (
    <div className="page">
      <h1 className="page-title">SkillMemory</h1>
      <ServiceGate state={state}>
        {data => <Overview data={data} />}
      </ServiceGate>
    </div>
  )
}
