/**
 * rin brief — dsh seam registration.
 *
 * Adapts the real Cordis Context to the structural BriefSeam and constructs
 * the BriefCore, which registers the model-visible `brief` tool and the
 * `/brief` slash command. This module is the only place that touches
 * @deepseek-ai/cordis, @deepseek-ai/dsh-tools, and @deepseek-ai/dsh-llm; all
 * logic lives in the dependency-free core.
 *
 * @module @rin/authoring/brief
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { BriefCore, resolveBriefConfig } from './core.ts'
import type {
  BriefConfig,
  BriefLlmChunk,
  BriefLlmSeam,
  BriefSeam,
  BriefTool,
} from './types.ts'

/** Plugin configuration: the brief policy fields, all optional. */
export interface Config extends BriefConfig {}

/** Wrap one structural tool descriptor into a registry-ready dsh tool. */
function toDshTool(tool: BriefTool) {
  // The descriptor is built to satisfy defineTool's input structurally; the
  // any keeps defineTool's schema generics from recursing (TS2321 on the wide
  // DefineToolOptions instantiation). Shape is enforced by tools-core + smoke.
  // oxlint-disable-next-line no-explicit-any -- structural seam: TS2321 on the wide DefineToolOptions union
  return tool as any
}

/** Map real llm chunks onto the structural chunk union the core consumes. */
async function* mapBriefChunks(source: AsyncIterable<StreamChunk>): AsyncIterable<BriefLlmChunk> {
  for await (const chunk of source) {
    if (chunk.type === 'text-delta') {
      yield { type: 'text-delta', text: chunk.text }
    } else if (chunk.type === 'finish') {
      yield { type: 'finish', reason: chunk.reason }
    }
    // Other chunk kinds (block boundaries, usage) carry no brief text.
  }
}

/**
 * Register the seam projection: the `brief` tool and the `/brief` command.
 * @param ctx - the plugin context (must inject tools and commands).
 * @param config - the resolved plugin configuration.
 */
export function registerSeam(ctx: Context, config: Config = {}): void {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('rin brief: requires a composed dsh llm seam (ctx.get("llm"))')
  }
  const resolved = resolveBriefConfig(config)
  const seam: BriefSeam = {
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
      stream: request => mapBriefChunks(llm.stream({
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
    } satisfies BriefLlmSeam,
    effect: disposer => {
      // ctx.effect expects the body to return an effect (disposer); a bare
      // void-returning callback is not one, so wrap it in a disposing body.
      ctx.effect(() => disposer, 'rin/brief.dispose')
    },
  }
  void new BriefCore(seam, resolved)
}
