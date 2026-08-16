/**
 * rin brief — dependency-free core.
 *
 * Holds the pure logic (config resolution, session-event trimming and
 * transcript rendering, prompt building, result shaping and byte bounding),
 * the structural tool/command descriptors, and the BriefCore registry wiring.
 * The module imports only node builtins and the package's own types, so the
 * strip-types smoke and the unit tests can exercise the behavior without
 * pulling in the @deepseek-ai/cordis or @deepseek-ai/dsh-tools import graph.
 * The dsh seam (seam.ts) adapts the real Context to this core's structural
 * BriefSeam.
 *
 * @module @rin/brief
 */

import { Buffer } from 'node:buffer'
import type {
  BriefCommand,
  BriefCommandInvocation,
  BriefCommandResult,
  BriefConfig,
  BriefEvent,
  BriefLlmSeam,
  BriefSeam,
  BriefTool,
  BriefToolExec,
  BriefToolResult,
  ResolvedBriefConfig,
} from './types.ts'

/** Default model used when no explicit provider/model pair is configured. */
export const DEFAULT_BRIEF_MODEL = 'deepseek-v4-flash'
/** Default recent-event window included in the brief transcript. */
export const DEFAULT_BRIEF_MAX_EVENTS = 120
/** Default UTF-8 byte bound for the rendered transcript sent to the model. */
export const DEFAULT_BRIEF_MAX_INPUT_BYTES = 32 * 1024
/** Default UTF-8 byte bound for the produced brief markdown. */
export const DEFAULT_BRIEF_MAX_RESULT_BYTES = 16 * 1024
/** Default output-token cap for the brief generation call. */
export const DEFAULT_BRIEF_MAX_OUTPUT_TOKENS = 2048
/** Marker appended when the transcript exceeds `maxInputBytes`. */
export const BRIEF_TRANSCRIPT_TRUNCATION_MARKER = '\n\n… (earlier transcript omitted)'
/** Marker appended when the produced brief exceeds `maxResultBytes`. */
export const BRIEF_RESULT_TRUNCATION_MARKER = '\n\n… (brief truncated)'

/** Session event types that carry the session's visible work for a brief. */
const SURFACE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
])

/**
 * Materialize deployment defaults into a resolved brief policy.
 * @param input - plugin configuration input, or undefined for pure defaults.
 * @returns the resolved policy with every bound materialized.
 */
export function resolveBriefConfig(input: BriefConfig | undefined): ResolvedBriefConfig {
  const config = input ?? {}
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('rin brief: provider and model must be configured together')
  }
  return {
    provider: config.provider,
    model: config.model,
    maxEvents: positiveInt('maxEvents', config.maxEvents, DEFAULT_BRIEF_MAX_EVENTS),
    maxInputBytes: positiveInt('maxInputBytes', config.maxInputBytes, DEFAULT_BRIEF_MAX_INPUT_BYTES),
    maxResultBytes: positiveInt('maxResultBytes', config.maxResultBytes, DEFAULT_BRIEF_MAX_RESULT_BYTES),
    maxOutputTokens: positiveInt('maxOutputTokens', config.maxOutputTokens, DEFAULT_BRIEF_MAX_OUTPUT_TOKENS),
  }
}

/** Validate one positive-safe-integer policy field. */
function positiveInt(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`rin brief: ${name} must be a positive safe integer`)
  }
  return value
}

/** Result of trimming the session log to a bounded surface window. */
export interface TrimmedBriefEvents {
  events: readonly BriefEvent[]
  /** Events dropped as log-only or outside the recent window. */
  dropped: number
}

/**
 * Trim a session log to the bounded recent surface window the brief uses.
 * Log-only events (turn/step boundaries, chunks, usage) are dropped first;
 * then the window is capped at `maxEvents`.
 * @param events - the complete session event log, newest last.
 * @param config - resolved brief policy carrying `maxEvents`.
 * @returns the kept window and the number of dropped events.
 */
export function trimSessionEvents(events: readonly BriefEvent[], config: ResolvedBriefConfig): TrimmedBriefEvents {
  const surface = events.filter(event => SURFACE_EVENT_TYPES.has(event.type))
  let dropped = events.length - surface.length
  if (surface.length > config.maxEvents) {
    dropped += surface.length - config.maxEvents
    return { events: surface.slice(surface.length - config.maxEvents), dropped }
  }
  return { events: surface, dropped }
}

/**
 * Render a bounded session window into a compact transcript for the model.
 * @param events - the surface events to render.
 * @returns one line group per event (label line + payload), blank for unknown types.
 */
export function renderSessionEvents(events: readonly BriefEvent[]): string {
  return events.map(renderEvent).filter(line => line !== '').join('\n')
}

/** Render one session event into a compact transcript group. */
function renderEvent(event: BriefEvent): string {
  const time = formatEventTime(event.time)
  switch (event.type) {
    case 'user/message': {
      const text = contentText(asRecord(event.data)?.content)
      return text === '' ? `[${time}] user` : `[${time}] user\n${text}`
    }
    case 'assistant/message': {
      const message = asRecord(asRecord(event.data)?.message)
      const text = contentText(message?.content)
      return text === '' ? `[${time}] assistant` : `[${time}] assistant\n${text}`
    }
    case 'tool/call': {
      const data = asRecord(event.data)
      const name = typeof data?.name === 'string' ? data.name : ''
      const args = typeof data?.arguments === 'string' ? data.arguments : ''
      return `[${time}] tool call ${name}\n${args}`
    }
    case 'tool/result': {
      const data = asRecord(event.data)
      const message = asRecord(data?.message)
      const text = contentText(message?.content)
      const failed = data?.error !== undefined && data?.error !== null
      const label = failed ? 'tool result (error)' : 'tool result'
      return text === '' ? `[${time}] ${label}` : `[${time}] ${label}\n${text}`
    }
    default:
      return ''
  }
}

/** Compact HH:MM:SS label for an event timestamp. */
function formatEventTime(time: number): string {
  const date = new Date(Number.isFinite(time) ? time : Number.NaN)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toISOString().slice(11, 19)
}

/** Read an unknown value as a plain record, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

/** Extract every text block from a message content list (or a raw string). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(blockText).filter(text => text.trim() !== '').join('\n')
}

/** Extract the readable text of one content block. */
function blockText(block: unknown): string {
  const record = asRecord(block)
  if (record === undefined) return ''
  switch (record.type) {
    case 'text':
    case 'reasoning':
      return typeof record.text === 'string' ? record.text : ''
    case 'tool-result':
      return contentText(record.content)
    default:
      return ''
  }
}

/**
 * Bound a UTF-8 string to a byte budget without splitting a character, and
 * (when the marker fits) append a truncation marker.
 * @param text - the complete string to bound.
 * @param maxBytes - the UTF-8 byte budget for the returned text.
 * @param marker - marker appended when truncation occurs.
 * @returns the bounded text and whether truncation occurred.
 */
export function boundUtf8Bytes(
  text: string,
  maxBytes: number,
  marker: string = BRIEF_RESULT_TRUNCATION_MARKER,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  const target = maxBytes > markerBytes ? maxBytes - markerBytes : 0
  const cut = sliceUtf8(text, target)
  return target > 0 ? { text: cut + marker, truncated: true } : { text: cut, truncated: true }
}

/** Slice a string to a UTF-8 byte budget on a character boundary. */
function sliceUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let low = 0
  let high = text.length
  let end = 0
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) {
      end = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  let candidate = text.slice(0, end)
  const last = candidate.charCodeAt(candidate.length - 1)
  if (last >= 0xd800 && last <= 0xdfff) candidate = candidate.slice(0, -1)
  return candidate
}

/**
 * Build the user-role prompt for one brief generation.
 * @param input - the rendered transcript, optional focus hint, and window stats.
 * @param config - resolved brief policy carrying `maxInputBytes`.
 * @returns the bounded user prompt.
 */
export function buildBriefPrompt(input: {
  transcript: string
  focus?: string
  eventCount: number
  dropped: number
  config: ResolvedBriefConfig
}): string {
  const header = [
    'Write a concise, decision-dense markdown brief of the agent session below.',
    ...(input.focus !== undefined && input.focus.trim() !== ''
      ? [`Focus this brief on: ${input.focus.trim()}`]
      : []),
    `The transcript shows the most recent ${input.eventCount} session events`
      + (input.dropped > 0 ? ` (${input.dropped} earlier events omitted)` : '') + '.',
  ].join('\n')
  const bounded = boundUtf8Bytes(input.transcript, input.config.maxInputBytes, BRIEF_TRANSCRIPT_TRUNCATION_MARKER)
  return `${header}\n\nSession transcript:\n${bounded.text}`
}

/** System instructions for the brief generation call. */
export const BRIEF_SYSTEM_PROMPT = [
  'You are a session-briefing assistant. Produce a markdown brief of the agent session transcript supplied by the user.',
  'Use exactly these sections, in this order:',
  '## Goal',
  '## Progress',
  '## Decisions',
  '## Open questions',
  '## Next steps',
  'Rules:',
  '- Be concrete and grounded: name files, tools, commands, and decisions actually visible in the transcript; never invent facts.',
  '- One bullet per line; keep the whole brief tight (aim for well under 8 KiB).',
  '- Write "None." under a section with nothing to report.',
  'Return only the brief markdown, with no preamble or commentary.',
].join('\n')

/**
 * Resolve the provider/model route for one brief generation.
 * @param llm - the structural llm seam (used for the provider list).
 * @param config - resolved brief policy; an explicit pair wins.
 * @returns the provider/model route.
 */
export function resolveBriefLlmRoute(
  llm: BriefLlmSeam,
  config: ResolvedBriefConfig,
): { provider: string; model: string } {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const providers = llm.listProviders?.() ?? []
  const provider = providers[0]?.id
  if (provider === undefined) {
    throw new Error('rin brief: no llm provider registered')
  }
  return { provider, model: config.model ?? DEFAULT_BRIEF_MODEL }
}

/** Options for one brief generation. */
export interface BriefGenerationOptions {
  events: readonly BriefEvent[]
  focus?: string
  signal?: AbortSignal
}

/**
 * Generate one bounded markdown brief through the llm seam.
 * @param llm - the structural llm seam to drive.
 * @param config - resolved brief policy.
 * @param options - the session window, optional focus, and cancellation signal.
 * @returns the shaped, byte-bounded brief result.
 */
export async function generateBrief(
  llm: BriefLlmSeam,
  config: ResolvedBriefConfig,
  options: BriefGenerationOptions,
): Promise<BriefToolResult> {
  const route = resolveBriefLlmRoute(llm, config)
  const trimmed = trimSessionEvents(options.events, config)
  const transcript = renderSessionEvents(trimmed.events)
  const prompt = buildBriefPrompt({
    transcript,
    eventCount: trimmed.events.length,
    dropped: trimmed.dropped,
    config,
    ...(options.focus !== undefined ? { focus: options.focus } : {}),
  })
  const text = await streamBriefText(llm, route, BRIEF_SYSTEM_PROMPT, prompt, options.signal, config.maxOutputTokens)
  return shapeBriefResult(text, config, trimmed.events.length)
}

/** Stream one llm call, joining text deltas and translating terminal failures. */
async function streamBriefText(
  llm: BriefLlmSeam,
  route: { provider: string; model: string },
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  maxTokens: number,
): Promise<string> {
  signal?.throwIfAborted()
  let text = ''
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    prompt,
    maxTokens,
    ...(signal !== undefined ? { signal } : {}),
  })) {
    signal?.throwIfAborted()
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
        throw new Error(`rin brief: llm call failed: ${chunk.reason.failure?.message ?? chunk.reason.kind}`)
      }
      break
    }
  }
  return text
}

/**
 * Shape the raw model output into the canonical, byte-bounded brief result.
 * @param text - the raw model output.
 * @param config - resolved brief policy carrying `maxResultBytes`.
 * @param eventCount - number of session events the brief summarized.
 * @returns the shaped result.
 */
export function shapeBriefResult(text: string, config: ResolvedBriefConfig, eventCount: number): BriefToolResult {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new Error('rin brief: the model produced no brief text')
  }
  const bounded = boundUtf8Bytes(trimmed, config.maxResultBytes, BRIEF_RESULT_TRUNCATION_MARKER)
  return { markdown: bounded.text, eventCount, truncated: bounded.truncated }
}

/** Require an initiating agent for the brief tool, failing loud otherwise. */
function requireAgent(agent: { session: { events: readonly BriefEvent[] } } | undefined): { session: { events: readonly BriefEvent[] } } {
  if (agent === undefined) throw new Error('rin brief: the brief tool requires an initiating agent')
  return agent
}

/** Safely project a canonical value onto the brief result shape. */
function briefResultValue(value: unknown): BriefToolResult {
  if (typeof value === 'object' && value !== null) {
    const record = value as { markdown?: unknown; eventCount?: unknown; truncated?: unknown }
    return {
      markdown: typeof record.markdown === 'string' ? record.markdown : '',
      eventCount: typeof record.eventCount === 'number' ? record.eventCount : 0,
      truncated: record.truncated === true,
    }
  }
  return { markdown: '', eventCount: 0, truncated: false }
}

/**
 * Build the structural `brief` tool definition over one llm seam.
 * @param llm - the structural llm seam the tool drives.
 * @param config - resolved brief policy.
 * @returns the structural tool descriptor.
 */
export function briefToolDescriptor(llm: BriefLlmSeam, config: ResolvedBriefConfig): BriefTool {
  return {
    name: 'brief',
    description: 'Generate a structured markdown brief of the current session (Goal, Progress, Decisions, Open questions, Next steps) from the session log.',
    parameters: {
      focus: { type: 'string', description: 'Optional area to focus the brief on, such as a subsystem, file, or open question.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', required: true },
          eventCount: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: briefResultValue(value).markdown }],
      presentationMeta: (_args, value) => ({ ...briefResultValue(value) }),
    },
    execute: async (args, exec: BriefToolExec) => {
      const agent = requireAgent(exec.agent)
      return generateBrief(llm, config, {
        events: agent.session.events,
        ...(typeof args.focus === 'string' && args.focus.trim() !== '' ? { focus: args.focus } : {}),
        signal: exec.signal,
      })
    },
    presentCall: (args) => {
      const focus = typeof (args as { focus?: unknown }).focus === 'string' ? (args as { focus: string }).focus : undefined
      return {
        card: 'generic',
        title: 'Generate session brief',
        kind: 'execute',
        ...(focus !== undefined ? { rawInput: focus } : {}),
      }
    },
  }
}

/** Execute the `/brief` command body against one llm seam. */
async function runBriefCommand(
  llm: BriefLlmSeam,
  config: ResolvedBriefConfig,
  invocation: BriefCommandInvocation,
): Promise<BriefCommandResult> {
  try {
    const result = await generateBrief(llm, config, {
      events: invocation.agent.session.events,
      ...(invocation.rawInput.trim() !== '' ? { focus: invocation.rawInput } : {}),
      signal: invocation.signal,
    })
    return { kind: 'success', text: result.markdown }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Build the structural `/brief` command definition over one llm seam.
 * @param llm - the structural llm seam the command drives.
 * @param config - resolved brief policy.
 * @returns the structural command descriptor.
 */
export function briefCommandDescriptor(llm: BriefLlmSeam, config: ResolvedBriefConfig): BriefCommand {
  return {
    name: 'brief',
    description: 'Generate a markdown brief of the current session',
    input: { hint: '[focus hint]' },
    handler: invocation => runBriefCommand(llm, config, invocation),
  }
}

/**
 * The seam projection: registers the `brief` tool and the `/brief` command.
 * Dispose removes every registration; idempotent.
 */
export class BriefCore {
  private readonly disposers: Array<() => void> = []

  constructor(seam: BriefSeam, config: ResolvedBriefConfig) {
    this.disposers.push(
      seam.tools.register(briefToolDescriptor(seam.llm, config)),
      seam.commands.register(briefCommandDescriptor(seam.llm, config)),
    )
    seam.effect(() => this.dispose())
  }

  /** Remove every tool/command registration. Idempotent. */
  dispose(): void {
    for (const disposer of this.disposers.splice(0)) {
      try {
        disposer()
      } catch {
        // One failed cleanup must not block the remaining disposers.
      }
    }
  }
}
