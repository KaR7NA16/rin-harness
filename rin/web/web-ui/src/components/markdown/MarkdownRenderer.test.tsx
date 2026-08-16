import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

import { MarkdownRenderer } from './MarkdownRenderer'
import { useSettingsStore } from '../../stores/settingsStore'

const openMock = { open: vi.fn(() => Promise.resolve()) }

vi.mock('@tauri-apps/plugin-shell', () => openMock)

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('applies document prose classes and custom width classes', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'# Skill Title\n\nReadable paragraph text.'}
        variant="document"
        className="mx-auto max-w-[72ch]"
      />,
    )

    const root = container.firstChild as HTMLDivElement
    expect(root).toBeInTheDocument()
    expect(root.className).toContain('prose-p:text-[15px]')
    expect(root.className).toContain('prose-h2:border-b')
    expect(root.className).toContain('mx-auto')
    expect(root.className).toContain('max-w-[72ch]')
    expect(screen.getByText('Skill Title')).toBeInTheDocument()
    expect(screen.getByText('Readable paragraph text.')).toBeInTheDocument()
  })

  it('keeps default variant free of document-only typography classes', () => {
    const { container } = render(
      <MarkdownRenderer content={'## Default Heading\n\nBody copy.'} />,
    )

    const root = container.firstChild as HTMLDivElement
    expect(root).toBeInTheDocument()
    expect(root.className).not.toContain('prose-p:text-[15px]')
    expect(root.className).not.toContain('prose-h2:border-b')
    expect(screen.getByText('Default Heading')).toBeInTheDocument()
    expect(screen.getByText('Body copy.')).toBeInTheDocument()
  })

  it('uses semantic code colors for inline code so both themes stay readable', () => {
    const { container } = render(
      <MarkdownRenderer content={'Use `claude-sonnet-4-6` for balanced speed.'} />,
    )

    const root = container.firstChild as HTMLDivElement
    expect(root).toBeInTheDocument()
    expect(root.className).toContain('prose-code:text-[var(--color-code-fg)]')
    expect(root.className).toContain('prose-code:bg-[var(--color-code-bg)]')
    expect(root.className).not.toContain('prose-code:text-[var(--color-primary-fixed)]')
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
  })

  it('renders mermaid fenced blocks with the Mermaid renderer', async () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TB\nA-->B\n```'} />)

    expect(await screen.findByText('Rendering diagram...')).toBeInTheDocument()
    expect(screen.queryByText('mermaid')).not.toBeInTheDocument()
  })

  it('detects mermaid diagrams even when the fence has no language tag', async () => {
    render(<MarkdownRenderer content={'```\ngraph TB\nA-->B\n```'} />)

    expect(await screen.findByText('Rendering diagram...')).toBeInTheDocument()
    expect(screen.queryByText('graph TB')).not.toBeInTheDocument()
  })

  it('keeps non-mermaid code fences in the normal code viewer', async () => {
    render(<MarkdownRenderer content={'```ts\nconst value = 1\n```'} />)

    expect(await screen.findByText('ts', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText('const value = 1', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('Rendering diagram...')).not.toBeInTheDocument()
  })

  it('wraps markdown tables for horizontal overflow handling', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'| Name | Value |\n| --- | --- |\n| `index.html` | Ready |'}
      />,
    )

    expect(container.querySelector('.md-table-wrap')).toBeInTheDocument()
    expect(screen.getByText('index.html')).toBeInTheDocument()
  })

  it('opens PDF links in the native preview modal', () => {
    render(<MarkdownRenderer content={'[Paper](assets/paper.pdf)'} />)

    const link = screen.getByRole('link', { name: 'Paper' })
    expect(link).toHaveAttribute('data-pdf-open', 'assets/paper.pdf')
    fireEvent.click(link)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.body.querySelector('iframe')).toHaveAttribute('src', 'assets/paper.pdf')
  })

  it('opens markdown links in a new tab safely', () => {
    render(<MarkdownRenderer content={'[OpenAI](https://openai.com)'} />)

    const link = screen.getByRole('link', { name: 'OpenAI' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('wraps file paths in prose into clickable path spans', () => {
    const { container } = render(
      <MarkdownRenderer content={'Fix the bug in src/components/chat/CodeViewer.tsx now.'} />,
    )

    const span = container.querySelector('[data-path-open]')
    expect(span).toBeInTheDocument()
    expect(span).toHaveAttribute('data-path-open', 'src/components/chat/CodeViewer.tsx')
    expect(span).toHaveTextContent('src/components/chat/CodeViewer.tsx')
  })

  it('does not turn URLs or casual slashed words into path spans', () => {
    const { container } = render(
      <MarkdownRenderer
        content={'See https://example.com/docs/article and port 80/443 for and/or traffic.'}
      />,
    )

    expect(container.querySelector('[data-path-open]')).not.toBeInTheDocument()
    expect(screen.getByText(/https:\/\/example.com\/docs/)).toBeInTheDocument()
    expect(screen.getByText(/port 80\/443/)).toBeInTheDocument()
  })

  it('skips paths nested inside markdown links', () => {
    const { container } = render(
      <MarkdownRenderer content={'[go to src/app/page.tsx](/docs/start)'} />,
    )

    expect(container.querySelector('[data-path-open]')).not.toBeInTheDocument()
  })

  it('opens the wrapped path when the path span is clicked', async () => {
    openMock.open.mockClear()

    const { container } = render(
      <MarkdownRenderer content={'See src/components/chat/CodeViewer.tsx for details.'} />,
    )
    const span = container.querySelector('[data-path-open]')
    expect(span).toBeInTheDocument()

    fireEvent.click(span as HTMLElement)
    await vi.waitFor(() => {
      expect(openMock.open).toHaveBeenCalledWith('src/components/chat/CodeViewer.tsx')
    })
  })
})
