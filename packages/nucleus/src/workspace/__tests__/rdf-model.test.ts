/**
 * iteration 1a — rdf-model.ts seam test.
 *
 * rdf-model.ts is the GENERIC RDF substrate split out of ux-rdf.ts: the
 * Term/Triple model, deterministic ordering, and the N-Triples codec
 * (triplesToNT / parseNT) — with ZERO sux: knowledge. This pins:
 *   - the codec round-trips term-for-term for the subset this codebase emits
 *     (IRIs, plain + typed literals, escaped lexical forms);
 *   - parseNT is a faithful inverse of triplesToNT over a REAL payload
 *     (serializeConfigToTriples(GARDEN_DEFAULT), 275 triples);
 *   - the committed .nt seed artifact parses back to the same triple multiset;
 *   - the generic layer carries no vocabulary constants.
 *
 * Pure: no DOM, no stores, no network.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'
import {
  I,
  L,
  Lbool,
  Ldec,
  Lint,
  compareTriples,
  isIri,
  parseNT,
  termToNT,
  triplesToNT,
  type Triple,
} from '../rdf-model.js'
import { serializeConfigToTriples } from '../ux-rdf.js'
import { GARDEN_DEFAULT } from '../garden-default.js'

// Sort + key helper so we compare triple SETS, not array order.
const sortedKeys = (ts: readonly Triple[]): string[] =>
  ts
    .map((t) => `${t.s}|${t.p}|${termToNT(t.o)}`)
    .sort()

describe('rdf-model — term constructors', () => {
  it('I mints an IRI term', () => {
    expect(I('http://x/a')).toEqual({ type: 'iri', value: 'http://x/a' })
  })

  it('L mints a plain literal when no datatype, typed when given', () => {
    expect(L('hi')).toEqual({ type: 'literal', value: 'hi' })
    expect(L('5', 'http://t/int')).toEqual({ type: 'literal', value: '5', datatype: 'http://t/int' })
  })

  it('typed-literal helpers stamp the XSD datatypes', () => {
    expect(Lint(3.9)).toEqual({ type: 'literal', value: '3', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })
    expect(Lint(-2.1)).toEqual({ type: 'literal', value: '-2', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })
    expect(Lbool(true)).toEqual({ type: 'literal', value: 'true', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' })
    expect(Lbool(false)).toEqual({ type: 'literal', value: 'false', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' })
    expect(Ldec(0.8)).toEqual({ type: 'literal', value: '0.8', datatype: 'http://www.w3.org/2001/XMLSchema#decimal' })
  })

  it('isIri guards IRI vs literal terms', () => {
    expect(isIri(I('http://x/a'))).toBe(true)
    expect(isIri(L('hi'))).toBe(false)
  })
})

describe('rdf-model — termToNT escaping', () => {
  it('renders IRIs in angle brackets', () => {
    expect(termToNT(I('http://x/a'))).toBe('<http://x/a>')
  })

  it('renders plain and typed literals', () => {
    expect(termToNT(L('hi'))).toBe('"hi"')
    expect(termToNT(L('5', 'http://t/int'))).toBe('"5"^^<http://t/int>')
  })

  it('escapes backslash, quote and newline in the lexical form', () => {
    expect(termToNT(L('a"b\\c\nd'))).toBe('"a\\"b\\\\c\\nd"')
  })
})

describe('rdf-model — parseNT (the new seam)', () => {
  it('parses a single IRI-object statement', () => {
    expect(parseNT('<http://x/s> <http://x/p> <http://x/o> .')).toEqual([
      { s: 'http://x/s', p: 'http://x/p', o: I('http://x/o') },
    ])
  })

  it('parses plain and typed literal objects', () => {
    expect(parseNT('<http://x/s> <http://x/p> "hello" .')).toEqual([
      { s: 'http://x/s', p: 'http://x/p', o: L('hello') },
    ])
    expect(
      parseNT('<http://x/s> <http://x/p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .'),
    ).toEqual([{ s: 'http://x/s', p: 'http://x/p', o: L('42', 'http://www.w3.org/2001/XMLSchema#integer') }])
  })

  it('unescapes backslash, quote and newline in a literal lexical form', () => {
    const parsed = parseNT('<http://x/s> <http://x/p> "a\\"b\\\\c\\nd" .')
    expect(parsed[0].o).toEqual(L('a"b\\c\nd'))
  })

  it('skips blank lines and #-comment lines (so a seed header parses cleanly)', () => {
    const doc = ['# header comment', '', '<http://x/s> <http://x/p> "v" .', '   ', '# trailing'].join('\n')
    expect(parseNT(doc)).toEqual([{ s: 'http://x/s', p: 'http://x/p', o: L('v') }])
  })

  it('throws on a statement missing the trailing dot', () => {
    expect(() => parseNT('<http://x/s> <http://x/p> "v"')).toThrow(/trailing/)
  })

  it('throws when the subject is not an IRI', () => {
    expect(() => parseNT('"lit" <http://x/p> "v" .')).toThrow(/subject must be an IRI/)
  })
})

describe('rdf-model — codec round-trip over the REAL GARDEN_DEFAULT payload', () => {
  it('parseNT(triplesToNT(serialize(GARDEN_DEFAULT))) recovers the triple set', () => {
    const triples = serializeConfigToTriples(GARDEN_DEFAULT)
    expect(triples.length).toBe(275) // real seed size (239 base + 36 for the 6 slice-1/2 edges) — not a fabricated fixture
    const back = parseNT(triplesToNT(triples))
    expect(back.length).toBe(triples.length)
    // Multiset equality (order-independent): the codec is a faithful inverse.
    expect(sortedKeys(back)).toEqual(sortedKeys(triples))
  })

  it('re-serializing the parsed triples (sorted) is byte-identical', () => {
    const triples = serializeConfigToTriples(GARDEN_DEFAULT)
    const back = parseNT(triplesToNT(triples)).sort(compareTriples)
    expect(triplesToNT(back)).toBe(triplesToNT(triples))
  })

  it('the committed seed artifact parses back to the same triple set', () => {
    const artifact = readFileSync(
      resolve(process.cwd(), 'src/workspace/__generated__/garden-default.ux.nt'),
      'utf8',
    )
    // parseNT skips the '#' header lines itself.
    const back = parseNT(artifact)
    const live = serializeConfigToTriples(GARDEN_DEFAULT)
    expect(sortedKeys(back)).toEqual(sortedKeys(live))
  })
})

describe('rdf-model — generic substrate has no vocabulary knowledge', () => {
  it('the module source contains no sux: term', async () => {
    const src = readFileSync(resolve(process.cwd(), 'src/workspace/rdf-model.ts'), 'utf8')
    expect(src.includes('sux')).toBe(false)
    expect(src.includes('sophia.ai/ux')).toBe(false)
    expect(src.includes('Workspace')).toBe(false)
  })
})
