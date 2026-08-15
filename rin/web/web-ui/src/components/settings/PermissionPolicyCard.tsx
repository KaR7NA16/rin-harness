import { Icon } from '../shared/Icon'

export function PermissionPolicyCard({
  icon,
  label,
  description,
  risk,
  riskLabel,
  selected,
  onSelect,
}: {
  icon: string
  label: string
  description: string
  risk: 'safe' | 'balanced' | 'danger'
  riskLabel?: string
  selected: boolean
  onSelect: () => void
}) {
  const visibleRiskLabel = riskLabel ?? (risk === 'danger' ? '高风险' : risk === 'balanced' ? '平衡' : '安全')
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`settings-policy-card ${risk === 'danger' ? 'settings-policy-card-danger' : ''} ${selected ? 'is-selected' : ''}`}
    >
      <Icon name={icon} size={20} className="settings-policy-card-icon" />
      <span className="settings-policy-card-copy">
        <span className="settings-policy-card-title">
          <strong>{label}</strong>
          <span className="settings-policy-card-risk">{visibleRiskLabel}</span>
        </span>
        <span className="settings-policy-card-description">{description}</span>
      </span>
      {selected && <Icon name="check_circle" size={18} className="settings-policy-card-check" />}
    </button>
  )
}
