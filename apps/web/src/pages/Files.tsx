import { useEffect, useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { knowledgeApi } from '../api/knowledge'
import { notesApi } from '../api/notes'
import { repositoriesApi } from '../api/repositories'
import { statusApi } from '../api/status'
import { FileExplorer } from '../components/shared/FileExplorer'
import { useTranslation } from '../i18n'
import { useTabStore } from '../stores/tabStore'

type FileRoot = {
  key: string
  label: string
  path: string
}

/**
 * Unified file workspace.
 *
 * Presents the current workspace, notes vault, knowledge sources, and
 * repository roots as first-class file roots over the same FileExplorer /
 * AssetPreviewModal display layer.
 */
export function Files() {
  const t = useTranslation()
  const activeTab = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId))
  const [roots, setRoots] = useState<FileRoot[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const next: FileRoot[] = []

    const add = (root?: FileRoot) => {
      if (root && !next.some((entry) => entry.path === root.path)) next.push(root)
    }

    void Promise.allSettled([
      statusApi.user().then((user) => {
        add({ key: 'home', label: t('files.roots.home'), path: user.homeDir })
      }),
      notesApi.root().then((res) => {
        add({ key: 'notes', label: t('files.roots.notes'), path: res.root })
      }),
      knowledgeApi.sources().then((sources) => {
        sources.forEach((source) => {
          if (source.kind === 'folder') {
            add({ key: `knowledge:${source.id}`, label: `${t('files.roots.knowledge')} · ${source.name}`, path: source.path })
          }
        })
      }),
      repositoriesApi.list().then((res) => {
        res.repositories.forEach((repo) => {
          add({ key: `repository:${repo.id}`, label: `${t('files.roots.repository')} · ${repo.name}`, path: repo.rootPath })
        })
      }),
    ]).then(() => {
      if (cancelled) return
      const workspacePath = activeTab?.projectPath?.trim()
      if (workspacePath) next.unshift({ key: 'workspace', label: t('files.roots.workspace'), path: workspacePath })
      setRoots(next)
      setSelectedKey((current) => current && next.some((root) => root.key === current) ? current : (next[0]?.key ?? null))
    })

    return () => { cancelled = true }
  }, [t, activeTab?.projectPath])

  const selectedRoot = useMemo(
    () => roots.find((root) => root.key === selectedKey) ?? null,
    [roots, selectedKey],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <div className="flex h-[48px] shrink-0 items-center gap-[8px] border-b border-[var(--color-border-separator)] px-[16px]">
        <FolderOpen size={16} className="text-[var(--color-text-tertiary)]" />
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('files.title')}</span>
        <div className="flex-1" />
        <div className="flex max-w-[calc(100%-160px)] items-center gap-[6px] overflow-x-auto">
          {roots.map((root) => (
            <button
              key={root.key}
              type="button"
              onClick={() => setSelectedKey(root.key)}
              className={`shrink-0 rounded-full px-[10px] py-[4px] text-[11.5px] font-medium transition-colors ${
                selectedKey === root.key
                  ? 'bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)]'
                  : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {root.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {selectedRoot ? <FileExplorer key={selectedRoot.path} initialPath={selectedRoot.path} /> : null}
      </div>
    </div>
  )
}
