import { describe, expect, it } from 'vitest'
import { createCognitoAuthSession } from './cognito-auth-session.js'
import { createDevServiceProxyAuthStorage } from './dev-service-proxy-auth.js'

describe('development cloud-2 service-proxy identity', () => {
  it('boots the ordinary hosted auth contract without persisting a credential', async () => {
    const subject = 'e9e949fe-0091-7015-0ab8-10bf259084ab'
    const auth = createCognitoAuthSession({
      config: { region: 'us-west-1', clientId: 'development-client' },
      storage: createDevServiceProxyAuthStorage(subject, Date.UTC(2026, 7, 7)),
      now: () => Date.UTC(2026, 7, 7),
    })
    await auth.whenReady()
    expect(auth.isAuthenticated()).toBe(true)
    expect(auth.userId()).toBe(subject)
    expect(auth.token()).toContain('.development-proxy')
  })

  it('rejects an empty or control-character subject', () => {
    expect(() => createDevServiceProxyAuthStorage('')).toThrow(/subject is invalid/)
    expect(() => createDevServiceProxyAuthStorage('bad\nsubject')).toThrow(/subject is invalid/)
  })
})
