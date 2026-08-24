import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notesApi } from '../api/notes'
import { useSettingsStore } from '../stores/settingsStore'
import { Queries } from './Queries'

vi.mock('../api/notes', () => ({
  notesApi: {
    query: vi.fn(),
  },
}))

const query = vi.mocked(notesApi.query)

describe('Queries', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ locale: 'en' })
    query.mockReset()
    query.mockResolvedValue({
      kind: 'notes',
      notes: [
        { path: 'z.md', name: 'z', folder: '', title: 'Zeta', tags: ['project'], fields: [], modifiedAt: '2026-02-02' },
        { path: 'a.md', name: 'a', folder: '', title: 'Alpha', tags: ['project'], fields: [], modifiedAt: '2026-02-01' },
      ],
    })
  })

  it('runs a query and exposes examples, history, sorting, and grouping', async () => {
    render(<Queries />)

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('a.md')).toBeInTheDocument()
    expect(query).toHaveBeenCalledWith('FROM #project WHERE status = active SORT due ASC')
    expect(screen.getByRole('button', { name: 'Example 1' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'History' })).toBeInTheDocument()

    const sort = screen.getAllByRole('combobox').find(
      (element) => (element as HTMLSelectElement).value === 'path',
    ) as HTMLSelectElement
    fireEvent.change(sort, { target: { value: 'title' } })
    expect(sort).toHaveValue('title')

    const group = screen.getAllByRole('combobox').find(
      (element) => (element as HTMLSelectElement).value === 'none',
    ) as HTMLSelectElement
    fireEvent.change(group, { target: { value: 'folder' } })
    expect(group).toHaveValue('folder')
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('loads an example into the editor without running it', async () => {
    render(<Queries />)

    fireEvent.click(screen.getByRole('button', { name: 'Example 2' }))
    expect(screen.getByRole('textbox', { name: 'e.g. FROM #project WHERE status = active SORT due ASC' })).toHaveValue('TASKS FROM #project SORT due ASC')
    await waitFor(() => expect(query).not.toHaveBeenCalled())
  })
})
