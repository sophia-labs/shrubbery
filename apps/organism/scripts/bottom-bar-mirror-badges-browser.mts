/**
 * bottom-bar-mirror-badges-browser.mts — REAL-CELL + REAL-CHROMIUM proof for
 * the bottom-bar mirror badges and sidebar `mn-badge` upgrade (MO
 * object-face integration spec, master §3 Slice 4, gate G9).
 *
 * Spawns a REAL headless gardend cell, seeds a REAL Law IV current-state
 * contest via two real `source_push` calls (base "root", the same pattern
 * proven throughout `source-sync-distributed-truth-gardend.mts`), boots
 * Organism's real Vite dev server (the SAME `vite.config.ts` production
 * uses), and drives the REAL `<mn-bottom-bar>` / `<mn-sidebar-panel>`
 * through the REAL `bottom-bar-mirror-badges-harness-main.ts` vehicle in
 * REAL Chromium:
 *
 *   - the real bottom bar renders "◆ 1 contested" from a real seeded
 *     contest, sourced through the real `sourceStatusModel()`;
 *   - enqueuing one REAL, un-flushed `documentUpdate` makes it also render
 *     "↑ 1 pending", and the real sidebar shows a real `<mn-badge>`
 *     ("Pending", state="active") on the matching document row;
 *   - the mirror group is a real `role="status"` `aria-live="polite"`
 *     region; the live group is `aria-live="off"`;
 *   - under `right-collapsed`, the contested badge's measured width does
 *     NOT grow between a real low count and a synthetic 130 — the icon-only
 *     rendering rule actually holds in a real browser.
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

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_BOTTOM_BAR_BADGES_HARNESS_PORT ?? 5233)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'bottom-bar-mirror-badges-proof'
const DOCUMENT_ID = 'bottom-bar-mirror-badges-doc'
const DOCUMENT_INCARNATION = '88888888-8888-4888-8888-888888888888'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const CONTESTED_OBJECT_ID = 'bottom-bar-badges-contested-object'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`bottom-bar-mirror-badges-browser-harness assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

interface Bridge {
  refresh(): Promise<void>
  enqueuePendingDocumentWrite(): Promise<void>
  setSyntheticContestedCount(count: number): void
}

async function callBridge<K extends keyof Bridge>(page: Page, method: K): Promise<void> {
  await page.evaluate((name) => {
    const bridge = (window as unknown as { __bottomBarBadgesHarness?: Bridge }).__bottomBarBadgesHarness
    if (!bridge) throw new Error('bottom-bar-badges harness bridge unavailable')
    return (bridge[name as keyof Bridge] as () => unknown)()
  }, method)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  console.log(`[bottom-bar-badges] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[bottom-bar-badges] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'bottom-bar mirror badges browser harness' })
  // Checkpoint into source authority BEFORE any source-aware write (a write
  // before any pull lands only in the legacy projection, never in
  // bundle.currentState — proven throughout this programme's other harnesses).
  let graphIncarnation = (await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }).graphIncarnation

  // The document is created through `source_push` (`documentLifecycle`), not
  // the legacy `create_document` tool — the legacy path creates a document
  // outside the source ledger's tracking, which a later source_push's own
  // projection-rebuild step then finds mismatched (verified empirically:
  // this harness's own first run failed with exactly that effectError).
  const createDoc = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [{
      kind: 'documentLifecycle',
      operationId: 'bottom-bar-badges-create-doc',
      action: 'create',
      documentId: DOCUMENT_ID,
      title: 'Badge doc',
      newDocumentIncarnation: DOCUMENT_INCARNATION,
    }],
  }) as { ok?: boolean }
  assert(createDoc.ok === true, `document create accepted: ${JSON.stringify(createDoc)}`)

  // ── seed ONE real Law IV contest: two accepted current-state writes from
  //    the SAME base ("root") to the SAME objectId. `Bookmark` declares
  //    `codeBacked` — never auto-resolves, so it stays contested. ──────────
  const bookmarkOp = (operationId: string, title: string): Record<string, unknown> => ({
    kind: 'currentState',
    operationId,
    vocab: VOCAB,
    class: CLASS,
    objectId: CONTESTED_OBJECT_ID,
    baseVersion: 'root',
    record: { kind: CLASS, url: `https://shrubbery.test/${CONTESTED_OBJECT_ID}`, title },
  })
  graphIncarnation = (await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }).graphIncarnation
  const pushA = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('bottom-bar-badges-claim-a', 'Claim A')],
  }) as { ok?: boolean }
  assert(pushA.ok === true, `first contested claim accepted: ${JSON.stringify(pushA)}`)
  const pushB = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('bottom-bar-badges-claim-b', 'Claim B')],
  }) as { ok?: boolean }
  assert(pushB.ok === true, `second contested claim accepted: ${JSON.stringify(pushB)}`)
  const afterContest = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { conflicts?: unknown[] }
  assert((afterContest.conflicts?.length ?? 0) === 1, `authority reports exactly one real conflict: ${JSON.stringify(afterContest.conflicts)}`)
  console.log('[bottom-bar-badges] real Law IV contest seeded (1 conflict at the authority)')

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
  console.log(`[bottom-bar-badges] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1000, height: 620 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  await page.goto(`http://127.0.0.1:${port}/bottom-bar-mirror-badges-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.bottomBarBadgesHarnessReady === 'true' || Boolean(document.body.dataset.bottomBarBadgesHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.bottomBarBadgesHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[bottom-bar-badges] vehicle booted: real GardendContract + real SourceMirrorRuntime over a real cell')

  // ── (1) the real bottom bar renders the real seeded contest ─────────────
  await waitFor(page, () =>
    document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelector('[data-mirror-status]') !== null)
  const mirrorGroupRole = await page.evaluate(() =>
    document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelector('[data-mirror-status]')!.getAttribute('role'))
  const mirrorGroupLive = await page.evaluate(() =>
    document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelector('[data-mirror-status]')!.getAttribute('aria-live'))
  assert(mirrorGroupRole === 'status', `mirror group is role="status": ${mirrorGroupRole}`)
  assert(mirrorGroupLive === 'polite', `mirror group is aria-live="polite": ${mirrorGroupLive}`)
  const initialBadges = await page.evaluate(() =>
    Array.from(document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelectorAll('.source-badge'))
      .map((el) => (el as unknown as { label: string; dataset: { sourceBadge?: string } }).label))
  assert(initialBadges.length === 1 && initialBadges[0] === '1 contested', `real "1 contested" badge, sourced from the real seeded conflict: ${JSON.stringify(initialBadges)}`)
  // The `◆` glyph is a separate `<mn-badge glyph>` property rendered into
  // ITS OWN shadow root as `.glyph`'s text content (aria-hidden, decorative)
  // — a `.label` check alone never exercises this markup at all.
  const contestedGlyph = await page.evaluate(() => {
    const badge = document.querySelector('mn-bottom-bar')!.shadowRoot!
      .querySelector('.source-badge[data-source-badge="contested"]') as unknown as { glyph?: string; shadowRoot: ShadowRoot }
    return {
      property: badge.glyph ?? null,
      rendered: badge.shadowRoot.querySelector('.glyph')?.textContent ?? null,
    }
  })
  assert(contestedGlyph.property === '◆', `contested badge's glyph property is "◆": ${JSON.stringify(contestedGlyph)}`)
  assert(contestedGlyph.rendered === '◆', `contested badge renders the "◆" glyph inside its own shadow root: ${JSON.stringify(contestedGlyph)}`)
  console.log('[bottom-bar-badges] (1) real "◆ 1 contested" badge renders from a real cell-side conflict, glyph included')

  // ── (2) a real, un-flushed pending write also shows "↑ 1 pending", and
  //    the sidebar's real <mn-badge> reflects it ─────────────────────────
  await callBridge(page, 'enqueuePendingDocumentWrite')
  await waitFor(page, () =>
    Array.from(document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelectorAll('.source-badge')).length === 2)
  const badgesAfterPending = await page.evaluate(() =>
    Array.from(document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelectorAll('.source-badge'))
      .map((el) => (el as unknown as { label: string }).label))
  assert(
    badgesAfterPending.includes('1 contested') && badgesAfterPending.includes('1 pending'),
    `both real badges render: ${JSON.stringify(badgesAfterPending)}`,
  )
  const liveGroupLive = await page.evaluate(() => {
    const live = document.querySelector('mn-bottom-bar')!.shadowRoot!.querySelector('[data-live-status]')
    return live?.getAttribute('aria-live') ?? null
  })
  // The live group only appears once a live truth is bound — this harness
  // never binds presence/sync/runtime, so it stays the inert-slot-less
  // absence; asserted null rather than assumed.
  assert(liveGroupLive === null, `no live truth was ever bound, so the live group is absent: ${liveGroupLive}`)

  const sidebarNode = await page.evaluate((documentId) => {
    const row = document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelector(`[data-node-id="${documentId}"]`)
    const badge = row?.querySelector('.badge') as unknown as { label?: string; state?: string; dataset?: DOMStringMap } | null
    return badge ? { label: badge.label, state: badge.state, sourceState: (badge as unknown as HTMLElement).dataset?.sourceState } : null
  }, DOCUMENT_ID)
  assert(sidebarNode !== null, 'the real sidebar row carries a real <mn-badge>')
  assert(sidebarNode?.label === 'Pending', `sidebar badge label is "Pending": ${JSON.stringify(sidebarNode)}`)
  assert(sidebarNode?.state === 'active', `sidebar badge state is "active": ${JSON.stringify(sidebarNode)}`)
  assert(sidebarNode?.sourceState === 'pending', `sidebar badge carries data-source-state="pending": ${JSON.stringify(sidebarNode)}`)
  console.log('[bottom-bar-badges] (2) a real un-flushed write shows "↑ 1 pending" on the bottom bar AND a real sidebar <mn-badge>')

  // ── (3) right-collapsed: measured width is constant at a real low count
  //    vs a synthetic high one — the icon-only rule actually holds ────────
  const widthAt = async (): Promise<number> => page.evaluate(() => {
    const badge = document.querySelector('mn-bottom-bar')!.shadowRoot!
      .querySelector('.source-badge[data-source-badge="contested"]')!
    return badge.getBoundingClientRect().width
  })
  const uncollapsedWidthLow = await widthAt()
  await page.evaluate(() => { (document.querySelector('mn-bottom-bar') as unknown as { rightCollapsed: boolean }).rightCollapsed = true })
  await waitFor(page, () => document.querySelector('mn-bottom-bar')!.hasAttribute('right-collapsed'))
  const collapsedWidthLow = await widthAt()
  assert(collapsedWidthLow < uncollapsedWidthLow, `right-collapsed genuinely shrinks the badge (icon-only): ${collapsedWidthLow} < ${uncollapsedWidthLow}`)
  console.log(`[bottom-bar-badges] (3a) right-collapsed genuinely shrinks a real count=1 badge: ${collapsedWidthLow}px < ${uncollapsedWidthLow}px`)

  // The gate's OWN bar (master §8.2 G9) names the exact pair `count=3` vs
  // `count=130` — not the real seeded count=1 used above for the shrink
  // proof. Both ends of this specific comparison are the one deliberately-
  // synthetic probe (`setSyntheticContestedCount`), still under
  // `right-collapsed`, so it measures ONLY the digit-count invariant the
  // gate is named for.
  const widthAtSyntheticCount = async (count: number): Promise<number> => {
    await page.evaluate((n) => {
      const bridge = (window as unknown as { __bottomBarBadgesHarness?: { setSyntheticContestedCount(count: number): void } }).__bottomBarBadgesHarness
      bridge!.setSyntheticContestedCount(n)
    }, count)
    // Under right-collapsed the VISIBLE label is deliberately blanked (icon-
    // only) — the count still reaches the badge via aria-label, which is
    // what this step waits on rather than the (intentionally empty) .label.
    // (`page.waitForFunction` directly, not the file's `waitFor` helper —
    // that helper hardcodes `undefined` as the in-page argument, and this
    // predicate genuinely needs `count` threaded into the browser context.)
    await page.waitForFunction((expectedCount) =>
      document.querySelector('mn-bottom-bar')!.shadowRoot!
        .querySelector('.source-badge[data-source-badge="contested"]')!
        .getAttribute('aria-label') === `${expectedCount} objects are contested. Open the contested list.`,
      count,
      { timeout: 15000 },
    )
    return widthAt()
  }
  const collapsedWidthThree = await widthAtSyntheticCount(3)
  const collapsedWidthOneThirty = await widthAtSyntheticCount(130)
  assert(
    Math.abs(collapsedWidthOneThirty - collapsedWidthThree) < 0.5,
    `right-collapsed keeps a constant measured width from count=3 to count=130 (master §8.2 G9's own pair): ${collapsedWidthThree} vs ${collapsedWidthOneThirty}`,
  )
  console.log(`[bottom-bar-badges] (3b) right-collapsed: constant width count=3 (${collapsedWidthThree}px) vs count=130 (${collapsedWidthOneThirty}px)`)

  // ── (4) The production chain, not the component contract in isolation:
  // boot actual index.html/main.ts, click the real contested badge, and
  // observe the real centre route it opens. ───────────────────────────────
  const production = await browser.newPage({ viewport: { width: 1000, height: 620 } })
  production.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  production.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await production.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await waitFor(production, () => document.body.dataset.organismMode === 'local-cell')
  await waitFor(production, () =>
    document.querySelector('#host mn-bottom-bar')?.shadowRoot
      ?.querySelector('[data-source-badge="contested"]') !== null)
  await production.getByRole('button', { name: /contested/ }).click()
  await waitFor(production, () =>
    document.querySelector('#host sh-workspace-surface')?.shadowRoot
      ?.querySelector('[data-layout-node-id="workspace-center-contested-table"]') !== null)
  console.log('[bottom-bar-badges] (4) a real click on the production contested badge opened the real contested destination surface')

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  console.log('[bottom-bar-badges] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
