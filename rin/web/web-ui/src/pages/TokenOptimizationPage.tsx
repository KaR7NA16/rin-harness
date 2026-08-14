import type { Mounted } from '../api'
import type { SmartPruningStatus } from '../types'
import { useApi } from '../useApi'
import { ServiceGate } from '../components/Gate'
import { StatusDot } from '../components/StatusDot'
import { KeyValue } from '../components/KeyValue'

export default function TokenOptimizationPage() {
  const state = useApi<Mounted<SmartPruningStatus>>('/api/smart-pruning/status')

  return (
    <div className="page">
      <h1 className="page-title">TokenOptimization</h1>
      <ServiceGate state={state}>
        {data => (
          <div className="card">
            <div className="kv-row">
              <span className="kv-key">mounted</span>
              <StatusDot on={true} />
              <code>true</code>
            </div>
            <KeyValue name="enabled" value={data.enabled} />
            <KeyValue name="level" value={data.level} />
            <KeyValue name="mode" value={data.mode} />
          </div>
        )}
      </ServiceGate>
    </div>
  )
}
