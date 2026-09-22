/**
 * render-flow-board.test.ts — FLOW-SHRUB-1a: a Flow board reachable as
 * turtle/JSON without a browser (unit S5, Mithras Flow playground build).
 *
 * The golden fixture (build/contracts/golden-board.json, copied byte-for-byte
 * into fixtures/flow-golden-board.json — sha receipt below) is adapted to the
 * geometry-stripped `FlowBoardRows` model by a TEST-LOCAL adapter (deliberately
 * independent of apps/flow's — this file is the render package's own statement
 * of the map), then rendered to the four faces.
 *
 * The triple production must mirror `contracts/vocabulary-map.md` (G1) — the
 * SAME map the gardend cell's `:projection:flow` materializer implements
 * (garden `flow_board.rs::board_desired_triples`); the integration seat (I1)
 * diffs the two turtles, so every shape assertion here is differential
 * hygiene: subject rule, predicate CURIEs, datatypes, `displayMode` included,
 * geometry NEVER, uri objects class-qualified by whole-board id lookup.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Triple } from '@shrubbery/nucleus'
import {
  FLOW_NS,
  FLOW_TABLES,
  flowGraphSubject,
  flowRowIri,
  linksFor,
  negotiate,
  parseTurtle,
  renderResource,
  renderTextSync,
  resourceToTriples,
  type FlowBoardResource,
  type FlowBoardRow,
  type FlowBoardRows,
  type FlowTableName,
} from '../index.js'

const GOLDEN_SHA256 = '086e5c89d3a95404eb771ca4f0d36af5e60c61a897a67e3d0917d2a5d314a33a'
const goldenPath = fileURLToPath(new URL('./fixtures/flow-golden-board.json', import.meta.url))
const goldenBytes = readFileSync(goldenPath, 'utf8')

// ── Test-local adapter: golden snapshot JSON → geometry-stripped FlowBoardRows ─
// (Flow's serializeModel writes camelCase top-level keys for the three-word
// tables; the DDL/RDF table names are snake_case — vocabulary-map.md.)
const JSON_KEY_TO_DDL: ReadonlyArray<readonly [string, FlowTableName]> = [
  ['systems', 'systems'],
  ['requirements', 'requirements'],
  ['tasks', 'tasks'],
  ['workflows', 'workflows'],
  ['workflowLinks', 'workflow_links'],
  ['outcomes', 'outcomes'],
  ['trades', 'trades'],
  ['tradeLinks', 'trade_links'],
  ['constraints', 'constraints'],
  ['constraintLinks', 'constraint_links'],
  ['sources', 'sources'],
  ['edges', 'edges'],
  ['deps', 'deps'],
]

/** The 14 geometry fields collapse to these five names (interfaces.md §C). */
const GEOMETRY_FIELDS = new Set(['x', 'y', 'width', 'height', 'waypoints'])

function goldenBoard(): FlowBoardRows {
  const snapshot = JSON.parse(goldenBytes) as Record<string, unknown>
  const board = {} as Record<FlowTableName, readonly FlowBoardRow[]>
  for (const [jsonKey, ddl] of JSON_KEY_TO_DDL) {
    const rows = (snapshot[jsonKey] ?? []) as ReadonlyArray<Record<string, string | number | boolean | null>>
    board[ddl] = rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([k]) => !GEOMETRY_FIELDS.has(k))),
    )
  }
  return board
}

const GRAPH_ID = 'golden'
const GS = flowGraphSubject(GRAPH_ID) // urn:mnemosyne:local:graph:golden

function goldenResource(): FlowBoardResource {
  return { kind: 'flow-board', graphId: GRAPH_ID, board: goldenBoard() }
}

const ctx = {
  baseUrl: 'http://localhost:8787',
  selfPath: `/g/${GRAPH_ID}/flow-board`,
  upPath: `/g/${GRAPH_ID}`,
}

/** Row count per DDL table in the golden fixture (17 rows total). */
const GOLDEN_ROW_COUNTS: Readonly<Record<FlowTableName, number>> = {
  systems: 3,
  requirements: 2,
  tasks: 2,
  workflows: 1,
  workflow_links: 1,
  outcomes: 1,
  trades: 1,
  trade_links: 1,
  constraints: 1,
  constraint_links: 1,
  sources: 1,
  edges: 1,
  deps: 1,
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

function typedSubjects(triples: readonly Triple[], pascal: string): string[] {
  return triples
    .filter((t) => t.p === RDF_TYPE && t.o.type === 'iri' && t.o.value === FLOW_NS + pascal)
    .map((t) => t.s)
}

describe('FlowBoardResource — the FLOW-SHRUB-1a render path (unit S5)', () => {
  it('the copied golden fixture is byte-identical to the pinned one (sha256 receipt)', () => {
    expect(createHash('sha256').update(goldenBytes).digest('hex')).toBe(GOLDEN_SHA256)
    expect(goldenBytes.length).toBe(2311)
  })

  it('turtle face parses and mints one subject per row, per class (subject count = row count)', () => {
    const rendered = renderTextSync(goldenResource(), 'turtle', ctx)
    const triples = parseTurtle(rendered.body)
    let total = 0
    for (const spec of FLOW_TABLES) {
      const subjects = typedSubjects(triples, spec.pascal)
      expect(subjects.length, `${spec.ddl} → flow:${spec.pascal}`).toBe(GOLDEN_ROW_COUNTS[spec.ddl])
      total += subjects.length
    }
    expect(total).toBe(17)
  })

  it('a turtle request over the seeded board enumerates every system by id (FLOW-SHRUB-1a acceptance)', () => {
    const rendered = renderTextSync(goldenResource(), 'turtle', ctx)
    const subjects = new Set(parseTurtle(rendered.body).map((t) => t.s))
    for (const id of ['sys-imu', 'sys-uav', 'sys-avionics']) {
      expect(subjects.has(`${GS}:projection:flow:system:${id}`), id).toBe(true)
    }
  })

  it('subject rule matches vocabulary-map.md exactly ({graph_subject}:projection:flow:<kebab>:{localId})', () => {
    expect(flowRowIri(GRAPH_ID, 'workflow-link', 'wl-1')).toBe(
      'urn:mnemosyne:local:graph:golden:projection:flow:workflow-link:wl-1',
    )
    const subjects = new Set(resourceToTriples(goldenResource()).map((t) => t.s))
    expect(subjects.has(`${GS}:projection:flow:workflow-link:wl-1`)).toBe(true)
    expect(subjects.has(`${GS}:projection:flow:trade-link:tl-1`)).toBe(true)
    expect(subjects.has(`${GS}:projection:flow:constraint-link:cl-1`)).toBe(true)
    expect(subjects.has(`${GS}:projection:flow:dependency:dep-1`)).toBe(true) // deps table → Dependency class
    expect(subjects.size).toBe(17)
  })

  it('geometry never reaches the triples (no x/y/width/height/waypoints); displayMode does', () => {
    const triples = resourceToTriples(goldenResource())
    const predicates = new Set(triples.map((t) => t.p))
    for (const geo of ['x', 'y', 'width', 'height', 'waypoints']) {
      expect(predicates.has(FLOW_NS + geo), `flow:${geo} must not exist`).toBe(false)
    }
    // No waypoints JSON smuggled through any literal either.
    for (const t of triples) {
      if (t.o.type === 'literal') expect(t.o.value).not.toContain('{"x":120,"y":40}')
    }
    expect(predicates.has(FLOW_NS + 'displayMode')).toBe(true)
    // Only rdf:type + flow: predicates — no view-level vocabulary (rdfs:label,
    // cat:summary, …) may pollute the differential against the cell's dump.
    for (const p of predicates) {
      expect(p === RDF_TYPE || p.startsWith(FLOW_NS), p).toBe(true)
    }
  })

  it('uri objects are class-qualified by whole-board id lookup (the sh:or unions resolve per-row)', () => {
    const triples = resourceToTriples(goldenResource())
    const objectOf = (s: string, p: string): string | undefined =>
      triples.find((t) => t.s === s && t.p === p && t.o.type === 'iri')?.o.value
    // req-2 is owned by a CONSTRAINT (fixture: system_id = "con-mass").
    expect(objectOf(`${GS}:projection:flow:requirement:req-2`, FLOW_NS + 'ownedBy')).toBe(
      `${GS}:projection:flow:constraint:con-mass`,
    )
    // cl-1 targets a REQUIREMENT (target_id = "req-1").
    expect(objectOf(`${GS}:projection:flow:constraint-link:cl-1`, FLOW_NS + 'target')).toBe(
      `${GS}:projection:flow:requirement:req-1`,
    )
    // dep-1: requirement → task.
    expect(objectOf(`${GS}:projection:flow:dependency:dep-1`, FLOW_NS + 'predecessor')).toBe(
      `${GS}:projection:flow:requirement:req-1`,
    )
    expect(objectOf(`${GS}:projection:flow:dependency:dep-1`, FLOW_NS + 'successor')).toBe(
      `${GS}:projection:flow:task:task-1`,
    )
    // edg-1: system → workflow; task-2 owned by a workflow.
    expect(objectOf(`${GS}:projection:flow:edge:edg-1`, FLOW_NS + 'targetNode')).toBe(
      `${GS}:projection:flow:workflow:wf-cal`,
    )
    expect(objectOf(`${GS}:projection:flow:task:task-2`, FLOW_NS + 'ownedBy')).toBe(
      `${GS}:projection:flow:workflow:wf-cal`,
    )
  })

  it('datatypes per the map: integers xsd:integer, booleans xsd:boolean, nulls skipped, empty strings kept', () => {
    const triples = resourceToTriples(goldenResource())
    const req1 = `${GS}:projection:flow:requirement:req-1`
    const req2 = `${GS}:projection:flow:requirement:req-2`
    const of = (s: string, p: string): Triple[] => triples.filter((t) => t.s === s && t.p === p)

    const sortOrder = of(req1, FLOW_NS + 'sortOrder')
    expect(sortOrder).toHaveLength(1)
    expect(sortOrder[0].o).toEqual({
      type: 'literal',
      value: '0',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    })

    const done = of(`${GS}:projection:flow:task:task-1`, FLOW_NS + 'done')
    expect(done[0].o).toEqual({
      type: 'literal',
      value: 'false',
      datatype: 'http://www.w3.org/2001/XMLSchema#boolean',
    })

    // req-2 has start_date/due_date/duration_days null → no triples at all.
    expect(of(req2, FLOW_NS + 'startDate')).toHaveLength(0)
    expect(of(req2, FLOW_NS + 'dueDate')).toHaveLength(0)
    expect(of(req2, FLOW_NS + 'durationDays')).toHaveLength(0)
    // …but its empty-string source ("") IS a triple (the cell emits it too).
    const src = of(req2, FLOW_NS + 'requirementSource')
    expect(src).toHaveLength(1)
    expect(src[0].o).toEqual({ type: 'literal', value: '' })
  })

  it('the RTRIP-11 renames hold: requirementSource / sourceCitation / tradeRationale', () => {
    const triples = resourceToTriples(goldenResource())
    const predicates = new Set(triples.map((t) => t.p))
    expect(predicates.has(FLOW_NS + 'requirementSource')).toBe(true)
    expect(predicates.has(FLOW_NS + 'sourceCitation')).toBe(true)
    expect(predicates.has(FLOW_NS + 'tradeRationale')).toBe(true)
    // trades.description landed as tradeRationale, never generic description.
    const trd = triples.filter((t) => t.s === `${GS}:projection:flow:trade:trd-1`)
    expect(trd.some((t) => t.p === FLOW_NS + 'description')).toBe(false)
    expect(
      trd.find((t) => t.p === FLOW_NS + 'tradeRationale')?.o,
    ).toEqual({ type: 'literal', value: 'picked on bias' })
  })

  it('a dangling uri reference is skipped, never guessed at (mirrors the cell)', () => {
    const board = goldenBoard()
    const mutated: FlowBoardRows = {
      ...board,
      deps: [{ id: 'dep-x', predecessor_id: 'no-such-row', successor_id: 'task-1' }],
    }
    const triples = resourceToTriples({ kind: 'flow-board', graphId: GRAPH_ID, board: mutated })
    const depX = triples.filter((t) => t.s === `${GS}:projection:flow:dependency:dep-x`)
    expect(depX.some((t) => t.p === RDF_TYPE)).toBe(true)
    expect(depX.some((t) => t.p === FLOW_NS + 'predecessor')).toBe(false) // dangling → no triple
    expect(depX.some((t) => t.p === FLOW_NS + 'successor')).toBe(true)
  })

  it('JSON-LD face is present and carries the flow: terms from the shared @context', async () => {
    const rendered = await renderResource(goldenResource(), 'json', ctx)
    expect(rendered.contentType).toContain('application/ld+json')
    const parsed = JSON.parse(rendered.body) as Record<string, unknown>
    expect(parsed['@context']).toBeDefined()
    const text = rendered.body
    expect(text).toContain('flow:name')
    expect(text).toContain('flow:System')
    expect(text).toContain('projection:flow:system:sys-imu')
  })

  it('markdown face lists every table (all 13 sections) and every row id', () => {
    const rendered = renderTextSync(goldenResource(), 'hypertext', ctx)
    for (const spec of FLOW_TABLES) {
      expect(rendered.body).toContain(`## ${spec.ddl}`)
    }
    for (const id of ['sys-imu', 'req-2', 'task-2', 'wl-1', 'tl-1', 'cl-1', 'dep-1']) {
      expect(rendered.body).toContain(id)
    }
    expect(rendered.body).toContain('## Navigate')
  })

  it('links: up = the graph, per-table anchors, and link-set parity across faces', () => {
    const resource = goldenResource()
    const turtleLinks = linksFor(resource, 'turtle', ctx)
    const mdLinks = linksFor(resource, 'hypertext', ctx)
    const up = mdLinks.find((l) => l.rel === 'up')
    expect(up?.href).toBe(`http://localhost:8787/g/${GRAPH_ID}`)
    const anchors = mdLinks.filter((l) => l.rel === 'related')
    expect(anchors).toHaveLength(13)
    expect(anchors.map((l) => l.href)).toContain(
      `http://localhost:8787/g/${GRAPH_ID}/flow-board#workflow_links`,
    )
    // Parity: same set modulo the self link's face-typed content type.
    const strip = (ls: typeof mdLinks): string[] =>
      ls.filter((l) => l.rel !== 'self').map((l) => `${l.rel} ${l.href} ${l.type}`)
    expect(strip(turtleLinks)).toEqual(strip(mdLinks))
  })

  it('negotiate defaults are unchanged (bare curl → markdown; explicit .ttl wins)', () => {
    expect(negotiate(`/g/${GRAPH_ID}/flow-board`, undefined).target).toBe('hypertext')
    expect(negotiate(`/g/${GRAPH_ID}/flow-board.ttl`, undefined).target).toBe('turtle')
    expect(negotiate(`/g/${GRAPH_ID}/flow-board`, 'text/turtle').target).toBe('turtle')
  })
})
