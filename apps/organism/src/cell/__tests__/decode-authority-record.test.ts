/**
 * decode-authority-record.test.ts — pure units for `decodeAuthorityTerm` /
 * `decodeAuthorityRecord` (WS1 §6.2.3/§9 S2, master spec §3 Slice 2).
 */
import { describe, expect, it } from 'vitest'
import { decodeAuthorityRecord, decodeAuthorityTerm } from '../source-object-runtime.js'

describe('decodeAuthorityTerm — one N-Triples Term::to_string() -> a native JS scalar', () => {
  it('<iri> -> the unwrapped IRI string', () => {
    expect(decodeAuthorityTerm('<http://mnemosyne.dev/bookmark#title>')).toBe('http://mnemosyne.dev/bookmark#title')
  })

  it('"x" -> \'x\' (a plain string literal)', () => {
    expect(decodeAuthorityTerm('"x"')).toBe('x')
  })

  it('"5"^^<...#integer> -> 5 (a real number, not a string)', () => {
    const value = decodeAuthorityTerm('"5"^^<http://www.w3.org/2001/XMLSchema#integer>')
    expect(value).toBe(5)
    expect(typeof value).toBe('number')
  })

  it('"3.14"^^<...#decimal> -> 3.14', () => {
    expect(decodeAuthorityTerm('"3.14"^^<http://www.w3.org/2001/XMLSchema#decimal>')).toBe(3.14)
  })

  it('"2.5"^^<...#double> and <...#float> both decode to numbers', () => {
    expect(decodeAuthorityTerm('"2.5"^^<http://www.w3.org/2001/XMLSchema#double>')).toBe(2.5)
    expect(decodeAuthorityTerm('"2.5"^^<http://www.w3.org/2001/XMLSchema#float>')).toBe(2.5)
  })

  it('"true"^^<...#boolean> -> true (a real boolean, not a string)', () => {
    const value = decodeAuthorityTerm('"true"^^<http://www.w3.org/2001/XMLSchema#boolean>')
    expect(value).toBe(true)
    expect(typeof value).toBe('boolean')
  })

  it('"false"^^<...#boolean> -> false', () => {
    expect(decodeAuthorityTerm('"false"^^<http://www.w3.org/2001/XMLSchema#boolean>')).toBe(false)
  })

  it('"x"@en -> \'x\' (a language-tagged literal, unwrapped)', () => {
    expect(decodeAuthorityTerm('"x"@en')).toBe('x')
  })

  it('any other ^^<datatype> decodes to its unescaped string value, never guessed as numeric/boolean', () => {
    expect(decodeAuthorityTerm('"2026-07-29T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>')).toBe(
      '2026-07-29T00:00:00Z',
    )
  })

  it('an unparseable term decodes to its raw text, never throws', () => {
    expect(() => decodeAuthorityTerm('not a real term at all')).not.toThrow()
    expect(decodeAuthorityTerm('not a real term at all')).toBe('not a real term at all')
  })

  it('a blank node decodes to its raw text', () => {
    expect(decodeAuthorityTerm('_:b0')).toBe('_:b0')
  })

  it('unescapes \\" and \\\\ inside a literal body', () => {
    expect(decodeAuthorityTerm(String.raw`"has a \"quote\" and a \\backslash"`)).toBe('has a "quote" and a \\backslash')
  })

  it('a non-finite numeric-typed literal falls back to its string form, never NaN', () => {
    expect(decodeAuthorityTerm('"not-a-number"^^<http://www.w3.org/2001/XMLSchema#integer>')).toBe('not-a-number')
  })
})

describe('decodeAuthorityRecord — {predicateIri: string[]} -> record', () => {
  it('single-element arrays collapse to a bare scalar', () => {
    const record = decodeAuthorityRecord({
      'http://mnemosyne.dev/bookmark#title': ['"My Bookmark"'],
    })
    expect(record).toEqual({ 'http://mnemosyne.dev/bookmark#title': 'My Bookmark' })
  })

  it('multi-element arrays stay arrays (2+)', () => {
    const record = decodeAuthorityRecord({
      'http://mnemosyne.dev/bookmark#tag': ['"a"', '"b"'],
    })
    expect(record).toEqual({ 'http://mnemosyne.dev/bookmark#tag': ['a', 'b'] })
  })

  it('decodes multiple predicates with mixed datatypes in one call', () => {
    const record = decodeAuthorityRecord({
      'urn:x#count': ['"20"^^<http://www.w3.org/2001/XMLSchema#integer>'],
      'urn:x#flag': ['"true"^^<http://www.w3.org/2001/XMLSchema#boolean>'],
      'urn:x#label': ['"hello"'],
    })
    expect(record).toEqual({ 'urn:x#count': 20, 'urn:x#flag': true, 'urn:x#label': 'hello' })
  })

  it('an empty predicates map decodes to an empty record', () => {
    expect(decodeAuthorityRecord({})).toEqual({})
  })
})
