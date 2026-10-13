// @vitest-environment happy-dom

import type { CognitoAuthSession } from '@shrubbery/source/gateway'
import { FEATURE_TEST_SUBJECTS, OPERATOR_SUBJECTS } from '@shrubbery/source/features'
import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components/top-bar'
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
    app.authSession = authenticatedSession(OPERATOR_SUBJECTS[0]!)
    document.body.append(app)
    await app.updateComplete
    await nextTask()
    await app.updateComplete

    expect(barAction(app, 'new-note')?.getAttribute('aria-label')).toBe('New leaf')
    expect(control(app, 'button.back')?.getAttribute('aria-label')).toBe('Back to leaves')
    expect(control(app, 'button.sign-out')?.getAttribute('aria-label')).toBe('Sign out')
  })
})

describe('Hoja hosted gate (feature hoja-v2, open to everyone since 2026-09-23)', () => {
  it('a signed-in non-operator gets Hoja itself: no closed gate, leaves are read', async () => {
    let listed = 0
    const app = new HojaApp()
    app.store = { ...store, async list() { listed += 1; return store.list() } }
    app.authSession = authenticatedSession('00000000-not-an-operator')
    document.body.append(app)
    await app.updateComplete
    await nextTask()
    await app.updateComplete

    expect(app.shadowRoot?.querySelector('[data-hoja-gate="closed"]')).toBeNull()
    expect(barAction(app, 'new-note')).not.toBeNull()
    expect(listed).toBeGreaterThan(0)
  })
})

function bar(app: HojaApp): (HTMLElement & { updateComplete: Promise<unknown> }) | null {
  return app.shadowRoot?.querySelector('mn-top-bar') ?? null
}

function barAction(app: HojaApp, id: string): HTMLButtonElement | null {
  return bar(app)?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-app-action="${id}"]`) ?? null
}

function rows(app: HojaApp): HTMLElement[] {
  return [...bar(app)?.shadowRoot?.querySelectorAll<HTMLElement>('.app-switcher-btn') ?? []]
}

function control(app: HojaApp, testId: string): HTMLButtonElement | null {
  return app.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`) ?? null
}

function authenticatedSession(userId: string): CognitoAuthSession {
  return {
    snapshot: () => ({ status: 'authenticated', userId }),
    onChange: () => () => undefined,
    whenReady: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
  } as unknown as CognitoAuthSession
}

function nextTask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('Hoja wears the shared Sophia top bar', () => {
  async function mounted(userId: string): Promise<HojaApp> {
    const app = new HojaApp()
    app.store = store
    app.authSession = authenticatedSession(userId)
    document.body.append(app)
    await app.updateComplete
    await nextTask()
    await app.updateComplete
    await bar(app)?.updateComplete
    return app
  }

  it('operator: Garden → Choreograph → Hoja, Hoja checked, New leaf toolbar, theme on the right', async () => {
    const app = await mounted(OPERATOR_SUBJECTS[0]!)
    expect(rows(app).map(row => row.dataset.appId)).toEqual(['garden', 'choreograph', 'hoja'])
    expect(rows(app).filter(row => row.getAttribute('aria-checked') === 'true').map(row => row.dataset.appId)).toEqual(['hoja'])
    expect(bar(app)?.shadowRoot?.querySelector('.masthead-name')?.textContent?.trim()).toBe('Hoja')
    expect(barAction(app, 'new-note')).not.toBeNull()
    expect(bar(app)?.shadowRoot?.querySelector<HTMLElement>('[data-action="theme"]')?.hidden).toBe(false)
    expect(bar(app)?.shadowRoot?.querySelector<HTMLElement>('[data-action="skin"]')?.hidden).toBe(true)
  })

  it('an ordinary user sees Garden + Hoja (Hoja tagged experimental) — Choreograph is operator-only', async () => {
    const app = await mounted('00000000-ordinary-user')
    expect(rows(app).map(row => row.dataset.appId)).toEqual(['garden', 'hoja'])
    const hoja = rows(app).find(row => row.dataset.appId === 'hoja')!
    expect(hoja.getAttribute('aria-label')).toBe('Hoja (experimental) app')
    expect(hoja.querySelector('.app-stage')?.textContent?.trim()).toBe('experimental')
    expect(FEATURE_TEST_SUBJECTS['hoja-v2']).toEqual([])
  })

  it('the toolbar New leaf opens an empty draft (the document is created on first input); the theme button flips the theme', async () => {
    let created = 0
    const app = new HojaApp()
    app.store = { ...store, async create() { created += 1; return { id: 'leaf-2' } } }
    app.authSession = authenticatedSession(OPERATOR_SUBJECTS[0]!)
    document.body.append(app)
    await app.updateComplete; await nextTask(); await app.updateComplete; await bar(app)?.updateComplete
    barAction(app, 'new-note')!.click()
    await nextTask(); await nextTask(); await app.updateComplete
    // New opens the unsaved draft; nothing is created until the first keystroke
    // (QA P0-1: no empty orphan per click).
    expect(created).toBe(0)
    expect(app.shadowRoot!.querySelector('.editor-bar-title')?.textContent?.trim()).toBe('New leaf')
    const before = document.documentElement.dataset.theme
    bar(app)!.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="theme"]')!.click()
    expect(document.documentElement.dataset.theme).not.toBe(before)
    // Garden identity = no data-skin, so theme-dark (not skin-garden's light
    // masthead) paints the shared bar in dark mode.
    expect(document.documentElement.hasAttribute('data-skin')).toBe(false)
  })
})
