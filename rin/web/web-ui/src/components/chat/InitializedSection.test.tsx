import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useSettingsStore } from '../../stores/settingsStore'
import { InitializedSection } from './InitializedSection'

describe('InitializedSection', () => {
  afterEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('renders a collapsed section listing the session tool count', () => {
    useSettingsStore.setState({ locale: 'en' })
    render(<InitializedSection tools={['Bash', 'Edit', 'Read', 'Grep']} />)

    expect(screen.getByText('Initialized your session')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.queryByText('Bash')).not.toBeInTheDocument()
  })

  it('expands to reveal the sub-tool list on click', () => {
    useSettingsStore.setState({ locale: 'en' })
    render(<InitializedSection tools={['Bash', 'Edit', 'Read']} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })
})