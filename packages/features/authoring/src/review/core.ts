/**
 * rin review — dependency-free core.
 *
 * Holds the pure logic (config resolution, prompt building, result shaping
 * and byte bounding), the structural tool/command descriptors, and the
 * ReviewCore registry wiring. The module imports only node builtins and the
 * package's own types, so the strip-types smoke and the unit tests can
 * exercise the behavior without pulling in the @deepseek-ai/cordis or
 * @deepseek-ai/dsh-tools import graph. The dsh seam (seam.ts) adapts the
 * real Context to this core's structural ReviewSeam.
 *
 * @module @rin/authoring/review
 */

import { Buffer } from 'node:buffer'
import type {
  ResolvedReviewConfig,
  ReviewArtifactKind,
  ReviewCommand,
  ReviewCommandInvocation,
  ReviewCommandResult,
  ReviewConfig,
  ReviewLlmSeam,
  ReviewSeam,
  ReviewTool,
  ReviewToolExec,
  ReviewToolResult,
} from './types.ts'

/** Default model used when no explicit provider/model pair is configured. */
export const DEFAULT_REVIEW_MODEL = 'deepseek-v4-flash'
/** Default UTF-8 byte bound for the artifact text sent to the model. */
export const DEFAULT_REVIEW_MAX_INPUT_BYTES = 64 * 1024
/** Default UTF-8 byte bound for the produced review markdown. */
export const DEFAULT_REVIEW_MAX_RESULT_BYTES = 16 * 1024
/** Default output-token cap for the review generation call. */
export const DEFAULT_REVIEW_MAX_OUTPUT_TOKENS = 2048
/** Marker appended when the artifact exceeds `maxInputBytes`. */
export const REVIEW_ARTIFACT_TRUNCATION_MARKER = '\n\n… (artifact truncated)'
/** Marker appended when the produced review exceeds `maxResultBytes`. */
export const REVIEW_RESULT_TRUNCATION_MARKER = '\n\n… (review truncated)'

/**
 * Materialize deployment defaults into a resolved review policy.
 * @param input - plugin configuration input, or undefined for pure defaults.
 * @returns the resolved policy with every bound materialized.
 */
export function resolveReviewConfig(input: ReviewConfig | undefined): ResolvedReviewConfig {
  const config = input ?? {}
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('rin review: provider and model must be configured together')
  }
  return {
    provider: config.provider,
    model: config.model,
    maxInputBytes: positiveInt('maxInputBytes', config.maxInputBytes, DEFAULT_REVIEW_MAX_INPUT_BYTES),
    maxResultBytes: positiveInt('maxResultBytes', config.maxResultBytes, DEFAULT_REVIEW_MAX_RESULT_BYTES),
    maxOutputTokens: positiveInt('maxOutputTokens', config.maxOutputTokens, DEFAULT_REVIEW_MAX_OUTPUT_TOKENS),
  }
}

/** Validate one positive-safe-integer policy field. */
function positiveInt(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`rin review: ${name} must be a positive safe integer`)
  }
  return value
}

/** System instructions for the general review lens. */
export const REVIEW_SYSTEM_PROMPT_GENERAL = [
  'You are a rigorous code and artifact reviewer. Review the supplied artifact (code, diff, or text) and produce a markdown review with exactly these sections in order:',
  '## Summary',
  '## Issues',
  '## Recommendations',
  'Formatting rules:',
  '- Group Issues by severity: ### Critical, ### High, ### Medium, ### Low.',
  '- Each issue is one bullet: "- [severity] Title — concise explanation", plus a "(file:line)" reference when the artifact carries one.',
  '- Order issues by severity, critical first; within a severity, by impact.',
  '- Report only genuine, actionable issues grounded in the artifact.',
  '- Make Recommendations numbered, concrete, and actionable.',
  'Return only the review markdown, with no preamble or commentary.',
].join('\n')

/** System instructions for the security review lens. */
export const REVIEW_SYSTEM_PROMPT_SECURITY = [
  'You are a security-focused reviewer. Review the supplied artifact (code, diff, or text) for security risks and produce a markdown review with exactly these sections in order:',
  '## Summary',
  '## Issues',
  '## Recommendations',
  'Formatting rules:',
  '- Group Issues by severity: ### Critical, ### High, ### Medium, ### Low.',
  '- Each issue is one bullet: "- [severity] Title — concise explanation", plus a "(file:line)" reference when the artifact carries one.',
  '- Actively look for: injection (shell/SQL/path/command), secrets and credentials, unsafe patterns (eval, unsafe deserialization, missing input validation), authentication/authorization flaws, and data exposure.',
  '- Order issues by severity, critical first; within a severity, by impact.',
  '- Report only genuine, actionable issues grounded in the artifact.',
  '- Make Recommendations numbered, concrete, and actionable.',
  'Return only the review markdown, with no preamble or commentary.',
].join('\n')

/**
 * Select the system prompt for a review lens.
 * @param kind - the review lens.
 * @returns the matching system instructions.
 */
export function reviewSystemPrompt(kind: ReviewArtifactKind): string {
  return kind === 'security' ? REVIEW_SYSTEM_PROMPT_SECURITY : REVIEW_SYSTEM_PROMPT_GENERAL
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
  marker: string = REVIEW_RESULT_TRUNCATION_MARKER,
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
 * Build the user-role prompt for one review generation.
 * @param text - the artifact text (code, diff, or other content).
 * @param kind - the review lens.
 * @param config - resolved review policy carrying `maxInputBytes`.
 * @returns the bounded user prompt.
 */
export function buildReviewPrompt(text: string, kind: ReviewArtifactKind, config: ResolvedReviewConfig): string {
  const bounded = boundUtf8Bytes(text, config.maxInputBytes, REVIEW_ARTIFACT_TRUNCATION_MARKER)
  return `Artifact to review (kind: ${kind}):\n${bounded.text}`
}

/**
 * Resolve the provider/model route for one review generation.
 * @param llm - the structural llm seam (used for the provider list).
 * @param config - resolved review policy; an explicit pair wins.
 * @returns the provider/model route.
 */
export function resolveReviewLlmRoute(
  llm: ReviewLlmSeam,
  config: ResolvedReviewConfig,
): { provider: string; model: string } {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const providers = llm.listProviders?.() ?? []
  const provider = providers[0]?.id
  if (provider === undefined) {
    throw new Error('rin review: no llm provider registered')
  }
  return { provider, model: config.model ?? DEFAULT_REVIEW_MODEL }
}

/** Options for one review generation. */
export interface ReviewGenerationOptions {
  text: string
  kind: ReviewArtifactKind
  signal?: AbortSignal
}

/**
 * Generate one bounded markdown review through the llm seam.
 * @param llm - the structural llm seam to drive.
 * @param config - resolved review policy.
 * @param options - the artifact text, the review lens, and the cancellation signal.
 * @returns the shaped, byte-bounded review result.
 */
export async function generateReview(
  llm: ReviewLlmSeam,
  config: ResolvedReviewConfig,
  options: ReviewGenerationOptions,
): Promise<ReviewToolResult> {
  const route = resolveReviewLlmRoute(llm, config)
  const prompt = buildReviewPrompt(options.text, options.kind, config)
  const text = await streamReviewText(
    llm,
    route,
    reviewSystemPrompt(options.kind),
    prompt,
    options.signal,
    config.maxOutputTokens,
  )
  return shapeReviewResult(text, options.kind, config)
}

/** Stream one llm call, joining text deltas and translating terminal failures. */
async function streamReviewText(
  llm: ReviewLlmSeam,
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
        throw new Error(`rin review: llm call failed: ${chunk.reason.failure?.message ?? chunk.reason.kind}`)
      }
      break
    }
  }
  return text
}

/**
 * Shape the raw model output into the canonical, byte-bounded review result.
 * @param text - the raw model output.
 * @param kind - the review lens that produced it.
 * @param config - resolved review policy carrying `maxResultBytes`.
 * @returns the shaped result.
 */
export function shapeReviewResult(text: string, kind: ReviewArtifactKind, config: ResolvedReviewConfig): ReviewToolResult {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new Error('rin review: the model produced no review text')
  }
  const bounded = boundUtf8Bytes(trimmed, config.maxResultBytes, REVIEW_RESULT_TRUNCATION_MARKER)
  return { markdown: bounded.text, kind, truncated: bounded.truncated }
}

/** Safely project a canonical value onto the review result shape. */
function reviewResultValue(value: unknown): ReviewToolResult {
  if (typeof value === 'object' && value !== null) {
    const record = value as { markdown?: unknown; kind?: unknown; truncated?: unknown }
    return {
      markdown: typeof record.markdown === 'string' ? record.markdown : '',
      kind: record.kind === 'security' ? 'security' : 'general',
      truncated: record.truncated === true,
    }
  }
  return { markdown: '', kind: 'general', truncated: false }
}

/** Normalize a model-supplied lens argument onto the supported union. */
export function normalizeReviewKind(kind: unknown): ReviewArtifactKind {
  return kind === 'security' ? 'security' : 'general'
}

/**
 * Build the structural `review_artifact` tool definition over one llm seam.
 * @param llm - the structural llm seam the tool drives.
 * @param config - resolved review policy.
 * @returns the structural tool descriptor.
 */
export function reviewToolDescriptor(llm: ReviewLlmSeam, config: ResolvedReviewConfig): ReviewTool {
  return {
    name: 'review_artifact',
    description: 'Review a provided artifact (code, diff, or text) and return a markdown review: Summary, Issues grouped by severity (critical/high/medium/low) with file/line references when present, and Recommendations. Pass kind "security" for a security-focused review.',
    parameters: {
      text: { type: 'string', required: true, description: 'The artifact text to review: code, diff, or any other content.' },
      kind: { type: 'string', enum: ['general', 'security'], description: 'Review lens: general (default) or security.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: reviewResultValue(value).markdown }],
      presentationMeta: (_args, value) => ({ ...reviewResultValue(value) }),
    },
    execute: async (args, exec: ReviewToolExec) => {
      const text = typeof args.text === 'string' ? args.text : ''
      if (text.trim() === '') {
        throw new Error('rin review: text is required and must not be blank')
      }
      return generateReview(llm, config, {
        text,
        kind: normalizeReviewKind(args.kind),
        signal: exec.signal,
      })
    },
    presentCall: (args) => {
      const kind = normalizeReviewKind((args as { kind?: unknown }).kind)
      const rawInput = typeof (args as { text?: unknown }).text === 'string' ? (args as { text: string }).text : undefined
      return {
        card: 'generic',
        title: kind === 'security' ? 'Security-review artifact' : 'Review artifact',
        kind: 'execute',
        ...(rawInput !== undefined ? { rawInput } : {}),
      }
    },
  }
}

/** Execute one review slash command body against one llm seam. */
async function runReviewCommand(
  llm: ReviewLlmSeam,
  config: ResolvedReviewConfig,
  kind: ReviewArtifactKind,
  invocation: ReviewCommandInvocation,
): Promise<ReviewCommandResult> {
  const text = invocation.rawInput.trim()
  if (text === '') {
    return {
      kind: 'error',
      text: `rin review: no artifact text provided; paste the artifact after /${kind === 'security' ? 'security-review' : 'review'}`,
    }
  }
  try {
    const result = await generateReview(llm, config, { text, kind, signal: invocation.signal })
    return { kind: 'success', text: result.markdown }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Build the structural review slash command definition over one llm seam.
 * @param llm - the structural llm seam the command drives.
 * @param config - resolved review policy.
 * @param kind - the review lens: 'general' for /review, 'security' for /security-review.
 * @returns the structural command descriptor.
 */
export function reviewCommandDescriptor(llm: ReviewLlmSeam, config: ResolvedReviewConfig, kind: ReviewArtifactKind): ReviewCommand {
  const security = kind === 'security'
  return {
    name: security ? 'security-review' : 'review',
    description: security
      ? 'Run a security-focused review of an artifact (paste the artifact text after the command)'
      : 'Review an artifact (paste the artifact text after the command)',
    input: { hint: '<artifact text>' },
    handler: invocation => runReviewCommand(llm, config, kind, invocation),
  }
}

/**
 * The seam projection: registers the `review_artifact` tool and the
 * `/review` and `/security-review` commands. Dispose removes every
 * registration; idempotent.
 */
export class ReviewCore {
  private readonly disposers: Array<() => void> = []

  constructor(seam: ReviewSeam, config: ResolvedReviewConfig) {
    this.disposers.push(
      seam.tools.register(reviewToolDescriptor(seam.llm, config)),
      seam.commands.register(reviewCommandDescriptor(seam.llm, config, 'general')),
      seam.commands.register(reviewCommandDescriptor(seam.llm, config, 'security')),
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
