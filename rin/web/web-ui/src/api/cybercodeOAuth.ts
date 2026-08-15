// desktop/src/api/cybercodeOAuth.ts

import { api, getBaseUrl } from './client'

export type CybercodeOAuthStatus =
  | { loggedIn: false }
  | {
      loggedIn: true
      expiresAt: number | null
      scopes: string[]
      subscriptionType: 'pro' | 'max' | 'team' | 'enterprise' | null
    }

function currentServerPort(): number {
  const port = new URL(getBaseUrl()).port
  const parsed = Number.parseInt(port, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Cannot determine server port from baseUrl: ${getBaseUrl()}`)
  }
  return parsed
}

// NOTE: the @rin/web-server backend does not yet implement /api/rin-oauth/*.
// These calls are a stub carried over from the legacy desktop frontend.
export const cybercodeOAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string; state: string }>(
      '/api/rin-oauth/start',
      { serverPort: currentServerPort() },
    )
  },

  status() {
    return api.get<CybercodeOAuthStatus>('/api/rin-oauth')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/rin-oauth')
  },
}
