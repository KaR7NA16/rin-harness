import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { PermissionPolicyCard } from './PermissionPolicyCard'

describe('PermissionPolicyCard', () => {
  it('makes the dangerous policy visually and semantically explicit', () => {
    render(
      <PermissionPolicyCard
        icon="bolt"
        label="跳过全部"
        description="跳过所有权限检查"
        risk="danger"
        selected
        onSelect={vi.fn()}
      />,
    )

    const card = screen.getByRole('button', { name: /跳过全部/ })
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveClass('settings-policy-card-danger')
    expect(screen.getByText('高风险')).toBeInTheDocument()
  })

  it('emits the selection action for a normal policy', () => {
    const onSelect = vi.fn()
    render(
      <PermissionPolicyCard
        icon="verified_user"
        label="询问权限"
        description="执行敏感操作前询问"
        risk="safe"
        selected={false}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /询问权限/ }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
