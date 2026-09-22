/**
 * Focused real-Chromium proof for the presentation-only pane parity slice.
 *
 * The Organism journey drives the production sidebar/chat composition. A small
 * second sidebar is mounted only to isolate native HTML drag geometry; it is the
 * real registered component with controlled props and an emitted drop intent,
 * not a replacement implementation.
 *
 * Set SHRUBBERY_HEADED=1 to watch the journey.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_PANE_BROWSER_PORT ?? 5204)
const headed = process.env.SHRUBBERY_HEADED === '1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`pane-parity browser assertion failed: ${message}`)
}

async function state(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __organism?: { state: Record<string, unknown> } }).__organism
    if (!bridge) throw new Error('Organism browser bridge is unavailable')
    return bridge.state
  })
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 90 : 0 })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => {
    const current = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism?.state
    return current?.ready === true || Boolean(current?.error)
  }, undefined, { timeout: 60_000 })

  let current = await state(page)
  assert(current.error == null, `boot failed: ${String(current.error)}`)

  // Production Organism sidebar: roving focus traverses visible rows and Enter
  // activates through the existing host-owned document-open callback.
  const sidebar = page.locator('mn-sidebar-panel')
  const architecture = sidebar.locator('[data-node-id="architecture"]')
  await architecture.focus()
  await architecture.press('ArrowDown')
  const focusedId = await sidebar.evaluate(element =>
    (element.shadowRoot?.activeElement as HTMLElement | null)?.dataset.nodeId ?? null,
  )
  assert(focusedId === 'research-notes', `ArrowDown focused ${String(focusedId)}, not research-notes`)
  await sidebar.locator('[data-node-id="research-notes"]').press('Enter')
  await page.waitForFunction(() =>
    (window as unknown as { __organism?: { state: { activeDocumentId?: string | null } } })
      .__organism?.state.activeDocumentId === 'research-notes',
  )

  // Native browser drag: the real controlled component computes an "inside"
  // target and emits one intent. No store or backend exists in this specimen.
  await page.evaluate(async () => {
    const panel = document.createElement('mn-sidebar-panel') as HTMLElement & {
      sections: unknown
      updateComplete: Promise<unknown>
    }
    panel.id = 'pane-parity-drag-specimen'
    panel.style.cssText = [
      'position:fixed',
      'left:24px',
      'top:120px',
      'width:320px',
      'height:320px',
      'z-index:10000',
      'box-shadow:0 8px 30px rgba(0,0,0,.2)',
    ].join(';')
    panel.sections = [{
      id: 'documents',
      label: 'Documents',
      nodes: [
        { id: 'folder-target', label: 'Archive', kind: 'folder', section: 'documents', order: 1 },
        { id: 'doc-source', label: 'Move me', kind: 'document', section: 'documents', order: 2 },
      ],
    }]
    Object.defineProperty(window, '__paneParityDrop', { configurable: true, writable: true, value: null })
    panel.addEventListener('mn-sidebar-node-drop', event => {
      ;(window as unknown as { __paneParityDrop: unknown }).__paneParityDrop = (event as CustomEvent).detail
    })
    document.body.append(panel)
    await panel.updateComplete
  })

  const dragPanel = page.locator('#pane-parity-drag-specimen')
  const source = dragPanel.locator('[data-node-id="doc-source"]')
  const target = dragPanel.locator('[data-node-id="folder-target"]')
  await source.dragTo(target, { targetPosition: { x: 120, y: 14 } })
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __paneParityDrop?: { position?: string } }).__paneParityDrop,
  ))
  const drop = await page.evaluate(() =>
    (window as unknown as {
      __paneParityDrop?: { sourceId?: string; targetId?: string; position?: string }
    }).__paneParityDrop,
  )
  assert(drop?.sourceId === 'doc-source', 'drag source identity was lost')
  assert(drop?.targetId === 'folder-target', 'drag target identity was lost')
  assert(drop?.position === 'inside', `drag position was ${String(drop?.position)}, not inside`)
  await dragPanel.evaluate(element => element.remove())

  // Production chat: the grouped model picker behaves as a popover (outside
  // pointer + Escape dismissal), and the history dialog returns focus.
  const chat = page.locator('sh-chat-host sh-chat-panel')
  const modelTrigger = chat.locator('.model-selector-trigger')
  await modelTrigger.click()
  await chat.locator('.model-picker').waitFor({ state: 'visible' })
  await chat.locator('.messages-container').click({ position: { x: 8, y: 8 } })
  assert(await chat.locator('.model-picker').count() === 0, 'outside pointer did not close the model picker')

  await modelTrigger.focus()
  await modelTrigger.press('ArrowDown')
  await chat.locator('.model-picker').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  assert(await chat.locator('.model-picker').count() === 0, 'Escape did not close the model picker')
  assert(await modelTrigger.evaluate(element => element.matches(':focus')), 'model trigger did not regain focus')

  const historyOpener = chat.locator('.super-bar-identity')
  await historyOpener.focus()
  await historyOpener.click()
  const drawer = page.locator('sh-chat-host [data-chat-history-drawer]')
  await drawer.waitFor({ state: 'visible' })
  assert(await drawer.evaluate(element => element.matches(':focus')), 'history drawer did not receive initial focus')
  await drawer.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  assert(await historyOpener.evaluate(element => element.matches(':focus')), 'history opener did not regain focus')

  current = await state(page)
  assert(current.activeDocumentId === 'research-notes', 'pane chrome interaction disturbed the active document')
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    sidebarKeyboard: true,
    sidebarNativeDrag: drop,
    chatPopoverDismissal: true,
    chatHistoryFocusReturn: true,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close().catch(() => undefined)
}
