/**
 * REAL-CELL + REAL-CHROMIUM nested-layout proof for the layout vehicle
 * (Builder-3 task: "wire the vehicle into the organism center").
 *
 * Spawns a REAL headless gardend cell, seeds a real graph with two real
 * documents (doc-a, doc-b), boots Organism's real Vite dev server (the SAME
 * `vite.config.ts` the production entry uses — its `dynamicCellProxy` plugin
 * is what lets the browser reach the cell same-origin, no token in the
 * browser), and drives ONE nested layout — a REAL `LayoutInterpreter` over a
 * REAL `FaceRegistry`/`LayoutResourceBroker`, hosting EXACTLY the ratified P2
 * catalog (design §9.2 Phase 2): the REAL `hoja.document` (wrapping the REAL
 * `EditorRoomPool`), `sparql.bindings-table` (wrapping the REAL
 * `QueryBlockService` over a REAL `RestClient`), and `sophia.home` faces —
 * through 1 -> 2 -> 3 -> nested-4-leaf, a real pointer-drag ratio resize, a
 * real move_node of BOTH a provider-free SPARQL leaf and a DOCUMENT leaf
 * (host + live ProseMirror EditorView identity asserted for both), a real
 * swap_nodes, TWO independent real SPARQL SELECTs proving the derived
 * resource shape shares nothing across leaves, real close_leaf teardown, and
 * closing every leaf all the way down to the real, rendered `sophia.home`
 * fallback (LAY-010), in REAL Chromium. `assertFullHeightByConstruction`
 * checks root-relative x/y geometry (not just width/height) and that every
 * wrapper is a DIRECT child of the vehicle's root — the general,
 * any-nesting-depth version of "the DOM never disagrees with the solver" and
 * "move never destroys a live view" (see `layout-interpreter.ts`'s
 * `ensureWrapper` doc comment).
 *
 * `media.viewer` is deliberately NOT MOUNTED as a leaf anywhere in this
 * proof (diff-review r2 WRONG: "media.viewer is a fourth addition beyond the
 * authority's 'exactly' wording" — kept out of the RATIFIED catalog this
 * proof exercises). The harness page this script drives DOES register
 * `media.viewer` on the same registry/broker (F6, repair round 3 — a
 * deliberate quarantine, not an oversight: see `layout-workbench-main.ts`'s
 * own registration comment), so `FaceRegistry.validate` would accept a
 * `media.viewer` descriptor here too — this proof simply never mints one,
 * because proving it end-to-end is the Wave-2 STATIC-template's own concern
 * (`plans/shrubbery-surface-north-star-20260716.md` §2.1), not this MVP
 * proof's. The "genuinely different, provider-free pane" property that face
 * used to demonstrate is proved here by `sparql.bindings-table` instead — a
 * DERIVED resource shape (never cached/shared), a stronger contrast with
 * `hoja.document`'s DURABLE shape than a second durable-blob face would have
 * been.
 *
 * NO fake provider, fake query result, placeholder face, or vi.mock anywhere
 * in this proof — every assertion below reads real DOM, a real WS-synced
 * ProviderHandle, a real SPARQL response from the real cell, or the real
 * EditorRoomPool's live refcount snapshot.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_LAYOUT_WORKBENCH_PORT ?? 5217)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'layout-workbench-proof'
const DOC_A = 'doc-a'
const DOC_B = 'doc-b'
// Wave 1's own document (north star §2.2/§3: "doc-history beside the live
// document it diffs") — isolated from DOC_A/DOC_B so its snapshot history is
// never polluted by the rest of this proof's own open/close/reopen churn.
const DOC_HISTORY_DOC = 'doc-history-proof'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`layout-workbench assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

interface PlanLeafBox {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Flatten the interpreter's currently solved plan into per-leaf pixel boxes. */
async function planLeafBoxes(page: Page): Promise<readonly PlanLeafBox[]> {
  return page.evaluate(() => {
    const bridge = (window as unknown as {
      __layoutWorkbench: { interpreter: { currentPlan(): { root: unknown } | null } }
    }).__layoutWorkbench
    const plan = bridge.interpreter.currentPlan()
    if (!plan) return []
    // Iterative (not a nested named helper): tsx/esbuild's dev transform
    // wraps NAMED nested function/const-arrow bindings in a `__name(...)`
    // call whose helper only exists in the module's own scope — Playwright's
    // page.evaluate(fn) sends just fn.toString() to the browser, so any such
    // wrapped reference throws "__name is not defined" there. Plain loops
    // with no nested named bindings sidestep that entirely.
    const leaves: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
    const stack: unknown[] = [plan.root]
    while (stack.length > 0) {
      const node = stack.pop() as { kind: string; id: string; allocation?: { x: number; y: number; width: number; height: number }; start?: unknown; end?: unknown }
      if (node.kind === 'leaf' && node.allocation) {
        leaves.push({ id: node.id, x: node.allocation.x, y: node.allocation.y, width: node.allocation.width, height: node.allocation.height })
      } else if (node.kind === 'split') {
        stack.push(node.start, node.end)
      }
    }
    return leaves
  })
}

/**
 * Cross-check: for EVERY leaf, the interpreter's SOLVED plan box must equal
 * the leaf wrapper's ACTUAL rendered geometry — root-relative `x`/`y` AND
 * `width`/`height`, not width/height alone. This is the general,
 * N-leaf-topology version of "half-height impossible by construction" — the
 * DOM is never allowed to disagree with the solver, at any nesting depth.
 *
 * `x`/`y` matter independently of `width`/`height` (diff-review WRONG: "the
 * browser check compares only width/height, not x/y or clipping"): the
 * solver's `allocation.x`/`.y` are ROOT-ABSOLUTE pixels computed bottom-up
 * from the container origin (nucleus `solver.ts`'s `startAlloc`/`endAlloc`).
 * If the interpreter ever nested a leaf wrapper inside its split's wrapper
 * again (both `position:absolute`), a leaf nested two splits deep would
 * render at its OWN offset PLUS its ancestor's offset a second time — its
 * `width`/`height` would still match the plan (nesting doesn't change a
 * box's own size), but `getBoundingClientRect()`'s `left`/`top` (which are
 * viewport-relative, hence container-relative once the container's own
 * offset is subtracted) would silently drift from the plan's `x`/`y`. This
 * check would have caught the double-offset bug the width/height-only
 * version of this function missed.
 *
 * Also asserts NO element anywhere under the vehicle's root uses
 * `display: grid` — the literal "no flat grid remains" structural proof —
 * and that every wrapper's actual DOM parent is `root` itself (the flat,
 * never-nested wrapper structure `layout-interpreter.ts`'s `ensureWrapper`
 * documents as load-bearing for both this geometry proof and the
 * move/swap-does-not-destroy-the-view proof below).
 */
async function assertFullHeightByConstruction(page: Page, label: string): Promise<void> {
  const report = await page.evaluate(() => {
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        interpreter: {
          currentPlan(): { root: unknown } | null
          leafWrapperElement(id: string): HTMLElement | null
          splitWrapperElement(id: string): HTMLElement | null
        }
      }
    }).__layoutWorkbench
    const plan = bridge.interpreter.currentPlan()
    if (!plan) return { ok: false, reason: 'no plan', mismatches: [], gridElements: [], nonRootParents: [] }
    const leaves: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
    const splits: string[] = []
    const stack: unknown[] = [plan.root]
    while (stack.length > 0) {
      const node = stack.pop() as {
        kind: string
        id: string
        allocation?: { x: number; y: number; width: number; height: number }
        start?: unknown
        end?: unknown
      }
      if (node.kind === 'leaf' && node.allocation) {
        leaves.push({ id: node.id, ...node.allocation })
      } else if (node.kind === 'split') {
        splits.push(node.id)
        stack.push(node.start, node.end)
      }
    }
    const root = document.getElementById('layout-workbench-root')
    const rootRect = root!.getBoundingClientRect()
    const mismatches: Array<{
      id: string
      actual: { x: number; y: number; width: number; height: number }
      planned: { x: number; y: number; width: number; height: number }
    }> = []
    const nonRootParents: string[] = []
    for (const leaf of leaves) {
      const wrapper = bridge.interpreter.leafWrapperElement(leaf.id)
      if (!wrapper || wrapper.parentElement !== root) {
        nonRootParents.push(`leaf#${leaf.id}`)
        continue
      }
      const rect = wrapper.getBoundingClientRect()
      const actual = { x: rect.left - rootRect.left, y: rect.top - rootRect.top, width: rect.width, height: rect.height }
      if (
        Math.abs(actual.x - leaf.x) > 1 ||
        Math.abs(actual.y - leaf.y) > 1 ||
        Math.abs(actual.width - leaf.width) > 1 ||
        Math.abs(actual.height - leaf.height) > 1
      ) {
        mismatches.push({ id: leaf.id, actual, planned: leaf })
      }
    }
    for (const splitId of splits) {
      const wrapper = bridge.interpreter.splitWrapperElement(splitId)
      if (!wrapper || wrapper.parentElement !== root) nonRootParents.push(`split#${splitId}`)
    }
    // "No flat grid remains" is an invariant of the INTERPRETER's OWN
    // positioning mechanism (the historical bug: `display:grid` sparse
    // auto-placement inventing a phantom row) — NOT a ban on `display:grid`
    // anywhere in the app. A mounted face's own content (e.g.
    // <sh-home-view>'s `:host{display:grid}`, used only to CENTER its tiny
    // "Nothing is open here" body) is free to use CSS grid for its own
    // presentation; that has nothing to do with layout geometry authority.
    // Only check `root` itself and the interpreter's own wrapper elements
    // (`[data-layout-node-kind]` — split/leaf position divs).
    const gridElements: string[] = []
    if (root) {
      const ownWrappers = [root, ...Array.from(root.querySelectorAll<HTMLElement>('[data-layout-node-kind]'))]
      for (const el of ownWrappers) {
        if (getComputedStyle(el).display === 'grid') gridElements.push(el.tagName + (el.dataset.layoutNodeId ? `#${el.dataset.layoutNodeId}` : ''))
      }
    }
    return { ok: true, mismatches, gridElements, nonRootParents, leafCount: leaves.length }
  })
  assert(report.ok, `${label}: ${JSON.stringify(report)}`)
  assert(report.mismatches.length === 0, `${label}: DOM disagrees with the solved plan (root-relative x/y/width/height): ${JSON.stringify(report.mismatches)}`)
  assert(report.gridElements.length === 0, `${label}: found display:grid element(s) under the vehicle root: ${JSON.stringify(report.gridElements)} — a flat grid remains`)
  assert(report.nonRootParents.length === 0, `${label}: found wrapper(s) NOT directly parented to root — nested DOM would double-offset descendants: ${JSON.stringify(report.nonRootParents)}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real Gardend binary exists at ${bin}`)
  console.log(`[layout-workbench] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[layout-workbench] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Layout workbench proof' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_A, title: 'Doc A' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_B, title: 'Doc B' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_HISTORY_DOC, title: 'Doc History Proof' })
  // `create_document` alone only enqueues a `workspace.createDocument` CRDT
  // op — it does NOT write the document's on-disk manifest
  // (`document_paths.rs`'s `existing_document_dir`), which the history/
  // snapshot REST routes require and (unlike `document_service::
  // read_document`) never self-heal. A REAL `write_document` (durability-
  // checked block content write) is what a real document actually goes
  // through before anyone would open its history — this seed call mirrors
  // that real precondition, and its own durable write mints a real
  // automatic snapshot for free (tier `20min`).
  await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: DOC_HISTORY_DOC, content: 'seed content for doc-history proof' })
  console.log('[layout-workbench] graph and three documents seeded')

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
  console.log(`[layout-workbench] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const requestFailures: string[] = []
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })
  page.on('requestfailed', request => {
    requestFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`)
  })

  await page.goto(`http://127.0.0.1:${port}/layout-workbench-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.layoutWorkbenchReady === 'true' || Boolean(document.body.dataset.layoutWorkbenchError))
  const bootError = await page.evaluate(() => document.body.dataset.layoutWorkbenchError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[layout-workbench] vehicle booted: real FaceRegistry + LayoutResourceBroker + LayoutInterpreter over a real cell')

  // ── 1 leaf ──────────────────────────────────────────────────────────────
  let boxes = await planLeafBoxes(page)
  assert(boxes.length === 1 && boxes[0]!.id === 'D1', `expected exactly one leaf D1: ${JSON.stringify(boxes)}`)
  await assertFullHeightByConstruction(page, '1-leaf')
  const container = await page.locator('#layout-workbench-root').boundingBox()
  assert(container, 'container has geometry')
  const d1Box0 = await page.locator('[data-layout-node-id="D1"]').boundingBox()
  assert(d1Box0 && Math.abs(d1Box0.height - container.height) < 1, `1-leaf D1 does not fill full container height: ${JSON.stringify({ d1Box0, container })}`)

  // Edit the real CRDT document through the real ProseMirror view.
  const d1Editor = page.locator('[data-layout-node-id="D1"] sh-editor-host .ProseMirror')
  await d1Editor.waitFor({ state: 'visible', timeout: 15000 })
  await d1Editor.click()
  await d1Editor.fill('hello from D1')
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1')
  console.log('[layout-workbench] 1-leaf: real CRDT edit landed, full-height-by-construction holds')

  // ── 2 leaves: doc + real sparql.bindings-table, real ratio drag ─────────
  // (e) a real, read-only SELECT against the real cell, no TipTap/Y.Doc/
  // editor toolbar present (design §9.1 "Proving leaf B") — Q1 takes over
  // the "genuinely different, provider-free pane" role media.viewer's M1
  // used to play (diff-review r2 WRONG: media.viewer is not part of the
  // ratified catalog — see this file's own header).
  await page.locator('[data-action="split-sparql"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 2)

  // F2 (repair round 3): the freshly-minted split wrapper (S-root) is
  // appended to `root` AFTER D1's PRE-EXISTING leaf wrapper, and its box is
  // the UNION of both new children — so without `pointer-events:none` on
  // split wrappers (layout-interpreter.ts's `ensureWrapper`) it paints on
  // top of D1 and silently swallows every click/keystroke aimed at it, even
  // though D1's element/EditorView were never torn down. Playwright's own
  // `.click()` actionability check would time out with an "intercepts
  // pointer events" error if that regressed — this is a genuine, loud
  // real-Chromium proof, not a cosmetic one. Prove D1 is REALLY
  // clickable/typeable immediately after being split, then restore its
  // baseline text so every downstream exact-match assertion still holds.
  await d1Editor.click()
  await page.keyboard.type(' post-split')
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1 post-split')
  await d1Editor.fill('hello from D1') // restore baseline text for downstream exact-match checks
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1')
  console.log('[layout-workbench] (F2) split-wrapper pointer-events: D1 remained real-clickable/typeable immediately after being split (a brand-new split wrapper was appended after it)')

  const sparqlView = page.locator('[data-layout-node-id="Q1"] sh-sparql-table-view')
  await sparqlView.waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(page, () => {
    const table = document.querySelector('[data-layout-node-id="Q1"] sh-sparql-table-view')
      ?.shadowRoot?.querySelector('table')
    return table != null && table.querySelectorAll('tbody tr').length > 0
  }, 15000)
  const q1Shape = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="Q1"] sh-sparql-table-view') as unknown as Record<string, unknown> | null
    const rows = host
      ? Array.from(((host as unknown as HTMLElement).shadowRoot?.querySelectorAll('tbody tr') ?? []))
      : []
    const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent) : []
    return {
      tag: (host as unknown as HTMLElement | null)?.tagName ?? null,
      hasBinding: host ? 'binding' in host : null,
      hasLiveEditor: host ? 'liveEditor' in host : null,
      hasProvider: host ? 'provider' in host : null,
      rowCount: rows.length,
      firstRowCells,
    }
  })
  assert(q1Shape.tag === 'SH-SPARQL-TABLE-VIEW', 'the Q1 leaf mounts sh-sparql-table-view, not an editor host')
  assert(q1Shape.hasBinding === false, 'sh-sparql-table-view carries no .binding (no provider-shaped state at all)')
  assert(q1Shape.hasLiveEditor === false, 'sh-sparql-table-view carries no .liveEditor')
  assert(q1Shape.hasProvider === false, 'sh-sparql-table-view carries no .provider')
  assert(q1Shape.rowCount > 0, `real SELECT against the real cell (across all named graphs) returned zero rows: ${JSON.stringify(q1Shape)}`)
  assert(q1Shape.firstRowCells.length === 4, `expected 4 bound columns (g,s,p,o) per row: ${JSON.stringify(q1Shape)}`)
  assert(q1Shape.firstRowCells.every((cell) => typeof cell === 'string' && cell.length > 0), `expected non-empty typed term text in every cell: ${JSON.stringify(q1Shape)}`)
  console.log(`[layout-workbench] 2-leaf: (e) real sparql.bindings-table: real SELECT against the real cell returned ${q1Shape.rowCount} row(s), no provider/binding/liveEditor present`)

  await assertFullHeightByConstruction(page, '2-leaf pre-drag')
  let d1Box = await page.locator('[data-layout-node-id="D1"]').boundingBox()
  let q1Box = await page.locator('[data-layout-node-id="Q1"]').boundingBox()
  assert(d1Box && q1Box, 'both panes have geometry')
  assert(Math.abs(d1Box.height - container.height) < 1, `2-leaf D1 half-height regression: ${JSON.stringify({ d1Box, container })}`)
  assert(Math.abs(q1Box.height - container.height) < 1, `2-leaf Q1 half-height regression: ${JSON.stringify({ q1Box, container })}`)

  const dividerBefore = await page.locator('[data-divider-handle="S-root"]').boundingBox()
  assert(dividerBefore, 'S-root divider handle has geometry')
  const ratioBefore = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  await page.mouse.move(dividerBefore.x + dividerBefore.width / 2, dividerBefore.y + dividerBefore.height / 2)
  await page.mouse.down()
  await page.mouse.move(dividerBefore.x + 220, dividerBefore.y + dividerBefore.height / 2, { steps: 8 })
  await page.mouse.up()
  const ratioAfter = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  assert(ratioAfter !== ratioBefore, `real pointer drag did not change the ratio: ${ratioBefore} -> ${ratioAfter}`)
  await assertFullHeightByConstruction(page, '2-leaf post-drag')
  d1Box = await page.locator('[data-layout-node-id="D1"]').boundingBox()
  q1Box = await page.locator('[data-layout-node-id="Q1"]').boundingBox()
  assert(d1Box && Math.abs(d1Box.height - container.height) < 1, 'D1 still full-height after ratio drag')
  assert(q1Box && Math.abs(q1Box.height - container.height) < 1, 'Q1 still full-height after ratio drag')
  assert(
    (await page.evaluate(() => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
      ?.shadowRoot?.querySelector('.ProseMirror')?.textContent)) === 'hello from D1',
    'D1 edit survives the split + real pointer-drag resize',
  )
  console.log(`[layout-workbench] 2-leaf: real drag moved the ratio ${ratioBefore} -> ${ratioAfter}; both leaves stayed full-height`)

  // ── design §9.2 Phase 3 gate: keyboard separator controls, focus
  // restoration, and minimum constraints, real-browser-proven (diff-review
  // r2 MISSING: "Phase-3 browser gates remain incomplete") ─────────────────

  // (g) accessible keyboard separator control: a real Tab-reachable, real
  // keydown-driven resize, not pointer-only chrome.
  const dividerHandle = page.locator('[data-divider-handle="S-root"]')
  await dividerHandle.focus()
  const ratioBeforeKeyboard = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  await dividerHandle.press('ArrowRight')
  const ratioAfterKeyboardStep = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  assert(ratioAfterKeyboardStep === ratioBeforeKeyboard + 100, `ArrowRight must step the ratio by exactly 100 basis points: ${ratioBeforeKeyboard} -> ${ratioAfterKeyboardStep}`)
  await dividerHandle.press('Home')
  const ratioAfterHome = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  assert(ratioAfterHome === 100, `Home must clamp the ratio to the legal minimum (100 bp): got ${ratioAfterHome}`)
  await dividerHandle.press('End')
  const ratioAfterEnd = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { startBasisPoints: number }> } } })
      .__layoutWorkbench.getDoc().nodes['S-root']!.startBasisPoints,
  )
  assert(ratioAfterEnd === 9900, `End must clamp the ratio to the legal maximum (9900 bp): got ${ratioAfterEnd}`)
  await assertFullHeightByConstruction(page, '2-leaf post-keyboard-resize')
  // Restore a workable 50/50 split before continuing.
  await page.evaluate(() => (window as unknown as { __layoutWorkbench: { applyOp(op: unknown): unknown; reconcile(): Promise<unknown> } } ).__layoutWorkbench.applyOp({ op: 'set_ratio', splitId: 'S-root', startBasisPoints: 5000 }))
  await page.evaluate(() => (window as unknown as { __layoutWorkbench: { reconcile(): Promise<unknown> } }).__layoutWorkbench.reconcile())
  console.log('[layout-workbench] (g) keyboard separator: ArrowRight steps by 100bp, Home/End clamp to the legal 1..9900 range')

  // (h) focus restoration: LayoutInterpreter.focus(leafId, reason) actually
  // moves real DOM focus into the leaf's live element, and restores it to
  // the SAME live element (not a rebuilt one) on a later call.
  const focusedInto = await page.evaluate(async () => {
    const bridge = (window as unknown as { __layoutWorkbench: { interpreter: { focus(id: string, reason?: string): Promise<boolean> } } }).__layoutWorkbench
    return bridge.interpreter.focus('D1', 'activate')
  })
  assert(focusedInto === true, 'interpreter.focus(\'D1\') must report success once the ProseMirror body is live')
  const activeAfterFocus = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as HTMLElement | null
    return document.activeElement === host && host?.shadowRoot?.activeElement?.className.includes('ProseMirror')
  })
  assert(activeAfterFocus, 'interpreter.focus(\'D1\') must move REAL DOM focus into the live ProseMirror body (host active, shadow-root active element is .ProseMirror)')

  // Move focus AWAY, then ask the interpreter to restore it — the exact
  // liveEditor handle must be the one that regains focus, proving
  // "restoration" reaches the same live view, not a freshly mounted one.
  const liveEditorBeforeRestore = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    ;(window as unknown as { __focusCaptured: unknown }).__focusCaptured = host?.liveEditor ?? null
    return host?.liveEditor != null
  })
  assert(liveEditorBeforeRestore, 'D1 has a live liveEditor handle before the blur/restore round-trip')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const restored = await page.evaluate(async () => {
    const bridge = (window as unknown as { __layoutWorkbench: { interpreter: { focus(id: string, reason?: string): Promise<boolean> } } }).__layoutWorkbench
    return bridge.interpreter.focus('D1', 'restore')
  })
  assert(restored === true, 'interpreter.focus(\'D1\', \'restore\') must report success')
  const restoredIdentity = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const captured = (window as unknown as { __focusCaptured: unknown }).__focusCaptured
    return {
      hostFocused: document.activeElement === host,
      liveEditorSame: host?.liveEditor != null && host.liveEditor === captured,
    }
  })
  assert(restoredIdentity.hostFocused, 'focus(\'restore\') must move DOM focus back into D1\'s host')
  assert(restoredIdentity.liveEditorSame, 'focus(\'restore\') must restore focus onto the SAME liveEditor handle — not a rebuilt view')
  console.log('[layout-workbench] (h) focus restoration: interpreter.focus() moves real DOM focus into the live ProseMirror body and restores it to the SAME liveEditor handle after a blur')

  // (i) minimum constraints (design §6.2): shrinking the container below
  // both leaves' declared minimums must NOT crash reconcile, must mark the
  // affected wrapper(s) data-layout-constrained, must still allocate a
  // positive-size emergency floor, and must NOT destroy either live view.
  const preShrinkIdentity = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    ;(window as unknown as { __shrinkCaptured: unknown }).__shrinkCaptured = host?.liveEditor ?? null
    return host != null
  })
  assert(preShrinkIdentity, 'D1 host exists before the shrink')
  const shrink = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { resizeContainer(w: number, h: number): Promise<{ ok: boolean }> } })
      .__layoutWorkbench.resizeContainer(50, 40),
  )
  assert(shrink.ok, `reconcile must still succeed (ok:true) when the container is below both leaves' declared minimums: ${JSON.stringify(shrink)}`)
  const constrainedReport = await page.evaluate(() => {
    const d1 = document.querySelector('[data-layout-node-id="D1"]') as HTMLElement | null
    const q1 = document.querySelector('[data-layout-node-id="Q1"]') as HTMLElement | null
    const splitEl = document.querySelector('[data-layout-node-id="S-root"]') as HTMLElement | null
    return {
      d1Constrained: d1?.getAttribute('data-layout-constrained') ?? null,
      q1Constrained: q1?.getAttribute('data-layout-constrained') ?? null,
      splitConstrained: splitEl?.getAttribute('data-layout-constrained') ?? null,
      d1Width: d1 ? Number.parseFloat(d1.style.width) : null,
      d1Height: d1 ? Number.parseFloat(d1.style.height) : null,
    }
  })
  assert(constrainedReport.d1Constrained === 'true' || constrainedReport.q1Constrained === 'true', `at least one leaf must be marked data-layout-constrained when the container cannot fit both minimums: ${JSON.stringify(constrainedReport)}`)
  assert(constrainedReport.splitConstrained === 'true', `the ancestor split must ALSO be marked constrained when a descendant is: ${JSON.stringify(constrainedReport)}`)
  assert((constrainedReport.d1Width ?? 0) > 0 && (constrainedReport.d1Height ?? 0) > 0, `an emergency-floor allocation must still be positive-size, never zero/NaN: ${JSON.stringify(constrainedReport)}`)
  const postShrinkIdentity = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const captured = (window as unknown as { __shrinkCaptured: unknown }).__shrinkCaptured
    return host?.liveEditor != null && host.liveEditor === captured
  })
  assert(postShrinkIdentity, 'the constrained emergency-floor allocation must NOT destroy/recreate the live EditorView')

  // Grow back — the mark must be LIVE, not sticky, and geometry must be
  // exact again (full-height-by-construction, no lingering constraint).
  const grow = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { resizeContainer(w: number, h: number): Promise<{ ok: boolean }> } })
      .__layoutWorkbench.resizeContainer(1400, 900),
  )
  assert(grow.ok, 'reconcile must succeed after growing the container back')
  await assertFullHeightByConstruction(page, '2-leaf post-shrink-and-regrow')
  const clearedReport = await page.evaluate(() => ({
    d1Constrained: document.querySelector('[data-layout-node-id="D1"]')?.getAttribute('data-layout-constrained') ?? null,
    splitConstrained: document.querySelector('[data-layout-node-id="S-root"]')?.getAttribute('data-layout-constrained') ?? null,
  }))
  assert(clearedReport.d1Constrained === null, `data-layout-constrained must clear once the container fits again: ${JSON.stringify(clearedReport)}`)
  assert(clearedReport.splitConstrained === null, `the split's data-layout-constrained must clear too: ${JSON.stringify(clearedReport)}`)
  assert(
    (await page.evaluate(() => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
      ?.shadowRoot?.querySelector('.ProseMirror')?.textContent)) === 'hello from D1',
    'D1 content survives the shrink-then-regrow round trip',
  )
  console.log('[layout-workbench] (i) minimum constraints: a too-small container marks data-layout-constrained on leaf + ancestor split, allocates a positive emergency floor, never destroys a live view, and clears live once it fits again')

  // ── 3 leaves: D1 | (Q1 / D2), D2 is a SECOND leaf over the SAME doc-a ──
  await page.locator('[data-action="split-doc-a2"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 3)
  const d2Editor = page.locator('[data-layout-node-id="D2"] sh-editor-host .ProseMirror')
  await d2Editor.waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D2"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1')
  await assertFullHeightByConstruction(page, '3-leaf')

  const identity = await page.evaluate(() => {
    const d1Host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & {
      binding?: { get(): { provider?: unknown } }
      liveEditor?: unknown
    }) | null
    const d2Host = document.querySelector('[data-layout-node-id="D2"] sh-editor-host') as (HTMLElement & {
      binding?: { get(): { provider?: unknown } }
      liveEditor?: unknown
    }) | null
    const p1 = d1Host?.binding?.get().provider
    const p2 = d2Host?.binding?.get().provider
    const pm1 = d1Host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    const pm2 = d2Host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    return {
      sameProvider: Boolean(p1) && p1 === p2,
      distinctHosts: Boolean(d1Host) && Boolean(d2Host) && d1Host !== d2Host,
      // F3 (repair round 3): host + provider identity alone cannot see a
      // secretly-shared or secretly-lost INNER EditorView — assert the
      // liveEditor handles and .ProseMirror DOM nodes directly, both
      // non-null AND unequal.
      d1LiveEditorPresent: d1Host?.liveEditor != null,
      d2LiveEditorPresent: d2Host?.liveEditor != null,
      liveEditorsDistinct: d1Host?.liveEditor != null && d2Host?.liveEditor != null && d1Host.liveEditor !== d2Host.liveEditor,
      d1ProseMirrorPresent: pm1 != null,
      d2ProseMirrorPresent: pm2 != null,
      prosemirrorNodesDistinct: pm1 != null && pm2 != null && pm1 !== pm2,
    }
  })
  assert(identity.sameProvider, 'two leaves over the SAME document must share the exact same ProviderHandle object (identity, not deep-equal)')
  assert(identity.distinctHosts, 'two leaves over the same document must still mount DISTINCT sh-editor-host elements')
  // F3 (repair round 3): the weak identity assertion this repair addresses —
  // provider + outer-host identity alone is not enough (see the field-level
  // comments in the `page.evaluate` above).
  assert(identity.d1LiveEditorPresent, 'D1 must have a live liveEditor handle at the same-document checkpoint')
  assert(identity.d2LiveEditorPresent, 'D2 must have a live liveEditor handle at the same-document checkpoint')
  assert(identity.liveEditorsDistinct, 'two leaves over the SAME document must have DISTINCT liveEditor handles (each leaf owns its own EditorView over the shared provider)')
  assert(identity.d1ProseMirrorPresent, 'D1 must have a live .ProseMirror DOM node at the same-document checkpoint')
  assert(identity.d2ProseMirrorPresent, 'D2 must have a live .ProseMirror DOM node at the same-document checkpoint')
  assert(identity.prosemirrorNodesDistinct, 'two leaves over the SAME document must have DISTINCT .ProseMirror DOM nodes (each leaf renders its own EditorView body)')
  // Two-tier lifetime (resource-broker.ts's own design): the POOL sees exactly
  // ONE attachment per document key regardless of leaf count (the broker
  // dedupes concurrent layout leases so `adapter.load` — hence `pool.acquire`
  // — runs ONCE per key); the BROKER's OWN ref-count is what tracks "how many
  // LEAVES hold a lease" (2, for D1+D2). Assert both tiers precisely.
  let poolSnapshot = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { pool: { snapshot(): { roomCount: number; rooms: Array<{ documentId: string | null; refCount: number }> } } } })
      .__layoutWorkbench.pool.snapshot(),
  )
  const docARoom = poolSnapshot.rooms.find(r => r.documentId === DOC_A)
  assert(docARoom && docARoom.refCount === 1, `the pool must see exactly ONE attachment for doc-a (broker dedupes): ${JSON.stringify(poolSnapshot)}`)
  let brokerDiagnostics = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { broker: { diagnostics(): { durableRefCounts: Record<string, number> } } } })
      .__layoutWorkbench.broker.diagnostics(),
  )
  const docAKeyAt3Leaf = Object.keys(brokerDiagnostics.durableRefCounts).find(key => key.includes(DOC_A))
  assert(docAKeyAt3Leaf && brokerDiagnostics.durableRefCounts[docAKeyAt3Leaf] === 2, `the broker's own ref-count for doc-a must be 2 (D1+D2 both hold a layout lease): ${JSON.stringify(brokerDiagnostics)}`)
  console.log('[layout-workbench] 3-leaf: (a) identity proved — D1 and D2 share one provider object, distinct EditorViews; broker refCount == 2, pool attachments == 1')

  // ── nested 4-leaf: (D1 / D3) | (Q1 / D2) ────────────────────────────────
  await page.locator('[data-action="split-doc-b"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  const d3Editor = page.locator('[data-layout-node-id="D3"] sh-editor-host .ProseMirror')
  await d3Editor.waitFor({ state: 'visible', timeout: 15000 })
  await assertFullHeightByConstruction(page, 'nested 4-leaf')
  poolSnapshot = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { pool: { snapshot(): { roomCount: number; rooms: Array<{ documentId: string | null; refCount: number }> } } } })
      .__layoutWorkbench.pool.snapshot(),
  )
  assert(poolSnapshot.roomCount === 2, `expected two real rooms (doc-a, doc-b): ${JSON.stringify(poolSnapshot)}`)
  console.log('[layout-workbench] nested 4-leaf: D1|D3 beside Q1|D2, all four leaves full-height-by-construction')

  // Capture element identities BEFORE ancestor-move/move/swap for the
  // teardown-immunity proof. `liveEditor` (editor-host.ts's own SHIPPED
  // public handle, stable for exactly the underlying EditorView's lifetime —
  // see that file's own doc comment) is captured alongside the outer host
  // and the inner `.ProseMirror` node (diff-review r2 WRONG: "never captures
  // host.liveEditor... distinctEditorViewsOverSharedDoc is only
  // distinctHosts" — a host-only or DOM-only comparison cannot see a
  // teardown/rebuild that happens to reuse the same outer element).
  const preMoveIdentity = await page.evaluate(() => {
    const selectors = [
      '[data-layout-node-id="D1"] sh-editor-host',
      '[data-layout-node-id="D2"] sh-editor-host',
      '[data-layout-node-id="D3"] sh-editor-host',
    ]
    ;(window as unknown as { __captured: Record<string, unknown> }).__captured = {}
    const results = selectors.map((selector) => {
      const host = document.querySelector(selector) as (HTMLElement & { liveEditor?: unknown }) | null
      const inner = host?.shadowRoot?.querySelector('.ProseMirror') ?? null
      ;(window as unknown as { __captured: Record<string, unknown> }).__captured[selector] = host
      ;(window as unknown as { __captured: Record<string, unknown> }).__captured[`${selector}::inner`] = inner
      ;(window as unknown as { __captured: Record<string, unknown> }).__captured[`${selector}::liveEditor`] = host?.liveEditor ?? null
      return { hostTag: host?.tagName ?? null, hasLiveEditor: host?.liveEditor != null }
    })
    return { d1: results[0], d2: results[1], d3: results[2] }
  })
  assert(preMoveIdentity.d1.hostTag === 'SH-EDITOR-HOST', 'D1 face mounts sh-editor-host')
  assert(preMoveIdentity.d1.hasLiveEditor, 'D1 has a live liveEditor handle before any move')
  assert(preMoveIdentity.d3.hasLiveEditor, 'D3 has a live liveEditor handle before any move')

  // ── (b'') move_node on an ANCESTOR SPLIT (nodeId names a SPLIT, not a
  // leaf) — the shape only generic unit faces exercised before this proof
  // (diff-review r2 MISSING: "An ancestor-subtree move is covered only by
  // generic unit faces, not real browser editors"). Moves the WHOLE D1|D3
  // subtree to become a sibling of Q1 in one operation; BOTH D1 and D3 carry
  // real live EditorViews, so this is the strongest single check that moving
  // a subtree never disconnects/rebuilds anything beneath it.
  const ancestorSplitIdBefore = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { locateParent(id: string): { splitId?: string } | null } })
      .__layoutWorkbench.locateParent('D3'),
  )
  assert(ancestorSplitIdBefore && 'splitId' in ancestorSplitIdBefore, 'D3 has a real split parent before the ancestor move')
  const ancestorSplitId = (ancestorSplitIdBefore as { splitId: string }).splitId
  const ancestorMove = await page.evaluate((splitId) => {
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        locateParent(id: string): unknown
        applyOp(op: unknown): { ok: boolean; diagnostic?: unknown }
      }
    }).__layoutWorkbench
    const expectedParent = bridge.locateParent(splitId)
    const expectedTargetParent = bridge.locateParent('Q1')
    if (!expectedParent || !expectedTargetParent) return { ok: false, reason: 'no-parent' }
    return bridge.applyOp({
      op: 'move_node',
      nodeId: splitId,
      targetLeafId: 'Q1',
      side: 'start',
      axis: 'vertical',
      splitId: 'S-ancestor-move',
      expectedParent,
      expectedTargetParent,
    })
  }, ancestorSplitId)
  assert(ancestorMove.ok, `ancestor-split move_node(nodeId='${ancestorSplitId}') failed: ${JSON.stringify(ancestorMove)}`)
  await page.evaluate(() => (window as unknown as { __layoutWorkbench: { reconcile(): Promise<unknown> } }).__layoutWorkbench.reconcile())
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  await assertFullHeightByConstruction(page, 'post-ancestor-split-move 4-leaf')
  const postAncestorMoveParent = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { locateParent(id: string): { splitId?: string } | null } })
      .__layoutWorkbench.locateParent('D3'),
  )
  assert(
    postAncestorMoveParent && 'splitId' in postAncestorMoveParent && (postAncestorMoveParent as { splitId: string }).splitId === ancestorSplitId,
    `D3's split parent must survive the ancestor move BY REFERENCE (same splitId, not recreated): ${JSON.stringify(postAncestorMoveParent)}`,
  )
  const postAncestorMoveIdentity = await page.evaluate(() => {
    const captured = (window as unknown as { __captured: Record<string, unknown> }).__captured
    const d1Host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const d3Host = document.querySelector('[data-layout-node-id="D3"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    return {
      d1HostSame: d1Host === captured['[data-layout-node-id="D1"] sh-editor-host'],
      d1InnerSame: d1Host?.shadowRoot?.querySelector('.ProseMirror') === captured['[data-layout-node-id="D1"] sh-editor-host::inner'],
      d1LiveEditorSame: d1Host?.liveEditor != null && d1Host.liveEditor === captured['[data-layout-node-id="D1"] sh-editor-host::liveEditor'],
      d3HostSame: d3Host === captured['[data-layout-node-id="D3"] sh-editor-host'],
      d3InnerSame: d3Host?.shadowRoot?.querySelector('.ProseMirror') === captured['[data-layout-node-id="D3"] sh-editor-host::inner'],
      d3LiveEditorSame: d3Host?.liveEditor != null && d3Host.liveEditor === captured['[data-layout-node-id="D3"] sh-editor-host::liveEditor'],
    }
  })
  assert(postAncestorMoveIdentity.d1HostSame, 'ancestor-split move_node must NOT destroy D1\'s sh-editor-host element')
  assert(postAncestorMoveIdentity.d1InnerSame, 'ancestor-split move_node must NOT destroy/recreate D1\'s live ProseMirror DOM')
  assert(postAncestorMoveIdentity.d1LiveEditorSame, 'ancestor-split move_node must NOT destroy/recreate D1\'s liveEditor handle')
  assert(postAncestorMoveIdentity.d3HostSame, 'ancestor-split move_node must NOT destroy D3\'s sh-editor-host element (D3 is a DESCENDANT of the moved split, not the move target)')
  assert(postAncestorMoveIdentity.d3InnerSame, 'ancestor-split move_node must NOT destroy/recreate D3\'s live ProseMirror DOM')
  assert(postAncestorMoveIdentity.d3LiveEditorSame, 'ancestor-split move_node must NOT destroy/recreate D3\'s liveEditor handle')
  console.log('[layout-workbench] (b\'\') ancestor-split move_node: D1 AND D3 (both descendants of the moved split) survived by host + ProseMirror + liveEditor reference')

  // F2 (repair round 3): DOM-identity survival (above) is necessary but not
  // sufficient — this exact move minted a BRAND-NEW split wrapper
  // ('S-ancestor-move', box = the union of the whole moved subtree) which
  // could still visually paint OVER a preserved leaf and silently swallow
  // every click/keystroke aimed at it, even though the element reference
  // never changed underneath. Prove D1 is REALLY clickable/typeable right
  // after this move, not merely DOM-present, then restore its baseline text.
  await d1Editor.click()
  await page.keyboard.type(' post-move')
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1 post-move')
  await d1Editor.fill('hello from D1') // restore baseline text for downstream exact-match checks
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D1')
  console.log('[layout-workbench] (F2) split-wrapper pointer-events: D1 remained real-clickable/typeable after the ancestor-split move_node minted a brand-new split wrapper')

  // ── (b) MOVE does not destroy the EditorView or the sparql view ────────
  await page.locator('[data-action="move-sparql"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  await assertFullHeightByConstruction(page, 'post-move 4-leaf')
  const postMoveIdentity = await page.evaluate(() => {
    const captured = (window as unknown as { __captured: Record<string, unknown> }).__captured
    const d1Host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    return {
      d1HostSame: d1Host === captured['[data-layout-node-id="D1"] sh-editor-host'],
      d1LiveEditorSame: d1Host?.liveEditor != null && d1Host.liveEditor === captured['[data-layout-node-id="D1"] sh-editor-host::liveEditor'],
    }
  })
  assert(postMoveIdentity.d1HostSame, 'move_node must NOT destroy an unrelated leaf\'s EditorView element')
  assert(postMoveIdentity.d1LiveEditorSame, 'move_node must NOT destroy an unrelated leaf\'s liveEditor handle')
  console.log('[layout-workbench] (b) move_node: sparql view moved; D1 EditorView (host + liveEditor) survived by reference')

  // ── (b) SWAP does not destroy either EditorView ─────────────────────────
  await page.locator('[data-action="swap-d2-d3"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  await assertFullHeightByConstruction(page, 'post-swap 4-leaf')
  // Compare against the SAME `preMoveIdentity` capture used below for move —
  // host identity alone is not enough (diff-review WRONG: "later compares
  // only sh-editor-host references... also compare the already-captured
  // ::inner nodes after cross-parent swap"): a stable host whose
  // disconnectedCallback fired and reconnected would keep the OUTER element
  // reference but tear down and rebuild the INNER live ProseMirror
  // EditorView — exactly the failure mode a host-only comparison cannot see.
  const postSwapIdentity = await page.evaluate(() => {
    const captured = (window as unknown as { __captured: Record<string, unknown> }).__captured
    const d2Host = document.querySelector('[data-layout-node-id="D2"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const d3Host = document.querySelector('[data-layout-node-id="D3"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const d2Inner = d2Host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    const d3Inner = d3Host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    return {
      d2Same: d2Host === captured['[data-layout-node-id="D2"] sh-editor-host'],
      d3Same: d3Host === captured['[data-layout-node-id="D3"] sh-editor-host'],
      d2InnerSame: d2Inner != null && d2Inner === captured['[data-layout-node-id="D2"] sh-editor-host::inner'],
      d3InnerSame: d3Inner != null && d3Inner === captured['[data-layout-node-id="D3"] sh-editor-host::inner'],
      d2LiveEditorSame: d2Host?.liveEditor != null && d2Host.liveEditor === captured['[data-layout-node-id="D2"] sh-editor-host::liveEditor'],
      d3LiveEditorSame: d3Host?.liveEditor != null && d3Host.liveEditor === captured['[data-layout-node-id="D3"] sh-editor-host::liveEditor'],
    }
  })
  assert(postSwapIdentity.d2Same, 'swap_nodes must NOT destroy D2\'s EditorView element')
  assert(postSwapIdentity.d3Same, 'swap_nodes must NOT destroy D3\'s EditorView element')
  assert(postSwapIdentity.d2InnerSame, 'swap_nodes must NOT destroy/recreate D2\'s live ProseMirror EditorView DOM (exact reference, not just the outer host)')
  assert(postSwapIdentity.d3InnerSame, 'swap_nodes must NOT destroy/recreate D3\'s live ProseMirror EditorView DOM (exact reference, not just the outer host)')
  assert(postSwapIdentity.d2LiveEditorSame, 'swap_nodes must NOT destroy/recreate D2\'s liveEditor handle (exact reference)')
  assert(postSwapIdentity.d3LiveEditorSame, 'swap_nodes must NOT destroy/recreate D3\'s liveEditor handle (exact reference)')
  const contentAfterSwap = await page.evaluate(() => ({
    d2: document.querySelector('[data-layout-node-id="D2"] sh-editor-host')?.shadowRoot?.querySelector('.ProseMirror')?.textContent,
    d3: document.querySelector('[data-layout-node-id="D3"] sh-editor-host')?.shadowRoot?.querySelector('.ProseMirror')?.textContent,
  }))
  assert(contentAfterSwap.d2 === 'hello from D1', 'D2 still shows doc-a content after swap (leaf identity follows the node, not the slot)')
  console.log('[layout-workbench] (b) swap_nodes: D2 and D3 EditorViews both survived by reference')

  // ── (b') MOVE of a DOCUMENT leaf (not the provider-free sparql leaf) does
  // not destroy its EditorView — the identity proof the sparql-only move
  // above cannot stand in for (diff-review WRONG: "Assert the exact
  // liveEditor/ProseMirror reference for a document leaf moved across
  // parents"). Give
  // D3 real content first so a stale-but-reconnected EditorView (rather than
  // the true live one) would show up as lost text, not just a lost element.
  await d3Editor.click()
  await d3Editor.fill('hello from D3')
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D3"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'hello from D3')
  const preDocumentMoveIdentity = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D3"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const inner = host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    ;(window as unknown as { __d3Captured: { host: unknown; inner: unknown; liveEditor: unknown } }).__d3Captured = {
      host,
      inner,
      liveEditor: host?.liveEditor ?? null,
    }
    return { hasHost: host != null, hasInner: inner != null, hasLiveEditor: host?.liveEditor != null }
  })
  assert(preDocumentMoveIdentity.hasHost && preDocumentMoveIdentity.hasInner, 'D3 has a live host + ProseMirror body before the move')
  assert(preDocumentMoveIdentity.hasLiveEditor, 'D3 has a live liveEditor handle before the move')

  await page.locator('[data-action="move-d3-beside-d2"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  await assertFullHeightByConstruction(page, 'post-document-move 4-leaf')
  const postDocumentMoveIdentity = await page.evaluate(() => {
    const captured = (window as unknown as { __d3Captured: { host: unknown; inner: unknown; liveEditor: unknown } }).__d3Captured
    const host = document.querySelector('[data-layout-node-id="D3"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    const inner = host?.shadowRoot?.querySelector('.ProseMirror') ?? null
    return {
      hostSame: host === captured.host,
      innerSame: inner != null && inner === captured.inner,
      liveEditorSame: host?.liveEditor != null && host.liveEditor === captured.liveEditor,
      text: inner?.textContent ?? null,
    }
  })
  assert(postDocumentMoveIdentity.hostSame, 'move_node on a DOCUMENT leaf must NOT destroy its sh-editor-host element (identity preserved)')
  assert(postDocumentMoveIdentity.innerSame, 'move_node on a DOCUMENT leaf must NOT destroy/recreate its live ProseMirror EditorView DOM (exact reference preserved, not merely re-created with the same text)')
  assert(postDocumentMoveIdentity.liveEditorSame, 'move_node on a DOCUMENT leaf must NOT destroy/recreate its liveEditor handle (exact reference preserved)')
  assert(postDocumentMoveIdentity.text === 'hello from D3', 'D3 content survives move_node')
  console.log('[layout-workbench] (b\') move_node on a DOCUMENT leaf: host, live ProseMirror EditorView, AND liveEditor handle all survived by reference, content intact')

  // ── (e') a SECOND, independent sparql.bindings-table leaf (Q2) over the
  // SAME query text as Q1 — the derived-resource sibling of hoja.document's
  // "two leaves share one exact provider" proof (design §9.1 "Proving leaf
  // B": "no durable identity, no cross-leaf sharing"): unlike hoja.document,
  // TWO leaves over the identical query must NOT share a broker entry — each
  // gets its OWN independently computed result. Opened beside D2, verified,
  // then closed again so the leaf count returns to 4 for the assertions below.
  await page.locator('[data-action="split-sparql-second"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 5)
  const sparqlTable2 = page.locator('[data-layout-node-id="Q2"] sh-sparql-table-view')
  await sparqlTable2.waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(page, () => {
    const table = document.querySelector('[data-layout-node-id="Q2"] sh-sparql-table-view')
      ?.shadowRoot?.querySelector('table')
    return table != null && table.querySelectorAll('tbody tr').length > 0
  }, 15000)
  const q2Shape = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="Q2"] sh-sparql-table-view') as unknown as Record<string, unknown> | null
    const rows = host
      ? Array.from(((host as unknown as HTMLElement).shadowRoot?.querySelectorAll('tbody tr') ?? []))
      : []
    const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent) : []
    return {
      tag: (host as unknown as HTMLElement | null)?.tagName ?? null,
      hasBinding: host ? 'binding' in host : null,
      hasLiveEditor: host ? 'liveEditor' in host : null,
      hasProvider: host ? 'provider' in host : null,
      rowCount: rows.length,
      firstRowCells,
    }
  })
  assert(q2Shape.tag === 'SH-SPARQL-TABLE-VIEW', 'the Q2 leaf mounts sh-sparql-table-view, not an editor host')
  assert(q2Shape.hasBinding === false, 'sh-sparql-table-view carries no .binding (no provider-shaped state at all)')
  assert(q2Shape.hasLiveEditor === false, 'sh-sparql-table-view carries no .liveEditor')
  assert(q2Shape.hasProvider === false, 'sh-sparql-table-view carries no .provider')
  assert(q2Shape.rowCount > 0, `real SELECT against the real cell (across all named graphs) returned zero rows: ${JSON.stringify(q2Shape)}`)
  assert(q2Shape.firstRowCells.length === 4, `expected 4 bound columns (g,s,p,o) per row: ${JSON.stringify(q2Shape)}`)
  assert(q2Shape.firstRowCells.every((cell) => typeof cell === 'string' && cell.length > 0), `expected non-empty typed term text in every cell: ${JSON.stringify(q2Shape)}`)
  // Q1 and Q2 mount DISTINCT sh-sparql-table-view elements over the SAME
  // query text — the derived shape's "no cross-leaf sharing" made concrete.
  const distinctSparqlViews = await page.evaluate(() => {
    const q1 = document.querySelector('[data-layout-node-id="Q1"] sh-sparql-table-view')
    const q2 = document.querySelector('[data-layout-node-id="Q2"] sh-sparql-table-view')
    return q1 != null && q2 != null && q1 !== q2
  })
  assert(distinctSparqlViews, 'Q1 and Q2 (same query text) must mount DISTINCT sh-sparql-table-view elements — derived resources are never shared')
  console.log(`[layout-workbench] (e') a SECOND independent sparql.bindings-table leaf (same query text as Q1): ${q2Shape.rowCount} row(s), distinct element from Q1, no provider/binding/liveEditor present`)

  const closeQ2 = await page.evaluate(async () => {
    const bridge = (window as unknown as { __layoutWorkbench: { closeLeaf(id: string): { ok: boolean }; reconcile(): Promise<{ ok: boolean }> } }).__layoutWorkbench
    const outcome = bridge.closeLeaf('Q2')
    if (!outcome.ok) return outcome
    const reconciled = await bridge.reconcile()
    return { ok: reconciled.ok }
  })
  assert(closeQ2.ok, 'closing the Q2 sparql leaf must succeed')
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 4)
  await assertFullHeightByConstruction(page, 'post-close-q2 4-leaf')

  // ── (c) close_leaf teardown: one release survives, the last disposes once ──
  const docAProviderBeforeClose = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1"] sh-editor-host') as (HTMLElement & {
      binding?: { get(): { provider?: unknown } }
    }) | null
    return Boolean(host?.binding?.get().provider)
  })
  assert(docAProviderBeforeClose, 'D1 has a live provider before any close')

  // ── F4 (repair round 3): close/promote focus handoff ────────────────────
  // Give D2 REAL DOM focus the same way a user would (a genuine Playwright
  // click into its live ProseMirror body — not `interpreter.focus()`), then
  // independently RECOMPUTE (read-only, from the pre-close document tree)
  // which leaf `close_leaf` will promote into D2's slot — purely so this
  // test has something to assert against. This computed value is NEVER fed
  // into the close operation or any focus call; `closeLeafAction` in
  // layout-workbench-main.ts calls only `applyOp({op:'close_leaf',...})` +
  // `reconcile()`, never `interpreter.focus()` — so if DOM focus lands on
  // the promoted sibling below, that happened entirely on the interpreter's
  // OWN initiative (`LayoutInterpreter.handleFocusHandoff`), never because
  // this proof told it where to go.
  await d2Editor.click()
  const d2HasFocusBeforeClose = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D2"] sh-editor-host') as HTMLElement | null
    return document.activeElement === host
  })
  assert(d2HasFocusBeforeClose, 'D2 must hold real DOM focus before it is closed (focus-handoff proof precondition)')
  const expectedPromotedLeafId = await page.evaluate(() => {
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        getDoc(): { nodes: Record<string, { kind: string; id: string; startNodeId?: string; endNodeId?: string }> }
        locateParent(id: string): { kind: string; splitId?: string } | null
      }
    }).__layoutWorkbench
    const nodes = bridge.getDoc().nodes
    const parent = bridge.locateParent('D2')
    if (!parent || parent.kind !== 'child' || !parent.splitId) return null
    const split = nodes[parent.splitId] as { startNodeId: string; endNodeId: string }
    let siblingId = split.startNodeId === 'D2' ? split.endNodeId : split.startNodeId
    let current = nodes[siblingId]
    // Deterministic "leftmost leaf" descent — mirrors
    // LayoutInterpreter.promotedSiblingLeafId exactly, read-only, never used
    // to DRIVE the close or any focus call.
    while (current && current.kind === 'split') {
      siblingId = (current as unknown as { startNodeId: string }).startNodeId
      current = nodes[siblingId]
    }
    return current ? siblingId : null
  })
  assert(expectedPromotedLeafId, 'D2 has a computable promoted sibling before it is closed')
  console.log(`[layout-workbench] (F4) D2 focused; closing it should promote sibling '${expectedPromotedLeafId}' into its slot`)

  // Trigger the close via the SAME programmatic bridge route Q2's close
  // above already uses (`bridge.closeLeaf` + `bridge.reconcile`), NOT the
  // `[data-action="close-d2"]` harness debug BUTTON used later for the
  // pool/broker-refcount proof below. That button lives outside the layout
  // tree entirely, and a real Chromium mousedown/click on ANY button moves
  // DOM focus onto the button itself BEFORE its click handler ever runs —
  // an artifact of clicking harness debug chrome, not something the
  // interpreter's close/promote logic could or should compensate for (a
  // real close affordance — a keyboard shortcut, or a control living INSIDE
  // the leaf's own chrome — would not evict focus first). Driving the same
  // `applyOperation({op:'close_leaf',...})` + `reconcile()` pair
  // programmatically proves the interpreter's OWN handoff without that
  // harness artifact confounding the result.
  await page.evaluate(async () => {
    const bridge = (window as unknown as {
      __layoutWorkbench: { closeLeaf(id: string): { ok: boolean }; reconcile(): Promise<{ ok: boolean }> }
    }).__layoutWorkbench
    const outcome = bridge.closeLeaf('D2')
    if (!outcome.ok) throw new Error(`bridge.closeLeaf('D2') failed: ${JSON.stringify(outcome)}`)
    const reconciled = await bridge.reconcile()
    if (!reconciled.ok) throw new Error(`reconcile after closing D2 failed: ${JSON.stringify(reconciled)}`)
  })
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 3)

  // Observe document.activeElement — no destination supplied here, no
  // interpreter.focus() call anywhere in this proof for D2's close.
  const focusHandoff = await page.evaluate((expectedId) => {
    const active = document.activeElement
    const host = expectedId
      ? document.querySelector(
          `[data-layout-node-id="${expectedId}"] sh-editor-host, ` +
          `[data-layout-node-id="${expectedId}"] sh-sparql-table-view, ` +
          `[data-layout-node-id="${expectedId}"] sh-home-view`,
        )
      : null
    return {
      expectedHostFound: host != null,
      activeIsExpectedHost: active === host,
      activeTag: active?.tagName ?? null,
      activeLeafId: active?.closest('[data-layout-node-kind="leaf"]')?.getAttribute('data-layout-node-id') ?? null,
    }
  }, expectedPromotedLeafId)
  assert(focusHandoff.expectedHostFound, `the promoted leaf '${expectedPromotedLeafId}' must have a live host element after D2 closes: ${JSON.stringify(focusHandoff)}`)
  assert(
    focusHandoff.activeIsExpectedHost,
    `closing the FOCUSED leaf D2 must hand real DOM focus to its promoted sibling ('${expectedPromotedLeafId}'), with no destination supplied by this test: ${JSON.stringify(focusHandoff)}`,
  )
  console.log(`[layout-workbench] (F4) close/promote focus handoff PROVEN: closing focused D2 moved document.activeElement onto promoted sibling '${expectedPromotedLeafId}' (${focusHandoff.activeTag}), entirely on the interpreter's own initiative — zoom is NOT built/exercised (deliberately deferred, see this file's header)`)

  poolSnapshot = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { pool: { snapshot(): { roomCount: number; rooms: Array<{ documentId: string | null; refCount: number }> } } } })
      .__layoutWorkbench.pool.snapshot(),
  )
  const docARoomAfterD2 = poolSnapshot.rooms.find(r => r.documentId === DOC_A)
  assert(docARoomAfterD2, `closing D2 must leave doc-a's real room alive: ${JSON.stringify(poolSnapshot)}`)
  brokerDiagnostics = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { broker: { diagnostics(): { durableRefCounts: Record<string, number> } } } })
      .__layoutWorkbench.broker.diagnostics(),
  )
  let docAKeyNow = Object.keys(brokerDiagnostics.durableRefCounts).find(key => key.includes(DOC_A))
  assert(docAKeyNow && brokerDiagnostics.durableRefCounts[docAKeyNow] === 1, `closing D2 (not the last doc-a leaf) must drop the broker's ref-count to 1 (D1 still live): ${JSON.stringify(brokerDiagnostics)}`)
  await assertFullHeightByConstruction(page, 'post-close-D2 3-leaf')
  console.log('[layout-workbench] (c) closing D2 (not the last doc-a leaf) leaves the real room alive, broker refCount 2 -> 1')

  await page.locator('[data-action="close-d1"]').click()
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 2)
  poolSnapshot = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { pool: { snapshot(): { roomCount: number; rooms: Array<{ documentId: string | null; refCount: number }> } } } })
      .__layoutWorkbench.pool.snapshot(),
  )
  const docARoomAfterD1 = poolSnapshot.rooms.find(r => r.documentId === DOC_A)
  assert(!docARoomAfterD1, `closing D1 (the LAST doc-a leaf) must fully release the real room: ${JSON.stringify(poolSnapshot)}`)
  brokerDiagnostics = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { broker: { diagnostics(): { durableRefCounts: Record<string, number> } } } })
      .__layoutWorkbench.broker.diagnostics(),
  )
  docAKeyNow = Object.keys(brokerDiagnostics.durableRefCounts).find(key => key.includes(DOC_A))
  assert(!docAKeyNow, `the broker's own ref-count for doc-a must also be gone after the last release: ${JSON.stringify(brokerDiagnostics)}`)
  await assertFullHeightByConstruction(page, 'post-close-D1 2-leaf')
  console.log('[layout-workbench] (c) closing D1 (the last doc-a leaf) disposed the real provider exactly once — room AND broker ref-count both gone')

  // Reopening the same document afterward proves the old provider was truly
  // torn down (a stale-but-reused handle would be a silent double-provider bug).
  const reopen = await page.evaluate(async () => {
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        splitLeaf(args: { leafId: string; axis: string; side: string; newLeafId: string; splitId: string; descriptor: unknown }): { ok: boolean }
        reconcile(): Promise<{ ok: boolean }>
        getDoc(): { nodes: Record<string, { kind: string }> }
      }
    }).__layoutWorkbench
    const leafId = Object.keys(bridge.getDoc().nodes).find(id => bridge.getDoc().nodes[id]!.kind === 'leaf')!
    const outcome = bridge.splitLeaf({
      leafId,
      axis: 'horizontal',
      side: 'end',
      newLeafId: 'D1-reopened',
      splitId: 'S-reopen',
      descriptor: { schemaVersion: 1, faceId: 'hoja.document', resource: { kind: 'document', graphId: 'layout-workbench-proof', documentId: 'doc-a' } },
    })
    if (!outcome.ok) return { ok: false }
    const result = await bridge.reconcile()
    return { ok: result.ok }
  })
  assert(reopen.ok, 'reopening doc-a after full teardown must succeed cleanly')
  await waitFor(page, () => document.querySelector('[data-layout-node-id="D1-reopened"] sh-editor-host')
    ?.shadowRoot?.querySelector('.ProseMirror') != null)
  const reopenedIsFresh = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="D1-reopened"] sh-editor-host') as (HTMLElement & {
      binding?: { get(): { provider?: unknown } }
    }) | null
    const provider = host?.binding?.get().provider
    // A truly torn-down room mints a FRESH Y.Doc; the reopened editor starts
    // empty rather than inheriting the closed leaf's in-memory text.
    const text = host?.shadowRoot?.querySelector('.ProseMirror')?.textContent ?? '__unknown__'
    return { hasProvider: Boolean(provider), text }
  })
  assert(reopenedIsFresh.hasProvider, 'reopening doc-a mounts a fresh real provider')
  console.log(`[layout-workbench] reopening doc-a after full teardown works cleanly (fresh editor text: ${JSON.stringify(reopenedIsFresh.text)})`)

  // ── (f) close ALL the way down to the last leaf → real sophia.home
  // fallback (LAY-010; design §9.2's "close-last-leaf → sophia.home fallback
  // proof" — never yet exercised in a real browser). Topology-agnostic: keep
  // closing WHATEVER leaf id happens to be first in the current document
  // until exactly one remains, then close that one too — LAY-010 says the
  // ROOT leaf's close REPLACES its descriptor rather than removing it, so the
  // layout keeps exactly one leaf, honestly rendering "nothing is open".
  const closeToHome = await page.evaluate(async () => {
    // Iterative, NO named nested function/const-arrow bindings (this file's
    // own `planLeafBoxes` doc comment: tsx/esbuild's dev transform wraps
    // those in a module-scoped `__name(...)` helper that page.evaluate's
    // fn.toString() serialization cannot see, throwing "__name is not
    // defined" in the browser) — `leafIds` is recomputed inline each pass
    // via a plain loop, not a closure.
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        getDoc(): { rootNodeId: string; nodes: Record<string, { kind: string; id: string; descriptor?: { faceId: string } }> }
        closeLeaf(id: string): { ok: boolean; diagnostic?: unknown }
        reconcile(): Promise<{ ok: boolean }>
      }
    }).__layoutWorkbench
    const closeLog: Array<{ id: string; ok: boolean; remainingAfter: number }> = []
    // Close every leaf but the last one first (interior closes — sibling promotion).
    for (;;) {
      const currentLeafIds: string[] = []
      for (const node of Object.values(bridge.getDoc().nodes)) {
        if (node.kind === 'leaf') currentLeafIds.push(node.id)
      }
      if (currentLeafIds.length <= 1) break
      const id = currentLeafIds[0]!
      const outcome = bridge.closeLeaf(id)
      if (!outcome.ok) return { ok: false, closeLog, failedAt: id, diagnostic: outcome.diagnostic }
      const reconciled = await bridge.reconcile()
      if (!reconciled.ok) return { ok: false, closeLog, failedAt: `${id}:reconcile` }
      let remainingAfter = 0
      for (const node of Object.values(bridge.getDoc().nodes)) {
        if (node.kind === 'leaf') remainingAfter += 1
      }
      closeLog.push({ id, ok: true, remainingAfter })
    }
    // Exactly one leaf remains — close IT (the root; LAY-010's replacement path).
    let lastId = ''
    for (const node of Object.values(bridge.getDoc().nodes)) {
      if (node.kind === 'leaf') lastId = node.id
    }
    const outcome = bridge.closeLeaf(lastId)
    if (!outcome.ok) return { ok: false, closeLog, failedAt: lastId, diagnostic: outcome.diagnostic }
    const reconciled = await bridge.reconcile()
    if (!reconciled.ok) return { ok: false, closeLog, failedAt: `${lastId}:reconcile` }
    const doc = bridge.getDoc()
    const rootNode = doc.nodes[doc.rootNodeId]
    let finalLeafCount = 0
    for (const node of Object.values(doc.nodes)) {
      if (node.kind === 'leaf') finalLeafCount += 1
    }
    return {
      ok: true,
      closeLog,
      lastId,
      finalLeafCount,
      finalRootFaceId: rootNode?.descriptor?.faceId ?? null,
    }
  })
  assert(closeToHome.ok, `closing every leaf down to sophia.home failed: ${JSON.stringify(closeToHome)}`)
  assert(closeToHome.finalLeafCount === 1, `expected exactly one leaf to remain (LAY-010): ${JSON.stringify(closeToHome)}`)
  assert(closeToHome.finalRootFaceId === 'sophia.home', `expected the last leaf's descriptor to be replaced with sophia.home, got '${closeToHome.finalRootFaceId}': ${JSON.stringify(closeToHome)}`)
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 1)
  const homeFallback = await page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll('[data-layout-node-kind="leaf"]'))
    const wrapper = wrappers[0] as HTMLElement | undefined
    const view = wrapper?.querySelector('sh-home-view') as unknown as Record<string, unknown> | null
    const label = (view as unknown as HTMLElement | null)?.shadowRoot?.querySelector('.label')?.textContent ?? null
    return { wrapperCount: wrappers.length, hasHomeView: view != null, label }
  })
  assert(homeFallback.wrapperCount === 1, `expected exactly one leaf wrapper in the DOM: ${JSON.stringify(homeFallback)}`)
  assert(homeFallback.hasHomeView, `expected the last leaf to render a real <sh-home-view>, not an error/blank pane: ${JSON.stringify(homeFallback)}`)
  assert(homeFallback.label === 'Nothing is open here', `expected the real sophia.home body text: ${JSON.stringify(homeFallback)}`)
  await assertFullHeightByConstruction(page, 'sophia.home fallback (1 leaf)')
  console.log(`[layout-workbench] (f) closed every leaf down to one; the root leaf's descriptor was replaced with the real, rendered sophia.home fallback (${closeToHome.closeLog.length} interior closes + 1 root close)`)

  // ── Wave 1: doc.history beside the live document it diffs ────────────────
  // (north star §2.2/§3, the cataloguer's own named first case). ONE split —
  // a real hoja.document leaf editing DOC_HISTORY_DOC on one side, a real
  // doc.history leaf over the SAME document on the other: type into the live
  // editor, capture a REAL snapshot boundary through the REAL
  // <mn-doc-history-panel>'s own Save button (a genuine POST against the real
  // cell), then assert the history panel shows the real snapshot list/diff
  // beside the still-live editor, with NEITHER leaf ever remounting.
  const docHistoryRootLeafId = await page.evaluate(() =>
    (window as unknown as { __layoutWorkbench: { getDoc(): { rootNodeId: string } } }).__layoutWorkbench.getDoc().rootNodeId,
  )
  const docHistoryRootRevision = await page.evaluate(
    (leafId) =>
      (window as unknown as { __layoutWorkbench: { getDoc(): { nodes: Record<string, { descriptorRevision: number }> } } })
        .__layoutWorkbench.getDoc().nodes[leafId]!.descriptorRevision,
    docHistoryRootLeafId,
  )
  const becameEditor = await page.evaluate(({ leafId, revision, graphId, documentId }) => {
    const bridge = (window as unknown as {
      __layoutWorkbench: { applyOp(op: unknown): { ok: boolean; diagnostic?: unknown }; reconcile(): Promise<{ ok: boolean }> }
    }).__layoutWorkbench
    return bridge.applyOp({
      op: 'replace_descriptor',
      leafId,
      descriptor: { schemaVersion: 1, faceId: 'hoja.document', resource: { kind: 'document', graphId, documentId } },
      expectedDescriptorRevision: revision,
    })
  }, { leafId: docHistoryRootLeafId, revision: docHistoryRootRevision, graphId: GRAPH_ID, documentId: DOC_HISTORY_DOC })
  assert(becameEditor.ok, `replacing sophia.home with hoja.document over ${DOC_HISTORY_DOC} failed: ${JSON.stringify(becameEditor)}`)
  await page.evaluate(() => (window as unknown as { __layoutWorkbench: { reconcile(): Promise<unknown> } }).__layoutWorkbench.reconcile())

  const splitIntoHistory = await page.evaluate(({ leafId, graphId, documentId }) => {
    const bridge = (window as unknown as {
      __layoutWorkbench: {
        splitLeaf(args: { leafId: string; axis: string; side: string; newLeafId: string; splitId: string; descriptor: unknown }): { ok: boolean; diagnostic?: unknown }
        reconcile(): Promise<{ ok: boolean }>
      }
    }).__layoutWorkbench
    const outcome = bridge.splitLeaf({
      leafId,
      axis: 'horizontal',
      side: 'end',
      newLeafId: 'HDOC',
      splitId: 'S-history-proof',
      descriptor: { schemaVersion: 1, faceId: 'doc.history', resource: { kind: 'document', graphId, documentId } },
    })
    return outcome
  }, { leafId: docHistoryRootLeafId, graphId: GRAPH_ID, documentId: DOC_HISTORY_DOC })
  assert(splitIntoHistory.ok, `splitting into a real doc.history leaf failed: ${JSON.stringify(splitIntoHistory)}`)
  await page.evaluate(() => (window as unknown as { __layoutWorkbench: { reconcile(): Promise<unknown> } }).__layoutWorkbench.reconcile())
  await waitFor(page, () => document.querySelectorAll('[data-layout-node-kind="leaf"]').length === 2)
  console.log(`[layout-workbench] doc.history: split '${docHistoryRootLeafId}' (hoja.document/${DOC_HISTORY_DOC}) -> +'HDOC' (doc.history/${DOC_HISTORY_DOC}), same document, two real leaves`)

  const dhEditor = page.locator(`[data-layout-node-id="${docHistoryRootLeafId}"] sh-editor-host .ProseMirror`)
  await dhEditor.waitFor({ state: 'visible', timeout: 15000 })
  const dhPanel = page.locator('[data-layout-node-id="HDOC"] mn-doc-history-panel')
  await dhPanel.waitFor({ state: 'attached', timeout: 15000 })
  await waitFor(page, () => (document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as { status?: string } | null)?.status === 'ready', 15000)
  // The seed `write_document` call (this file's own seeding step) already
  // minted ONE real automatic snapshot (tier `20min`) — the panel's REAL
  // snapshot list already reflects it, fetched from the real cell.
  const dhSeedSnapshotCount = await page.evaluate(() =>
    ((document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as { snapshots: readonly unknown[] }).snapshots.length),
  )
  assert(dhSeedSnapshotCount >= 1, `expected the seed write_document's own automatic snapshot to already be listed: got ${dhSeedSnapshotCount}`)
  console.log(`[layout-workbench] doc.history: real <mn-doc-history-panel> mounted, status=ready, ${dhSeedSnapshotCount} real snapshot(s) already listed from the real cell (the seed write's own automatic one)`)

  // Capture BEFORE identities — the whole point of "beside", not "instead of".
  const dhIdentityCapture = await page.evaluate((editorLeafId) => {
    const editorHost = document.querySelector(`[data-layout-node-id="${editorLeafId}"] sh-editor-host`) as (HTMLElement & { liveEditor?: unknown }) | null
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as HTMLElement | null
    const hiddenHost = document.querySelector('[data-layout-node-id="HDOC"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    ;(window as unknown as { __dhCaptured: Record<string, unknown> }).__dhCaptured = {
      editorHost,
      editorLiveEditor: editorHost?.liveEditor ?? null,
      panel,
      hiddenHost,
      hiddenHostLiveEditor: hiddenHost?.liveEditor ?? null,
    }
    return {
      hasEditorHost: editorHost != null,
      hasEditorLiveEditor: editorHost?.liveEditor != null,
      hasPanel: panel != null,
      hasHiddenHost: hiddenHost != null,
      hiddenHostIsNotVisibleEditor: hiddenHost !== editorHost,
    }
  }, docHistoryRootLeafId)
  assert(dhIdentityCapture.hasEditorHost && dhIdentityCapture.hasEditorLiveEditor, 'the visible hoja.document leaf has a live editor before any doc.history interaction')
  assert(dhIdentityCapture.hasPanel, 'the doc.history leaf mounted a real <mn-doc-history-panel>')
  assert(dhIdentityCapture.hasHiddenHost && dhIdentityCapture.hiddenHostIsNotVisibleEditor, 'doc.history mounted its OWN hidden companion <sh-editor-host>, distinct from the visible editor leaf\'s host')

  // Type real text into the live editor through the real ProseMirror view.
  await dhEditor.click()
  await dhEditor.fill('doc.history proof v1')
  // NOTE: `waitFor`'s predicate is serialized via `.toString()` and evaluated
  // FRESH in the browser (no Node closure survives that trip — this file's
  // own `planLeafBoxes` doc comment names the analogous named-function-wrapper
  // trap; an outer Node variable reference is the same trap in a different
  // shape) — `page.waitForFunction`'s own `arg` parameter is the real fix,
  // used here and everywhere else in this section that needs
  // `docHistoryRootLeafId` inside a browser-evaluated predicate.
  await page.waitForFunction((leafId) => document.querySelector(`[data-layout-node-id="${leafId}"] sh-editor-host`)
    ?.shadowRoot?.querySelector('.ProseMirror')?.textContent === 'doc.history proof v1', docHistoryRootLeafId, { timeout: 15000 })
  // The SAME shared Y.Doc, read through doc.history's own hidden companion
  // host's REAL liveEditor.getText() — no parallel text extraction.
  await waitFor(page, () => {
    const hidden = document.querySelector('[data-layout-node-id="HDOC"] sh-editor-host') as (HTMLElement & { liveEditor?: { getText(): string } | null }) | null
    return (hidden?.liveEditor?.getText() ?? '') === 'doc.history proof v1'
  }, 15000)
  console.log('[layout-workbench] doc.history: live edit in the visible leaf is immediately visible through doc.history\'s hidden companion host (shared Y.Doc, same document)')

  // Capture a REAL snapshot boundary — click the REAL Save button inside the
  // REAL <mn-doc-history-panel>'s shadow DOM. A genuine POST against the real
  // gardend cell's `/v1/documents/{graphId}/{documentId}/snapshots` route.
  //
  // REAL-MECHANICS FINDING: `loopback_hosted_create_manual_document_snapshot`
  // snapshots the document's own PERSISTED (last-flushed) state, not the live
  // in-memory CRDT session — so this manual snapshot's own text is the SEED
  // write's "seed content for doc-history proof", not the "doc.history proof
  // v1" just typed above (which is live-but-unflushed at click time; gardend
  // relies on its own periodic auto-flush, which this proof does not wait
  // out). An explicit flush-before-save was tried and DROPPED: issuing
  // `POST /documents/{g}/{d}/flush` while this document's hocuspocus session
  // is live reproducibly breaks that WebSocket (`Invalid frame header`) on
  // this build — a real, worth-flagging rough edge, not a mock-avoidance
  // workaround. The proof below asserts the REAL (persisted) snapshot text
  // instead of fighting that edge: the diff is still real, still shows a real
  // divergence, and doc.history's own "Live (now)" row is exactly the escape
  // hatch a real user has for "what's unflushed right now" in the meantime.
  const saveButton = page.locator('[data-layout-node-id="HDOC"] mn-doc-history-panel')
    .locator('.rail-header .ghost-button', { hasText: 'Save' })
  await saveButton.click()
  await page.waitForFunction((expectedCount) => {
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as { snapshots?: readonly unknown[] } | null
    return (panel?.snapshots?.length ?? 0) === expectedCount
  }, dhSeedSnapshotCount + 1, { timeout: 15000 })
  // The backend lists newest-first (`document_history_hosted.rs`'s own
  // `Reverse(history_sort_key(...))` sort) — the just-created MANUAL
  // snapshot is therefore index 0, ahead of the seed's older automatic one.
  const savedSnapshot = await page.evaluate(() =>
    ((document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as { snapshots: readonly { id: string; isManual?: boolean }[] }).snapshots[0]!),
  )
  const savedSnapshotId = savedSnapshot.id
  assert(savedSnapshot.isManual === true, `expected the just-clicked Save button to produce a MANUAL snapshot at index 0: ${JSON.stringify(savedSnapshot)}`)
  console.log(`[layout-workbench] doc.history: REAL snapshot captured via the real Save button (POST to the real cell) — snapshot id '${savedSnapshotId}'`)

  // wave1 review r1 SUSPECT fix: assert the real RENDERED rail — row count
  // and the manual label — not just the panel's `.snapshots` property. Row 0
  // is always the synthetic "Live (now)" row (`_rows()`'s own header
  // comment), so the real rendered count is snapshots + 1.
  const railRowCount = await page.locator('[data-layout-node-id="HDOC"] mn-doc-history-panel').locator('.rail-row').count()
  assert(railRowCount === dhSeedSnapshotCount + 2, `expected ${dhSeedSnapshotCount + 2} rendered rail rows (live + ${dhSeedSnapshotCount + 1} snapshots): got ${railRowCount}`)
  const savedRow = page.locator('[data-layout-node-id="HDOC"] mn-doc-history-panel').locator('.rail-row').nth(1)
  await savedRow.waitFor({ state: 'visible', timeout: 15000 })
  const savedRowLabel = (await savedRow.locator('.row-label').textContent())?.trim() ?? ''
  assert(savedRowLabel.startsWith('Manual: '), `expected the real rendered row label to carry the "Manual: " prefix `
    + `(mn-doc-history-panel.ts's own _renderRow): got '${savedRowLabel}'`)

  // Select the real saved snapshot as "older" (against the default "newer" =
  // live) via a REAL click on the REAL rail row — the same
  // `mn-doc-history-cursor-change` intent a human user fires. The live text
  // (typed above, still only in-session) already diverges from the
  // snapshot's real persisted text — a genuine diff, not "no changes".
  await savedRow.click()
  await waitFor(page, () => {
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as { diffStatus?: string } | null
    return panel?.diffStatus === 'ready'
  }, 15000)
  // The real rendered selection — `data-cursor` on the clicked row now
  // carries 'older' (mn-doc-history-panel.ts's own `_renderRow`), not just
  // the panel's own `.olderId` property.
  const savedRowCursor = await savedRow.getAttribute('data-cursor')
  assert(savedRowCursor?.includes('older') === true, `expected the real rendered row's data-cursor to include 'older' after the click: got '${savedRowCursor}'`)
  const diffState = await page.evaluate(() => {
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as {
      olderId: string
      olderText: string
      newerText: string
    }
    return { olderId: panel.olderId, olderText: panel.olderText, newerText: panel.newerText }
  })
  assert(diffState.olderId === savedSnapshotId, `expected the panel's olderId to be the real saved snapshot: ${JSON.stringify(diffState)}`)
  // Older = the real snapshot's real PERSISTED text (this section's own
  // "REAL-MECHANICS FINDING" comment above), fetched from the real cell.
  assert(diffState.olderText === 'seed content for doc-history proof', `expected the real snapshot TEXT (fetched from the real cell) as the older side: ${JSON.stringify(diffState)}`)
  // Newer = the real LIVE text, read through doc.history's own hidden
  // companion host — the still-unflushed edit typed above.
  assert(diffState.newerText === 'doc.history proof v1', `expected the real LIVE text (read through the hidden host) as the newer side: ${JSON.stringify(diffState)}`)

  // Assert the panel actually RENDERED real diff lines for BOTH sides of the
  // divergence — not just internal state (real Lit render, real
  // diffHistoryLines output). wave1 review r1 SUSPECT fix: the original proof
  // only asserted the "newer"/added side; a removed/older-side rendering bug
  // (e.g. `line.older` never interpolated) would have passed unnoticed.
  // NOTE: no const-assigned arrow helpers inside page.evaluate — esbuild's
  // keep-names transform wraps those in a `__name(...)` call, which Playwright
  // serializes into the browser context where the helper doesn't exist
  // (ReferenceError: __name is not defined). Inline arguments are safe.
  const diffLineTexts = await page.evaluate(() => {
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel') as unknown as HTMLElement
    const out: { added: string[]; removed: string[]; changed: string[] } = { added: [], removed: [], changed: [] }
    for (const kind of ['added', 'removed', 'changed'] as const) {
      out[kind] = Array.from(panel.shadowRoot?.querySelectorAll(`.diff-line[data-kind="${kind}"]`) ?? [])
        .map((el) => el.textContent?.trim() ?? '')
    }
    return out
  })
  const addedOrChanged = [...diffLineTexts.added, ...diffLineTexts.changed]
  const removedOrChanged = [...diffLineTexts.removed, ...diffLineTexts.changed]
  assert(addedOrChanged.some((text) => text.includes('doc.history proof v1')), `expected a real rendered diff line containing the live (newer) divergence: ${JSON.stringify(diffLineTexts)}`)
  assert(removedOrChanged.some((text) => text.includes('seed content for doc-history proof')), `expected a real rendered diff line containing the persisted (older) snapshot text: ${JSON.stringify(diffLineTexts)}`)
  console.log('[layout-workbench] doc.history: real diff rendered beside the live editor — older = real fetched (persisted) snapshot text, newer = real live text read through the shared Y.Doc, both from the SAME document, both sides independently rendered')

  // ── Neither leaf remounted, at any point in this whole section ──────────
  const dhAfterIdentity = await page.evaluate((editorLeafId) => {
    const captured = (window as unknown as { __dhCaptured: Record<string, unknown> }).__dhCaptured
    const editorHost = document.querySelector(`[data-layout-node-id="${editorLeafId}"] sh-editor-host`) as (HTMLElement & { liveEditor?: unknown }) | null
    const panel = document.querySelector('[data-layout-node-id="HDOC"] mn-doc-history-panel')
    const hiddenHost = document.querySelector('[data-layout-node-id="HDOC"] sh-editor-host') as (HTMLElement & { liveEditor?: unknown }) | null
    return {
      editorHostSame: editorHost === captured.editorHost,
      editorLiveEditorSame: editorHost?.liveEditor != null && editorHost.liveEditor === captured.editorLiveEditor,
      panelSame: panel === captured.panel,
      hiddenHostSame: hiddenHost === captured.hiddenHost,
      hiddenHostLiveEditorSame: hiddenHost?.liveEditor != null && hiddenHost.liveEditor === captured.hiddenHostLiveEditor,
    }
  }, docHistoryRootLeafId)
  assert(dhAfterIdentity.editorHostSame, 'the visible hoja.document leaf\'s host must NOT have remounted across the whole doc.history interaction')
  assert(dhAfterIdentity.editorLiveEditorSame, 'the visible hoja.document leaf\'s liveEditor handle must NOT have been recreated')
  assert(dhAfterIdentity.panelSame, 'the doc.history leaf\'s <mn-doc-history-panel> must NOT have remounted')
  assert(dhAfterIdentity.hiddenHostSame, 'doc.history\'s own hidden companion host must NOT have remounted')
  assert(dhAfterIdentity.hiddenHostLiveEditorSame, 'doc.history\'s hidden companion liveEditor handle must NOT have been recreated')
  console.log('[layout-workbench] doc.history: NEITHER leaf remounted at any point — split, type, save, select, diff all landed on the SAME live views throughout')

  // ── Screenshot artifact, saved OUTSIDE the repo tree ─────────────────────
  const screenshotDir = process.env.SHRUBBERY_LAYOUT_WORKBENCH_SCREENSHOT_DIR ?? resolve(tmpdir(), 'shrubbery-layout-workbench')
  mkdirSync(screenshotDir, { recursive: true })
  const screenshotPath = resolve(screenshotDir, 'doc-history-beside-live-editor.png')
  await page.screenshot({ path: screenshotPath })
  console.log(`[layout-workbench] doc.history: screenshot saved to ${screenshotPath}`)

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  assert(requestFailures.length === 0, `request failures: ${requestFailures.join('\n')}`)

  console.log(JSON.stringify({
    ok: true,
    browser: 'chromium',
    headed,
    backend: 'real-gardend',
    vehicle: 'LayoutInterpreter+FaceRegistry+LayoutResourceBroker',
    // The faces THIS PROOF actually mounts a leaf for (wave1 review r1
    // WRONG fix: this list went stale the moment the doc.history section
    // above landed — it reported only the pre-existing three, silently
    // dropping the very face this file's own doc-history section proves).
    // media.viewer is registered on the harness's registry too (F6
    // quarantine) but deliberately never mounted here; workspace.picker/
    // access.manager are registered AND unit-proven (fast, in-memory) but
    // not yet exercised by a real-Chromium script — see this file's own
    // header. Keep this list and the reconcile()/splitLeaf() calls above in
    // sync; it is MOUNTED faces, not merely REGISTERED ones.
    faces: ['hoja.document', 'sparql.bindings-table', 'sophia.home', 'doc.history'],
    mediaViewerRegisteredButNotMountedByThisProof: true,
    keyboardSeparatorControl: ratioAfterKeyboardStep === ratioBeforeKeyboard + 100 && ratioAfterHome === 100 && ratioAfterEnd === 9900,
    focusRestorationSameLiveEditor: restoredIdentity.hostFocused && restoredIdentity.liveEditorSame,
    minimumConstraintsMarkedAndSurviveIdentity: constrainedReport.splitConstrained === 'true' && postShrinkIdentity,
    identitySharedProvider: identity.sameProvider,
    distinctEditorViewsOverSharedDoc: identity.distinctHosts,
    ancestorSplitMoveSurvivesBothDescendantEditorViews:
      postAncestorMoveIdentity.d1HostSame && postAncestorMoveIdentity.d1LiveEditorSame &&
      postAncestorMoveIdentity.d3HostSame && postAncestorMoveIdentity.d3LiveEditorSame,
    moveSurvivesSparqlView: postMoveIdentity.d1HostSame, // Q1 (the moved leaf) itself is stamp/re-mountable by design; D1's UNRELATED liveEditor surviving is the load-bearing assertion
    moveSurvivesUnrelatedEditorView: postMoveIdentity.d1HostSame && postMoveIdentity.d1LiveEditorSame,
    swapSurvivesBothEditorViews: postSwapIdentity.d2Same && postSwapIdentity.d3Same
      && postSwapIdentity.d2LiveEditorSame && postSwapIdentity.d3LiveEditorSame,
    documentLeafMoveSurvivesHostAndProseMirrorIdentity: postDocumentMoveIdentity.hostSame
      && postDocumentMoveIdentity.innerSame && postDocumentMoveIdentity.liveEditorSame,
    sparqlBindingsTableRealSelectRowCount: q1Shape.rowCount,
    secondIndependentSparqlLeafRowCount: q2Shape.rowCount,
    secondIndependentSparqlLeafIsDistinctElement: distinctSparqlViews,
    sparqlFaceHasNoProvider: !q1Shape.hasBinding && !q1Shape.hasLiveEditor && !q1Shape.hasProvider
      && !q2Shape.hasBinding && !q2Shape.hasLiveEditor && !q2Shape.hasProvider,
    closeNotLastKeepsRoomAlive: true,
    closeLastDisposesExactlyOnce: true,
    reopenAfterTeardownFresh: reopenedIsFresh.hasProvider,
    closeDownToSophiaHomeFallback: closeToHome.finalRootFaceId === 'sophia.home',
    fullHeightByConstructionAtEveryTopology: true,
    noGridElementAnywhere: true,
    everyWrapperDirectlyParentedToRoot: true,
    ratioDragDeltaBasisPoints: (ratioAfter ?? 0) - (ratioBefore ?? 0),
    pageErrors,
    consoleErrors,
    requestFailures,
  }, null, 2))
} catch (error) {
  console.error('[layout-workbench] FAILED', error instanceof Error ? error.stack ?? error.message : error)
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  await cell?.kill().catch(() => undefined)
}
