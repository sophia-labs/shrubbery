// @vitest-environment happy-dom

import type { CognitoAuthSession } from '@shrubbery/source/gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { HojaApp } from '../src/hoja-app.js'
import type { SeedStore } from '../src/seed-store.js'

const store: SeedStore = {
  kind: 'soil',
  async list() {
    return [{ id: 'leaf-1', title: 'First leaf', snippet: 'body', modified_ms: 1 }]
  },
  async read() {
    return { id: 'leaf-1', title: 'First leaf', markdown: '# First leaf\n\nbody' }
  },
  async create() {
    return { id: 'leaf-2' }
  },
  async save() {
    return { ok: true, title: 'First leaf', snippet: 'body', modified_ms: 2 }
  },
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('Hoja agent-legible controls', () => {
  it('pins stable test ids to human accessible names', async () => {
    const app = new HojaApp()
    app.store = store
    app.authSession = authenticatedSession()
    document.body.append(app)
    await app.updateComplete
    await nextTask()
    await app.updateComplete

    expect(control(app, 'button.new-leaf')?.getAttribute('aria-label')).toBe('New leaf')
    expect(control(app, 'button.back')?.getAttribute('aria-label')).toBe('Back to leaves')
    expect(control(app, 'button.sign-out')?.getAttribute('aria-label')).toBe('Sign out')
  })
})

function control(app: HojaApp, testId: string): HTMLButtonElement | null {
  return app.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`) ?? null
}

function authenticatedSession(): CognitoAuthSession {
  return {
    snapshot: () => ({ status: 'authenticated' }),
    onChange: () => () => undefined,
    whenReady: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
  } as unknown as CognitoAuthSession
}

function nextTask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
