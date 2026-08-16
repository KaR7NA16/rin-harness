/**
 * rin plugins — markdown plugin directory core.
 *
 * Lists plugins installed under a root directory; each plugin is a directory
 * holding a plugin.md with YAML frontmatter (name/description/version/author)
 * followed by capability sections (Commands/Agents/Skills/Hooks/McpServers/LspServers).
 * Simplified port of cyberpsychosis plugin listing; the marketplace/install/
 * version/reconcile subsystem is not ported. Cordis-free.
 *
 * @module @rin/plugins
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type PluginCapabilityKey = 'commands' | 'agents' | 'skills' | 'hooks' | 'mcpServers' | 'lspServers'
export type PluginScope = 'user' | 'builtin'

export interface PluginSummary {
  id: string
  name: string
  marketplace: string
  scope: PluginScope
  enabled: boolean
  hasErrors: boolean
  isBuiltin: boolean
  version?: string
  description?: string
  authorName?: string
  installPath?: string
  componentCounts: Record<PluginCapabilityKey, number>
  errors: string[]
}

export interface PluginDetail extends PluginSummary {
  capabilities: Record<PluginCapabilityKey, string[]>
  commandEntries: Array<{ name: string; description: string }>
  agentEntries: Array<{ name: string; description: string }>
  hookEntries: Array<{ event: string; actions: string[] }>
  skillEntries: Array<{ name: string; description: string }>
  mcpServerEntries: Array<{ name: string; transport: string; summary: string }>
}

export interface PluginListResult {
  plugins: PluginSummary[]
  marketplaces: Array<{ name: string; source: string; installedCount: number }>
  summary: { total: number; enabled: number; errorCount: number; marketplaceCount: number }
}

const CAPABILITY_SECTIONS: Record<string, PluginCapabilityKey> = {
  commands: 'commands', agents: 'agents', skills: 'skills', hooks: 'hooks',
  mcp: 'mcpServers', 'mcp servers': 'mcpServers', lsp: 'lspServers', 'lsp servers': 'lspServers',
}

interface ParsedPlugin {
  frontmatter: Record<string, unknown>
  capabilities: Record<PluginCapabilityKey, string[]>
}

async function listPluginDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
  } catch {
    return []
  }
}

async function readPluginMarkdown(dir: string): Promise<string | null> {
  for (const name of ['plugin.md', 'PLUGIN.md']) {
    try {
      return await readFile(join(dir, name), 'utf-8')
    } catch {
      // try the next candidate filename
    }
  }
  return null
}

function parsePlugin(markdown: string): ParsedPlugin {
  const frontmatter: Record<string, unknown> = {}
  let body = markdown
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown)
  if (match !== null) {
    try {
      const parsed = parseYaml(match[1]!) as unknown
      if (parsed !== null && typeof parsed === 'object') Object.assign(frontmatter, parsed)
    } catch {
      // malformed frontmatter — leave it empty
    }
    body = markdown.slice(match[0].length)
  }
  const capabilities: Record<PluginCapabilityKey, string[]> = { commands: [], agents: [], skills: [], hooks: [], mcpServers: [], lspServers: [] }
  let current: PluginCapabilityKey | null = null
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading !== null) {
      current = CAPABILITY_SECTIONS[heading[1]!.trim().toLowerCase()] ?? null
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (bullet !== null && current !== null) {
      capabilities[current].push(bullet[1]!.trim())
    }
  }
  return { frontmatter, capabilities }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function buildSummary(id: string, dir: string, parsed: ParsedPlugin, enabled: boolean, isBuiltin: boolean): PluginSummary {
  const componentCounts = { commands: parsed.capabilities.commands.length, agents: parsed.capabilities.agents.length, skills: parsed.capabilities.skills.length, hooks: parsed.capabilities.hooks.length, mcpServers: parsed.capabilities.mcpServers.length, lspServers: parsed.capabilities.lspServers.length }
  const summary: PluginSummary = {
    id, name: str(parsed.frontmatter.name) ?? id, marketplace: 'local', scope: isBuiltin ? 'builtin' : 'user', enabled, hasErrors: false, isBuiltin,
    installPath: dir, componentCounts, errors: [],
  }
  const version = str(parsed.frontmatter.version)
  if (version !== undefined) summary.version = version
  const description = str(parsed.frontmatter.description)
  if (description !== undefined) summary.description = description
  const author = str(parsed.frontmatter.author)
  if (author !== undefined) summary.authorName = author
  return summary
}

async function readDisabled(root: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(join(root, 'disabled.json'), 'utf-8')) as { disabled?: string[] }
    return new Set(Array.isArray(parsed.disabled) ? parsed.disabled : [])
  } catch {
    return new Set()
  }
}

async function writeDisabled(root: string, disabled: Set<string>): Promise<void> {
  await writeFile(join(root, 'disabled.json'), JSON.stringify({ disabled: [...disabled] }, null, 2) + '\n', 'utf-8')
}

/** List plugins under a root directory. */
export async function listPlugins(root: string): Promise<PluginListResult> {
  const disabled = await readDisabled(root)
  const plugins: PluginSummary[] = []
  for (const dir of await listPluginDirs(root)) {
    const markdown = await readPluginMarkdown(dir)
    if (markdown === null) continue
    const parsed = parsePlugin(markdown)
    const id = str(parsed.frontmatter.id) ?? dir.split('/').pop() ?? 'plugin'
    plugins.push(buildSummary(id, dir, parsed, !disabled.has(id), false))
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return {
    plugins,
    marketplaces: [{ name: 'local', source: root, installedCount: plugins.length }],
    summary: { total: plugins.length, enabled: plugins.filter(p => p.enabled).length, errorCount: 0, marketplaceCount: 1 },
  }
}

/** Read one plugin's full detail. */
export async function getPluginDetail(root: string, id: string): Promise<PluginDetail | undefined> {
  for (const dir of await listPluginDirs(root)) {
    const markdown = await readPluginMarkdown(dir)
    if (markdown === null) continue
    const parsed = parsePlugin(markdown)
    if ((str(parsed.frontmatter.id) ?? dir.split('/').pop()) !== id) continue
    const disabled = await readDisabled(root)
    const summary = buildSummary(id, dir, parsed, !disabled.has(id), false)
    return {
      ...summary,
      capabilities: parsed.capabilities,
      commandEntries: parsed.capabilities.commands.map(name => ({ name, description: '' })),
      agentEntries: parsed.capabilities.agents.map(name => ({ name, description: '' })),
      hookEntries: [],
      skillEntries: parsed.capabilities.skills.map(name => ({ name, description: '' })),
      mcpServerEntries: parsed.capabilities.mcpServers.map(name => ({ name, transport: 'stdio', summary: '' })),
    }
  }
  return undefined
}

/** Enable or disable one plugin; returns the new enabled state. */
export async function setPluginEnabled(root: string, id: string, enabled: boolean): Promise<boolean> {
  const disabled = await readDisabled(root)
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  await writeDisabled(root, disabled)
  return enabled
}
