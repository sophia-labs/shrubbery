import { describe, expect, it, vi } from 'vitest'
import {
  CognitoAuthError,
  createCognitoAuthSession,
  decodeJwtClaims,
  type AuthStorage,
} from '../cognito-auth-session.js'

class MemoryStorage implements AuthStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

interface RecordedCall {
  readonly action: string
  readonly body: Record<string, unknown>
}

function encoded(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function jwt(claims: Record<string, unknown>): string {
  return `${encoded({ alg: 'none' })}.${encoded(claims)}.signature`
}

function harness(responses: Record<string, Array<{ status?: number; body: unknown }>>, storage = new MemoryStorage()) {
  const calls: RecordedCall[] = []
  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    const action = (headers.get('X-Amz-Target') ?? '').split('.').pop() ?? ''
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ action, body })
    const response = responses[action]?.shift()
    if (!response) throw new Error(`unexpected Cognito action: ${action}`)
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const session = createCognitoAuthSession({
    config: { region: 'us-west-1', clientId: 'client-123' },
    fetch: fetchImpl,
    storage,
    now: () => 1_000_000,
  })
  return { session, calls, storage }
}

describe('CognitoAuthSession', () => {
  it('signs in through USER_PASSWORD_AUTH, persists tokens, and satisfies AuthProvider', async () => {
    const idToken = jwt({ sub: 'user-1', email: 'vera@example.test', exp: 5000 })
    const { session, calls, storage } = harness({
      InitiateAuth: [{ body: {
        AuthenticationResult: {
          AccessToken: 'access',
          IdToken: idToken,
          RefreshToken: 'refresh',
          ExpiresIn: 3600,
        },
      } }],
    })
    const notifications: string[] = []
    session.onChange(() => notifications.push(session.snapshot().status))
    await session.whenReady()
    await session.signIn(' vera@example.test ', 'secret')

    expect(calls[0]).toEqual({
      action: 'InitiateAuth',
      body: {
        ClientId: 'client-123',
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: 'vera@example.test', PASSWORD: 'secret' },
      },
    })
    expect(session.isAuthenticated()).toBe(true)
    expect(session.userId()).toBe('user-1')
    expect(session.token()).toBe(idToken)
    expect(session.accessToken()).toBe('access')
    expect(notifications).toEqual(['authenticated'])
    expect(storage.getItem('shrubbery.cognito.tokens.v1')).toContain('refresh')
  })

  it('restores a valid persisted session without a network call', async () => {
    const storage = new MemoryStorage()
    const idToken = jwt({ sub: 'restored', email: 'saved@example.test', exp: 5000 })
    storage.setItem('shrubbery.cognito.tokens.v1', JSON.stringify({
      accessToken: 'access',
      idToken,
      refreshToken: 'refresh',
      expiresAt: 5_000_000,
    }))
    const { session, calls } = harness({}, storage)
    await session.whenReady()
    expect(calls).toEqual([])
    expect(session.snapshot()).toMatchObject({
      status: 'authenticated',
      userId: 'restored',
      identity: 'saved@example.test',
    })
  })

  it('refreshes an expiring persisted session and preserves the refresh token', async () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.cognito.tokens.v1', JSON.stringify({
      accessToken: 'old-access',
      idToken: jwt({ sub: 'user-2', exp: 1000 }),
      refreshToken: 'durable-refresh',
      expiresAt: 1_000_000,
    }))
    const refreshedId = jwt({ sub: 'user-2', email: 'fresh@example.test', exp: 5000 })
    const { session, calls } = harness({
      InitiateAuth: [{ body: {
        AuthenticationResult: {
          AccessToken: 'new-access',
          IdToken: refreshedId,
          ExpiresIn: 3600,
        },
      } }],
    }, storage)
    await session.whenReady()
    expect(calls[0]).toMatchObject({
      action: 'InitiateAuth',
      body: {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: 'durable-refresh' },
      },
    })
    expect(session.snapshot().tokens).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'durable-refresh',
    })
  })

  it('executes signup, confirmation, and resend with normalized delivery details', async () => {
    const { session, calls } = harness({
      SignUp: [{ body: {
        UserSub: 'new-user',
        UserConfirmed: false,
        CodeDeliveryDetails: {
          Destination: 'v***@example.test',
          DeliveryMedium: 'EMAIL',
          AttributeName: 'email',
        },
      } }],
      ConfirmSignUp: [{ body: {} }],
      ResendConfirmationCode: [{ body: {
        CodeDeliveryDetails: { Destination: 'v***@example.test', DeliveryMedium: 'EMAIL' },
      } }],
    })
    await session.whenReady()
    const signup = await session.signUp({
      username: 'vera',
      email: 'vera@example.test',
      name: 'Vera',
      password: 'Secret123',
    })
    await session.confirmSignUp('vera', '123456')
    const resent = await session.resendVerification('vera')

    expect(signup).toEqual({
      userSub: 'new-user',
      confirmed: false,
      delivery: {
        destination: 'v***@example.test',
        deliveryMedium: 'EMAIL',
        attributeName: 'email',
      },
    })
    expect(resent.deliveryMedium).toBe('EMAIL')
    expect(calls.map((call) => call.action)).toEqual([
      'SignUp',
      'ConfirmSignUp',
      'ResendConfirmationCode',
    ])
  })

  it('surfaces typed Cognito errors and recognizes unconfirmed identities', async () => {
    const { session } = harness({
      InitiateAuth: [{ status: 400, body: {
        __type: 'com.amazon.coral.service#NotAuthorizedException',
        message: 'User is not confirmed.',
      } }],
    })
    await session.whenReady()
    const error = await session.signIn('vera', 'bad').catch((value: unknown) => value)
    expect(error).toBeInstanceOf(CognitoAuthError)
    expect((error as CognitoAuthError).isUserNotConfirmed).toBe(true)
  })

  it('attempts global sign-out but always destroys local credentials', async () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.cognito.tokens.v1', JSON.stringify({
      accessToken: 'access',
      idToken: jwt({ sub: 'user-3', exp: 5000 }),
      refreshToken: 'refresh',
      expiresAt: 5_000_000,
    }))
    const { session, calls } = harness({
      GlobalSignOut: [{ status: 503, body: { message: 'unavailable' } }],
    }, storage)
    await session.whenReady()
    await session.signOut()
    expect(calls[0]).toMatchObject({ action: 'GlobalSignOut' })
    expect(session.isAuthenticated()).toBe(false)
    expect(storage.getItem('shrubbery.cognito.tokens.v1')).toBeNull()
  })

  it('proactively refreshes before expiry and schedules the rotated token', async () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.cognito.tokens.v1', JSON.stringify({
      accessToken: 'old-access',
      idToken: jwt({ sub: 'scheduled-user', exp: 5000 }),
      refreshToken: 'durable-refresh',
      expiresAt: 5_000_000,
    }))
    const refreshedId = jwt({ sub: 'scheduled-user', exp: 9000 })
    const { session, calls } = harness({
      InitiateAuth: [{ body: {
        AuthenticationResult: {
          AccessToken: 'fresh-access',
          IdToken: refreshedId,
          ExpiresIn: 3600,
        },
      } }],
    }, storage)
    let now = 1_000_000
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    const clearTimer = vi.fn()
    const stop = session.startAutoRefresh({
      now: () => now,
      refreshSkewMs: 1_000,
      setTimer: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer,
    })

    await session.whenReady()
    await Promise.resolve()
    expect(scheduled[0].delay).toBe(3_999_000)

    now = 4_999_000
    scheduled[0].callback()
    await vi.waitFor(() => expect(session.token()).toBe(refreshedId))
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ AuthFlow: 'REFRESH_TOKEN_AUTH' })
    expect(scheduled.at(-1)?.delay).toBe(4_000_000)

    stop()
    expect(clearTimer).toHaveBeenCalled()
  })
})

describe('decodeJwtClaims', () => {
  it('accepts Cognito base64url claims and safely rejects malformed tokens', () => {
    expect(decodeJwtClaims(jwt({ sub: 'abc', email: 'a@example.test' }))).toMatchObject({ sub: 'abc' })
    expect(decodeJwtClaims('not-a-jwt')).toEqual({})
  })
})
