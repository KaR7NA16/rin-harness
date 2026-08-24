/**
 * rin review — structural types shared by the dependency-free core and the dsh seam.
 *
 * The core never imports @deepseek-ai/cordis or @deepseek-ai/dsh-tools; every
 * real value crossing the package boundary is projected onto these structural
 * types here, and the seam (seam.ts) performs the adaptation.
 *
 * @module @rin/authoring/review
 */

/** The two review lenses supported by the review capability. */
export type ReviewArtifactKind = 'general' | 'security'

/** Plugin configuration input before default resolution. */
export interface ReviewConfig {
  /** Explicit provider route; must be paired with `model`. */
  provider?: string
  /** Explicit model id; must be paired with `provider`. */
  model?: string
  /** Maximum UTF-8 bytes of the artifact text sent to the model. */
  maxInputBytes?: number
  /** Maximum UTF-8 bytes of the produced review markdown. */
  maxResultBytes?: number
  /** Output-token cap for the review generation call. */
  maxOutputTokens?: number
}

/** Resolved review policy with every default materialized. */
export interface ResolvedReviewConfig {
  provider: string | undefined
  model: string | undefined
  maxInputBytes: number
  maxResultBytes: number
  maxOutputTokens: number
}

/** Structural projection of the llm stream request the review core sends. */
export interface ReviewLlmRequest {
  provider: string
  model: string
  /** System instructions for the generation call. */
  system: string
  /** The user-role prompt carrying the framed artifact. */
  prompt: string
  /** Optional cancellation signal forwarded to the provider stream. */
  signal?: AbortSignal
  /** Output-token cap for the generation call. */
  maxTokens: number
}

/** Structural projection of the finish reason the review core consumes. */
export interface ReviewFinishReason {
  kind: string
  failure?: { message: string }
}

/** Structural projection of one llm stream chunk the review core consumes. */
export type ReviewLlmChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; reason: ReviewFinishReason }

/** Minimal llm seam the dependency-free core drives (adapted from ctx.llm). */
export interface ReviewLlmSeam {
  /** Optional provider-route listing used to pick the first registered provider. */
  listProviders?(): ReadonlyArray<{ id: string; name: string }>
  /** Stream one generation; yields text-delta chunks and a terminal finish. */
  stream(request: ReviewLlmRequest): AsyncIterable<ReviewLlmChunk>
}

/** Canonical `review_artifact` tool result value. */
export interface ReviewToolResult {
  /** The generated markdown review. */
  markdown: string
  /** The review lens that produced the review. */
  kind: ReviewArtifactKind
  /** Whether the produced markdown was byte-truncated to the result bound. */
  truncated: boolean
}

/** Structural execution context handed to the review tool body. */
export interface ReviewToolExec {
  /** Cancellation signal for this call. */
  signal: AbortSignal
}

/** Structural projection of the dsh `review_artifact` tool definition. */
export interface ReviewTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
    presentationMeta?(args: unknown, value: unknown): Record<string, unknown> | null
  }
  execute(args: Record<string, unknown>, exec: ReviewToolExec): Promise<ReviewToolResult> | ReviewToolResult
  presentCall?(args: Record<string, unknown>): { card: string; title: string; kind: string; rawInput?: string }
}

/** Structural projection of a dsh command invocation for the review commands. */
export interface ReviewCommandInvocation {
  rawInput: string
  signal: AbortSignal
}

/** Structural projection of the dsh command result union. */
export type ReviewCommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

/** Structural projection of a dsh command definition for the review commands. */
export interface ReviewCommand {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: ReviewCommandInvocation): ReviewCommandResult | Promise<ReviewCommandResult>
}

/** The minimal context surface the review core consumes. */
export interface ReviewSeam {
  tools: {
    /** Register a model-visible tool; returns its disposer. */
    register(tool: ReviewTool): () => void
  }
  commands: {
    /** Register a slash command; returns its disposer. */
    register(command: ReviewCommand): () => void
  }
  /** The llm seam the tool and commands drive. */
  llm: ReviewLlmSeam
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void): void
}
