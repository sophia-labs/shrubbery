/**
 * observatory-dashboard-gardend-browser.mts — THE FLAGSHIP e2e (Wave 2 /
 * Lane B spec `plans/surface-wave2-laneb-slice-20260716.md` §6.3): boots a
 * REAL `observatory` gardend cell (the PREBUILT binary from
 * `feat/observatory-materializer`/`feat/observatory-projector-cronjob`,
 * `~/dev/garden-emporium-p12`), seeds it through the REAL file seam
 * (`GARDEN_OBSERVATORY_BUNDLE_DIR` + the boot-hook's own
 * generation/`CURRENT`-pointer file contract — see
 * `garden_lib::observatory::boot`'s module doc), lets the boot-hook
 * materialize REAL quads into the two reserved `:projection:obs:*` graphs,
 * then drives REAL Chromium against the "observatory surface v0" dashboard
 * (`observatory-dashboard-main.ts` + `observatory-dashboard-document.ts`)
 * and asserts REAL rendered values sourced from those quads.
 *
 * This is Lane A meeting Lane B in one proof: the materializer's own golden
 * fixtures (`garden-observatory-materializer`'s
 * `src/observatory/fixtures/*`) are the ONLY seed data — never a fabricated
 * bundle shape. The bundle envelope this script assembles mirrors
 * `garden-observatory-materializer/src-tauri/tests/observatory_boot.rs`'s
 * own `full_bundle`/`publish_generation` helpers byte-for-byte (real
 * `lifecycle_evaluation.input.json` + `billing_llm_dau_v1.ok.json` +
 * `valid.ndjson`, wrapped as `{cursor_high_water_mark, lifecycle[],
 * billing[]}` + a sibling raw-snapshot NDJSON file + a `CURRENT` pointer) —
 * the file contract's Rust-side test is the ground truth this script
 * re-implements in TypeScript, not a guess.
 *
 * Two-writer partition (boot.rs's own module doc): outside seeding via
 * SPARQL update is impossible by design for `:projection:obs:*` — the file
 * seam through the real boot-hook is the ONLY honest path, which is exactly
 * what this script drives (`GARDEN_CELL_GRAPH_ID=observatory` +
 * `GARDEN_OBSERVATORY_BUNDLE_DIR` + `GARDEN_SELF_HEAL_GRAPHS=1`, see this
 * file's own `spawnObservatoryCell` for why each env var is present).
 *
 * NO MOCKS: every quad asserted below was written by the REAL
 * `garden_lib::observatory::apply::catch_up` (via the REAL boot-hook) from
 * REAL fixture bytes; every face/registry/broker/interpreter the browser
 * exercises is the actual production `@shrubbery/runtime/layout`
 * implementation (see `observatory-dashboard-main.ts`'s own header).
 *
 * Run SEQUENTIALLY — never concurrent with vitest or another gardend-browser
 * script (shared `.gardend-loopback.json` + dev-server port discipline,
 * mirrors every sibling `*-gardend-browser.mts` in this directory).
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient, mcpText } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_OBSERVATORY_WORKBENCH_PORT ?? 5227)
const headed = process.env.SHRUBBERY_HEADED === '1'
// Outside the repo tree, like `art-direction-browser-harness.mts`'s own
// `artifactDir` convention — a screenshot is a proof ARTIFACT, never a
// tracked source file this script should leave behind in `git status`.
const artifactDir = process.env.SHRUBBERY_OBSERVATORY_ARTIFACT_DIR ?? '/private/tmp/shrubbery-observatory-dashboard'

const GRAPH_ID = 'observatory'

const OBSERVATORY_GARDEND_BIN =
  process.env.OBSERVATORY_GARDEND_BIN ??
  '/Users/vera/dev/garden-emporium-p12/src-tauri/target/debug/examples/gardend'

const FIXTURES_DIR =
  process.env.OBSERVATORY_FIXTURES_DIR ??
  '/Users/vera/dev/garden-observatory-materializer/src-tauri/src/observatory/fixtures'

const RAW_GRAPH_IRI = `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:obs:raw`
const ROLLUPS_GRAPH_IRI = `urn:mnemosyne:local:graph:${GRAPH_ID}:projection:obs:rollups`

// Expected tallies — raw +297 (capture_events.golden.nt's own line count —
// 26 real CaptureEvents across 15 lifecycle/governance kinds; grid-laneb
// review r1 WRONG finding (g): the "27" the task brief originally carried
// was a miscount — `grep -c 'a <...#CaptureEvent>'` on the fixture itself
// yields 26, not 27), rollups EXACTLY 208 — live-verified against THIS exact
// prebuilt binary + fixture pairing (not a theoretical derivation): 158
// (lifecycle_evaluation.golden.nt) + 49 (billing_metric_evaluation.golden.nt)
// + 1 (apply.rs's own cursor-freshness triple onto the ProjectionRun
// subject), with ZERO content-hash overlap between the two golden files for
// this exact pairing (`comm -12` on their sorted lines yields nothing) — so
// there is no legitimate reason for the real count to land anywhere in a
// wide 176..208 band; review r1 WRONG finding (g): that band could silently
// pass a substantial under-materialization. Pinned to the exact value this
// script itself observed on a real run (console: "raw=297 rollups=208").
const EXPECTED_RAW_TRIPLES = 297
const EXPECTED_ROLLUPS_TRIPLES = 208

/**
 * SHA-256 of the three fixture files this script actually FEEDS the real
 * boot-hook (`assembleFixtureBundle`, below) — pinned so a silent edit to
 * `OBSERVATORY_FIXTURES_DIR`'s contents fails LOUDLY here with a clear
 * message, rather than quietly producing different materialized tallies
 * that might still coincidentally satisfy `EXPECTED_RAW_TRIPLES`/
 * `EXPECTED_ROLLUPS_TRIPLES` (grid-laneb review r1 SUSPECT finding: "the E2E
 * proves ... came from the required materializer revision" — this does not
 * pin a cross-repo git commit, which would require build-time provenance
 * plumbing in `garden-observatory-materializer`/`garden-emporium-p12` well
 * outside this branch's scope, but it DOES make fixture-content drift on
 * THIS exact path a hard, immediate failure instead of a silent one).
 * Recompute with `shasum -a 256 <file>` if the fixtures are legitimately
 * updated.
 */
const EXPECTED_FIXTURE_SHA256: Readonly<Record<string, string>> = {
  'lifecycle_evaluation.input.json': '95ff8cc0aee30efef3812496e2aea724da92ec632770e9021f04c2f40d88eca6',
  'billing_llm_dau_v1.ok.json': '3824e61d7e366c3ee489134d05d11827c1d31938ff6e64c10644a35cc026193d',
  'valid.ndjson': '28a3dab9d5de14f9d94b69be8de8cc0eb1f84678ebad1be2c2ffc87b6073dd11',
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Fail loudly, before any cell even boots, if the fixture bytes this script
 * is about to feed the real boot-hook do not match what `EXPECTED_RAW_TRIPLES`/
 * `EXPECTED_ROLLUPS_TRIPLES` were pinned against — see
 * `EXPECTED_FIXTURE_SHA256`'s own doc comment.
 */
function verifyFixtureProvenance(): void {
  for (const [filename, expectedSha256] of Object.entries(EXPECTED_FIXTURE_SHA256)) {
    const path = join(FIXTURES_DIR, filename)
    const actual = sha256File(path)
    assert(
      actual === expectedSha256,
      `fixture drift detected: ${path} sha256 is ${actual}, expected ${expectedSha256} — ` +
        `the pinned EXPECTED_RAW_TRIPLES/EXPECTED_ROLLUPS_TRIPLES were computed against different fixture bytes. ` +
        `If this fixture change is legitimate, recompute both the tallies and EXPECTED_FIXTURE_SHA256 against a real run.`,
    )
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`observatory-dashboard assertion failed: ${message}`)
}

async function waitFor(page: Page, predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
}

// ── §6.3 bundle assembly — the real file seam, mirroring
// observatory_boot.rs's own `full_bundle`/`publish_generation` byte-for-byte ──

interface AssembledBundle {
  readonly bundleDir: string
  readonly token: string
}

/**
 * Assemble a REAL, ready single-generation bundle directory from the
 * materializer's own golden fixtures — `obs-bundle.<token>.json` (the
 * `{cursor_high_water_mark, lifecycle[], billing[]}` envelope, A3's
 * `ObsBundleJson`) + `raw-snapshot.<token>.ndjson` + a `CURRENT` pointer
 * naming `token`, written LAST (the projector's own publish ordering — a
 * reader must never observe `CURRENT` naming a token whose artifacts are not
 * already fully present).
 */
function assembleFixtureBundle(): AssembledBundle {
  const lifecycleJson = readFileSync(join(FIXTURES_DIR, 'lifecycle_evaluation.input.json'), 'utf8')
  const billingJson = readFileSync(join(FIXTURES_DIR, 'billing_llm_dau_v1.ok.json'), 'utf8')
  const rawNdjson = readFileSync(join(FIXTURES_DIR, 'valid.ndjson'), 'utf8')

  const bundleDir = mkdtempSync(join(tmpdir(), 'sophia-observatory-dashboard-bundle.'))
  const token = 'gen-observatory-dashboard-e2e'
  const cursor = 'cursor-observatory-dashboard-e2e'

  const bundleJson = `{"cursor_high_water_mark":${JSON.stringify(cursor)},"lifecycle":[${lifecycleJson}],"billing":[${billingJson}]}`
  writeFileSync(join(bundleDir, `obs-bundle.${token}.json`), bundleJson)
  writeFileSync(join(bundleDir, `raw-snapshot.${token}.ndjson`), rawNdjson)
  writeFileSync(join(bundleDir, 'CURRENT'), token)

  return { bundleDir, token }
}

// ── §6.3 boot the PREBUILT observatory gardend cell ─────────────────────────

/**
 * Two-phase boot (live-verified — see this function's own history): the
 * boot-hook's `existing_graph_dir` call does NOT create the `observatory`
 * graph itself; it only self-heals a missing one when F4c self-heal is
 * armed (`runtime_config::init_self_heal_graphs_from_env`, gated by
 * `GARDEN_SELF_HEAL_GRAPHS=1` AND the crate's own `headless` cargo feature
 * being compiled in). Probed live against this exact prebuilt binary: even
 * with `GARDEN_SELF_HEAL_GRAPHS=1` set, boot-hook still failed
 * `"graph not found: observatory"` — this prebuilt was not compiled with
 * self-heal's `#[cfg(feature = "headless")]` branch active, so this script
 * cannot rely on it (production doesn't either: the GATEWAY's own
 * dynamically-spawned-cell env is what arms self-heal there, per
 * `runtime_config.rs`'s own doc — "Bare headless spawns ... never set it").
 *
 * Real fix, no self-heal dependency: boot the SAME binary/profile TWICE.
 * Phase 1 boots with the observatory gate CLOSED (no
 * `GARDEN_CELL_GRAPH_ID`), creates the `observatory` graph for real through
 * the normal `create_graph` MCP path (the exact path a legitimate cell
 * provisioning flow uses — mirrors `provision-observatory-graph.sh`'s own
 * documented recipe), then this cell is killed. Phase 2 reboots the SAME
 * `GARDEN_PROFILE_DIR` (via `spawnGardend`'s `profileDir` reuse option) with
 * the observatory env now set — `existing_graph_dir` finds the REAL
 * graph.json phase 1 created, the gate opens, and the boot-hook applies the
 * fixture bundle for real.
 */
interface ObservatoryCellHandle {
  readonly cell: GardendCell
  /** Caller-supplied (reused across phase 1/2) — NOT removed by `cell.kill()`; the caller must clean this up itself. */
  readonly profileDir: string
}

async function spawnObservatoryCell(bundleDir: string): Promise<ObservatoryCellHandle> {
  assert(existsSync(OBSERVATORY_GARDEND_BIN), `prebuilt observatory gardend binary exists at ${OBSERVATORY_GARDEND_BIN}`)
  // Observability only, not a hard gate (grid-laneb review r1 SUSPECT
  // finding): a real cross-repo commit/build-fingerprint pin would need
  // provenance plumbing inside `garden-observatory-materializer`/
  // `garden-emporium-p12` itself (out of THIS branch's scope) — this at
  // least records WHICH binary bytes + mtime produced this run's tallies, in
  // the run's own log, so a future failure has something to diff against.
  const binStat = statSync(OBSERVATORY_GARDEND_BIN)
  console.log(
    `[observatory-dashboard] gardend binary: ${OBSERVATORY_GARDEND_BIN} (${binStat.size} bytes, mtime ${binStat.mtime.toISOString()})`,
  )

  const profileDir = mkdtempSync(join(tmpdir(), 'gardend-observatory-dashboard.'))

  // ── phase 1: plain boot (gate closed), real create_graph via MCP ────────
  const phase1 = await spawnGardend({ bin: OBSERVATORY_GARDEND_BIN, profileDir, readyTimeoutMs: 30_000 })
  try {
    const mcp = new LoopbackMcpClient({
      mcpUrl: phase1.mcpUrl,
      healthUrl: `${phase1.apiUrl}/health`,
      token: phase1.token,
      origin: 'http://127.0.0.1',
    })
    await mcp.toolsCall('create_graph', {
      graph_id: GRAPH_ID,
      title: 'Observatory',
      description:
        'Cloud-2 self-knowledge cell — CaptureEvent ledger projected to :projection:obs:raw / :projection:obs:rollups (observatory-dashboard-gardend-browser.mts e2e).',
    })
    console.log(`[observatory-dashboard] phase 1: real "${GRAPH_ID}" graph created via MCP create_graph`)
  } finally {
    await phase1.kill()
  }

  // ── phase 2: reboot the SAME profile with the observatory gate armed ────
  const cell = await spawnGardend({
    bin: OBSERVATORY_GARDEND_BIN,
    profileDir,
    readyTimeoutMs: 30_000,
    env: {
      // Arms the boot-hook's gate (`observatory::boot::projector_gate_open`)
      // — the gate is `own_graph_id == "observatory" AND a real CURRENT
      // marker`, both of which this run supplies.
      GARDEN_CELL_GRAPH_ID: GRAPH_ID,
      // The file-seam override (`observatory::boot::BUNDLE_DIR_ENV_VAR`) —
      // points the boot-hook at the fixture bundle assembled above instead
      // of the production EFS-derived default.
      GARDEN_OBSERVATORY_BUNDLE_DIR: bundleDir,
    },
  })
  return { cell, profileDir }
}

// ── §6.3 sanity check the REAL materialized quads via MCP, independent of
// the browser — proves the boot-hook applied BEFORE any face ever mounts.
// This Node-side script deliberately does NOT import `@shrubbery/runtime`
// (or `@shrubbery/runtime/layout`) — that barrel's faces/view-elements
// register real Lit custom elements at module-load time, which requires a
// DOM the plain Node process running THIS script does not have (the browser
// side of the proof, further down, loads that code the correct way: inside
// real Chromium via Vite). gardend's raw `sparql_query` MCP tool returns
// each bound cell as a STRINGIFIED RDF term (verified live against a real
// cell: `"2"^^<http://www.w3.org/2001/XMLSchema#integer>` for a literal,
// `<urn:...>` for a URI) — `parseCountLiteral` below is a narrow, local
// parser for exactly the one shape this sanity check needs, independent of
// the full `parseTerm`/`QueryBlockService` machinery the browser-side faces
// use for everything else.
function parseCountLiteral(raw: string): number {
  const match = /^"(\d+)"(?:\^\^<[^>]+>)?$/.exec(raw)
  if (!match) throw new Error(`parseCountLiteral: unexpected COUNT literal shape: ${raw}`)
  return Number.parseInt(match[1]!, 10)
}

async function countGraphTriples(mcp: LoopbackMcpClient, graphIri: string): Promise<number> {
  const result = await mcp.toolsCall('sparql_query', {
    graphId: GRAPH_ID,
    query: `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
  })
  const envelope = JSON.parse(mcpText(result)) as { rows?: Array<Record<string, string>> }
  const raw = envelope.rows?.[0]?.n
  assert(typeof raw === 'string', `sparql_query COUNT envelope missing a bound ?n for ${graphIri}: ${JSON.stringify(envelope)}`)
  return parseCountLiteral(raw)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Poll `countGraphTriples` until it reaches (or exceeds) `atLeast`, or
 * `timeoutMs` elapses. Live-verified NEEDED (not merely defensive): `/health`
 * answers 200 as soon as the loopback port is bound — a LIVENESS signal, not
 * a readiness one — while the boot-hook's `catch_up` commit is still a few
 * milliseconds behind it (real observed race: an immediate COUNT right after
 * `spawnGardend` resolved once returned 0, though the SAME process's own
 * `reconcile_apply adds=297` log line landed moments later). Real polling
 * against the real cell, not a fixed sleep.
 */
async function waitForGraphTripleCount(
  mcp: LoopbackMcpClient,
  graphIri: string,
  atLeast: number,
  timeoutMs = 15000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let last = 0
  while (Date.now() < deadline) {
    last = await countGraphTriples(mcp, graphIri)
    if (last >= atLeast) return last
    await sleep(200)
  }
  return last
}

let cell: GardendCell | null = null
let cellProfileDir: string | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
let bundleDir: string | null = null

try {
  verifyFixtureProvenance()
  const assembled = assembleFixtureBundle()
  bundleDir = assembled.bundleDir
  console.log(`[observatory-dashboard] fixture bundle assembled at ${assembled.bundleDir} (token ${assembled.token})`)

  const observatoryCell = await spawnObservatoryCell(assembled.bundleDir)
  cell = observatoryCell.cell
  cellProfileDir = observatoryCell.profileDir
  console.log(`[observatory-dashboard] observatory cell ready at ${cell.apiUrl} (phase 2 boot, profile reused from phase 1)`)

  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })

  // The boot-hook's catch_up runs INLINE during boot (module doc: "nothing
  // can reach the API before catch_up has run"), but `/health` itself is a
  // LIVENESS probe that answers 200 as soon as the loopback port is bound —
  // a narrow real race against the store commit (see
  // `waitForGraphTripleCount`'s own doc, live-verified). Poll for the real
  // tallies rather than asserting on one immediate read.
  const rawCount = await waitForGraphTripleCount(mcp, RAW_GRAPH_IRI, EXPECTED_RAW_TRIPLES)
  const rollupsCount = await waitForGraphTripleCount(mcp, ROLLUPS_GRAPH_IRI, EXPECTED_ROLLUPS_TRIPLES)
  assert(rawCount === EXPECTED_RAW_TRIPLES, `raw graph triple count: expected exactly ${EXPECTED_RAW_TRIPLES}, got ${rawCount}`)
  // EXACT, not a range (grid-laneb review r1 WRONG finding (g)): a wide
  // 176..208 band could silently pass a substantial under-materialization.
  assert(
    rollupsCount === EXPECTED_ROLLUPS_TRIPLES,
    `rollups graph triple count: expected exactly ${EXPECTED_ROLLUPS_TRIPLES}, got ${rollupsCount}`,
  )
  console.log(`[observatory-dashboard] real boot-hook materialization confirmed via SPARQL: raw=${rawCount} rollups=${rollupsCount}`)

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
  console.log(`[observatory-dashboard] Organism listening on ${port}`)

  browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } })
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => consoleErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
      console.error(`[browser console] ${message.text()}`)
    }
  })

  await page.goto(`http://127.0.0.1:${port}/observatory-dashboard-harness.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, () => document.body.dataset.observatoryDashboardReady === 'true' || Boolean(document.body.dataset.observatoryDashboardError))
  const bootError = await page.evaluate(() => document.body.dataset.observatoryDashboardError ?? null)
  assert(!bootError, `dashboard boot failed: ${bootError}`)
  console.log('[observatory-dashboard] dashboard booted: real FaceRegistry + LayoutResourceBroker + LayoutInterpreter over the real observatory cell')

  // ── stat cells ─────────────────────────────────────────────────────────
  // Read BOTH the component's reactive properties AND its actual rendered
  // shadow-DOM text (grid-laneb review r1 WRONG finding (e): asserting only
  // `.status`/`.value`/`.label` proves the FACE computed the right value, but
  // never proves Lit actually PAINTED it — a broken `_body()` template
  // binding could leave `.value` correct while the visible page shows
  // nothing or something stale. `readStat` now asserts DOM parity itself, so
  // every call site automatically gets the stronger guarantee.)
  async function readStat(cellId: string): Promise<{ status: string; value: string; label: string }> {
    await page
      .locator(`[data-layout-grid-cell-id="${cellId}"] sh-stat-scalar-view`)
      .waitFor({ state: 'visible', timeout: 15000 })
    // `cellId` is passed as `waitForFunction`'s own `arg` — NOT captured via
    // an outer-closure IIFE: Playwright serializes a predicate with
    // `fn.toString()` and evaluates that string standalone in the browser,
    // so a Node-side closure variable is never actually available there
    // (the exact "__name is not defined"-class gotcha `layout-workbench-
    // gardend-browser.mts`'s own `planLeafBoxes` comment documents, one
    // layer up: no captured bindings survive the trip at all, named or not).
    await page.waitForFunction((id) => {
      const el = document.querySelector(`[data-layout-grid-cell-id="${id}"] sh-stat-scalar-view`) as unknown as { status?: string } | null
      return el?.status === 'ready' || el?.status === 'error'
    }, cellId, { timeout: 15000 })
    const read = await page.evaluate((id) => {
      const el = document.querySelector(`[data-layout-grid-cell-id="${id}"] sh-stat-scalar-view`) as unknown as {
        status: string
        value: string
        label: string
        shadowRoot: ShadowRoot | null
      }
      const valueText = el.shadowRoot?.querySelector('.value')?.textContent ?? null
      const labelText = el.shadowRoot?.querySelector('.label')?.textContent ?? null
      return { status: el.status, value: el.value, label: el.label, valueText, labelText }
    }, cellId)
    if (read.status === 'ready') {
      assert(
        read.valueText === read.value,
        `stat "${cellId}" shadow-DOM .value text does not match the rendered property — Lit did not actually paint it: dom=${JSON.stringify(read.valueText)} prop=${JSON.stringify(read.value)}`,
      )
      assert(
        read.labelText === read.label,
        `stat "${cellId}" shadow-DOM .label text does not match the rendered property: dom=${JSON.stringify(read.labelText)} prop=${JSON.stringify(read.label)}`,
      )
    }
    return { status: read.status, value: read.value, label: read.label }
  }

  const freshness = await readStat('freshness')
  assert(freshness.status === 'ready', `freshness stat did not reach ready: ${JSON.stringify(freshness)}`)
  assert(freshness.value.length > 0 && !freshness.value.includes('2026-07-15T09:00:00'), `freshness stat must render a relative-time string, not the raw ISO timestamp: ${JSON.stringify(freshness)}`)
  console.log(`[observatory-dashboard] freshness stat: "${freshness.value}" (real obs:ProjectionRun -> obs:projectedThrough, dateTimeRelative-formatted)`)

  const activeRuns = await readStat('active-runs')
  assert(activeRuns.status === 'ready' && activeRuns.value === '0', `active-runs stat expected "0": ${JSON.stringify(activeRuns)}`)

  const failedRuns = await readStat('failed-runs')
  assert(failedRuns.status === 'ready' && failedRuns.value === '0', `failed-runs stat expected "0" (failedRuns=0 + failedFinalFlushes=0): ${JSON.stringify(failedRuns)}`)

  const coldStartP95 = await readStat('cold-start-p95')
  assert(coldStartP95.status === 'ready' && coldStartP95.value === '812 ms', `cold-start-p95 stat expected "812 ms": ${JSON.stringify(coldStartP95)}`)

  const estimatedComputeUsd = await readStat('estimated-compute-usd')
  const expectedUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(0.018826)
  assert(estimatedComputeUsd.status === 'ready' && estimatedComputeUsd.value === expectedUsd, `estimated-compute-usd stat expected "${expectedUsd}": ${JSON.stringify(estimatedComputeUsd)}`)
  console.log(`[observatory-dashboard] stat cells real values: activeRuns=0 failedRuns/FinalFlushes=0 coldStartP95=812ms estimatedComputeUsd=${expectedUsd}`)

  // ── chart cells ────────────────────────────────────────────────────────
  interface ChartRead {
    readonly status: string
    readonly rowCount: number
    readonly firstRow: Record<string, { value: string }> | null
    readonly chartHostChildren: number
    readonly hasSvg: boolean
    readonly markCount: number
    readonly barLabels: readonly string[]
  }
  // Selects Vega's own per-datum bar marks — `role="graphics-symbol"
  // aria-roledescription="bar"` — which `vega-scenegraph`'s `ariaItemAttributes`
  // emits ONLY on actual mark items with a description (verified live against
  // this repo's pinned vega@6.2.0/vega-scenegraph@5.1.0: a bar-mark spec
  // rendered with real data yields exactly one such element per bar, each
  // carrying `aria-label="<xField>: <xValue>; <yField>: <yValue>"`; the SAME
  // spec rendered with an EMPTY `data.values` yields zero — unlike a bare
  // `path, rect, circle` count, which stays >0 even for empty data because it
  // also matches the background rect, frame path, and axis domain/grid/tick
  // paths). This is the actual discriminator between "some chrome landed in
  // the DOM" and "a real data mark was drawn" (grid-laneb review r2 WRONG
  // finding (e)).
  const BAR_MARK_SELECTOR = 'svg [role="graphics-symbol"][aria-roledescription="bar"]'
  async function readChart(cellId: string): Promise<ChartRead> {
    await page
      .locator(`[data-layout-grid-cell-id="${cellId}"] sh-vega-chart-view`)
      .waitFor({ state: 'visible', timeout: 15000 })
    // `cellId` passed as `waitForFunction`'s own `arg` — see `readStat`'s
    // own comment for why an outer-closure IIFE cannot work here.
    await page.waitForFunction((id) => {
      const el = document.querySelector(`[data-layout-grid-cell-id="${id}"] sh-vega-chart-view`) as unknown as { status?: string } | null
      return el?.status === 'ready' || el?.status === 'error' || el?.status === 'empty'
    }, cellId, { timeout: 15000 })
    // vega-embed mounts asynchronously even after `status` flips to 'ready'
    // (`vega-chart-view-element.ts`'s own `updated()` -> `mountQueryBlockVega`
    // promise) — wait for REAL content inside `.chart-host`, not just the
    // status flag, before reading it back.
    await page.waitForFunction((id) => {
      const host = document
        .querySelector(`[data-layout-grid-cell-id="${id}"] sh-vega-chart-view`)
        ?.shadowRoot?.querySelector('.chart-host')
      return host != null && host.childElementCount > 0
    }, cellId, { timeout: 15000 })
    // grid-laneb review r1 WRONG finding (e), and r2 WRONG finding (e) on top
    // of it: waiting for ANY `path, rect, circle` only proves SOME primitive
    // landed (the background rect and axis paths always exist, even for
    // empty data) — wait for a REAL data-mark bar element specifically.
    await page.waitForFunction((args) => {
      const [selector, id] = args
      const host = document
        .querySelector(`[data-layout-grid-cell-id="${id}"] sh-vega-chart-view`)
        ?.shadowRoot?.querySelector('.chart-host')
      return host != null && host.querySelectorAll(selector).length > 0
    }, [BAR_MARK_SELECTOR, cellId] as const, { timeout: 15000 })
    return page.evaluate((args) => {
      const [selector, id] = args
      const el = document.querySelector(`[data-layout-grid-cell-id="${id}"] sh-vega-chart-view`) as unknown as {
        status: string
        result: { rows: Array<Record<string, { value: string }>> } | null
      }
      const chartHost = (el as unknown as HTMLElement).shadowRoot?.querySelector('.chart-host')
      const svg = chartHost?.querySelector('svg') ?? null
      const bars = Array.from(chartHost?.querySelectorAll(selector) ?? [])
      return {
        status: el.status,
        rowCount: el.result?.rows.length ?? 0,
        firstRow: el.result?.rows[0] ?? null,
        chartHostChildren: chartHost?.childElementCount ?? 0,
        hasSvg: svg != null,
        markCount: bars.length,
        barLabels: bars.map((bar) => bar.getAttribute('aria-label') ?? ''),
      }
    }, [BAR_MARK_SELECTOR, cellId] as const)
  }

  const dauChart = await readChart('dau-chart')
  assert(dauChart.status === 'ready', `dau-chart did not reach ready: ${JSON.stringify(dauChart)}`)
  assert(dauChart.rowCount === 1, `dau-chart expected exactly 1 row (one MetricObservation): got ${dauChart.rowCount}`)
  assert(dauChart.firstRow?.value?.value === '2', `dau-chart expected value=2 (billing_llm_dau_v1): ${JSON.stringify(dauChart.firstRow)}`)
  assert(dauChart.firstRow?.windowStart?.value === '2026-07-11T00:00:00Z', `dau-chart expected windowStart=2026-07-11T00:00:00Z: ${JSON.stringify(dauChart.firstRow)}`)
  assert(dauChart.chartHostChildren > 0, 'dau-chart must have real vega-embed DOM mounted inside .chart-host')
  // grid-laneb review r2 WRONG finding (e): a real DATA MARK, not merely some
  // SVG primitive — exactly one bar, whose own aria-label (Vega's own
  // `"<xField>: <xValue>; <yField>: <yValue>"` generated text, verified live
  // against this repo's pinned vega-lite@6.4.3) encodes the real xField
  // (`windowStart`) and the real asserted yField value ("value: 2").
  assert(dauChart.hasSvg && dauChart.markCount === 1, `dau-chart must render exactly one real bar data-mark (${BAR_MARK_SELECTOR}), not merely SOME child element: ${JSON.stringify(dauChart)}`)
  assert(
    dauChart.barLabels[0]?.startsWith('windowStart:') && dauChart.barLabels[0]?.endsWith('value: 2'),
    `dau-chart bar mark aria-label must encode windowStart + value=2: ${JSON.stringify(dauChart.barLabels)}`,
  )
  console.log(`[observatory-dashboard] DAU chart: real value=2 at windowStart=2026-07-11T00:00:00Z, vega-embed mounted (${dauChart.chartHostChildren} child node(s), 1 real bar mark: "${dauChart.barLabels[0]}")`)

  const kindChart = await readChart('kind-chart')
  assert(kindChart.status === 'ready', `kind-chart did not reach ready: ${JSON.stringify(kindChart)}`)
  assert(kindChart.rowCount === 15, `kind-chart expected 15 distinct obs:kind values (the fixture's own 15 lifecycle/governance kinds): got ${kindChart.rowCount}`)
  assert(kindChart.chartHostChildren > 0, 'kind-chart must have real vega-embed DOM mounted inside .chart-host')
  // grid-laneb review r2 WRONG finding (e): 15 real bar data-marks (one per
  // kind), each aria-labeled "kind: <kind>; count: <n>" by Vega itself — not
  // merely 15 rows in the query result (already asserted above) coincidentally
  // co-existing with SOME chart chrome.
  assert(kindChart.hasSvg && kindChart.markCount === 15, `kind-chart must render exactly 15 real bar data-marks (${BAR_MARK_SELECTOR}), one per kind: ${JSON.stringify(kindChart)}`)
  assert(
    kindChart.barLabels.every((label) => /^kind: .+; count: \d+$/.test(label)),
    `kind-chart every bar mark aria-label must encode a kind + numeric count: ${JSON.stringify(kindChart.barLabels)}`,
  )
  assert(
    new Set(kindChart.barLabels).size === 15,
    `kind-chart bar mark aria-labels must be 15 DISTINCT kinds, not duplicates: ${JSON.stringify(kindChart.barLabels)}`,
  )
  console.log(`[observatory-dashboard] 72h activity-by-kind chart: ${kindChart.rowCount} distinct kinds, ${kindChart.markCount} real bar marks, vega-embed mounted`)

  // ── runs table (sparql.bindings-table leaf, not a grid cell) ────────────
  const runsTable = page.locator('[data-layout-node-id="ObsRunsTable"] sh-sparql-table-view')
  await runsTable.waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(page, () => {
    const table = document.querySelector('[data-layout-node-id="ObsRunsTable"] sh-sparql-table-view')?.shadowRoot?.querySelector('table')
    return table != null && table.querySelectorAll('tbody tr').length > 0
  }, 15000)
  const runsTableShape = await page.evaluate(() => {
    const host = document.querySelector('[data-layout-node-id="ObsRunsTable"] sh-sparql-table-view') as unknown as HTMLElement
    const rows = Array.from(host.shadowRoot?.querySelectorAll('tbody tr') ?? [])
    return {
      rowCount: rows.length,
      allText: rows.map((row) => row.textContent ?? '').join(' | '),
    }
  })
  assert(runsTableShape.rowCount === 1, `recent-machine-runs table expected exactly 1 row (one MachineRun in the fixture): got ${runsTableShape.rowCount}`)
  assert(runsTableShape.allText.includes('01J0000000000000000000000R'), `recent-machine-runs table row must contain the real runId: ${runsTableShape.allText}`)
  assert(runsTableShape.allText.includes('organism-dev'), `recent-machine-runs table row must contain the real graphId ("organism-dev"): ${runsTableShape.allText}`)
  console.log(`[observatory-dashboard] recent machine-runs table: 1 real row (runId 01J0000000000000000000000R, graphId organism-dev)`)

  // ── sequence-gaps collection grid — the second children-source proof ────
  // The fixture's OWN lifecycle golden data carries exactly ONE
  // obs:SequenceGap (witness "cell:gardend-a/01J0000000000000000000000C",
  // expectedSeq=7, observedSeq=9, gapCount=2) — so this run proves the
  // NON-empty collection-render path, not the empty-state path (the task's
  // own "unless fixtures contain gaps" carve-out).
  await page
    .locator('[data-layout-node-id="ObsGapsGrid"] [data-layout-grid-cell-id] sh-subject-card-view')
    .waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(page, () => {
    const el = document.querySelector('[data-layout-node-id="ObsGapsGrid"] [data-layout-grid-cell-id] sh-subject-card-view') as unknown as { status?: string } | null
    return el?.status === 'ready' || el?.status === 'error'
  })
  // Reads BOTH the component's reactive properties AND its actual rendered
  // shadow-DOM text (grid-laneb review r1 WRONG finding (e) — see
  // `readStat`'s own comment for the same rationale, one face over): a
  // `.title`/`dt`+`dd` mismatch against the properties would mean Lit never
  // actually painted what the face computed.
  const gapsShape = await page.evaluate(() => {
    const cells = document.querySelectorAll('[data-layout-node-id="ObsGapsGrid"] [data-layout-grid-cell-id]')
    const card = document.querySelector('[data-layout-node-id="ObsGapsGrid"] [data-layout-grid-cell-id] sh-subject-card-view') as unknown as {
      status: string
      title: string
      fields: Array<{ label: string; value: string }>
      shadowRoot: ShadowRoot | null
    } | null
    const badge = document.querySelector('[data-layout-node-id="ObsGapsGrid"] [data-layout-grid-count-badge]') as HTMLElement | null
    const titleText = card?.shadowRoot?.querySelector('.title')?.textContent ?? null
    const domFields = Array.from(card?.shadowRoot?.querySelectorAll('dl.fields > dt') ?? []).map((dt) => ({
      label: dt.textContent ?? '',
      value: (dt.nextElementSibling as HTMLElement | null)?.textContent ?? '',
    }))
    return {
      cellCount: cells.length,
      status: card?.status ?? null,
      title: card?.title ?? null,
      titleText,
      fields: card?.fields ?? [],
      domFields,
      badgeHidden: badge?.hidden ?? null,
    }
  })
  assert(gapsShape.cellCount === 1, `sequence-gaps grid expected exactly 1 cell (one real obs:SequenceGap): got ${gapsShape.cellCount}`)
  assert(gapsShape.status === 'ready', `sequence-gaps card did not reach ready: ${JSON.stringify(gapsShape)}`)
  assert(gapsShape.title === 'cell:gardend-a/01J0000000000000000000000C', `sequence-gaps card title expected the real obs:witness value: ${JSON.stringify(gapsShape)}`)
  assert(gapsShape.titleText === gapsShape.title, `sequence-gaps card shadow-DOM .title text does not match the rendered property — Lit did not actually paint it: dom=${JSON.stringify(gapsShape.titleText)} prop=${JSON.stringify(gapsShape.title)}`)
  const fieldValue = (label: string): string | undefined => gapsShape.fields.find((f) => f.label === label)?.value
  const domFieldValue = (label: string): string | undefined => gapsShape.domFields.find((f) => f.label === label)?.value
  for (const label of [
    'http://mnemosyne.dev/observatory#expectedSeq',
    'http://mnemosyne.dev/observatory#observedSeq',
    'http://mnemosyne.dev/observatory#gapCount',
  ]) {
    assert(
      domFieldValue(label) === fieldValue(label),
      `sequence-gaps card shadow-DOM field "${label}" does not match the rendered property: dom=${JSON.stringify(domFieldValue(label))} prop=${JSON.stringify(fieldValue(label))}`,
    )
  }
  assert(fieldValue(`http://mnemosyne.dev/observatory#expectedSeq`) === '7', `sequence-gaps card expectedSeq expected "7": ${JSON.stringify(gapsShape.fields)}`)
  assert(fieldValue(`http://mnemosyne.dev/observatory#observedSeq`) === '9', `sequence-gaps card observedSeq expected "9": ${JSON.stringify(gapsShape.fields)}`)
  assert(fieldValue(`http://mnemosyne.dev/observatory#gapCount`) === '2', `sequence-gaps card gapCount expected "2": ${JSON.stringify(gapsShape.fields)}`)
  assert(gapsShape.badgeHidden === true, `sequence-gaps grid count badge must stay hidden when not truncated (1 shown of 1 total): ${JSON.stringify(gapsShape)}`)
  console.log(`[observatory-dashboard] sequence-gaps collection grid: 1 real card.subject cell — witness="${gapsShape.title}" expectedSeq=7 observedSeq=9 gapCount=2, proving the collection children-source non-empty path`)

  assert(consoleErrors.length === 0, `unexpected browser console/page errors: ${JSON.stringify(consoleErrors)}`)

  mkdirSync(artifactDir, { recursive: true })
  const screenshotPath = join(artifactDir, 'observatory-dashboard-v0.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  console.log(`[observatory-dashboard] screenshot saved: ${screenshotPath}`)

  console.log('[observatory-dashboard] ALL ASSERTIONS PASSED — observatory dashboard v0 renders real materializer output end-to-end.')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (cell) await cell.kill()
  if (cellProfileDir) rmSync(cellProfileDir, { recursive: true, force: true })
  if (existsSync(loopbackPath)) rmSync(loopbackPath, { force: true })
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true })
}
