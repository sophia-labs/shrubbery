/**
 * card-subject-face.test.ts — the resource-adapter shape proof (mirrors
 * sparql-bindings-table-face.test.ts's own scope) plus pure
 * `selectCardSubjectFields` unit coverage. A real query against a real
 * gardend cell is exercised in card-subject-face.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockService } from '../../../editor-services/query-block-service.js'
import {
  CARD_SUBJECT_FACE_ID,
  createCardSubjectResourceAdapter,
  selectCardSubjectFields,
  type CardSubjectParams,
} from '../card-subject-face.js'

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('card-subject-face.test.ts: run() should never be invoked by this suite')
  },
}

describe('card.subject — resource adapter shape', () => {
  it('has the expected face id and adapter id', () => {
    expect(CARD_SUBJECT_FACE_ID).toBe('card.subject')
    const adapter = createCardSubjectResourceAdapter(unusedService)
    expect(adapter.adapterId).toBe('card.subject.subject-query')
    expect(adapter.shape).toBe('derived')
  })

  it('accepts a bare iri locator', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:sophia:observatory:gap:1' })).toBe(true)
  })

  it('accepts a graph locator WITH subjectIri', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:sophia:observatory:gap:1' })).toBe(true)
  })

  it('rejects a graph locator WITHOUT subjectIri — a whole-graph resource, not a subject', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'graph', graphId: 'observatory' })).toBe(false)
  })

  it('rejects document/chat/query locators', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.accepts({ kind: 'chat', graphId: 'g', sessionId: 's' })).toBe(false)
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT * WHERE { ?s ?p ?o }' })).toBe(false)
  })

  it('resourceKey distinguishes bare-iri from graph-scoped locators for the SAME subject', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    const bareIri = adapter.resourceKey({ kind: 'iri', iri: 'urn:x' })
    const graphScoped = adapter.resourceKey({ kind: 'graph', graphId: 'g', subjectIri: 'urn:x' })
    expect(bareIri).not.toBe(graphScoped)
  })

  it('resourceKey is a collision-safe tagged tuple across different graphs/subjects', () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    const keyAB_C = adapter.resourceKey({ kind: 'graph', graphId: 'a:b', subjectIri: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'graph', graphId: 'a', subjectIri: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)
  })

  it('compute() resolves a bare-iri locator to a handle with subjectIri set and locatorGraphId null', async () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    const handle = await adapter.compute({ kind: 'iri', iri: 'urn:sophia:observatory:gap:1' })
    expect(handle.subjectIri).toBe('urn:sophia:observatory:gap:1')
    expect(handle.locatorGraphId).toBeNull()
  })

  it('compute() resolves a graph-scoped locator to a handle carrying BOTH subjectIri and locatorGraphId', async () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:sophia:observatory:gap:1' })
    expect(handle.subjectIri).toBe('urn:sophia:observatory:gap:1')
    expect(handle.locatorGraphId).toBe('observatory')
  })

  it('compute() rejects a graph locator without subjectIri — never silently invents a subject', async () => {
    const adapter = createCardSubjectResourceAdapter(unusedService)
    await expect(adapter.compute({ kind: 'graph', graphId: 'observatory' })).rejects.toThrow(/unexpected locator/)
  })
})

function bindingsResult(rows: ReadonlyArray<readonly [string, string]>): QueryBlockResult {
  return {
    queryKind: 'select',
    resultKind: 'bindings',
    columns: ['p', 'o'],
    rows: rows.map(([p, o]) => ({
      p: { type: 'uri', value: p },
      o: { type: 'literal', value: o },
    })),
    durationMs: 4,
    raw: {},
  }
}

describe('card.subject — selectCardSubjectFields (pure)', () => {
  const params: CardSubjectParams = {
    titleField: 'urn:x#witness',
    fields: 'urn:x#expectedSeq, urn:x#observedSeq, urn:x#gapCount',
  }

  it('groups rows by predicate and selects titleField + fields by exact predicate text', () => {
    const result = bindingsResult([
      ['urn:x#witness', 'the-witness'],
      ['urn:x#expectedSeq', '10'],
      ['urn:x#observedSeq', '13'],
      ['urn:x#gapCount', '3'],
    ])
    const selection = selectCardSubjectFields(result, params, 'urn:sophia:fallback')
    expect(selection.title).toBe('the-witness')
    expect(selection.fields).toEqual([
      { label: 'urn:x#expectedSeq', value: '10' },
      { label: 'urn:x#observedSeq', value: '13' },
      { label: 'urn:x#gapCount', value: '3' },
    ])
  })

  it('falls back to the subject IRI when titleField has no bound value — never a blank title', () => {
    const result = bindingsResult([['urn:x#gapCount', '3']])
    const selection = selectCardSubjectFields(result, params, 'urn:sophia:fallback')
    expect(selection.title).toBe('urn:sophia:fallback')
  })

  it('a requested field with no bound value renders as an empty string, not omitted — honest absence, not silent dropping', () => {
    const result = bindingsResult([['urn:x#witness', 'w']])
    const selection = selectCardSubjectFields(result, params, 'urn:sophia:fallback')
    expect(selection.fields).toEqual([
      { label: 'urn:x#expectedSeq', value: '' },
      { label: 'urn:x#observedSeq', value: '' },
      { label: 'urn:x#gapCount', value: '' },
    ])
  })

  it('multi-valued predicates join with ", "', () => {
    const result = bindingsResult([
      ['urn:x#expectedSeq', '10'],
      ['urn:x#expectedSeq', '11'],
    ])
    const selection = selectCardSubjectFields(result, params, 'urn:sophia:fallback')
    expect(selection.fields.find((f) => f.label === 'urn:x#expectedSeq')?.value).toBe('10, 11')
  })

  it('an absent `fields` param yields zero field rows — title only, no guessed properties', () => {
    const result = bindingsResult([['urn:x#witness', 'w'], ['urn:x#other', 'ignored']])
    const selection = selectCardSubjectFields(result, { titleField: 'urn:x#witness' }, 'urn:sophia:fallback')
    expect(selection.title).toBe('w')
    expect(selection.fields).toEqual([])
  })

  it('a non-bindings result yields the fallback title and zero fields — honest, not fabricated', () => {
    const result: QueryBlockResult = {
      queryKind: 'construct',
      resultKind: 'serialized',
      mediaType: 'application/n-quads',
      value: '',
      durationMs: 1,
      raw: {},
    }
    const selection = selectCardSubjectFields(result, params, 'urn:sophia:fallback')
    expect(selection.title).toBe('urn:sophia:fallback')
    expect(selection.fields).toEqual([
      { label: 'urn:x#expectedSeq', value: '' },
      { label: 'urn:x#observedSeq', value: '' },
      { label: 'urn:x#gapCount', value: '' },
    ])
  })
})
