/**
 * triple-source.test.ts — the TripleSource sub-contract (DESIGN-20260711 §1.1).
 *
 * Pure contract tests: the real committed garden-default.ux.nt
 * seed is the round-trip fixture (no synthetic RDF stands in for it), the
 * closed error taxonomy is pinned, and the compile-level proofs establish
 * that TripleSource is a STANDALONE sibling of ShrubberyContract — an
 * implementor never supplies wireMode/ui/runtime/crdt — and that a read's
 * `triples` carrier feeds parseTriplesToConfig directly.
 *
 * Everything is imported through the nucleus top-level barrel: the contract
 * is exported from packages/nucleus/src/index.ts ONLY (no package.json
 * subpath — D14).
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SOURCE_LIVENESS,
  TripleSourceError,
  isEmptyRead,
  parseNT,
  parseTriplesToConfig,
  triplesOf,
  triplesToNT,
  type SourceLiveness,
  type SourceTerm,
  type Term,
  type TripleRead,
  type TripleSource,
  type TripleSourceDescription,
  type TripleSourceErrorCode,
} from '../index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED_PATH = resolve(HERE, '../workspace/__generated__/garden-default.ux.nt')

/** The real committed seed body — the ground-truth fixture for round-trips. */
const seedNT = readFileSync(SEED_PATH, 'utf8')
const seedTriples = parseNT(seedNT)

describe('triplesOf ↔ parseNT round-trip on the committed garden-default seed', () => {
  it('the committed seed is non-empty and parses into its declared workspace', () => {
    expect(seedTriples.length).toBeGreaterThan(0)
    expect(parseTriplesToConfig(seedTriples).id).toBe('GardenDefault')
  })

  it('normalizes an nt-carrier read by parsing — term-for-term equal to the parsed seed', () => {
    const read: TripleRead = {
      graphIri: 'urn:mnemosyne:ux:config',
      readAt: 1783177200000,
      tripleCount: seedTriples.length,
      nt: seedNT,
    }
    const triples = triplesOf(read)
    expect(triples).toHaveLength(read.tripleCount)
    expect(triples).toEqual(seedTriples)
  })

  it('prefers the parsed carrier when both carriers are present', () => {
    // Distinguishable carriers: the nt body is the full seed, triples is a
    // one-triple slice. The parsed carrier must win (preferred per contract).
    const read: TripleRead = {
      graphIri: 'urn:mnemosyne:ux:config',
      readAt: 1783177200000,
      tripleCount: 1,
      triples: seedTriples.slice(0, 1),
      nt: seedNT,
    }
    expect(triplesOf(read)).toEqual(seedTriples.slice(0, 1))
  })

  it('survives a full serialize→parse→serialize cycle byte-stably', () => {
    const once = triplesToNT(seedTriples)
    const reparsed = parseNT(once)
    expect(reparsed).toEqual(seedTriples)
    expect(triplesToNT(reparsed)).toBe(once)
  })

  it('throws TripleSourceError(protocol) on a carrier-less read', () => {
    const read: TripleRead = {
      graphIri: 'urn:mnemosyne:ux:config',
      readAt: 1783177200000,
      tripleCount: seedTriples.length,
    }
    let thrown: unknown
    try {
      triplesOf(read)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('protocol')
    expect(err.message).toBe(
      'TripleRead for <urn:mnemosyne:ux:config> carries neither triples nor nt',
    )
  })
})

describe('isEmptyRead — EMPTY is a first-class successful state', () => {
  it('tripleCount === 0 is empty, regardless of which carrier is present', () => {
    expect(
      isEmptyRead({ graphIri: 'urn:g', readAt: 1, tripleCount: 0, triples: [] }),
    ).toBe(true)
    expect(isEmptyRead({ graphIri: 'urn:g', readAt: 1, tripleCount: 0, nt: '' })).toBe(true)
  })

  it('a non-empty read is not empty', () => {
    expect(
      isEmptyRead({
        graphIri: 'urn:g',
        readAt: 1,
        tripleCount: seedTriples.length,
        triples: seedTriples,
      }),
    ).toBe(false)
  })

  it('an empty read still normalizes (empty is honest data, never an error)', () => {
    expect(triplesOf({ graphIri: 'urn:g', readAt: 1, tripleCount: 0, triples: [] })).toEqual([])
    expect(triplesOf({ graphIri: 'urn:g', readAt: 1, tripleCount: 0, nt: '' })).toEqual([])
  })
})

describe('TripleSourceError — the closed taxonomy, upstream messages verbatim', () => {
  it('carries code/status/detail and the exact message', () => {
    const upstreamBody =
      '{"error":"graph_not_found","message":"no such named graph <urn:x> in dataset"}'
    const err = new TripleSourceError('not-found', 'no such named graph <urn:x> in dataset', {
      status: 404,
      detail: upstreamBody,
    })
    expect(err).toBeInstanceOf(TripleSourceError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('TripleSourceError')
    expect(err.code).toBe('not-found')
    expect(err.status).toBe(404)
    // Verbatim — never softened, never rewritten.
    expect(err.detail).toBe(upstreamBody)
    expect(err.message).toBe('no such named graph <urn:x> in dataset')
  })

  it('status/detail/cause are genuinely optional', () => {
    const err = new TripleSourceError('unavailable', 'connect ECONNREFUSED 127.0.0.1:7090')
    expect(err.status).toBeUndefined()
    expect(err.detail).toBeUndefined()
    expect(err.cause).toBeUndefined()
    expect(err.message).toBe('connect ECONNREFUSED 127.0.0.1:7090')
  })

  it('propagates a cause when given one', () => {
    const cause = new Error('socket hang up')
    const err = new TripleSourceError('unavailable', 'read failed', { cause })
    expect(err.cause).toBe(cause)
  })

  it('the taxonomy is closed to exactly the five contracted codes', () => {
    expectTypeOf<TripleSourceErrorCode>().toEqualTypeOf<
      'unauthorized' | 'forbidden' | 'not-found' | 'unavailable' | 'protocol'
    >()
  })
})

describe('liveness — declared, never inferred', () => {
  it('SOURCE_LIVENESS pins the three declared modes', () => {
    expect(SOURCE_LIVENESS).toEqual(['push', 'poll', 'static'])
    expectTypeOf<SourceLiveness>().toEqualTypeOf<'push' | 'poll' | 'static'>()
  })
})

// ── A real (pure, in-memory) implementor over the committed seed ────────────
//
// This is the compile-level proof in executable form: the class implements
// TripleSource COMPLETELY while supplying none of ShrubberyContract's
// wireMode/ui/runtime/crdt members. Its data is the real committed seed, its
// readAt is the construction-time capture (static liveness, invariant 7:
// capture time is testimony handed in by whoever captured — here, the test —
// never fabricated inside the read path).
class SeedFossilSource implements TripleSource {
  readonly description: TripleSourceDescription = {
    kind: 'static-nt',
    liveness: 'static',
    sparql: false,
    endpoint: SEED_PATH,
  }

  constructor(
    private readonly graphIri: string,
    private readonly capturedAt: number,
  ) {}

  async read(graphIri: string): Promise<TripleRead> {
    if (graphIri !== this.graphIri) {
      throw new TripleSourceError('not-found', `fossil holds <${this.graphIri}>, not <${graphIri}>`)
    }
    return {
      graphIri,
      // Invariant 7: a 'static' source's readAt is CAPTURE time, not load time.
      readAt: this.capturedAt,
      tripleCount: seedTriples.length,
      triples: seedTriples,
      nt: seedNT,
    }
  }

  async close(): Promise<void> {
    // Nothing to release; idempotent by construction.
  }
}

describe('TripleSource — a standalone sibling of ShrubberyContract', () => {
  it('a complete implementor supplies only description/read/close (+optional select/subscribe)', () => {
    expectTypeOf<keyof TripleSource>().toEqualTypeOf<
      'description' | 'read' | 'select' | 'subscribe' | 'close'
    >()
  })

  it('an implementor need not supply wireMode/ui/runtime/crdt (compile-level)', () => {
    // SeedFossilSource `implements TripleSource` with zero ShrubberyContract
    // members — its existence is the proof; these assertions pin it.
    expectTypeOf<SeedFossilSource>().toExtend<TripleSource>()
    expectTypeOf<TripleSource>().not.toHaveProperty('wireMode')
    expectTypeOf<TripleSource>().not.toHaveProperty('ui')
    expectTypeOf<TripleSource>().not.toHaveProperty('runtime')
    expectTypeOf<TripleSource>().not.toHaveProperty('crdt')
    expectTypeOf<TripleSource>().not.toHaveProperty('auth')
    expectTypeOf<TripleSource>().not.toHaveProperty('rest')
    expectTypeOf<TripleSource>().not.toHaveProperty('wire')
  })

  it("TripleRead.triples is assignable to parseTriplesToConfig's input (compile-level)", () => {
    expectTypeOf<NonNullable<TripleRead['triples']>>().toExtend<
      Parameters<typeof parseTriplesToConfig>[0]
    >()
    // And SourceTerm strictly widens the nucleus Term (bnode is the only addition).
    expectTypeOf<Term>().toExtend<SourceTerm>()
  })

  it('reads the seed graph end-to-end: read → triplesOf → parseTriplesToConfig', async () => {
    const capturedAt = 1783177200000
    const source: TripleSource = new SeedFossilSource('urn:mnemosyne:ux:config', capturedAt)

    expect(source.description.liveness).toBe('static')
    // Capability flags and optional methods agree (invariant 4).
    expect(source.description.sparql).toBe(false)
    expect(source.select).toBeUndefined()
    expect(source.subscribe).toBeUndefined()

    const read = await source.read('urn:mnemosyne:ux:config')
    expect(read.readAt).toBe(capturedAt) // invariant 7: capture time, verbatim
    expect(read.tripleCount).toBe(seedTriples.length)
    expect(isEmptyRead(read)).toBe(false)

    // Both carriers present and in agreement (invariant 2).
    expect(triplesOf(read)).toHaveLength(read.tripleCount)
    expect(parseNT(read.nt!)).toEqual(read.triples)

    // The whole point: a read feeds the interpreter directly.
    const config = parseTriplesToConfig(triplesOf(read))
    expect(config.id).toBe('GardenDefault')
    expect(Object.keys(config.regions).length).toBeGreaterThan(0)

    // close() is idempotent (invariant 6).
    await source.close()
    await source.close()

    // Reading the wrong graph rejects ONLY with TripleSourceError (invariant 5).
    await expect(source.read('urn:elsewhere')).rejects.toBeInstanceOf(TripleSourceError)
    await expect(source.read('urn:elsewhere')).rejects.toMatchObject({ code: 'not-found' })
  })
})
