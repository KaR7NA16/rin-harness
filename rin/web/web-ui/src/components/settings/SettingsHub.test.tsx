import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { SettingsNavigation, SettingsOverview, type SettingsNavSection } from './SettingsHub'

const sections: SettingsNavSection[] = [
  {
    id: 'experience',
    label: '基础体验',
    icon: 'tune',
    tabs: [
      { id: 'general', label: '通用' },
      { id: 'about', label: '关于' },
    ],
  },
  {
    id: 'execution',
    label: '模型与执行',
    icon: 'dns',
    tabs: [
      { id: 'providers', label: '模型供应商' },
      { id: 'behavior', label: '执行行为' },
    ],
  },
]

describe('SettingsNavigation', () => {
  it('shows the overview and all tabs as a flat list with group labels', () => {
    render(
      <SettingsNavigation
        sections={sections}
        activeTab="general"
        overviewLabel="设置概览"
        searchLabel="搜索设置"
        searchPlaceholder="搜索设置"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '设置概览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '模型供应商' })).toBeInTheDocument()
    expect(screen.getByText('基础体验')).toBeInTheDocument()
    expect(screen.getByText('模型与执行')).toBeInTheDocument()
  })

  it('searches across collapsed sections and selects the matched page', () => {
    const onSelect = vi.fn()
    render(
      <SettingsNavigation
        sections={sections}
        activeTab="general"
        overviewLabel="设置概览"
        searchLabel="搜索设置"
        searchPlaceholder="搜索设置"
        onSelect={onSelect}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索设置' }), { target: { value: '模型' } })
    fireEvent.click(screen.getByRole('button', { name: '模型供应商' }))

    expect(onSelect).toHaveBeenCalledWith('providers')
  })
})

describe('SettingsOverview', () => {
  it('only exposes actionable status entry points', () => {
    const onSelect = vi.fn()
    render(
      <SettingsOverview
        title="设置"
        description="配置 rin 的工作方式"
        statusCards={[
          { label: '模型', value: '未配置', detail: '先配置一个模型供应商', tone: 'warning', tab: 'providers' },
        ]}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByText('未配置')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /模型与执行/ })).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
