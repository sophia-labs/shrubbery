// @vitest-environment node
/**
 * The three wrong messages a stranger saw on the confirm step, and the
 * neighbours that must keep their own words. The real CognitoAuthSession talks
 * to a loopback server that answers in Cognito's wire shape; the answers are the
 * ones `H-oauth-connectors.md` recorded on the two real sign-ups (see the
 * fixture file, which quotes them).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CognitoAuthError,
  createCognitoAuthSession,
  type AuthStorage,
  type CognitoAuthSession,
} from '../cognito-auth-session.js'
import {
  CONFIRM_OF_CONFIRMED,
  CONFIRM_OF_FORCE_CHANGE_PASSWORD,
  INVALID_PARAMETER_ELSEWHERE,
  POST_CONFIRMATION_FAILED,
  PRE_SIGN_UP_FAILED,
  RESEND_FOR_CONFIRMED,
  SIGN_IN_BEFORE_CONFIRMING,
  WRONG_CODE,
  WRONG_PASSWORD,
} from './fixtures/cognito-observed-errors.js'
import { CognitoLoopback } from './support/cognito-loopback.js'

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

function session(): CognitoAuthSession {
  return createCognitoAuthSession({
    config: { region: 'us-west-1', clientId: 'client-123' },
    fetch: cognito.fetch(),
    storage: new MemoryStorage(),
  })
}

/** The error a call rejects with; a call that does not reject fails the test. */
async function failure(call: Promise<unknown>): Promise<CognitoAuthError> {
  const error = await call.then(() => null, (thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(CognitoAuthError)
  return error as CognitoAuthError
}

const CONFIRMED = 'Your account is confirmed. Sign in.'

describe('an account that is confirmed is told so', () => {
  it('1. the first confirmation, when the idle PostConfirmation trigger fails', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(POST_CONFIRMATION_FAILED))
    const error = await failure(session().confirmSignUp('vera', '123456'))
    expect(error.message).toBe(CONFIRMED)
    expect(error.isAlreadyConfirmed).toBe(true)
    expect(error.isUserNotConfirmed).toBe(false)
    // The raw answer is kept for logs, never shown.
    expect(error.type).toBe('UnexpectedLambdaException')
    expect(error.originalMessage).toBe(POST_CONFIRMATION_FAILED.message)
  })

  it('2. the retry of a confirmation that had in fact succeeded', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    const error = await failure(session().confirmSignUp('vera', '123456'))
    expect(error.message).toBe(CONFIRMED)
    expect(error.isAlreadyConfirmed).toBe(true)
    expect(error.isUserNotConfirmed).toBe(false)
    expect(error.type).toBe('NotAuthorizedException')
  })

  it('3. a resend for an account that is already confirmed', async () => {
    cognito.enqueue('ResendConfirmationCode', CognitoLoopback.refusal(RESEND_FOR_CONFIRMED))
    const error = await failure(session().resendVerification('vera'))
    expect(error.message).toBe(CONFIRMED)
    expect(error.isAlreadyConfirmed).toBe(true)
    expect(error.type).toBe('InvalidParameterException')
  })

  it('sends exactly what it was given to Cognito', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(CONFIRM_OF_CONFIRMED))
    await failure(session().confirmSignUp(' vera ', ' 123456 '))
    expect(cognito.callsTo('ConfirmSignUp')[0]!.body).toEqual({
      ClientId: 'client-123', Username: 'vera', ConfirmationCode: '123456',
    })
  })
})

describe('everything else keeps its own words', () => {
  it('a wrong password is still a wrong password', async () => {
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(WRONG_PASSWORD))
    const error = await failure(session().signIn('vera', 'wrong'))
    expect(error.message).toBe('Incorrect username or password.')
    expect(error.isAlreadyConfirmed).toBe(false)
  })

  it('signing in before confirming still sends the person to verify', async () => {
    cognito.enqueue('InitiateAuth', CognitoLoopback.refusal(SIGN_IN_BEFORE_CONFIRMING))
    const error = await failure(session().signIn('vera', 'Secret123'))
    expect(error.message).toBe('Verify your email before signing in.')
    expect(error.isUserNotConfirmed).toBe(true)
    expect(error.isAlreadyConfirmed).toBe(false)
  })

  it('a wrong code is still a wrong code', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(WRONG_CODE))
    const error = await failure(session().confirmSignUp('vera', '000000'))
    expect(error.message).toBe('Invalid verification code.')
    expect(error.isAlreadyConfirmed).toBe(false)
  })

  it('another trigger failing proves nothing about confirmation, so its words are not replaced', async () => {
    cognito.enqueue('SignUp', CognitoLoopback.refusal(PRE_SIGN_UP_FAILED))
    const error = await failure(session().signUp({ username: 'vera', email: 'vera@example.test', password: 'Secret123' }))
    expect(error.message).toBe(PRE_SIGN_UP_FAILED.message)
    expect(error.isAlreadyConfirmed).toBe(false)
  })

  it('a confirmation refused for another status is not called confirmed', async () => {
    cognito.enqueue('ConfirmSignUp', CognitoLoopback.refusal(CONFIRM_OF_FORCE_CHANGE_PASSWORD))
    const error = await failure(session().confirmSignUp('vera', '123456'))
    expect(error.isAlreadyConfirmed).toBe(false)
    expect(error.message).not.toBe(CONFIRMED)
  })

  it('an invalid parameter about something else is still an invalid parameter', async () => {
    cognito.enqueue('ResendConfirmationCode', CognitoLoopback.refusal(INVALID_PARAMETER_ELSEWHERE))
    const error = await failure(session().resendVerification('vera'))
    expect(error.message).toBe('Invalid input. Please check your entries.')
    expect(error.isAlreadyConfirmed).toBe(false)
  })
})

describe('a confirmation that works is unchanged', () => {
  it('resolves and asks Cognito once', async () => {
    cognito.enqueue('ConfirmSignUp', { body: {} })
    await session().confirmSignUp('vera', '123456')
    expect(cognito.actions()).toEqual(['ConfirmSignUp'])
  })
})
