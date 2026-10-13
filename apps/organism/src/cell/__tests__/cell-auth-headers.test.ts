import { describe, expect, it } from 'vitest'
import { cellAuthHeaders } from '../cell-auth-headers.js'
import type { ShrubberyContract } from '@shrubbery/nucleus'

// Exact current gateway allow-header contract, independently read via OPTIONS
// at app.sirin's real origin. This is not a substitute for the Chromium gate.
const allowed = new Set(['authorization', 'content-type', 'idempotency-key', 'prefer'])
function fixture(mode: 'local' | 'hosted') {
  const session = { token: 'first-token', user: 'first-user' }
  const contract = { auth: { token: () => session.token, userId: () => session.user },
    runtime: { mode: () => mode } } as unknown as Pick<ShrubberyContract, 'auth' | 'runtime'>
  return { session, contract }
}

describe('cell request identity across the hosted/local boundary', () => {
  it.each(['local', 'hosted'] as const)('uses fresh %s session credentials on every request', mode => {
    const { session, contract } = fixture(mode)
    const first = cellAuthHeaders(contract, { Accept: 'application/json', 'Content-Type': 'application/json' })
    expect(first.Authorization).toBe('Bearer first-token')
    expect(first['X-User-ID']).toBe(mode === 'local' ? 'first-user' : undefined)
    session.token = 'second-token'; session.user = 'second-user'
    const second = cellAuthHeaders(contract)
    expect(second.Authorization).toBe('Bearer second-token')
    expect(second['X-User-ID']).toBe(mode === 'local' ? 'second-user' : undefined)
    session.token = ''; session.user = ''
    expect(cellAuthHeaders(contract)).toEqual({})
    expect(first.Accept).toBe('application/json')
    expect(first['Content-Type']).toBe('application/json')
  })

  it('cannot carry an extra stale or differently cased identity into a hosted request', () => {
    const { contract } = fixture('hosted')
    const extra = { 'x-user-id': 'forged', 'X-USER-ID': 'stale', authorization: 'stale-token', Prefer: 'wait=1' }
    expect(cellAuthHeaders(contract, extra)).toEqual({ Prefer: 'wait=1', Authorization: 'Bearer first-token' })
    expect(extra.authorization).toBe('stale-token')
  })

  it('fits the public gateway preflight allowlist, while a local identity intentionally does not', () => {
    const unsafe = (headers: Record<string, string>) => Object.keys(headers).map(name => name.toLowerCase())
      .filter(name => name !== 'accept' && !allowed.has(name))
    const extra = { Accept: 'application/json', 'Content-Type': 'application/json', Prefer: 'wait=1' }
    expect(unsafe(cellAuthHeaders(fixture('hosted').contract, extra))).toEqual([])
    expect(unsafe(cellAuthHeaders(fixture('local').contract, extra))).toEqual(['x-user-id'])
  })
})
