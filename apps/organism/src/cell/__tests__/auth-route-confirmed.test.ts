/**
 * The sign-up route after the confirm-step fix: a stranger whose confirmation
 * failed on the idle PostConfirmation trigger (and whose account was in fact
 * confirmed) is told so and, when this page still holds the password they typed,
 * is signed in. Real route, real CognitoAuthSession, real loopback server that
 * answers in Cognito's wire shape with the answers `H-oauth-connectors.md`
 * observed. The `authActions` below mirror `hostedAuthActions` in `main.ts`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type {
  MnAuthPage,
  MnAuthResendVerificationDetail,
  MnAuthSignInDetail,
  MnAuthSignUpDetail,
  MnAuthVerifyEmailDetail,
} from '@shrubbery/components'
import { mountOrganismAppRoute, type OrganismAuthActions } from '../app-routes.js'
import {
  createCognitoAuthSession,
  type AuthStorage,
  type CognitoAuthSession,
} from '../cognito-auth-session.js'
import {
  CONFIRM_OF_CONFIRMED,
  POST_CONFIRMATION_FAILED,
  RESEND_FOR_CONFIRMED,
  SIGN_IN_BEFORE_CONFIRMING,
  WRONG_CODE,
  WRONG_PASSWORD,
} from './fixtures/cognito-observed-errors.js'
import { CognitoLoopback, authenticationResult } from './support/cognito-loopback.js'

class MemoryStorage implements AuthStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const cognito = new CognitoLoopback()
beforeAll(async () => { await cognito.start() })
afterAll(async () => { await cognito.stop() })
beforeEach(() => { cognito.reset() })
afterEach(() => document.body.replaceChildren())

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** The shell's effects, as `main.ts` builds them over the real session. */
function hostedAuthActions(auth: CognitoAuthSession): OrganismAuthActions {
  return {
    async signIn(detail) { await auth.signIn(detail.identity, detail.password) },
    async signUp(detail) {
      const result = await auth.signUp({ username: detail.username, email: detail.email, name: detail.name, password: detail.password })
      return {
        identity: detail.username,
        confirmed: result.confirmed,
        deliveryDestination: result.delivery.destination,
        deliveryMedium: result.delivery.deliveryMedium,
      }
    },
    async verifyEmail(detail) { await auth.confirmSignUp(detail.identity, detail.code) },
    async resendVerification(detail) {
      const delivery = await auth.resendVerification(detail.identity)
      return { deliveryDestination: delivery.destination, deliveryMedium: delivery.deliveryMedium }
    },
  }
}

interface Mounted {
  readonly page: MnAuthPage
  readonly session: CognitoAuthSession
  readonly successes: string[]
  destroy(): void
}

async function mount(path: string): Promise<Mounted> {
  const session = createCognitoAuthSession({
    config: { region: 'us-west-1', clientId: 'client-123' },
    fetch: cognito.fetch(),
    storage: new MemoryStorage(),
  })
  const successes: string[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const mounted = mountOrganismAppRoute(host, {
    location: new URL(`https://garden.test${path}`),
    authActions: hostedAuthActions(session),
    onAuthSuccess: kind => { successes.push(kind) },
  })
  await mounted!.ready
  const page = host.querySelector('mn-auth-page') as MnAuthPage
  await page.updateComplete
  return { page, session, successes, destroy: () => { mounted!.destroy(); host.remove() } }
}

const send = <T>(page: MnAuthPage, type: string, detail: T): void => {
  page.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
}
const signUp = (page: MnAuthPage) => send<MnAuthSignUpDetail>(page, 'mn-auth-sign-up-submit', {
  username: 'vera', email: 'vera@example.test', name: 'Vera', password: 'Secret123', acceptedPrivacy: true, acceptedTerms: true,
})
const signIn = (page: MnAuthPage) => send<MnAuthSignInDetail>(page, 'mn-auth-sign-in-submit', { identity: 'vera', password: 'Secret123' })
const verify = (page: MnAuthPage) => send<MnAuthVerifyEmailDetail>(page, 'mn-auth-verify-email-submit', { identity: 'vera', code: '123456' })
const resend = (page: MnAuthPage) => send<MnAuthResendVerificationDetail>(page, 'mn-auth-resend-verification', { identity: 'vera' })

const unconfirmedSignUp = { body: { UserSub: 'sub-1', UserConfirmed: false, CodeDeliveryDetails: { Destination: 'v***@example.test', DeliveryMedium: 'EMAIL', AttributeName: 'email' } } }
const CONFIRMED = 'Your account is confirmed. Sign in.'

describe('a first confirmation that fails on the idle trigger', () => {
  it('confirms, and signs the person in with the password they just typed', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    cognito.enqueue('InitiateAuth', { body: authenticationResult() })
    const { page, session, successes, destroy } = await mount('/signup')

    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => successes.length === 1)

    expect(successes).toEqual(['signin'])
    expect(session.isAuthenticated()).toBe(true)
    expect(page.verifyError).toBe('')
    expect(cognito.actions()).toEqual(['SignUp', 'ConfirmSignUp', 'InitiateAuth'])
    expect(cognito.callsTo('InitiateAuth')[0]!.body).toMatchObject({
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: 'vera', PASSWORD: 'Secret123' },
    })
    destroy()
  })

  it('never shows the raw Cognito sentence', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    cognito.enqueue('InitiateAuth', { body: authenticationResult() })
    const { page, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => successes.length === 1)
    const shown = `${page.verifyError} ${page.signInError} ${page.successMessage}`
    expect(shown).not.toContain('PostConfirmation')
    expect(shown).not.toContain('CodeArtifactUserPendingException')
    destroy()
  })

  it('says the account is confirmed, on the sign-in form, if signing in then fails', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(WRONG_PASSWORD))
    const { page, session, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => page.mode === 'signin')

    expect(page.successMessage).toBe(CONFIRMED)
    expect(page.verifyError).toBe('')
    // The failed attempt was the page's, not the person's: no error on the form.
    expect(page.signInError).toBe('')
    expect(successes).toEqual([])
    expect(session.isAuthenticated()).toBe(false)
    destroy()
  })

  it('does not claim the account is confirmed if signing in says it is not', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(SIGN_IN_BEFORE_CONFIRMING))
    const { page, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => page.verifyStatus === 'error')

    expect(page.mode).toBe('verify')
    expect(page.verifyError).toBe('Verify your email before signing in.')
    expect(page.successMessage).not.toBe(CONFIRMED)
    expect(successes).toEqual([])
    destroy()
  })

  it('holds the password of a failed sign-in for the same purpose', async () => {
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(SIGN_IN_BEFORE_CONFIRMING), { body: authenticationResult() })
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    const { page, successes, destroy } = await mount('/signin')
    signIn(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => successes.length === 1)

    expect(successes).toEqual(['signin'])
    expect(cognito.callsTo('InitiateAuth')).toHaveLength(2)
    expect(cognito.callsTo('InitiateAuth')[1]!.body).toMatchObject({ AuthParameters: { USERNAME: 'vera', PASSWORD: 'Secret123' } })
    destroy()
  })
})

describe('the password the page held is spent by the one attempt it was held for (Vera, 2026-10-03)', () => {
  // Held in memory from the sign-up or the failed sign-in until it is used, and not a moment longer: it is
  // gone the moment the automatic sign-in begins, so whatever comes of it (signed in, refused, not confirmed
  // after all, a second confirmation arriving while it is in flight) nothing on this page can use it again.

  it('is not tried a second time after a sign-in that said the account is not confirmed', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED), CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(SIGN_IN_BEFORE_CONFIRMING))
    const { page, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => page.verifyStatus === 'error')
    expect(page.mode).toBe('verify')

    // The person tries again; Cognito now says the account is confirmed. The page no longer has their password.
    verify(page)
    await until(() => page.mode === 'signin')
    expect(page.successMessage).toBe(CONFIRMED)
    expect(cognito.callsTo('InitiateAuth')).toHaveLength(1)
    expect(successes).toEqual([])
    destroy()
  })

  it('is not tried a second time after a sign-in that was refused', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED), CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(WRONG_PASSWORD))
    const { page, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => page.mode === 'signin')
    // Back to the code form by hand (the link a person might follow), and confirmation again.
    page.mode = 'verify'
    page.pendingIdentity = 'vera'
    await page.updateComplete
    verify(page)
    await until(() => page.mode === 'signin' && page.successMessage === CONFIRMED)
    expect(cognito.callsTo('InitiateAuth')).toHaveLength(1)
    destroy()
  })

  it('is not tried a second time after a sign-in that worked', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED), CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    cognito.enqueue('InitiateAuth', { body: authenticationResult() })
    const { page, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => successes.length === 1)
    verify(page)
    await until(() => page.mode === 'signin')
    expect(cognito.callsTo('InitiateAuth')).toHaveLength(1)
    destroy()
  })

  it('is gone the moment the sign-in begins, not when it ends: a second confirmation arriving while it is in flight cannot use it', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED), CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    cognito.enqueue('InitiateAuth', { ...CognitoLoopback.refusal(SIGN_IN_BEFORE_CONFIRMING), delayMs: 400 })
    const { page, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    verify(page)
    await until(() => cognito.callsTo('InitiateAuth').length === 1)
    // The sign-in is on its way (held for 400 ms). The person presses verify again.
    verify(page)
    await until(() => cognito.callsTo('ConfirmSignUp').length === 2)
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(cognito.callsTo('InitiateAuth')).toHaveLength(1)
    destroy()
  })
})

describe('arriving without a password to sign in with', () => {
  it('the retry of a confirmation that had succeeded: confirmed, sign in', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    const { page, successes, destroy } = await mount('/verify?identity=vera')
    verify(page)
    await until(() => page.mode === 'signin')

    expect(page.successMessage).toBe(CONFIRMED)
    expect(page.verifyError).toBe('')
    expect(successes).toEqual([])
    // No password was ever typed on this page, so nothing was tried.
    expect(cognito.actions()).toEqual(['ConfirmSignUp'])
    destroy()
  })

  it('the first confirmation, arrived at by a link', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    const { page, destroy } = await mount('/verify?identity=vera')
    verify(page)
    await until(() => page.mode === 'signin')
    expect(page.successMessage).toBe(CONFIRMED)
    expect(page.verifyError).toBe('')
    expect(cognito.actions()).toEqual(['ConfirmSignUp'])
    destroy()
  })

  it('a resend for an account that is already confirmed says so, and moves on to sign in', async () => {
    cognito.enqueue('ResendConfirmationCode', CognitoLoopback.refusal(RESEND_FOR_CONFIRMED))
    const { page, destroy } = await mount('/verify?identity=vera')
    resend(page)
    await until(() => page.mode === 'signin')
    expect(page.successMessage).toBe(CONFIRMED)
    expect(page.verifyError).toBe('')
    expect(cognito.actions()).toEqual(['ResendConfirmationCode'])
    destroy()
  })
})

describe('a resend is not a request to sign in', () => {
  it('says the account is confirmed and opens the sign-in form, even when the page holds the password', async () => {
    cognito.enqueue('SignUp', unconfirmedSignUp)
    cognito.enqueue('ResendConfirmationCode', CognitoLoopback.refusal(RESEND_FOR_CONFIRMED))
    const { page, session, successes, destroy } = await mount('/signup')
    signUp(page)
    await until(() => page.mode === 'verify')
    resend(page)
    await until(() => page.mode === 'signin')

    expect(page.successMessage).toBe(CONFIRMED)
    expect(page.verifyError).toBe('')
    // The person asked for a new code, not to be signed in: nothing was tried.
    expect(cognito.actions()).toEqual(['SignUp', 'ResendConfirmationCode'])
    expect(successes).toEqual([])
    expect(session.isAuthenticated()).toBe(false)
    destroy()
  })
})

describe('what already worked still works', () => {
  it('a good code verifies the email and leaves the person to sign in, as before', async () => {
    cognito.enqueue('ConfirmSignUp', { body: {} })
    const { page, successes, destroy } = await mount('/verify?identity=vera')
    verify(page)
    await until(() => page.mode === 'signin')
    expect(page.successMessage).toBe('Email verified. Sign in to continue.')
    expect(successes).toEqual(['verify'])
    expect(cognito.actions()).toEqual(['ConfirmSignUp'])
    destroy()
  })

  it('a wrong code is still a wrong code, on the verify form', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(WRONG_CODE))
    const { page, destroy } = await mount('/verify?identity=vera')
    verify(page)
    await until(() => page.verifyStatus === 'error')
    expect(page.mode).toBe('verify')
    expect(page.verifyError).toBe('Invalid verification code.')
    destroy()
  })

  it('a good resend still says a new code was sent', async () => {
    cognito.enqueue('ResendConfirmationCode', { body: { CodeDeliveryDetails: { Destination: 'v***@example.test', DeliveryMedium: 'EMAIL', AttributeName: 'email' } } })
    const { page, destroy } = await mount('/verify?identity=vera')
    resend(page)
    await until(() => page.verifyStatus === 'success')
    expect(page.mode).toBe('verify')
    expect(page.successMessage).toBe('A new verification code has been sent.')
    destroy()
  })
})
