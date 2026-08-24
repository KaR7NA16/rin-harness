/**
 * rin knowledge — domain model.
 *
 * Owns the values crossing the knowledge module seam: sources, documents,
 * search results, and aggregate stats. The SQLite adapter owns persistence and
 * the service owns indexing/search; this module owns the schema only.
 *
 * @module @rin/knowledge
 */

export type KnowledgeSourceKind = 'file' | 'folder'

export type KnowledgeSourceStatus =
  | 'pending'
  | 'indexing'
  | 'ready'
  | 'empty'
  | 'error'

export type KnowledgeSource = {
  id: string
  path: string
  name: string
  kind: KnowledgeSourceKind
  status: KnowledgeSourceStatus
  /** When false, the source is indexed for entity projection (links/title) without full-text content. */
  indexContent: boolean
  error: string | null
  documentCount: number
  chunkCount: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
  indexedAt: string | null
}

export type KnowledgeDocumentIndexMode = 'text' | 'metadata'

export type KnowledgeDocument = {
  id: string
  sourceId: string
  path: string
  relativePath: string
  title: string
  extension: string
  indexMode: KnowledgeDocumentIndexMode
  sizeBytes: number
  modifiedAt: string
  indexedAt: string
  /** Wikilink targets extracted from the document body, in first-seen order. */
  links: string[]
  error: string | null
}

export type KnowledgeSearchResult = {
  chunkId: number
  sourceId: string
  documentId: string
  sourceName: string
  title: string
  path: string
  excerpt: string
  score: number
  /** Stable graph node id of the owning document (knowledge_document:<id>). */
  nodeId: string
  /** Wikilink targets extracted from the owning document, in first-seen order. */
  links: string[]
}

export type KnowledgeStats = {
  sourceCount: number
  documentCount: number
  chunkCount: number
  sizeBytes: number
  indexingCount: number
}
