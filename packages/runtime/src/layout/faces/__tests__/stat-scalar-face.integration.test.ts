/**
 * stat-scalar-face.integration.test.ts — the REAL-CELL proof for
 * `stat.scalar` (mirrors hoja-document-face.integration.test.ts's own
 * real-cell shape: spawn a REAL headless `gardend` binary — NO MOCKS, throws
 * loudly if the binary is missing — create a real graph over MCP, seed real
 * triples via real `sparql_update`, and drive it all through the REAL
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter` machinery).
 *
 * Proves, against the real cell:
 *   - mount() runs the real query once and paints the real first-row value,
 *     formatted per the real `format` param;
 *   - `refreshSeconds` polling re-runs the real query and repaints after a
 *     real mutation (a second real `sparql_update`) lands;
 *   - `dispose()` really clears the poll timer — no further real queries
 *     land after teardown;
 *   - (aesthetic-overhaul pass, builder B3) a real second bound column feeds
 *     the delta chip, and a real multi-row result feeds the sparkline series
 *     — both read straight through the real `QueryBlockResult`, no synthetic
 *     fixtures standing in for the cell.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { McpClient } from '@shrubbery/source'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { makeQueryBlockService } from '../../../editor-services/query-block-service.js'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { createStatScalarFace, createStatScalarResourceAdapter, STAT_SCALAR_FACE_ID } from '../stat-scalar-face.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'
import { TestRestClient } from './support/test-rest-client.js'

const GARDEN_BIN = resolveGardendBin()
const GRAPH_ID = 'layout-laneb-stat-scalar-it'
const DATA_GRAPH = 'urn:test:layout-laneb:stat-scalar'
const SUBJECT = 'urn:test:layout-laneb:stat-scalar:metric'
const PREDICATE = 'urn:test:layout-laneb:value'
const DELTA_PREDICATE = 'urn:test:layout-laneb:delta'
const SERIES_PREDICATE = 'urn:test:layout-laneb:series-value'
const ABSENT_SUBJECT = 'urn:test:layout-laneb:stat-scalar:absent-subject'
const LOGICAL_ID_PREDICATE = 'urn:test:layout-laneb:logical-id'
const IRI_LID_SUBJECT = 'urn:test:layout-laneb:stat-scalar:strends-subject'
// The Stage-0 seed defect (generate-observatory-dashboard-ux.mjs,
// pn-main-landing): `obs:logicalId` is materialized as an IRI TERM, and
// STRENDS on an IRI is a SPARQL type error — this value's lexical tail
// ("whatever-slice") mirrors the real slice suffixes the generator filters
// on.
const IRI_LID_VALUE = 'urn:test:layout-laneb:stat-scalar:strends-lid:whatever-slice'

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

function statLeafDoc(refreshSeconds?: number): LayoutDocument {
  const query = `SELECT ?v WHERE { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${PREDICATE}> ?v } }`
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'stat-scalar-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'S1',
    nodes: {
      S1: {
        kind: 'leaf',
        id: 'S1',
        descriptor: {
          schemaVersion: 1,
          faceId: STAT_SCALAR_FACE_ID,
          resource: { kind: 'query', graphId: GRAPH_ID, queryId: query },
          params: {
            label: 'Active runs',
            format: 'number',
            ...(refreshSeconds !== undefined ? { refreshSeconds } : {}),
          },
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

function deltaLeafDoc(): LayoutDocument {
  const query = `SELECT ?v ?delta WHERE { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${PREDICATE}> ?v . <${SUBJECT}> <${DELTA_PREDICATE}> ?delta } }`
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'stat-scalar-delta-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'S2',
    nodes: {
      S2: {
        kind: 'leaf',
        id: 'S2',
        descriptor: {
          schemaVersion: 1,
          faceId: STAT_SCALAR_FACE_ID,
          resource: { kind: 'query', graphId: GRAPH_ID, queryId: query },
          params: { label: 'Active runs', format: 'number', deltaColumn: 'delta', deltaGoodDirection: 'up' },
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

function seriesLeafDoc(): LayoutDocument {
  // ?v first so `result.columns[0]` (the headline value, same convention as
  // every other stat.scalar query) is the numeric column, not the ordering
  // subject — ORDER BY still governs row order for the series collection.
  const query = `SELECT ?v ?point WHERE { GRAPH <${DATA_GRAPH}> { ?point <${SERIES_PREDICATE}> ?v } } ORDER BY ?point`
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'stat-scalar-series-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'S3',
    nodes: {
      S3: {
        kind: 'leaf',
        id: 'S3',
        descriptor: {
          schemaVersion: 1,
          faceId: STAT_SCALAR_FACE_ID,
          resource: { kind: 'query', graphId: GRAPH_ID, queryId: query },
          params: { label: 'Trend', format: 'number', seriesColumn: 'v' },
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

// A query that matches NOTHING — `ABSENT_SUBJECT` never has `PREDICATE`
// seeded on it in any test in this file — so `statScalarReading` must land
// `no-data`, never a fabricated "0" (see stat-scalar-face.ts's own header).
function noDataLeafDoc(): LayoutDocument {
  const query = `SELECT ?v WHERE { GRAPH <${DATA_GRAPH}> { <${ABSENT_SUBJECT}> <${PREDICATE}> ?v } }`
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'stat-scalar-no-data-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'S4',
    nodes: {
      S4: {
        kind: 'leaf',
        id: 'S4',
        descriptor: {
          schemaVersion: 1,
          faceId: STAT_SCALAR_FACE_ID,
          resource: { kind: 'query', graphId: GRAPH_ID, queryId: query },
          params: { label: 'Estimated compute cost', format: 'usd' },
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

let cell: GardendCell
let mcp: McpClient

beforeAll(async () => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `stat-scalar-face.integration.test.ts requires the real gardend binary at ${GARDEN_BIN}. Set GARDEN_BIN to override.`,
    )
  }
  cell = await spawnGardend()
  mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Layout Lane B stat.scalar integration' })
}, 30000)

afterAll(async () => {
  await cell?.kill()
}, 15000)

/** A real, idempotent reseed — DELETE WHERE the old bound value, then INSERT DATA the new one. Never accumulates stale triples across calls. */
async function seedValue(value: number): Promise<void> {
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `DELETE WHERE { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${PREDICATE}> ?old } }`,
  })
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `INSERT DATA { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${PREDICATE}> "${value}"^^<http://www.w3.org/2001/XMLSchema#integer> } }`,
  })
}

/** Real, idempotent reseed of the delta-bearing row — the SAME `SUBJECT`/`PREDICATE` `seedValue` writes, plus a real second bound predicate. */
async function seedDelta(delta: number): Promise<void> {
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `DELETE WHERE { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${DELTA_PREDICATE}> ?old } }`,
  })
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `INSERT DATA { GRAPH <${DATA_GRAPH}> { <${SUBJECT}> <${DELTA_PREDICATE}> "${delta}"^^<http://www.w3.org/2001/XMLSchema#integer> } }`,
  })
}

/** Real, idempotent reseed of an ordered multi-row series — one triple per point, real subjects sorted lexically to match the desired numeric order. */
async function seedSeries(values: readonly number[]): Promise<void> {
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `DELETE WHERE { GRAPH <${DATA_GRAPH}> { ?point <${SERIES_PREDICATE}> ?old } }`,
  })
  const inserts = values
    .map((value, index) => `<urn:test:layout-laneb:series-point:${index}> <${SERIES_PREDICATE}> "${value}"^^<http://www.w3.org/2001/XMLSchema#integer> .`)
    .join('\n')
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `INSERT DATA { GRAPH <${DATA_GRAPH}> { ${inserts} } }`,
  })
}

/** Real, idempotent reseed of an IRI-valued (never a plain-literal) `obs:logicalId`-shaped predicate — proves the STRENDS-on-an-IRI seed defect against a real engine. */
async function seedLogicalIdIri(): Promise<void> {
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `DELETE WHERE { GRAPH <${DATA_GRAPH}> { <${IRI_LID_SUBJECT}> <${LOGICAL_ID_PREDICATE}> ?old } }`,
  })
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `INSERT DATA { GRAPH <${DATA_GRAPH}> { <${IRI_LID_SUBJECT}> <${LOGICAL_ID_PREDICATE}> <${IRI_LID_VALUE}> } }`,
  })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function buildInterpreter(): LayoutInterpreter {
  const service = makeQueryBlockService(new TestRestClient(mcp))
  const registry = new FaceRegistry()
  registry.register(createStatScalarFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createStatScalarResourceAdapter(service, createRawTextQueryResolver()))
  return new LayoutInterpreter(root, { registry, broker })
}

type StatView = HTMLElement & {
  status: string
  value: string
  label: string
  delta: { text: string; direction: string; tone: string } | null
  series: readonly number[]
}

describe('stat.scalar — real gardend cell, real SPARQL query', () => {
  it('mounts, runs the real query, and paints the real first-row value formatted as "number"', async () => {
    await seedValue(7)
    const interpreter = buildInterpreter()
    const result = await interpreter.reconcile(statLeafDoc(), { width: 300, height: 200 })
    expect(result.ok).toBe(true)

    const view = interpreter.leafWrapperElement('S1')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.value).toBe('7')
    expect(view.label).toBe('Active runs')

    await interpreter.dispose()
  }, 20000)

  it('refreshSeconds polling re-runs the real query and repaints after a real mutation', async () => {
    await seedValue(1)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(statLeafDoc(1), { width: 300, height: 200 })
    const view = interpreter.leafWrapperElement('S1')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready' && view.value === '1')

    await seedValue(9)
    await waitFor(() => view.value === '9', 8000)

    await interpreter.dispose()
  }, 25000)

  it('dispose() really stops polling — no further real queries land after teardown', async () => {
    await seedValue(2)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(statLeafDoc(1), { width: 300, height: 200 })
    const view = interpreter.leafWrapperElement('S1')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.value === '2')

    await interpreter.dispose()
    await seedValue(5) // mutate the real cell AFTER teardown

    await new Promise((resolve) => setTimeout(resolve, 1500)) // well past the 1s poll interval, had it survived
    expect(view.value).toBe('2') // unchanged — the real interval was really cleared
  }, 20000)

  it('a real second bound column feeds the delta chip — direction and tone derive from the real value, never fabricated', async () => {
    await seedValue(120)
    await seedDelta(15)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(deltaLeafDoc(), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('S2')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.value).toBe('120')
    expect(view.delta).toEqual({ text: '+15', direction: 'up', tone: 'good' })

    await interpreter.dispose()
  }, 20000)

  it('a real negative delta reads down/bad under the default up-is-good mapping', async () => {
    await seedValue(80)
    await seedDelta(-6)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(deltaLeafDoc(), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('S2')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.delta).toEqual({ text: '-6', direction: 'down', tone: 'bad' })

    await interpreter.dispose()
  }, 20000)

  it('a query with no deltaColumn configured renders no delta — honest absence, never a guessed "+0"', async () => {
    await seedValue(7)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(statLeafDoc(), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('S1')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.delta).toBeNull()

    await interpreter.dispose()
  }, 20000)

  it('a real multi-row result feeds the sparkline series in the query\'s own row order', async () => {
    await seedSeries([3, 5, 4, 8, 6])
    const interpreter = buildInterpreter()
    await interpreter.reconcile(seriesLeafDoc(), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('S3')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.series).toEqual([3, 5, 4, 8, 6])
    // The headline value is still honestly the first row's own value —
    // series and value are independent slices of the SAME real result.
    expect(view.value).toBe('3')

    await interpreter.dispose()
  }, 20000)

  it('a query with no seriesColumn configured renders an empty series — no sparkline data invented', async () => {
    await seedValue(7)
    const interpreter = buildInterpreter()
    await interpreter.reconcile(statLeafDoc(), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('S1')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'ready')
    expect(view.series).toEqual([])

    await interpreter.dispose()
  }, 20000)

  it('a query matching nothing paints no-data against a real cell, never "0" (Stage 0 "tell the truth")', async () => {
    const interpreter = buildInterpreter()
    const result = await interpreter.reconcile(noDataLeafDoc(), { width: 300, height: 200 })
    expect(result.ok).toBe(true)

    const view = interpreter.leafWrapperElement('S4')!.querySelector('sh-stat-scalar-view') as StatView
    await waitFor(() => view.status === 'no-data')
    expect(view.value).toBe('')
    expect(view.value).not.toBe('0')

    await interpreter.dispose()
  }, 20000)

  it('STRENDS applied directly to an IRI-valued term discards the solution; STRENDS(STR(?iri), ...) does not — the only place the seed defect is proven in a real engine', async () => {
    await seedLogicalIdIri()
    const service = makeQueryBlockService(new TestRestClient(mcp))

    const withoutStr = await service.run(
      GRAPH_ID,
      `SELECT ?lid WHERE { GRAPH <${DATA_GRAPH}> { <${IRI_LID_SUBJECT}> <${LOGICAL_ID_PREDICATE}> ?lid . FILTER(STRENDS(?lid, 'whatever-slice')) } }`,
    )
    const withStr = await service.run(
      GRAPH_ID,
      `SELECT ?lid WHERE { GRAPH <${DATA_GRAPH}> { <${IRI_LID_SUBJECT}> <${LOGICAL_ID_PREDICATE}> ?lid . FILTER(STRENDS(STR(?lid), 'whatever-slice')) } }`,
    )

    if (withoutStr.resultKind !== 'bindings' || withStr.resultKind !== 'bindings') {
      throw new Error(`expected SELECT/bindings results, got ${withoutStr.resultKind}/${withStr.resultKind}`)
    }
    // STRENDS applied straight to the IRI term is a SPARQL type error — the
    // solution is silently discarded, matching the real seed's live defect.
    expect(withoutStr.rows).toHaveLength(0)
    // STR() coerces the IRI to its lexical form first — STRENDS then
    // evaluates cleanly and the solution survives.
    expect(withStr.rows).toHaveLength(1)
  }, 20000)
})
