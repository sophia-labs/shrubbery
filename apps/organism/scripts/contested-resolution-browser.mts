/**
 * contested-resolution-browser.mts — REAL-CELL + REAL-CHROMIUM proof of the
 * FULL resolution journey (MO object-face integration spec, master §3
 * Slice 6, WS2 §6.6-6.7, gate G11):
 *
 *   seed a real Law IV contest → real row activation → card.object mounts
 *   (contested) → the card's "Compose a merged value…" affordance opens the
 *   REAL `<mn-context-menu>` → a flattened `keep:{operationId}` entry opens
 *   the REAL `<mn-confirmation-dialog>` ("choose") → `mn-confirm` runs
 *   `resolveCurrent()` with `loading` VISIBLE while the dialog is STILL
 *   MOUNTED → the outbox row is `'pending'` the instant the dialog hides →
 *   `'applied'` once the real cell's receipt lands → the object is STILL
 *   contested in this epoch (the non-optimistic window: `awaitingEpoch`
 *   names the conflict) → only the NEXT real pull clears it (`resolving`
 *   and `awaitingEpoch` both empty, `contestedObjects` drops to 0).
 *
 *   T-R4 (digest binding byte-check): the enqueue→push round trip against
 *   the REAL cell never throws "does not match the durable operation" —
 *   the client's `buildResolveCurrentOperation` normalizer byte-matches
 *   Garden's own `serde_json` output.
 *
 *   Cold-reload mid-flight: a SECOND, freshly-opened `SourceMirrorRuntime`
 *   over the SAME IndexedDB sees the SAME durable `resolveCurrent` row —
 *   the intent survives a reload.
 *
 * NO MOCKS anywhere in this proof.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_CONTESTED_RESOLUTION_HARNESS_PORT ?? 5236)
const headed = process.env.SHRUBBERY_HEADED === '1'
// master §3 Slice 9, §8.1/§10.4 — wired into `verify:offline-distributed-
// truth`'s composite (G14) as one of its `runChild` members.
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT

const GRAPH_ID = 'contested-resolution-harness-proof'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'contested-resolution-object'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`contested-resolution-browser assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  const binarySha256 = createHash('sha256').update(readFileSync(bin)).digest('hex')
  console.log(`[contested-resolution] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[contested-resolution] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'contested resolution browser harness' })
  let graphIncarnation = (await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }).graphIncarnation

  // A real document — the SAME reason `contested-query-service-browser.mts`
  // seeds one: `surfaceQueryService`'s offline engine cannot decode a
  // workspace Y.Doc that was never committed to at all.
  const createDoc = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [{
      kind: 'documentLifecycle',
      operationId: 'contested-resolution-create-doc',
      action: 'create',
      documentId: 'contested-resolution-doc',
      title: 'Contested resolution harness doc',
      newDocumentIncarnation: '88888888-8888-4888-8888-888888888888',
    }],
  }) as { ok?: boolean }
  assert(createDoc.ok === true, `document create accepted: ${JSON.stringify(createDoc)}`)
  graphIncarnation = (await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }).graphIncarnation

  const bookmarkOp = (operationId: string, title: string, clientId: string): Record<string, unknown> => ({
    kind: 'currentState',
    operationId,
    vocab: VOCAB,
    class: CLASS,
    objectId: OBJECT_ID,
    baseVersion: 'root',
    record: { kind: CLASS, url: `https://shrubbery.test/${OBJECT_ID}`, title },
    clientId,
  })
  const pushA = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('contested-resolution-claim-a', 'Claim A', 'device-a')],
  }) as { ok?: boolean }
  assert(pushA.ok === true, `first contested claim accepted: ${JSON.stringify(pushA)}`)
  const pushB = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('contested-resolution-claim-b', 'Claim B', 'device-b')],
  }) as { ok?: boolean }
  assert(pushB.ok === true, `second contested claim accepted: ${JSON.stringify(pushB)}`)
  const afterContest = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as {
    conflicts?: ReadonlyArray<{ readonly conflictId?: string; readonly candidates?: readonly unknown[] }>
  }
  assert((afterContest.conflicts?.length ?? 0) === 1, `authority reports exactly one real conflict: ${JSON.stringify(afterContest.conflicts)}`)
  const seededCandidates = afterContest.conflicts![0]!.candidates as ReadonlyArray<{ readonly operationId?: string }> ?? []
  assert(seededCandidates.length === 2, `the real conflict has two real candidates: ${seededCandidates.length}`)
  const keptOperationId = seededCandidates[0]!.operationId!
  console.log(`[contested-resolution] real Law IV contest seeded (2 candidates; keeping ${keptOperationId})`)

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
  console.log(`[contested-resolution] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1300, height: 780 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  await page.goto(`http://127.0.0.1:${port}/contested-resolution-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.contestedResolutionHarnessReady === 'true' || Boolean(document.body.dataset.contestedResolutionHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.contestedResolutionHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[contested-resolution] vehicle booted: the full production resolution journey, real cell')

  // ── (1) row activation → card.object mounts, contested, at the SAME leaf ──
  await waitFor(page, () => document.querySelector('sh-sparql-table-view') !== null)
  await waitFor(page, () => (document.querySelector('sh-sparql-table-view') as unknown as { status?: string })?.status === 'ready')
  // LAY-007: the SPLIT's own leaf id ("the table's element identity
  // survives, proving LAY-007 preserved its lease" — master §3 Slice 6's
  // own text) — mark the TABLE's DOM node before activation (a resource-
  // binding-only change to the CENTRE selection must not tear down and
  // remount the table beside it).
  const hadInitialCard = await page.evaluate(() => document.querySelector('sh-object-card-view') !== null)
  assert(hadInitialCard, 'the empty-selection card leaf exists before activation (the split renders from render one)')
  await page.evaluate(() => {
    const table = document.querySelector('sh-sparql-table-view')
    if (table) (window as unknown as { __shMarkedTable?: Element }).__shMarkedTable = table
    const row = table!.shadowRoot!.querySelector('tbody tr[data-subject-iri]') as HTMLTableRowElement
    row.click()
  })
  await waitFor(page, () => {
    const card = document.querySelector('sh-object-card-view') as unknown as { status?: string; stance?: string | null } | null
    return card?.status === 'ready' && card.stance === 'contested'
  })
  const sameTable = await page.evaluate(() =>
    document.querySelector('sh-sparql-table-view') === (window as unknown as { __shMarkedTable?: Element }).__shMarkedTable)
  assert(sameTable, 'row activation leaves the TABLE leaf\'s own element identity untouched (LAY-007 lease preserved) while the card leaf beside it gains real content')
  console.log('[contested-resolution] (1) real row activation mounts card.object with the new selection\'s content, contested; the table leaf beside it keeps its own identity')

  // ── (2) the card's own "Compose a merged value…" affordance opens the
  //    REAL <mn-context-menu>, flattened (mn-context-menu has no submenu
  //    renderer — verified against the real component) ────────────────────
  await page.evaluate(() => {
    const card = document.querySelector('sh-object-card-view')!
    const button = Array.from(card.shadowRoot!.querySelectorAll('button'))
      .find(candidate => candidate.textContent?.includes('Compose a merged value'))
    if (!button) throw new Error('the card\'s own "Compose a merged value…" button is not in the DOM')
    button.click()
  })
  await waitFor(page, () => document.querySelector('mn-context-menu')?.hasAttribute('open') === true)
  const menuItemIds = await page.evaluate(() =>
    Array.from(document.querySelector('mn-context-menu')!.shadowRoot!.querySelectorAll('[data-menu-item-id]'))
      .map(element => element.getAttribute('data-menu-item-id')))
  assert(menuItemIds.some(id => id?.startsWith('keep:')), `the menu carries FLATTENED, directly-clickable keep entries: ${JSON.stringify(menuItemIds)}`)
  assert(menuItemIds.includes('compose'), `the menu carries a compose entry: ${JSON.stringify(menuItemIds)}`)
  assert(menuItemIds.includes('copy-key'), `the menu carries a copy-key entry: ${JSON.stringify(menuItemIds)}`)
  console.log(`[contested-resolution] (2) real <mn-context-menu> opened with real, flat entries: ${JSON.stringify(menuItemIds)}`)

  // ── (3) selecting a specific keep:{operationId} opens the REAL
  //    <mn-confirmation-dialog> "choose" presentation ──────────────────────
  await page.evaluate((id) => {
    const button = document.querySelector('mn-context-menu')!.shadowRoot!.querySelector(`[data-menu-item-id="${id}"]`) as HTMLButtonElement
    if (!button) throw new Error(`no menu button for ${id}`)
    button.click()
  }, `keep:${keptOperationId}`)
  await waitFor(page, () => (document.querySelector('mn-confirmation-dialog') as unknown as { open?: boolean })?.open === true)
  const chooseState = await page.evaluate(() => {
    const dialog = document.querySelector('mn-confirmation-dialog') as unknown as {
      title: string; confirmText: string; secondaryConfirmText: string; cancelText: string
    }
    return { title: dialog.title, confirmText: dialog.confirmText, secondaryConfirmText: dialog.secondaryConfirmText, cancelText: dialog.cancelText }
  })
  assert(chooseState.title.startsWith('Resolve '), `the choose dialog's own title names the object: ${JSON.stringify(chooseState)}`)
  assert(chooseState.confirmText === 'Keep this one', `confirm reads "Keep this one": ${JSON.stringify(chooseState)}`)
  assert(chooseState.secondaryConfirmText === 'Compose a merged value…', `secondary reads "Compose a merged value…": ${JSON.stringify(chooseState)}`)
  assert(chooseState.cancelText === 'Not now', `cancel reads "Not now": ${JSON.stringify(chooseState)}`)
  console.log('[contested-resolution] (3) the real "choose" dialog is showing, titled for the real object')

  // ── (4) mn-confirm ("Keep this one") — loading VISIBLE while the dialog
  //    is STILL MOUNTED, then the row goes pending as soon as it settles.
  //    `enqueue()`'s real work (WebCrypto digest + an IndexedDB write) can
  //    settle inside a handful of event-loop turns — TOO FAST for external
  //    polling (`page.waitForFunction`) to reliably observe `loading` before
  //    it flips back. Trace it from INSIDE the page instead: sample after
  //    every microtask/task turn for a bounded window, in the SAME realm the
  //    dialog lives in, so the transient state is never missed. ────────────
  const trace = await page.evaluate(async () => {
    const dialog = document.querySelector('mn-confirmation-dialog') as unknown as HTMLElement & { loading?: boolean; open?: boolean; message?: string }
    const samples: { readonly loading?: boolean; readonly open?: boolean }[] = []
    dialog.dispatchEvent(new CustomEvent('mn-confirm'))
    samples.push({ loading: dialog.loading, open: dialog.open })
    for (let i = 0; i < 200 && dialog.open; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
      samples.push({ loading: dialog.loading, open: dialog.open })
    }
    return { samples, finalMessage: dialog.message, finalOpen: dialog.open }
  })
  assert(
    trace.samples.some(sample => sample.loading === true && sample.open === true),
    `loading was visible on a STILL-MOUNTED dialog at SOME point in the trace: ${JSON.stringify(trace)}`,
  )
  console.log(`[contested-resolution] (4) loading=true observed on the still-mounted dialog (trace: ${trace.samples.length} samples) — the corrected pickResolution shape`)
  await waitFor(page, () => (document.querySelector('mn-confirmation-dialog') as unknown as { open?: boolean })?.open === false, 10000)
  const stanceAfterConfirm = await page.evaluate(() => document.querySelector('sh-object-card-view')?.getAttribute('data-stance'))
  assert(stanceAfterConfirm === 'contested', `the card's stance PERSISTS while the resolution is only locally durable, not yet acknowledged: ${stanceAfterConfirm}`)
  const rowsAfterConfirm = await page.evaluate(() => window.__contestedResolutionHarness!.resolveOutboxRows())
  assert(rowsAfterConfirm.length === 1, `exactly one resolveCurrent outbox row exists: ${JSON.stringify(rowsAfterConfirm)}`)
  assert(
    rowsAfterConfirm[0]!.status === 'pending' || rowsAfterConfirm[0]!.status === 'accepted' || rowsAfterConfirm[0]!.status === 'applied',
    `the row is durable and on its way (never 'conflict' — the direct T-R1 regression guard): ${JSON.stringify(rowsAfterConfirm)}`,
  )
  console.log(`[contested-resolution] (4b) stance persists; the outbox row is real and durable: ${rowsAfterConfirm[0]!.status}`)

  // ── T-R4: cold-reload mid-flight — a FRESH SourceMirrorRuntime over the
  //    SAME IndexedDB sees the SAME durable row ─────────────────────────────
  const coldRows = await page.evaluate(() => window.__contestedResolutionHarness!.reopenColdAndListOutbox())
  assert(coldRows.length === 1, `the resolveCurrent intent survives a cold reload, in IndexedDB: ${JSON.stringify(coldRows)}`)
  assert(coldRows[0]!.operation.operationId === rowsAfterConfirm[0]!.operation.operationId, 'the cold-reopened row is the SAME operation')
  console.log('[contested-resolution] (5) cold-reload proof: the durable intent survives a fresh SourceMirrorRuntime over the same IndexedDB')

  // ── (5) the receipt lands: 'applied', never 'conflict' (T-R1); the
  //    non-optimistic window — the object is STILL contested THIS epoch ──────
  await waitFor(page, () => {
    const rows = window.__contestedResolutionHarness!.resolveOutboxRows()
    return rows.length === 1 && rows[0]!.status === 'applied'
  }, 20000)
  const appliedRow = await page.evaluate(() => window.__contestedResolutionHarness!.resolveOutboxRows()[0]!)
  assert(appliedRow.status === 'applied', `T-R1: the receipt is classified as a success, NEVER as a contest: ${JSON.stringify(appliedRow)}`)
  assert(appliedRow.resolvedConflictId !== undefined, `resolvedConflictId is set on the applied receipt: ${JSON.stringify(appliedRow)}`)
  const stateBeforeNextPull = await page.evaluate(() => window.__contestedResolutionHarness!.mirrorState())
  assert(stateBeforeNextPull.resolving.length === 0, `the row left 'resolving' once its receipt landed: ${JSON.stringify(stateBeforeNextPull)}`)
  assert(
    stateBeforeNextPull.awaitingEpoch.some(entry => entry.conflictId === appliedRow.resolvedConflictId),
    `the non-optimistic window: the receipt landed but THIS epoch has not confirmed it cleared yet — awaitingEpoch still names it: ${JSON.stringify(stateBeforeNextPull)}`,
  )
  const stanceBeforeNextPull = await page.evaluate(() => document.querySelector('sh-object-card-view')?.getAttribute('data-stance'))
  assert(stanceBeforeNextPull === 'contested', `the stance has NOT cleared yet — only the receipt landed, not the next pull: ${stanceBeforeNextPull}`)
  console.log('[contested-resolution] (5) T-R1 confirmed: applied, never conflict; the non-optimistic window holds the stance until the next pull')

  // ── (6) only the NEXT pull clears it ──────────────────────────────────────
  await page.evaluate(() => window.__contestedResolutionHarness!.refresh())
  await waitFor(page, () => window.__contestedResolutionHarness!.mirrorState().contestedObjects === 0, 15000)
  const stateAfterNextPull = await page.evaluate(() => window.__contestedResolutionHarness!.mirrorState())
  assert(stateAfterNextPull.awaitingEpoch.length === 0, `awaitingEpoch is empty once the next epoch confirms the clear: ${JSON.stringify(stateAfterNextPull)}`)
  assert(stateAfterNextPull.contestedObjects === 0, `the authority no longer reports this object contested: ${JSON.stringify(stateAfterNextPull)}`)
  console.log('[contested-resolution] (6) the next pull clears the non-optimistic window — contestedObjects drops to 0')

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)
  const harnessError = await page.evaluate(() => window.__contestedResolutionHarness!.lastError())
  assert(!harnessError, `no resolution-flow error surfaced: ${harnessError}`)

  const report = {
    ok: true,
    verdict: 'GO',
    scope: 'the full Law IV resolution journey against a real cell — row activation, choose/compose, receipt, the non-optimistic window',
    evidence: {
      resolution: {
        realContextMenuAndDialog: true,
        appliedNeverConflict: appliedRow.status === 'applied',
        nonOptimisticWindowHeld: stateBeforeNextPull.awaitingEpoch.some(entry => entry.conflictId === appliedRow.resolvedConflictId),
        clearedOnNextPull: stateAfterNextPull.contestedObjects === 0 && stateAfterNextPull.awaitingEpoch.length === 0,
        finding: 'a real resolveCurrent receipt lands applied (never conflict, T-R1), the stance holds contested through the non-optimistic window, and only the next real pull clears it',
      },
    },
    provenance: { gardend: { path: bin, sha256: binarySha256 } },
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  console.log('[contested-resolution] verdict: GO')
  console.log('[contested-resolution] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
