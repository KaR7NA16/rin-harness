/**
 * rin codegraph — tree-sitter indexer.
 *
 * Builds a per-project code graph (nodes/edges/files) by parsing source files
 * with web-tree-sitter (pure WASM) and storing the extracted symbols and
 * relationships in node:sqlite. This replaces the legacy native codegraph
 * binary; symbol extraction is a pragmatic subset (definitions + imports +
 * same-name call references), not the full cross-language query set.
 *
 * @module @rin/context
 */

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import Parser from 'web-tree-sitter'

/** Language id → grammar wasm filename (beside this module's grammars dir). */
const LANGUAGE_GRAMMARS: Record<string, string> = {
  javascript: 'tree-sitter-javascript.wasm', typescript: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm', go: 'tree-sitter-go.wasm', rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm', c: 'tree-sitter-c.wasm', php: 'tree-sitter-php.wasm',
  lua: 'tree-sitter-lua.wasm', solidity: 'tree-sitter-solidity.wasm',
}

/** File extension → language id. */
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.c': 'c', '.h': 'c',
  '.php': 'php', '.lua': 'lua', '.sol': 'solidity',
}

/** tree-sitter node types treated as definition symbols. */
const DEFINITION_TYPES = new Set([
  'function_declaration', 'function_definition', 'function_item', 'method_definition', 'method_declaration',
  'class_declaration', 'class_definition', 'interface_declaration', 'struct_item', 'impl_item', 'trait_item',
  'enum_item', 'enum_declaration', 'contract_definition', 'type_declaration', 'type_alias_declaration',
  'decorated_definition',
])

/** tree-sitter node types treated as import edges. */
const IMPORT_TYPES = new Set(['import_statement', 'import_declaration', 'import_from_statement', 'use_declaration'])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.codegraph'])

interface RawNode { id: string; kind: string; name: string; filePath: string; language: string; startLine: number; endLine: number }
/** A deferred import edge: source import-node id plus the target symbol name. */
interface ImportRef { source: string; target: string }
/** A deferred call edge: enclosing definition id plus the called symbol name. */
interface CallRef { source: string; target: string }

/** Per-file indexing progress, reported before each source file is parsed. */
export interface IndexProgress {
  /** 1-based position of the file being processed. */
  current: number
  /** Total number of indexable files found in the project. */
  total: number
  /** Project-relative path of the file being processed. */
  currentFile: string
}

/** Aggregate counts produced by one indexing pass. */
export interface IndexResult {
  /** Number of files successfully indexed into the files table. */
  fileCount: number
  /** Number of symbol nodes written. */
  nodeCount: number
  /** Number of relationship edges written. */
  edgeCount: number
  /** Number of files that failed to parse and were recorded as errored. */
  errorFileCount: number
}

const grammarCache = new Map<string, Parser.Language>()
let parserInit: Promise<void> | null = null

function grammarDir(): string {
  return fileURLToPath(new URL('../../grammars/', import.meta.url))
}

async function languageFor(id: string): Promise<Parser.Language> {
  const cached = grammarCache.get(id)
  if (cached !== undefined) return cached
  const filename = LANGUAGE_GRAMMARS[id]
  if (filename === undefined) throw new Error(`no grammar for language: ${id}`)
  const language = await Parser.Language.load(join(grammarDir(), filename))
  grammarCache.set(id, language)
  return language
}

async function parserFor(id: string): Promise<Parser> {
  parserInit ??= Parser.init()
  await parserInit
  const parser = new Parser()
  parser.setLanguage(await languageFor(id))
  return parser
}

/** Extract a symbol name from a definition node's first identifier/name child. */
function nameOf(node: Parser.SyntaxNode): string {
  for (const child of node.namedChildren) {
    if (child.type === 'identifier' || child.type === 'name' || child.type === 'property_identifier') return child.text
    if (child.type === 'function_definition' || child.type === 'decorated_definition') { const inner = nameOf(child); if (inner !== '') return inner }
  }
  return ''
}

/** Extract the called symbol name from a call_expression node. */
function calleeName(node: Parser.SyntaxNode): string {
  const callee = node.childForFieldName('function') ?? node.namedChildren[0]
  if (callee === undefined || callee === null) return ''
  if (callee.type === 'identifier') return callee.text
  if (callee.type === 'member_expression' || callee.type === 'field_expression' || callee.type === 'attribute' || callee.type === 'call') {
    const parts = callee.text.split(/[.>\s:]/).filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1]! : ''
  }
  return ''
}

function nodeId(filePath: string, startLine: number, kind: string, name: string): string {
  return 'n-' + createHash('sha256').update(`${filePath}:${startLine}:${kind}:${name}`).digest('hex').slice(0, 20)
}

/** Extract the import target basename and any named-import identifiers. */
function importTargets(sourceText: string): string[] {
  const targets: string[] = []
  const moduleMatch = /['"]([^'"]+)['"]/.exec(sourceText)
  if (moduleMatch !== null) targets.push(moduleMatch[1]!)
  const braceMatch = /\{([^}]*)\}/.exec(sourceText)
  if (braceMatch !== null && braceMatch[1] !== undefined) {
    for (const part of braceMatch[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name !== undefined && name !== '') targets.push(name)
    }
  }
  return targets
}

/** Walk one parse tree and collect definition nodes, imports, and call refs. */
function collect(tree: Parser.Tree, filePath: string, language: string): { nodes: RawNode[]; imports: ImportRef[]; calls: CallRef[] } {
  const nodes: RawNode[] = []
  const imports: ImportRef[] = []
  const calls: CallRef[] = []
  const rawImportTargets: string[] = []
  let currentDefinition: string | null = null

  const walk = (node: Parser.SyntaxNode): void => {
    const isNestedFunctionDef = node.type === 'function_definition' && node.parent?.type === 'decorated_definition'
    const isDefinition = DEFINITION_TYPES.has(node.type) && !isNestedFunctionDef
    let pushedId: string | null = null
    if (isDefinition) {
      const name = nameOf(node)
      if (name !== '') {
        const id = nodeId(filePath, node.startPosition.row + 1, node.type, name)
        nodes.push({ id, kind: node.type, name, filePath, language, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 })
        pushedId = id
      }
    }
    if (IMPORT_TYPES.has(node.type)) {
      for (const target of importTargets(node.text)) rawImportTargets.push(target)
    }
    if (node.type === 'call_expression') {
      const callee = calleeName(node)
      if (callee !== '' && currentDefinition !== null) calls.push({ source: currentDefinition, target: callee })
    }
    const previousDefinition = currentDefinition
    if (pushedId !== null) currentDefinition = pushedId
    for (const child of node.namedChildren) walk(child)
    currentDefinition = previousDefinition
  }
  walk(tree.rootNode)

  const seenTargets = new Set<string>()
  for (const target of rawImportTargets) {
    const targetName = target.split('/').pop() ?? target
    if (targetName === '' || seenTargets.has(targetName)) continue
    seenTargets.add(targetName)
    const importNodeId = nodeId(filePath, 0, 'import', targetName)
    nodes.push({ id: importNodeId, kind: 'import', name: targetName, filePath, language, startLine: 0, endLine: 0 })
    imports.push({ source: importNodeId, target: targetName })
  }

  return { nodes, imports, calls }
}

/**
 * Index one source file into nodes, import refs, and call refs.
 *
 * @param readPath - absolute path used to read the file contents.
 * @param relPath - project-relative path stored as the node/file identity.
 * @param language - grammar language id for the file extension.
 * @returns extracted nodes/refs, or null when the file is deliberately skipped.
 */
async function indexFile(readPath: string, relPath: string, language: string): Promise<{ nodes: RawNode[]; imports: ImportRef[]; calls: CallRef[] } | null> {
  const source = await readFile(readPath, 'utf-8')
  if (source.length > 4 * 1024 * 1024) return null
  const parser = await parserFor(language)
  const tree = parser.parse(source)
  return collect(tree, relPath, language)
}

async function walkFiles(root: string, current = '', out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, current), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walkFiles(root, current === '' ? entry.name : join(current, entry.name), out)
    } else if (entry.isFile()) {
      const rel = current === '' ? entry.name : join(current, entry.name)
      const language = EXTENSION_LANGUAGES[extname(entry.name).toLowerCase()]
      if (language !== undefined) out.push(rel)
    }
  }
  return out
}

/**
 * Build (or rebuild) the code graph SQLite database for a project.
 *
 * @param projectPath - absolute project root to index.
 * @param onProgress - optional callback invoked before each file is parsed.
 * @returns aggregate counts for the completed pass.
 */
export async function indexProject(projectPath: string, onProgress?: (progress: IndexProgress) => void): Promise<IndexResult> {
  const dbPath = join(projectPath, '.codegraph', 'codegraph.db')
  await mkdir(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS files')
    db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, language TEXT, indexed_at INTEGER, errors TEXT)')
    db.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, language TEXT, start_line INTEGER, end_line INTEGER)')
    db.exec('CREATE TABLE edges (source TEXT, target TEXT, kind TEXT, line INTEGER, provenance TEXT)')

    const files = await walkFiles(projectPath)
    let nodeCount = 0
    let edgeCount = 0
    let fileCount = 0
    let errorFileCount = 0
    const insertNode = db.prepare('INSERT OR REPLACE INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const insertEdge = db.prepare('INSERT INTO edges (source, target, kind, line, provenance) VALUES (?, ?, ?, ?, ?)')
    const insertFile = db.prepare('INSERT OR REPLACE INTO files (path, language, indexed_at, errors) VALUES (?, ?, ?, ?)')

    const definitionIndex = new Map<string, string[]>()
    const pendingImports: ImportRef[] = []
    const pendingCalls: CallRef[] = []

    let current = 0
    for (const rel of files) {
      current += 1
      onProgress?.({ current, total: files.length, currentFile: rel })
      const fullPath = join(projectPath, rel)
      const language = EXTENSION_LANGUAGES[extname(rel).toLowerCase()] ?? 'other'
      let result: { nodes: RawNode[]; imports: ImportRef[]; calls: CallRef[] } | null
      try {
        result = await indexFile(fullPath, rel, language)
      } catch {
        errorFileCount += 1
        insertFile.run(rel, language, Date.now(), '["error"]')
        continue
      }
      if (result === null) continue
      insertFile.run(rel, language, Date.now(), null)
      fileCount += 1
      for (const node of result.nodes) {
        insertNode.run(node.id, node.kind, node.name, node.name, node.filePath, node.language, node.startLine, node.endLine)
        nodeCount += 1
        if (node.kind !== 'import') {
          const ids = definitionIndex.get(node.name)
          if (ids === undefined) definitionIndex.set(node.name, [node.id])
          else ids.push(node.id)
        }
      }
      for (const ref of result.imports) pendingImports.push(ref)
      for (const ref of result.calls) pendingCalls.push(ref)
    }

    const resolve = (target: string): string | undefined => {
      const candidates = definitionIndex.get(target)
      return candidates !== undefined && candidates.length > 0 ? candidates[0] : undefined
    }
    for (const ref of pendingImports) {
      const targetId = resolve(ref.target)
      if (targetId !== undefined && targetId !== ref.source) {
        insertEdge.run(ref.source, targetId, 'imports', 0, 'tree-sitter')
        edgeCount += 1
      }
    }
    for (const ref of pendingCalls) {
      const targetId = resolve(ref.target)
      if (targetId !== undefined && targetId !== ref.source) {
        insertEdge.run(ref.source, targetId, 'calls', 0, 'tree-sitter')
        edgeCount += 1
      }
    }

    return { fileCount, nodeCount, edgeCount, errorFileCount }
  } finally {
    db.close()
  }
}
