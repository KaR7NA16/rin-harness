import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../shared/Icon'
import { searchSettings, type SettingsSearchEntry } from './settingsRegistry'

export type SettingsNavItem = {
  id: string
  label: string
  searchText?: string
  icon?: string
}

export type SettingsNavSection = {
  id: string
  label: string
  icon: string
  tabs: SettingsNavItem[]
}

export type SettingsOverviewStatus = {
  label: string
  value: string
  detail: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  tab: string
}

export function SettingsNavigation({
  sections,
  activeTab,
  overviewLabel,
  searchLabel,
  searchPlaceholder,
  noResultsLabel = 'No matching settings',
  searchEntries,
  aboutLabel,
  onSelect,
}: {
  sections: SettingsNavSection[]
  activeTab: string
  overviewLabel: string
  searchLabel: string
  searchPlaceholder: string
  noResultsLabel?: string
  searchEntries?: SettingsSearchEntry[]
  aboutLabel?: string
  onSelect: (tab: string, target?: string) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchableEntries = useMemo<SettingsSearchEntry[]>(() => searchEntries ?? sections.flatMap((section) => section.tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    description: tab.searchText ?? '',
    keywords: tab.searchText?.split(/\s+/).filter(Boolean) ?? [],
    sectionLabel: section.label,
    tab: tab.id,
  }))), [searchEntries, sections])
  const searchResults = useMemo(() => searchSettings(normalizedQuery, searchableEntries), [normalizedQuery, searchableEntries])

  const selectTab = (tab: string) => {
    setQuery('')
    onSelect(tab)
  }

  return (
    <nav className="settings-navigation" aria-label={overviewLabel}>
      <label className="settings-navigation-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          role="searchbox"
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="settings-navigation-search-clear"
            aria-label={searchLabel}
            onClick={() => setQuery('')}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </label>

      <button
        type="button"
        className={`settings-navigation-overview ${activeTab === 'overview' ? 'is-active' : ''}`}
        aria-current={activeTab === 'overview' ? 'page' : undefined}
        onClick={() => selectTab('overview')}
      >
        <Icon name="layout" size={16} />
        <span>{overviewLabel}</span>
      </button>

      {normalizedQuery ? (
        <div className="settings-navigation-results" aria-label={searchLabel}>
          {searchResults.length > 0 ? searchResults.map((result) => (
            <button
              type="button"
              key={result.id}
              className={`settings-navigation-item ${activeTab === result.tab ? 'is-active' : ''}`}
              aria-label={result.label}
              aria-current={activeTab === result.tab ? 'page' : undefined}
              onClick={() => {
                setQuery('')
                if (result.target) onSelect(result.tab, result.target)
                else onSelect(result.tab)
              }}
            >
              <span className="settings-navigation-item-label">{result.label}</span>
              <span className="settings-navigation-item-meta">{result.sectionLabel}</span>
            </button>
          )) : (
            <p className="settings-navigation-empty">{noResultsLabel}</p>
          )}
        </div>
      ) : (
        <div className="settings-navigation-sections">
          {sections.map((section) => {
            const tab = section.tabs[0]
            if (section.tabs.length === 1 && tab) {
              return (
                <button
                  type="button"
                  className={`settings-navigation-section-button ${activeTab === tab.id ? 'is-active' : ''}`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  key={section.id}
                  onClick={() => selectTab(tab.id)}
                >
                  <span className="settings-navigation-section-icon">
                    <Icon name={section.icon} size={15} />
                  </span>
                  <span>{section.label}</span>
                </button>
              )
            }
            return (
              <div className="settings-navigation-section" key={section.id}>
                <p className="settings-navigation-group-label">{section.label}</p>
                <div className="settings-navigation-subitems">
                  {section.tabs.map((tab) => (
                    <button
                      type="button"
                      key={tab.id}
                      className={`settings-navigation-item ${activeTab === tab.id ? 'is-active' : ''}`}
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      onClick={() => selectTab(tab.id)}
                    >
                      {tab.icon && (
                        <span className="settings-navigation-item-icon">
                          <Icon name={tab.icon} size={14} />
                        </span>
                      )}
                      <span className="settings-navigation-item-label">{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {aboutLabel && (
        <button
          type="button"
          className={`settings-navigation-about ${activeTab === 'about' ? 'is-active' : ''}`}
          aria-current={activeTab === 'about' ? 'page' : undefined}
          onClick={() => selectTab('about')}
        >
          <Icon name="info" size={15} />
          <span>{aboutLabel}</span>
        </button>
      )}
    </nav>
  )
}

export function SettingsOverview({
  title,
  description,
  statusCards,
  emptyStatusLabel,
  onSelect,
}: {
  title: string
  description: string
  statusCards: SettingsOverviewStatus[]
  emptyStatusLabel?: string
  onSelect: (tab: string) => void
}) {
  return (
    <div className="settings-overview" data-testid="settings-overview">
      <header className="settings-overview-header">
        <div>
          <h1>{title}</h1>
          <p className="settings-overview-description">{description}</p>
        </div>
        <div className="settings-overview-mark" aria-hidden="true">
          <Icon name="tune" size={20} />
        </div>
      </header>

      <section className="settings-overview-status" aria-label={title}>
        {statusCards.length === 0 && emptyStatusLabel ? (
          <p className="settings-overview-status-empty">{emptyStatusLabel}</p>
        ) : statusCards.map((card) => (
          <button
            type="button"
            key={card.label}
            className={`settings-overview-status-card tone-${card.tone}`}
            onClick={() => onSelect(card.tab)}
          >
            <span className="settings-overview-status-label">{card.label}</span>
            <strong>{card.value}</strong>
            <span className="settings-overview-status-detail">{card.detail}</span>
            <Icon name="arrow_forward" size={14} />
          </button>
        ))}
      </section>

    </div>
  )
}

export function SettingsStatusDot({ tone, children }: { tone: SettingsOverviewStatus['tone']; children: ReactNode }) {
  return (
    <span className={`settings-status-dot tone-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  )
}
