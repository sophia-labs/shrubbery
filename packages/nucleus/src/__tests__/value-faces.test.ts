import { describe, expect, it } from 'vitest'
import {
  buildValueDictionary,
  EMPTY_VALUE_DICTIONARY,
  genericValueView,
  orderedKindOfTerms,
  resolveValueFace,
  type ValueFaceRule,
  type ValueTerm,
  valueDictionaryQuery,
  valueViewHypertext,
} from '../value-faces/index.js'

const CLAIM = 'https://sophia-labs.ai/ontology/claim#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const uri = (value: string): ValueTerm => ({ type: 'uri', value })
const lit = (value: string, datatype?: string): ValueTerm => ({ type: 'literal', value, ...(datatype ? { datatype } : {}) })

/** Rows exactly as `valueDictionaryQuery` returns them for the Tabula ladder (pos is 1-based). */
const rungRows = [
  ['Replicated', 'replicated (independent)', 'replicated-independent', 1],
  ['Reproduced', 'reproduced (independent)', 'reproduced', 2],
  ['ProvedLean', 'proved (Lean)', 'proved-Lean', 3],
  ['ExactNumerics', 'exact numerics', 'exact-numerics', 4],
  ['HeldOutConfirmed', 'held-out confirmed', 'replicated', 5],
  ['PostHoc', 'post-hoc', 'post-hoc', 6],
  ['NotEstablished', 'not established', 'not-established', 7],
  ['Falsified', 'falsified', 'falsified', 8],
].map(([local, label, notation, pos]) => ({
  kind: uri(`${CLAIM}Rung`),
  v: uri(`${CLAIM}${local}`),
  label: lit(String(label)),
  notation: lit(String(notation)),
  pos: lit(String(pos), `${XSD}integer`),
}))
const ladder = buildValueDictionary(rungRows)

describe('value faces — face(term, dictionary entry, params)', () => {
  it('builds the ladder from the vocabulary rows: order from the OrderedCollection, label from skos:prefLabel', () => {
    expect(ladder.orders.get(`${CLAIM}Rung`)?.map(iri => iri.slice(CLAIM.length))).toEqual([
      'Replicated', 'Reproduced', 'ProvedLean', 'ExactNumerics', 'HeldOutConfirmed', 'PostHoc', 'NotEstablished', 'Falsified',
    ])
    expect(ladder.entries.get(`${CLAIM}HeldOutConfirmed`)).toMatchObject({ label: 'held-out confirmed', notation: 'replicated', order: 4 })
  })

  it('a rung IRI reads as a chip with its display label, its ladder position and a tone', () => {
    const view = resolveValueFace(uri(`${CLAIM}HeldOutConfirmed`), ladder)
    expect(view).toMatchObject({ face: 'value.chip', text: 'held-out confirmed', order: 4, kind: `${CLAIM}Rung` })
    // Order tone among the rungs that carry no named tone (6 of 8): held-out is the 5th.
    expect(view.tone).toEqual({ kind: 'order', index: 4, count: 6 })
    expect(resolveValueFace(uri(`${CLAIM}Falsified`), ladder).tone).toEqual({ kind: 'named', name: 'danger' })
    expect(resolveValueFace(uri(`${CLAIM}NotEstablished`), ladder).tone).toEqual({ kind: 'named', name: 'muted' })
  })

  it('stances: review shows the stored notation beside the label; read does not', () => {
    expect(resolveValueFace(uri(`${CLAIM}HeldOutConfirmed`), ladder, { stance: 'review' }).text).toBe('held-out confirmed · replicated')
    expect(resolveValueFace(uri(`${CLAIM}PostHoc`), ladder, { stance: 'review' }).text).toBe('post-hoc')
  })

  it('never guesses from a lexical slug: a literal "replicated" is a literal (the query should select the rung)', () => {
    expect(resolveValueFace(lit('replicated'), ladder)).toEqual({ face: 'value.generic', text: 'replicated' })
  })

  it('keys literals by DATATYPE and unknown IRIs by NAMESPACE when a rule says so', () => {
    const rules: ValueFaceRule[] = [
      { kind: `${XSD}boolean`, face: 'value.chip', params: { tone: 'none' } },
      { namespace: 'https://example.org/status/', face: 'value.text', params: { label: 'localName' } },
    ]
    expect(resolveValueFace(lit('true', `${XSD}boolean`), EMPTY_VALUE_DICTIONARY, { rules })).toMatchObject({ face: 'value.chip', text: 'true', kind: `${XSD}boolean` })
    expect(resolveValueFace(uri('https://example.org/status/open'), EMPTY_VALUE_DICTIONARY, { rules })).toMatchObject({ face: 'value.text', text: 'open' })
    expect(resolveValueFace(uri('https://elsewhere.org/x'), EMPTY_VALUE_DICTIONARY, { rules }).face).toBe('value.generic')
  })

  it('a stance-specific rule beats an any-stance rule', () => {
    const rules: ValueFaceRule[] = [
      { kind: `${CLAIM}Rung`, face: 'value.chip', params: { label: 'prefLabel', tone: 'byOrder' } },
      { kind: `${CLAIM}Rung`, stance: 'review', face: 'value.text', params: { label: 'notation' } },
    ]
    expect(resolveValueFace(uri(`${CLAIM}ExactNumerics`), ladder, { rules }).face).toBe('value.chip')
    expect(resolveValueFace(uri(`${CLAIM}ExactNumerics`), ladder, { rules, stance: 'review' })).toMatchObject({ face: 'value.text', text: 'exact-numerics' })
  })

  it('the generic face: read = the plain value, review = the RDF term notation', () => {
    const n = lit('7', `${XSD}integer`)
    expect(genericValueView(n, 'read').text).toBe('7')
    expect(genericValueView(n, 'review').text).toBe(`"7"^^${XSD}integer`)
    expect(genericValueView({ type: 'literal', value: 'hola', language: 'es' }, 'review').text).toBe('"hola"@es')
    expect(genericValueView({ type: 'bnode', value: 'b0' }).text).toBe('_:b0')
    expect(genericValueView(undefined).text).toBe('')
  })

  it('a column is ordered only when EVERY value resolves to the same ordered kind', () => {
    expect(orderedKindOfTerms([uri(`${CLAIM}PostHoc`), undefined, uri(`${CLAIM}Falsified`)], ladder)).toBe(`${CLAIM}Rung`)
    expect(orderedKindOfTerms([uri(`${CLAIM}PostHoc`), lit('post-hoc')], ladder)).toBeNull()
    expect(orderedKindOfTerms([uri('urn:x')], ladder)).toBeNull()
  })

  it('the curl target renders a chip as [label]; the dictionary query wraps every pattern in GRAPH', () => {
    expect(valueViewHypertext(resolveValueFace(uri(`${CLAIM}ExactNumerics`), ladder))).toBe('[exact numerics]')
    const sparql = valueDictionaryQuery() ?? ''
    expect(sparql).toContain(`(<${CLAIM}Rung> <${CLAIM}RungDisplayOrder>)`)
    expect(sparql.match(/GRAPH \?\w+ \{/g)?.length).toBe(4)
  })
})
