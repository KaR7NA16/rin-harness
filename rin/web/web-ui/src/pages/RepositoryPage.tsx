import { useState } from 'react'
import type {
  AssetRepository,
  EnvironmentPackage,
  EnvironmentPackageCatalog,
  EnvironmentProfile,
  RepositoryAgentConfiguration,
} from '../types'
import { useApi } from '../useApi'
import { ViewGate } from '../components/Gate'
import { KeyValue } from '../components/KeyValue'
import { JsonDetail } from '../components/JsonDetail'
import type { ListItemLabel } from '../components/ListDetail'

interface Selection {
  title: string
  value: unknown
}

function catalogLabel(catalog: EnvironmentPackageCatalog): ListItemLabel {
  const name = catalog.metadata.name || catalog.metadata.id
  return { title: name, subtitle: 'catalog · ' + catalog.spec.ecosystem }
}

function packageLabel(pkg: EnvironmentPackage): ListItemLabel {
  const parts = [pkg.ecosystem, pkg.version].filter(value => value !== undefined && value !== '')
  return { title: pkg.name || pkg.id, subtitle: parts.length > 0 ? parts.join(' · ') : 'package' }
}

function profileLabel(profile: EnvironmentProfile): ListItemLabel {
  const name = profile.metadata.name || profile.metadata.id
  return { title: name, subtitle: profile.spec.packages.length + ' packages' }
}

function agentLabel(agent: RepositoryAgentConfiguration): ListItemLabel {
  return { title: agent.name, subtitle: agent.description || 'agent' }
}

export default function RepositoryPage() {
  const [root, setRoot] = useState('')
  const [appliedRoot, setAppliedRoot] = useState('')
  const path = appliedRoot === ''
    ? '/api/repository'
    : '/api/repository?root=' + encodeURIComponent(appliedRoot)
  const state = useApi<AssetRepository>(path)

  return (
    <div className="page">
      <h1 className="page-title">Repository</h1>
      <div className="page-toolbar">
        <label className="field-label" htmlFor="repo-root">root</label>
        <input
          id="repo-root"
          type="text"
          value={root}
          onChange={event => setRoot(event.target.value)}
          placeholder="optional repository root"
        />
        <button type="button" onClick={() => setAppliedRoot(root.trim())}>Load</button>
      </div>
      <ViewGate state={state}>
        {repo => <RepositoryView repo={repo} />}
      </ViewGate>
    </div>
  )
}

function RepositoryView({ repo }: { repo: AssetRepository }) {
  const [selected, setSelected] = useState<Selection | null>(null)
  const meta = repo.manifest.metadata
  const spec = repo.manifest.spec

  const select = (title: string, value: unknown) => setSelected({ title, value })

  return (
    <div className="two-pane">
      <div className="list-pane">
        <h3 className="section-title">manifest</h3>
        <KeyValue name="id" value={meta.id} />
        <KeyValue name="name" value={meta.name} />
        <KeyValue name="version" value={meta.version} />
        <KeyValue name="kind" value={repo.manifest.kind} />
        <KeyValue name="mutable" value={spec.mutable} />

        <h3 className="section-title">roots</h3>
        {Object.entries(spec.roots).map(([key, value]) => (
          <KeyValue key={key} name={key} value={value} />
        ))}

        <h3 className="section-title">paths</h3>
        <KeyValue name="rootPath" value={repo.rootPath} />
        <KeyValue name="manifestPath" value={repo.manifestPath} />

        <AssetGroup
          title={'environment catalogs (' + repo.environmentCatalogs.length + ')'}
          items={repo.environmentCatalogs}
          label={catalogLabel}
          onSelect={select}
        />
        <AssetGroup
          title={'environment packages (' + repo.environmentPackages.length + ')'}
          items={repo.environmentPackages}
          label={packageLabel}
          onSelect={select}
        />
        <AssetGroup
          title={'environment profiles (' + repo.environmentProfiles.length + ')'}
          items={repo.environmentProfiles}
          label={profileLabel}
          onSelect={select}
        />
        <AssetGroup
          title={'agents (' + repo.agents.length + ')'}
          items={repo.agents}
          label={agentLabel}
          onSelect={select}
        />
      </div>
      <div className="detail-pane">
        {selected === null ? (
          <div className="muted">Select an asset to inspect it.</div>
        ) : (
          <>
            <div className="detail-header">{selected.title}</div>
            <JsonDetail value={selected.value} />
          </>
        )}
      </div>
    </div>
  )
}

function AssetGroup<T>(props: {
  title: string
  items: T[]
  label: (item: T) => ListItemLabel
  onSelect: (title: string, value: unknown) => void
}) {
  const { title, items, label, onSelect } = props
  return (
    <section>
      <h3 className="section-title">{title}</h3>
      {items.length === 0 ? (
        <div className="muted">none</div>
      ) : (
        <ul className="item-list">
          {items.map((item, index) => {
            const entry = label(item)
            return (
              <li key={index}>
                <button
                  type="button"
                  className="item-button"
                  onClick={() => onSelect(entry.title, item)}
                >
                  <span className="item-title">{entry.title}</span>
                  {entry.subtitle !== undefined ? <span className="item-subtitle">{entry.subtitle}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
