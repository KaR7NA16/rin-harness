import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'
import { MigrationStepper } from './MigrationStepper'

describe('MigrationStepper', () => {
  it('exposes the current migration phase and completed phases', () => {
    render(<MigrationStepper steps={['来源', '扫描', '选择', '预览', '完成']} activeStep={2} />)

    expect(screen.getByRole('list', { name: '迁移进度' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /来源.*已完成/ })).toHaveAttribute('data-state', 'complete')
    expect(screen.getByRole('listitem', { name: /选择.*当前/ })).toHaveAttribute('data-state', 'current')
    expect(screen.getByRole('listitem', { name: /预览.*未开始/ })).toHaveAttribute('data-state', 'upcoming')
  })
})
