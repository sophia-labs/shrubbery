/**
 * parseTerm on the term strings gardend's sparql_query returns (N-Triples terms), escapes included. The strings are
 * the grammar's own (N-Triples 1.1 ECHAR and UCHAR); the tab case is the one a note list in TSV (the Ovillo trombone's
 * score) brought back as the two characters `\t` before the one-pass unescape.
 */
import { describe, expect, it } from 'vitest'
import { parseTerm, unescapeLexical } from '../src/transport/parse-term.js'

describe('parseTerm unescapes a literal as N-Triples writes it', () => {
  it('every ECHAR', () => {
    expect(parseTerm('"start_s\\tend_s\\n0.5\\t0.9\\n"')).toEqual({ type: 'literal', value: 'start_s\tend_s\n0.5\t0.9\n' })
    expect(unescapeLexical('\\t\\b\\n\\r\\f\\"\\\'\\\\')).toBe('\t\b\n\r\f"\'\\')
  })

  it('one pass: an escaped backslash before n is a backslash and an n, not a newline', () => {
    expect(parseTerm('"a\\\\nb"')).toEqual({ type: 'literal', value: 'a\\nb' })
    expect(parseTerm('"C:\\\\tmp"')).toEqual({ type: 'literal', value: 'C:\\tmp' })
  })

  it('UCHAR, including a surrogate pair and an 8-digit escape', () => {
    expect(parseTerm('"B\\u266D3"')).toEqual({ type: 'literal', value: 'B♭3' })
    expect(parseTerm('"\\uD83C\\uDFBA"').value).toBe('🎺')
    expect(parseTerm('"\\U0001F3BA"').value).toBe('🎺')
  })

  it('keeps the datatype, and an escape outside the grammar as written', () => {
    expect(parseTerm('"a\\tb"^^<http://www.w3.org/2001/XMLSchema#string>')).toEqual({
      type: 'literal',
      value: 'a\tb',
      datatype: 'http://www.w3.org/2001/XMLSchema#string',
    })
    expect(unescapeLexical('\\q')).toBe('\\q')
    expect(parseTerm('"-0.000000000005345057729755354"^^<http://www.w3.org/2001/XMLSchema#double>').value).toBe('-0.000000000005345057729755354')
  })
})
