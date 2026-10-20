/**
 * typedObjectModel and resolveObjectFace over REAL data: the D5-shaped Turtle fixtures in a real Oxigraph store, read
 * with the one query the app runs (`objectTriplesQuery`), the class from the `emporium_vocab` answer's `classCatalog`.
 */

import {
  BUILTIN_OBJECT_FACE_RULES,
  classCatalogFrom,
  classPresentationRules,
  findClassEntry,
  objectSlotFields,
  objectTriplesQuery,
  objectUsageQuery,
  parseNTriplesTerm,
  resolveObjectFace,
  sparqlRows,
  triplesFromRows,
  typedObjectModel,
  typesOf,
  vocabForClass,
  vocabSummaries,
} from '@shrubbery/nucleus/object-faces'
import { describe, expect, it } from 'vitest'
import {
  AGENT,
  DREAM_REPORT,
  loadFixtures,
  queryRows,
  RUN_GRAPH,
  STIMULUS,
  TYPED_ITEM,
  UNFIT_ITEM,
  UNTYPED_ITEM,
  vocabFixture,
} from './typed-fixture-store.js'

const store = loadFixtures()
const catalog = classCatalogFrom({ structuredContent: vocabFixture() })

function read(iri: string) {
  const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(iri))))
  return { iri, types: typesOf(iri, triples), triples }
}

describe('the read: objectTriplesQuery over a named-graph store', () => {
  it('finds the subject, its nested children three levels down, and the label of its being, all inside GRAPH ?g', () => {
    const { triples, types } = read(TYPED_ITEM)
    expect(types).toEqual(['http://mnemosyne.dev/workflow#Item', DREAM_REPORT].sort())
    const subjects = new Set(triples.map((t) => t.s))
    expect(subjects).toEqual(new Set([
      TYPED_ITEM,
      `${TYPED_ITEM}/stimulus`,
      `${TYPED_ITEM}/witnesses/0`,
      `${TYPED_ITEM}/witnesses/1`,
      AGENT,
    ]))
    // Only the being's label crosses over, never the rest of what the graph says about it.
    expect(triples.filter((t) => t.s === AGENT).map((t) => t.p)).toEqual(['http://www.w3.org/2000/01/rdf-schema#label'])
  })

  it('never follows a link out of the subject: the run node it is part of is not read', () => {
    const { triples } = read(TYPED_ITEM)
    expect(triples.some((t) => t.s === `${RUN_GRAPH}#run`)).toBe(false)
  })

  it('refuses a value that is not an absolute IRI instead of splicing it into a query', () => {
    expect(() => objectTriplesQuery('item-7> } DROP ALL {')).toThrow(/absolute IRI/)
    expect(() => objectUsageQuery('not an iri')).toThrow(/absolute IRI/)
  })

  it('parses the N-Triples terms a cell answers with', () => {
    expect(parseNTriplesTerm('"33"^^<http://www.w3.org/2001/XMLSchema#integer>')).toEqual({ type: 'literal', value: '33', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })
    expect(parseNTriplesTerm('"page: \\"thirty-three\\" is not"')).toEqual({ type: 'literal', value: 'page: "thirty-three" is not' })
    expect(parseNTriplesTerm('"Traum"@de')).toEqual({ type: 'literal', value: 'Traum', language: 'de' })
    expect(parseNTriplesTerm('<urn:x>')).toEqual({ type: 'uri', value: 'urn:x' })
  })
})

describe('the catalogue: emporium_vocab classCatalog', () => {
  it('finds a class by the vocabulary whose namespace prefixes its IRI, the longest first', () => {
    const vocabs = vocabSummaries({ vocabularies: [
      { name: 'workflow', namespace: 'http://mnemosyne.dev/workflow#' },
      { name: 'types-of-freud', namespace: 'urn:sophia:type:freud-dreams:' },
      { name: 'workspace', version: '1', namespace: 'urn:sophia:type:freud-dreams:workspace#' },
    ] })
    expect(vocabForClass(vocabs, DREAM_REPORT)?.name).toBe('workspace')
    expect(vocabForClass(vocabs, 'urn:sophia:type:other:workspace#X')).toBeNull()
  })

  it('reads every entry with its fields, presentation and vocabulary', () => {
    expect(catalog.map((e) => e.iri)).toEqual([DREAM_REPORT, STIMULUS])
    const entry = findClassEntry(catalog, DREAM_REPORT)!
    expect(entry.vocab).toBe('workspace@1')
    expect(entry.fields.find((f) => f.key === 'stimulus')).toMatchObject({ datatype: 'object', class: STIMULUS })
    expect(entry.presentation?.roles).toEqual({ quote: 'quote', document: 'documentId', block: 'blockId' })
  })

  it('a vocabulary read without classCatalog (a gardend before the extension) gives no entries', () => {
    expect(classCatalogFrom({ name: 'workflow', version: '1', contract: { classes: {} } })).toEqual([])
  })
})

describe('typedObjectModel: a typed item with its contract', () => {
  const contract = findClassEntry(catalog, DREAM_REPORT)
  const model = typedObjectModel({ ...read(TYPED_ITEM), contract, catalog })

  it('names its class and takes its title and subtitle from the presentation', () => {
    expect(model).toMatchObject({
      iri: TYPED_ITEM,
      classIri: DREAM_REPORT,
      classLabel: 'Dream report',
      plural: 'Dream reports',
      title: 'Meier',
      subtitle: 'seized by some persons, laid on his back, a stake driven between his big and second toes',
      stance: 'read',
      register: 'run',
      typed: true,
    })
  })

  it('orders the fields by the presentation, then the contract, and hides none', () => {
    expect(model.fields.map((f) => f.key)).toEqual(['who', 'procedure', 'dream', 'stimulus', 'quote', 'documentId', 'blockId', 'page', 'witnesses'])
    expect(model.fields.map((f) => f.label).slice(0, 4)).toEqual(['Who', 'Procedure', 'Dream', 'Stimulus'])
  })

  it('takes kinds from the datatype first, then the presentation, then inference', () => {
    const page = model.fields.find((f) => f.key === 'page')!
    expect(page).toMatchObject({ kind: 'metric', value: '33', unit: 'p.' })
    expect(model.fields.find((f) => f.key === 'who')?.kind).toBe('state')
  })

  it('reads the roles: the quote, and the document and block its door opens', () => {
    expect(model.roles).toEqual({
      quote: 'he awoke and felt a straw sticking between his toes',
      document: { documentId: 'doc-freud', blockId: 'block-c01fe85b' },
    })
  })

  it('reads the testimony: the being and its label, the sitting, the run, the moment', () => {
    expect(model.testimony).toEqual({
      by: { agentIri: AGENT, label: 'Experiment clerk' },
      sitting: 'Experiment clerk #3',
      run: { iri: `${RUN_GRAPH}#run`, id: 'mh3x9a1' },
      at: '2026-10-20T19:58:03Z',
    })
  })

  it('draws a nested value as a nested model of its own class, and a multi nested value as a list of them', () => {
    const stimulus = model.fields.find((f) => f.key === 'stimulus')!
    expect(stimulus.value).toBe('a straw between the toes')
    expect(stimulus.objects?.map((o) => [o.iri, o.classLabel, o.title, o.fields.map((f) => `${f.key}=${f.value}`)])).toEqual([
      [`${TYPED_ITEM}/stimulus`, 'Stimulus', 'a straw between the toes', ['sense=touch', 'what=a straw between the toes']],
    ])
    const witnesses = model.fields.find((f) => f.key === 'witnesses')!
    expect(witnesses.objects?.map((o) => o.title)).toEqual(["Meier's own account (1758)", 'cited by Freud from Strümpell'])
    expect(witnesses.value).toBe("Meier's own account (1758), cited by Freud from Strümpell")
  })

  it('a card shows two to six fields, leaving the title, subtitle and the document plumbing to their places', () => {
    const card = objectSlotFields(model, 'card')
    expect(card.map((f) => f.key)).toEqual(['dream', 'stimulus', 'quote', 'page', 'witnesses'])
    expect(objectSlotFields(model, 'card', 2).map((f) => f.key)).toEqual(['dream', 'stimulus'])
    expect(objectSlotFields(model, 'pane')).toHaveLength(9)
    expect(objectSlotFields(model, 'inline')).toEqual([])
  })
})

describe('typedObjectModel: the generic model, with no contract', () => {
  it('labels a typed item by its class IRI in words and shows every triple as a field, the run bookkeeping aside', () => {
    const model = typedObjectModel(read(TYPED_ITEM))
    expect(model.typed).toBe(false)
    expect(model.classLabel).toBe('Dream report')
    expect(model.title).toBe('Meier')
    const keys = model.fields.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['who', 'procedure', 'dream', 'quote', 'documentId', 'blockId', 'page', 'stimulus', 'witnesses']))
    expect(keys).not.toContain('json')
    expect(keys).not.toContain('type')
    // Nested children are still drawn as nested models, generically.
    expect(model.fields.find((f) => f.key === 'stimulus')?.objects?.[0]?.classLabel).toBe('Stimulus')
    expect(model.fields.find((f) => f.key === 'page')?.kind).toBe('metric')
  })

  it("draws an untyped item from what its agent handed back, in the JSON's own order", () => {
    const model = typedObjectModel(read(UNTYPED_ITEM))
    expect(model).toMatchObject({ classLabel: 'Item', title: 'I. The External Sensory Stimuli.', stance: 'read', register: 'run', typed: false })
    expect(model.fields.map((f) => [f.key, f.value])).toEqual([['text', 'I. The External Sensory Stimuli.'], ['blockId', 'block-0a11']])
  })
})

describe('typedObjectModel: an unfit item', () => {
  it('is unfit, with its violations, and shows its JSON in the class columns, the missing field absent', () => {
    const contract = findClassEntry(catalog, DREAM_REPORT)
    const model = typedObjectModel({ ...read(UNFIT_ITEM), contract, catalog })
    expect(model.stance).toBe('unfit')
    // RDF keeps no order among a subject's values, so violations come back in lexical order.
    expect(model.violations).toEqual(['page: "thirty-three" is not an integer', 'who: a value is required and none was given'])
    expect(model.fields.find((f) => f.key === 'who')).toMatchObject({ absent: true, value: '' })
    expect(model.fields.find((f) => f.key === 'procedure')?.value).toBe('the rolling of thunder')
    expect(model.title).toBe('the rolling of thunder')
    expect(model.testimony.sitting).toBe('Experiment clerk #5')
  })

  it('without a contract, is still unfit and still shows what was handed back', () => {
    const model = typedObjectModel(read(UNFIT_ITEM))
    expect(model.stance).toBe('unfit')
    expect(model.fields.map((f) => f.key)).toEqual(['procedure', 'dream', 'quote', 'documentId', 'page'])
  })
})

describe('resolveObjectFace: the rule layers', () => {
  const contract = findClassEntry(catalog, DREAM_REPORT)

  it('built-in only: a card shows six fields; an inline chip none; the face is the generic one', () => {
    expect(resolveObjectFace(DREAM_REPORT, 'card')).toEqual({ faceId: 'object.card', params: { maxFields: 6, testimony: true, violations: true }, generic: true })
    expect(resolveObjectFace(DREAM_REPORT, 'inline').params).toMatchObject({ maxFields: 0, testimony: false })
  })

  it('the class presentation (the graph layer) names the class and fills title, subtitle and order', () => {
    const face = resolveObjectFace(DREAM_REPORT, 'pane', 'read', classPresentationRules(contract))
    expect(face.generic).toBe(false)
    expect(face.params).toMatchObject({ titleField: 'who', subtitleField: 'procedure', fieldOrder: ['who', 'procedure', 'dream', 'stimulus', 'quote'] })
    // Another class does not pick up this class's rule.
    expect(resolveObjectFace(STIMULUS, 'pane', 'read', classPresentationRules(contract)).generic).toBe(true)
  })

  it('the view layer wins last, and is clamped to the closed range', () => {
    expect(resolveObjectFace(DREAM_REPORT, 'card', 'read', [], { view: { maxFields: 2 } }).params.maxFields).toBe(2)
    expect(resolveObjectFace(DREAM_REPORT, 'card', 'read', [], { view: { maxFields: 40 } }).params.maxFields).toBe(6)
  })

  it('specificity: an exact class beats a namespace beats any; a stance rule applies only in its stance', () => {
    const rules = [
      { face: 'object.card' as const, namespace: 'urn:sophia:type:freud-dreams:', params: { maxFields: 3 } },
      { face: 'object.card' as const, kind: DREAM_REPORT, params: { maxFields: 4 } },
      { face: 'object.card' as const, kind: DREAM_REPORT, stance: 'unfit' as const, params: { maxFields: 5 } },
    ]
    expect(resolveObjectFace(DREAM_REPORT, 'card', 'read', rules).params.maxFields).toBe(4)
    expect(resolveObjectFace(DREAM_REPORT, 'card', 'unfit', rules).params.maxFields).toBe(5)
    expect(resolveObjectFace(STIMULUS, 'card', 'read', rules).params.maxFields).toBe(3)
  })

  it('data selects; it never supplies code: an unknown face id and an undeclared param are dropped', () => {
    const rules = [{ face: 'object.evil' as never, kind: DREAM_REPORT, params: { maxFields: 1 } }, { face: 'object.card' as const, kind: DREAM_REPORT, params: { onclick: 'alert(1)', maxFields: 3 } as never }]
    const face = resolveObjectFace(DREAM_REPORT, 'card', 'read', rules)
    expect(face.faceId).toBe('object.card')
    expect(face.params).toEqual({ maxFields: 3, testimony: true, violations: true })
    expect(BUILTIN_OBJECT_FACE_RULES.every((r) => r.face === 'object.card')).toBe(true)
  })
})
