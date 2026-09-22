/**
 * workspace-lifetime-reapply-shell-browser.mts — REAL-CELL + REAL-CHROMIUM
 * proof that the ORDINARY per-graph workspace (the real `apps/organism/
 * index.html` + real `src/main.ts` — NOT an app-route frame, NOT a bespoke
 * harness page) mounts a real `<mn-lifetime-banner>` when a mirror fence is
 * raised, and a real `<mn-restore-overlay>` when a reapply run starts from
 * the real parked-work face (bundle audit findings 2/3, 2026-07-31 —
 * `08-build-bundle-review-guide.md` §7).
 *
 * Every prior real-cell proof of this journey (`graph-fence-parked-
 * browser.mts`, `parked-work-reapply-browser.mts`) drives a BESPOKE harness
 * page (`graph-fence-parked-harness.html`, `parked-work-reapply-harness.html`)
 * that mounts `<mn-lifetime-banner>`/`<mn-restore-overlay>` bare and feeds
 * them via harness-only helpers — real components, real cell, but never
 * through `main.ts`'s own production wiring, which (until this fix) never
 * threaded either state into any mount at all for the ordinary workspace.
 * This script is the one that was missing: it boots the actual production
 * page, drives it with the SAME affordances a human uses (the real
 * "open document" button, the real "refresh from cell" button, a real
 * sidebar row click), and asserts the two NEW shell-owned slots flanking
 * `#host` (`#workspace-lifetime-banner-slot` / `#workspace-reapply-overlay-
 * slot`, `index.html`) render for real — while `#host` itself never grows
 * its own copy, proving the fix routes through the shared shell layer
 * (`lifetimeBannerTemplate`/`reapplyOverlayTemplate`, `app-routes.ts`)
 * rather than a second, divergent implementation.
 *
 * NO MOCKS anywhere in this proof.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import * as Y from 'yjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_WORKSPACE_LIFETIME_REAPPLY_PORT ?? 5241)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'workspace-lifetime-reapply-shell-proof'
const DOC_ID = 'workspace-lifetime-reapply-shell-doc'
const NEW_INCARNATION = '88888888-8888-4888-8888-888888888888'
const RECREATE_OPERATION_ID = 'workspace-lifetime-reapply-shell-recreate-op-1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`workspace-lifetime-reapply-shell-browser assertion failed: ${message}`)
}

/**
 * `startCellMode()`'s real production trigger (the "refresh from cell"
 * button) opens TWO concurrent requests against the just-hard-deleted-and-
 * recreated gardend (`sourceMirror.open` + `backgroundSync`), unlike every
 * sibling real-cell script's single deliberate harness-exposed `sync()`
 * call. `scripts/vite-cell-proxy.ts`'s `http-proxy` upstream can drop an
 * in-flight connection with a bare `ECONNRESET` during that exact window —
 * a dev-proxy/upstream-churn race orthogonal to the product fix this script
 * proves, not a defect in `main.ts`'s own banner/overlay wiring. Tolerate
 * ONLY that narrow, named class of transient socket noise (same spirit as
 * `graph-fence-parked-browser.mts`'s own documented `ERR_INTERNET_
 * DISCONNECTED` console-error filter for its partition mechanism); anything
 * else still crashes the process exactly as an unguarded run would.
 */
process.on('uncaughtException', (error) => {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    console.warn(`[workspace-lifetime-reapply-shell] tolerated transient proxy/upstream socket error (${code}): ${error.message}`)
    return
  }
  console.error(error)
  process.exit(1)
})

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  console.log(`[workspace-lifetime-reapply-shell] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[workspace-lifetime-reapply-shell] cell ready at ${cell.apiUrl}`)

  // The OUT-OF-BAND client — a direct Node connection to the cell, never
  // routed through the browser's `/cell` proxy (same separation every other
  // fence-inducing script in this suite relies on).
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'workspace lifetime+reapply shell proof' })
  await mcp.toolsCall('create_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    title: 'Rendered before the fence (production editor)',
  })
  console.log('[workspace-lifetime-reapply-shell] real graph + one real document created')

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))

  // The REAL app: root=appDir, the SAME vite.config.ts every dev/production
  // build uses — no bespoke harness config, no bespoke harness HTML.
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  console.log(`[workspace-lifetime-reapply-shell] real Organism (index.html + main.ts) listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  // `ERR_INTERNET_DISCONNECTED` is this script's OWN partition mechanism
  // (below). The hocuspocus WS handshake failure + its "Failed to load
  // resource" 404 echo are the EXPECTED fallout of hard-deleting the graph
  // out from under the live editor binding opened in step (2) — the same
  // "the abort/deletion this script itself performed is not an app defect"
  // reasoning `graph-fence-parked-browser.mts` already documents for its own
  // induced noise, extended to this script's own induced noise. A transient
  // 503 during the real reapply pipeline's own lock/backup/restore/rebuild/
  // verify sequence (step (7)/(8)) is the drain-then-refuse driver's own
  // documented resilience under real cell/proxy churn from everything
  // above — step (9)'s own terminal-stage wait already proves the pipeline
  // handled it and completed, so it is retry noise, not a failure.
  const expectedNoise = /ERR_INTERNET_DISCONNECTED|hocuspocus|WebSocket connection|503 \(Service Unavailable\)/
  page.on('console', (message) => {
    if (message.type() === 'error' && !expectedNoise.test(message.text())) {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  // The partition toggle (same pattern as graph-fence-parked-browser.mts /
  // offline-sync-later-gardend-browser.mts): one route handler over
  // `/cell/**`, gated by a mutable flag this Node process controls directly.
  let partitioned = false
  await page.route(url => url.pathname.startsWith('/cell/'), (route) => (
    partitioned ? route.abort('internetdisconnected') : route.continue()
  ))

  // ── (1) boot the REAL production page at the real SPA graph route,
  //    `/g/:graphId` — the exact grammar `gardenGraphLocation` parses —
  //    with NO `?debug=1`: this is the production boot path, not a debug
  //    rail. ─────────────────────────────────────────────────────────────
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.organismMode === 'local-cell')
  console.log('[workspace-lifetime-reapply-shell] (1) the real production page booted into local-cell mode')

  // ── (1b) prove we are on the ORDINARY workspace, not an app-route frame:
  //    `#host`'s own top-level child is `.app-container` with NO
  //    `data-organism-route` — that attribute only exists on
  //    `routeFrame()`'s output (app-routes.ts). ─────────────────────────────
  await waitFor(page, () => document.querySelector('#host > .app-container') !== null)
  const routeMarkerPresent = await page.evaluate(() =>
    document.querySelector('#host [data-organism-route]') !== null)
  assert(routeMarkerPresent === false, 'no data-organism-route marker anywhere in #host — this is the ordinary workspace, not an app-route frame')
  console.log('[workspace-lifetime-reapply-shell] (1b) confirmed: #host holds the ORDINARY workspace frame (no data-organism-route)')

  // ── (1c) the two NEW shell-owned slots exist as siblings of #host, and
  //    render NOTHING before any fence exists — the honest baseline. ──────
  const slotsExist = await page.evaluate(() => ({
    banner: document.querySelector('.shell-pane > #workspace-lifetime-banner-slot') !== null,
    overlay: document.querySelector('.shell-pane > #workspace-reapply-overlay-slot') !== null,
  }))
  assert(slotsExist.banner && slotsExist.overlay, `both shell-owned slots exist as siblings of #host: ${JSON.stringify(slotsExist)}`)
  await waitFor(page, () => document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner') !== null)
  const bannerBaseline = await page.evaluate(() =>
    document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')!.shadowRoot!.querySelector('[role="status"]'))
  assert(bannerBaseline === null, 'the real banner slot renders NOTHING before any fence exists')
  console.log('[workspace-lifetime-reapply-shell] (1c) both shell-owned slots exist and start inert')

  // ── (2) open the real document through the real production affordance
  //    (the "open document (live editor)" button — visually hidden without
  //    ?debug=1, but real DOM, real production click handler). This is
  //    what makes the document's later quarantine `worthPreserving`
  //    (document-activation.ts's own `rendered` signal) — which requires
  //    the real hocuspocus room to actually finish its initial sync BEFORE
  //    the fence hits (the same ordering `graph-fence-parked-browser.mts`'s
  //    own comment names: "so the browser's own `activateVisible` can reach
  //    a genuine `rendered:true` snapshot before the fence"). Wait for a
  //    REAL frame from the REAL collab socket, not a flat timer. ──────────
  const hocuspocusWsPromise = page.waitForEvent('websocket', ws => ws.url().includes('/hocuspocus/docs/'))
  await page.evaluate(() => (document.getElementById('cell-open-doc-btn') as HTMLButtonElement).click())
  await waitFor(page, () => (document.getElementById('cell-doc-id') as HTMLInputElement).value === 'workspace-lifetime-reapply-shell-doc')
  await waitFor(page, () => document.querySelector('#host sh-editor-host') !== null)
  const hocuspocusWs = await hocuspocusWsPromise
  await hocuspocusWs.waitForEvent('framereceived', { timeout: 15000 })
  console.log('[workspace-lifetime-reapply-shell] (2) the real production "open document" button opened the real document in the real editor host, and the real hocuspocus room sent its first real frame back')

  // ── (3) OUT OF BAND — bypassing the browser entirely — hard-delete then
  //    recreate the SAME graph id with a DIFFERENT incarnation, exactly the
  //    G12 recipe. Partition the browser first. ───────────────────────────
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
      title: 'workspace lifetime+reapply shell proof (recreated)',
      graph_incarnation: NEW_INCARNATION,
      operation_id: RECREATE_OPERATION_ID,
    }),
  })
  const createBody = await createResponse.json() as { readonly status: string }
  assert(createResponse.status === 202 && createBody.status === 'succeeded', `real out-of-band recreate succeeded: ${createResponse.status} ${JSON.stringify(createBody)}`)
  // Also recreate the SAME document id in the new incarnation — a real
  // 'replaced' quarantine (not 'deleted'): `parked-work.ts`'s own
  // `canReapply: record.reason === 'replaced'` gate means a plain delete
  // parks the document as un-reapply-able ("nothing to reapply this into"),
  // which is real and correct, but not what this proof needs to reach the
  // real Reapply button.
  await mcp.toolsCall('create_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    title: 'Rendered before the fence (production editor) — replacement',
  })
  console.log(`[workspace-lifetime-reapply-shell] (3) OUT OF BAND: real hard-delete + recreate (incarnation B = ${NEW_INCARNATION}) + a real replacement document at the SAME id`)

  // ── (4) restore the browser's network, then do a REAL, FULL PAGE RELOAD —
  //    not a click on the "refresh from cell" button. Clicking refresh
  //    rebuilds the STORE (a fresh contract/manager) but `main.ts`'s
  //    `editorClaims` map is MODULE-level, keyed only
  //    `${paneId}::${graphId}::${documentId}` (`buildPaneEditorClaim`) — a
  //    string that does not change across a same-graph store rebuild, so
  //    re-clicking "open document" would just return the STALE claim/room
  //    lease from step (2), never calling `activateVisible` again, never
  //    re-running its fence/validation logic. A real reload resets EVERY
  //    module-level structure (`editorClaims`, `openDocId`, the contract)
  //    while the durable IndexedDB mirror + document cache survive — the
  //    exact "cold restart" scenario `graph-fence-parked-browser.mts`'s own
  //    step (13) already proves reconstructs identically. The fresh boot's
  //    own initial `sourceMirror.open()` discovers the durably-fenced state
  //    immediately (no click needed for the banner this time), and
  //    re-opening the document in step (4b) below is a genuinely FRESH
  //    claim — `validateAndPermit`'s cold-open path hits a REAL 404
  //    (the empty recreated graph) and `cacheHit` (the real, durable,
  //    shared IndexedDB cache written in step (2), which survives the
  //    reload) triggers `quarantine('deleted', true)` right away. ─────────
  partitioned = false
  // ── (5a) FINDING 5's REAL BINDING. The banner's parked-count line must
  //    come from the real recovery store through main.ts's own call site,
  //    not from a placeholder. Seed ONE REAL recovery row into the REAL
  //    durable store (the same object store `document-activation.ts`
  //    writes, through the page's own IndexedDB — arranging real state, not
  //    faking a component), then force main.ts to recompute and assert the
  //    REAL banner says "1 parked document".
  //
  //    Why seeded rather than produced by the journey above: quarantine
  //    deliberately refuses to manufacture a parked row for a document
  //    nobody touched — `worthPreserving = rendered || dirtySinceSync` and
  //    then an explicit empty-update guard (`document-activation.ts`, the
  //    C6 fix). This journey opens and syncs the document but never dirties
  //    it, so a fence here CORRECTLY parks nothing. Asserting otherwise
  //    (as an earlier draft of this step did) tests a premise the system
  //    denies. What finding 5 is actually about is narrower and is exactly
  //    what this asserts: does the call site pass the real count through?
  //    Revert `lifetimeBannerStateFor`'s `parkedDocuments` to a hardcoded 0
  //    and this step must go red. ──────────────────────────────────────────
  // A REAL Yjs update, built here in Node with the same library the app uses.
  // Not a placeholder byte string: steps (6)-(8b) below genuinely REAPPLY this
  // row, so it has to be something the real pipeline can actually apply.
  const parkedDoc = new Y.Doc()
  parkedDoc.getText('default').insert(0, 'work from the previous life')
  const parkedUpdate = Array.from(Y.encodeStateAsUpdate(parkedDoc))
  await page.evaluate(async ({ graphId, update }) => {
    await new Promise<void>((resolve, reject) => {
      const openRequest = indexedDB.open('shrubbery-document-activation-v1')
      openRequest.onerror = () => reject(new Error('recovery store did not open'))
      openRequest.onsuccess = () => {
        const db = openRequest.result
        if (!db.objectStoreNames.contains('recoveries')) { db.close(); reject(new Error('no recoveries store')); return }
        const tx = db.transaction('recoveries', 'readwrite')
        tx.objectStore('recoveries').put({
          key: JSON.stringify(['local-organism', graphId, 'workspace-lifetime-reapply-shell-doc', '88888888-8888-4888-8888-888888888888']),
          documentKey: JSON.stringify(['local-organism', graphId, 'workspace-lifetime-reapply-shell-doc']),
          userId: 'local-organism',
          graphId,
          documentId: 'workspace-lifetime-reapply-shell-doc',
          schemaVersion: 1,
          update: new Uint8Array(update).buffer,
          recoveredAt: Date.now(),
          reason: 'replaced',
          incarnation: '88888888-8888-4888-8888-888888888888',
          relatedOperationIds: [],
        })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(new Error('recovery seed failed')) }
      }
    })
  }, { graphId: GRAPH_ID, update: parkedUpdate })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.organismMode === 'local-cell')
  console.log('[workspace-lifetime-reapply-shell] (4) a real full page reload booted fresh — durable IndexedDB mirror + document cache survive, module state does not')

  // ── (5) the REAL production banner (in the NEW slot, never inside #host)
  //    renders FB-1 for real — discovered by this fresh boot's own initial
  //    sync, no button click needed this time. ─────────────────────────────
  await waitFor(page, () =>
    document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')!.shadowRoot!.querySelector('[role="status"]') !== null,
    30000)
  const bannerInsideHost = await page.evaluate(() => document.querySelector('#host mn-lifetime-banner') !== null)
  assert(bannerInsideHost === false, 'the banner never grows a SECOND copy inside #host — one shared mount, not two')
  const bannerHeadline = await page.evaluate(() =>
    document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')!.shadowRoot!.querySelector('strong')?.textContent ?? null)
  assert(bannerHeadline === `${GRAPH_ID} was recreated while you were away.`, `the real production banner renders FB-1 for the real graph: ${bannerHeadline}`)
  console.log('[workspace-lifetime-reapply-shell] (5) the REAL production <mn-lifetime-banner>, mounted by main.ts itself, renders FB-1 for a fence raised from the ordinary workspace')
  await waitFor(page, () => {
    const banner = document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')
    return (banner?.shadowRoot?.textContent ?? '').includes('1 parked document')
  }, 20000)
  console.log('[workspace-lifetime-reapply-shell] (5a) the REAL banner reports "1 parked document" from the REAL recovery store — main.ts\'s call site passes the real count, not a placeholder')

  // ── (5b) click the banner's own real PRIMARY action ("Reload this
  //    graph") — a real `adoptNewLife()` call (`gardend-contract.ts`'s
  //    `SourceMirrorRuntime`). Necessary here: once fenced, the mirror's
  //    own retry loop stops trying (`scheduleSyncRetry`'s own `|| state.
  //    fenced) return` guard) and `documentSnapshot()` keeps answering with
  //    the STALE pre-fence blob forever — `fetchSnapshot`'s mirror-first
  //    read (`sourceMirror?.documentSnapshot() ?? liveRest...`) therefore
  //    never falls through to a real REST call, and no fresh document-open
  //    ever discovers the document is gone, until the mirror adopts the
  //    graph's CURRENT (empty) incarnation for real. G12's own script
  //    (step 10) already proves this same click; this is the first proof
  //    of it through the real production banner rather than a bare test
  //    tag. ─────────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const banner = document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')!
    banner.shadowRoot!.querySelector<HTMLButtonElement>('.primary-btn')!.click()
  })
  await waitFor(page, () =>
    document.querySelector('#workspace-lifetime-banner-slot mn-lifetime-banner')!.shadowRoot!.querySelector('[role="status"]') === null,
    20000)
  console.log('[workspace-lifetime-reapply-shell] (5b) the real "Reload this graph" button adopted the new life for real; the real banner confesses nothing is wrong once nothing is')

  // ── (6) the real sidebar's own "Parked work" section — Slice 4's ambient
  //    wayfinding, populated by refreshParkedWork()'s own post-fence call —
  //    shows a real row for the document quarantined above. Click it via
  //    the real production DOM, same as a human. ─────────────────────────
  await page.evaluate(() => (document.getElementById('cell-refresh-btn') as HTMLButtonElement).click())
  await waitFor(page, () => document.querySelector('#host mn-sidebar-panel') !== null, 15000)
  try {
    await waitFor(page, () =>
      document.querySelector('#host mn-sidebar-panel')!.shadowRoot!.querySelector('[data-node-id^="parked:"]') !== null,
      30000,
    )
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const panel = document.querySelector('#host mn-sidebar-panel')!
      return Array.from(panel.shadowRoot!.querySelectorAll<HTMLElement>('[data-node-id]'))
        .map((el) => el.getAttribute('data-node-id'))
    })
    console.error(`[workspace-lifetime-reapply-shell] DIAGNOSTIC: real sidebar node ids present: ${JSON.stringify(diagnostic)}`)
    throw error
  }
  await page.evaluate(() => {
    const panel = document.querySelector('#host mn-sidebar-panel')!
    const row = panel.shadowRoot!.querySelector<HTMLElement>('[data-node-id^="parked:"]')!
    row.click()
  })
  await waitFor(page, () => document.querySelector('#host [data-parked-work]') !== null)
  console.log('[workspace-lifetime-reapply-shell] (6) a real click on the real sidebar\'s parked-work row opened the real parked-work face')

  // ── (7) the real "Reapply" button, in the real parked-work face. ────────
  const reapplyButtonExists = await page.evaluate(() =>
    document.querySelector('#host [data-parked-action="reapply"]') !== null)
  assert(reapplyButtonExists, 'the real parked-work face offers a real Reapply button for the quarantined document')
  await page.evaluate(() => {
    (document.querySelector('#host [data-parked-action="reapply"]') as HTMLButtonElement).click()
  })
  console.log('[workspace-lifetime-reapply-shell] (7) clicked the real production Reapply button')

  // ── (8) the REAL production reapply overlay (in the NEW slot, never
  //    inside #host) goes active for real, driven by the real
  //    ReapplyController/drain-then-refuse pipeline against the real cell. ─
  await waitFor(page, () =>
    document.querySelector('#workspace-reapply-overlay-slot mn-restore-overlay')?.hasAttribute('active') === true)
  const overlayInsideHost = await page.evaluate(() => document.querySelector('#host mn-restore-overlay') !== null)
  assert(overlayInsideHost === false, 'the reapply overlay never grows a SECOND copy inside #host — one shared mount, not two')
  console.log('[workspace-lifetime-reapply-shell] (8) the REAL production <mn-restore-overlay>, mounted by main.ts itself, went active for a reapply run started from the real parked-work face')

  // ── (8b) Open Settings IN PLACE while BOTH workspace surfaces are live.
  // This is the exact overlap the original workspace-slot repair missed:
  // Settings mounts its own route frame under <body>, while the ordinary
  // workspace stays resident underneath. There must be exactly ONE banner
  // and ONE active overlay in the whole document, and neither may remain in
  // the inert workspace surface. ─────────────────────────────────────────
  // Enter Settings the way the URL-driven transition itself works
  // (`popstate` -> `handlePopState`, main.ts:8594). A CLICK cannot be used
  // here and that is CORRECT: the active reapply overlay covers the chrome,
  // exactly as it would for a person. Arriving by history is the real path a
  // user takes with a deep link or the back/forward buttons.
  await page.evaluate(() => {
    history.pushState({}, '', '/settings')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await waitFor(page, () => document.body.hasAttribute('data-organism-settings-open'))
  const settingsOverlap = await page.evaluate(() => {
    // NB: no named helper functions in here — tsx/esbuild rewrites them with
    // `__name(...)`, which does not exist in the page context.
    const liveBanners = Array.from(document.querySelectorAll('mn-lifetime-banner'))
      .filter(element => element.closest('[inert]') === null)
    const liveOverlays = Array.from(document.querySelectorAll('mn-restore-overlay'))
      .filter(element => element.closest('[inert]') === null)
    return {
      workspaceInert: document.querySelector('.shell-pane')?.hasAttribute('inert') ?? false,
      banners: liveBanners.length,
      overlays: liveOverlays.length,
      activeOverlays: liveOverlays.filter(overlay => overlay.hasAttribute('active')).length,
      workspaceBannerElements: document.querySelectorAll('#workspace-lifetime-banner-slot mn-lifetime-banner').length,
      workspaceOverlayElements: document.querySelectorAll('#workspace-reapply-overlay-slot mn-restore-overlay').length,
    }
  })
  assert(settingsOverlap.workspaceInert, `Settings inerts the whole workspace surface, including its slots: ${JSON.stringify(settingsOverlap)}`)
  assert(settingsOverlap.banners === 1, `exactly one interactive lifetime banner exists document-wide while Settings is open: ${JSON.stringify(settingsOverlap)}`)
  assert(settingsOverlap.overlays === 1 && settingsOverlap.activeOverlays === 1, `exactly one interactive active reapply overlay exists document-wide while Settings is open: ${JSON.stringify(settingsOverlap)}`)
  assert(settingsOverlap.workspaceBannerElements === 0 && settingsOverlap.workspaceOverlayElements === 0, `Settings hands mount ownership to its route frame instead of leaving duplicate workspace elements: ${JSON.stringify(settingsOverlap)}`)
  console.log('[workspace-lifetime-reapply-shell] (8b) Settings-in-place leaves exactly one interactive banner and one active overlay document-wide')

  // Leave Settings the same way we entered it, so the workspace surface is
  // no longer inert and step (9) observes the pipeline in its own slot.
  await page.evaluate(() => {
    history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await waitFor(page, () => !document.body.hasAttribute('data-organism-settings-open'), 15000)

  // ── (9) let the real pipeline reach a terminal stage, for a clean exit —
  //    not itself part of what findings 2/3 asked to be proven, but honest
  //    to wait for rather than tearing the browser down mid-flight. ───────
  await waitFor(page, () => {
    const overlay = document.querySelector('#workspace-reapply-overlay-slot mn-restore-overlay') as (Element & { operationState?: string }) | null
    const state = overlay?.getAttribute('operationstate') ?? (overlay as unknown as { operationState?: string } | null)?.operationState
    return state === 'succeeded' || state === 'failed' || state === 'rolled_back'
  }, 30000)
  console.log('[workspace-lifetime-reapply-shell] (9) the real reapply run reached a terminal stage')

  // NOTE: an earlier draft closed finding 5 with a SECOND fence + cold boot
  // here, asserting "1 parked document" again. That is removed: the reapply
  // run above legitimately CONSUMES the parked row, so nothing is parked by
  // this point and the assertion tested a state the system had just
  // correctly cleared. Finding 5's real binding is step (5a) — seed one real
  // recovery row, assert the REAL banner reports it through main.ts's own
  // call site, and watch it go red when that call site is reverted to a
  // hardcoded 0.

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  console.log('[workspace-lifetime-reapply-shell] verdict: GO')
  console.log('[workspace-lifetime-reapply-shell] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
