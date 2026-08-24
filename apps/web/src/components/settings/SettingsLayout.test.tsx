import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { SegmentedControl, SettingsPage } from './SettingsLayout'

describe('SettingsPage', () => {
  it('renders the in-page title alongside the breadcrumb-owned top bar', () => {
    render(
      <SettingsPage icon="dns" title="大模型" description="配置模型供应商">
        <div>content</div>
      </SettingsPage>,
    )

    expect(screen.getByRole('heading', { name: '大模型' })).toBeInTheDocument()
    expect(screen.getByText('配置模型供应商')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('exposes the selected segmented option to assistive technology', () => {
    render(
      <SegmentedControl
        ariaLabel="Theme"
        items={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        value="dark"
        onChange={() => undefined}
      />,
    )

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
  })
})
