import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../api/notes', () => ({
  notesApi: {
    list: vi.fn().mockResolvedValue({ notes: [] }),
    templates: vi.fn().mockResolvedValue({ templates: [] }),
    graph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    todos: vi.fn().mockResolvedValue({ todos: [] }),
  },
}))

import { Notes } from '../pages/Notes'
import { ContentRouter } from '../components/layout/ContentRouter'
import { useTabStore } from '../stores/tabStore'

describe('notes smoke', () => {
  it('renders Notes page without crashing', () => {
    render(<Notes />)
    expect(document.body).toBeTruthy()
  })

  it('renders ContentRouter with notes tab active', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__notes__', title: 'Notes', type: 'notes', status: 'idle' }],
      activeTabId: '__notes__',
      recentSessionIds: [],
    })
    render(<ContentRouter />)
    expect(document.body).toBeTruthy()
  })
})
