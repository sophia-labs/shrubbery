/**
 * Real-Chromium acceptance for the controlled Wires-panel lift.
 *
 * Run headless in CI, or set SHRUBBERY_HEADED=1 to watch the same journey.
 * The fixture is mounted into the deterministic Organism page so Vite resolves
 * the actual workspace sources and tokens rather than a second test bundle.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_WIRES_BROWSER_PORT ?? 5214)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`wires-panel-browser-harness assertion failed: ${message}`)
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
const consoleWarnings: string[] = []
const failedRequests: string[] = []
const badResponses: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
  if (message.type() === 'warning') consoleWarnings.push(message.text())
})
page.on('requestfailed', request => {
  failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? 'failed'}`)
})
page.on('response', response => {
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
})

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => {
    const bridge = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism
    return bridge?.state.ready === true || Boolean(bridge?.state.error)
  }, undefined, { timeout: 60_000 })
  // Vite may perform one dependency-optimization reload on a cold workspace.
  // Let that settle before installing the ephemeral acceptance fixture.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(250)

  await page.evaluate(async () => {
    await customElements.whenDefined('sh-wires-panel')
    const fixture = document.createElement('section')
    fixture.id = 'wire-browser-fixture'
    Object.assign(fixture.style, {
      position: 'fixed',
      inset: '60px 24px 24px auto',
      width: '380px',
      zIndex: '10000',
      background: 'var(--mn-color-surface-base, white)',
      border: '1px solid var(--mn-color-border-default, #d0d7de)',
      boxShadow: '0 18px 54px rgb(15 23 42 / 24%)',
    })
    const panel = document.createElement('sh-wires-panel') as HTMLElement & {
      bundle: unknown
      localGraphId: string
      localDocumentId: string
      localDocumentTitle: string
      status: string
      error: string | null
      showClose: boolean
      updateComplete: Promise<boolean>
    }
    Object.assign(panel.style, { width: '100%', height: '100%' })
    panel.localGraphId = 'graph-a'
    panel.localDocumentId = 'doc-current'
    panel.localDocumentTitle = 'Current document'
    panel.status = 'ready'
    panel.showClose = true
    panel.bundle = {
      outgoingWires: [
        {
          id: 'wire-out',
          predicate: 'http://mnemosyne.ai/vocab#supports',
          predicateLabel: 'supports',
          otherDocumentId: 'doc-target',
          otherGraphId: 'graph-a',
          otherBlockId: 'block-target',
          localBlockId: 'block-current',
          otherTitle: 'Target document',
          otherSnippet: 'remote context',
          localSnippet: 'local context',
          bidirectional: false,
        },
        {
          id: 'wire-sparse',
          predicate: 'http://mnemosyne.ai/vocab#mentions',
          predicateLabel: 'mentions',
          otherDocumentId: 'doc-level-target',
          otherGraphId: 'graph-a',
          localBlockId: 'missing-local-block',
          otherTitle: 'Document-level target',
          bidirectional: false,
        },
      ],
      incomingWires: [
        {
          id: 'wire-in',
          predicate: 'http://mnemosyne.ai/vocab#qualifies',
          predicateLabel: 'qualifies',
          otherDocumentId: 'doc-source',
          otherGraphId: 'graph-a',
          otherTitle: 'Source document',
          bidirectional: true,
        },
      ],
      wiredBlockIds: ['block-current', 'missing-local-block'],
    }
    const events = { open: [] as unknown[], refresh: [] as unknown[], context: [] as unknown[], close: 0 }
    panel.addEventListener('shrubbery:open-document', event => {
      events.open.push((event as CustomEvent).detail)
      event.stopPropagation()
    })
    panel.addEventListener('mn-wire-refresh-request', event => {
      events.refresh.push((event as CustomEvent).detail)
      event.stopPropagation()
    })
    panel.addEventListener('mn-wire-context-request', event => {
      events.context.push((event as CustomEvent).detail)
      event.stopPropagation()
    })
    panel.addEventListener('mn-wire-panel-close', event => {
      events.close += 1
      event.stopPropagation()
    })
    Object.defineProperty(window, '__wireBrowserEvents', { configurable: true, value: events })
    fixture.append(panel)
    document.body.append(fixture)
    await panel.updateComplete
  })

  const panel = page.locator('#wire-browser-fixture sh-wires-panel')
  await panel.locator('[data-wire-id="wire-out"]').waitFor({ state: 'visible' })
  const oriented = await panel.evaluate(element => {
    const root = element.shadowRoot!
    const outgoing = Array.from(root.querySelectorAll('[data-wire-id="wire-out"] [data-wire-endpoint]'))
      .map(endpoint => ({
        label: endpoint.getAttribute('data-wire-endpoint'),
        title: endpoint.querySelector('.endpoint-title')?.textContent?.trim() ?? null,
      }))
    const incoming = Array.from(root.querySelectorAll('[data-wire-id="wire-in"] [data-wire-endpoint]'))
      .map(endpoint => ({
        label: endpoint.getAttribute('data-wire-endpoint'),
        title: endpoint.querySelector('.endpoint-title')?.textContent?.trim() ?? null,
      }))
    return { outgoing, incoming }
  })
  assert(JSON.stringify(oriented.outgoing) === JSON.stringify([
    { label: 'here', title: 'Current document' },
    { label: 'there', title: 'Target document' },
  ]), 'outgoing endpoint orientation drifted')
  assert(JSON.stringify(oriented.incoming) === JSON.stringify([
    { label: 'there', title: 'Source document' },
    { label: 'here', title: 'Current document' },
  ]), 'incoming endpoint orientation drifted')

  const sparse = panel.locator('[data-wire-id="wire-sparse"]')
  assert((await sparse.locator('[data-wire-endpoint="here"] .snippet').textContent())?.includes('No here snippet yet'),
    'block endpoint did not expose its missing snapshot')
  assert(await sparse.locator('[data-wire-endpoint="there"] .snippet').count() === 0,
    'document endpoint fabricated a missing-snippet placeholder')

  const outgoing = panel.locator('[data-wire-id="wire-out"]')
  const actionsBeforeHover = await outgoing.locator('.actions').evaluate(element => {
    const style = getComputedStyle(element)
    return { opacity: style.opacity, visibility: style.visibility }
  })
  assert(actionsBeforeHover.opacity === '0' && actionsBeforeHover.visibility === 'hidden',
    'desktop actions should remain quiet until hover/focus')

  await outgoing.locator('.endpoint-title').first().click()
  await outgoing.hover()
  await outgoing.locator('[data-wire-panel-refresh]').click()
  await outgoing.locator('[data-wire-panel-context]').click()
  await outgoing.focus()
  await page.keyboard.press('Enter')
  const events = await page.evaluate(() => (window as unknown as {
    __wireBrowserEvents: { open: unknown[]; refresh: unknown[]; context: unknown[]; close: number }
  }).__wireBrowserEvents)
  assert(events.open.length === 2, 'title click and keyboard activation did not both navigate')
  assert(events.refresh.length === 1 && events.context.length === 1,
    'card actions did not emit their controlled intents exactly once')

  await page.setViewportSize({ width: 520, height: 800 })
  const mobileAction = await outgoing.locator('[data-wire-panel-refresh]').evaluate(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return { opacity: style.opacity, visibility: style.visibility, width: rect.width, height: rect.height }
  })
  assert(mobileAction.opacity === '1' && mobileAction.visibility === 'visible', 'mobile actions are not persistently visible')
  assert(mobileAction.width >= 44 && mobileAction.height >= 44, 'mobile action target is smaller than 44px')

  await panel.evaluate(async (element) => {
    const controlled = element as HTMLElement & { status: string; error: string; updateComplete: Promise<boolean> }
    controlled.status = 'error'
    controlled.error = 'Browser projection failure'
    await controlled.updateComplete
  })
  assert((await panel.locator('[data-wire-panel-state="error"]').textContent())?.includes('Browser projection failure'),
    'controlled error state did not replace stale cards')
  await panel.locator('[data-wire-panel-close]').click()
  const closes = await page.evaluate(() => (window as unknown as {
    __wireBrowserEvents: { close: number }
  }).__wireBrowserEvents.close)
  assert(closes === 1, 'close intent did not reach the host boundary')
  const expectedDevWarnings = consoleWarnings.filter(message => message.includes('Lit is in dev mode'))
  const unexpectedWarnings = consoleWarnings.filter(message =>
    !message.includes('Lit is in dev mode'))
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  assert(unexpectedWarnings.length === 0, `unexpected console warnings: ${unexpectedWarnings.join('\n')}`)
  assert(failedRequests.length === 0, `failed requests: ${failedRequests.join('\n')}`)
  assert(badResponses.length === 0, `HTTP errors: ${badResponses.join('\n')}`)

  console.log(JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed: process.env.SHRUBBERY_HEADED === '1',
    orientedCards: true,
    descendantClickAndKeyboardNavigation: true,
    isolatedControlledActions: true,
    mobileTargets: true,
    controlledErrorAndClose: true,
    expectedDevWarnings: expectedDevWarnings.length,
    consoleErrors,
    pageErrors,
    failedRequests,
    badResponses,
  }, null, 2))
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
