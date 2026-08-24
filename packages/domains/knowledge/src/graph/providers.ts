/**
 * rin knowledge-graph — data-source providers.
 *
 * Pure projections from already-read source snapshots. The Cordis service owns
 * reading @rin/notes and @rin/knowledge; these functions keep the conversion
 * testable without runtime dependencies.
 *
 * @module @rin/knowledge/graph
 */

import { basename } from 'node:path'
import type { CodeGraphVisualization } from '@rin/context/codegraph'
import type { KnowledgeDocument, KnowledgeSource } from '@rin/knowledge'
import type { NoteGraph, NoteMeta } from '@rin/notes'
import type { AssetRepository } from '@rin/assets'
import type { GraphEdge, GraphNode } from './types.ts'

/** Convert notes metadata and its wikilink graph into graph rows. */
export function notesGraphRows(notes: readonly NoteMeta[], graph: NoteGraph): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = notes.map(note => ({
    id: `note:${note.path}`,
    kind: 'note',
    label: note.title,
    path: note.path,
    source: 'notes',
    metadata: { folder: note.folder, tags: note.tags },
    modifiedAt: note.modifiedAt,
  }))

  const tags = new Map<string, GraphNode>()
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!tags.has(tag)) {
        tags.set(tag, {
          id: `tag:${tag}`,
          kind: 'tag',
          label: tag,
          path: null,
          source: 'notes',
          metadata: {},
          modifiedAt: null,
        })
      }
    }
  }
  for (const tagNode of tags.values()) nodes.push(tagNode)

  const edges: GraphEdge[] = graph.edges.map(edge => ({
    from: `note:${edge.from}`,
    to: `note:${edge.to}`,
    kind: 'wikilink',
    confidence: 1,
    provenance: 'rin notes wikilink graph',
  }))
  for (const note of notes) {
    for (const tag of note.tags) {
      edges.push({
        from: `note:${note.path}`,
        to: `tag:${tag}`,
        kind: 'tag',
        confidence: 1,
        provenance: 'rin notes frontmatter or inline tag',
      })
    }
  }

  return { nodes, edges }
}

/** Convert knowledge sources and documents into graph rows. */
export function knowledgeGraphRows(
  sources: readonly KnowledgeSource[],
  documents: readonly KnowledgeDocument[],
  notePaths: readonly string[] = [],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = sources.map(source => ({
    id: `knowledge_source:${source.id}`,
    kind: 'knowledge_source',
    label: source.name,
    path: source.path,
    source: 'knowledge',
    metadata: { status: source.status, kind: source.kind },
    modifiedAt: source.updatedAt,
  }))

  const noteIndex = buildNoteIndex(notePaths)
  const citesSeen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const document of documents) {
    const documentNodeId = `knowledge_document:${document.id}`
    nodes.push({
      id: documentNodeId,
      kind: 'knowledge_document',
      label: document.title,
      path: document.path,
      source: 'knowledge',
      metadata: { sourceId: document.sourceId, extension: document.extension, indexMode: document.indexMode },
      modifiedAt: document.modifiedAt,
    })
    edges.push({
      from: `knowledge_source:${document.sourceId}`,
      to: documentNodeId,
      kind: 'contains',
      confidence: 1,
      provenance: 'rin knowledge source index',
    })
    for (const target of document.links) {
      const notePath = noteIndex.get(normalizeLinkTarget(target))
      if (notePath === undefined) continue
      const edgeKey = `${documentNodeId}\u0000note:${notePath}`
      if (citesSeen.has(edgeKey)) continue
      citesSeen.add(edgeKey)
      edges.push({
        from: documentNodeId,
        to: `note:${notePath}`,
        kind: 'cites',
        confidence: 1,
        provenance: 'rin knowledge wikilink to note',
      })
    }
  }

  return { nodes, edges }
}

/** Map each note path to its full path, extension-less path, and basename. */
function buildNoteIndex(notePaths: readonly string[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const path of notePaths) {
    const noExt = path.endsWith('.md') ? path.slice(0, -3) : path
    const name = noExt.includes('/') ? noExt.slice(noExt.lastIndexOf('/') + 1) : noExt
    index.set(path, path)
    index.set(noExt, path)
    index.set(name, path)
  }
  return index
}

/** Trim a wikilink target and strip a leading `./` prefix. */
function normalizeLinkTarget(target: string): string {
  let value = target.trim()
  while (value.startsWith('./')) value = value.slice(2)
  return value
}

/** Convert repository assets into graph rows (agents, environments, packages). */
export function repositoryGraphRows(repository: AssetRepository): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }

  for (const profile of repository.environmentProfiles) {
    addNode({
      id: `repository_environment:${profile.metadata.id}`,
      kind: 'repository_environment',
      label: profile.metadata.name,
      path: profile.metadata.source ?? null,
      source: 'repository',
      metadata: { version: profile.metadata.version },
      modifiedAt: null,
    })
  }

  const packageIds = new Set(repository.environmentPackages.map(pkg => pkg.id))
  for (const pkg of repository.environmentPackages) {
    addNode({
      id: `repository_package:${pkg.id}`,
      kind: 'repository_package',
      label: pkg.name,
      path: null,
      source: 'repository',
      metadata: { ecosystem: pkg.ecosystem, version: pkg.version ?? null },
      modifiedAt: null,
    })
  }

  for (const agent of repository.agents) {
    addNode({
      id: `repository_agent:${agent.name}`,
      kind: 'repository_agent',
      label: agent.name,
      path: agent.source ?? null,
      source: 'repository',
      metadata: { description: agent.description, model: agent.model ?? null },
      modifiedAt: null,
    })
    const profileId = agent.resources.environmentProfileId
    if (profileId !== undefined && repository.environmentProfiles.some(profile => profile.metadata.id === profileId)) {
      addEdge({
        from: `repository_agent:${agent.name}`,
        to: `repository_environment:${profileId}`,
        kind: 'uses',
        confidence: 1,
        provenance: 'rin repository agent resource',
      })
    }
  }

  for (const profile of repository.environmentProfiles) {
    const profileNodeId = `repository_environment:${profile.metadata.id}`
    for (const packageId of profile.spec.packages) {
      if (!packageIds.has(packageId)) continue
      addEdge({
        from: profileNodeId,
        to: `repository_package:${packageId}`,
        kind: 'contains',
        confidence: 1,
        provenance: 'rin repository environment profile',
      })
    }
  }

  for (const pkg of repository.environmentPackages) {
    const packageNodeId = `repository_package:${pkg.id}`
    for (const dependencyId of pkg.dependencies ?? []) {
      if (!packageIds.has(dependencyId)) continue
      addEdge({
        from: packageNodeId,
        to: `repository_package:${dependencyId}`,
        kind: 'depends_on',
        confidence: 1,
        provenance: 'rin repository package dependency',
      })
    }
  }

  return { nodes, edges }
}

/** Convert one project's code-graph visualization into graph rows. */
export function codeGraphRows(
  visualization: CodeGraphVisualization,
  projectPath: string,
  noteLinks: ReadonlyArray<{ notePath: string; target: string }> = [],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }

  const filePaths = new Set(visualization.nodes.map(node => node.filePath))
  const fileNodeId = (filePath: string) => `code_file:${filePath.replaceAll('\\', '/')}`
  for (const filePath of filePaths) {
    addNode({
      id: fileNodeId(filePath),
      kind: 'code_file',
      label: basename(filePath),
      path: filePath,
      source: 'codegraph',
      metadata: { projectPath },
      modifiedAt: null,
    })
  }

  const symbolByName = new Map<string, string>()
  for (const node of visualization.nodes) {
    const symbolId = `code_symbol:${node.id}`
    addNode({
      id: symbolId,
      kind: 'code_symbol',
      label: node.name,
      path: node.filePath,
      source: 'codegraph',
      metadata: { qualifiedName: node.qualifiedName, language: node.language, symbolKind: node.kind, projectPath },
      modifiedAt: null,
    })
    addEdge({
      from: symbolId,
      to: fileNodeId(node.filePath),
      kind: 'defined_in',
      confidence: 1,
      provenance: 'rin codegraph index',
    })
    symbolByName.set(node.name, symbolId)
    symbolByName.set(node.qualifiedName, symbolId)
  }

  const fileByName = new Map<string, string>()
  for (const filePath of filePaths) fileByName.set(basename(filePath), fileNodeId(filePath))

  for (const edge of visualization.edges) {
    if (edge.kind === 'contains') continue
    addEdge({
      from: `code_symbol:${edge.source}`,
      to: `code_symbol:${edge.target}`,
      kind: 'code_ref',
      confidence: edge.confidence === 'extracted' ? 1 : edge.confidence === 'inferred' ? 0.6 : 0.4,
      provenance: `rin codegraph ${edge.kind}`,
    })
  }

  for (const { notePath, target } of noteLinks) {
    const normalized = normalizeLinkTarget(target)
    const symbolId = symbolByName.get(normalized)
    const targetId = symbolId ?? fileByName.get(normalized)
    if (targetId === undefined) continue
    addEdge({
      from: `note:${notePath}`,
      to: targetId,
      kind: 'mentions',
      confidence: 0.5,
      provenance: 'rin notes wikilink to code entity',
    })
  }

  return { nodes, edges }
}

/**
 * Convert session-search hits and session-backup notes into graph rows.
 * @param sessions - recent sessions (sessionId/title/projectPath).
 * @param backupNotes - map of session-backup note title → note path.
 */
export function sessionGraphRows(
  sessions: ReadonlyArray<{ sessionId: string; title: string; projectPath: string }>,
  backupNotes: ReadonlyMap<string, string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }

  const notePathsByTitle = new Map<string, string[]>()
  for (const [title, path] of backupNotes) {
    const paths = notePathsByTitle.get(title) ?? []
    paths.push(path)
    notePathsByTitle.set(title, paths)
  }

  for (const session of sessions) {
    const sessionId = `session:${session.sessionId}`
    addNode({
      id: sessionId,
      kind: 'session',
      label: session.title !== '' ? session.title : session.sessionId,
      path: session.projectPath !== '' ? session.projectPath : null,
      source: 'session',
      metadata: { sessionId: session.sessionId, projectPath: session.projectPath },
      modifiedAt: null,
    })
    for (const notePath of notePathsByTitle.get(session.title) ?? []) {
      addEdge({
        from: `note:${notePath}`,
        to: sessionId,
        kind: 'derived_from',
        confidence: 1,
        provenance: 'rin session backup note',
      })
    }
  }

  return { nodes, edges }
}

/**
 * Convert one browsed filesystem root into file nodes and `child` edges.
 * @param roots - the browsed roots, each with its immediate directory entries.
 */
export function filesystemGraphRows(
  roots: ReadonlyArray<{ rootPath: string; entries: ReadonlyArray<{ name: string; path: string; isDirectory: boolean }> }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const addNode = (node: GraphNode): void => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: GraphEdge): void => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(edge)
  }

  for (const root of roots) {
    const rootId = `filesystem_root:${root.rootPath}`
    addNode({
      id: rootId,
      kind: 'file',
      label: basename(root.rootPath) || root.rootPath,
      path: root.rootPath,
      source: 'filesystem',
      metadata: { isDirectory: true },
      modifiedAt: null,
    })
    for (const entry of root.entries) {
      const fileId = `file:${entry.path}`
      addNode({
        id: fileId,
        kind: 'file',
        label: entry.name,
        path: entry.path,
        source: 'filesystem',
        metadata: { isDirectory: entry.isDirectory },
        modifiedAt: null,
      })
      addEdge({
        from: rootId,
        to: fileId,
        kind: 'child',
        confidence: 1,
        provenance: 'rin filesystem browse',
      })
    }
  }

  return { nodes, edges }
}
