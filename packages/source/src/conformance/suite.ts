/**
 * suite.ts — runTripleSourceConformance: the TripleSource acceptance kit.
 *
 * The R2 contract invariants (nucleus triple-source.ts) encoded ONCE,
 * parameterized over a source factory. Run in-repo against every adapter on
 * REAL infrastructure, and shippable as the third-party implementer's
 * acceptance test: a stranger with a plain Oxigraph/Fuseki endpoint
 * implements TripleSource and passes this suite without ever hearing the
 * word "gardend".
 *
 * What it proves:
 *   - testimony fields present and self-consistent; tripleCount === parsed
 *     length (and === SELECT COUNT when sparql-capable — never a transport
 *     envelope's own counter);
 *   - EMPTY resolves with 0 — never throws, never falls back;
 *   - declared liveness ∈ SOURCE_LIVENESS; subscribe present ⇔ 'push';
 *     select present ⇔ description.sparql;
 *   - 'static' readAt is CAPTURE time — stable across reads, equal to the
 *     declared capture when the caller pins it;
 *   - failures thrown only as TripleSourceError with a taxonomy code and the
 *     upstream detail verbatim (when the caller can induce one);
 *   - close() idempotent;
 *   - description serializable and credential-free.
 *
 * NO MOCKS: the factory must return a source bound to real infrastructure
 * (a real cell, a real HTTP SPARQL store, a real fossil body). Tests whose
 * precondition the caller cannot supply (no empty graph addressable, no
 * inducible failure) skip HONESTLY via ctx.skip — they never pass silently.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SOURCE_LIVENESS,
  TripleSourceError,
  compareTriples,
  parseNT,
  triplesOf,
  type TripleSource,
} from '@shrubbery/nucleus'

const CREDENTIAL_SMELL = /token|secret|password|credential|authorization|bearer/i
const TAXONOMY = ['unauthorized', 'forbidden', 'not-found', 'unavailable', 'protocol'] as const

export interface TripleSourceConformanceOptions {
  /** A named graph the source can read. May be empty (expectedTripleCount 0). */
  readonly graphIri: string
  /** Exact expected triple count when the caller knows it (e.g. the
   *  canonical workspace seed). 0 turns the main graph into the EMPTY proof. */
  readonly expectedTripleCount?: number
  /** An addressable-but-EMPTY named graph on the same source, when the
   *  binding has one (fossils hold exactly one graph — run the suite a
   *  second time on an empty body instead). */
  readonly emptyGraphIri?: string
  /** For 'static' sources: the capture time every read must carry. */
  readonly expectedReadAt?: number
  /** Await a failing operation on a FRESH source (e.g. read a graph the
   *  binding cannot serve, kill the backing process first…). The suite
   *  asserts the rejection is a taxonomy-coded TripleSourceError. */
  readonly induceFailure?: (source: TripleSource) => Promise<unknown>
  /** MED-4: when the caller KNOWS a stable substring of the upstream message
   *  `induceFailure` will provoke (e.g. a real engine's own parse-error
   *  text), the suite asserts `err.detail` contains it VERBATIM — closing
   *  invariant 5's "carries the upstream detail verbatim" claim with a real
   *  assertion instead of merely checking `detail` is non-empty. Optional:
   *  not every binding's induced failure has a fragment stable enough to
   *  pin (e.g. a real cell's connect-refused message varies by OS/port). */
  readonly expectedErrorDetailFragment?: string
}

/**
 * Register the conformance suite for one adapter binding.
 *
 * `makeSource` may be called several times; every source it returns is
 * closed by the suite. Spawn/seed expensive infrastructure OUTSIDE the
 * factory and let it return cheap client bindings.
 */
export function runTripleSourceConformance(
  name: string,
  makeSource: () => TripleSource | Promise<TripleSource>,
  opts: TripleSourceConformanceOptions,
): void {
  describe(`TripleSource conformance — ${name}`, () => {
    let source: TripleSource

    beforeAll(async () => {
      source = await makeSource()
    })

    afterAll(async () => {
      // Invariant 6, exercised on the shared instance: double-close is legal.
      await source.close()
      await source.close()
    })

    it('description is sane, serializable, and credential-free', () => {
      const d = source.description
      expect(typeof d.kind).toBe('string')
      expect(d.kind.length).toBeGreaterThan(0)
      expect(SOURCE_LIVENESS).toContain(d.liveness)
      expect(typeof d.sparql).toBe('boolean')
      const json = JSON.stringify(d)
      expect(JSON.parse(json)).toEqual(d)
      expect(json).not.toMatch(CREDENTIAL_SMELL)
    })

    it('capability flags and optional methods agree (invariant 4)', () => {
      expect(typeof source.select === 'function').toBe(source.description.sparql)
      expect(typeof source.subscribe === 'function').toBe(source.description.liveness === 'push')
    })

    it('read returns self-consistent testimony (invariants 1+2)', async () => {
      const read = await source.read(opts.graphIri)
      expect(read.graphIri).toBe(opts.graphIri)
      expect(Number.isInteger(read.readAt)).toBe(true)
      expect(read.readAt).toBeGreaterThan(0)
      // Testimony is about the past: allow modest clock skew, never the future.
      expect(read.readAt).toBeLessThanOrEqual(Date.now() + 60_000)
      const triples = triplesOf(read)
      expect(read.tripleCount).toBe(triples.length)
      if (read.triples !== undefined && read.nt !== undefined) {
        // MED-4: TERM-FOR-TERM agreement, not merely equal carrier lengths —
        // two carriers of equal length could still disagree on content (a
        // transposed object, a dropped-then-added triple). Canonicalize both
        // through the SAME total order (compareTriples) and deep-equal.
        const fromNt = [...parseNT(read.nt)].sort(compareTriples)
        const fromTriples = [...read.triples].sort(compareTriples)
        expect(fromNt).toEqual(fromTriples)
      }
      if (opts.expectedTripleCount !== undefined) {
        expect(read.tripleCount).toBe(opts.expectedTripleCount)
      }
    })

    it('SELECT COUNT cross-checks tripleCount (when sparql-capable)', async () => {
      if (!source.select) {
        // Honest absence is itself the assertion here (invariant 4 recheck).
        expect(source.description.sparql).toBe(false)
        return
      }
      const read = await source.read(opts.graphIri)
      const res = await source.select(
        `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${opts.graphIri}> { ?s ?p ?o } }`,
      )
      expect(Number.isInteger(res.readAt)).toBe(true)
      const term = res.rows[0]?.n
      expect(term).toBeDefined()
      const m = /(\d+)/.exec(term!.value)
      expect(m).not.toBeNull()
      expect(Number(m![1])).toBe(read.tripleCount)
    })

    it('EMPTY resolves as a successful read (invariant 3)', async ctx => {
      const iri =
        opts.emptyGraphIri ?? (opts.expectedTripleCount === 0 ? opts.graphIri : undefined)
      if (iri === undefined) {
        ctx.skip() // no empty graph addressable on this binding — proven on another run
        return
      }
      const read = await source.read(iri)
      expect(read.tripleCount).toBe(0)
      expect(triplesOf(read).length).toBe(0)
    })

    it("'static' readAt is capture time — stable, never load time (invariant 7)", async ctx => {
      if (source.description.liveness !== 'static') {
        ctx.skip()
        return
      }
      const a = await source.read(opts.graphIri)
      const b = await source.read(opts.graphIri)
      expect(a.readAt).toBe(b.readAt)
      if (opts.expectedReadAt !== undefined) {
        expect(a.readAt).toBe(opts.expectedReadAt)
        expect(b.readAt).toBe(opts.expectedReadAt)
      }
    })

    it('failures are TripleSourceError with a taxonomy code (invariant 5)', async ctx => {
      if (!opts.induceFailure) {
        ctx.skip() // caller supplied no failure trigger for this binding
        return
      }
      const s = await makeSource()
      try {
        let thrown: unknown
        try {
          await opts.induceFailure(s)
        } catch (e) {
          thrown = e
        }
        expect(thrown, 'induceFailure must reject').toBeDefined()
        expect(thrown).toBeInstanceOf(TripleSourceError)
        const err = thrown as TripleSourceError
        expect(TAXONOMY).toContain(err.code)
        expect(err.message.length).toBeGreaterThan(0)
        if (opts.expectedErrorDetailFragment !== undefined) {
          // MED-4: the upstream detail carried VERBATIM — not merely present.
          expect(err.detail).toContain(opts.expectedErrorDetailFragment)
        }
      } finally {
        await s.close()
      }
    })

    it('close() is idempotent (invariant 6)', async () => {
      const s = await makeSource()
      await s.read(opts.graphIri).catch(() => undefined) // read-after-open is optional here
      await s.close()
      await s.close()
    })
  })
}
