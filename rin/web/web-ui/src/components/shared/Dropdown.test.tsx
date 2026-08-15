import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { Dropdown } from './Dropdown'

const ITEMS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
] as const

function renderDropdown(onChange = vi.fn()) {
  render(
    <Dropdown
      items={[...ITEMS]}
      value="alpha"
      onChange={onChange}
      trigger={<button type="button">Open menu</button>}
    />,
  )
  return onChange
}

function getTrigger() {
  return screen.getByText('Open menu').closest('[aria-haspopup]')!
}

describe('Dropdown', () => {
  it('is closed by default with correct aria attributes', () => {
    renderDropdown()

    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
    expect(getTrigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on trigger click and reflects aria-expanded', () => {
    renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))

    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls onChange and closes when an option is clicked', () => {
    const onChange = renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))

    expect(onChange).toHaveBeenCalledWith('gamma')
    expect(screen.queryByRole('button', { name: 'Gamma' })).not.toBeInTheDocument()
  })

  it('focuses the selected option when opened', () => {
    renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))

    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus()
  })

  it('cycles focus with ArrowDown and ArrowUp', () => {
    renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))
    const menu = screen.getByRole('button', { name: 'Alpha' })

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Gamma' })).toHaveFocus()

    // wraps around to the first item
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus()

    // wraps around to the last item
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Gamma' })).toHaveFocus()
  })

  it('selects the focused option with Enter', () => {
    const onChange = renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('beta')
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderDropdown()

    fireEvent.click(screen.getByText('Open menu'))
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })
})
