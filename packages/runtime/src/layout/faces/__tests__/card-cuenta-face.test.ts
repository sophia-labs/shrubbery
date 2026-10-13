/**
 * card-cuenta-face.test.ts — the resource-adapter shape proof for
 * `card.cuenta` (mirrors card-subject-face.test.ts's scope), the focus
 * hyperlink builder, and the face's place in the CLOSED fragment catalogue.
 * The three real queries are folded in ../../../despacho/__tests__; a real
 * cell mount is card-cuenta-face.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockService } from '../../../editor-services/query-block-service.js'
import { CARD_CUENTA_FACE_ID, NO_CUENTA_VERB_SEAM, createCardCuentaFace, createCardCuentaResourceAdapter, focusHrefFrom } from '../card-cuenta-face.js'
import { createFragmentFaceRegistry, fragmentFaceIds } from '../../fragment-face-set.js'

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('card-cuenta-face.test.ts: run() should never be invoked by this suite')
  },
}

const GATE = 'urn:mnemosyne:local:graph:sophia-cluster:projection:cuentas:cuenta:sirin-g-slice-accepted'

describe('card.cuenta — resource adapter shape', () => {
  it('has the expected face id and adapter id, and accepts the same two locator shapes card.subject does', () => {
    expect(CARD_CUENTA_FACE_ID).toBe('card.cuenta')
    const adapter = createCardCuentaResourceAdapter(unusedService)
    expect(adapter.adapterId).toBe('card.cuenta.bead-query')
    expect(adapter.shape).toBe('derived')
    expect(adapter.accepts({ kind: 'iri', iri: GATE })).toBe(true)
    expect(adapter.accepts({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: GATE })).toBe(true)
    expect(adapter.accepts({ kind: 'graph', graphId: 'sophia-cluster' })).toBe(false)
    expect(adapter.accepts({ kind: 'query', graphId: 'sophia-cluster', queryId: 'SELECT 1' })).toBe(false)
  })

  it('keys the resource by graph + subject, collision-safe', () => {
    const adapter = createCardCuentaResourceAdapter(unusedService)
    const a = adapter.resourceKey({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: GATE })
    const b = adapter.resourceKey({ kind: 'iri', iri: GATE })
    expect(a).not.toBe(b)
    expect(JSON.parse(a)).toEqual(['card-cuenta', 'sophia-cluster', GATE])
  })

  it('a handle with no verb seam has no executor and no witness; the seam is resolved per call', async () => {
    const adapter = createCardCuentaResourceAdapter(unusedService, NO_CUENTA_VERB_SEAM)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'sophia-cluster', subjectIri: GATE }, undefined as never)
    expect(handle.executor('sophia-cluster')).toBeNull()
    expect(handle.witness()).toBeNull()
    let port: { callTool(): Promise<unknown> } | null = null
    const late = createCardCuentaResourceAdapter(unusedService, { port: () => port, witness: () => (port ? 'viewer' : null) })
    const lateHandle = await late.compute({ kind: 'iri', iri: GATE }, undefined as never)
    expect(lateHandle.executor('sophia-cluster')).toBeNull()
    port = { async callTool() { return null } }
    expect(lateHandle.executor('sophia-cluster')).not.toBeNull()
    expect(lateHandle.witness()).toBe('viewer')
  })

  it('is a citizen of the closed fragment catalogue with a closed params schema', () => {
    expect(fragmentFaceIds()).toContain(CARD_CUENTA_FACE_ID)
    const registry = createFragmentFaceRegistry()
    expect(registry.has(CARD_CUENTA_FACE_ID)).toBe(true)
    const face = createCardCuentaFace()
    expect(face.paramsSchema({ mode: 'entry', graphIri: 'sophia-cluster' })).toBe(true)
    expect(face.paramsSchema(undefined)).toBe(true)
    expect(face.paramsSchema({ sparql: 'DROP ALL' })).toBe(false)
  })
})

describe('focusHrefFrom', () => {
  it('replaces only the focus param of the current address', () => {
    expect(focusHrefFrom({ href: 'http://127.0.0.1:5181/?graph=sophia-cluster&focus=urn%3Aold' }, GATE)).toBe(
      `/?graph=sophia-cluster&focus=${encodeURIComponent(GATE)}`,
    )
    expect(focusHrefFrom({ href: 'http://127.0.0.1:5181/' }, GATE)).toBe(`/?focus=${encodeURIComponent(GATE)}`)
  })
})
