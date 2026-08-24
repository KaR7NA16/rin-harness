import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { SettingsNavigation, SettingsOverview } from './SettingsHub'

describe('settings information architecture', () => {
  it('does not repeat the full category directory inside the overview', () => {
    render(
      <SettingsOverview
        title="设置"
        description="管理应用行为"
        statusCards={[]}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText('按任务配置')).not.toBeInTheDocument()
    expect(screen.queryByText('常规')).not.toBeInTheDocument()
  })

  it('keeps About as a footer entry instead of a settings category', () => {
    const onSelect = vi.fn()
    render(
      <SettingsNavigation
        sections={[]}
        activeTab="overview"
        overviewLabel="设置概览"
        searchLabel="搜索设置"
        searchPlaceholder="搜索设置"
        aboutLabel="关于"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    expect(onSelect).toHaveBeenCalledWith('about')
  })

  it('finds a setting by its user-facing keyword', () => {
    render(
      <SettingsNavigation
        sections={[{
          id: 'general',
          label: '常规',
          icon: 'tune',
          tabs: [{ id: 'general', label: '通用', searchText: '通用 主题 配色' }],
        }]}
        activeTab="overview"
        overviewLabel="设置概览"
        searchLabel="搜索设置"
        searchPlaceholder="搜索设置"
        noResultsLabel="没有找到匹配的设置"
        onSelect={vi.fn()}
      />,
    )

    const search = screen.getByRole('searchbox', { name: '搜索设置' })
    fireEvent.change(search, { target: { value: '主题' } })
    expect(screen.getByRole('button', { name: '通用' })).toBeInTheDocument()
    expect(screen.queryByText('没有找到匹配的设置')).not.toBeInTheDocument()
  })
})
