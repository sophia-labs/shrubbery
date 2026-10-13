/**
 * card-focus-face.test.ts — `card.focus`, `card.seat` and `card.letter`
 * (el Despacho W2): the resource-adapter shapes, their place in the CLOSED
 * fragment catalogue, and the delegating mount — over an IN-MEMORY
 * `QueryBlockService` that answers by the shape of the query text (the
 * type probe, then the inner face's own shapes). This is a synthetic
 * service, not native proof: the real cell proof is the :5182 run against
 * Sirin, recorded outside this repository (2026-09-15).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockRow, QueryBlockService } from '../../../editor-services/query-block-service.js'
import { CTA_NS } from '../../../despacho/cuenta-reading.js'
import { COR_NS } from '../../../despacho/seat-reading.js'
import { CARD_FOCUS_FACE_ID, createCardFocusFace, createCardFocusResourceAdapter } from '../card-focus-face.js'
import { CARD_SEAT_FACE_ID, createCardSeatFace, createCardSeatResourceAdapter } from '../card-seat-face.js'
import { CARD_LETTER_FACE_ID, createCardLetterFace, createCardLetterResourceAdapter } from '../card-letter-face.js'
import { createFragmentFaceRegistry, fragmentFaceIds } from '../../fragment-face-set.js'
import type { FaceMountContext } from '../../types.js'

const G = 'urn:mnemosyne:local:graph:sophia-cluster:projection:correo'
const SOPHIA = `${G}:seat:sophia`
const LETTER = `${G}:letter:chat-claude-first-return-20260913`
const BEAD = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas:cuenta:despacho'
const RUN = `${G}:run:r-1`

function uri(value: string) {
  return { type: 'uri' as const, value }
}
function lit(value: string) {
  return { type: 'literal' as const, value }
}
function bindings(columns: readonly string[], rows: readonly QueryBlockRow[]): QueryBlockResult {
  return { queryKind: 'select', resultKind: 'bindings', columns, rows, totalRowCount: rows.length, durationMs: 1, raw: null } as QueryBlockResult
}

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('card-focus-face.test.ts: run() should never be invoked by the shape suite')
  },
}

/** Answers the type probe per subject, and every other shape with the subject's own properties or nothing. */
function syntheticService(): QueryBlockService & { readonly queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    async run(_graphId, sparql) {
      queries.push(sparql)
      if (sparql.includes('rdf-syntax-ns#type> ?t')) {
        if (sparql.includes(`<${SOPHIA}>`)) return bindings(['t'], [{ t: uri(`${COR_NS}Seat`) }])
        if (sparql.includes(`<${LETTER}>`)) return bindings(['t'], [{ t: uri(`${COR_NS}Letter`) }])
        if (sparql.includes(`<${BEAD}>`)) return bindings(['t'], [{ t: uri(`${CTA_NS}Cuenta`) }])
        if (sparql.includes(`<${RUN}>`)) return bindings(['t'], [{ t: uri(`${COR_NS}Run`) }])
        return bindings(['t'], [])
      }
      if (sparql.startsWith('SELECT ?p ?o WHERE')) {
        if (sparql.includes(`<${SOPHIA}>`)) {
          return bindings(['p', 'o'], [
            { p: uri(`${COR_NS}seatId`), o: lit('sophia') },
            { p: uri(`${COR_NS}title`), o: lit('Demi of Sophia — convenor') },
            { p: uri(`${COR_NS}attestation`), o: lit('operator-attested-local') },
          ])
        }
        if (sparql.includes(`<${LETTER}>`)) {
          return bindings(['p', 'o'], [
            { p: uri(`${COR_NS}messageId`), o: lit('chat-claude-first-return-20260913') },
            { p: uri(`${COR_NS}letterKind`), o: lit('answer') },
            { p: uri(`${COR_NS}excerpt`), o: lit('Milestone 1 proven.') },
            { p: uri(`${COR_NS}bodyPath`), o: lit('notes/2026-09-13-chat/RETURN.md') },
          ])
        }
        if (sparql.includes(`<${BEAD}>`)) {
          return bindings(['p', 'o'], [
            { p: uri(`${CTA_NS}title`), o: lit('El Despacho') },
            { p: uri(`${CTA_NS}beadKind`), o: lit('campaign') },
            { p: uri(`${CTA_NS}status`), o: lit('in_progress') },
          ])
        }
      }
      return bindings([], [])
    },
  }
}

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})
afterEach(() => {
  root.remove()
})

async function mountFocus(subject: string, mode: 'chapter' | 'entry' = 'chapter') {
  const service = syntheticService()
  const adapter = createCardFocusResourceAdapter(service)
  const locator = { kind: 'graph' as const, graphId: 'sophia-cluster', subjectIri: subject }
  const handle = await adapter.compute(locator, undefined as never)
  const target = document.createElement('div')
  root.appendChild(target)
  const descriptor = { schemaVersion: 1 as const, faceId: CARD_FOCUS_FACE_ID, resource: locator, params: { mode } }
  const context: FaceMountContext = {
    target,
    descriptor,
    lease: { key: adapter.resourceKey(locator), shape: 'derived', value: handle, released: false, release() {} },
    constraints: { minWidth: 0, minHeight: 0, overflow: 'clip' },
  }
  const view = await createCardFocusFace().mount(context)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { target, view, service }
}

describe('the three W2 faces — resource adapter shapes and the closed catalogue', () => {
  it('have their ids and adapter ids, accept the same two locator shapes card.cuenta does, and key collision-safe', () => {
    for (const [faceId, adapter, tag] of [
      [CARD_SEAT_FACE_ID, createCardSeatResourceAdapter(unusedService), 'card-seat'],
      [CARD_LETTER_FACE_ID, createCardLetterResourceAdapter(unusedService), 'card-letter'],
      [CARD_FOCUS_FACE_ID, createCardFocusResourceAdapter(unusedService), 'card-focus'],
    ] as const) {
      expect(adapter.shape).toBe('derived')
      expect(adapter.accepts({ kind: 'iri', iri: SOPHIA })).toBe(true)
      expect(adapter.accepts({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: SOPHIA })).toBe(true)
      expect(adapter.accepts({ kind: 'graph', graphId: 'sophia-cluster' })).toBe(false)
      expect(adapter.accepts({ kind: 'query', graphId: 'sophia-cluster', queryId: 'SELECT 1' })).toBe(false)
      expect(JSON.parse(adapter.resourceKey({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: SOPHIA }))).toEqual([tag, 'sophia-cluster', SOPHIA])
      expect(fragmentFaceIds()).toContain(faceId)
    }
    expect(createCardSeatResourceAdapter(unusedService).adapterId).toBe('card.seat.seat-query')
    expect(createCardLetterResourceAdapter(unusedService).adapterId).toBe('card.letter.letter-query')
    expect(createCardFocusResourceAdapter(unusedService).adapterId).toBe('card.focus.typed-query')
  })

  it('register in the closed catalogue with closed params (mode, graphIri only)', () => {
    const registry = createFragmentFaceRegistry()
    for (const face of [createCardSeatFace(), createCardLetterFace(), createCardFocusFace()]) {
      expect(registry.has(face.faceId)).toBe(true)
      expect(face.paramsSchema({ mode: 'entry', graphIri: 'sophia-cluster' })).toBe(true)
      expect(face.paramsSchema(undefined)).toBe(true)
      expect(face.paramsSchema({ sparql: 'DROP ALL' })).toBe(false)
    }
    const verdict = registry.validate({ schemaVersion: 1, faceId: 'card.focus', resource: { kind: 'graph', graphId: 'g1', subjectIri: SOPHIA }, params: { mode: 'chapter' } })
    expect(verdict.ok).toBe(true)
  })
})

describe('card.focus — the focus as what it is (synthetic service, not native proof)', () => {
  it('probes the type once per graph and mounts the seat character for a seat', async () => {
    const { target, service } = await mountFocus(SOPHIA)
    expect(target.dataset.focusKind).toBe('seat')
    const el = target.querySelector('sh-seat-character-view') as HTMLElement & { reading: { title: string } | null; updateComplete: Promise<unknown> }
    expect(el).not.toBeNull()
    await el.updateComplete
    expect(el.reading?.title).toBe('Demi of Sophia — convenor')
    expect(service.queries.filter((q) => q.includes('rdf-syntax-ns#type> ?t'))).toHaveLength(1)
  })

  it('mounts the letter page for a letter and the cuenta chapter for a bead', async () => {
    const letter = await mountFocus(LETTER)
    expect(letter.target.dataset.focusKind).toBe('letter')
    expect(letter.target.querySelector('sh-letter-page-view')).not.toBeNull()
    const bead = await mountFocus(BEAD, 'entry')
    expect(bead.target.dataset.focusKind).toBe('cuenta')
    const chapter = bead.target.querySelector('sh-cuenta-chapter-view') as HTMLElement & { mode: string }
    expect(chapter).not.toBeNull()
    expect(chapter.mode).toBe('entry')
  })

  it('says honestly what a stranger is instead of painting a blank', async () => {
    const { target, view } = await mountFocus(RUN)
    expect(target.dataset.focusKind).toBe('unknown')
    expect(target.textContent).toContain('not a bead, a seat or a letter')
    expect(target.textContent).toContain('It is typed Run.')
    expect(() => view.serialize()).toThrow()
  })

  it('refuses an unbound {{focus}} with the room-has-no-focus message', async () => {
    const service = syntheticService()
    const adapter = createCardFocusResourceAdapter(service)
    const locator = { kind: 'graph' as const, graphId: 'sophia-cluster', subjectIri: '{{focus}}' }
    const handle = await adapter.compute(locator, undefined as never)
    const target = document.createElement('div')
    root.appendChild(target)
    await createCardFocusFace().mount({
      target,
      descriptor: { schemaVersion: 1, faceId: CARD_FOCUS_FACE_ID, resource: locator },
      lease: { key: adapter.resourceKey(locator), shape: 'derived', value: handle, released: false, release() {} },
      constraints: { minWidth: 0, minHeight: 0, overflow: 'clip' },
    })
    expect(target.textContent).toContain('This room has no focus')
    expect(service.queries).toHaveLength(0)
  })
})
