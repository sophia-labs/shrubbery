/**
 * define-react-face.test.ts — S1's React sugar suite: a trivial component
 * (createElement, no JSX — this repo has zero .tsx files), mounted through
 * the real, lazily-loaded react/react-dom-client from packages/runtime
 * (React 19.2.7). No mocks — no stubbed createRoot/render: this is the real
 * package already a dependency of @shrubbery/runtime.
 */
import { createElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { defineReactFace } from '../define-react-face.js'
import type { GuestHostContext } from '../guest-app.js'

function TestComponent(props: Record<string, unknown>): ReactNode {
  return createElement('span', { 'data-test-react': 'mounted' }, typeof props.text === 'string' ? props.text : '')
}

function makeCtx(overrides: Partial<GuestHostContext> = {}): GuestHostContext {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return {
    container,
    base: '/',
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** Polls real DOM/property state — react-dom's commit is not guaranteed to land within a single microtask outside `act()`. Real timers, no fake clock. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition was never met')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

describe('defineReactFace', () => {
  it('builds a GuestAppModule with framework "react" and the supplied id/styles', () => {
    const guest = defineReactFace({
      id: 'test-react-guest',
      component: TestComponent,
      styles: { css: '.x{color:red}', sha256: 'deadbeef' },
    })
    expect(guest.id).toBe('test-react-guest')
    expect(guest.framework).toBe('react')
    expect(guest.styles).toEqual({ css: '.x{color:red}', sha256: 'deadbeef' })
  })

  it('mounts through createElement + createRoot — the DOM shows the real rendered output', async () => {
    const guest = defineReactFace({
      id: 'test-react-guest',
      component: TestComponent,
      props: () => ({ text: 'hello react' }),
    })
    const ctx = makeCtx()

    const mount = await guest.mount(ctx)
    await waitFor(() => ctx.container.querySelector('[data-test-react="mounted"]') !== null)

    const rendered = ctx.container.querySelector('[data-test-react="mounted"]')
    expect(rendered?.textContent).toBe('hello react')

    mount.unmount()
  })

  it('props update re-renders — a partial GuestHostContext update reaches props() and the DOM reflects it', async () => {
    const guest = defineReactFace({
      id: 'test-react-guest',
      component: TestComponent,
      props: (context) => ({ text: context.docId ?? 'no-doc' }),
    })
    const ctx = makeCtx({ docId: 'doc-1' })

    const mount = await guest.mount(ctx)
    await waitFor(() => ctx.container.textContent === 'doc-1')

    expect(mount.update).toBeTypeOf('function')
    mount.update?.({ docId: 'doc-2' })
    await waitFor(() => ctx.container.textContent === 'doc-2')

    mount.unmount()
  })

  it('unmount empties the container', async () => {
    const guest = defineReactFace({
      id: 'test-react-guest',
      component: TestComponent,
      props: () => ({ text: 'x' }),
    })
    const ctx = makeCtx()

    const mount = await guest.mount(ctx)
    await waitFor(() => ctx.container.childElementCount > 0)
    expect(ctx.container.childElementCount).toBeGreaterThan(0)

    mount.unmount()
    expect(ctx.container.childElementCount).toBe(0)
  })
})
