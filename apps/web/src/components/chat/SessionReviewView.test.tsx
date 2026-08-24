import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from '../../types/chat'
import { SessionReviewView } from './SessionReviewView'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const map: Record<string, string> = {
      'review.title': 'Session review',
      'review.titleWithCount': 'Session review ({count} files)',
      'review.empty': 'No file changes in this session yet.',
      'review.selectFile': 'Select a file',
      'review.newFile': 'New file',
      'review.edit': 'Edit',
      'common.close': 'Close',
    }
    return map[key] ?? key
  },
}))

vi.mock('react-diff-viewer-continued', () => ({
  default: () => <div data-testid="mock-diff" />,
  DiffMethod: { WORDS: 'WORDS' },
}))

vi.mock('prism-react-renderer', () => ({
  Highlight: () => null,
}))

function toolUse(toolUseId: string, toolName: string, input: unknown): UIMessage {
  return { id: toolUseId, type: 'tool_use', toolName, toolUseId, input, timestamp: Date.now() }
}

const onClose = vi.fn()

describe('SessionReviewView', () => {
  beforeEach(() => {
    onClose.mockClear()
  })

  it('shows the empty state when no file edits exist', () => {
    render(<SessionReviewView messages={[]} onClose={onClose} />)
    expect(screen.getByText('No file changes in this session yet.')).toBeInTheDocument()
  })

  it('lists changed files and renders the selected diff', async () => {
    const messages: UIMessage[] = [
      toolUse('e1', 'Edit', { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }),
    ]
    render(<SessionReviewView messages={messages} onClose={onClose} />)

    expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(0)
    expect(await screen.findByTestId('mock-diff')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const messages: UIMessage[] = []
    render(<SessionReviewView messages={messages} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})