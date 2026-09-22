/**
 * store-conformance.test.ts — the concrete shell-side stores expose the canonical
 * ShrubberyStore<T> surface directly, while preserving getState() for existing
 * shell call sites.
 *
 * This is intentionally construction-only: createSessionStore/createEmporiumStore
 * are real production stores, and no network read occurs until refresh().
 */
import { describe, expect, it } from 'vitest'
import { isReady } from '@shrubbery/nucleus'
import { createGardendContract } from '../gardend-contract.js'
import { createEmporiumStore } from '../emporium-store.js'
import { createSessionStore, workspaceConfigStore } from '../session-store.js'

describe('concrete shell stores — canonical ShrubberyStore conformance', () => {
  it('SessionStore exposes get() as the canonical read and getState() as a compatibility alias', () => {
    const contract = createGardendContract({
      transport: {
        mcpUrl: '/cell/mcp',
        healthUrl: '/cell/health',
      },
    })
    const session = createSessionStore({ contract, graphId: 'store-conformance' })

    expect(session.get()).toBe(session.getState())
    expect(session.get().status).toBe('idle')

    const config = workspaceConfigStore(session)
    expect(config.get()).toEqual({ status: 'idle', read: null, error: null })
    expect(isReady(config.get())).toBe(false)
  })

  it('EmporiumStore exposes get() as the canonical read and getState() as a compatibility alias', () => {
    const store = createEmporiumStore({ transport: { baseUrl: '/cell' } })

    expect(store.get()).toBe(store.getState())
    expect(store.get()).toEqual({ status: 'idle', read: null, error: null })
    expect(isReady(store.get())).toBe(false)
  })
})
