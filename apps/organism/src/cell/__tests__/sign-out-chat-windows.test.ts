/**
 * Signing out takes the text of earlier conversations with it (NO MOCKS: the real settings
 * action, a real ShellContext, the browser's own localStorage).
 *
 * A conversation that picked up an earlier one keeps that conversation's text in the browser so
 * it can be shown again (a "window"). It is private text the person's own token read; it must not
 * outlive the sign-in. The conversations themselves (their titles, where they are) stay: they are
 * pointers, and what they point at is on the host.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createShellContext } from '../shell-context.js'
import { settingsAction } from '../shell-features.js'

const WINDOW = 'shrubbery:c2chat:v1:u-1:atelier:window:c2chat-1'
const OTHER_PERSON_WINDOW = 'shrubbery:c2chat:v1:u-2:atelier:window:c2chat-9'
const DESCRIPTOR = 'shrubbery:c2chat:v1:u-1:atelier:descriptor:c2chat-1'
const TOKENS = 'shrubbery.cognito.tokens.v1'

function signedInContext(signOut?: () => Promise<void>) {
  return createShellContext({
    host: document.body,
    graphId: 'atelier',
    documentId: null,
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'hosted',
    contract: {
      auth: { userId: () => 'u-1', token: () => 'jwt', whenReady: () => Promise.resolve(), ...(signOut ? { signOut } : {}) },
      runtime: { graphBaseUrl: () => 'http://127.0.0.1:7777' },
    },
    location: new URL('http://localhost/'),
    rerender: () => undefined,
  })
}

describe('signing out', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem(WINDOW, '[{"role":"user","text":"an earlier conversation"}]')
    window.localStorage.setItem(OTHER_PERSON_WINDOW, '[{"role":"user","text":"another person, same browser"}]')
    window.localStorage.setItem(DESCRIPTOR, '{"schema":"shrubbery.cloud2-chat-descriptor.v1"}')
    window.localStorage.setItem(TOKENS, '{"idToken":"x"}')
  })
  afterEach(() => window.localStorage.clear())

  it('takes every window of an earlier conversation out of the browser, and only those', async () => {
    let signedOut = false
    await settingsAction(signedInContext(async () => { signedOut = true }), { sectionId: 'account', actionId: 'sign-out' } as never, '', '')
    expect(signedOut).toBe(true)
    expect(window.localStorage.getItem(WINDOW)).toBeNull()
    // Every person's, not only the one signing out: it is the browser that is being handed back.
    expect(window.localStorage.getItem(OTHER_PERSON_WINDOW)).toBeNull()
    expect(window.localStorage.getItem(DESCRIPTOR)).not.toBeNull()
  })

  it('does so even when the provider cannot be reached to end the session', async () => {
    const context = signedInContext(async () => { throw new Error('the network is down') })
    await settingsAction(context, { sectionId: 'account', actionId: 'sign-out' } as never, '', '').catch(() => undefined)
    expect(window.localStorage.getItem(WINDOW)).toBeNull()
  })

  it('touches nothing when the action is not signing out', async () => {
    await settingsAction(signedInContext(async () => undefined), { sectionId: 'account', actionId: 'copy-api-url' } as never, '', '')
    expect(window.localStorage.getItem(WINDOW)).not.toBeNull()
  })
})
