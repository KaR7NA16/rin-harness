import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, FileUp, PencilLine, Save, SplitSquareHorizontal } from 'lucide-react'
import { getBaseUrl } from '../../api/client'
import { notesApi } from '../../api/notes'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'

type ViewMode = 'edit' | 'split' | 'preview'

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const MAX_PDF_BYTES = 64 * 1024 * 1024

function preprocessContent(content: string): string {
  // wikilink → 可点击锚点 (#note/<target>), 点击时由容器拦截
  let out = content.replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim()
    return `[${label}](#note/${encodeURIComponent(target.trim())})`
  })
  // PDF 资产 → 普通链接，由 MarkdownRenderer 打开内嵌预览
  out = out.replace(/!\[([^\]]*)\]\(((?:\.\/)?assets\/[^)]+\.pdf)\)/gi, (_m, label: string, assetPath: string) => {
    const title = (label || 'PDF').trim()
    const cleanPath = assetPath.replace(/^\.\//, '')
    return `[${title}](${getBaseUrl()}/api/notes/assets/assets/${cleanPath})`
  })
  out = out.replace(/\]\(((?:\.\/)?assets\/[^)]+\.pdf)\)/gi, (_m, assetPath: string) => {
    const cleanPath = assetPath.replace(/^\.\//, '')
    return `](${getBaseUrl()}/api/notes/assets/assets/${cleanPath})`
  })
  // 其余本地资源 → sidecar 绝对 URL (相对路径会落到 webview origin, 取不到)
  out = out.replace(/]\((?:\.\/)?assets\//g, `](${getBaseUrl()}/api/notes/assets/assets/`)
  return out
}

export function NoteEditor({
  path,
  onSaved,
  onOpenLink,
  onOrganize,
  jumpToHeading,
}: {
  path: string
  onSaved: () => void
  onOpenLink: (target: string) => void
  onOrganize: (cb: (() => void) | null) => void
  jumpToHeading?: string | null
}) {
  const t = useTranslation()
  const addToast = useUIStore(s => s.addToast)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveTab = useTabStore(s => s.setActiveTab)
  const sendMessage = useChatStore(s => s.sendMessage)

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const dirty = content !== savedContent
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const savedContentRef = useRef('')
  savedContentRef.current = savedContent

  useEffect(() => {
    setLoading(true)
    void notesApi.read(path)
      .then(doc => {
        setContent(doc.content)
        setSavedContent(doc.content)
        setTitle(doc.title)
      })
      .catch(error => addToast({ type: 'error', message: String(error) }))
      .finally(() => setLoading(false))
  }, [path, addToast])

  const save = useCallback(async (value: string) => {
    setSaving(true)
    try {
      await notesApi.write(path, value)
      setSavedContent(value)
      onSaved()
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    } finally {
      setSaving(false)
    }
  }, [path, onSaved, addToast])

  // 自动保存 (debounce 1.2s)
  useEffect(() => {
    if (!dirty) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(contentRef.current), 1200)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [content, dirty, save])

  // 卸载前保存
  useEffect(() => {
    return () => {
      if (contentRef.current !== savedContentRef.current) void save(contentRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save(contentRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // 大纲跳转: 预览滚动到对应标题
  useEffect(() => {
    if (!jumpToHeading) return
    const el = previewRef.current
    if (!el) return
    const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const h of headings) {
      const slug = (h.textContent ?? '').trim().toLowerCase().replace(/\s+/g, '-')
      if (slug === jumpToHeading) {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' })
        break
      }
    }
  }, [jumpToHeading])

  // 预览区点击: 拦截 wikilink 锚点
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (href.startsWith('#note/')) {
        e.preventDefault()
        onOpenLink(decodeURIComponent(href.slice(6)))
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [onOpenLink, viewMode])

  // Tab → 两个空格; Enter → 列表/任务/引用自动续行 (Obsidian 手感)
  const onEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (e.key === 'Tab') {
      e.preventDefault()
      const pos = el.selectionStart ?? 0
      const next = contentRef.current.slice(0, pos) + '  ' + contentRef.current.slice(el.selectionEnd ?? pos)
      setContent(next)
      requestAnimationFrame(() => el.setSelectionRange(pos + 2, pos + 2))
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const pos = el.selectionStart ?? 0
      const before = contentRef.current.slice(0, pos)
      const line = before.split('\n').pop() ?? ''
      const m = line.match(/^(\s*(?:[-*+] \[[ xX]\]|[-*+]|\d+\.|>) )(.*)$/)
      if (m) {
        e.preventDefault()
        const marker = m[1]!
        const rest = m[2]!.trim()
        let insert: string
        if (rest === '') {
          // 空列表项再按 Enter: 清除标记跳出列表
          insert = '\n'
          const next = before.slice(0, before.length - marker.length) + insert + contentRef.current.slice(el.selectionEnd ?? pos)
          setContent(next)
          requestAnimationFrame(() => el.setSelectionRange(next.length - (contentRef.current.length - (el.selectionEnd ?? pos)), next.length - (contentRef.current.length - (el.selectionEnd ?? pos))))
          return
        }
        const num = marker.match(/^(\s*)(\d+)\.( )$/)
        insert = '\n' + (num ? `${num[1]}${Number(num[2]) + 1}.${num[3]}` : marker)
        const next = contentRef.current.slice(0, pos) + insert + contentRef.current.slice(el.selectionEnd ?? pos)
        setContent(next)
        requestAnimationFrame(() => el.setSelectionRange(pos + insert.length, pos + insert.length))
      }
    }
  }, [])

  const insertPdfLink = useCallback(async (file: File, textarea?: HTMLTextAreaElement) => {
    if (file.size > MAX_PDF_BYTES) {
      addToast({ type: 'error', message: t('notes.pdf.tooLarge') })
      return
    }
    try {
      const saved = await notesApi.uploadAssetFile(file)
      const insert = `[${file.name}](${saved.path})`
      const target = textarea ?? editorRef.current
      const pos = target?.selectionStart ?? contentRef.current.length
      const prefix = pos > 0 ? '\n' : ''
      const next = contentRef.current.slice(0, pos) + prefix + insert + '\n' + contentRef.current.slice(pos)
      setContent(next)
      requestAnimationFrame(() => {
        if (!target) return
        const cursor = pos + prefix.length + insert.length
        target.selectionStart = cursor
        target.selectionEnd = cursor
        target.focus()
      })
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    }
  }, [addToast, t])

  const onSelectPdf = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void insertPdfLink(file)
  }, [insertPdfLink])

  // 图片粘贴 / PDF 文件粘贴
  const onPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && (item.type === 'application/pdf' || item.getAsFile()?.name.toLowerCase().endsWith('.pdf'))) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        await insertPdfLink(file, e.currentTarget)
        return
      }

      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          void (async () => {
            try {
              const base64 = String(reader.result).split(',')[1]!
              const ext = item.type.split('/')[1] || 'png'
              const saved = await notesApi.uploadAsset(`paste.${ext}`, base64)
              const textarea = e.currentTarget
              const pos = textarea.selectionStart ?? contentRef.current.length
              const insert = `![image](${saved.path})`
              const next = contentRef.current.slice(0, pos) + insert + contentRef.current.slice(pos)
              setContent(next)
            } catch (error) {
              addToast({ type: 'error', message: String(error) })
            }
          })()
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }, [addToast])

  const doExport = useCallback(async () => {
    try {
      const { html, title: noteTitle } = await notesApi.exportHtml(path)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${noteTitle}.html`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      addToast({ type: 'error', message: String(error) })
    }
  }, [path, addToast])

  // Agent 整理: 新开一个会话, 附带笔记内容请求整理
  const doOrganize = useCallback(() => {
    const noteContent = contentRef.current
    const prompt = [
      `请整理我的笔记「${title}」(${path})。要求:`,
      `1. 在 frontmatter 中补充合适的 tags`,
      `2. 如缺少标题结构, 补充层级标题`,
      `3. 末尾追加一段「摘要」`,
      `4. 如发现可关联的主题, 用 [[wikilink]] 标注`,
      `请直接用文件工具修改该笔记文件 (位于用户笔记目录)。`,
      ``,
      `当前内容:`,
      '```markdown',
      noteContent.slice(0, 12000),
      '```',
    ].join('\n')
    void (async () => {
      const sessionId = await createSession()
      setActiveTab(sessionId)
      // 等 WebSocket 连接建立后发送 (chatStore 内部有排队, 但保险起见延后一拍)
      setTimeout(() => sendMessage(sessionId, prompt), 800)
    })()
  }, [title, path, createSession, setActiveTab, sendMessage])

  useEffect(() => {
    onOrganize(() => doOrganize)
    return () => onOrganize(null)
  }, [doOrganize, onOrganize])

  const previewContent = useMemo(() => preprocessContent(content), [content])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }

  const editor = (
    <textarea
      ref={editorRef}
      value={content}
      onChange={e => setContent(e.target.value)}
      onKeyDown={onEditorKeyDown}
      onPaste={e => void onPaste(e)}
      spellCheck={false}
      className="h-full w-full resize-none bg-transparent px-[32px] py-[24px] font-mono text-[14px] leading-[1.85] tracking-[0.01em] text-[var(--color-text-primary)] outline-none selection:bg-[var(--color-text-accent)] selection:text-white"
    />
  )

  const preview = (
    <div ref={previewRef} className="h-full overflow-y-auto px-[24px] py-[20px]">
      <div className="mx-auto max-w-[720px]">
        <MarkdownRenderer content={previewContent} variant="document" />
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-[var(--color-border-separator)] px-[14px]">
        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{title}</span>
        {dirty && <span className="text-[11px] text-[var(--color-text-tertiary)]">●</span>}
        {saving && <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('notes.saving')}</span>}
        <div className="flex-1" />
        <div className="flex rounded-[8px] bg-[var(--color-surface-container-low)] p-[2px]">
          {([
            ['edit', PencilLine],
            ['split', SplitSquareHorizontal],
            ['preview', Eye],
          ] as const).map(([key, Icon]) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              title={t(`notes.view.${key}`)}
              className={`rounded-[6px] p-[6px] transition-colors ${
                viewMode === key
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onSelectPdf}
        />
        <button
          onClick={() => pdfInputRef.current?.click()}
          title={t('notes.attachPdf')}
          aria-label={t('notes.attachPdf')}
          className="rounded-[8px] p-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          <FileUp size={15} />
        </button>
        <button onClick={() => void save(content)} title="Ctrl+S" className="rounded-[8px] p-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
          <Save size={15} />
        </button>
        <button onClick={() => void doExport()} title={t('notes.export')} className="rounded-[8px] p-[6px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
          <Download size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {viewMode === 'edit' && (
          <div className="h-full bg-[var(--color-background)]">
            <div className="mx-auto h-full max-w-[780px] border-x border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)]">
              {editor}
            </div>
          </div>
        )}
        {viewMode === 'preview' && preview}
        {viewMode === 'split' && (
          <div className="grid h-full grid-cols-2 divide-x divide-[var(--color-border-separator)]">
            {editor}
            {preview}
          </div>
        )}
      </div>
    </div>
  )
}
