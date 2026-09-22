/**
 * evidence-chain-face.test.ts — the resource-adapter shape proof (mirrors
 * card-subject-face.test.ts's own scope) plus real, network-free `mount()`
 * coverage: a hand-written, REAL `QueryBlockService` implementation (never a
 * spy/mock — scripts/validate-no-mocks.mjs forbids them) stands in for the
 * network round-trip, exactly like `unusedService`/`createDocumentAdapter`
 * elsewhere in this test family, but this one is actually IMPLEMENTED rather
 * than throwing, so the real `mount()` path can be exercised in a plain DOM
 * (happy-dom) environment without a live gardend cell.
 */
import { describe, expect, it } from 'vitest'
import type { ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { ResourceLease } from '../../types.js'
import type { QueryBlockResult, QueryBlockService } from '../../../editor-services/query-block-service.js'
import {
  EVIDENCE_CHAIN_ADAPTER_ID,
  EVIDENCE_CHAIN_FACE_ID,
  createEvidenceChainFace,
  createEvidenceChainResourceAdapter,
  type EvidenceChainQueryHandle,
} from '../evidence-chain-face.js'
import type { ShSparqlTableView } from '../sparql-table-view-element.js'

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('evidence-chain-face.test.ts: run() should never be invoked by this suite')
  },
}

describe('obs.evidence-chain — resource adapter shape', () => {
  it('has the expected face id and adapter id', () => {
    expect(EVIDENCE_CHAIN_FACE_ID).toBe('obs.evidence-chain')
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    expect(adapter.adapterId).toBe(EVIDENCE_CHAIN_ADAPTER_ID)
    expect(adapter.adapterId).toBe('obs.evidence-chain.subject-query')
    expect(adapter.shape).toBe('derived')
  })

  it('accepts only a graph locator carrying a subjectIri', () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' })).toBe(true)
  })

  it('rejects a graph locator WITHOUT subjectIri — a whole-graph resource, not a subject', () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'graph', graphId: 'observatory' })).toBe(false)
  })

  it('rejects query/document/chat/iri locators — unlike card.subject, a bare iri is never accepted either', () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:x:run-1' })).toBe(false)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.accepts({ kind: 'chat', graphId: 'g', sessionId: 's' })).toBe(false)
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT * WHERE { ?s ?p ?o }' })).toBe(false)
  })

  it('resourceKey is a collision-safe tagged tuple across different graphs/subjects', () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    const keyAB_C = adapter.resourceKey({ kind: 'graph', graphId: 'a:b', subjectIri: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'graph', graphId: 'a', subjectIri: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)
  })

  it('compute() resolves a graph-scoped locator to a handle carrying subjectIri and locatorGraphId', async () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' })
    expect(handle.subjectIri).toBe('urn:x:run-1')
    expect(handle.locatorGraphId).toBe('observatory')
  })

  it('compute() rejects a graph locator without subjectIri — never silently invents a subject', async () => {
    const adapter = createEvidenceChainResourceAdapter(unusedService)
    await expect(adapter.compute({ kind: 'graph', graphId: 'observatory' })).rejects.toThrow(/unexpected locator/)
  })
})

// ── the real, network-free QueryBlockService double ─────────────────────────

function emptyBindingsResult(): QueryBlockResult {
  return {
    queryKind: 'select',
    resultKind: 'bindings',
    columns: ['event', 'capturedAt', 'kind', 'outcome', 'seq'],
    rows: [],
    durationMs: 3,
    raw: {},
  }
}

interface RecordedRun {
  readonly graphId: string
  readonly sparql: string
  readonly maxRows: number | undefined
}

function recordingService(
  respond: (call: RecordedRun) => QueryBlockResult,
): { readonly service: QueryBlockService; readonly calls: RecordedRun[] } {
  const calls: RecordedRun[] = []
  const service: QueryBlockService = {
    async run(graphId, sparql, maxRows) {
      const call: RecordedRun = { graphId, sparql, maxRows }
      calls.push(call)
      return respond(call)
    },
  }
  return { service, calls }
}

function leaseFor(handle: EvidenceChainQueryHandle, key: string): ResourceLease<EvidenceChainQueryHandle> {
  return {
    key,
    shape: 'derived',
    value: handle,
    released: false,
    release() {
      // no-op — nothing this test suite needs to observe.
    },
  }
}

describe('obs.evidence-chain — the query bridges literal evidence ids to raw capture subjects', () => {
  it('pins the one non-obvious join: IRI(CONCAT("urn:sophia:observatory:capture:", ?eid))', async () => {
    const { service, calls } = recordingService(() => emptyBindingsResult())
    const adapter = createEvidenceChainResourceAdapter(service)
    const handle = await adapter.compute({ kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' })
    await handle.run('observatory')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.graphId).toBe('observatory')
    expect(calls[0]!.sparql).toContain('IRI(CONCAT("urn:sophia:observatory:capture:", ?eid))')
    expect(calls[0]!.sparql).toContain('<urn:x:run-1> <http://mnemosyne.dev/observatory#evidenceEventId> ?eid')
  })
})

describe('obs.evidence-chain — mount()', () => {
  it('a run with no raw evidence renders zero rows, not an error (72h sliding window)', async () => {
    const { service } = recordingService(() => emptyBindingsResult())
    const adapter = createEvidenceChainResourceAdapter(service)
    const face = createEvidenceChainFace()
    const locator = { kind: 'graph' as const, graphId: 'observatory', subjectIri: 'urn:x:run-1' }
    const handle = await adapter.compute(locator)
    const descriptor: ViewDescriptor = { schemaVersion: 1, faceId: EVIDENCE_CHAIN_FACE_ID, resource: locator }
    const target = document.createElement('div')
    document.body.appendChild(target) // LitElement's first update needs a connected element to settle

    const faceView = await face.mount({
      target,
      descriptor,
      lease: leaseFor(handle, adapter.resourceKey(locator)),
      constraints: face.constraints!(descriptor),
    })

    const tableView = target.querySelector('sh-sparql-table-view') as ShSparqlTableView
    expect(tableView).toBeTruthy()
    await tableView.updateComplete
    expect(tableView.status).toBe('ready')
    expect(tableView.rows).toHaveLength(0)

    faceView.dispose('unmountable')
    target.remove()
  })

  it('an honest error, never a fabricated card, when neither a graphIri param nor a locator graph is present', async () => {
    // Unreachable through a real graph-only locator (accepts() already
    // refuses anything else) — this proves mount()'s own defensive branch,
    // reached only if a handle is somehow constructed with a null
    // locatorGraphId and no graphIri param is supplied either.
    const face = createEvidenceChainFace()
    const handle: EvidenceChainQueryHandle = {
      subjectIri: 'urn:x:run-1',
      locatorGraphId: null,
      store() {
        throw new Error('store() should never be called when no graph is resolvable')
      },
      async run() {
        throw new Error('run() should never be called when no graph is resolvable')
      },
    }
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: EVIDENCE_CHAIN_FACE_ID,
      resource: { kind: 'graph', graphId: 'observatory', subjectIri: 'urn:x:run-1' },
    }
    const target = document.createElement('div')
    document.body.appendChild(target) // LitElement's first update needs a connected element to settle
    const faceView = await face.mount({
      target,
      descriptor,
      lease: leaseFor(handle, 'test-key'),
      constraints: face.constraints!(descriptor),
    })

    const tableView = target.querySelector('sh-sparql-table-view') as ShSparqlTableView
    await tableView.updateComplete
    expect(tableView.status).toBe('error')
    expect(tableView.error).toMatch(/no graph to query/)

    faceView.dispose('unmountable')
    target.remove()
  })
})
