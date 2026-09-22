/**
 * cognito-auth-session.ts — Cognito authentication for hosted deployments.
 *
 * HOISTED from apps/organism/src/cell/cognito-auth-session.ts @ b2f408e
 * (design §2.2 hoist map: "as-is") — organism's copy is frozen under active
 * swarm ownership; @shrubbery/source is the sole external
 * adapter-consumption convention.
 *
 * ONE documented delta from the organism original (found + fixed during the
 * U7 hoist review, not in the design's hoist map): `browserStorage()` now
 * structurally verifies getItem/setItem/removeItem before trusting
 * `globalThis.localStorage`, instead of a bare `typeof === 'object'` check.
 * Node 22+ exposes a global `localStorage` object even outside a browser,
 * but — verified on Node 25 — without `--localstorage-file` it is a
 * non-functional stub with NO getItem/setItem/removeItem, so the organism
 * check would construct a "storage" that throws on first use. The
 * structural check degrades to the already-documented storageless path
 * instead.
 *
 * This module performs the real Cognito Identity Provider calls, persists/
 * refreshes tokens, and exposes the narrow AuthProvider shape consumed by
 * the hosted-gateway TripleSource (R8 auth union member 'cognito').
 * Construction is offline-safe: restore() only touches storage; a session
 * with no stored tokens settles 'anonymous' and token() returns undefined —
 * the GatewayTransport then sends honestly-anonymous requests and the
 * gateway's own 401 is the answer.
 *
 * Browser-safe: fetch + optional localStorage only (storage access is
 * guarded; in Node the session simply runs storageless).
 */

import type { AuthProvider } from '@shrubbery/nucleus'

export interface CognitoAuthConfig {
  readonly region: string
  readonly clientId: string
  readonly userPoolId?: string
}

export interface CognitoTokenSet {
  readonly accessToken: string
  readonly idToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

export interface CognitoCodeDelivery {
  readonly destination: string
  readonly deliveryMedium: string
  readonly attributeName: string
}

export interface CognitoSignUpResult {
  readonly userSub: string
  readonly confirmed: boolean
  readonly delivery: CognitoCodeDelivery
}

export interface AuthSessionSnapshot {
  readonly status: 'restoring' | 'anonymous' | 'authenticated'
  readonly userId: string
  readonly identity: string
  readonly tokens: CognitoTokenSet | null
}

export interface AuthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CognitoAuthSessionOptions {
  readonly config: CognitoAuthConfig
  readonly fetch?: typeof fetch
  readonly storage?: AuthStorage | null
  readonly storageKey?: string
  readonly now?: () => number
  readonly refreshSkewMs?: number
}

export interface CognitoAutoRefreshOptions {
  readonly now?: () => number
  readonly refreshSkewMs?: number
  readonly retryMs?: number
  readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  readonly onError?: (error: unknown) => void
}

interface CognitoAuthenticationResult {
  readonly AccessToken?: unknown
  readonly IdToken?: unknown
  readonly RefreshToken?: unknown
  readonly ExpiresIn?: unknown
}

interface CognitoEnvelope {
  readonly __type?: unknown
  readonly message?: unknown
  readonly AuthenticationResult?: CognitoAuthenticationResult
  readonly ChallengeName?: unknown
  readonly UserSub?: unknown
  readonly UserConfirmed?: unknown
  readonly CodeDeliveryDetails?: unknown
}

interface JwtClaims {
  readonly sub?: unknown
  readonly email?: unknown
  readonly username?: unknown
  readonly 'cognito:username'?: unknown
  readonly exp?: unknown
}

const DEFAULT_STORAGE_KEY = 'shrubbery.cognito.tokens.v1'
const DEFAULT_REFRESH_SKEW_MS = 60_000
const FETCH_TIMEOUT_MS = 15_000

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UsernameExistsException: 'An account with this username already exists.',
  InvalidPasswordException: 'Password must be at least 8 characters with uppercase, lowercase, and numbers.',
  UserNotFoundException: 'No account found with this username.',
  NotAuthorizedException: 'Incorrect username or password.',
  UserNotConfirmedException: 'Verify your email before signing in.',
  CodeMismatchException: 'Invalid verification code.',
  ExpiredCodeException: 'Verification code has expired. Request a new one.',
  TooManyRequestsException: 'Too many attempts. Please wait a moment.',
  LimitExceededException: 'Too many attempts. Please try again later.',
  InvalidParameterException: 'Invalid input. Please check your entries.',
}

export class CognitoAuthError extends Error {
  constructor(
    readonly type: string,
    message: string,
    readonly originalMessage = message,
  ) {
    super(
      type === 'NotAuthorizedException' && /not confirmed/i.test(originalMessage)
        ? ERROR_MESSAGES.UserNotConfirmedException
        : ERROR_MESSAGES[type] ?? message,
    )
    this.name = 'CognitoAuthError'
  }

  get isUserNotConfirmed(): boolean {
    return this.type === 'UserNotConfirmedException' ||
      (this.type === 'NotAuthorizedException' && /not confirmed/i.test(this.originalMessage))
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return atob(padded)
}

export function decodeJwtClaims(token: string): JwtClaims {
  const body = token.split('.')[1]
  if (!body) return {}
  try {
    return JSON.parse(decodeBase64Url(body)) as JwtClaims
  } catch {
    return {}
  }
}

function deliveryDetails(raw: unknown): CognitoCodeDelivery {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    destination: stringValue(value.Destination),
    deliveryMedium: stringValue(value.DeliveryMedium),
    attributeName: stringValue(value.AttributeName),
  }
}

function storedTokenSet(raw: string | null): CognitoTokenSet | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CognitoTokenSet>
    if (
      typeof value.accessToken !== 'string' ||
      typeof value.idToken !== 'string' ||
      typeof value.refreshToken !== 'string' ||
      typeof value.expiresAt !== 'number'
    ) return null
    return value as CognitoTokenSet
  } catch {
    return null
  }
}

function browserStorage(): AuthStorage | null {
  try {
    const ls = (globalThis as { localStorage?: unknown }).localStorage
    // Node 22+ exposes a global `localStorage` object even OUTSIDE a browser
    // (stable Web Storage API support) — but without `--localstorage-file`
    // it is a non-functional stub carrying no getItem/setItem/removeItem
    // (verified: Node 25, plain `node -e`). Structural capability check,
    // not just `typeof === 'object', so a real functional Storage (browser
    // OR a Node run with --localstorage-file) is used, and the non-functional
    // stub degrades to the documented storageless path instead of throwing.
    if (
      ls === null ||
      typeof ls !== 'object' ||
      typeof (ls as Partial<AuthStorage>).getItem !== 'function' ||
      typeof (ls as Partial<AuthStorage>).setItem !== 'function' ||
      typeof (ls as Partial<AuthStorage>).removeItem !== 'function'
    ) {
      return null
    }
    return ls as AuthStorage
  } catch {
    return null
  }
}

export class CognitoAuthSession implements AuthProvider {
  private readonly fetchImpl: typeof fetch
  private readonly storage: AuthStorage | null
  private readonly storageKey: string
  private readonly now: () => number
  private readonly refreshSkewMs: number
  private readonly endpoint: string
  private readonly listeners = new Set<() => void>()
  private restorePromise: Promise<void>
  private snapshotValue: AuthSessionSnapshot = {
    status: 'restoring',
    userId: '',
    identity: '',
    tokens: null,
  }

  constructor(private readonly options: CognitoAuthSessionOptions) {
    if (!options.config.region.trim()) throw new Error('Cognito region is required')
    if (!options.config.clientId.trim()) throw new Error('Cognito clientId is required')
    const f = options.fetch ?? globalThis.fetch
    if (typeof f !== 'function') throw new Error('CognitoAuthSession requires fetch')
    this.fetchImpl = f.bind(globalThis) as typeof fetch
    this.storage = options.storage ?? browserStorage()
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.now = options.now ?? Date.now
    this.refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS
    this.endpoint = `https://cognito-idp.${options.config.region}.amazonaws.com/`
    this.restorePromise = this.restore()
  }

  snapshot(): AuthSessionSnapshot {
    return this.snapshotValue
  }

  token(): string | undefined {
    return this.snapshotValue.tokens?.idToken
  }

  accessToken(): string | undefined {
    return this.snapshotValue.tokens?.accessToken
  }

  userId(): string {
    return this.snapshotValue.userId
  }

  isAuthenticated(): boolean {
    return this.snapshotValue.status === 'authenticated' && Boolean(this.snapshotValue.tokens)
  }

  whenReady(): Promise<void> {
    return this.restorePromise
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Keep hosted transports on a live ID token; returns an explicit teardown. */
  startAutoRefresh(options: CognitoAutoRefreshOptions = {}): () => void {
    const now = options.now ?? this.now
    const refreshSkewMs = options.refreshSkewMs ?? this.refreshSkewMs
    const retryMs = Math.max(1_000, options.retryMs ?? 30_000)
    const setTimer = options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
    const clearTimer = options.clearTimer ?? (timer => globalThis.clearTimeout(timer))
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const cancelTimer = (): void => {
      if (timer === null) return
      clearTimer(timer)
      timer = null
    }
    const scheduleAfter = (delayMs: number, callback: () => void): void => {
      cancelTimer()
      if (stopped) return
      timer = setTimer(callback, Math.max(0, delayMs))
      const nodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void }
      nodeTimer.unref?.()
    }
    const refreshAtExpiry = (): void => {
      const tokens = this.snapshotValue.tokens
      cancelTimer()
      if (stopped || !tokens) return
      scheduleAfter(tokens.expiresAt - now() - refreshSkewMs, () => {
        void this.refresh().catch((error) => {
          if (stopped) return
          options.onError?.(error)
          const current = this.snapshotValue.tokens
          if (!current || current.expiresAt <= now()) {
            this.clear()
            return
          }
          scheduleAfter(Math.min(retryMs, Math.max(1_000, current.expiresAt - now())), refreshAtExpiry)
        })
      })
    }

    const unsubscribe = this.onChange(refreshAtExpiry)
    void this.whenReady().then(refreshAtExpiry)
    return () => {
      if (stopped) return
      stopped = true
      cancelTimer()
      unsubscribe()
    }
  }

  async signIn(identity: string, password: string): Promise<CognitoTokenSet> {
    await this.whenReady()
    const normalizedIdentity = identity.trim()
    const result = await this.call('InitiateAuth', {
      ClientId: this.options.config.clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: normalizedIdentity, PASSWORD: password },
    })
    if (typeof result.ChallengeName === 'string') {
      throw new CognitoAuthError(
        result.ChallengeName,
        `Authentication challenge ${result.ChallengeName} is not supported by this client.`,
      )
    }
    const tokens = this.tokensFrom(result.AuthenticationResult, '', normalizedIdentity)
    this.installTokens(tokens, normalizedIdentity)
    return tokens
  }

  async signUp(input: {
    readonly username: string
    readonly email: string
    readonly password: string
    readonly name?: string
  }): Promise<CognitoSignUpResult> {
    await this.whenReady()
    const attributes: Array<{ Name: string; Value: string }> = [
      { Name: 'email', Value: input.email.trim() },
    ]
    if (input.name?.trim()) attributes.push({ Name: 'name', Value: input.name.trim() })
    const result = await this.call('SignUp', {
      ClientId: this.options.config.clientId,
      Username: input.username.trim(),
      Password: input.password,
      UserAttributes: attributes,
    })
    return {
      userSub: stringValue(result.UserSub),
      confirmed: result.UserConfirmed === true,
      delivery: deliveryDetails(result.CodeDeliveryDetails),
    }
  }

  async confirmSignUp(identity: string, code: string): Promise<void> {
    await this.whenReady()
    await this.call('ConfirmSignUp', {
      ClientId: this.options.config.clientId,
      Username: identity.trim(),
      ConfirmationCode: code.trim(),
    })
  }

  async resendVerification(identity: string): Promise<CognitoCodeDelivery> {
    await this.whenReady()
    const result = await this.call('ResendConfirmationCode', {
      ClientId: this.options.config.clientId,
      Username: identity.trim(),
    })
    return deliveryDetails(result.CodeDeliveryDetails)
  }

  async refresh(): Promise<CognitoTokenSet> {
    const current = this.snapshotValue.tokens
    if (!current?.refreshToken) throw new CognitoAuthError('NoRefreshToken', 'No refresh token is available.')
    const result = await this.call('InitiateAuth', {
      ClientId: this.options.config.clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: current.refreshToken },
    })
    const tokens = this.tokensFrom(
      result.AuthenticationResult,
      current.refreshToken,
      this.snapshotValue.identity,
    )
    this.installTokens(tokens, this.snapshotValue.identity)
    return tokens
  }

  async signOut(): Promise<void> {
    await this.whenReady()
    const accessToken = this.snapshotValue.tokens?.accessToken
    if (accessToken) {
      try {
        await this.call('GlobalSignOut', { AccessToken: accessToken })
      } catch {
        // Local credentials must still be destroyed when the network/provider
        // cannot complete global revocation.
      }
    }
    this.clear()
  }

  private async restore(): Promise<void> {
    const stored = storedTokenSet(this.storage?.getItem(this.storageKey) ?? null)
    if (!stored) {
      this.setSnapshot({ status: 'anonymous', userId: '', identity: '', tokens: null })
      return
    }
    const claims = decodeJwtClaims(stored.idToken)
    const identity = stringValue(claims.email) || stringValue(claims['cognito:username']) || stringValue(claims.username)
    const expiry = typeof claims.exp === 'number' ? claims.exp * 1000 : stored.expiresAt
    if (expiry > this.now() + this.refreshSkewMs) {
      this.installTokens({ ...stored, expiresAt: expiry }, identity)
      return
    }
    this.snapshotValue = this.snapshotFor(stored, identity)
    try {
      await this.refresh()
    } catch {
      this.clear()
    }
  }

  private async call(action: string, payload: Record<string, unknown>): Promise<CognitoEnvelope> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new CognitoAuthError('TimeoutError', 'Authentication request timed out.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
    const body = await response.json() as CognitoEnvelope
    if (!response.ok) {
      const type = stringValue(body.__type).split('#').pop() || 'UnknownError'
      const message = stringValue(body.message) || `Authentication request failed (${response.status})`
      throw new CognitoAuthError(type, message, message)
    }
    return body
  }

  private tokensFrom(
    result: CognitoAuthenticationResult | undefined,
    fallbackRefreshToken: string,
    identity: string,
  ): CognitoTokenSet {
    const accessToken = stringValue(result?.AccessToken)
    const idToken = stringValue(result?.IdToken)
    const refreshToken = stringValue(result?.RefreshToken) || fallbackRefreshToken
    if (!accessToken || !idToken || !refreshToken) {
      throw new CognitoAuthError('InvalidAuthenticationResult', 'Cognito returned an incomplete token set.')
    }
    const claims = decodeJwtClaims(idToken)
    const expiresInMs = positiveNumber(result?.ExpiresIn, 3600) * 1000
    const expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : this.now() + expiresInMs
    if (!stringValue(claims.sub)) {
      throw new CognitoAuthError('InvalidIdToken', `Cognito returned an ID token without a subject for ${identity}.`)
    }
    return { accessToken, idToken, refreshToken, expiresAt }
  }

  private snapshotFor(tokens: CognitoTokenSet, fallbackIdentity: string): AuthSessionSnapshot {
    const claims = decodeJwtClaims(tokens.idToken)
    return {
      status: 'authenticated',
      userId: stringValue(claims.sub),
      identity:
        stringValue(claims.email) ||
        stringValue(claims['cognito:username']) ||
        stringValue(claims.username) ||
        fallbackIdentity,
      tokens,
    }
  }

  private installTokens(tokens: CognitoTokenSet, fallbackIdentity: string): void {
    this.storage?.setItem(this.storageKey, JSON.stringify(tokens))
    this.setSnapshot(this.snapshotFor(tokens, fallbackIdentity))
  }

  private clear(): void {
    this.storage?.removeItem(this.storageKey)
    this.setSnapshot({ status: 'anonymous', userId: '', identity: '', tokens: null })
  }

  private setSnapshot(snapshot: AuthSessionSnapshot): void {
    this.snapshotValue = snapshot
    for (const listener of this.listeners) listener()
  }
}

export function createCognitoAuthSession(options: CognitoAuthSessionOptions): CognitoAuthSession {
  return new CognitoAuthSession(options)
}
