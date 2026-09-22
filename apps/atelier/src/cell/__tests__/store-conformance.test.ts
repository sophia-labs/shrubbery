/**
 * store-conformance.test.ts — Atelier's concrete shell-side SessionStore exposes
 * the canonical ShrubberyStore<T> surface directly, while preserving getState()
 * for existing shell call sites.
 *
 * Construction-only: createSessionStore is the real production store, and no
 * network read occurs until refresh().
 */
import { describe, expect, it } from 'vitest'
import { isReady } from '@shrubbery/nucleus'
import { createGardendContract } from '../gardend-contract.js'
import { createSessionStore, workspaceConfigStore } from '../session-store.js'

describe('atelier SessionStore — canonical ShrubberyStore conformance', () => {
  it('exposes get() as the canonical read and getState() as a compatibility alias', () => {
    const contract = createGardendContract({
      transport: {
        mcpUrl: '/cell/mcp',
        healthUrl: '/cell/health',
      },
    })
    const session = createSessionStore({ contract, graphId: 'atelier-store-conformance' })

    expect(session.get()).toBe(session.getState())
    expect(session.get().status).toBe('idle')

    const config = workspaceConfigStore(session)
    expect(config.get()).toEqual({ status: 'idle', read: null, error: null })
    expect(isReady(config.get())).toBe(false)
  })
})
