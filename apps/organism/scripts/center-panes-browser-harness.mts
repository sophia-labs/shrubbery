/**
 * Isolated real-Chromium proof for CONC-WP-DUAL-PANE.
 *
 * The Vite plugin serves an in-memory entry so the proof does not add another
 * application shell or touch Organism's root integration. Set SHRUBBERY_HEADED=1
 * to watch the exact same gesture journey.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer, type Plugin } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SHRUBBERY_CENTER_PANES_PORT ?? 5214)
const headed = process.env.SHRUBBERY_HEADED === '1'
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const entryId = '/center-panes-proof-entry.ts'
const resolvedEntryId = '\0virtual:center-panes-proof-entry.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`center-panes browser assertion failed: ${message}`)
}

const entrySource = String.raw`
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import {
  CENTER_PANE_CLOSE_EVENT,
  CENTER_PANE_FOCUS_EVENT,
  CENTER_PANE_NAVIGATE_EVENT,
  CENTER_PANE_OPEN_EVENT,
  CENTER_PANE_RESIZE_EVENT,
  CenterPanesController,
  NULL_EDITOR_HOST_STATE,
} from '@shrubbery/runtime'
import { InProcessCrdtBackend } from '@shrubbery/runtime/harness/in-process-crdt-backend'
import { applySkinTheme } from '@shrubbery/tokens'

const documentLocation = (documentId, title) => ({
  kind: 'document',
  graphId: 'garden-proof',
  documentId,
  title,
})

const docs = {
  alpha: documentLocation('alpha', 'Alpha notebook'),
  beta: documentLocation('beta', 'Beta notebook'),
  gamma: documentLocation('gamma', 'Gamma notebook'),
  delta: documentLocation('delta', 'Delta notebook'),
}

applySkinTheme({ skin: 'garden', theme: 'light' })
const backend = new InProcessCrdtBackend()
const providers = new Map()
const providerFor = (location) => {
  let provider = providers.get(location.documentId)
  if (!provider) {
    provider = backend.open({ kind: 'doc', graphId: location.graphId, docId: location.documentId })
    providers.set(location.documentId, provider)
  }
  return provider
}

const controller = new CenterPanesController({
  primaryPaneId: 'center-primary',
  secondaryPaneId: 'center-secondary',
  primaryLocation: docs.alpha,
})
const surface = document.createElement('sh-center-panes')
surface.id = 'center-panes-proof'
surface.setAttribute('show-split-command', '')
document.querySelector('#center-panes-root').append(surface)

const eventLog = []
const chooserQueue = {
  'center-primary': [docs.gamma],
  'center-secondary': [docs.beta, docs.delta],
}

function paneById(paneId) {
  if (controller.state.primary.id === paneId) return controller.state.primary
  if (controller.state.secondary?.id === paneId) return controller.state.secondary
  return null
}

function bindCurrent(paneId) {
  const pane = paneById(paneId)
  if (!pane || pane.current.kind === 'home') {
    controller.setEditorState(paneId, {
      ...NULL_EDITOR_HOST_STATE,
      centerMode: 'home',
      graphId: pane?.current.graphId ?? null,
    })
    return
  }
  controller.setEditorState(paneId, {
    centerMode: 'document',
    graphId: pane.current.graphId,
    documentId: pane.current.documentId,
    status: 'ready',
    error: null,
    provider: providerFor(pane.current),
  })
}

function renderControlledState() {
  surface.projection = controller.projection
  surface.editorHosts = new Map(
    Array.from(controller.bindings, ([paneId, binding]) => [paneId, { binding }]),
  )
}

controller.subscribe(renderControlledState)
bindCurrent(controller.state.primary.id)
renderControlledState()

surface.addEventListener(CENTER_PANE_OPEN_EVENT, (event) => {
  const requested = event.detail
  let location = requested.location
  if (!location) {
    const queue = chooserQueue[requested.paneId] ?? []
    location = queue.shift()
    if (!location) return
  }
  const detail = { ...requested, location }
  eventLog.push({ type: 'open', detail })
  controller.dispatch({ type: 'open', detail })
  bindCurrent(controller.state.activePaneId)
})

surface.addEventListener(CENTER_PANE_FOCUS_EVENT, (event) => {
  eventLog.push({ type: 'focus', detail: event.detail })
  controller.dispatch({ type: 'focus', detail: event.detail })
})

surface.addEventListener(CENTER_PANE_CLOSE_EVENT, (event) => {
  eventLog.push({ type: 'close', detail: event.detail })
  controller.dispatch({ type: 'close', detail: event.detail })
})

surface.addEventListener(CENTER_PANE_NAVIGATE_EVENT, (event) => {
  eventLog.push({ type: 'navigate', detail: event.detail })
  controller.dispatch({ type: 'navigate', detail: event.detail })
  bindCurrent(event.detail.paneId)
})

surface.addEventListener(CENTER_PANE_RESIZE_EVENT, (event) => {
  eventLog.push({ type: 'resize', detail: event.detail })
  controller.dispatch({ type: 'resize', detail: event.detail })
})

document.querySelector('#toggle-posture').addEventListener('click', () => {
  controller.setPosture(controller.state.posture === 'workspace' ? 'left-collapsed' : 'workspace')
})

function snapshot() {
  const projection = controller.projection
  return {
    ready: true,
    activePaneId: projection.activePaneId,
    dividerPercent: projection.dividerPercent,
    posture: projection.posture,
    split: projection.split,
    splitCommand: projection.splitCommand,
    panes: projection.panes.map((pane) => ({
      id: pane.id,
      position: pane.position,
      documentId: pane.current.kind === 'document' ? pane.current.documentId : null,
      title: pane.title,
      back: pane.back.length,
      forward: pane.forward.length,
      active: pane.active,
    })),
    eventCount: eventLog.length,
  }
}

Object.defineProperty(window, '__centerPanesHarness', {
  configurable: true,
  value: {
    get state() { return snapshot() },
    get events() { return [...eventLog] },
  },
})

window.addEventListener('beforeunload', () => backend.destroyAll(), { once: true })
`

const htmlSource = `<!doctype html>
<html lang="en" data-skin="garden" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Controlled center panes proof</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        display: grid;
        grid-template-rows: 46px minmax(0, 1fr);
        background: #eeece6;
        color: #27332c;
        font-family: system-ui, sans-serif;
      }
      .proof-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid #cbc6bb;
        background: #f6f3ec;
      }
      .proof-toolbar strong { font: 600 13px/1 system-ui, sans-serif; }
      .proof-toolbar span { color: #68736c; font-size: 12px; }
      #toggle-posture {
        margin-left: auto;
        min-height: 30px;
        padding: 0 11px;
        border: 1px solid #bdb7aa;
        border-radius: 6px;
        background: #fffdf8;
        color: #35644c;
      }
      #center-panes-root { min-width: 0; min-height: 0; }
      sh-center-panes { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <header class="proof-toolbar">
      <strong>Two paths through one garden</strong>
      <span>Controlled Class-B pane specimen</span>
      <button id="toggle-posture" type="button">Toggle left rail posture</button>
    </header>
    <main id="center-panes-root"></main>
    <script type="module" src="${entryId}"></script>
  </body>
</html>`

const virtualHarnessPlugin: Plugin = {
  name: 'center-panes-proof-harness',
  resolveId(id) {
    return id === entryId ? resolvedEntryId : null
  },
  load(id) {
    return id === resolvedEntryId ? entrySource : null
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (pathname !== '/center-panes-harness.html' && pathname !== '/') {
        next()
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(htmlSource)
    })
  },
}

async function state(page: Page): Promise<{
  ready: boolean
  activePaneId: string
  dividerPercent: number
  posture: string
  split: boolean
  splitCommand: { action: string; pressed: boolean; label: string }
  panes: Array<{ id: string; documentId: string | null; back: number; forward: number }>
}> {
  return page.evaluate(() => (window as unknown as {
    __centerPanesHarness: { state: {
      ready: boolean
      activePaneId: string
      dividerPercent: number
      posture: string
      split: boolean
      splitCommand: { action: string; pressed: boolean; label: string }
      panes: Array<{ id: string; documentId: string | null; back: number; forward: number }>
    } }
  }).__centerPanesHarness.state)
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  plugins: [virtualHarnessPlugin],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  logLevel: 'warn',
})

await server.listen()
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 80 : 0 })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
const requestFailures: string[] = []
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('requestfailed', (request) => {
  requestFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`)
})

try {
  await page.goto(`http://127.0.0.1:${port}/center-panes-harness.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __centerPanesHarness?: { state?: { ready?: boolean } } })
      .__centerPanesHarness?.state?.ready,
  ))

  const surface = page.locator('sh-center-panes')
  const primaryPane = surface.locator('[data-pane-id="center-primary"]')
  const primaryEditor = primaryPane.locator('sh-editor-host .ProseMirror')
  await primaryEditor.waitFor({ state: 'visible', timeout: 30_000 })
  let current = await state(page)
  assert(current.panes.length === 1, 'the specimen did not begin as one real pane')
  assert(current.splitCommand.action === 'open' && !current.splitCommand.pressed,
    'single-pane split command was not truthful')

  // The split command creates actual topology, initially with the honest Home state.
  await surface.locator('[data-split-command]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: unknown[] } } })
      .__centerPanesHarness.state.panes.length === 2,
  )
  const secondaryPane = surface.locator('[data-pane-id="center-secondary"]')
  await secondaryPane.locator('[data-pane-home="center-secondary"] .empty-open').click()
  const secondaryEditor = secondaryPane.locator('sh-editor-host .ProseMirror')
  await secondaryEditor.waitFor({ state: 'visible', timeout: 30_000 })
  current = await state(page)
  assert(current.split && current.splitCommand.action === 'close' && current.splitCommand.pressed,
    'two-pane split command was not truthful')
  assert(current.panes.find((pane) => pane.id === 'center-secondary')?.documentId === 'beta',
    'secondary pane did not receive its independent beta binding')

  // Two real editor/Y.Doc bindings accept independent browser input.
  await primaryEditor.click()
  await page.keyboard.type('Alpha Chromium path.')
  await secondaryEditor.click()
  await page.keyboard.type('Beta Chromium path.')
  await page.waitForFunction(() => {
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    )!
    const secondary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-secondary"] sh-editor-host',
    )!
    const left = primary.shadowRoot!.querySelector('.ProseMirror')?.textContent ?? ''
    const right = secondary.shadowRoot!.querySelector('.ProseMirror')?.textContent ?? ''
    return left.includes('Alpha Chromium path.') && right.includes('Beta Chromium path.')
  })
  assert(!(await primaryEditor.textContent())!.includes('Beta Chromium path.'),
    'secondary text leaked into the primary binding')
  assert(!(await secondaryEditor.textContent())!.includes('Alpha Chromium path.'),
    'primary text leaked into the secondary binding')

  await page.evaluate(() => {
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    const secondary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-secondary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    ;(window as unknown as { __dualPaneIdentity?: unknown }).__dualPaneIdentity = {
      primaryHost: primary,
      primaryEditor: primary?.liveEditor,
      primaryRoot: primary?.shadowRoot?.querySelector('.ProseMirror'),
      secondaryHost: secondary,
      secondaryEditor: secondary?.liveEditor,
      secondaryRoot: secondary?.shadowRoot?.querySelector('.ProseMirror'),
    }
  })

  // Per-pane collaboration history does not replace either Class-B identity.
  await page.waitForTimeout(700)
  await secondaryEditor.click()
  await page.keyboard.type(' Undo token.')
  await page.waitForTimeout(250)
  await page.keyboard.press(`${primaryModifier}+z`)
  await page.waitForFunction(() => {
    const text = document.querySelector('sh-center-panes')?.shadowRoot
      ?.querySelector('[data-pane-id="center-secondary"] sh-editor-host')?.shadowRoot
      ?.querySelector('.ProseMirror')?.textContent ?? ''
    return text.includes('Beta Chromium path.') && !text.includes('Undo token.')
  })
  await page.keyboard.press(`${primaryModifier}+Shift+z`)
  await page.waitForFunction(() => {
    const text = document.querySelector('sh-center-panes')?.shadowRoot
      ?.querySelector('[data-pane-id="center-secondary"] sh-editor-host')?.shadowRoot
      ?.querySelector('.ProseMirror')?.textContent ?? ''
    return text.includes('Undo token.')
  })

  // Real pointer drag must move physical geometry while both editor roots survive.
  const divider = surface.locator('[data-center-divider]')
  const leftBefore = await primaryPane.boundingBox()
  const rightBefore = await secondaryPane.boundingBox()
  const dividerBox = await divider.boundingBox()
  assert(leftBefore && rightBefore && dividerBox, 'pane geometry was not measurable')
  // Split-view Y-height regression: both panes (and the divider) must fill the
  // surface's FULL height. The grid divider (grid-column: 2) is rendered after
  // the secondary pane (grid-column: 3); without an explicit single row + per-
  // child grid-row: 1, sparse auto-placement pushes the divider into a phantom
  // second row and align-content splits the height ~50/50, collapsing both panes
  // to ~half their allotted vertical space.
  const surfaceBox = await surface.boundingBox()
  assert(surfaceBox, 'center-panes surface geometry was not measurable')
  assert(leftBefore.height >= surfaceBox.height - 4,
    `primary pane fills ${leftBefore.height}px of a ${surfaceBox.height}px surface — split view collapsed to partial height`)
  assert(rightBefore.height >= surfaceBox.height - 4,
    `secondary pane fills ${rightBefore.height}px of a ${surfaceBox.height}px surface — split view collapsed to partial height`)
  assert(dividerBox.height >= surfaceBox.height - 4,
    `divider fills ${dividerBox.height}px of a ${surfaceBox.height}px surface — split view collapsed to partial height`)
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2 + 128, dividerBox.y + dividerBox.height / 2, {
    steps: 8,
  })
  await page.mouse.up()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { dividerPercent: number } } })
      .__centerPanesHarness.state.dividerPercent > 57,
  )
  const leftAfter = await primaryPane.boundingBox()
  const rightAfter = await secondaryPane.boundingBox()
  assert(leftAfter && rightAfter, 'pane geometry disappeared after drag')
  assert(leftAfter.width - leftBefore.width > 100, 'pointer drag did not grow the primary pane')
  assert(rightBefore.width - rightAfter.width > 100, 'pointer drag did not shrink the secondary pane')

  const layoutIdentity = await page.evaluate(() => {
    const scope = window as unknown as { __dualPaneIdentity?: Record<string, unknown> }
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    const secondary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-secondary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    const identity = scope.__dualPaneIdentity
    return Boolean(identity
      && identity.primaryHost === primary
      && identity.primaryEditor === primary?.liveEditor
      && identity.primaryRoot === primary?.shadowRoot?.querySelector('.ProseMirror')
      && identity.secondaryHost === secondary
      && identity.secondaryEditor === secondary?.liveEditor
      && identity.secondaryRoot === secondary?.shadowRoot?.querySelector('.ProseMirror'))
  })
  assert(layoutIdentity, 'divider/history replaced a Class-B host, editor, or ProseMirror root')

  // A real posture control causes a controlled rerender without replacing either host.
  await page.locator('#toggle-posture').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { posture: string } } })
      .__centerPanesHarness.state.posture === 'left-collapsed',
  )
  const postureIdentity = await page.evaluate(() => {
    const scope = window as unknown as { __dualPaneIdentity?: Record<string, unknown> }
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    const secondary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-secondary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: unknown }) | null
    const identity = scope.__dualPaneIdentity
    return Boolean(identity
      && identity.primaryHost === primary
      && identity.primaryEditor === primary?.liveEditor
      && identity.secondaryHost === secondary
      && identity.secondaryEditor === secondary?.liveEditor)
  })
  assert(postureIdentity, 'panel posture replaced a Class-B host or editor')

  // Navigate each pane independently. The stable host remains; only the pane whose
  // document/provider changes rebuilds its inner editor, and the other stays exact.
  await primaryPane.locator('[data-pane-open="center-primary"]').click()
  await page.waitForTimeout(150)
  current = await state(page)
  assert(
    current.panes[0]?.documentId === 'gamma',
    `primary chooser did not open gamma: ${JSON.stringify(await page.evaluate(() => {
      const harness = (window as unknown as { __centerPanesHarness: { state: unknown; events: unknown } }).__centerPanesHarness
      return { state: harness.state, events: harness.events }
    }))}`,
  )
  await primaryPane.locator('sh-editor-host .ProseMirror').waitFor({ state: 'visible' })
  await primaryPane.locator('[data-pane-back="center-primary"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: Array<{ id: string; documentId: string }> } } })
      .__centerPanesHarness.state.panes[0]?.documentId === 'alpha',
  )
  await page.waitForFunction(() => {
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    ) as (HTMLElement & { liveEditor?: { getText(): string } }) | null
    return primary?.liveEditor?.getText().includes('Alpha Chromium path.') === true
  })

  await secondaryPane.locator('[data-pane-open="center-secondary"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: Array<{ id: string; documentId: string }> } } })
      .__centerPanesHarness.state.panes[1]?.documentId === 'delta',
  )
  await secondaryPane.locator('[data-pane-back="center-secondary"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: Array<{ id: string; documentId: string }> } } })
      .__centerPanesHarness.state.panes[1]?.documentId === 'beta',
  )
  current = await state(page)
  assert(current.panes.find((pane) => pane.id === 'center-primary')?.documentId === 'alpha',
    'secondary navigation changed primary history')
  assert(current.panes.find((pane) => pane.id === 'center-secondary')?.documentId === 'beta',
    'secondary history did not round-trip independently')

  const navigationIdentity = await page.evaluate(() => {
    const scope = window as unknown as { __dualPaneIdentity?: Record<string, unknown> }
    const surface = document.querySelector('sh-center-panes')!
    const primary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-primary"] sh-editor-host',
    )
    const secondary = surface.shadowRoot!.querySelector(
      '[data-pane-id="center-secondary"] sh-editor-host',
    )
    return Boolean(scope.__dualPaneIdentity
      && scope.__dualPaneIdentity.primaryHost === primary
      && scope.__dualPaneIdentity.secondaryHost === secondary)
  })
  assert(navigationIdentity, 'document navigation replaced a stable pane host')

  // Close/reopen makes the advertised split command change real topology both ways.
  await secondaryPane.locator('[data-pane-close="center-secondary"]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: unknown[] } } })
      .__centerPanesHarness.state.panes.length === 1,
  )
  current = await state(page)
  assert(!current.split && current.splitCommand.action === 'open' && !current.splitCommand.pressed,
    'close left the split command or topology false')
  await surface.locator('[data-split-command]').click()
  await page.waitForFunction(() =>
    (window as unknown as { __centerPanesHarness: { state: { panes: unknown[] } } })
      .__centerPanesHarness.state.panes.length === 2,
  )
  current = await state(page)
  assert(current.split && current.panes[1]?.id === 'center-secondary',
    'reopen did not reuse the stable secondary pane id')

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)
  assert(requestFailures.length === 0, `request failures:\n${requestFailures.join('\n')}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    realEditors: 2,
    independentBindings: true,
    independentNavigationHistory: true,
    physicalDividerDeltaPx: Number((leftAfter.width - leftBefore.width).toFixed(2)),
    classBIdentityAcrossDividerUndoAndPosture: true,
    stablePaneHostAcrossDocumentRoundTrips: true,
    truthfulSplitOpenCloseReopen: true,
    pageErrors,
    consoleErrors,
    requestFailures,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close().catch(() => undefined)
}
