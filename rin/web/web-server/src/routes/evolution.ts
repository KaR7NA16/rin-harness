/**
 * rin web-server — evolution routes.
 *
 * Read-only evolution overview over ctx.evolution (config + candidate/event
 * state). Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  error,
  errorMessage,
  mounted,
  notMounted,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the evolution pathnames; null for anything else. */
export async function handle(
  pathname: string,
  _search: string,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/evolution/overview':
      return evolutionOverviewRoute(services)
    default:
      return null
  }
}

async function evolutionOverviewRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const evolution = services.evolution()
  if (evolution === undefined) return notMounted()
  try {
    const [config, state] = await Promise.all([evolution.readConfig(), evolution.readState()])
    const pending = state.candidates.filter(candidate => candidate.status === 'pending')
    const recent = [...state.candidates]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)
    return mounted({
      config,
      pendingCandidates: pending,
      recentCandidates: recent,
      events: state.events,
    })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}
