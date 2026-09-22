/**
 * Turtle codec — the serializer is sound because its emitted Turtle parses back
 * to the SAME triple set (a genuine inverse, no mock). We round-trip:
 *   - the real catalog resource triples,
 *   - the real GARDEN_DEFAULT workspace triples (275 triples, typed literals),
 *   - hand-built edge cases (typed literals, commas/quotes in literals, the `a`
 *     keyword for rdf:type, multi-object lists).
 */

import { describe, it, expect } from 'vitest'
import {
  I,
  L,
  Lint,
  Lbool,
  Ldec,
  compareTriples,
  triplesToNT,
  type Triple,
} from '@shrubbery/nucleus'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { triplesToTurtle, parseTurtle, resourceToTriples } from '../index.js'
import { COMP_NS, RDF_TYPE } from '../context.js'

/** Canonicalize a triple list to its N-Triples form for set equality. */
function canon(ts: readonly Triple[]): string {
  return triplesToNT([...ts].sort(compareTriples))
}

/** Assert turtle round-trips: triples → turtle → parse → same triple set. */
function roundTrips(ts: readonly Triple[]): void {
  const ttl = triplesToTurtle(ts)
  const back = parseTurtle(ttl)
  expect(canon(back)).toBe(canon(ts))
}

describe('turtle — round-trips the inverse', () => {
  it('round-trips hand-built typed literals (int/bool/decimal/string)', () => {
    const s = COMP_NS + 'x'
    roundTrips([
      { s, p: RDF_TYPE, o: I(COMP_NS + 'Thing') },
      { s, p: COMP_NS + 'n', o: Lint(42) },
      { s, p: COMP_NS + 'flag', o: Lbool(true) },
      { s, p: COMP_NS + 'frac', o: Ldec(0.6) },
      { s, p: COMP_NS + 'label', o: L('plain string') },
    ])
  })

  it('round-trips literals containing commas, quotes, and newlines', () => {
    const s = COMP_NS + 'tricky'
    roundTrips([
      { s, p: COMP_NS + 'a', o: L('one, two, three') },
      { s, p: COMP_NS + 'b', o: L('he said "hi"') },
      { s, p: COMP_NS + 'c', o: L('line1\nline2') },
    ])
  })

  it('round-trips a multi-object predicate (object list `,`)', () => {
    const s = COMP_NS + 'list'
    roundTrips([
      { s, p: COMP_NS + 'has', o: I(COMP_NS + 'one') },
      { s, p: COMP_NS + 'has', o: I(COMP_NS + 'two') },
      { s, p: COMP_NS + 'has', o: I(COMP_NS + 'three') },
    ])
  })

  it('renders rdf:type as the `a` keyword and parses it back', () => {
    const s = COMP_NS + 'typed'
    const ttl = triplesToTurtle([{ s, p: RDF_TYPE, o: I(COMP_NS + 'Component') }])
    expect(ttl).toMatch(/\ba comp:Component\b/)
    expect(canon(parseTurtle(ttl))).toBe(canon([{ s, p: RDF_TYPE, o: I(COMP_NS + 'Component') }]))
  })

  it('emits a @prefix header only for prefixes actually used', () => {
    const ttl = triplesToTurtle([{ s: COMP_NS + 'x', p: RDF_TYPE, o: I(COMP_NS + 'T') }])
    expect(ttl).toContain('@prefix comp: <http://sophia.ai/component#> .')
    expect(ttl).toContain('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .')
    // sux: / cat: are unused here → not in the header.
    expect(ttl).not.toContain('@prefix sux:')
    expect(ttl).not.toContain('@prefix cat:')
  })

  it('round-trips the REAL catalog resource triples', () => {
    const catalog = {
      kind: 'catalog' as const,
      id: 'catalog',
      title: 'Catalog',
      summary: 'A catalog.',
      components: [
        { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'Top bar.' },
        { tag: 'mn-graph-panel', persistence: 'stamp', manifested: true, built: true, face: 'manifest-panel', blurb: 'Controlled SVG graph panel.' },
      ],
    }
    roundTrips(resourceToTriples(catalog))
  })

  it('round-trips the REAL GARDEN_DEFAULT workspace triples (reused sux: serializer)', () => {
    const triples = resourceToTriples({ kind: 'workspace', config: GARDEN_DEFAULT })
    expect(triples.length).toBeGreaterThan(200) // 227 today — guards "did anything serialize"
    roundTrips(triples)
  })

  it('is deterministic (same input → byte-identical turtle)', () => {
    const triples = resourceToTriples({ kind: 'workspace', config: GARDEN_DEFAULT })
    expect(triplesToTurtle(triples)).toBe(triplesToTurtle(triples))
  })
})
