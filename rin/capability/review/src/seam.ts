/**
 * rin review — dsh seam registration.
 *
 * Adapts the real Cordis Context to the structural ReviewSeam and constructs
 * the ReviewCore, which registers the model-visible `review_artifact` tool
 * and the `/review` / `/security-review` slash commands. This module is the
 * only place that touches @deepseek-ai/cordis, @deepseek-ai/dsh-tools, and
 * @deepseek-ai/dsh-llm; all logic lives in the dependency-free core.
 *
 * @module @rin/review
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { ReviewCore, resolveReviewConfig } from './core.ts'
import type {
  ReviewConfig,
  ReviewLlmChunk,
  ReviewLlmSeam,
  ReviewSeam,
  ReviewTool,
} from './types.ts'

/** Plugin configuration: the review policy fields, all optional. */
export interface Config extends ReviewConfig {}

/** Wrap one structural tool descriptor into a registry-ready dsh tool. */
function toDshTool(tool: ReviewTool) {
  // The descriptor is built to satisfy defineTool's input structurally; the
  // any keeps defineTool's schema generics from recursing (TS2321 on the wide
  // DefineToolOptions instantiation). Shape is enforced by tools-core + smoke.
  // oxlint-disable-next-line no-explicit-any -- structural seam: TS2321 on the wide DefineToolOptions union
  return tool as any
}

/** Map real llm chunks onto the structural chunk union the core consumes. */
async function* mapReviewChunks(source: AsyncIterable<StreamChunk>): AsyncIterable<ReviewLlmChunk> {
  for await (const chunk of source) {
    if (chunk.type === 'text-delta') {
      yield { type: 'text-delta', text: chunk.text }
    } else if (chunk.type === 'finish') {
      yield { type: 'finish', reason: chunk.reason }
    }
    // Other chunk kinds (block boundaries, usage) carry no review text.
  }
}

/**
 * Register the seam projection: the `review_artifact` tool and the
 * `/review` / `/security-review` commands.
 * @param ctx - the plugin context (must inject tools and commands).
 * @param config - the resolved plugin configuration.
 */
export function registerSeam(ctx: Context, config: Config = {}): void {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('rin review: requires a composed dsh llm seam (ctx.get("llm"))')
  }
  const resolved = resolveReviewConfig(config)
  const seam: ReviewSeam = {
    tools: {
      register(tool) {
        return ctx.tools.register(defineTool(toDshTool(tool)))
      },
    },
    commands: {
      register(command: CommandDefinition) {
        return ctx.commands.register(command)
      },
    },
    llm: {
      listProviders: () => llm.listProviders(),
      stream: request => mapReviewChunks(llm.stream({
        provider: request.provider,
        model: request.model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: request.prompt }],
          source: { kind: 'user' },
        })],
        system: request.system,
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
        maxTokens: request.maxTokens,
      })),
    } satisfies ReviewLlmSeam,
    effect: disposer => {
      // ctx.effect expects the body to return an effect (disposer); a bare
      // void-returning callback is not one, so wrap it in a disposing body.
      ctx.effect(() => disposer, 'rin/review.dispose')
    },
  }
  void new ReviewCore(seam, resolved)
}
