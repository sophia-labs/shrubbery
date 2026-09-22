/**
 * seele-workbench-gardend-browser.mts — the vessel's ACCEPTANCE ORGANISM.
 *
 * Spawns a REAL headless gardend cell, seeds a real graph and a real document,
 * boots the workbench's OWN Vite dev server (the same `vite.config.ts` `pnpm
 * dev` uses — so the `/cell` proxy and the `/seele/compile` route are the real
 * ones, not a harness re-mount), opens the app in REAL Chromium, loads a
 * constitution containing ONE `seele` fence carrying the circle-1 ecology
 * through the editor's own public insertion path, and then asserts the three
 * things this stage exists to prove:
 *
 *   1. GEOMETRY — the constitution's rendered rect is LEFT of the
 *      `seele.context` pane's, at equal top and equal height. Rev 1 of the
 *      suite had the axis inverted; validity would not have caught it, and a
 *      solver-only test proves the plan rather than the DOM. This reads
 *      `getBoundingClientRect()` on the real wrappers in a real browser.
 *
 *   2. THE LOOP — the context pane reports `clean`, and the `contractHash` it
 *      displays equals the one the `nature` CLI produces for the SAME bytes,
 *      computed independently in this process. The browser never computes a
 *      hash and this script never trusts it to.
 *
 *   3. THE RESERVED CHAT DOCK — present, labelled, collapsed, and EMPTY. The
 *      ratification's first delta says build nothing for chat except a clear
 *      place where it will go; the assertion is therefore that it exists and
 *      that it contains no session machinery, not that it works.
 *
 * NO MOCKS anywhere: a real binary, a real WebSocket-synced Y.Doc, a real
 * ProseMirror view, a real subprocess compile, real pixels.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/organism/cell/spawn-gardend'
import { LoopbackMcpClient } from '@shrubbery/organism/cell/loopback-mcp'
import { DEFAULT_NATURE_BIN } from '@shrubbery/organism/scripts/seele-compile-route'
import { seeleFenceHtml } from '../src/seed-html.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_SEELE_WORKBENCH_PORT ?? 5218)
const headed = process.env.SHRUBBERY_HEADED === '1'

const GRAPH_ID = 'seele-workbench-proof'
const DOCUMENT_ID = 'constitution'
const CONSTITUTION_LEAF_ID = 'Constitution'
const CONTEXT_LEAF_ID = 'SeeleContext'

const natureBin = process.env.NATURE_BIN ?? DEFAULT_NATURE_BIN
const natureRepoRoot = resolve(dirname(natureBin), '../..')
const circleOnePath = resolve(natureRepoRoot, 'examples/circle-1.seele.yaml')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`seele-workbench assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

/** The independent oracle: the `nature` CLI, run directly, on the same bytes. */
function compileWithCli(source: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'seele-browser-oracle.'))
  const file = join(dir, 'oracle.seele.yaml')
  try {
    writeFileSync(file, source, 'utf8')
    let stdout: string
    try {
      stdout = execFileSync(natureBin, ['seele', 'compile', file, '--json'], { encoding: 'utf8' })
    } catch (error) {
      const withOutput = error as { stdout?: string }
      if (typeof withOutput.stdout !== 'string') throw error
      stdout = withOutput.stdout // a refusal exits non-zero and still prints the report
    }
    return JSON.parse(stdout) as Record<string, unknown>
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

async function leafRect(page: Page, leafId: string): Promise<Rect> {
  const box = await page.locator(`[data-layout-node-id="${leafId}"]`).boundingBox()
  assert(box, `leaf ${leafId} has rendered geometry`)
  return box
}

/**
 * Load a constitution body into the LIVE editor through the host's own public
 * `LiveEditorHandle.restoreHtml()` — real `editor.commands.setContent`, the
 * same path a real paste or import takes. Deliberately NOT a test hook and
 * deliberately NOT a direct write into the shared CRDT document: the point is
 * that the bytes travel the route a human's would.
 */
async function loadConstitution(page: Page, html: string): Promise<void> {
  const applied = await page.evaluate((body: string) => {
    const wrapper = document.querySelector('[data-layout-node-id="Constitution"]')
    const host = wrapper?.querySelector('sh-editor-host') as { liveEditor?: { restoreHtml(html: string): boolean } } | null
    if (!host?.liveEditor) return 'no-live-editor'
    return host.liveEditor.restoreHtml(body) ? 'ok' : 'refused'
  }, html)
  assert(applied === 'ok', `restoreHtml applied the constitution body (got '${applied}')`)
}

/** The context pane's rendered state, read out of its real shadow DOM. */
async function readContextPane(page: Page): Promise<{ sealState: string | null; text: string; diagnosticCount: number; hash: string | null }> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('[data-layout-node-id="SeeleContext"]')
    const view = wrapper?.querySelector('sh-seele-context-view')
    const shadow = view?.shadowRoot
    if (!shadow) return { sealState: null, text: '', diagnosticCount: 0, hash: null }
    const chip = shadow.querySelector('[data-seal-state]')
    const hashEl = shadow.querySelector('[data-contract-hash]')
    return {
      sealState: chip ? chip.getAttribute('data-seal-state') : null,
      text: (shadow.textContent ?? '').replace(/\s+/g, ' ').trim(),
      diagnosticCount: shadow.querySelectorAll('[data-diagnostic-severity="error"]').length,
      hash: hashEl ? (hashEl.textContent ?? '').trim() : null,
    }
  })
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary exists at ${bin}`)
  assert(existsSync(natureBin), `real nature binary exists at ${natureBin} (set NATURE_BIN to override)`)
  assert(existsSync(circleOnePath), `circle-1 example exists at ${circleOnePath}`)

  const circleOne = readFileSync(circleOnePath, 'utf8')
  const oracle = compileWithCli(circleOne)
  assert(oracle.clean === true, `the CLI compiles circle-1 cleanly (diagnostics: ${JSON.stringify(oracle.diagnostics)})`)
  const oracleHash = String(oracle.contractHash)
  const oracleDeclaredCount = (oracle.declaredObjects as unknown[]).length
  console.log(`[seele-workbench] CLI oracle: contractHash=${oracleHash} declaredObjects=${oracleDeclaredCount}`)

  console.log(`[seele-workbench] spawning ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  console.log(`[seele-workbench] cell ready at ${cell.apiUrl}`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'SEELe workbench proof' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOCUMENT_ID, title: 'Constitution' })
  // A real durable write, so the document has an on-disk manifest before any
  // editor attaches to it (the same precondition the layout-workbench proof
  // establishes for its own documents).
  await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: DOCUMENT_ID, content: 'seed' })
  console.log('[seele-workbench] graph and constitution document seeded')

  writeFileSync(
    loopbackPath,
    JSON.stringify({ apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID }, null, 2),
  )

  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  console.log(`[seele-workbench] vessel listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  /**
   * The compile route answers HTTP 200 for a refusal as well as for a clean
   * compile — the refusal travels in the D14 report envelope (`clean: false`),
   * never in the status code (suite W7.2a: "refusal is not a transport
   * error"). So the deliberate refusal driven below produces NO browser
   * console error, and console silence is asserted UNCONDITIONALLY: any
   * console error at all, including a non-2xx from the compile route, fails
   * this run.
   */
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    consoleErrors.push(`${text} (${message.location().url})`)
    console.error(`[browser console] ${text}`)
  })

  await page.goto(`http://127.0.0.1:${port}/?graph=${GRAPH_ID}&doc=${DOCUMENT_ID}&debounce=150`, {
    waitUntil: 'domcontentloaded',
  })
  await waitFor(page, () => document.body.dataset.seeleWorkbenchReady !== undefined || Boolean(document.body.dataset.seeleWorkbenchError))
  const bootError = await page.evaluate(() => document.body.dataset.seeleWorkbenchError ?? null)
  assert(!bootError, `vessel booted without error: ${bootError}`)
  const ready = await page.evaluate(() => document.body.dataset.seeleWorkbenchReady)
  assert(ready === 'true', `vessel reconciled its layout (ready=${ready})`)
  console.log('[seele-workbench] booted: real sealed FaceRegistry + broker + interpreter over a real cell')

  // ── 1. GEOMETRY: left | right, not top | bottom ──────────────────────────
  const leafCount = await page.locator('[data-layout-node-kind="leaf"]').count()
  assert(leafCount === 2, `exactly two leaves are mounted (got ${leafCount})`)

  const constitutionRect = await leafRect(page, CONSTITUTION_LEAF_ID)
  const contextRect = await leafRect(page, CONTEXT_LEAF_ID)
  assert(
    constitutionRect.x < contextRect.x,
    `the constitution is LEFT of the context pane (${JSON.stringify({ constitutionRect, contextRect })})`,
  )
  assert(
    constitutionRect.x + constitutionRect.width <= contextRect.x + 1,
    `the two panes do not overlap horizontally (${JSON.stringify({ constitutionRect, contextRect })})`,
  )
  assert(Math.abs(constitutionRect.y - contextRect.y) < 1, 'the two panes share a top edge (side by side, not stacked)')
  assert(Math.abs(constitutionRect.height - contextRect.height) < 1, 'the two panes are the same height')
  assert(constitutionRect.width > contextRect.width, 'the constitution takes the larger share (5800bp)')
  console.log('[seele-workbench] geometry: constitution LEFT of seele.context, equal top, equal height')

  // ── the reserved chat dock (ratification delta 1) ────────────────────────
  const chatDock = await page.evaluate(() => {
    const dock = document.querySelector('#chat-dock')
    if (!dock) return null
    return {
      present: true,
      state: dock.getAttribute('data-chat-dock-state'),
      disabled: dock.getAttribute('aria-disabled'),
      label: (dock.textContent ?? '').replace(/\s+/g, ' ').trim(),
      height: dock.getBoundingClientRect().height,
      // "Empty" in the sense that matters: no chat machinery inside it.
      machinery: dock.querySelectorAll('input, textarea, button, sh-chat-panel, sh-chat-host, [data-session-id]').length,
      isLeaf: Boolean(dock.closest('[data-layout-node-kind]')),
    }
  })
  assert(chatDock?.present, 'the reserved chat dock is present in the vessel chrome')
  assert(chatDock.state === 'collapsed', `the chat dock is collapsed (got '${chatDock.state}')`)
  assert(chatDock.disabled === 'true', 'the chat dock announces itself as not-yet-interactive')
  assert(/chat/i.test(chatDock.label), `the chat dock is LABELLED (got '${chatDock.label}')`)
  assert(chatDock.machinery === 0, 'the chat dock contains no chat machinery — a place, not a feature')
  assert(!chatDock.isLeaf, 'the chat dock is CHROME, not a layout leaf (D15: two leaves, not three)')
  assert(chatDock.height > 0 && chatDock.height < 60, `the chat dock is a thin reserved strip (got ${chatDock.height}px)`)
  console.log(`[seele-workbench] reserved chat dock: labelled '${chatDock.label}', collapsed, empty, chrome not leaf`)

  // ── before any source exists: the pane says so, and shows NO chip ────────
  await waitFor(page, () => {
    const wrapper = document.querySelector('[data-layout-node-id="SeeleContext"]')
    return Boolean(wrapper?.querySelector('sh-seele-context-view')?.shadowRoot?.querySelector('[data-source-error]'))
  })
  const emptyPane = await readContextPane(page)
  assert(emptyPane.sealState === null, `no chip before there is anything to seal (got '${emptyPane.sealState}')`)
  assert(/seele/i.test(emptyPane.text), `the pane names the missing fence: '${emptyPane.text}'`)
  console.log('[seele-workbench] no fence yet: loud projection error, no chip')

  // ── 2. THE LOOP: load circle-1 into the live editor, then seal ───────────
  const proseMirror = page.locator(`[data-layout-node-id="${CONSTITUTION_LEAF_ID}"] sh-editor-host`)
  await proseMirror.waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(page, () => {
    const wrapper = document.querySelector('[data-layout-node-id="Constitution"]')
    const host = wrapper?.querySelector('sh-editor-host') as { liveEditor?: unknown } | null
    return Boolean(host?.liveEditor)
  })
  await loadConstitution(page, seeleFenceHtml('circle-1', 'The constitution of the first circle.', circleOne))

  await waitFor(page, () => {
    const bridge = (window as unknown as { __seeleWorkbench?: { snapshot(): { seal: { kind: string } | null } } }).__seeleWorkbench
    return bridge?.snapshot().seal?.kind === 'sealed'
  })

  const snapshot = await page.evaluate(() => {
    const bridge = (window as unknown as {
      __seeleWorkbench: { snapshot(): Record<string, unknown> }
    }).__seeleWorkbench
    const value = bridge.snapshot() as {
      source: string | null
      compiledSource: string | null
      report: { clean: boolean; contractHash: string | null; sourceDigest: string; compilerVersion: string; declaredObjects: unknown[] } | null
      seal: { kind: string; contractHash?: string; compilerVersion?: string } | null
    }
    return {
      sourceLength: value.source?.length ?? -1,
      sourceMatchesCompiled: value.source === value.compiledSource,
      clean: value.report?.clean ?? null,
      contractHash: value.report?.contractHash ?? null,
      sourceDigest: value.report?.sourceDigest ?? null,
      compilerVersion: value.report?.compilerVersion ?? null,
      declaredCount: value.report?.declaredObjects.length ?? -1,
      sealKind: value.seal?.kind ?? null,
      sealHash: value.seal?.contractHash ?? null,
    }
  })

  assert(snapshot.clean === true, `the compile is CLEAN (${JSON.stringify(snapshot)})`)
  assert(snapshot.sourceMatchesCompiled, 'the applied report is about the bytes on screen — never a stale verdict')
  assert(
    snapshot.contractHash === oracleHash,
    `the seal matches the CLI's hash for the same source (browser=${snapshot.contractHash} cli=${oracleHash})`,
  )
  assert(snapshot.sourceDigest === oracle.sourceDigest, 'the source digest matches the CLI too — the bytes made the round trip')
  assert(snapshot.declaredCount === oracleDeclaredCount, `declared-object count agrees with the CLI (${snapshot.declaredCount} vs ${oracleDeclaredCount})`)
  assert(snapshot.sealKind === 'sealed', `the wax seal reads 'sealed' (got '${snapshot.sealKind}')`)
  assert(snapshot.sealHash === oracleHash, 'the chip carries the same hash the report does')

  const sealedPane = await readContextPane(page)
  assert(sealedPane.sealState === 'sealed', `the RENDERED chip reads sealed (got '${sealedPane.sealState}')`)
  assert(sealedPane.hash === oracleHash, `the RENDERED hash is the CLI's hash (got '${sealedPane.hash}')`)
  assert(sealedPane.text.includes(`${oracleDeclaredCount} declared objects`), `the pane reports the declared objects: '${sealedPane.text}'`)
  assert(
    !/\bsaved\b|\bsaving\b|\bdurable\b|\bwarning\b/i.test(sealedPane.text),
    `W9.3: no persistence or warning claim anywhere on the chip — got '${sealedPane.text}'`,
  )
  console.log(`[seele-workbench] sealed: ${oracleHash} — browser and CLI agree, over a real cell and a real subprocess`)

  // ── 3. A REFUSAL is a normal outcome, rendered, with no hash ─────────────
  const broken = `${circleOne}\nadmissionRules: [unclosed\n`
  await loadConstitution(page, seeleFenceHtml('circle-1', 'Deliberately broken.', broken))
  await waitFor(page, () => {
    const bridge = (window as unknown as { __seeleWorkbench?: { snapshot(): { seal: { kind: string } | null } } }).__seeleWorkbench
    return bridge?.snapshot().seal?.kind === 'refused'
  })
  const refusedPane = await readContextPane(page)
  assert(refusedPane.sealState === 'refused', `a broken fence reads refused (got '${refusedPane.sealState}')`)
  assert(refusedPane.diagnosticCount > 0, 'the diagnostics are rendered, not swallowed')
  assert(refusedPane.hash === null, 'a refusal NEVER displays a contract hash')
  console.log(`[seele-workbench] refused: ${refusedPane.diagnosticCount} diagnostic(s) rendered, no hash`)

  // ── and back: repairing the source re-seals with the same hash ───────────
  await loadConstitution(page, seeleFenceHtml('circle-1', 'Repaired.', circleOne))
  await waitFor(page, () => {
    const bridge = (window as unknown as { __seeleWorkbench?: { snapshot(): { seal: { kind: string } | null } } }).__seeleWorkbench
    return bridge?.snapshot().seal?.kind === 'sealed'
  })
  const resealedPane = await readContextPane(page)
  assert(resealedPane.hash === oracleHash, 'repairing the source re-seals with the SAME hash — the seal is a function of the bytes')
  console.log('[seele-workbench] re-sealed after repair')

  assert(pageErrors.length === 0, `no uncaught page errors: ${JSON.stringify(pageErrors)}`)
  assert(consoleErrors.length === 0, `no console errors AT ALL: ${JSON.stringify(consoleErrors)}`)

  console.log(
    JSON.stringify(
      {
        organism: 'seele-workbench-gardend-browser',
        cell: 'real spawned gardend',
        compiler: `real ${natureBin}`,
        faces: ['hoja.document', 'seele.context'],
        geometryLeftRight: true,
        constitutionRect,
        contextRect,
        chatDock,
        contractHashMatchesCli: true,
        contractHash: oracleHash,
        declaredObjects: oracleDeclaredCount,
        statesObserved: ['(no chip — no source)', 'sealed', 'refused', 'sealed'],
        pageErrors,
        consoleErrors,
        refusalCarriedInEnvelope: true,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error('[seele-workbench] FAILED', error instanceof Error ? (error.stack ?? error.message) : error)
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  await cell?.kill().catch(() => undefined)
}
