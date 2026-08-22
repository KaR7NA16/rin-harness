import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notesApi } from '../api/notes'
import { useSettingsStore } from '../stores/settingsStore'
import { Tags } from './Tags'

vi.mock('../api/notes', () => ({
  notesApi: {
    list: vi.fn(),
    renameTag: vi.fn(),
  },
}))

const list = vi.mocked(notesApi.list)
const renameTag = vi.mocked(notesApi.renameTag)

function tagButton(tag: string, count: number): HTMLButtonElement {
  const label = '#' + tag + count
  return screen.getAllByRole('button').find((button) => button.textContent?.replace(/\s+/g, '') === label) as HTMLButtonElement
}

describe('Tags', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    list.mockReset()
    renameTag.mockReset()
    list.mockResolvedValue({
      notes: [
        { path: 'work/alpha.md', name: 'alpha', folder: 'work', title: 'Alpha', sizeBytes: 1, modifiedAt: '2026-02-01', tags: ['project', 'work'], links: [] },
        { path: 'work/beta.md', name: 'beta', folder: 'work', title: 'Beta', sizeBytes: 1, modifiedAt: '2026-02-02', tags: ['project'], links: [] },
      ],
    })
    renameTag.mockResolvedValue({ mounted: true, result: { renamed: 1, paths: ['work/alpha.md'] } })
  })

  it('filters notes by multiple tags and shows related aggregation', async () => {
    render(<Tags />)

    await screen.findByText('#project')
    fireEvent.click(tagButton('project', 2))
    fireEvent.click(tagButton('work', 1))

    expect(screen.getByText('1 matching notes')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renames a tag through the Notes API', async () => {
    render(<Tags />)

    await screen.findByText('#project')
    fireEvent.click(tagButton('project', 2))
    fireEvent.click(screen.getByRole('button', { name: 'Rename tag #project' }))
    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'initiative' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply tag rename' }))

    await waitFor(() => expect(renameTag).toHaveBeenCalledWith('project', 'initiative'))
    expect(list).toHaveBeenCalledTimes(2)
  })
})
