/**
 * rin brief — structural types shared by the dependency-free core and the dsh seam.
 *
 * The core never imports @deepseek-ai/cordis or @deepseek-ai/dsh-tools; every
 * real value crossing the package boundary is projected onto these structural
 * types here, and the seam (seam.ts) performs the adaptation.
 *
 * @module @rin/brief
 */

/** One session-log event projected structurally for the brief core. */
export interface BriefEvent {
  /** Session event type tag (e.g. 'user/message', 'tool/call'). */
  type: string
  /** Monotonic sequence number within the session. */
  seq: number
  /** Unix epoch milliseconds. */
  time: number
  /** Lossless-JSON event payload; interpreted structurally at render time. */
  data: unknown
}

/** Plugin configuration input before default resolution. */
export interface BriefConfig {
  /** Explicit provider route; must be paired with `model`. */
  provider?: string
  /** Explicit model id; must be paired with `provider`. */
  model?: string
  /** Maximum number of recent surface events included in the transcript. */
  maxEvents?: number
  /** Maximum UTF-8 bytes of the rendered transcript sent to the model. */
  maxInputBytes?: number
  /** Maximum UTF-8 bytes of the produced brief markdown. */
  maxResultBytes?: number
  /** Output-token cap for the brief generation call. */
  maxOutputTokens?: number
}

/** Resolved brief generation policy with every default materialized. */
export interface ResolvedBriefConfig {
  provider: string | undefined
  model: string | undefined
  maxEvents: number
  maxInputBytes: number
  maxResultBytes: number
  maxOutputTokens: number
}

/** Structural projection of the llm stream request the brief core sends. */
export interface BriefLlmRequest {
  provider: string
  model: string
  /** System instructions for the generation call. */
  system: string
  /** The user-role prompt carrying focus and transcript. */
  prompt: string
  /** Optional cancellation signal forwarded to the provider stream. */
  signal?: AbortSignal
  /** Output-token cap for the generation call. */
  maxTokens: number
}

/** Structural projection of the finish reason the brief core consumes. */
export interface BriefFinishReason {
  kind: string
  failure?: { message: string }
}

/** Structural projection of one llm stream chunk the brief core consumes. */
export type BriefLlmChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; reason: BriefFinishReason }

/** Minimal llm seam the dependency-free core drives (adapted from ctx.llm). */
export interface BriefLlmSeam {
  /** Optional provider-route listing used to pick the first registered provider. */
  listProviders?(): ReadonlyArray<{ id: string; name: string }>
  /** Stream one generation; yields text-delta chunks and a terminal finish. */
  stream(request: BriefLlmRequest): AsyncIterable<BriefLlmChunk>
}

/** Canonical `brief` tool result value. */
export interface BriefToolResult {
  /** The generated markdown brief. */
  markdown: string
  /** Number of session events the brief summarized. */
  eventCount: number
  /** Whether the produced markdown was byte-truncated to the result bound. */
  truncated: boolean
}

/** Structural execution context handed to the brief tool body. */
export interface BriefToolExec {
  /** Initiating agent, absent on nested dispatches without an owner. */
  agent?: { session: { events: readonly BriefEvent[] } }
  /** Cancellation signal for this call. */
  signal: AbortSignal
}

/** Structural projection of the dsh `brief` tool definition. */
export interface BriefTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
    presentationMeta?(args: unknown, value: unknown): Record<string, unknown> | null
  }
  execute(args: Record<string, unknown>, exec: BriefToolExec): Promise<BriefToolResult> | BriefToolResult
  presentCall?(args: Record<string, unknown>): { card: string; title: string; kind: string; rawInput?: string }
}

/** Structural projection of a dsh command invocation for the brief command. */
export interface BriefCommandInvocation {
  agent: { session: { events: readonly BriefEvent[] } }
  rawInput: string
  signal: AbortSignal
}

/** Structural projection of the dsh command result union. */
export type BriefCommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

/** Structural projection of the dsh `brief` command definition. */
export interface BriefCommand {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: BriefCommandInvocation): BriefCommandResult | Promise<BriefCommandResult>
}

/** The minimal context surface the brief core consumes. */
export interface BriefSeam {
  tools: {
    /** Register a model-visible tool; returns its disposer. */
    register(tool: BriefTool): () => void
  }
  commands: {
    /** Register a slash command; returns its disposer. */
    register(command: BriefCommand): () => void
  }
  /** The llm seam the tool and command drive. */
  llm: BriefLlmSeam
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void): void
}
