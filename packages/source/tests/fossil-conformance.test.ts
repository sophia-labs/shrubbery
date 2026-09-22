/**
 * fossil-conformance.test.ts — the static-nt fossil adapter against the FULL
 * conformance suite, using the REAL committed GARDEN_DEFAULT seed body
 * (@shrubbery/nucleus/seed/garden-default.ux.nt — the same bytes the gateway
 * seed / ux_seed.rs insert into a cell's :ux:config graph). No mocks: real
 * seed artifact, real codec, real parse path.
 *
 * Also proves, adapter-specifically:
 *   - fossil-codec v1 header round-trip;
 *   - construction WITHOUT capture provenance throws the named error;
 *   - readAt === capturedAt, never load time;
 *   - source-store: 'ready' over the seed, 'empty' (never error, never
 *     fallback) on a zero-triple fossil, 'parse' on non-empty non-config
 *     input, taxonomy-coded 'not-found' on a wrong-graph binding.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseNT, uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  FOSSIL_MAGIC,
  FossilCodecError,
  FossilProvenanceError,
  createConfigStore,
  parseFossilHeader,
  serializeFossil,
  staticNtSource,
} from '../src/index.js'
import { runTripleSourceConformance } from '../src/conformance/suite.js'

const require = createRequire(import.meta.url)
const SEED_PATH = require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt')
const SEED_BODY = readFileSync(SEED_PATH, 'utf8')
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

const GRAPH_IRI = uxConfigGraphIri('g1')
// A REAL fixed capture instant, deliberately in the past relative to any test
// run — the whole point of the fossil doctrine is that this never advances.
const CAPTURED_AT = Date.UTC(2026, 5, 1, 12, 0, 0) // 2026-06-01T12:00:00.000Z — solidly past
const SOURCE_NOTE = 'gardend-local http://127.0.0.1:7090'

// ── The FULL conformance suite: canonical seed, explicit provenance ──────────

runTripleSourceConformance(
  `static-nt (${SEED_TRIPLE_COUNT}-triple GARDEN_DEFAULT seed, explicit provenance)`,
  () => staticNtSource(SEED_BODY, { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT }),
  {
    graphIri: GRAPH_IRI,
    expectedTripleCount: SEED_TRIPLE_COUNT,
    expectedReadAt: CAPTURED_AT,
    // A fossil binds exactly one graph: reading any other IRI must refuse
    // with the taxonomy, not fabricate an empty read.
    induceFailure: s => s.read('urn:mnemosyne:local:graph:other:ux:config'),
  },
)

// ── EMPTY is a first-class state: an empty-body fossil resolves 0 ───────────

runTripleSourceConformance(
  'static-nt (empty fossil body)',
  () => staticNtSource('', { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT }),
  {
    graphIri: GRAPH_IRI,
    expectedTripleCount: 0,
    expectedReadAt: CAPTURED_AT,
    induceFailure: s => s.read('urn:mnemosyne:local:graph:other:ux:config'),
  },
)

// ── Fossil v1 header codec ───────────────────────────────────────────────────

describe('fossil-codec v1', () => {
  it('round-trips the header (serialize → parse)', () => {
    const header = { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT, source: SOURCE_NOTE }
    const text = serializeFossil(header, SEED_BODY)
    expect(text.startsWith(FOSSIL_MAGIC + '\n')).toBe(true)
    expect(parseFossilHeader(text)).toEqual(header)
  })

  it('round-trips without the optional source field', () => {
    const header = { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT }
    expect(parseFossilHeader(serializeFossil(header, '<urn:s> <urn:p> "o" .\n'))).toEqual(header)
  })

  it('a plain .nt body (no magic) is honestly not a fossil → null', () => {
    expect(parseFossilHeader(SEED_BODY)).toBeNull()
    expect(parseFossilHeader('<urn:s> <urn:p> "o" .\n')).toBeNull()
  })

  it('magic without capturedAt is corrupt → FossilCodecError', () => {
    const text = `${FOSSIL_MAGIC}\n# graphIri: ${GRAPH_IRI}\n<urn:s> <urn:p> "o" .\n`
    expect(() => parseFossilHeader(text)).toThrow(FossilCodecError)
    expect(() => parseFossilHeader(text)).toThrow(/capturedAt/)
  })

  it('magic without graphIri is corrupt → FossilCodecError', () => {
    const text = `${FOSSIL_MAGIC}\n# capturedAt: ${CAPTURED_AT}\n<urn:s> <urn:p> "o" .\n`
    expect(() => parseFossilHeader(text)).toThrow(FossilCodecError)
    expect(() => parseFossilHeader(text)).toThrow(/graphIri/)
  })

  it("the body's own '#' comments never bleed into the header (first non-# line ends it)", () => {
    const header = { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT }
    // SEED_BODY itself starts with '# GENERATED …' comment lines — the header
    // run absorbs them harmlessly (unknown keys skipped, first key wins).
    const parsed = parseFossilHeader(serializeFossil(header, SEED_BODY))
    expect(parsed).toEqual(header)
  })

  it('the serialized fossil remains a valid .nt body (parseNT skips # lines)', () => {
    const text = serializeFossil({ graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT }, SEED_BODY)
    const source = staticNtSource(text)
    expect(source.description.kind).toBe('static-nt')
  })
})

// ── Fossil doctrine: refuse construction without provenance; readAt = capture ─

describe('staticNtSource doctrine', () => {
  it('construction without capture provenance throws the named error', () => {
    expect(() => staticNtSource('<urn:s> <urn:p> "o" .\n')).toThrow(FossilProvenanceError)
    expect(() => staticNtSource('<urn:s> <urn:p> "o" .\n')).toThrow(/capture provenance/)
    expect(() => staticNtSource('')).toThrow(FossilProvenanceError)
  })

  it('provenance from the in-body fossil v1 header is accepted', async () => {
    const text = serializeFossil(
      { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT, source: SOURCE_NOTE },
      SEED_BODY,
    )
    const source = staticNtSource(text)
    const read = await source.read(GRAPH_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(read.readAt).toBe(CAPTURED_AT)
    expect(source.description.endpoint).toBe(SOURCE_NOTE)
    expect(source.description.liveness).toBe('static')
    expect(source.description.sparql).toBe(false)
    expect(source.select).toBeUndefined()
  })

  it('readAt === capturedAt, never load time', async () => {
    const source = staticNtSource(SEED_BODY, { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT })
    const before = Date.now()
    const read = await source.read(GRAPH_IRI)
    expect(read.readAt).toBe(CAPTURED_AT)
    // The capture instant is a fixed constant — if an implementation ever
    // stamped load time, readAt would land in [before, now] instead.
    expect(read.readAt).not.toBeGreaterThanOrEqual(before)
  })
})

// ── source-store over real fossils ───────────────────────────────────────────

describe('createConfigStore over static-nt fossils', () => {
  it("'ready' with a parsed WorkspaceConfig over the canonical seed", async () => {
    const source = staticNtSource(SEED_BODY, { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT })
    const store = createConfigStore(source, GRAPH_IRI)
    expect(store.get().status).toBe('idle')
    const seen: string[] = []
    store.subscribe(s => seen.push(s.status))
    await store.refresh()
    const state = store.get()
    expect(state.status).toBe('ready')
    expect(state.config).not.toBeNull()
    expect(state.config!.id.length).toBeGreaterThan(0)
    expect(Object.keys(state.config!.regions).length).toBeGreaterThan(0)
    expect(state.read?.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(state.error).toBeNull()
    expect(state.errorKind).toBeNull()
    expect(seen).toEqual(['loading', 'ready'])
  })

  it("'empty' (never error, never fallback) on a zero-triple fossil", async () => {
    const source = staticNtSource('', { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT })
    const store = createConfigStore(source, GRAPH_IRI)
    await store.refresh()
    const state = store.get()
    expect(state.status).toBe('empty')
    expect(state.error).toBeNull()
    expect(state.errorKind).toBeNull()
    expect(state.config).toBeNull() // NO fallback config exists anywhere in the tree
    expect(state.read).not.toBeNull() // the read testimony is real and kept
    expect(state.read!.tripleCount).toBe(0)
    expect(state.read!.readAt).toBe(CAPTURED_AT)
  })

  it("'parse' errorKind on non-empty input that is not a workspace config", async () => {
    const source = staticNtSource('<urn:s> <urn:p> "not a workspace" .\n', {
      graphIri: GRAPH_IRI,
      capturedAt: CAPTURED_AT,
    })
    const store = createConfigStore(source, GRAPH_IRI)
    await store.refresh()
    const state = store.get()
    expect(state.status).toBe('error')
    expect(state.errorKind).toBe('parse')
    expect(state.error).toMatch(/no sux:Workspace node found/) // verbatim, never softened
    expect(state.config).toBeNull()
    expect(state.read?.tripleCount).toBe(1) // the read itself succeeded and is kept
  })

  it('taxonomy-coded errorKind on a read failure (wrong-graph binding → not-found)', async () => {
    const source = staticNtSource(SEED_BODY, { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT })
    const store = createConfigStore(source, 'urn:mnemosyne:local:graph:other:ux:config')
    await store.refresh()
    const state = store.get()
    expect(state.status).toBe('error')
    expect(state.errorKind).toBe('not-found')
    expect(state.error).toContain(GRAPH_IRI) // the honest message names what the fossil holds
    expect(state.config).toBeNull()
    expect(state.read).toBeNull() // no earlier successful read to retain
  })

  it("startPoll on a 'static' source is a documented no-op", async () => {
    const source = staticNtSource(SEED_BODY, { graphIri: GRAPH_IRI, capturedAt: CAPTURED_AT })
    const store = createConfigStore(source, GRAPH_IRI, { pollMs: 5 })
    await store.refresh()
    const stop = store.startPoll()
    expect(typeof stop).toBe('function')
    stop()
    expect(store.get().status).toBe('ready')
  })
})
