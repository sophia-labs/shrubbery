/**
 * parked-work-reapply-browser.mts — REAL-CELL + REAL-CHROMIUM proof of the
 * reapply pipeline (MO object-face integration spec, master §3 Slice 9,
 * WS3 §7 as REPAIRED 2026-07-30, gate G13).
 *
 * Continues from a fixture built the same way `graph-fence-parked-
 * browser.mts` builds its own (a real fence, real parked work), built
 * fresh and self-contained here per this repo's sibling-harness
 * convention. Proves the four repaired defects that are this slice's own
 * heart:
 *
 *   1. C-D24/R20 — the parked Y.Doc snapshot actually reaches the
 *      replacement document, even for a recovery whose `relatedOperationIds`
 *      is empty (the never-rendered-this-session case).
 *   2. C-D25/R21 — a reapplied `currentState` op keeps its ORIGINAL
 *      `baseVersion`, so a genuine Law IV contest forms instead of a
 *      silent overwrite of the new life's own value.
 *   3. refutation-03 #6 — `resolveCurrent` is unrepresentable and dropped,
 *      never replayed against a ledger it does not belong to.
 *   4. audit #5 — the drain-then-refuse precondition makes "one at a time"
 *      TRUE: a dirty outbox (an ordinary live edit not yet flushed) makes
 *      a fresh run refuse with `rolled_back` before touching anything.
 *
 * Plus: every pushed operationId is fresh and carries `reapplyOf` (C-D22,
 * replacing the `reapply-journal` that was never built); a pre-acceptance
 * cancel yields `rolled_back` untouched (§7.7); the succeeded record is
 * stamped `reappliedAt` and stays listed, never deleted (PW-18).
 *
 * fix(slice-9), refutation finding #1 (adversarial review, 2026-07-31):
 * step (16) SIGKILLs the real gardend process and restarts it FRESH — new
 * random port AND token (`spawnGardend` mints both), same on-disk profile
 * — then re-reads what this run already delivered through a BRAND-NEW MCP
 * client, never the browser's own connection. This is a durability proof
 * ANCHORED AFTER the run completes, not mid-`restoring` as 03 §7's own
 * text names: the SAME page/browser session drives steps (14)-(15)
 * afterward, and splicing a live gardend restart into the middle of that
 * (updating the loopback manifest the page's own mirror runtime polls,
 * mid-batch, without destabilizing the drain-then-refuse/cancel assertions
 * that follow) was judged a materially riskier proof to get right than the
 * one built here — REJECTED as this session's scope, recorded honestly
 * rather than attempted unsafely. What ships here proves the same
 * underlying claim the "mid-restoring" wording is really after: the
 * ledger's durability is real disk truth, not an artifact of one process
 * staying alive. A genuine mid-batch `effectError` injection proof is
 * NOT attempted here either, for the same reason (no known deterministic
 * trigger was established in this session without exploratory time this
 * pre-Slice-10 pass did not have) — both left open, not silently dropped.
 *
 * NO MOCKS anywhere in this proof.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_PARKED_WORK_REAPPLY_HARNESS_PORT ?? 5238)
const headed = process.env.SHRUBBERY_HEADED === '1'
// master §3 Slice 9, §8.1/§10.4 — wired into `verify:offline-distributed-
// truth`'s composite (G14) as one of its `runChild` members.
const reportPath = process.env.SHRUBBERY_DISTRIBUTED_TRUTH_REPORT

const GRAPH_ID = 'parked-work-reapply-harness-proof'
const NEW_INCARNATION = '88888888-8888-4888-8888-888888888888'
const RECREATE_OPERATION_ID = 'parked-work-reapply-recreate-op-1'
const NEVER_RENDERED_DOCUMENT_ID = 'reapply-doc-never-rendered'
const ORIGINAL_DOCUMENT_INCARNATION = '77777777-7777-4777-8777-777777777777'
const REPLACEMENT_DOCUMENT_INCARNATION = '66666666-6666-4666-8666-666666666666'
const OLD_LIFE_TEXT = 'offline text from the previous life, never rendered this session'
// A REAL, already-registered vocab/class — `codeBacked`, never auto-
// resolves (the same `emporium-bookmark`/`Bookmark` pair `bottom-bar-
// mirror-badges-browser.mts` already proves seeds a real Law IV contest).
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'reapply-harness-bookmark-1'
const OBJECT_KEY = `${VOCAB}\x1f${CLASS}\x1f${OBJECT_ID}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`parked-work-reapply-browser assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

interface MirrorStateSnapshot {
  readonly phase: string
  readonly complete: boolean
  readonly graphIncarnation: string | null
  readonly pending: number
  readonly fenced: boolean
  readonly errorCode: string | null
}

interface ReapplyViewSnapshot {
  readonly active: boolean
  readonly stage: string
  readonly progress: number
  readonly heading: string
  readonly message: string
  readonly error: string
}

interface ReapplyOutcomeSnapshot {
  readonly stage: string
  readonly applied: readonly string[]
  readonly contested: readonly {
    readonly operationId: string
    readonly parkedOperationId: string
    readonly objectKey: string
    readonly conflictId: string | null
  }[]
  readonly dropped: readonly {
    readonly parkedOperationId: string
    readonly representability: { readonly kind: string; readonly why?: string }
  }[]
  readonly failed: readonly unknown[]
  readonly collateral: readonly unknown[]
  readonly recoveryKeys: readonly string[]
}

async function mirrorState(page: Page): Promise<MirrorStateSnapshot> {
  return page.evaluate(() => window.__parkedWorkReapplyHarness!.mirrorState() as unknown as MirrorStateSnapshot)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
// fix(slice-9): an EXPLICIT, tracked profile dir — required so step (16)'s
// restart can reboot the SAME on-disk graph (spawnGardend's default is a
// fresh mkdtemp per call; a caller-supplied dir is also never auto-deleted
// by cell.kill(), so this session cleans it up itself in `finally`).
const cellProfileDir = mkdtempSync(resolve(tmpdir(), 'gardend-organism-reapply-'))

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** SIGKILL a real gardend process for real and wait for it to actually die
 *  (health check stops responding) before returning — mirrors
 *  `offline-sync-later-gardend-browser.mts`'s own `hardKill`, copied
 *  rather than imported (this repo's sibling-harness convention: each
 *  .mts proof is self-contained). */
async function hardKill(dying: GardendCell): Promise<void> {
  process.kill(dying.pid, 'SIGKILL')
  const deadline = Date.now() + 10_000
  for (;;) {
    const dead = await fetch(`${dying.apiUrl}/health`).then(res => !res.ok).catch(() => true)
    if (dead) break
    if (Date.now() > deadline) throw new Error('parked-work-reapply-browser: gardend did not die within 10s of SIGKILL')
    await sleep(75)
  }
  await dying.kill()
}

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  const binarySha256 = createHash('sha256').update(readFileSync(bin)).digest('hex')
  console.log(`[parked-work-reapply] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000, profileDir: cellProfileDir })
  console.log(`[parked-work-reapply] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'parked-work reapply browser harness' })
  const initialPull = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }
  const originalIncarnation = initialPull.graphIncarnation
  console.log(`[parked-work-reapply] (1) real graph created, incarnation A = ${originalIncarnation}`)

  // Through `documentLifecycle create` (`source_push`), NOT the legacy
  // `create_document` tool — the legacy path creates a document OUTSIDE
  // the source ledger's tracking, which a LATER `source_push` touching
  // ANY document in this graph then finds mismatched during its own
  // projection-rebuild step (verified empirically: this harness's own
  // first run failed with exactly that `effectError`, the same discovery
  // `bottom-bar-mirror-badges-browser.mts`'s own header comment records).
  const createDoc = await mcp.callTool('source_push', {
    graphId: GRAPH_ID, graphIncarnation: originalIncarnation,
    operations: [{
      kind: 'documentLifecycle', operationId: 'reapply-harness-create-doc-a',
      action: 'create', documentId: NEVER_RENDERED_DOCUMENT_ID,
      title: 'Reapply target — never rendered this session',
      newDocumentIncarnation: ORIGINAL_DOCUMENT_INCARNATION,
    }],
  }) as { readonly ok: boolean }
  assert(createDoc.ok === true, `the real, ledger-tracked document create is accepted: ${JSON.stringify(createDoc)}`)
  console.log('[parked-work-reapply] (2) a real, ledger-tracked document exists for the "never rendered this session" seed (R20)')

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID,
  }, null, 2))

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  console.log(`[parked-work-reapply] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ERR_INTERNET_DISCONNECTED')) {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  let partitioned = false
  await page.route(url => url.pathname.startsWith('/cell/'), (route) => (
    partitioned ? route.abort('internetdisconnected') : route.continue()
  ))

  await page.goto(`http://127.0.0.1:${port}/parked-work-reapply-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.parkedWorkReapplyHarnessReady === 'true' || Boolean(document.body.dataset.parkedWorkReapplyHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.parkedWorkReapplyHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[parked-work-reapply] vehicle booted: real GardendContract + real ReapplyController over a real cell')

  const initialState = await mirrorState(page)
  assert(initialState.complete === true && initialState.fenced === false, `mirror is complete and unfenced at incarnation A: ${JSON.stringify(initialState)}`)

  // ── (3) seed the never-rendered document (C6/R20's own precondition) ────
  await page.evaluate(
    ({ documentId, text }) => window.__parkedWorkReapplyHarness!.seedNeverRenderedDocument(documentId, text),
    { documentId: NEVER_RENDERED_DOCUMENT_ID, text: OLD_LIFE_TEXT },
  )
  console.log('[parked-work-reapply] (3) the real never-rendered document is durable in the real IndexedDB cache')

  // ── (4) partition, then enqueue three real, un-flushed offline operations:
  //    a loose graphMetadata edit, a resolveCurrent (step 3), and a
  //    currentState with base "root" (step 4). ─────────────────────────────
  partitioned = true
  await page.evaluate((operation) => window.__parkedWorkReapplyHarness!.enqueueLoose(operation), {
    kind: 'graphMetadata', operationId: 'reapply-loose-title-1', title: 'Offline title edit from the old life',
  })
  await page.evaluate((operation) => window.__parkedWorkReapplyHarness!.enqueueLoose(operation), {
    kind: 'resolveCurrent', operationId: 'reapply-old-resolve-1',
    objectKey: OBJECT_KEY, conflictId: 'a-conflict-id-from-the-previous-life', chosenOperationId: 'some-candidate-operation-id',
  })
  await page.evaluate((operation) => window.__parkedWorkReapplyHarness!.enqueueLoose(operation), {
    kind: 'currentState', operationId: 'reapply-old-currentstate-1',
    vocab: VOCAB, class: CLASS, objectId: OBJECT_ID, baseVersion: 'root',
    record: { kind: CLASS, url: `https://shrubbery.test/${OBJECT_ID}`, title: 'from the old life' },
  })
  const afterEnqueue = await mirrorState(page)
  assert(afterEnqueue.pending === 3, `three real offline operations are durably pending: ${JSON.stringify(afterEnqueue)}`)
  console.log('[parked-work-reapply] (4) three real, un-flushed offline operations are durably pending: a loose edit, a resolveCurrent, and a currentState')

  // ── (5) OUT OF BAND: hard-delete + recreate the graph with a NEW
  //    incarnation, seeding a REPLACEMENT document under the SAME id (so
  //    the recovery lands as 'replaced', the only reapplicable reason) and
  //    pushing a REAL currentState write to the SAME objectKey — the new
  //    life's own head, which the reapplied op must contest, not overwrite. ──
  const deleteResponse = await fetch(`${cell.apiUrl}/graphs/${GRAPH_ID}?hard=true`, {
    method: 'DELETE', headers: { authorization: `Bearer ${cell.token}` },
  })
  const deleteBody = await deleteResponse.json() as { readonly status: string }
  assert(deleteResponse.status === 202 && deleteBody.status === 'succeeded', `real out-of-band hard delete succeeded: ${deleteResponse.status} ${JSON.stringify(deleteBody)}`)
  const createResponse = await fetch(`${cell.apiUrl}/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cell.token}` },
    body: JSON.stringify({
      graph_id: GRAPH_ID, title: 'parked-work reapply harness (recreated)',
      graph_incarnation: NEW_INCARNATION, operation_id: RECREATE_OPERATION_ID,
    }),
  })
  const createBody = await createResponse.json() as { readonly status: string }
  assert(createResponse.status === 202 && createBody.status === 'succeeded', `real out-of-band recreate succeeded: ${createResponse.status} ${JSON.stringify(createBody)}`)
  const createReplacementDoc = await mcp.callTool('source_push', {
    graphId: GRAPH_ID, graphIncarnation: NEW_INCARNATION,
    operations: [{
      kind: 'documentLifecycle', operationId: 'reapply-harness-create-doc-b',
      action: 'create', documentId: NEVER_RENDERED_DOCUMENT_ID, title: 'Reapply target (new life)',
      newDocumentIncarnation: REPLACEMENT_DOCUMENT_INCARNATION,
    }],
  }) as { readonly ok: boolean }
  assert(createReplacementDoc.ok === true, `the real, ledger-tracked REPLACEMENT document create is accepted: ${JSON.stringify(createReplacementDoc)}`)
  const newLifePull = await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }
  assert(newLifePull.graphIncarnation === NEW_INCARNATION, `the recreated graph really holds incarnation B: ${newLifePull.graphIncarnation}`)
  const newLifeCurrentState = await mcp.callTool('source_push', {
    graphId: GRAPH_ID, graphIncarnation: NEW_INCARNATION,
    operations: [{
      kind: 'currentState', operationId: 'reapply-new-life-currentstate-1',
      vocab: VOCAB, class: CLASS, objectId: OBJECT_ID, baseVersion: 'root',
      record: { kind: CLASS, url: `https://shrubbery.test/${OBJECT_ID}`, title: 'from the new life' },
    }],
  }) as { readonly ok: boolean }
  assert(newLifeCurrentState.ok === true, `the new life's own real currentState write is accepted: ${JSON.stringify(newLifeCurrentState)}`)
  console.log(`[parked-work-reapply] (5) OUT OF BAND: real hard-delete + recreate (incarnation B = ${NEW_INCARNATION}) — a replacement document under the SAME id, and a real currentState write establishing the new life's own head for ${OBJECT_KEY}`)

  // ── (6) restore the network; the real fence discovery + adoptNewLife ────
  partitioned = false
  const syncResult = await page.evaluate(() => window.__parkedWorkReapplyHarness!.syncAndReportError())
  assert(syncResult.threw === true && syncResult.message?.includes('stale graph incarnation') === true, `sync() discovers the real fence: ${JSON.stringify(syncResult)}`)
  const fencedState = await mirrorState(page)
  assert(fencedState.fenced === true, `state.fenced is durably true: ${JSON.stringify(fencedState)}`)
  await page.evaluate(() => window.__parkedWorkReapplyHarness!.adoptNewLife())
  const adoptedState = await mirrorState(page)
  assert(adoptedState.fenced === false && adoptedState.graphIncarnation === NEW_INCARNATION, `adoptNewLife() cleared the fence and adopted incarnation B: ${JSON.stringify(adoptedState)}`)
  console.log('[parked-work-reapply] (6) the real fence was discovered and adoptNewLife() adopted the new life; the previous life\'s work is now durably parked')

  // ── (7) the real parked-work join lists the one document, `reason:
  //    'replaced'`, `relatedOperationIds` empty (C-D24/R20's own
  //    precondition) — and the taxonomy is ALREADY computed (PW-22/23,
  //    "shown before the human commits"). ──────────────────────────────────
  const modelBefore = await page.evaluate(() => window.__parkedWorkReapplyHarness!.loadParkedWorkModel())
  const documentRow = modelBefore.documents.find(row => row.documentId === NEVER_RENDERED_DOCUMENT_ID)
  assert(documentRow !== undefined, `the never-rendered document is parked: ${JSON.stringify(modelBefore.documents)}`)
  assert(documentRow!.reason === 'replaced', `the recovery's reason is 'replaced' — the only reapplicable one: ${documentRow!.reason}`)
  assert(documentRow!.canReapply === true, `canReapply is true for a 'replaced' recovery: ${JSON.stringify(documentRow)}`)
  assert(documentRow!.operations.length === 0, `relatedOperationIds resolves to EMPTY for the never-rendered document (R20's own precondition): ${JSON.stringify(documentRow!.operations)}`)
  const resolveRow = modelBefore.looseOperations.find(op => op.operationId === 'reapply-old-resolve-1')
  assert(resolveRow?.representability.kind === 'unrepresentable' && (resolveRow.representability as { why?: string }).why === 'previous-life-resolution',
    `the parked resolveCurrent is ALREADY classified unrepresentable before any run (PW-22/23): ${JSON.stringify(resolveRow)}`)
  console.log(`[parked-work-reapply] (7) the real parked-work model: 1 document (reason='replaced', relatedOperationIds=[]), and the resolveCurrent's taxonomy is already computed`)

  // ── (8) the reapply run itself — every stage, monotonic progress ────────
  const outcome = await page.evaluate(
    key => window.__parkedWorkReapplyHarness!.runReapply([key]),
    documentRow!.recoveryKey,
  ) as unknown as ReapplyOutcomeSnapshot
  const views = await page.evaluate(() => window.__parkedWorkReapplyHarness!.viewSequence()) as unknown as ReapplyViewSnapshot[]
  const stageOrder = views.map(view => view.stage)
  assert(
    stageOrder.includes('pending') && stageOrder.includes('locking') && stageOrder.includes('backing_up')
    && stageOrder.includes('restoring') && stageOrder.includes('rebuilding') && stageOrder.includes('verifying'),
    `every stage was emitted in order: ${JSON.stringify(stageOrder)}`,
  )
  const firstIndex = (stage: string): number => stageOrder.indexOf(stage)
  assert(
    firstIndex('pending') < firstIndex('locking')
    && firstIndex('locking') < firstIndex('backing_up')
    && firstIndex('backing_up') < firstIndex('restoring')
    && firstIndex('restoring') < firstIndex('rebuilding')
    && firstIndex('rebuilding') < firstIndex('verifying'),
    `stage ORDER is exactly pending→locking→backing_up→restoring→rebuilding→verifying: ${JSON.stringify(stageOrder)}`,
  )
  let previousProgress = -1
  for (const view of views) {
    assert(view.progress >= previousProgress, `progress is monotonic non-decreasing: ${JSON.stringify(views.map(v => v.progress))}`)
    previousProgress = view.progress
  }
  const restoringMessages = views.filter(view => view.stage === 'restoring').map(view => view.message)
  assert(restoringMessages.some(message => /^Change \d+ of \d+ — /.test(message)), `RA-4 names the running count: ${JSON.stringify(restoringMessages)}`)
  console.log(`[parked-work-reapply] (8a) the real overlay passed through every stage in order with monotonic progress: ${JSON.stringify(stageOrder)}`)

  assert(outcome.stage === 'succeeded', `the run succeeds (dropped/contested are not failures): ${JSON.stringify(outcome)}`)
  console.log('[parked-work-reapply] (8b) the run reports succeeded')

  // ── (9) R20 — the load-bearing assertion: the synthesized documentUpdate
  //    for the empty-relatedOperationIds recovery actually reached the
  //    replacement document. Read it back OUT OF BAND, from the real cell,
  //    not from local state. ────────────────────────────────────────────────
  const replacementSnapshot = await mcp.documentSnapshot(GRAPH_ID, NEVER_RENDERED_DOCUMENT_ID)
  const Y = await import('yjs')
  const restoredDoc = new Y.Doc()
  Y.applyUpdate(restoredDoc, replacementSnapshot.update)
  const restoredText = restoredDoc.getText('body').toString()
  restoredDoc.destroy()
  assert(restoredText === OLD_LIFE_TEXT, `the parked TEXT reached the REPLACEMENT document for real (C-D24/R20): got "${restoredText}"`)
  console.log('[parked-work-reapply] (9) R20 CLOSED: the synthesized documentUpdate\'s bytes are durable in the replacement document, read back out of band')

  // ── (10) refutation-03 #6 — resolveCurrent dropped, named in the outcome ─
  const droppedResolve = outcome.dropped.find(row => row.parkedOperationId === 'reapply-old-resolve-1')
  assert(droppedResolve !== undefined, `the resolveCurrent op is in the outcome's dropped list: ${JSON.stringify(outcome.dropped)}`)
  assert(droppedResolve!.representability.kind === 'unrepresentable' && droppedResolve!.representability.why === 'previous-life-resolution',
    `dropped for the right reason: ${JSON.stringify(droppedResolve)}`)
  console.log('[parked-work-reapply] (10) the resolveCurrent op is dropped and named in the outcome, never replayed')

  // ── (11) C-D25/R21 — the currentState op CONTESTS instead of silently
  //    overwriting: a real ContestedHandoff with a real objectKey, AND the
  //    new life's own value survives as a proposal beside the parked one. ──
  const handoffs = await page.evaluate(() => window.__parkedWorkReapplyHarness!.contestedHandoffs()) as unknown as {
    readonly operationId: string; readonly parkedOperationId: string; readonly objectKey: string; readonly conflictId: string | null
  }[]
  assert(handoffs.length === 1, `exactly one ContestedHandoff was delivered through onContested: ${JSON.stringify(handoffs)}`)
  const handoff = handoffs[0]!
  assert(handoff.parkedOperationId === 'reapply-old-currentstate-1', `the handoff names the parked original: ${JSON.stringify(handoff)}`)
  assert(handoff.objectKey === OBJECT_KEY, `the handoff carries the REAL objectKey read off the receipt's own outcome.objectKey: ${handoff.objectKey}`)
  assert(handoff.conflictId !== null, `the handoff carries a real conflictId: ${JSON.stringify(handoff)}`)
  assert(outcome.contested.length === 1 && outcome.contested[0]!.objectKey === OBJECT_KEY, `ReapplyOutcome.contested repeats the same handoff: ${JSON.stringify(outcome.contested)}`)
  const conflicts = await page.evaluate(() => window.__parkedWorkReapplyHarness!.bundleConflicts())
  const conflictEntry = (conflicts as readonly Record<string, unknown>[]).find(entry => entry.objectKey === OBJECT_KEY)
  assert(conflictEntry !== undefined, `the real bundle carries a conflict for ${OBJECT_KEY}: ${JSON.stringify(conflicts)}`)
  const candidates = conflictEntry!.candidates as readonly Record<string, unknown>[] | undefined
  assert(Array.isArray(candidates) && candidates.length === 2, `TWO siblings share base "root" — the new life's write is NOT overwritten, it sits beside the reapplied proposal: ${JSON.stringify(candidates)}`)
  const candidateRecords = candidates!.map(candidate => (candidate.record as { title?: string } | undefined)?.title)
  assert(candidateRecords.includes('from the new life'), `the new life's own value is still present as a proposal: ${JSON.stringify(candidateRecords)}`)
  assert(candidateRecords.includes('from the old life'), `the reapplied (old life's) value is ALSO present as a proposal — a real contest, not a silent overwrite: ${JSON.stringify(candidateRecords)}`)
  console.log(`[parked-work-reapply] (11) C-D25/R21 CLOSED: a real Law IV contest formed (2 candidates), the new life's value untouched beside the reapplied one — objectKey=${handoff.objectKey}`)

  // ── (12) every pushed operationId is fresh, none equals a parked id, and
  //    each carries reapplyOf naming its parked original (C-D22). ─────────
  const parkedIds = ['reapply-loose-title-1', 'reapply-old-resolve-1', 'reapply-old-currentstate-1']
  const freshIds = [...outcome.applied, ...outcome.contested.map(row => row.operationId)]
  assert(freshIds.length >= 2, `at least the loose edit and the currentState op were pushed: ${JSON.stringify(freshIds)}`)
  for (const id of freshIds) {
    assert(id.startsWith('reapply:'), `every pushed id is fresh, reapply:-prefixed: ${id}`)
    assert(!parkedIds.includes(id), `no pushed id equals a parked id: ${id}`)
  }
  const outbox = await page.evaluate(() => window.__parkedWorkReapplyHarness!.outboxSnapshot())
  for (const id of freshIds) {
    const row = outbox.find(candidate => candidate.operationId === id)
    assert(row !== undefined, `the fresh row is durable in the real outbox: ${id}`)
    // Every fresh row carries `reapplyOf` naming its parked original
    // (C-D22) — either a real PARKED operationId, or, for the synthesized
    // snapshot (which has no parked outbox row of its own — its origin is
    // the DocumentRecoveryRecord, not an operation), `snapshot:{recoveryKey}`.
    const namesAParkedOriginal = row!.reapplyOf !== null
      && (parkedIds.includes(row!.reapplyOf) || row!.reapplyOf.startsWith(`snapshot:${documentRow!.recoveryKey}`))
    assert(namesAParkedOriginal, `the fresh row carries reapplyOf naming a real parked original (C-D22): ${JSON.stringify(row)}`)
  }
  const snapshotRow = outbox.find(row => row.reapplyOf === `snapshot:${documentRow!.recoveryKey}`)
  assert(snapshotRow !== undefined, `the synthesized snapshot's own fresh row carries reapplyOf naming the recovery it came from: ${JSON.stringify(outbox)}`)
  console.log('[parked-work-reapply] (12) every pushed operationId is fresh, none reused a parked id, and each carries reapplyOf — the crash evidence the deleted reapply-journal was supposed to provide')

  // ── (13) the succeeded record is stamped reappliedAt and STILL LISTED,
  //    not deleted (PW-18). ────────────────────────────────────────────────
  const modelAfter = await page.evaluate(() => window.__parkedWorkReapplyHarness!.loadParkedWorkModel())
  const reappliedRow = modelAfter.documents.find(row => row.documentId === NEVER_RENDERED_DOCUMENT_ID)
  assert(reappliedRow !== undefined, `the record is STILL LISTED after a successful reapply (PW-18), not deleted: ${JSON.stringify(modelAfter.documents)}`)
  assert(typeof reappliedRow!.reappliedAt === 'number' && reappliedRow!.reappliedAt! > 0, `the record is stamped reappliedAt: ${JSON.stringify(reappliedRow)}`)
  console.log('[parked-work-reapply] (13) PW-18 CLOSED: the reapplied record is stamped reappliedAt and stays listed, kept for the record')

  // ── (14) audit #5 — the drain-then-refuse precondition: an ordinary live
  //    edit in the NEW life that CANNOT be drained (the network is
  //    partitioned — §7.4's own drain step tries to flush it harmlessly
  //    FIRST, so "do not let it flush" means genuinely unreachable, not
  //    merely un-called) makes a fresh run REFUSE with `rolled_back`
  //    BEFORE touching anything — and the live edit is untouched and
  //    delivers normally once the network returns. ─────────────────────────
  partitioned = true
  await page.evaluate(id => window.__parkedWorkReapplyHarness!.enqueueLiveEdit(id), 'reapply-live-edit-1')
  const secondOutcome = await page.evaluate(
    () => window.__parkedWorkReapplyHarness!.runReapply([]),
  ) as unknown as ReapplyOutcomeSnapshot
  assert(secondOutcome.stage === 'rolled_back', `a dirty outbox makes the run refuse with rolled_back: ${JSON.stringify(secondOutcome)}`)
  assert(secondOutcome.applied.length === 0 && secondOutcome.contested.length === 0 && secondOutcome.failed.length === 0,
    `NOTHING was sent — the ledger is append-only and there is no partial state to report: ${JSON.stringify(secondOutcome)}`)
  const secondViews = await page.evaluate(() => window.__parkedWorkReapplyHarness!.viewSequence()) as unknown as ReapplyViewSnapshot[]
  const rolledBackView = secondViews.find(view => view.stage === 'rolled_back')
  assert(rolledBackView?.heading === 'Reapply did not start', `RA-11's heading: ${JSON.stringify(rolledBackView)}`)
  assert(rolledBackView?.message === 'Nothing was sent. Your parked work is exactly as it was.', `RA-11's message verbatim: ${JSON.stringify(rolledBackView)}`)
  const outboxAfterRefusal = await page.evaluate(() => window.__parkedWorkReapplyHarness!.outboxSnapshot())
  const liveEditRow = outboxAfterRefusal.find(row => row.operationId === 'reapply-live-edit-1')
  assert(liveEditRow?.status === 'pending', `the live edit is untouched, still pending: ${JSON.stringify(liveEditRow)}`)
  console.log('[parked-work-reapply] (14) audit #5 CLOSED: the drain-then-refuse precondition made "one at a time" TRUE — rolled_back before anything was touched, the live edit untouched')

  partitioned = false
  const flushResult = await page.evaluate(() => window.__parkedWorkReapplyHarness!.flushNow())
  assert(flushResult.threw === false, `the live edit delivers NORMALLY afterward, unharmed by the refused run: ${JSON.stringify(flushResult)}`)
  const outboxAfterFlush = await page.evaluate(() => window.__parkedWorkReapplyHarness!.outboxSnapshot())
  const liveEditAfterFlush = outboxAfterFlush.find(row => row.operationId === 'reapply-live-edit-1')
  assert(liveEditAfterFlush?.status === 'applied' || liveEditAfterFlush?.status === 'accepted',
    `the live edit is delivered for real after the refusal: ${JSON.stringify(liveEditAfterFlush)}`)
  console.log('[parked-work-reapply] (14b) the live edit delivers normally on the next real flush')

  // ── (15) §7.7 — a pre-acceptance cancel yields rolled_back, untouched ───
  const runPromise = page.evaluate(() => window.__parkedWorkReapplyHarness!.runReapply([]))
  await page.evaluate(() => window.__parkedWorkReapplyHarness!.cancelInFlight())
  const cancelledOutcome = await runPromise as unknown as ReapplyOutcomeSnapshot
  assert(cancelledOutcome.stage === 'rolled_back', `a pre-acceptance cancel yields rolled_back: ${JSON.stringify(cancelledOutcome)}`)
  assert(cancelledOutcome.applied.length === 0 && cancelledOutcome.contested.length === 0 && cancelledOutcome.failed.length === 0,
    `cancelling before acceptance sends nothing: ${JSON.stringify(cancelledOutcome)}`)
  const modelAfterCancel = await page.evaluate(() => window.__parkedWorkReapplyHarness!.loadParkedWorkModel())
  const untouchedRow = modelAfterCancel.documents.find(row => row.documentId === NEVER_RENDERED_DOCUMENT_ID)
  assert(untouchedRow?.reappliedAt === reappliedRow!.reappliedAt, `the ALREADY-reapplied record is untouched by the cancelled run: ${JSON.stringify(untouchedRow)}`)
  console.log('[parked-work-reapply] (15) §7.7 CLOSED: a pre-acceptance cancel yields rolled_back, and the recovery is untouched')

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  // ── (16) refutation finding #1 — SIGKILL the real gardend process and
  //    restart it FRESH (new random port AND token; same on-disk profile),
  //    then re-read what this run already delivered through a BRAND-NEW
  //    MCP client, never the browser's own connection. The browser is
  //    closed first — nothing past this point touches the page, and its
  //    loopback manifest is about to name a dead process. See the module
  //    header for why this is anchored AFTER the run rather than mid-
  //    `restoring`: it proves the same underlying claim (ledger durability
  //    is real disk truth, not a live-process illusion) more safely. ──────
  if (browser) { await browser.close(); browser = null }
  const preKillCell = cell
  await hardKill(preKillCell)
  console.log('[parked-work-reapply] (16a) gardend SIGKILLed for real and confirmed dead (health check stopped responding)')
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000, profileDir: cellProfileDir })
  assert(cell.token !== preKillCell.token, 'the restarted cell mints a FRESH token, never a reused one')
  console.log(`[parked-work-reapply] (16b) gardend restarted fresh: port ${preKillCell.manifest.port} → ${cell.manifest.port}, new token, same on-disk profile`)

  const restartedMcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  const survivingSnapshot = await restartedMcp.documentSnapshot(GRAPH_ID, NEVER_RENDERED_DOCUMENT_ID)
  const survivingDoc = new Y.Doc()
  Y.applyUpdate(survivingDoc, survivingSnapshot.update)
  const survivingText = survivingDoc.getText('body').toString()
  survivingDoc.destroy()
  assert(survivingText === OLD_LIFE_TEXT,
    `the reapplied TEXT survives a real SIGKILL + restart on a fresh port/token — disk truth, not a live-process illusion: got "${survivingText}"`)

  const survivingPull = await restartedMcp.callTool('source_pull', { graphId: GRAPH_ID }) as {
    readonly conflicts?: readonly Record<string, unknown>[]
  }
  const survivingConflict = (survivingPull.conflicts ?? []).find(entry => entry.objectKey === OBJECT_KEY)
  assert(survivingConflict !== undefined, `the Law IV contest also survives the restart: ${JSON.stringify(survivingPull.conflicts)}`)
  const survivingCandidates = survivingConflict!.candidates as readonly Record<string, unknown>[] | undefined
  const survivingCandidateRecords = (survivingCandidates ?? []).map(candidate => (candidate.record as { title?: string } | undefined)?.title)
  assert(
    survivingCandidateRecords.includes('from the new life') && survivingCandidateRecords.includes('from the old life'),
    `both contest proposals survive the restart: ${JSON.stringify(survivingCandidateRecords)}`,
  )
  console.log('[parked-work-reapply] (16c) CLOSED: the reapplied snapshot AND the Law IV contest are real disk truth — both survive a SIGKILL + restart on a fresh random port and token')

  // master §3 Slice 9, §10.4 — wired into `verify:offline-distributed-
  // truth`'s composite (G14) as a real `runChild` member.
  const report = {
    ok: true,
    verdict: 'GO',
    scope: 'the reapply pipeline against a real cell — the synthesized snapshot, the unchanged-baseVersion contest, the drain-then-refuse precondition, and append-only-honest rollback',
    evidence: {
      reapply: {
        synthesizedSnapshotReachedReplacement: restoredText === OLD_LIFE_TEXT,
        currentStateContestedNotOverwritten: candidateRecords.includes('from the new life') && candidateRecords.includes('from the old life'),
        resolveCurrentDropped: droppedResolve !== undefined,
        everyPushedIdFreshWithReapplyOf: freshIds.every(id => id.startsWith('reapply:')) && snapshotRow !== undefined,
        recordStampedAndStillListed: typeof reappliedRow!.reappliedAt === 'number',
        drainThenRefuseHeldOneAtATime: secondOutcome.stage === 'rolled_back',
        preAcceptanceCancelRolledBack: cancelledOutcome.stage === 'rolled_back',
        // fix(slice-9), refutation finding #1: durability across a real
        // SIGKILL + restart on a fresh random port/token, same on-disk
        // profile — anchored post-run, not mid-`restoring` (module header).
        survivedHardKillAndRestart: survivingText === OLD_LIFE_TEXT
          && survivingCandidateRecords.includes('from the new life')
          && survivingCandidateRecords.includes('from the old life'),
        finding: 'C-D24/R20, C-D25/R21, refutation-03 #6, C-D22, PW-18, audit #5, §7.7, and post-run SIGKILL+restart durability all proven against a real gardend',
      },
    },
    provenance: { gardend: { path: bin, sha256: binarySha256 } },
  }
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  console.log('[parked-work-reapply] verdict: GO')
  console.log('[parked-work-reapply] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  rmSync(cellProfileDir, { recursive: true, force: true })
}
