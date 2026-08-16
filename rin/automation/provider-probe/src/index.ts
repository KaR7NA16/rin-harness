/**
 * rin provider-probe — Cordis plugin entry.
 *
 * Exposes a ctx.providerProbe service that runs a direct-upstream provider
 * connectivity test and discovers a provider's model list. The pure probe logic
 * lives in probe.ts (global fetch + AbortSignal only, cordis-free); this module
 * owns the Cordis registration.
 *
 * @module @rin/provider-probe
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  discoverProviderModels,
  testProviderConfig,
} from './probe.ts'
import type {
  DiscoveryInput,
  ProviderModelDiscoveryResult,
  ProviderTestInput,
  ProviderTestResult,
} from './probe.ts'

export {
  buildOpenAICompatibleUrl,
  clearProviderDiscoveryCache,
  discoverProviderModels,
  testProviderConfig,
} from './probe.ts'
export type * from './probe.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    providerProbe: ProviderProbeService
  }
}

/** The provider-probe service exposed on the shared context. */
export abstract class ProviderProbeService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'providerProbe')
  }

  /** Direct-upstream connectivity test for one provider config. */
  abstract test(input: ProviderTestInput): Promise<ProviderTestResult>

  /** Discover a provider's model list from its model-list endpoint. */
  abstract discover(input: DiscoveryInput): Promise<ProviderModelDiscoveryResult>
}

/** fetch-based implementation delegating to the cordis-free probe core. */
export class FetchProviderProbeService extends ProviderProbeService {
  override test(input: ProviderTestInput) {
    return testProviderConfig(input)
  }

  override discover(input: DiscoveryInput) {
    return discoverProviderModels(input)
  }
}

export const name = 'provider-probe'
export const inject: string[] = []

/** Install the fetch-backed provider-probe service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FetchProviderProbeService)
}
