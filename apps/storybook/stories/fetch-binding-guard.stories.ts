/**
 * FetchBindingGuard — the REAL-BROWSER regression guard for commit 9a3c9aa
 * ("fix(organism): bind browser fetch to globalThis"), iteration 3c.
 *
 * THE BUG (9a3c9aa): the shell-side LoopbackMcpClient stored `globalThis.fetch`
 * UNBOUND and invoked it detached (`this.fetchImpl(...)`). In a real browser that
 * throws "Failed to execute 'fetch' on 'Window': Illegal invocation". It was
 * caught LIVE in the organism — the node:http-path integration test never
 * exercised the browser `fetch` transport, so nothing guarded it.
 *
 * THE GUARD: this story's `play` runs IN A REAL BROWSER (Playwright/Chromium via
 * @storybook/test-runner). It constructs the REAL LoopbackMcpClient in its
 * `fetch` transport mode (the browser path) and actually invokes the fetch path
 * (`health()` → `this.fetchImpl(...)`) against a SAME-ORIGIN endpoint that exists
 * (Storybook's own `/iframe.html`, served by the same server the story runs in).
 * If fetch were stored unbound (the pre-fix bug), `this.fetchImpl(...)` throws
 * "Illegal invocation" here and the test FAILS. With the binding fix it succeeds.
 *
 * This is a true regression guard for the exact defect, in a real browser, with
 * NO mock fetch — it uses the page's real `window.fetch` against a real HTTP
 * endpoint. It does NOT require a gardend cell: the binding bug is purely about
 * how the client calls the browser fetch, independent of the cell behind it.
 *
 * (The full STRETCH — driving this fetch path against a live gardend cell — is
 * deferred; see STORYBOOK-CATALOG.md "Deferred". The organism already has a live
 * gardend integration test for the cell round-trip; the gap 9a3c9aa exposed was
 * specifically the BROWSER FETCH BINDING, which this guards directly.)
 */

import { html } from 'lit'
import type { Meta, StoryObj } from '@storybook/web-components'

// The REAL shell-side transport (not a mock). Exported from the organism for
// exactly this cross-app regression guard.
import { LoopbackMcpClient } from '@shrubbery/organism/cell/loopback-mcp'

const meta: Meta = {
  title: 'Regression/Fetch binding (9a3c9aa)',
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj

export const FetchBindingGuard: Story = {
  render: () =>
    html`
      <div
        data-testid="fetch-guard"
        style="font-family:var(--mn-font-chrome);max-width:480px;padding:16px;
               border:1px solid var(--mn-color-border-default);
               border-radius:var(--mn-radius-surface);
               background:var(--mn-color-surface-base);color:var(--mn-color-text-primary);"
      >
        <h3 style="margin:0 0 8px;">Browser fetch-binding regression guard</h3>
        <p style="margin:0;font-size:13px;color:var(--mn-color-text-secondary);">
          The <code>play</code> step runs in a real browser: it constructs the real
          <code>LoopbackMcpClient</code> in <code>fetch</code> mode and invokes the
          fetch path same-origin. Pre-fix (unbound fetch) this throws
          <em>Illegal invocation</em>; the 9a3c9aa fix makes it succeed.
        </p>
        <output data-guard-status style="display:block;margin-top:8px;font-family:var(--mn-font-mono);font-size:12px;"></output>
      </div>
    `,

  // The test-runner runs `play` and fails the story if it throws. This is where
  // the real-browser fetch invocation happens.
  play: async ({ canvasElement }) => {
    const status = canvasElement.querySelector('[data-guard-status]') as HTMLElement | null

    // Same-origin endpoints that exist on the Storybook server the story runs in.
    // /iframe.html is always served (it IS the preview); we point both the health
    // and mcp URLs at it so the fetch path is exercised end to end. We are testing
    // the FETCH BINDING, not MCP semantics, so a non-JSON 200/4xx body is fine —
    // the only failure mode we guard is the "Illegal invocation" throw.
    const sameOrigin = new URL('iframe.html', window.location.href).toString()

    const client = new LoopbackMcpClient({
      mcpUrl: sameOrigin,
      healthUrl: sameOrigin,
      transport: 'fetch', // force the BROWSER path (the one 9a3c9aa fixed)
      // NO injected fetch → the client must use globalThis.fetch, BOUND. If it
      // stored it unbound (the bug), the call below throws "Illegal invocation".
    })

    // This invokes this.fetchImpl(...) — the exact detached call that used to
    // throw. If the binding regressed, this line throws and the test fails.
    let ok = false
    try {
      ok = await client.health()
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      if (/Illegal invocation/i.test(msg)) {
        // The regression is back — fail loudly with the diagnostic name.
        throw new Error(
          `REGRESSION (9a3c9aa): browser fetch invoked detached — "${msg}". ` +
            `LoopbackMcpClient must bind globalThis.fetch.`,
        )
      }
      // Any other error (e.g. network) is NOT this regression — rethrow so it is
      // visible, but it is not the binding bug.
      throw err
    }

    if (status) {
      status.textContent = `fetch path invoked OK (health → ${ok ? '200-class' : 'non-2xx'}); fetch is bound to globalThis.`
    }
  },
}
