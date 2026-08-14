import { useState } from 'react'
import type { AssetRepository, ResolvedEnvironmentPlan } from '../types'
import { useApi } from '../useApi'
import { ViewGate } from '../components/Gate'
import { Badge, toneForStatus } from '../components/Badge'
import { KeyValue } from '../components/KeyValue'

export default function EnvironmentPage() {
  const repoState = useApi<AssetRepository>('/api/repository')
  const [profileId, setProfileId] = useState('')
  const planPath = profileId === ''
    ? null
    : '/api/environment/plan?profile=' + encodeURIComponent(profileId)
  const planState = useApi<ResolvedEnvironmentPlan>(planPath)

  return (
    <div className="page">
      <h1 className="page-title">Environment</h1>
      <ViewGate state={repoState}>
        {repo => (
          <>
            <div className="page-toolbar">
              <label className="field-label" htmlFor="profile-select">profile</label>
              <select
                id="profile-select"
                value={profileId}
                onChange={event => setProfileId(event.target.value)}
              >
                <option value="">— select a profile —</option>
                {repo.environmentProfiles.map(profile => (
                  <option key={profile.metadata.id} value={profile.metadata.id}>
                    {profile.metadata.name || profile.metadata.id}
                  </option>
                ))}
              </select>
            </div>
            {profileId === '' ? (
              <div className="muted">Select a profile to build its install plan.</div>
            ) : (
              <ViewGate state={planState}>
                {plan => <PlanView plan={plan} />}
              </ViewGate>
            )}
          </>
        )}
      </ViewGate>
    </div>
  )
}

function PlanView({ plan }: { plan: ResolvedEnvironmentPlan }) {
  return (
    <>
      <div className="card">
        <KeyValue name="profileId" value={plan.profileId} />
        <KeyValue name="profileVersion" value={plan.profileVersion} />
        <KeyValue name="packageCount" value={plan.packageCount} />
        <div className="kv-row">
          <span className="kv-key">status</span>
          <Badge value={plan.status} tone={toneForStatus(plan.status)} />
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">preflight</h3>
        {plan.preflight.length === 0 ? (
          <div className="muted">no preflight checks</div>
        ) : (
          <div className="preflight-list">
            {plan.preflight.map(check => (
              <div key={check.id} className="preflight-item">
                <Badge value={check.status} tone={toneForStatus(check.status)} />
                <span className="mono preflight-id">{check.id}</span>
                {check.message !== '' ? <span className="preflight-msg">{check.message}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">stages</h3>
        {plan.stages.length === 0 ? (
          <div className="muted">{plan.status === 'blocked' ? 'blocked plan: no stages emitted' : 'no stages'}</div>
        ) : (
          plan.stages.map(stage => (
            <div key={stage.id} className="stage">
              <div className="stage-head"><span className="mono stage-id">{stage.id}</span></div>
              {stage.commands.length === 0 ? (
                <div className="muted">no commands</div>
              ) : (
                <pre className="stage-commands">{stage.commands.join('\n')}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}
