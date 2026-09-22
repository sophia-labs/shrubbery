/**
 * Joined Arc F5 receipt: Choreograph's production family serializer -> a
 * disposable real gardend graph -> Shrubbery's production query-backed family
 * Face -> real Chromium. No cloud or persistent local profile is touched.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Locator, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dynamicCellProxy } from '../../../scripts/vite-cell-proxy.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { type GardendCell, resolveGardendBin, spawnGardend } from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'arc-f5-local-browser-proof'
const USER_GRAPH_IRI = `urn:mnemosyne:local:graph:${GRAPH_ID}:user:rdf`
const PARENT_SESSION_ID = 'ags_arc_f5_browser_parent_full'
const PARENT_AGENT_ID = 'agent-a111111111111111'
const CRASH_SESSION_ID = 'ags_arc_f5_browser_crash_child_full'
const CRASH_AGENT_ID = 'agent-b222222222222222'
const RELEASED_SESSION_ID = 'ags_arc_f5_browser_released_child_full'
const RELEASED_AGENT_ID = 'agent-d444444444444444'
const CANCELLING_SESSION_ID = 'ags_arc_f5_browser_cancelling_child_full'
const CANCELLING_AGENT_ID = 'agent-e555555555555555'
const RELATION_IDS = [
  `asr_${'1'.repeat(64)}`,
  `asr_${'2'.repeat(64)}`,
  `asr_${'3'.repeat(64)}`,
] as const
const PHASE_ONE_REVISION = 101
const PHASE_TWO_REVISION = 201
const LIVE_TIMEOUT_MS = 30_000
const STALE_OBSERVATION_MS = 2_250
const SNAPSHOT_POISON = {
  prompt: 'Arc F5 private prompt body',
  provider: 'private-provider-coordinate',
  model: 'private-model-coordinate',
  runtimeBindingDigest: 'sha256:private-binding-digest',
  bodyId: 'body_private_body_id',
  activationId: 'act_private_activation_id',
  sandboxId: 'sbx_private_sandbox_id',
  childRunId: 'acr_private_child_run_id',
  allocationId: 'aba_private_allocation_id',
} as const
const GRAPH_POISON_NS = 'urn:sophia:arc-f5-browser-poison#'
const GRAPH_POISON = {
  prompt: 'real graph private prompt body',
  provider: 'real-graph-private-provider',
  model: 'real-graph-private-model',
  runtimeBindingDigest: 'sha256:real-graph-private-binding',
  bodyId: 'body_real_graph_private_id',
  activationId: 'act_real_graph_private_id',
  sandboxId: 'sbx_real_graph_private_id',
  childRunId: 'acr_real_graph_private_id',
  allocationId: 'aba_real_graph_private_id',
} as const
const SNAPSHOT_POISON_VALUES = Object.values(SNAPSHOT_POISON)
const GRAPH_POISON_VALUES = Object.values(GRAPH_POISON)
const ALL_POISON_VALUES = [...SNAPSHOT_POISON_VALUES, ...GRAPH_POISON_VALUES]

interface ProducerModule {
  buildAgentSessionFamilyProjection(snapshot: unknown): string
}

interface MaterializationView {
  readonly generation: number
  readonly state: string
  readonly workerState: string
  readonly kernelState: string | null
  readonly faultKind: string | null
  readonly recoverable: boolean | null
}

interface FamilyView {
  readonly parentSessionId: string
  readonly parentState: string
  readonly projectionRevision: number
  readonly parentMaterialization: MaterializationView | null
  readonly budgetAccount: {
    readonly directAcceptedChildren: number
    readonly maxChildren: number
    readonly occupiedChildren: number
    readonly maxConcurrentChildren: number
    readonly budgetCostSpentUsdMicros: number
    readonly budgetCostReservedUsdMicros: number
    readonly budgetCostRemainingUsdMicros: number
    readonly budgetCostMaxUsdMicros: number
    readonly budgetAccountRevision: number
    readonly budgetAccountExhausted: boolean
  }
  readonly children: readonly {
    readonly childName: string
    readonly childSessionId: string
    readonly depth: number
    readonly registrationStatus: string
    readonly registeredAt: string
    readonly sessionState: string
    readonly childRunState: string | null
    readonly budget: {
      readonly admissionStatus: string
      readonly runtimeKind: string
      readonly allocationState: string
      readonly allocationHoldKind: string | null
      readonly settledActualCostUsdMicros: number | null
      readonly allocatedTurns: number
      readonly allocatedWallTimeMs: number
      readonly allocatedTokens: number
      readonly allocatedCostUsdMicros: number
      readonly allocatedArtifactBytes: number
    } | null
    readonly materialization: MaterializationView | null
  }[]
}

const BUDGET = {
  schema: 'choreograph.agent-session-child-budget.v1',
  maxTurns: 6,
  maxWallTimeMs: 300_000,
  maxTokens: 20_000,
  maxCostUsdMicros: 300_000,
  maxArtifactBytes: 1_048_576,
} as const

const REGISTERED_AT = [
  Date.parse('2026-08-08T12:00:01.000Z'),
  Date.parse('2026-08-08T12:00:02.000Z'),
  Date.parse('2026-08-08T12:00:03.000Z'),
] as const

function phaseSnapshot(terminal: boolean): Record<string, unknown> {
  return {
    projectionRevision: terminal ? PHASE_TWO_REVISION : PHASE_ONE_REVISION,
    root: {
      sessionId: PARENT_SESSION_ID,
      agentId: PARENT_AGENT_ID,
      graphId: GRAPH_ID,
      sessionState: 'open',
      materializationState: 'running',
      materializationGeneration: 2,
      materializationFaultKind: null,
      materializationRecoverable: null,
      workerState: 'running',
      kernelState: 'running',
      directAcceptedChildren: 3,
      maxChildren: 4,
      occupiedChildren: terminal ? 0 : 1,
      maxConcurrentChildren: 2,
      budgetCostSpentUsdMicros: terminal ? 50_000 : 0,
      budgetCostReservedUsdMicros: terminal ? 0 : 600_000,
      budgetCostRemainingUsdMicros: terminal ? 950_000 : 400_000,
      budgetCostMaxUsdMicros: 1_000_000,
      budgetAccountExhausted: false,
      budgetAccountRevision: terminal ? 33 : 31,
      ...SNAPSHOT_POISON,
    },
    children: [
      {
        relationId: RELATION_IDS[0],
        parentSessionId: PARENT_SESSION_ID,
        child: {
          sessionId: CRASH_SESSION_ID,
          agentId: CRASH_AGENT_ID,
          graphId: GRAPH_ID,
          sessionState: terminal ? 'closed' : 'closing',
        },
        childName: 'crash-child',
        depth: 1,
        registeredAt: REGISTERED_AT[0],
        admission: {
          childName: 'crash-child',
          depth: 1,
          runtimeKind: 'prime',
          allocationState: terminal ? 'settled' : 'reserved',
          allocationHoldKind: null,
          settledActualCostUsdMicros: terminal ? 50_000 : null,
          budget: BUDGET,
        },
        childRunState: terminal ? 'failed' : 'claimed',
        materializationState: 'faulted',
        materializationGeneration: 0,
        materializationFaultKind: 'worker_exit',
        materializationRecoverable: false,
        workerState: 'faulted',
        kernelState: 'faulted',
      },
      {
        relationId: RELATION_IDS[2],
        parentSessionId: PARENT_SESSION_ID,
        child: {
          sessionId: RELEASED_SESSION_ID,
          agentId: RELEASED_AGENT_ID,
          graphId: GRAPH_ID,
          sessionState: 'closed',
        },
        childName: 'released-before-body-child',
        depth: 1,
        registeredAt: REGISTERED_AT[1],
        admission: {
          childName: 'released-before-body-child',
          depth: 1,
          runtimeKind: 'simple',
          allocationState: 'released',
          allocationHoldKind: null,
          settledActualCostUsdMicros: null,
          budget: BUDGET,
        },
        childRunState: 'cancelled',
        materializationState: null,
        materializationGeneration: null,
        materializationFaultKind: null,
        materializationRecoverable: null,
        workerState: null,
        kernelState: null,
      },
      {
        relationId: RELATION_IDS[1],
        parentSessionId: PARENT_SESSION_ID,
        child: {
          sessionId: CANCELLING_SESSION_ID,
          agentId: CANCELLING_AGENT_ID,
          graphId: GRAPH_ID,
          sessionState: terminal ? 'closed' : 'closing',
        },
        childName: 'active-cancelling-child',
        depth: 1,
        registeredAt: REGISTERED_AT[2],
        admission: {
          childName: 'active-cancelling-child',
          depth: 1,
          runtimeKind: 'prime',
          allocationState: terminal ? 'settled' : 'reserved',
          allocationHoldKind: null,
          settledActualCostUsdMicros: terminal ? 0 : null,
          budget: BUDGET,
        },
        childRunState: terminal ? 'cancelled' : 'cancelling',
        materializationState: terminal ? 'cancelled' : 'running',
        materializationGeneration: 0,
        materializationFaultKind: null,
        materializationRecoverable: null,
        workerState: terminal ? 'cancelled' : 'running',
        kernelState: terminal ? 'cancelled' : 'running',
      },
    ],
  }
}

function expectedFamily(terminal: boolean): FamilyView {
  return {
    parentSessionId: PARENT_SESSION_ID,
    parentState: 'open',
    projectionRevision: terminal ? PHASE_TWO_REVISION : PHASE_ONE_REVISION,
    parentMaterialization: {
      generation: 2,
      state: 'running',
      workerState: 'running',
      kernelState: 'running',
      faultKind: null,
      recoverable: null,
    },
    budgetAccount: {
      directAcceptedChildren: 3,
      maxChildren: 4,
      occupiedChildren: terminal ? 0 : 1,
      maxConcurrentChildren: 2,
      budgetCostSpentUsdMicros: terminal ? 50_000 : 0,
      budgetCostReservedUsdMicros: terminal ? 0 : 600_000,
      budgetCostRemainingUsdMicros: terminal ? 950_000 : 400_000,
      budgetCostMaxUsdMicros: 1_000_000,
      budgetAccountRevision: terminal ? 33 : 31,
      budgetAccountExhausted: false,
    },
    children: [
      {
        childName: 'crash-child',
        childSessionId: CRASH_SESSION_ID,
        depth: 1,
        registrationStatus: 'registered',
        registeredAt: new Date(REGISTERED_AT[0]).toISOString().replace('.000Z', 'Z'),
        sessionState: terminal ? 'closed' : 'closing',
        childRunState: terminal ? 'failed' : 'claimed',
        budget: expectedBudget(
          'prime',
          terminal ? 'settled' : 'reserved',
          null,
          terminal ? 50_000 : null,
        ),
        materialization: {
          generation: 0,
          state: 'faulted',
          workerState: 'faulted',
          kernelState: 'faulted',
          faultKind: 'worker_exit',
          recoverable: false,
        },
      },
      {
        childName: 'released-before-body-child',
        childSessionId: RELEASED_SESSION_ID,
        depth: 1,
        registrationStatus: 'registered',
        registeredAt: new Date(REGISTERED_AT[1]).toISOString().replace('.000Z', 'Z'),
        sessionState: 'closed',
        childRunState: 'cancelled',
        budget: expectedBudget('simple', 'released', null, null),
        materialization: null,
      },
      {
        childName: 'active-cancelling-child',
        childSessionId: CANCELLING_SESSION_ID,
        depth: 1,
        registrationStatus: 'registered',
        registeredAt: new Date(REGISTERED_AT[2]).toISOString().replace('.000Z', 'Z'),
        sessionState: terminal ? 'closed' : 'closing',
        childRunState: terminal ? 'cancelled' : 'cancelling',
        budget: expectedBudget('prime', terminal ? 'settled' : 'reserved', null, terminal ? 0 : null),
        materialization: {
          generation: 0,
          state: terminal ? 'cancelled' : 'running',
          workerState: terminal ? 'cancelled' : 'running',
          kernelState: terminal ? 'cancelled' : 'running',
          faultKind: null,
          recoverable: null,
        },
      },
    ],
  }
}

function expectedBudget(
  runtimeKind: string,
  allocationState: string,
  allocationHoldKind: string | null,
  settledActualCostUsdMicros: number | null,
): NonNullable<FamilyView['children'][number]['budget']> {
  return {
    admissionStatus: 'admitted',
    runtimeKind,
    allocationState,
    allocationHoldKind,
    settledActualCostUsdMicros,
    allocatedTurns: BUDGET.maxTurns,
    allocatedWallTimeMs: BUDGET.maxWallTimeMs,
    allocatedTokens: BUDGET.maxTokens,
    allocatedCostUsdMicros: BUDGET.maxCostUsdMicros,
    allocatedArtifactBytes: BUDGET.maxArtifactBytes,
  }
}

function extractSessionIri(update: string, sessionId: string): string {
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = update.match(new RegExp(`<([^>]+)> a agt:Session ;\\n\\s+agt:sessionId "${escaped}"`, 'u'))
  assert.ok(match?.[1], `producer update omitted Session ${sessionId}`)
  return match[1]
}

function producerPath(): string {
  const configured = process.env.SOPHIA_ARC_F5_PRODUCER_MODULE?.trim()
  assert.ok(configured, 'SOPHIA_ARC_F5_PRODUCER_MODULE must name Choreograph\'s production family serializer module')
  const path = resolve(configured)
  assert.equal(existsSync(path), true, `Arc F5 producer module does not exist: ${path}`)
  return path
}

async function withinDeadline<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded the ${LIVE_TIMEOUT_MS}ms receipt deadline`)),
      LIVE_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([operation(), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function callToolWithinDeadline<T>(
  mcp: LoopbackMcpClient,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<T> {
  return await withinDeadline(`Loopback MCP ${name}`, async () =>
    await mcp.callTool(name, arguments_) as T)
}

function updateDigest(update: string): string {
  return createHash('sha256').update(update).digest('hex')
}

async function applyUpdate(mcp: LoopbackMcpClient, update: string): Promise<void> {
  await callToolWithinDeadline(mcp, 'sparql_update', { graphId: GRAPH_ID, update })
}

async function graphRevision(mcp: LoopbackMcpClient, parentIri: string): Promise<number> {
  const query = `PREFIX ar: <http://sophia.ai/agent-runtime#>\nSELECT ?revision WHERE { GRAPH <${USER_GRAPH_IRI}> { <${parentIri}> ar:projectionRevision ?revision . } }`
  const result = await callToolWithinDeadline<{
    rows?: readonly Record<string, unknown>[]
  }>(mcp, 'sparql_query', { graphId: GRAPH_ID, query })
  assert.equal(result.rows?.length, 1, 'real graph query must return exactly one projection revision')
  const raw = result.rows![0]!.revision
  const lexical = typeof raw === 'string'
    ? raw
    : typeof raw === 'object' && raw !== null && 'value' in raw
      ? String((raw as { value: unknown }).value)
      : String(raw)
  const match = lexical.match(/(?:^|")([0-9]+)(?:"|\^|$)/u)
  assert.ok(match?.[1], `real graph query returned an unreadable revision term: ${lexical}`)
  return Number(match[1])
}

async function seedGraphPoison(mcp: LoopbackMcpClient, parentIri: string): Promise<void> {
  const statements = Object.entries(GRAPH_POISON)
    .map(([field, value]) => `    <${parentIri}> <${GRAPH_POISON_NS}${field}> ${JSON.stringify(value)} .`)
    .join('\n')
  await applyUpdate(mcp, `INSERT DATA {\n  GRAPH <${USER_GRAPH_IRI}> {\n${statements}\n  }\n}`)
}

async function assertRealGraphPoisonBoundary(mcp: LoopbackMcpClient, parentIri: string): Promise<void> {
  const query = `SELECT ?predicate ?value WHERE { GRAPH <${USER_GRAPH_IRI}> { <${parentIri}> ?predicate ?value . } }`
  const result = await callToolWithinDeadline(mcp, 'sparql_query', { graphId: GRAPH_ID, query })
  const encoded = JSON.stringify(result)
  for (const secret of SNAPSHOT_POISON_VALUES) {
    assert.equal(encoded.includes(secret), false, `real graph leaked serializer-input-only poison ${secret}`)
  }
  for (const secret of GRAPH_POISON_VALUES) {
    assert.equal(encoded.includes(secret), true, `real graph is missing non-selected poison fixture ${secret}`)
  }
}

async function waitForFamily(page: Page, expected: FamilyView): Promise<FamilyView> {
  await page.waitForFunction(
    (revision) => {
      const view = (window as unknown as {
        __arcF5SessionFamilyHarness?: { view?: { family?: { projectionRevision?: number } } }
      }).__arcF5SessionFamilyHarness?.view
      return view?.family?.projectionRevision === revision
    },
    expected.projectionRevision,
    { timeout: LIVE_TIMEOUT_MS },
  )
  const family = await page.locator('sh-agent-session-family-view').evaluate((element) =>
    JSON.parse(JSON.stringify((element as unknown as { family: FamilyView }).family)) as FamilyView)
  assert.deepEqual(family, expected, `Face-decoded family revision ${expected.projectionRevision} diverged from producer truth`)
  const encoded = JSON.stringify(family)
  for (const secret of ALL_POISON_VALUES) {
    assert.equal(encoded.includes(secret), false, `Face-decoded model leaked poisoned coordinate ${secret}`)
  }
  return family
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

async function assertRenderedPhase(family: Locator, terminal: boolean): Promise<void> {
  const text = normalized(await family.locator('.family').innerText())
  for (const testimony of terminal
    ? [
        'session open', 'generation 2', 'materialization running', 'worker running', 'kernel running',
        'accepted 3 / 4', 'active 0 / 2', 'ledger rev 33',
        'crash-child', 'session closed', 'run failed', 'allocation settled',
        'generation 0', 'fault worker exit · terminal',
        'released-before-body-child', 'run cancelled', 'allocation released',
        'active-cancelling-child', 'run cancelled', 'allocation settled',
        'generation 0', 'materialization cancelled', 'worker cancelled', 'kernel cancelled',
      ]
    : [
        'session open', 'generation 2', 'materialization running', 'worker running', 'kernel running',
        'accepted 3 / 4', 'active 1 / 2', 'ledger rev 31',
        'crash-child', 'session closing', 'run claimed', 'allocation reserved',
        'generation 0', 'materialization faulted', 'worker faulted', 'kernel faulted',
        'fault worker exit · terminal',
        'released-before-body-child', 'run cancelled', 'allocation released',
        'active-cancelling-child', 'run cancelling', 'allocation reserved',
        'generation 0', 'materialization running', 'worker running', 'kernel running',
      ]) {
    assert.ok(text.includes(testimony), `rendered phase ${terminal ? 2 : 1} omitted ${JSON.stringify(testimony)}`)
  }
  for (const sessionId of [CRASH_SESSION_ID, RELEASED_SESSION_ID, CANCELLING_SESSION_ID]) {
    const shortened = `${sessionId.slice(0, 7)}…${sessionId.slice(-6)}`
    assert.ok(text.includes(shortened), `Face omitted the shortened child Session identity ${shortened}`)
    assert.equal(text.includes(sessionId), false, `Face displayed the raw child Session identity ${sessionId}`)
  }
  const rows = family.locator('.child')
  assert.equal(await rows.count(), 3, 'Face must render exactly three projected children')
  const rowText = new Map<string, string>()
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index)
    rowText.set(normalized(await row.locator('.name').innerText()), normalized(await row.innerText()))
  }
  const expectedRows = terminal
    ? {
        'crash-child': ['session closed', 'run failed', 'allocation settled', 'generation 0', 'worker faulted', 'kernel faulted', 'fault worker exit · terminal', 'actual 50000'],
        'active-cancelling-child': ['session closed', 'run cancelled', 'allocation settled', 'generation 0', 'materialization cancelled', 'worker cancelled', 'kernel cancelled', 'actual 0'],
        'released-before-body-child': ['session closed', 'run cancelled', 'allocation released'],
      }
    : {
        'crash-child': ['session closing', 'run claimed', 'allocation reserved', 'generation 0', 'worker faulted', 'kernel faulted', 'fault worker exit · terminal'],
        'active-cancelling-child': ['session closing', 'run cancelling', 'allocation reserved', 'generation 0', 'materialization running', 'worker running', 'kernel running'],
        'released-before-body-child': ['session closed', 'run cancelled', 'allocation released'],
      }
  for (const [name, expectedValues] of Object.entries(expectedRows)) {
    const rendered = rowText.get(name)
    assert.ok(rendered, `Face omitted child row ${name}`)
    for (const value of expectedValues) {
      assert.ok(rendered.includes(value), `${name} omitted rendered testimony ${JSON.stringify(value)}`)
    }
  }
  assert.doesNotMatch(
    rowText.get('released-before-body-child') ?? '',
    /\b(?:generation|materialization|worker|kernel|fault|actual)\b/iu,
    'pre-bind released child fabricated body or settlement testimony',
  )
  assert.equal(
    await family.locator('button, input, select, textarea, a[href], [contenteditable="true"], [role="button"], [role="textbox"]').count(),
    0,
    'sealed family Face must remain read-only and non-operational',
  )
}

async function assertNoLeaks(
  page: Page,
  family: Locator,
  cell: GardendCell,
  browserRequests: readonly string[],
): Promise<void> {
  const shadowMarkup = await family.evaluate((element) => element.shadowRoot?.innerHTML ?? '')
  const pageMarkup = await page.content()
  for (const raw of [
    PARENT_SESSION_ID,
    CRASH_SESSION_ID,
    RELEASED_SESSION_ID,
    CANCELLING_SESSION_ID,
    PARENT_AGENT_ID,
    CRASH_AGENT_ID,
    RELEASED_AGENT_ID,
    CANCELLING_AGENT_ID,
    ...RELATION_IDS,
    ...ALL_POISON_VALUES,
    cell.token,
  ]) {
    assert.equal(shadowMarkup.includes(raw), false, `family shadow DOM leaked ${raw}`)
    assert.equal(pageMarkup.includes(raw), false, `page markup leaked ${raw}`)
  }
  assert.doesNotMatch(shadowMarkup, /\burn:[^<\s"']+/iu, 'family Face leaked a graph authority IRI')
  assert.doesNotMatch(shadowMarkup, /\b(?:prompt|model|provider|binding[_ -]?digest|body[_ -]?id|activation[_ -]?id|sandbox[_ -]?id|request[_ -]?id|allocation[_ -]?id|operation[_ -]?id)\b/iu)
  const cellOrigin = new URL(cell.apiUrl).origin
  assert.equal(
    browserRequests.some((url) => url.startsWith(cellOrigin)),
    false,
    'browser bypassed the same-origin cell proxy and reached the token-bearing loopback origin',
  )
  assert.equal(browserRequests.some((url) => url.includes(cell.token)), false, 'browser request URL leaked the loopback token')
  assert.equal(browserRequests.some((url) => new URL(url).pathname === '/cell/mcp'), true, 'Face never traversed the real same-origin MCP query path')
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const artifactPath = process.env.SOPHIA_NOTEBOOK_SCREENSHOT
  ?? resolve(tmpdir(), 'prime-notebook-arc-f5-local.png')
const sourceModulePath = producerPath()
const producer = await import(pathToFileURL(sourceModulePath).href) as ProducerModule
assert.equal(typeof producer.buildAgentSessionFamilyProjection, 'function', 'configured module is not the production family serializer')
const phaseOneSnapshot = phaseSnapshot(false)
const phaseTwoSnapshot = phaseSnapshot(true)
assert.ok(PHASE_TWO_REVISION > PHASE_ONE_REVISION, 'terminal projection revision must advance monotonically')
for (const [label, snapshot] of [['phase one', phaseOneSnapshot], ['phase two', phaseTwoSnapshot]] as const) {
  const offeredRoot = snapshot.root as Record<string, unknown>
  for (const [field, secret] of Object.entries(SNAPSHOT_POISON)) {
    assert.equal(offeredRoot[field], secret, `${label} producer fixture omitted poisoned ${field}`)
  }
}
const phaseOneUpdate = producer.buildAgentSessionFamilyProjection(phaseOneSnapshot)
const phaseTwoUpdate = producer.buildAgentSessionFamilyProjection(phaseTwoSnapshot)
const parentIri = extractSessionIri(phaseOneUpdate, PARENT_SESSION_ID)
assert.equal(extractSessionIri(phaseTwoUpdate, PARENT_SESSION_ID), parentIri, 'producer changed root Session identity across phases')
for (const update of [phaseOneUpdate, phaseTwoUpdate]) {
  assert.ok(update.includes(`GRAPH <${USER_GRAPH_IRI}>`), 'producer update crossed the expected user-RDF authority')
  for (const secret of SNAPSHOT_POISON_VALUES) {
    assert.equal(update.includes(secret), false, `producer projection leaked offered snapshot poison ${secret}`)
  }
}

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
const manifestDir = mkdtempSync(resolve(tmpdir(), 'shrubbery-arc-f5-browser.'))
const manifestPath = resolve(manifestDir, 'loopback.json')
let cleanupFailure: AggregateError | null = null

try {
  const bin = resolveGardendBin()
  assert.equal(existsSync(bin), true, `real gardend binary does not exist: ${bin}`)
  cell = await withinDeadline('gardend startup', async () =>
    await spawnGardend({ bin, readyTimeoutMs: LIVE_TIMEOUT_MS }))
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await callToolWithinDeadline(mcp, 'create_graph', {
    graph_id: GRAPH_ID,
    title: 'Arc F5 local browser proof',
  })
  await applyUpdate(mcp, phaseOneUpdate)
  await seedGraphPoison(mcp, parentIri)
  assert.equal(await graphRevision(mcp, parentIri), PHASE_ONE_REVISION)
  await assertRealGraphPoisonBoundary(mcp, parentIri)

  writeFileSync(manifestPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }))
  vite = await withinDeadline('Vite construction', async () => await createServer({
      root: appDir,
      configFile: false,
      plugins: [dynamicCellProxy({
        manifestPath,
        websocket: true,
        upstreamTimeoutMs: LIVE_TIMEOUT_MS,
      })],
      optimizeDeps: { exclude: ['oxigraph'] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      logLevel: 'warn',
    }))
  await withinDeadline('Vite startup', async () => await vite!.listen())
  const address = vite.httpServer?.address()
  assert.ok(address && typeof address !== 'string', 'Vite did not expose its local receipt address')
  const origin = `http://127.0.0.1:${address.port}`
  const url = `${origin}/arc-f5-session-family-harness.html`

  browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    timeout: LIVE_TIMEOUT_MS,
  })
  const page = await withinDeadline('Chromium page creation', async () =>
    await browser!.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }))
  page.setDefaultTimeout(LIVE_TIMEOUT_MS)
  page.setDefaultNavigationTimeout(LIVE_TIMEOUT_MS)
  await page.addInitScript(({ graphId, parentSessionIri }) => {
    window.__arcF5SessionFamilyCoordinates = { graphId, parentSessionIri }
  }, { graphId: GRAPH_ID, parentSessionIri: parentIri })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const requestFailures: string[] = []
  const responseErrors: string[] = []
  const browserRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => browserRequests.push(request.url()))
  page.on('requestfailed', (request) => requestFailures.push(
    `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`,
  ))
  page.on('response', async (response) => {
    if (response.status() < 400) return
    responseErrors.push(`${response.status()} ${response.url()} — ${(await response.text().catch(() => '')).slice(0, 500)}`)
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LIVE_TIMEOUT_MS })
  await page.waitForFunction(
    () => document.body.dataset.arcF5SessionFamilyReady === 'true'
      || Boolean(document.body.dataset.arcF5SessionFamilyError),
    undefined,
    { timeout: LIVE_TIMEOUT_MS },
  )
  const bootError = await page.evaluate(() => document.body.dataset.arcF5SessionFamilyError ?? null)
  assert.equal(bootError, null, `Arc F5 family harness failed to boot: ${bootError}`)
  const family = page.locator('sh-agent-session-family-view')
  await family.waitFor({ state: 'visible', timeout: LIVE_TIMEOUT_MS })
  assert.equal(await page.locator('sh-agent-session-family-view').count(), 1, 'expected exactly one sealed family Face')
  await waitForFamily(page, expectedFamily(false))
  await assertRenderedPhase(family, false)

  const firstViewStillMounted = async (): Promise<boolean> => page.evaluate(() => {
    const harness = window.__arcF5SessionFamilyHarness
    return Boolean(harness?.view && document.querySelector('sh-agent-session-family-view') === harness.view)
  })
  assert.equal(await firstViewStillMounted(), true, 'initial family Face identity was not retained')

  await applyUpdate(mcp, phaseTwoUpdate)
  assert.equal(await graphRevision(mcp, parentIri), PHASE_TWO_REVISION)
  await assertRealGraphPoisonBoundary(mcp, parentIri)
  await waitForFamily(page, expectedFamily(true))
  await assertRenderedPhase(family, true)
  assert.equal(await firstViewStillMounted(), true, 'polling replaced the mounted family Face')

  await applyUpdate(mcp, phaseOneUpdate)
  assert.equal(await graphRevision(mcp, parentIri), PHASE_TWO_REVISION, 'stale producer update regressed graph revision')
  await assertRealGraphPoisonBoundary(mcp, parentIri)
  await page.waitForTimeout(STALE_OBSERVATION_MS)
  await waitForFamily(page, expectedFamily(true))
  await assertRenderedPhase(family, true)
  assert.equal(await firstViewStillMounted(), true, 'stale replay replaced the mounted family Face')

  const bodyText = await page.locator('body').innerText()
  assert.doesNotMatch(bodyText, /unregistered collection itemFaceId/iu)
  assert.doesNotMatch(bodyText, /layout error/iu)
  await assertNoLeaks(page, family, cell, browserRequests)
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(responseErrors, [])
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(requestFailures, [])

  await withinDeadline('receipt artifact directory creation', async () => {
    await mkdir(dirname(artifactPath), { recursive: true })
  })
  await page.screenshot({ path: artifactPath, fullPage: true, timeout: LIVE_TIMEOUT_MS })
  console.log(JSON.stringify({
    schema: 'sophia.arc-f5-local-browser-proof.v1',
    graphId: GRAPH_ID,
    producer: {
      module: sourceModulePath,
      sha256: createHash('sha256').update(readFileSync(sourceModulePath)).digest('hex'),
      phaseOneUpdateSha256: updateDigest(phaseOneUpdate),
      phaseTwoUpdateSha256: updateDigest(phaseTwoUpdate),
    },
    path: ['buildAgentSessionFamilyProjection', 'gardend sparql_update', '/cell/mcp sparql_query', 'agent.session-family', 'Chromium'],
    revisions: [PHASE_ONE_REVISION, PHASE_TWO_REVISION, PHASE_TWO_REVISION],
    revisionContract: 'monotone + stale-CAS',
    staleReplayRejected: true,
    sameMountedFace: true,
    phaseOne: {
      parent: 'open / generation 2 / running worker+kernel',
      children: [
        'closing / claimed / reserved / generation 0 worker_exit terminal',
        'closing / cancelling / reserved / generation 0 running worker+kernel',
        'closed / cancelled / released / no materialization',
      ],
    },
    phaseTwo: {
      parent: 'open / generation 2 / running worker+kernel',
      children: [
        'closed / failed / settled / generation 0 worker_exit terminal',
        'closed / cancelled / settled / generation 0 cancelled worker+kernel',
        'closed / cancelled / released / no materialization',
      ],
    },
    poisonBoundary: {
      snapshotFieldsOffered: Object.keys(SNAPSHOT_POISON),
      snapshotPoisonExcludedFromProducerAndGraph: SNAPSHOT_POISON_VALUES.length,
      nonSelectedGraphPoisonSeededAndRetained: GRAPH_POISON_VALUES.length,
      allPoisonExcludedFromFaceModelAndDom: ALL_POISON_VALUES.length,
    },
    operationDeadlineMs: LIVE_TIMEOUT_MS,
    browserMcpQueries: browserRequests.filter((requestUrl) => new URL(requestUrl).pathname === '/cell/mcp').length,
    rawIdsDisplayed: false,
    secretsDisplayed: false,
    actionsDisplayed: false,
    directLoopbackRequests: 0,
    pageErrors,
    consoleErrors,
    requestFailures,
    responseErrors,
    artifactPath,
  }, null, 2))
} finally {
  const cleanupErrors: unknown[] = []
  const clean = async (label: string, operation: () => Promise<unknown>): Promise<void> => {
    try {
      await withinDeadline(label, operation)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (browser) await clean('Chromium teardown', async () => await browser!.close())
  if (vite) await clean('Vite teardown', async () => await vite!.close())
  if (cell) await clean('gardend teardown', async () => await cell!.kill())
  await clean('receipt manifest cleanup', async () => await rm(manifestDir, { recursive: true, force: true }))
  if (cleanupErrors.length > 0) {
    cleanupFailure = new AggregateError(cleanupErrors, 'Arc F5 receipt cleanup did not finish within its deadlines')
  }
}
if (cleanupFailure) throw cleanupFailure
