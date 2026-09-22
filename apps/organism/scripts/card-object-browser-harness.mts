/**
 * card-object-browser-harness.mts — REAL-CELL + REAL-CHROMIUM proof for
 * `card.object` (MO object-face integration spec, master §3 Slice 2, gate
 * G7). Spawns a REAL headless gardend cell, seeds a real graph with a real
 * `emporium-bookmark.Bookmark` Meaningful Object over MCP, boots Organism's
 * real Vite dev server (the SAME `vite.config.ts` production uses — its
 * `dynamicCellProxy` plugin lets the browser reach the cell same-origin, no
 * token in the browser), and drives the REAL `card.object` face through the
 * REAL `card-object-harness-main.ts` vehicle in REAL Chromium:
 *
 *   - a real MO renders its real title/fields/footer testimony;
 *   - the identity-kinded header actually resolves `font-weight: 650` via
 *     `getComputedStyle` on the real element inside the shadow root (the
 *     R9 regression proof, in a real browser rather than happy-dom);
 *   - a nonexistent object renders the real, honest EMPTY-state copy;
 *   - the card is keyboard-reachable (`tabIndex=0` per §6.3) — Tab moves
 *     real DOM focus onto it.
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
const port = Number(process.env.SHRUBBERY_CARD_OBJECT_HARNESS_PORT ?? 5231)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'card-object-harness-proof'
const VOCAB = 'emporium-bookmark'
const CLASS = 'Bookmark'
const OBJECT_ID = 'card-object-harness-bookmark'
const CONTESTED_OBJECT_ID = 'card-object-harness-contested-bookmark'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`card-object-browser-harness assertion failed: ${message}`)
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
  console.log(`[card-object-harness] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[card-object-harness] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'card.object browser harness' })
  // Checkpoint the graph into source authority BEFORE writing (see
  // source-object-runtime.integration.test.ts's own comment: a write before
  // any pull lands only in the legacy projection, never in bundle.currentState).
  await mcp.toolsCall('source_pull', { graphId: GRAPH_ID })
  const write = await mcp.callTool('emporium_write', {
    graph_id: GRAPH_ID,
    vocab: VOCAB,
    records: [
      { kind: CLASS, clientRef: OBJECT_ID, url: 'https://shrubbery.test/card-object-harness', title: 'Card Object Browser Harness' },
    ],
  }) as { ok?: boolean }
  assert(write.ok === true, `emporium_write succeeded: ${JSON.stringify(write)}`)
  console.log('[card-object-harness] graph seeded with one real Bookmark MO')

  // ── a real Law IV contest, for the wine annunciator proof (Slice 5, G7) ──
  const contestedGraphIncarnation = (
    await mcp.callTool('source_pull', { graphId: GRAPH_ID }) as { graphIncarnation: string }
  ).graphIncarnation
  const contestedOp = (operationId: string, title: string): Record<string, unknown> => ({
    kind: 'currentState',
    operationId,
    vocab: VOCAB,
    class: CLASS,
    objectId: CONTESTED_OBJECT_ID,
    baseVersion: 'root',
    record: { kind: CLASS, url: `https://shrubbery.test/${CONTESTED_OBJECT_ID}`, title },
  })
  const contestedPushA = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation: contestedGraphIncarnation,
    operations: [contestedOp('card-object-harness-contest-a', 'Claim A')],
  }) as { ok?: boolean }
  assert(contestedPushA.ok === true, `first contested claim accepted: ${JSON.stringify(contestedPushA)}`)
  const contestedPushB = await mcp.callTool('source_push', {
    graphId: GRAPH_ID,
    graphIncarnation: contestedGraphIncarnation,
    operations: [contestedOp('card-object-harness-contest-b', 'Claim B')],
  }) as { ok?: boolean }
  assert(contestedPushB.ok === true, `second contested claim accepted: ${JSON.stringify(contestedPushB)}`)
  console.log('[card-object-harness] graph seeded with one real Law IV contest')

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
  console.log(`[card-object-harness] Organism listening on ${port}`)

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

  await page.goto(`http://127.0.0.1:${port}/card-object-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.cardObjectHarnessReady === 'true' || Boolean(document.body.dataset.cardObjectHarnessError))
  const bootError = await page.evaluate(() => document.body.dataset.cardObjectHarnessError ?? null)
  assert(!bootError, `harness boot failed: ${bootError}`)
  console.log('[card-object-harness] vehicle booted: real FaceRegistry + LayoutResourceBroker + LayoutInterpreter + real SourceObjectService over a real cell')

  // ── (1) a real MO renders its real title/fields/footer testimony ────────
  const objectUrn = `urn:sophia:object:${VOCAB}:${CLASS}:${OBJECT_ID}`
  await page.evaluate(async (urn) => {
    await window.__cardObjectHarness!.mount(urn)
  }, objectUrn)
  await page.locator('sh-object-card-view').waitFor({ state: 'attached' })
  try {
    await waitFor(page, () => document.querySelector('sh-object-card-view')?.getAttribute('data-resource-state') === 'ready')
  } catch (waitError) {
    const debug = await page.evaluate(() => {
      const el = document.querySelector('sh-object-card-view') as (HTMLElement & { status?: string; error?: string }) | null
      return {
        status: el?.status,
        error: el?.error,
        datasetResourceState: el?.dataset.resourceState,
        shadowHtml: el?.shadowRoot?.innerHTML?.slice(0, 2000),
      }
    })
    console.error('[card-object-harness] DEBUG dump on timeout:', JSON.stringify(debug, null, 2))
    throw waitError
  }

  // No `titleField` param is configured, so the title is honestly the
  // objectId (§6.9: "no match ⇒ the title is objectId") — the record's own
  // `title` FIELD (not the card's header) is what carries the real written
  // value, asserted below via the real dl.record rows.
  const titleText = await page.evaluate(() => document.querySelector('sh-object-card-view')!.shadowRoot!.querySelector('h1.title')!.textContent)
  assert(titleText?.includes(OBJECT_ID) ?? false, `header title falls back to the real objectId: ${titleText}`)

  const fieldsText = await page.evaluate(() => {
    const shadow = document.querySelector('sh-object-card-view')!.shadowRoot!
    return Array.from(shadow.querySelectorAll('dl.record dd')).map((dd) => dd.textContent?.trim())
  })
  assert(fieldsText.includes('https://shrubbery.test/card-object-harness'), `real url field rendered: ${JSON.stringify(fieldsText)}`)
  assert(fieldsText.includes('Card Object Browser Harness'), `real title field rendered: ${JSON.stringify(fieldsText)}`)

  // Mirror-path labels are the record key VERBATIM (§6.9) — never a
  // predicate IRI shortened to its last segment (that shortening is the
  // AUTHORITY path's own rule). Proves this real read landed on the
  // PRIMARY (mirror) path, not the degraded fallback.
  const labels = await page.evaluate(() =>
    Array.from(document.querySelector('sh-object-card-view')!.shadowRoot!.querySelectorAll('dl.record dt')).map((dt) => dt.textContent))
  assert(labels.includes('title') && labels.includes('url'), `mirror-path labels are the bare record keys verbatim, never a shortened predicate IRI: ${JSON.stringify(labels)}`)

  const footerText = await page.evaluate(() => {
    const shadow = document.querySelector('sh-object-card-view')!.shadowRoot!
    return shadow.querySelector('footer.testimony')?.textContent ?? ''
  })
  assert(footerText.includes('code-backed'), `real strategy chip rendered: ${footerText}`)
  assert(/source [0-9a-f]{8}/.test(footerText), `real short sourceVersion rendered: ${footerText}`)
  assert(footerText.includes('from the local mirror'), `provenance testimony names the mirror path: ${footerText}`)
  console.log('[card-object-harness] (1) real MO renders real fields + real strategy chip + real short version, via the real MIRROR path')

  // ── (2) R9 — the identity header's font-weight:650 ACTUALLY APPLIES ─────
  const identityFontWeight = await page.evaluate(() => {
    const shadow = document.querySelector('sh-object-card-view')!.shadowRoot!
    const node = shadow.querySelector('h1.title .mn-kind[data-kind="identity"]')!
    return getComputedStyle(node).fontWeight
  })
  assert(identityFontWeight === '650', `identity kind font-weight resolves to 650 in a REAL browser: got ${identityFontWeight}`)
  console.log('[card-object-harness] (2) R9 — kind.css duplication actually applies in real Chromium (font-weight:650)')

  // ── (3) the card is keyboard-reachable ───────────────────────────────────
  await page.evaluate(() => document.body.focus())
  await page.keyboard.press('Tab')
  const focusedIsCard = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() === 'sh-object-card-view')
  assert(focusedIsCard, 'Tab reaches the card.object host element (tabIndex=0, §6.3)')
  console.log('[card-object-harness] (3) keyboard reaches the card')

  // ── (4) a nonexistent object renders the real, honest EMPTY state ───────
  const absentUrn = `urn:sophia:object:${VOCAB}:${CLASS}:never-written`
  await page.evaluate(async (urn) => {
    await window.__cardObjectHarness!.mount(urn)
  }, absentUrn)
  try {
    await waitFor(page, () => document.querySelector('sh-object-card-view')?.shadowRoot?.textContent
      ?.includes('No object never-written') ?? false)
  } catch (waitError) {
    const debug = await page.evaluate(() => {
      const el = document.querySelector('sh-object-card-view') as (HTMLElement & { status?: string; error?: string }) | null
      return { status: el?.status, error: el?.error, dataset: el?.dataset.resourceState, shadowText: el?.shadowRoot?.textContent }
    })
    console.error('[card-object-harness] DEBUG dump on EMPTY-state timeout:', JSON.stringify(debug, null, 2))
    throw waitError
  }
  console.log('[card-object-harness] (4) a nonexistent object renders the real EMPTY-state copy')

  // ── (5) sourceObjectSeam — G4b RELOCATED HERE (master §8.2's G4b repair) ─
  // `globalThis.indexedDB` is `undefined` under apps/organism's happy-dom
  // vitest environment (verified), so a vitest `SourceMirrorRuntime` would
  // silently run on `MemorySourceRuntimeStorage` — a real no-mocks
  // violation for this seam. Real Chromium has real IndexedDB. These are the
  // five assertions `source-object-runtime.integration.test.ts` would have
  // made — see card-object-harness-main.ts's own doc comment on this bridge.
  const bookmarkKey = { vocab: VOCAB, class: CLASS, objectId: OBJECT_ID }

  // (5a) mirror path — real record, real provenance/version/strategy.
  // Ask A landed on the real Slice-0 wire this harness targets (MO
  // object-face integration spec, master §3 Slice 5): `CurrentObjectFace`
  // now carries `operationId` (required) + `clientId` (Garden's
  // `mcp_source_emporium_write` defaults an unobserved write's `client_id`
  // to the literal `"legacy-mcp"`, `source_sync.rs:3585` — verified), so a
  // healthy, single-writer, uncontested object has EVERY fact this read can
  // establish: `unavailable` is genuinely empty, not `['lastWriter']`.
  const mirrorRead = await page.evaluate(
    (key) => window.__cardObjectHarness!.sourceObjectSeam.readMirror(key),
    bookmarkKey,
  )
  assert(mirrorRead?.provenance === 'mirror', `sourceObjectSeam (5a) mirror provenance: ${JSON.stringify(mirrorRead)}`)
  assert(mirrorRead?.record.url === 'https://shrubbery.test/card-object-harness', '(5a) real url field')
  assert(typeof mirrorRead?.sourceVersion === 'string' && (mirrorRead.sourceVersion?.length ?? 0) > 0, '(5a) real sourceVersion')
  assert(mirrorRead?.reconciliationStrategy === 'codeBacked', `(5a) real strategy: ${mirrorRead?.reconciliationStrategy}`)
  assert(JSON.stringify(mirrorRead?.unavailable) === JSON.stringify([]), `(5a) unavailable is empty (Ask A landed): ${JSON.stringify(mirrorRead?.unavailable)}`)
  assert(typeof mirrorRead?.lastWriter?.operationId === 'string' && (mirrorRead.lastWriter.operationId.length ?? 0) > 0, `(5a) real lastWriter.operationId: ${JSON.stringify(mirrorRead?.lastWriter)}`)
  assert(mirrorRead?.lastWriter?.clientId === 'legacy-mcp', `(5a) real lastWriter.clientId ('legacy-mcp' — an unobserved emporium_write): ${JSON.stringify(mirrorRead?.lastWriter)}`)

  // (5b) authority path — a FRESH, never-synced contract; SAME decoded field values.
  const authorityRead = await page.evaluate(
    (key) => window.__cardObjectHarness!.sourceObjectSeam.readAuthority(key),
    bookmarkKey,
  )
  assert(authorityRead?.provenance === 'authority-projection', `(5b) authority provenance: ${JSON.stringify(authorityRead)}`)
  assert(authorityRead?.record['http://mnemosyne.dev/bookmark#url'] === 'https://shrubbery.test/card-object-harness', '(5b) decoded url matches the mirror path')
  assert(JSON.stringify(authorityRead?.unavailable) === JSON.stringify(['sourceVersion', 'reconciliationStrategy', 'contest', 'lastWriter']), `(5b) unavailable = the four degraded facts: ${JSON.stringify(authorityRead?.unavailable)}`)

  // (5c) an absent object resolves to null (EMPTY), never a throw.
  const absentRead = await page.evaluate(
    (key) => window.__cardObjectHarness!.sourceObjectSeam.readMirrorAbsent(key),
    { vocab: VOCAB, class: CLASS, objectId: 'seam-never-written' },
  )
  assert(absentRead === null, `(5c) absent object is null: ${JSON.stringify(absentRead)}`)

  // (5d) a never-synced mirror (the real usableBundle incompleteness rule) falls through to authority.
  const neverSynced = await page.evaluate(
    (key) => window.__cardObjectHarness!.sourceObjectSeam.readNeverSynced(key),
    bookmarkKey,
  )
  assert(neverSynced.provenance === 'authority-projection', `(5d) never-synced mirror falls to authority: ${JSON.stringify(neverSynced)}`)

  // (5e) Q-9 — a class whose subject_rule needs a token beyond {graph_subject}/{localId} rejects verbatim, never null.
  const q9 = await page.evaluate(
    (key) => window.__cardObjectHarness!.sourceObjectSeam.readSubjectRuleGap(key),
    { vocab: 'kg-ultra-intuition', class: 'IntuitionCandidate', objectId: 'any-candidate-id' },
  )
  assert(q9.rejected, `(5e) Q-9 subject-rule gap rejects: ${JSON.stringify(q9)}`)
  assert(/cannot address|full subject IRI|subject_rule/i.test(q9.message), `(5e) Q-9 message names the real BadRequest: ${q9.message}`)

  console.log('[card-object-harness] (5) sourceObjectSeam — mirror/authority parity, EMPTY, never-synced fallback, and Q-9 all real, all green')

  // ── (6) the wine annunciator's real computed colour, light AND dark
  //    (master §3 Slice 5, gate G7) ────────────────────────────────────────
  const contestedUrn = `urn:sophia:object:${VOCAB}:${CLASS}:${CONTESTED_OBJECT_ID}`
  await page.evaluate(async (urn) => {
    await window.__cardObjectHarness!.mount(urn)
  }, contestedUrn)
  await waitFor(page, () => document.querySelector('sh-object-card-view')?.getAttribute('data-stance') === 'contested')
  const wineLight = await page.evaluate(() => {
    const shadow = document.querySelector('sh-object-card-view')!.shadowRoot!
    const badge = shadow.querySelector('.projected-badge')!
    return getComputedStyle(badge).color
  })
  // #880134 (the RESERVED wine swatch) as rgb(136, 1, 52).
  assert(wineLight === 'rgb(136, 1, 52)', `(6a) light: the projected badge's real computed colour is the wine swatch: ${wineLight}`)

  await page.evaluate(() => window.__cardObjectHarness!.setTheme('dark'))
  await waitFor(page, () => document.documentElement.getAttribute('data-theme') === 'dark')
  const wineDark = await page.evaluate(() => {
    const shadow = document.querySelector('sh-object-card-view')!.shadowRoot!
    const badge = shadow.querySelector('.projected-badge')!
    return getComputedStyle(badge).color
  })
  assert(wineDark !== wineLight, `(6b) dark: the wine swatch resolves to a DIFFERENT real computed colour than light (never a bare, theme-blind hex): ${wineDark} vs ${wineLight}`)
  assert(/^rgb\(\d+, \d+, \d+\)$/.test(wineDark), `(6b) dark: a real, resolved rgb() colour, not an unresolved var(): ${wineDark}`)
  await page.evaluate(() => window.__cardObjectHarness!.setTheme('light'))
  console.log(`[card-object-harness] (6) wine annunciator real computed colour — light ${wineLight}, dark ${wineDark}`)

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors: ${JSON.stringify(consoleErrors)}`)

  console.log('[card-object-harness] ALL PROOFS GREEN')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
