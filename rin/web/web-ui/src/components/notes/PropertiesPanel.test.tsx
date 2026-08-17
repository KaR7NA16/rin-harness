import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notesApi } from '../../api/notes'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { PropertiesPanel } from './PropertiesPanel'

vi.mock('../../api/notes', () => ({
  notesApi: {
    properties: vi.fn(),
    updateProperties: vi.fn(),
  },
}))

const properties = vi.mocked(notesApi.properties)
const updateProperties = vi.mocked(notesApi.updateProperties)

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useUIStore.setState({ toasts: [] })
  vi.clearAllMocks()
  properties.mockResolvedValue({ mounted: true, properties: { title: 'Alpha', tags: ['a', 'b'], aliases: ['A'] } })
  updateProperties.mockResolvedValue({ mounted: true, note: { content: '' } })
})

describe('PropertiesPanel', () => {
  it('loads title, tags, and aliases from frontmatter', async () => {
    render(<PropertiesPanel path="a.md" onChanged={() => {}} />)

    expect(await screen.findByDisplayValue('Alpha')).toBeInTheDocument()
    expect(screen.getByDisplayValue('a, b')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A')).toBeInTheDocument()
  })

  it('saves normalized tags and aliases while preserving unknown keys', async () => {
    properties.mockResolvedValue({ mounted: true, properties: { title: 'Alpha', tags: ['a'], custom: true } })
    const onChanged = vi.fn()
    render(<PropertiesPanel path="a.md" onChanged={onChanged} />)

    fireEvent.change(await screen.findByDisplayValue('a'), { target: { value: 'b, c' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateProperties).toHaveBeenCalledWith('a.md', {
        title: 'Alpha',
        tags: ['b', 'c'],
        custom: true,
      })
    })
    expect(onChanged).toHaveBeenCalledOnce()
  })
})
