import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { IconRail, getVisibleRailItemCount } from './IconRail'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('IconRail floating panel navigation', () => {
  const renderIconRail = (topRailHeight: number | null = null) => render(<IconRail __testTopRailHeight={topRailHeight} />)

  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ locale: 'zh' })
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
    useUIStore.setState({
      settingsOpen: false,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      railSettingsView: null,
    })
  })

  it('opens automation as a single-instance workspace without creating a top tab', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '定时任务' }))

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useUIStore.getState().workspaceView).toBe('scheduled')
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('opens terminal as a main-area tab', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '终端' }))

    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({ type: 'terminal' }),
    ])
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('opens work as a single-instance workspace', () => {
    renderIconRail()

    fireEvent.click(screen.getByRole('button', { name: '笔记' }))
    expect(useTabStore.getState().tabs).toEqual([])
    expect(useUIStore.getState().workspaceView).toBe('notes')
  })

  it('groups Agent configuration under the Assets overflow instead of a top-level rail button', () => {
    useSettingsStore.setState({ locale: 'en' })
    renderIconRail()

    expect(screen.queryByRole('button', { name: 'Agent configuration' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agent configuration' }))

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useUIStore.getState().workspaceView).toBe('agents')
  })

  it('keeps configuration entries off the rail (they live in settings home)', () => {
    renderIconRail()

    for (const name of ['大模型', 'MCP', '插件', '记忆', '权限', 'Agents', '技能', 'IM 接入', 'Agent 数据迁移']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()
  })

  it('moves direct rail icons into More when the top rail height is tight', () => {
    const directItems = 6
    const pinnedMoreItems = 5

    expect(getVisibleRailItemCount(null, directItems, pinnedMoreItems, false)).toBe(6)
    expect(getVisibleRailItemCount(256, directItems, pinnedMoreItems, false)).toBe(3)
    expect(getVisibleRailItemCount(255, directItems, pinnedMoreItems, false)).toBe(2)
    expect(getVisibleRailItemCount(46, directItems, pinnedMoreItems, false)).toBe(0)
  })

  it('keeps Settings pinned while overflowing upper rail icons into More', () => {
    renderIconRail(256)

    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Agent 数据迁移' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大模型' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IM 接入' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('uses a left border when mounted as the right-side fixed rail', () => {
    renderIconRail()

    const rail = document.querySelector('.icon-rail-glass')
    expect(rail).toHaveClass('border-l')
    expect(rail).not.toHaveClass('border-r')
  })

})
