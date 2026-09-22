/**
 * auth.ts — createAuthProvider: the R8 auth union → a nucleus AuthProvider.
 *
 *   'dev'     → StaticAuth (the existing hosted-test shape — HOISTED from
 *               apps/organism/tests/hosted-gateway-contract.integration.test.ts:40
 *               @ b2f408e, parameterized over the token)
 *   'cognito' → CognitoAuthSession (src/gateway/cognito-auth-session.ts,
 *               landed by U7 — design §2.7; near-as-is organism hoist).
 *               Construction is offline-safe: restore() only touches storage
 *               (none here — a fresh session per boot-config call, no
 *               `storage` override), settles 'anonymous', and token()
 *               returns undefined until signIn()/tokens are installed. A
 *               boot config only carries {region, clientId, userPoolId?} —
 *               it names a Cognito USER POOL, not a signed-in identity; the
 *               caller signs in against the returned session afterward. An
 *               unsigned-in session against the gateway produces an honest
 *               401 → 'unauthorized', never a silent downgrade.
 *   'none'    → AnonymousAuth. Anonymous against a gateway produces an honest
 *               401 → 'unauthorized' downstream — never a silent downgrade.
 */

import type { AuthProvider } from '@shrubbery/nucleus'
import type { PlanterAuth } from './boot.js'
import { CognitoAuthSession } from './gateway/cognito-auth-session.js'

/** Fixed-token AuthProvider — dev / loopback / pn-dev-token deployments. */
export class StaticAuth implements AuthProvider {
  constructor(
    private readonly bearer: string,
    private readonly id: string = 'dev',
  ) {}
  token(): string {
    return this.bearer
  }
  userId(): string {
    return this.id
  }
  isAuthenticated(): boolean {
    return true
  }
  whenReady(): Promise<void> {
    return Promise.resolve()
  }
  onChange(): () => void {
    return () => {}
  }
}

/** No credential at all — the honest anonymous identity. */
export class AnonymousAuth implements AuthProvider {
  token(): undefined {
    return undefined
  }
  userId(): string {
    return 'anonymous'
  }
  isAuthenticated(): boolean {
    return false
  }
  whenReady(): Promise<void> {
    return Promise.resolve()
  }
  onChange(): () => void {
    return () => {}
  }
}

/** Build the AuthProvider for a boot-config auth union member. */
export function createAuthProvider(auth: PlanterAuth): AuthProvider {
  switch (auth.mode) {
    case 'dev':
      return new StaticAuth(auth.token)
    case 'none':
      return new AnonymousAuth()
    case 'cognito':
      return new CognitoAuthSession({
        config: {
          region: auth.region,
          clientId: auth.clientId,
          ...(auth.userPoolId !== undefined ? { userPoolId: auth.userPoolId } : {}),
        },
      })
  }
}
