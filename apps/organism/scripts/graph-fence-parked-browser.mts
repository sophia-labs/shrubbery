/**
 * graph-fence-parked-browser.mts — REAL-CELL + REAL-CHROMIUM proof of the
 * fence AND parked-work journey (MO object-face integration spec, master §3
 * Slices 7 and 8, WS3 §4.1/§4.3/§4.6/§10.2, gate G12). Slice 7 built steps
 * 1-5 and 10 (the fence itself); THIS SLICE extends the same script with
 * steps 2b/3b (seed two real documents) and 11-14 (the parked-work face:
 * both documents listed, export round-trips through a real Y.applyUpdate,
 * a cold page reload reconstructs identically from IndexedDB alone, and
 * retention is genuinely user-scoped).
 *
 *   real gardend → real graph → a real, un-flushed graph-scoped write
 *   (WS3 C3's own scenario) → an OUT-OF-BAND (bypassing the browser
 *   entirely — a direct Node fetch against the loopback `/graphs/{id}`
 *   hosted routes, empirically verified against a real running cell)
 *   hard-delete + recreate of the SAME graph id with a DIFFERENT
 *   incarnation → the client's own real `sync()` reaches the real cell and
 *   discovers `stale_graph_incarnation` → the DURABLE fence (master §2.1,
 *   C-D18): `fenced: true`, non-empty `fenceTestimony`, `parked +
 *   nonDocumentParked > 0`, `contestedObjects === 0` (the counts are not
 *   conflated, C2) → the REAL `<mn-lifetime-banner>` renders FB-1 with the
 *   testimony under its disclosure → the REVERSED `rest.graphs()` filter
 *   (WS3 §4.6): the graph stays LISTED (never silently dropped) with a
 *   `lifetime` field once the live catalog is ALSO unreachable → the REAL
 *   `<mn-workspace-selector>` renders the WS-1 "Moved on without you" chip
 *   and the row stays selectable → `adoptNewLife()` (master §3 Slice 7):
 *   the mirror leaves `fenced`, adopts the NEW incarnation, and the parked
 *   row is STILL enumerable via `parkedOperations()` — nothing was
 *   silently forgotten.
 *
 * NO MOCKS anywhere in this proof.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium, webkit, type Page } from 'playwright'
import { createServer } from 'vite'
import * as Y from 'yjs'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_GRAPH_FENCE_PARKED_HARNESS_PORT ?? 5237)
const headed = process.env.SHRUBBERY_HEADED === '1'
// master §3 Slice 9, §8.1/§10.4 — wired into `verify:offline-distributed-
// truth`'s composite (G14) as one of its `runChild` members (both engines).
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT
const browserEngine = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (browserEngine !== 'chromium' && browserEngine !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const browserType = browserEngine === 'webkit' ? webkit : chromium

const GRAPH_ID = 'graph-fence-parked-harness-proof'
const NEW_INCARNATION = '99999999-9999-4999-8999-999999999999'
const RECREATE_OPERATION_ID = 'graph-fence-parked-recreate-op-1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`graph-fence-parked-browser assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

interface MirrorStateSnapshot {
  readonly phase: string
  readonly complete: boolean
  readonly graphIncarnation: string | null
  readonly pending: number
  readonly parked: number
  readonly nonDocumentParked: number
  readonly contestedObjects: number
  readonly fenced: boolean
  readonly fenceTestimony: string | null
  readonly errorCode: string | null
}

interface ParkedWorkModelSnapshot {
  readonly documents: readonly {
    readonly recoveryKey: string
    readonly documentId: string
    readonly joinUnavailable: boolean
  }[]
  readonly looseOperations: readonly { readonly operationId: string; readonly kind: string }[]
  readonly totalOperations: number
}

async function parkedWorkModel(page: Page): Promise<ParkedWorkModelSnapshot> {
  return page.evaluate(async () =>
    (await window.__graphFenceParkedHarness!.loadParkedWorkModel()) as unknown as ParkedWorkModelSnapshot)
}

async function mirrorState(page: Page): Promise<MirrorStateSnapshot> {
  return page.evaluate(() => window.__graphFenceParkedHarness!.mirrorState() as unknown as MirrorStateSnapshot)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  const binarySha256 = createHash('sha256').update(readFileSync(bin)).digest('hex')
  console.log(`[graph-fence-parked] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[graph-fence-parked] cell ready at ${cell.apiUrl}`)

  // The OUT-OF-BAND client — a direct Node connection to the cell, never
  // routed through the browser's `/cell` proxy, so it stays reachable while
  // the browser's own traffic is partitioned below (the same separation
  // `offline-sync-later-gardend-browser.mts`'s own out-of-band MCP writes
  // rely on).
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'graph fence + parked work browser harness' })
  const initialPull = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }
  const originalIncarnation = initialPull.graphIncarnation
  console.log(`[graph-fence-parked] real graph created, incarnation A = ${originalIncarnation}`)

  // master §3 Slice 8 (WS3 §10.2 step 2) — a REAL document this life's
  // graph actually owns, so the browser's own `activateVisible` can reach
  // a genuine `rendered:true` snapshot before the fence.
  await mcp.toolsCall('create_document', {
    graphId: GRAPH_ID,
    documentId: 'parked-doc-rendered',
    title: 'Rendered before the fence',
  })
  console.log('[graph-fence-parked] (2) a real document exists for the "rendered before the fence" seed')

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  console.log(`[graph-fence-parked] Organism listening on ${port}`)

  browser = await browserType.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  // fix(slice-8), R22/G12 step 5b — every real request this page ever
  // issues to the real cell, so a later window can assert "zero new
  // entries" for real rather than merely "the DOM shows no editor".
  const cellRequestLog: string[] = []
  page.on('request', (request) => {
    const parsed = new URL(request.url())
    if (parsed.pathname.startsWith('/cell/')) cellRequestLog.push(`${request.method()} ${parsed.pathname}`)
  })
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    // `route.abort('internetdisconnected')` is THIS script's own partition
    // mechanism, not an app defect — the browser logs the aborted resource
    // load as a console error regardless of which handler aborted it. Every
    // other console error still fails the run.
    if (message.type() === 'error' && !message.text().includes('ERR_INTERNET_DISCONNECTED')) {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  // ── the partition toggle (offline-sync-later-gardend-browser.mts's own
  //    pattern): ONE route handler over `/cell/**`, gated by a mutable flag
  //    this Node process controls directly. ────────────────────────────────
  let partitioned = false
  await page.route(url => url.pathname.startsWith('/cell/'), (route) => (
    partitioned ? route.abort('internetdisconnected') : route.continue()
  ))

  await page.goto(`http://127.0.0.1:${port}/graph-fence-parked-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.graphFenceParkedHarnessReady === 'true' || Boolean(document.body.dataset.graphFenceParkedHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.graphFenceParkedHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[graph-fence-parked] vehicle booted: real GardendContract + real SourceMirrorRuntime over a real cell')

  // ── (1) the fresh mirror is unfenced, complete, at incarnation A ─────────
  const initialState = await mirrorState(page)
  assert(initialState.complete === true, `mirror is complete before any fence: ${JSON.stringify(initialState)}`)
  assert(initialState.fenced === false, `mirror starts unfenced: ${JSON.stringify(initialState)}`)
  assert(initialState.graphIncarnation === originalIncarnation, `mirror holds incarnation A: ${JSON.stringify(initialState)}`)
  console.log('[graph-fence-parked] (1) the real mirror is complete and unfenced at incarnation A')

  // ── (2)/(3) a real, un-flushed graph-scoped write (WS3 C3's own scenario:
  //    this row will NEVER be caught by flush()'s own incarnation filter —
  //    only adoptNewLife() marks it stale) ─────────────────────────────────
  await page.evaluate(() => window.__graphFenceParkedHarness!.enqueueLooseOperation())
  const afterEnqueue = await mirrorState(page)
  assert(afterEnqueue.pending === 1, `the real loose write is durably pending: ${JSON.stringify(afterEnqueue)}`)
  console.log('[graph-fence-parked] (2) a real, un-flushed graph-scoped write is durably pending')

  // ── (2b)/(3b) master §3 Slice 8 (WS3 §10.2 steps 2/3) — two real
  //    documents durable in the real IndexedDB cache with authority
  //    'offline' before the fence: one held by a real ACTIVE binding, one
  //    never opened this session at all. ────────────────────────────────
  const seeded = await page.evaluate(() => window.__graphFenceParkedHarness!.seedParkedDocuments())
  console.log(`[graph-fence-parked] (3) two real offline documents seeded — rendered text: "${seeded.renderedText}"`)

  // ── (4) OUT OF BAND — bypassing the browser entirely — hard-delete then
  //    recreate the SAME graph id with a DIFFERENT incarnation. Partition
  //    the browser FIRST so this mutation happens while it is "offline". ──
  partitioned = true
  const deleteResponse = await fetch(`${cell.apiUrl}/graphs/${GRAPH_ID}?hard=true`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${cell.token}` },
  })
  const deleteBody = await deleteResponse.json() as { readonly status: string }
  assert(deleteResponse.status === 202 && deleteBody.status === 'succeeded', `real out-of-band hard delete succeeded: ${deleteResponse.status} ${JSON.stringify(deleteBody)}`)
  const createResponse = await fetch(`${cell.apiUrl}/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cell.token}` },
    body: JSON.stringify({
      graph_id: GRAPH_ID,
      title: 'graph fence + parked work browser harness (recreated)',
      graph_incarnation: NEW_INCARNATION,
      operation_id: RECREATE_OPERATION_ID,
    }),
  })
  const createBody = await createResponse.json() as { readonly status: string }
  assert(createResponse.status === 202 && createBody.status === 'succeeded', `real out-of-band recreate succeeded: ${createResponse.status} ${JSON.stringify(createBody)}`)
  console.log(`[graph-fence-parked] (4) OUT OF BAND: real hard-delete + recreate — this graph id now lives at incarnation B = ${NEW_INCARNATION}`)

  // ── (5) restore the browser's network and let it discover the fence for
  //    real — a real MCP round trip to a real cell, real 'stale graph
  //    incarnation' response, real Ask-B typed code. ─────────────────────
  partitioned = false
  const syncResult = await page.evaluate(() => window.__graphFenceParkedHarness!.syncAndReportError())
  assert(syncResult.threw === true, `sync() surfaces the real fence as a rejection: ${JSON.stringify(syncResult)}`)
  assert(syncResult.message?.includes('stale graph incarnation') === true, `the rejection names the real authority message: ${syncResult.message}`)
  console.log(`[graph-fence-parked] (5a) sync() reached the real cell and discovered the real fence: ${syncResult.message}`)

  const fencedState = await mirrorState(page)
  assert(fencedState.fenced === true, `state.fenced is durably true: ${JSON.stringify(fencedState)}`)
  assert((fencedState.fenceTestimony ?? '').includes('stale graph incarnation'), `fenceTestimony carries the real authority words: ${fencedState.fenceTestimony}`)
  assert(fencedState.errorCode === 'stale_graph_incarnation', `Ask B's typed code rides the real error: ${fencedState.errorCode}`)
  assert(fencedState.parked + fencedState.nonDocumentParked >= 1, `the loose write is now parked (WS3 C3 closed): ${JSON.stringify(fencedState)}`)
  assert(fencedState.contestedObjects === 0, `contestedObjects and the fence are NOT conflated (C2): ${JSON.stringify(fencedState)}`)
  console.log(`[graph-fence-parked] (5b) the DURABLE fence: fenced=true, parked+nonDocumentParked=${fencedState.parked + fencedState.nonDocumentParked}, contestedObjects=0 — the counts are not conflated`)

  await page.evaluate(() => window.__graphFenceParkedHarness!.refreshBanner())
  await waitFor(page, () => document.querySelector('mn-lifetime-banner')!.shadowRoot!.querySelector('[role="status"]') !== null)
  const bannerHeadline = await page.evaluate(() =>
    document.querySelector('mn-lifetime-banner')!.shadowRoot!.querySelector('strong')?.textContent ?? null)
  assert(bannerHeadline === `${GRAPH_ID} was recreated while you were away.`, `the real banner renders FB-1 for the real graph: ${bannerHeadline}`)
  const bannerTestimony = await page.evaluate(() =>
    document.querySelector('mn-lifetime-banner')!.shadowRoot!.querySelector('.testimony')?.textContent ?? null)
  assert(bannerTestimony?.includes('stale graph incarnation') === true, `the real testimony sits under the disclosure, verbatim: ${bannerTestimony}`)
  assert(bannerHeadline !== null && !bannerHeadline.includes(bannerTestimony ?? ' '), 'the testimony never leaks into the headline (§7.1)')
  console.log('[graph-fence-parked] (5c) the real <mn-lifetime-banner> renders FB-1 with the real testimony under its disclosure')

  // ── the REVERSED rest.graphs() filter (WS3 §4.6): re-partition so the
  //    LIVE catalog is ALSO unreachable — the exact condition under which
  //    the offline fallback (and this slice's own new `lifetime` field)
  //    actually runs. The fence itself is durable data, already established
  //    above; it survives regardless of network state. ────────────────────
  partitioned = true
  const offlineGraphs = await page.evaluate(() => window.__graphFenceParkedHarness!.restGraphs())
  const rows = Array.isArray(offlineGraphs) ? offlineGraphs as readonly Record<string, unknown>[] : []
  const ownRow = rows.find(row => row.graphId === GRAPH_ID)
  assert(ownRow !== undefined, `the fenced graph is LISTED, not silently dropped (Law VI reversed filter): ${JSON.stringify(rows)}`)
  const lifetime = ownRow!.lifetime as { readonly kind?: string; readonly parkedOperations?: number } | null | undefined
  assert(lifetime?.kind === 'moved-on', `the listed row carries an honest lifetime testimony: ${JSON.stringify(ownRow)}`)
  assert((lifetime?.parkedOperations ?? 0) >= 1, `the lifetime testimony names real parked operations: ${JSON.stringify(lifetime)}`)
  console.log(`[graph-fence-parked] (5d) the reversed rest.graphs() filter: the fenced graph stays LISTED with lifetime=${JSON.stringify(lifetime)}`)

  await page.evaluate(() => window.__graphFenceParkedHarness!.refreshSelector())
  await page.waitForFunction(
    (graphId) => document.querySelector('mn-workspace-selector')!.shadowRoot!.querySelector(`[data-graph-id="${graphId}"]`) !== null,
    GRAPH_ID,
    { timeout: 15000 },
  )
  const selectorRow = await page.evaluate((graphId) => {
    const root = document.querySelector('mn-workspace-selector')!.shadowRoot!
    const row = root.querySelector(`[data-graph-id="${graphId}"]`)!
    const button = row.querySelector('.select') as HTMLButtonElement
    return {
      lifetimeText: row.querySelector('.lifetime')?.textContent ?? null,
      dataLifetime: row.getAttribute('data-lifetime'),
      ariaLabel: button.getAttribute('aria-label'),
      disabled: button.disabled,
    }
  }, GRAPH_ID)
  assert(selectorRow.lifetimeText === 'Moved on without you', `the real selector renders WS-1: ${JSON.stringify(selectorRow)}`)
  assert(selectorRow.dataLifetime === 'moved-on', `the row is marked data-lifetime="moved-on": ${JSON.stringify(selectorRow)}`)
  assert(selectorRow.ariaLabel?.includes('Moved on without you') === true, `WS-2's aria-label suffix reaches the real DOM: ${selectorRow.ariaLabel}`)
  assert(selectorRow.disabled === false, `confessing absence means LISTING it, not greying it out — the row stays selectable (D2): ${JSON.stringify(selectorRow)}`)
  console.log('[graph-fence-parked] (5e) the real <mn-workspace-selector> renders the WS-1 chip and keeps the row selectable')

  // ── (10) press "Reload this graph" — adoptNewLife() — and confirm the
  //    fence lifts, the new life is adopted, and the parked record survives
  //    as a real, still-enumerable row (nothing silently forgotten). ──────
  partitioned = false
  await page.evaluate(() => window.__graphFenceParkedHarness!.adoptNewLife())
  const adoptedState = await mirrorState(page)
  assert(adoptedState.fenced === false, `adoptNewLife() clears the fence: ${JSON.stringify(adoptedState)}`)
  assert(adoptedState.graphIncarnation === NEW_INCARNATION, `the mirror now holds incarnation B: ${JSON.stringify(adoptedState)}`)
  const parkedAfterAdopt = await page.evaluate(() => window.__graphFenceParkedHarness!.parkedOperations())
  assert(Array.isArray(parkedAfterAdopt) && parkedAfterAdopt.length >= 1, `the parked record survives adoption, still enumerable: ${JSON.stringify(parkedAfterAdopt)}`)
  assert(
    (parkedAfterAdopt as readonly { readonly graphIncarnation?: string }[]).every(row => row.graphIncarnation === originalIncarnation),
    `the surviving parked row still names the OLD (previous-life) incarnation: ${JSON.stringify(parkedAfterAdopt)}`,
  )
  console.log(`[graph-fence-parked] (10a) adoptNewLife() cleared the fence and adopted incarnation B; ${(parkedAfterAdopt as readonly unknown[]).length} parked record(s) still listed`)

  await page.evaluate(() => window.__graphFenceParkedHarness!.refreshBanner())
  const bannerAfterAdopt = await page.evaluate(() =>
    document.querySelector('mn-lifetime-banner')!.shadowRoot!.querySelector('[role="status"]'))
  assert(bannerAfterAdopt === null, 'the real banner renders NOTHING once the fence has genuinely lifted')
  console.log('[graph-fence-parked] (10b) the real banner confesses nothing is wrong, once nothing is')

  // ── (11) master §3 Slice 8 — the real parked-work join lists BOTH
  //    documents (including the one never rendered this session) and
  //    holds the graph-scoped loose write on its own. ────────────────────
  const model = await parkedWorkModel(page)
  assert(model.documents.length === 2, `both documents are parked: ${JSON.stringify(model.documents)}`)
  const renderedRow = model.documents.find(row => row.documentId === 'parked-doc-rendered')
  const neverRenderedRow = model.documents.find(row => row.documentId === 'parked-doc-never-rendered')
  assert(renderedRow !== undefined, `the actively-bound document is parked: ${JSON.stringify(model.documents)}`)
  assert(neverRenderedRow !== undefined, `the NEVER-RENDERED document is parked too: ${JSON.stringify(model.documents)}`)
  assert(
    model.looseOperations.some(op => op.kind === 'graphMetadata'),
    `the graph-scoped loose write from step (2) is a loose operation, not attached to any document: ${JSON.stringify(model.looseOperations)}`,
  )
  console.log(`[graph-fence-parked] (11) the real parked-work face lists ${model.documents.length} documents (including the never-rendered one) and ${model.looseOperations.length} loose operation(s)`)

  // ── (11b) fix(slice-8), R22/G12 step 5b — the INTEGRATED proof, missing
  //    from Slice 8's own run (that slice's build log records the gap as
  //    Divergence 8 rather than silently claiming it green). Placed here,
  //    after real parked DOCUMENT rows exist (`adoptNewLife()`'s own
  //    re-import is what quarantines them, at this script's step 10 —
  //    they do not exist yet at step 5, where WS3 §10.2's literal step
  //    numbering names "5b"; the SAME kind of dependency-driven reorder
  //    Slice 7/8 already made for "press Reload" ahead of cold-restart/
  //    export). Mounts the REAL `<mn-sidebar-panel>` inside the REAL
  //    `renderWorkspace()` shell, fires a REAL DOM click on a REAL parked
  //    row, and asserts against a REAL Playwright network log — not the
  //    DOM alone — that no document fetch follows. ────────────────────────
  const mounted = await page.evaluate(() => window.__graphFenceParkedHarness!.mountParkedSidebar())
  assert(mounted.recoveryKeys.length === 2, `both parked rows are mounted in the real sidebar: ${JSON.stringify(mounted)}`)
  const clickedRecoveryKey = mounted.recoveryKeys[0]!

  const rowBeforeClick = await page.evaluate((recoveryKey) => {
    const panel = document.querySelector('#parked-sidebar-root mn-sidebar-panel')
    if (!panel) return null
    // `recoveryKey` is `documentActivationKey`'s JSON-array string — it
    // contains quotes and brackets, so it cannot be interpolated into a
    // CSS attribute selector; match by real attribute equality instead.
    const row = Array.from(panel.shadowRoot!.querySelectorAll<HTMLElement>('[data-node-id]'))
      .find(candidate => candidate.getAttribute('data-node-id') === `parked:${recoveryKey}`) ?? null
    return row ? { draggable: row.getAttribute('draggable') } : null
  }, clickedRecoveryKey)
  assert(rowBeforeClick !== null, `the real parked row is in the real sidebar DOM: recoveryKey=${clickedRecoveryKey}`)
  assert(rowBeforeClick!.draggable === 'false', `a parked row reports draggable=false for real (R22): ${JSON.stringify(rowBeforeClick)}`)
  console.log('[graph-fence-parked] (11b-i) the real parked row is mounted and reports draggable="false"')

  // A real `pointerenter`/`pointerleave` pair — `_intentNode`'s readOnly
  // guard (mn-sidebar-panel.ts:1031) must emit nothing for this row.
  let intentEventCount = 0
  await page.exposeFunction('__graphFenceParkedHarnessOnIntent', () => { intentEventCount += 1 })
  await page.evaluate((recoveryKey) => {
    const panel = document.querySelector('#parked-sidebar-root mn-sidebar-panel')!
    panel.addEventListener('mn-sidebar-node-intent', () => {
      (window as unknown as { __graphFenceParkedHarnessOnIntent: () => void }).__graphFenceParkedHarnessOnIntent()
    })
    const row = Array.from(panel.shadowRoot!.querySelectorAll<HTMLElement>('[data-node-id]'))
      .find(candidate => candidate.getAttribute('data-node-id') === `parked:${recoveryKey}`)!
    row.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, composed: true }))
    row.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, composed: true }))
  }, clickedRecoveryKey)
  assert(intentEventCount === 0, `hovering a parked row emits no mn-sidebar-node-intent (R22): got ${intentEventCount}`)
  console.log('[graph-fence-parked] (11b-ii) hovering the real parked row emits no real intent/prefetch event')

  // The real click — real network log measured tightly around it.
  const requestsBeforeClick = cellRequestLog.length
  await page.evaluate((recoveryKey) => {
    const panel = document.querySelector('#parked-sidebar-root mn-sidebar-panel')!
    const row = Array.from(panel.shadowRoot!.querySelectorAll<HTMLElement>('[data-node-id]'))
      .find(candidate => candidate.getAttribute('data-node-id') === `parked:${recoveryKey}`)!
    row.click()
  }, clickedRecoveryKey)
  await page.waitForFunction(
    (recoveryKey) => window.__graphFenceParkedHarness!.parkedSidebarRouteState().openedRecoveryKey === recoveryKey,
    clickedRecoveryKey,
    { timeout: 15000 },
  )
  const routeState = await page.evaluate(() => window.__graphFenceParkedHarness!.parkedSidebarRouteState())
  assert(routeState.openedRecoveryKey === clickedRecoveryKey, `the real click routes by recoveryKey, exactly like main.ts's own openParkedWorkRoute call: ${JSON.stringify(routeState)}`)
  assert(routeState.documentOpenAttempted === null, `the document-open branch (editor mount / document fetch) was NEVER reached for a parked row (R22): ${JSON.stringify(routeState)}`)
  console.log(`[graph-fence-parked] (11b-iii) the real click opens the parked-work route (recoveryKey=${routeState.openedRecoveryKey}) and never reaches the document-open branch`)

  await waitFor(page, () => document.querySelector('#parked-sidebar-root [data-parked-work]') !== null)
  const parkedFaceMarker = await page.evaluate(() => {
    const marker = document.querySelector('#parked-sidebar-root [data-parked-work]')
    return marker ? marker.getAttribute('data-parked-work-graph') : null
  })
  assert(parkedFaceMarker === GRAPH_ID, `the REAL garden.parked-work face genuinely mounted (renderParkedWork's own data-parked-work marker): ${parkedFaceMarker}`)
  // "No editor mounts": this harness never supplies an `editorHost` binding
  // at all (unlike production, which carries one whenever a document was
  // already open), so an `<sh-editor-host>` absence check here would be
  // true regardless of routing and would prove nothing — recorded as a
  // real scope limit, not silently asserted as full coverage. What IS real:
  // `render-workspace.ts:4003-4004`'s own hostSlot ternary is `opts.parkedWork
  // == null ? mountEditorHost(...) : nothing` — structurally exclusive by
  // construction — and `routeState.documentOpenAttempted === null` above
  // already proves the shell-level precondition (`main.ts`'s own branch
  // order) that decides whether `opts.editorHost` is ever populated for
  // this click in the first place.
  const editorHostPresent = await page.evaluate(() =>
    document.querySelector('#parked-sidebar-root sh-editor-host') !== null)
  assert(editorHostPresent === false, `no <sh-editor-host> is in the DOM once the parked-work route is open: ${editorHostPresent}`)
  console.log('[graph-fence-parked] (11b-iv) the real parked-work face is in the DOM (data-parked-work-graph matches) and no <sh-editor-host> exists beside it')

  const newCellRequests = cellRequestLog.slice(requestsBeforeClick)
  assert(newCellRequests.length === 0, `no document fetch (or any /cell/** traffic at all) followed the click, per the REAL Playwright network log, not the DOM alone (R22): ${JSON.stringify(newCellRequests)}`)
  console.log('[graph-fence-parked] (11b-v) the real Playwright network log shows ZERO /cell/** requests following the click — no document fetch was issued')

  // ── (12) export round-trips through a real Y.applyUpdate ────────────────
  const exported = await page.evaluate(recoveryKey =>
    window.__graphFenceParkedHarness!.exportParkedDocument(recoveryKey), renderedRow!.recoveryKey)
  assert(exported.documentId === 'parked-doc-rendered', `export names the right document: ${JSON.stringify(exported)}`)
  const restored = new Y.Doc()
  Y.applyUpdate(restored, Buffer.from(exported.updateBase64, 'base64'))
  const restoredText = restored.getText('body').toString()
  restored.destroy()
  assert(restoredText === seeded.renderedText, `the exported bytes apply into a FRESH Y.Doc and yield the real offline text: got "${restoredText}"`)
  console.log('[graph-fence-parked] (12) export bytes parse and a real Y.applyUpdate yields the real offline text')

  // ── (13) a COLD RESTART — a real page reload, a fresh GardendContract and
  //    a fresh DocumentActivationManager over the SAME IndexedDB — must
  //    reconstruct identically, from durable storage alone. ───────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.graphFenceParkedHarnessReady === 'true' || Boolean(document.body.dataset.graphFenceParkedHarnessError))
  const reloadError = await page.evaluate(() => document.body.dataset.graphFenceParkedHarnessError ?? null)
  assert(!reloadError, `cold restart booted cleanly: ${reloadError}`)
  const modelAfterReload = await parkedWorkModel(page)
  assert(modelAfterReload.documents.length === 2, `cold restart reconstructs both parked documents from IndexedDB alone: ${JSON.stringify(modelAfterReload.documents)}`)
  assert(
    new Set(modelAfterReload.documents.map(row => row.documentId)).has('parked-doc-never-rendered'),
    `the never-rendered document survives a cold restart too: ${JSON.stringify(modelAfterReload.documents)}`,
  )
  console.log('[graph-fence-parked] (13) a cold page reload reconstructs the SAME parked-work model from IndexedDB alone')

  // ── (14) retention is genuinely user-scoped (master §3 Slice 8, D7) ─────
  const otherUserCount = await page.evaluate(() =>
    window.__graphFenceParkedHarness!.userRecoveryCount('a-completely-different-human'))
  assert(otherUserCount === 0, `a different user sees zero parked records: ${otherUserCount}`)
  const retained = await page.evaluate(() => window.__graphFenceParkedHarness!.clearUserRetainingRecoveries())
  assert(retained.countAfter === 2, `clearUser({retainRecoveries:true}) leaves this user's own records intact: ${JSON.stringify(retained)}`)
  console.log(`[graph-fence-parked] (14) retention is real: a different user sees 0, and clearUser({retainRecoveries:true}) leaves this user's ${retained.countAfter} record(s) intact`)

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  // master §3 Slice 9, §10.2/§10.4 — the `SHRUBBERY_DISTRIBUTED_TRUTH_REPORT`
  // + sha256-pinned `provenance.gardend` JSON shape, wired now that this
  // script is one of `verify:offline-distributed-truth`'s `runChild`
  // members (G14). Independently runnable regardless — `verdict: GO` on
  // stdout below either way.
  const report = {
    ok: true,
    verdict: 'GO',
    scope: `graph-lifetime fence visibility + parked-work enumeration/export/retention/reapply-routing (engine: ${browserEngine})`,
    evidence: {
      fenceVisibility: {
        bannerPresent: bannerHeadline !== null,
        testimonyVerbatim: bannerTestimony?.includes('stale graph incarnation') === true,
        selectorRetainsGraph: selectorRow.disabled === false,
        finding: 'a real out-of-band recreate is discovered as a durable fence; the fenced graph stays LISTED (never silently dropped) and the real banner/selector render its testimony',
      },
      parkedEnumeration: {
        documents: model.documents.length,
        neverRenderedPreserved: neverRenderedRow !== undefined,
        looseOperations: model.looseOperations.length,
        coldRestartIdentical: modelAfterReload.documents.length === model.documents.length,
        sidebarRoutingProven: routeState.openedRecoveryKey !== null && routeState.documentOpenAttempted === null,
        finding: 'the real parked-work join lists every document (including one never rendered this session) and every graph-scoped loose operation; a cold restart reconstructs identically; a real parked sidebar click routes to the parked-work face and never attempts a document open (R22)',
      },
      retention: {
        survivesLogout: retained.countAfter === 2,
        userScoped: otherUserCount === 0,
        finding: 'clearUser({retainRecoveries:true}) leaves this user\'s own records intact; a different user sees zero',
      },
      export: {
        roundTrips: restoredText === seeded.renderedText,
        finding: 'the exported bytes apply into a fresh Y.Doc and yield the real offline text',
      },
    },
    provenance: { gardend: { path: bin, sha256: binarySha256 } },
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  console.log('[graph-fence-parked] verdict: GO')
  console.log('[graph-fence-parked] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
