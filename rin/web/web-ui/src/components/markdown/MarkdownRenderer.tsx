import { lazy, Suspense, useMemo, useCallback, useState, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import { useTranslation } from '../../i18n'
import { PdfPreviewModal } from '../shared/PdfPreviewModal'

const CodeViewer = lazy(() => import('../chat/CodeViewer').then((module) => ({ default: module.CodeViewer })))
const MermaidRenderer = lazy(() => import('../chat/MermaidRenderer').then((module) => ({ default: module.MermaidRenderer })))

type Props = {
  content: string
  variant?: 'default' | 'document' | 'chat'
  className?: string
}

type CodeBlock = {
  id: string
  code: string
  language: string | undefined
}

const MERMAID_LANGUAGE = 'mermaid'
const PLAINTEXT_LANGUAGES = new Set(['', 'text', 'plaintext', 'plain'])
const MERMAID_DIAGRAM_START = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|requirementDiagram|quadrantChart|xychart-beta|sankey-beta|block-beta|packet-beta|architecture|kanban)\b/i

function normalizeCodeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().split(/\s+/)[0]?.toLowerCase()
  return normalized || undefined
}

function looksLikeMermaid(code: string): boolean {
  const firstMeaningfulLine = code
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return firstMeaningfulLine ? MERMAID_DIAGRAM_START.test(firstMeaningfulLine) : false
}

function shouldRenderAsMermaid(block: CodeBlock): boolean {
  const normalizedLanguage = normalizeCodeLanguage(block.language)

  if (normalizedLanguage === MERMAID_LANGUAGE) {
    return true
  }

  if (!PLAINTEXT_LANGUAGES.has(normalizedLanguage ?? '')) {
    return false
  }

  return looksLikeMermaid(block.code)
}

function createMarkedParser(codeBlocks: CodeBlock[]): Marked {
  const parser = new Marked({ breaks: true, gfm: true })
  const renderer = new parser.Renderer()

  renderer.code = function ({ text, lang }: Tokens.Code) {
    const id = `cb-${codeBlocks.length}`
    codeBlocks.push({
      id,
      code: text,
      language: normalizeCodeLanguage(lang || undefined),
    })
    return `<div data-codeblock-id="${id}"></div>`
  }

  parser.use({ renderer })
  return parser
}

const CALLOUT_RE = /^\[!(\w+)\](?:[+-])?\s*(.*)$/
const CALLOUT_TYPES = new Set(['note', 'info', 'tip', 'warning', 'danger', 'todo', 'example', 'abstract', 'success', 'question', 'failure', 'bug', 'quote'])

const FILE_PATH_CHARS = /[A-Za-z0-9_.@~-]/
const FILE_PATH_TOKEN_RE = /(?:[A-Za-z0-9_.@~-]+\/)+[A-Za-z0-9_.@~-]+/g

function topWithPathPrefix(path: string): boolean {
  return path.startsWith('/') || path.startsWith('./') || path.startsWith('../') || path.startsWith('~/')
}

function looksLikeFilePath(path: string, beforeChar: string | undefined): boolean {
  if (beforeChar === ':') return false // part of `scheme://` URLs
  if (path.includes('://')) return false
  const segments = path.split('/')
  if (segments.length < 2) return false

  const hasExtension = /[.][A-Za-z0-9]+$/.test(segments[segments.length - 1] ?? '')
  return topWithPathPrefix(path) || hasExtension || segments.length >= 3
}

/**
 * Finds file-path-shaped tokens inside a text node and replaces them with
 * clickable spans that open the path when clicked.
 *
 * A token qualifies as a path when it reads as a slash-delimited sequence,
 * is not part of a URL, and at least one of these holds:
 *  - it ends in a file extension,
 *  - it starts with `./`, `../`, `/` or `~/`,
 *  - it has at least three slash-delimited segments.
 */
function enhanceTextNode(textNode: Text): void {
  const text = textNode.nodeValue ?? ''
  if (!text.includes('/')) return

  const spans: Array<{ start: number; end: number; path: string }> = []

  FILE_PATH_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_PATH_TOKEN_RE.exec(text)) !== null) {
    let rawPath = match[0]
    const start = match.index
    let end = match.index + rawPath.length

    // Trim trailing sentence punctuation (`.`, `,`, `;`, `!`, `?`) from the path.
    const trimmed = rawPath.replace(/[.,;:!?]+$/, '')
    if (trimmed.length < rawPath.length) {
      end = start + trimmed.length
      rawPath = trimmed
    }

    const beforeChar = start > 0 ? text[start - 1] : undefined
    const afterBoundary = end >= text.length ? true : !FILE_PATH_CHARS.test(text.charAt(end))

    if (afterBoundary && looksLikeFilePath(rawPath, beforeChar)) {
      spans.push({ start, end, path: rawPath })
    }
  }

  if (spans.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, span.start)))
    }
    const el = document.createElement('span')
    el.setAttribute('data-path-open', span.path)
    el.className = 'md-file-path'
    el.textContent = span.path
    fragment.appendChild(el)
    cursor = span.end
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }
  textNode.parentNode?.replaceChild(fragment, textNode)
}

function enhanceMarkdownHtml(html: string): string {
  const cleanHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: ['use'],
    ADD_ATTR: ['xlink:href', 'data-pdf-open'],
  })

  if (typeof document === 'undefined') {
    return cleanHtml
  }

  const container = document.createElement('div')
  container.innerHTML = cleanHtml

  container.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('md-table-wrap')) return
    const wrapper = document.createElement('div')
    wrapper.className = 'md-table-wrap'
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
  })

  enhanceCallouts(container)

  container.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? ''
    if (/\.pdf(?:\?|#|$)/i.test(href)) {
      link.setAttribute('data-pdf-open', href)
      link.classList.add('md-pdf-link')
    }
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noreferrer noopener')
  })

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('a[href]')) continue
    textNodes.push(node)
  }
  for (const node of textNodes) {
    enhanceTextNode(node)
  }

  return container.innerHTML
}

/**
 * Convert Obsidian-style `> [!type] title` blockquotes into callout divs.
 * Unrecognized types and ordinary blockquotes are left untouched.
 */
function enhanceCallouts(container: HTMLElement): void {
  for (const quote of [...container.querySelectorAll('blockquote')]) {
    const firstParagraph = quote.querySelector(':scope > p')
    if (!firstParagraph) continue
    const match = CALLOUT_RE.exec(firstParagraph.textContent?.trim() ?? '')
    if (!match) continue
    const type = (match[1] ?? '').toLowerCase()
    if (!CALLOUT_TYPES.has(type)) continue
    const title = (match[2] ?? '').trim()
    const callout = document.createElement('div')
    callout.className = 'md-callout'
    callout.setAttribute('data-callout', type)
    const header = document.createElement('div')
    header.className = 'md-callout-title'
    header.textContent = title || type.charAt(0).toUpperCase() + type.slice(1)
    callout.appendChild(header)
    firstParagraph.remove()
    while (quote.firstChild) callout.appendChild(quote.firstChild)
    quote.replaceWith(callout)
  }
}

/** Suspense boundary shared by lazily loaded code/diagram renderers. */
function LazyRenderer({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}

function parseMarkdown(content: string): { html: string; codeBlocks: CodeBlock[] } {
  const codeBlocks: CodeBlock[] = []
  const parser = createMarkedParser(codeBlocks)
  const html = parser.parse(content) as string
  return { html, codeBlocks }
}

const BASE_PROSE_CLASSES = `markdown-prose prose prose-sm max-w-none text-[var(--color-text-primary)]
  prose-headings:text-[var(--color-text-primary)] prose-headings:font-semibold
  prose-p:my-2 prose-p:leading-relaxed
  prose-p:break-words
  prose-code:text-[13px] prose-code:text-[var(--color-code-fg)] prose-code:font-[var(--font-mono)] prose-code:bg-[var(--color-code-bg)] prose-code:border prose-code:border-[var(--color-border)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:hidden prose-code:after:hidden
  prose-pre:!bg-transparent prose-pre:!p-0 prose-pre:!shadow-none
  prose-a:text-[var(--color-text-accent)] prose-a:no-underline hover:prose-a:underline
  prose-strong:text-[var(--color-text-primary)]
  prose-ul:my-2 prose-ol:my-2
  prose-li:my-0.5
  prose-table:my-0 prose-table:w-full prose-table:table-auto prose-table:text-[14px]
  prose-th:bg-[var(--color-surface-info)] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:whitespace-normal prose-th:break-words prose-th:align-top prose-th:border-b prose-th:border-[var(--color-border)]
  prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-[var(--color-border)] prose-td:whitespace-normal prose-td:break-words prose-td:align-top prose-td:bg-[var(--color-surface)]
  [&_.md-table-wrap]:my-5 [&_.md-table-wrap]:overflow-x-auto [&_.md-table-wrap]:rounded-md [&_.md-table-wrap]:border [&_.md-table-wrap]:border-[var(--color-border)] [&_.md-table-wrap]:bg-[var(--color-surface-container-lowest)]`

const DOCUMENT_PROSE_CLASSES = `
  prose-p:text-[15px] prose-p:leading-7
  prose-headings:scroll-mt-6 prose-headings:tracking-[-0.01em]
  prose-h1:mb-4 prose-h1:text-2xl prose-h1:font-semibold prose-h1:leading-tight
  prose-h2:mt-8 prose-h2:mb-3 prose-h2:border-b prose-h2:border-[var(--color-border)] prose-h2:pb-2 prose-h2:text-xl prose-h2:font-semibold
  prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-[16px] prose-h3:font-semibold
  prose-h4:mt-5 prose-h4:mb-2 prose-h4:text-[14px] prose-h4:font-semibold
  prose-blockquote:my-4 prose-blockquote:rounded-r-lg prose-blockquote:border-l-4 prose-blockquote:border-[var(--color-outline-variant)] prose-blockquote:bg-[var(--color-surface-container-low)] prose-blockquote:px-4 prose-blockquote:py-2 prose-blockquote:italic
  prose-hr:my-6 prose-hr:border-[var(--color-border)]
  prose-img:rounded-lg prose-img:border prose-img:border-[var(--color-border)]
  prose-kbd:rounded prose-kbd:border prose-kbd:border-[var(--color-border)] prose-kbd:bg-[var(--color-surface-container-lowest)] prose-kbd:px-1.5 prose-kbd:py-0.5 prose-kbd:font-[var(--font-mono)] prose-kbd:text-[12px] prose-kbd:font-normal prose-kbd:text-[var(--color-text-secondary)] prose-kbd:shadow-none
  prose-ul:pl-5 prose-ul:[&>li]:marker:text-[var(--color-text-tertiary)]
  prose-ol:pl-5 prose-ol:[&>li]:marker:text-[var(--color-text-tertiary)]
  prose-li:my-1.5
  prose-table:my-0`

const CHAT_PROSE_CLASSES = `
  text-[15px] font-normal leading-relaxed tracking-normal text-[var(--color-text-primary)]
  prose-headings:my-0 prose-headings:text-[var(--color-text-primary)] prose-headings:font-bold prose-headings:tracking-normal
  prose-h1:text-[16px] prose-h1:leading-relaxed
  prose-h2:text-[16px] prose-h2:leading-relaxed
  prose-h3:text-[15px] prose-h3:leading-relaxed
  prose-h4:text-[15px] prose-h4:leading-relaxed
  prose-p:my-0 prose-p:text-[15px] prose-p:font-normal prose-p:leading-relaxed prose-p:text-[var(--color-text-primary)]
  prose-p:tracking-normal
  prose-strong:text-[var(--color-text-primary)] prose-strong:font-bold
  prose-em:text-[var(--color-text-secondary)]
  prose-a:text-[var(--color-text-accent)] prose-a:font-semibold prose-a:no-underline hover:prose-a:underline
  prose-ul:my-[8px] prose-ol:my-[8px] prose-ul:pl-[18px] prose-ol:pl-[18px]
  prose-li:my-[2px] prose-li:text-[15px] prose-li:font-normal prose-li:leading-relaxed prose-li:text-[var(--color-text-primary)]
  prose-blockquote:my-[10px] prose-blockquote:rounded-r-lg prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-border)] prose-blockquote:bg-[var(--color-surface-container-low)] prose-blockquote:px-[12px] prose-blockquote:py-[8px] prose-blockquote:text-[var(--color-text-secondary)] prose-blockquote:not-italic
  prose-code:text-[14px] prose-code:font-normal prose-code:text-[var(--color-code-fg)] prose-code:bg-[var(--color-code-bg)] prose-code:border-[var(--color-border)] prose-code:px-[5px] prose-code:py-[2px] prose-code:rounded-md
  prose-table:text-[14px]
  [&>p+p]:mt-[12px]
  [&>div+p]:mt-[12px]
  [&>p+div]:mt-[12px]
  [&_.md-table-wrap]:my-[12px] [&_.md-table-wrap]:rounded-lg [&_.md-table-wrap]:border-[var(--color-border)]`

function getProseClasses(variant: 'default' | 'document' | 'chat', className?: string) {
  return [
    BASE_PROSE_CLASSES,
    variant === 'document' ? DOCUMENT_PROSE_CLASSES : '',
    variant === 'chat' ? CHAT_PROSE_CLASSES : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function MarkdownRenderer({ content, variant = 'default', className }: Props) {
  const t = useTranslation()
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfName, setPdfName] = useState<string | undefined>(undefined)
  const { html, codeBlocks } = useMemo(() => parseMarkdown(content), [content])
  const proseClasses = useMemo(
    () => getProseClasses(variant, className),
    [variant, className],
  )

  const parts = useMemo(() => {
    if (codeBlocks.length === 0) {
      return [{ type: 'html' as const, content: html }]
    }

    const result: Array<{ type: 'html'; content: string } | { type: 'code'; block: CodeBlock }> = []
    let remaining = html

    for (const block of codeBlocks) {
      const marker = `<div data-codeblock-id="${block.id}"></div>`
      const idx = remaining.indexOf(marker)
      if (idx === -1) continue

      const before = remaining.slice(0, idx)
      if (before) {
        result.push({ type: 'html', content: before })
      }
      result.push({ type: 'code', block })
      remaining = remaining.slice(idx + marker.length)
    }

    if (remaining) {
      result.push({ type: 'html', content: remaining })
    }

    return result
  }, [html, codeBlocks])

  const handleClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest<HTMLButtonElement>('[data-copy-code]')
    if (button) {
      const text = button.getAttribute('data-copy-code')
      if (!text) return

      try {
        await navigator.clipboard.writeText(text)
        const original = button.textContent
        button.textContent = 'Copied'
        window.setTimeout(() => {
          button.textContent = original
        }, 1500)
      } catch {
        // Ignore clipboard errors
      }
      return
    }

    const pdfEl = target?.closest<HTMLElement>('[data-pdf-open]')
    if (pdfEl) {
      event.preventDefault()
      setPdfUrl(pdfEl.getAttribute('data-pdf-open') ?? '')
      setPdfName(pdfEl.textContent?.trim() || undefined)
      return
    }

    const pathEl = target?.closest<HTMLElement>('[data-path-open]')
    if (pathEl) {
      const path = pathEl.getAttribute('data-path-open')
      if (!path) return
      void import('@tauri-apps/plugin-shell')
        .then((mod) => mod.open(path))
        .catch(() => {
          // Ignore failures when not running inside Tauri
        })
    }
  }, [])

  const pdfPreview = pdfUrl !== null ? (
    <PdfPreviewModal open={pdfUrl !== null} url={pdfUrl} fileName={pdfName} onClose={() => setPdfUrl(null)} />
  ) : null

  if (codeBlocks.length === 0) {
    const cleanHtml = enhanceMarkdownHtml(html)
    return (
      <>
        {pdfPreview}
        <div
          className={proseClasses}
          dangerouslySetInnerHTML={{ __html: cleanHtml }}
          onClick={handleClick}
        />
      </>
    )
  }

  return (
    <>
      {pdfPreview}
      <div className={proseClasses} onClick={handleClick}>
      {parts.map((part, i) =>
        part.type === 'html' ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: enhanceMarkdownHtml(part.content) }} />
        ) : shouldRenderAsMermaid(part.block) ? (
          <LazyRenderer
            key={part.block.id}
            fallback={<div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">{t('mermaid.rendering')}</div>}
          >
            <MermaidRenderer code={part.block.code} />
          </LazyRenderer>
        ) : (
          <LazyRenderer
            key={part.block.id}
            fallback={<div className="my-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">{t('chat.codeViewer.loading')}</div>}
          >
            <div className="my-4">
              <CodeViewer
                code={part.block.code}
                language={part.block.language}
              />
            </div>
          </LazyRenderer>
        )
      )}
      </div>
    </>
  )
}
