/**
 * el Despacho S0 — the room mirror, against a REAL in-process Oxigraph
 * (the same wasm the browser ships), a fixture dumper that hands back real
 * N-Triples, and a live-rest spy that records what fell through to the cell.
 * No mocks of the store; the only substitute is the cell's dump transport.
 */
import { describe, expect, it } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus'
import {
  MemoryRoomMirrorStorage,
  RoomMirror,
  contentDigest,
  createRoomMirrorStamp,
  roomGraphIri,
  roomGraphIris,
  roomMirrorStampText,
  routeLocally,
  type RoomMirrorState,
} from '../room-mirror.js'

const GRAPH = 'room-fixture'
const CUENTAS = roomGraphIri(GRAPH, 'projection:cuentas')
const CHAMBER = roomGraphIri(GRAPH, 'projection:chamber')
const CTA = 'http://mnemosyne.dev/cuentas#'
const BEAD = `urn:mnemosyne:local:graph:${GRAPH}:projection:cuentas:cuenta:despacho`

function cuentasNt(status: string): string {
  return [
    `<${BEAD}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${CTA}Cuenta> .`,
    `<${BEAD}> <${CTA}title> "El Despacho" .`,
    `<${BEAD}> <${CTA}status> "${status}" .`,
    `<${BEAD}> <${CTA}priority> "0"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
  ].join('\n') + '\n'
}

function chamberNt(): string {
  const contract = JSON.stringify({ name: 'cuentas', version: '0.2.0', write_target: 'projection:cuentas' }).replace(/"/g, '\\"')
  return [
    `<urn:o:cuentas> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://mnemosyne.dev/chamber#DomainOntology> .`,
    `<urn:o:cuentas> <http://mnemosyne.dev/chamber#ontologyName> "cuentas" .`,
    `<urn:o:cuentas> <http://mnemosyne.dev/chamber#status> "active" .`,
    `<urn:o:cuentas> <http://mnemosyne.dev/chamber#contractJson> "${contract}" .`,
  ].join('\n') + '\n'
}

interface Fixture {
  readonly mirror: RoomMirror
  readonly dumps: string[]
  readonly remoteQueries: string[]
  readonly states: RoomMirrorState[]
  setStatus(status: string): void
}

function fixture(options: { readonly pollMs?: number; readonly storage?: MemoryRoomMirrorStorage } = {}): Fixture {
  let status = 'open'
  const dumps: string[] = []
  const remoteQueries: string[] = []
  const states: RoomMirrorState[] = []
  const liveRest = {
    async graphs() { return [] },
    async update() { throw new Error('NoWriteThroughMirror') },
    async query(_graphId: string, sparql: string) {
      remoteQueries.push(sparql)
      return { resultType: 'solutions', variables: ['n'], rows: [{ n: '"999"^^<http://www.w3.org/2001/XMLSchema#integer>' }] }
    },
  } as RestClient
  const mirror = new RoomMirror({
    liveRest,
    userId: () => 'fixture-user',
    storage: options.storage ?? new MemoryRoomMirrorStorage(),
    pollMs: options.pollMs ?? 0,
    onChange: (_graphId, state) => { states.push(state) },
    dumper: {
      async dump(_graphId, sourceGraphIri) {
        dumps.push(sourceGraphIri)
        if (sourceGraphIri === CUENTAS) return { data: cuentasNt(status) }
        if (sourceGraphIri === CHAMBER) return { data: chamberNt() }
        return { data: '' }
      },
    },
  })
  return { mirror, dumps, remoteQueries, states, setStatus: (next) => { status = next } }
}

describe('room mirror: the declared room', () => {
  it('names the four projection-sized graphs the room needs, under the graph root', () => {
    expect(roomGraphIris('g')).toEqual([
      'urn:mnemosyne:local:graph:g:projection:cuentas',
      'urn:mnemosyne:local:graph:g:projection:correo',
      'urn:mnemosyne:local:graph:g:projection:chamber',
      'urn:mnemosyne:local:graph:g:migration:chronicle',
    ])
  })

  it('routes locally only when every named graph is mirrored and none is a variable or dataset clause', () => {
    const mirrored = new Set([CUENTAS, CHAMBER])
    expect(routeLocally(`SELECT ?s WHERE { GRAPH <${CUENTAS}> { ?s ?p ?o } }`, mirrored)).toBe(true)
    expect(routeLocally('SELECT ?s WHERE { ?s ?p ?o }', mirrored)).toBe(true)
    expect(routeLocally(`SELECT ?s WHERE { GRAPH <urn:mnemosyne:local:graph:${GRAPH}:projection:semantic> { ?s ?p ?o } }`, mirrored)).toBe(false)
    expect(routeLocally('SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }', mirrored)).toBe(false)
    expect(routeLocally(`SELECT ?s FROM <${CUENTAS}> WHERE { ?s ?p ?o }`, mirrored)).toBe(false)
    // A focused SUBJECT under the graph root is not a graph: the chapter's own reading stays local.
    expect(routeLocally(`SELECT ?p ?o WHERE { GRAPH <${CUENTAS}> { <${BEAD}> ?p ?o } }`, mirrored)).toBe(true)
    expect(routeLocally(`SELECT ?p ?o WHERE { GRAPH <${CUENTAS}> { <${BEAD}> ?p ?o } GRAPH <${CHAMBER}> { ?x ?y ?z } }`, mirrored)).toBe(true)
    // Rule 3: `GRAPH ?g` — the reading modules' inherited shape — is local iff the query names an IRI the room OWNS.
    expect(routeLocally(`SELECT ?p ?o WHERE { GRAPH ?g { <${BEAD}> ?p ?o } } LIMIT 500`, mirrored)).toBe(true)
    expect(routeLocally(`SELECT ?r ?v WHERE { GRAPH ?g { ?r <${CTA}forCuenta> <${BEAD}> ; <${CTA}verdict> ?v } }`, mirrored)).toBe(true)
    expect(routeLocally(`SELECT ?p ?t WHERE { GRAPH ?g { <${BEAD}> ?p ?t } OPTIONAL { GRAPH ?g2 { ?t <${CTA}title> ?tt } } }`, mirrored)).toBe(true)
    // …but a document, a foreign subject, or nothing owned at all still goes to the cell.
    expect(routeLocally(`SELECT DISTINCT ?t WHERE { GRAPH ?g { <urn:mnemosyne:local:graph:${GRAPH}:projection:document:some-doc> a ?t } }`, mirrored)).toBe(false)
    expect(routeLocally('SELECT DISTINCT ?t WHERE { GRAPH ?g { <urn:sophia:agent:x> a ?t } }', mirrored)).toBe(false)
    expect(routeLocally(`SELECT ?o WHERE { GRAPH ?g { <${BEAD}> ?p ?o } GRAPH <urn:mnemosyne:local:graph:${GRAPH}:projection:semantic> { ?a ?b ?c } }`, mirrored)).toBe(false)
  })

  it('digests content by bytes, so identical dumps share an identity and a one-character change does not', () => {
    expect(contentDigest('a b c .')).toBe(contentDigest('a b c .'))
    expect(contentDigest('a b c .')).not.toBe(contentDigest('a b d .'))
  })
})

describe('room mirror: sync, local reads, honest fall-through', () => {
  it('has no service before a sync, then answers a mirrored-graph SELECT from the local store in single-digit milliseconds', async () => {
    const { mirror, dumps, remoteQueries } = fixture()
    expect(mirror.queryService(GRAPH)).toBeNull()
    await mirror.ensureOpen(GRAPH)
    expect(dumps.sort()).toEqual([...roomGraphIris(GRAPH)].sort())
    const state = mirror.state(GRAPH)
    expect(state.status).toBe('ready')
    expect(state.restored).toBe(false)
    expect(state.quadCount).toBe(8)
    const service = mirror.queryService(GRAPH)
    expect(service).not.toBeNull()
    const started = performance.now()
    const result = await service!.run(GRAPH, `SELECT ?status WHERE { GRAPH <${CUENTAS}> { <${BEAD}> <${CTA}status> ?status } }`)
    const elapsed = performance.now() - started
    expect(result.resultKind).toBe('bindings')
    if (result.resultKind !== 'bindings') throw new Error('unreachable')
    expect(result.rows[0]!.status).toEqual({ type: 'literal', value: 'open' })
    expect(remoteQueries).toEqual([])
    expect(elapsed).toBeLessThan(50)
    expect(mirror.state(GRAPH).local.count).toBe(1)
  })

  it('falls through to the cell, counted, for a query that names an unmirrored graph or a graph variable', async () => {
    const { mirror, remoteQueries } = fixture()
    await mirror.ensureOpen(GRAPH)
    const service = mirror.queryService(GRAPH)!
    const whole = await service.run(GRAPH, 'SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }')
    expect(whole.resultKind).toBe('bindings')
    if (whole.resultKind !== 'bindings') throw new Error('unreachable')
    expect(whole.rows[0]!.n!.value).toBe('999')
    await service.run(GRAPH, `SELECT ?s WHERE { GRAPH <urn:mnemosyne:local:graph:${GRAPH}:projection:semantic> { ?s ?p ?o } }`)
    expect(remoteQueries).toHaveLength(2)
    const state = mirror.state(GRAPH)
    expect(state.remote.count).toBe(2)
    expect(state.local.count).toBe(0)
  })

  it('keeps one service identity across a poll that dumps identical bytes, and rotates once when the content changes', async () => {
    const { mirror, setStatus } = fixture()
    await mirror.ensureOpen(GRAPH)
    const first = mirror.queryService(GRAPH)
    await mirror.sync(GRAPH)
    expect(mirror.queryService(GRAPH)).toBe(first)
    setStatus('done')
    await mirror.sync(GRAPH)
    const second = mirror.queryService(GRAPH)
    expect(second).not.toBe(first)
    const result = await second!.run(GRAPH, `SELECT ?status WHERE { GRAPH <${CUENTAS}> { <${BEAD}> <${CTA}status> ?status } }`)
    if (result.resultKind !== 'bindings') throw new Error('unreachable')
    expect(result.rows[0]!.status!.value).toBe('done')
  })

  it('restores from storage on the next open, marked as restored, before the live dump lands', async () => {
    const storage = new MemoryRoomMirrorStorage()
    const first = fixture({ storage })
    await first.mirror.ensureOpen(GRAPH)
    const second = fixture({ storage })
    const opening = second.mirror.ensureOpen(GRAPH)
    // Observe the restored state on the way to the live sync.
    await opening
    const restoredStates = second.states.filter((state) => state.status === 'ready' && state.restored)
    expect(restoredStates.length).toBeGreaterThan(0)
    expect(second.mirror.state(GRAPH).restored).toBe(false)
    expect(second.mirror.state(GRAPH).status).toBe('ready')
  })
})

describe('room mirror: the verb seam re-dumps the graph a word touched', () => {
  it('re-dumps the vocab’s write_target (read from the mirrored chamber) after a non-dry, ok emporium_write, and nothing after a dry run or a refusal', async () => {
    const { mirror, dumps, setStatus } = fixture()
    await mirror.ensureOpen(GRAPH)
    dumps.length = 0
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const port = mirror.wrapVerbPort({
      async callTool(name, args) {
        calls.push({ name, args })
        if (name !== 'emporium_write') return { fine: true }
        return { ok: args.vocab !== 'refused', dryRun: args.dryRun === true, results: [] }
      },
    }, GRAPH)
    expect(mirror.writeTargetGraphIri(GRAPH, 'cuentas')).toBe(CUENTAS)
    expect(mirror.writeTargetGraphIri(GRAPH, 'correo')).toBe(roomGraphIri(GRAPH, 'projection:correo'))

    await port.callTool('emporium_write', { graphId: GRAPH, vocab: 'cuentas', records: [], dryRun: true })
    expect(dumps).toEqual([])
    await port.callTool('emporium_write', { graphId: GRAPH, vocab: 'refused', records: [] })
    expect(dumps).toEqual([])
    await port.callTool('sparql_query', { graphId: GRAPH, query: 'ASK {}' })
    expect(dumps).toEqual([])

    setStatus('done')
    const before = mirror.queryService(GRAPH)
    await port.callTool('emporium_write', { graphId: GRAPH, vocab: 'cuentas', records: [] })
    expect(dumps).toEqual([CUENTAS])
    // The swap happened BEFORE the result returned: the next read sees the word.
    const after = mirror.queryService(GRAPH)!
    expect(after).not.toBe(before)
    const result = await after.run(GRAPH, `SELECT ?status WHERE { GRAPH <${CUENTAS}> { <${BEAD}> <${CTA}status> ?status } }`)
    if (result.resultKind !== 'bindings') throw new Error('unreachable')
    expect(result.rows[0]!.status!.value).toBe('done')
    expect(calls.map((call) => call.name)).toEqual(['emporium_write', 'emporium_write', 'sparql_query', 'emporium_write'])
  })
})

describe('room mirror: the stamp says what is true', () => {
  it('renders each status honestly and hides when there is no room', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const stamp = createRoomMirrorStamp(host)
    stamp.sync(null, null)
    expect(host.querySelector('[data-room-mirror]')).toBeNull()
    const { mirror } = fixture()
    let resyncs = 0
    stamp.sync(mirror.state(GRAPH), () => { resyncs += 1 })
    expect(host.querySelector('[data-room-mirror]')!.getAttribute('data-status')).toBe('absent')
    expect(host.querySelector('[data-room-mirror-text]')!.textContent).toContain('every read goes to the cell')
    await mirror.ensureOpen(GRAPH)
    const ready = mirror.state(GRAPH)
    stamp.sync(ready, () => { resyncs += 1 })
    const element = host.querySelector('[data-room-mirror]')!
    expect(element.getAttribute('data-status')).toBe('ready')
    expect(element.getAttribute('data-kind')).toBe('state')
    const text = host.querySelector('[data-room-mirror-text]')!.textContent ?? ''
    expect(text).toContain('4 graphs')
    expect(text).toContain('8 quads')
    ;(host.querySelector('[data-room-mirror] button') as HTMLButtonElement).click()
    expect(resyncs).toBe(1)
    expect(roomMirrorStampText({ ...ready, status: 'error', error: 'dump refused' })).toContain('dump refused')
    host.remove()
  })
})
