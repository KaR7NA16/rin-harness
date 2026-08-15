import { Icon } from '../shared/Icon'

export function MigrationStepper({ steps, activeStep }: { steps: string[]; activeStep: number }) {
  return (
    <ol className="settings-migration-stepper" aria-label="迁移进度">
      {steps.map((step, index) => {
        const state = index < activeStep ? 'complete' : index === activeStep ? 'current' : 'upcoming'
        const stateLabel = state === 'complete' ? '已完成' : state === 'current' ? '当前' : '未开始'
        return (
          <li key={step} data-state={state} aria-label={`${step} · ${stateLabel}`}>
            <span className="settings-migration-step-marker">
              {state === 'complete' ? <Icon name="check" size={13} /> : index + 1}
            </span>
            <span className="settings-migration-step-label">{step}</span>
            {index < steps.length - 1 && <span className="settings-migration-step-line" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
