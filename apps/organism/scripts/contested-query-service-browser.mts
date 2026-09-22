/**
 * contested-query-service-browser.mts — REAL-CELL + REAL-CHROMIUM proof
 * that the contested table resolves real rows on an ORDINARY route (MO
 * object-face integration spec, master §2.8/§2.9, §3 Slice 5, gate G10).
 *
 * Spawns a real headless gardend cell, seeds a real Law IV current-state
 * contest, boots Organism's real Vite dev server, and drives the REAL
 * `renderWorkspace()` surface (via `contested-query-service-harness-main.ts`,
 * the `GARDEN_DEFAULT` config — no `sh-layout-dashboard` marker anywhere)
 * in REAL Chromium:
 *
 *   - the table resolves the real `sync.conflicts-open` row for the real
 *     seeded conflict — R10's regression, "shell supplied no fragments.
 *     queryService", never fires on this fragment-marker-free route;
 *   - `?proposals` equals `bundle.conflicts[0].candidates.length`;
 *   - clicking the real row activates it (`sh-row-activate` bubbles through
 *     `<sh-workspace-surface>` to `opts.contested.onSelect`), and the split's
 *     `card.object` leaf mounts the SAME object, `data-stance="contested"`.
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
const port = Number(process.env.SHRUBBERY_CONTESTED_QUERY_SERVICE_HARNESS_PORT ?? 5234)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'contested-query-service-harness-proof'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'contested-query-service-object'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`contested-query-service-browser-harness assertion failed: ${message}`)
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
  console.log(`[contested-query-service] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[contested-query-service] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'contested query-service browser harness' })
  let graphIncarnation = (await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }).graphIncarnation

  // A real document, via `source_push` (`documentLifecycle`) — NOT the
  // legacy `create_document` tool (`bottom-bar-mirror-badges-browser.mts`'s
  // own established reason: the legacy path lands outside the source
  // ledger's tracking). Real, empirically found: the OFFLINE workspace
  // overlay (`offline-workspace-overlay.ts`'s `Y.applyUpdate`) throws
  // "Unexpected end of array" decoding `bundle.workspace.updateBase64` for a
  // graph whose workspace Y.Doc was NEVER committed to at all — this
  // harness's own contest never touches a document, so a real document is
  // seeded here purely to give the workspace Y.Doc a real, valid update to
  // decode once `surfaceQueryService`'s offline engine reads the synced
  // mirror.
  const createDoc = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [{
      kind: 'documentLifecycle',
      operationId: 'contested-query-service-create-doc',
      action: 'create',
      documentId: 'contested-query-service-doc',
      title: 'Contested query-service harness doc',
      newDocumentIncarnation: '77777777-7777-4777-8777-777777777777',
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
    operations: [bookmarkOp('contested-query-service-claim-a', 'Claim A', 'device-a')],
  }) as { ok?: boolean }
  assert(pushA.ok === true, `first contested claim accepted: ${JSON.stringify(pushA)}`)
  const pushB = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation,
    operations: [bookmarkOp('contested-query-service-claim-b', 'Claim B', 'device-b')],
  }) as { ok?: boolean }
  assert(pushB.ok === true, `second contested claim accepted: ${JSON.stringify(pushB)}`)
  const afterContest = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as {
    conflicts?: ReadonlyArray<{ readonly conflictId?: string; readonly candidates?: readonly unknown[] }>
  }
  assert((afterContest.conflicts?.length ?? 0) === 1, `authority reports exactly one real conflict: ${JSON.stringify(afterContest.conflicts)}`)
  const seededCandidateCount = afterContest.conflicts![0]!.candidates?.length ?? 0
  assert(seededCandidateCount === 2, `the real conflict has two real candidates: ${seededCandidateCount}`)
  console.log('[contested-query-service] real Law IV contest seeded (1 conflict, 2 candidates, at the authority)')

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
  console.log(`[contested-query-service] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  await page.goto(`http://127.0.0.1:${port}/contested-query-service-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.contestedQueryServiceHarnessReady === 'true' || Boolean(document.body.dataset.contestedQueryServiceHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.contestedQueryServiceHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[contested-query-service] vehicle booted: real renderWorkspace() surface over a real cell, GARDEN_DEFAULT (an ORDINARY route)')

  // ── (1) the table resolves real rows on a route with NO fragments option
  //    at all — R10's own regression ("shell supplied no fragments.
  //    queryService") never fires ────────────────────────────────────────
  await waitFor(page, () => document.querySelector('sh-sparql-table-view') !== null)
  await waitFor(page, () => {
    const view = document.querySelector('sh-sparql-table-view') as unknown as { status?: string } | null
    return view?.status === 'ready'
  })
  const tableStatus = await page.evaluate(() => (document.querySelector('sh-sparql-table-view') as unknown as { status?: string }).status)
  assert(tableStatus === 'ready', `the table reaches 'ready' — never the interpreter's "shell supplied no fragments.queryService" error state: ${tableStatus}`)
  const rowCount = await page.evaluate(() => (document.querySelector('sh-sparql-table-view') as unknown as { rows: readonly unknown[] }).rows.length)
  assert(rowCount === 1, `exactly one row for the one real seeded conflict: ${rowCount}`)
  const proposalsCell = await page.evaluate(() => {
    const view = document.querySelector('sh-sparql-table-view') as unknown as {
      rows: ReadonlyArray<Record<string, { readonly type: string; readonly value: string }>>
      columns: readonly string[]
    }
    return { proposals: view.rows[0]?.proposals?.value, columns: view.columns }
  })
  assert(proposalsCell.columns.includes('proposals'), `the table's own columns include ?proposals: ${JSON.stringify(proposalsCell.columns)}`)
  assert(proposalsCell.proposals === '2', `?proposals equals the real conflict's real candidate count: ${proposalsCell.proposals}`)
  console.log('[contested-query-service] (1) real table row resolves on an ordinary route with no fragments option — R10 dead')

  // ── (2) clicking the real row activates it; the split's card.object leaf
  //    mounts the SAME object and wears the contested stance ──────────────
  await page.evaluate(() => {
    const row = document.querySelector('sh-sparql-table-view')!.shadowRoot!.querySelector('tbody tr[data-subject-iri]') as HTMLTableRowElement
    row.click()
  })
  await waitFor(page, () => {
    const card = document.querySelector('sh-object-card-view') as unknown as { status?: string; stance?: string | null } | null
    return card?.status === 'ready' && card.stance === 'contested'
  })
  const cardState = await page.evaluate(() => {
    const card = document.querySelector('sh-object-card-view') as unknown as {
      status?: string
      stance?: string | null
      objectKey?: string
      proposals?: readonly unknown[]
    }
    return { status: card.status, stance: card.stance, objectKey: card.objectKey, proposalCount: card.proposals?.length }
  })
  assert(cardState.status === 'ready', `the card reaches 'ready' after row activation: ${JSON.stringify(cardState)}`)
  assert(cardState.stance === 'contested', `the card wears the contested stance: ${JSON.stringify(cardState)}`)
  assert(cardState.objectKey?.includes(OBJECT_ID), `the card shows the SAME object the row named: ${JSON.stringify(cardState)}`)
  assert(cardState.proposalCount === 2, `the card's own proposals list matches the real candidate count: ${JSON.stringify(cardState)}`)
  const dataStance = await page.evaluate(() => document.querySelector('sh-object-card-view')!.getAttribute('data-stance'))
  assert(dataStance === 'contested', `data-stance="contested" reflects on the real host element: ${dataStance}`)
  console.log('[contested-query-service] (2) real row activation mounts the SAME real object on card.object, wearing the contested stance')

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  console.log('[contested-query-service] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
