/**
 * define-element-face.test.ts — S1's Web-Components sugar suite: a trivial
 * Lit element (not pre-registered — `defineElementFace`'s own optional
 * `define()` callback is what registers it, exercising that parameter for
 * real), mounted through the SAME `GuestAppModule`/`GuestHostContext`
 * contract `define-react-face.test.ts` exercises for a React guest — "the
 * registry cannot tell them apart" (brief S1 item 4).
 */
import { html, LitElement } from 'lit'
import { describe, expect, it } from 'vitest'
import { defineElementFace } from '../define-element-face.js'
import type { GuestHostContext } from '../guest-app.js'

const TAG_NAME = 'sh-test-guest-element'

class ShTestGuestElement extends LitElement {
  static properties = { label: { type: String } }
  label = ''

  // Light DOM, same as sh-guest-island — irrelevant to this test's assertions
  // (which read the property directly and the light-DOM text content), but
  // keeping it consistent with the rest of this directory's convention.
  createRenderRoot(): this {
    return this
  }

  protected render() {
    return html`<span data-test-element="mounted">${this.label}</span>`
  }
}

function defineTestElement(): void {
  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, ShTestGuestElement)
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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition was never met')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

describe('defineElementFace', () => {
  it('builds a GuestAppModule with framework "web-components" and the supplied id/styles', () => {
    const guest = defineElementFace({
      id: 'test-element-guest',
      tagName: TAG_NAME,
      define: defineTestElement,
      styles: { css: '.y{color:blue}', sha256: 'cafebabe' },
    })
    expect(guest.id).toBe('test-element-guest')
    expect(guest.framework).toBe('web-components')
    expect(guest.styles).toEqual({ css: '.y{color:blue}', sha256: 'cafebabe' })
  })

  it('calls define() to register the tag, creates the element in the container, and assigns props as properties', async () => {
    const guest = defineElementFace({
      id: 'test-element-guest',
      tagName: TAG_NAME,
      define: defineTestElement,
      props: () => ({ label: 'hello element' }),
    })
    const ctx = makeCtx()

    const mount = await guest.mount(ctx)

    expect(customElements.get(TAG_NAME)).toBe(ShTestGuestElement)
    const el = ctx.container.querySelector(TAG_NAME) as ShTestGuestElement
    expect(el).toBeTruthy()
    expect(el.label).toBe('hello element')

    await waitFor(() => ctx.container.querySelector('[data-test-element="mounted"]')?.textContent === 'hello element')

    mount.unmount()
  })

  it('update reassigns properties — a partial GuestHostContext update reaches props() and the element reflects it', async () => {
    const guest = defineElementFace({
      id: 'test-element-guest',
      tagName: TAG_NAME,
      define: defineTestElement,
      props: (context) => ({ label: context.docId ?? 'no-doc' }),
    })
    const ctx = makeCtx({ docId: 'doc-1' })

    const mount = await guest.mount(ctx)
    const el = ctx.container.querySelector(TAG_NAME) as ShTestGuestElement
    expect(el.label).toBe('doc-1')

    expect(mount.update).toBeTypeOf('function')
    mount.update?.({ docId: 'doc-2' })
    expect(el.label).toBe('doc-2')
    await waitFor(() => ctx.container.querySelector('[data-test-element="mounted"]')?.textContent === 'doc-2')

    mount.unmount()
  })

  it('unmount removes the element from the container', async () => {
    const guest = defineElementFace({
      id: 'test-element-guest',
      tagName: TAG_NAME,
      define: defineTestElement,
      props: () => ({ label: 'x' }),
    })
    const ctx = makeCtx()

    const mount = await guest.mount(ctx)
    expect(ctx.container.childElementCount).toBe(1)

    mount.unmount()
    expect(ctx.container.childElementCount).toBe(0)
  })

  it('define() is safe to call more than once (idempotent registration) across repeated mounts', async () => {
    const guest = defineElementFace({
      id: 'test-element-guest',
      tagName: TAG_NAME,
      define: defineTestElement,
      props: () => ({ label: 'first' }),
    })
    const ctxOne = makeCtx()
    const mountOne = await guest.mount(ctxOne)
    const ctxTwo = makeCtx()
    const mountTwo = await guest.mount(ctxTwo)

    expect(ctxOne.container.childElementCount).toBe(1)
    expect(ctxTwo.container.childElementCount).toBe(1)

    mountOne.unmount()
    mountTwo.unmount()
  })
})
