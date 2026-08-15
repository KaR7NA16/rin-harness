import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { DayOfWeekPicker } from './DayOfWeekPicker'
import { useSettingsStore } from '../../../stores/settingsStore'

describe('DayOfWeekPicker', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders all 7 days', () => {
    render(<DayOfWeekPicker selected={[1]} onChange={vi.fn()} />)

    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button')).toHaveLength(7)
  })

  it('adds an unselected day on click', () => {
    const onChange = vi.fn()
    render(<DayOfWeekPicker selected={[1]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))

    expect(onChange).toHaveBeenCalledWith([1, 3])
  })

  it('removes a selected day when more than one is selected', () => {
    const onChange = vi.fn()
    render(<DayOfWeekPicker selected={[1, 3, 5]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Wed' }))

    expect(onChange).toHaveBeenCalledWith([1, 5])
  })

  it('does not allow deselecting the last remaining day', () => {
    const onChange = vi.fn()
    render(<DayOfWeekPicker selected={[1]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('handles Sunday (day 0) like any other day', () => {
    const onChange = vi.fn()
    render(<DayOfWeekPicker selected={[0]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sat' }))
    expect(onChange).toHaveBeenCalledWith([0, 6])

    onChange.mockClear()
    render(<DayOfWeekPicker selected={[0, 6]} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Sun' })[1]!)
    expect(onChange).toHaveBeenCalledWith([6])
  })
})
