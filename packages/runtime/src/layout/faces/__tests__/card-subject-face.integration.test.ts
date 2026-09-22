/**
 * card-subject-face.integration.test.ts — the REAL-CELL proof for
 * `card.subject` (mirrors hoja-document-face.integration.test.ts's own
 * real-cell shape). Spawns a REAL headless `gardend` binary, creates a real
 * graph over MCP, seeds real `?p ?o` triples for a real subject via real
 * `sparql_update`, and drives the REAL `FaceRegistry`/`LayoutResourceBroker`/
 * `LayoutInterpreter` machinery with the REAL `card.subject` face over a REAL
 * `QueryBlockService`.
 *
 * Proves, against the real cell:
 *   - a `graph`+`subjectIri` locator (graph already known) resolves and
 *     renders the real title/fields;
 *   - a bare `iri` locator PLUS a `graphIri` param resolves the SAME real
 *     subject the same way (the two accepted locator shapes agree);
 *   - a bare `iri` locator with NO `graphIri` param paints an honest error —
 *     never a silently-guessed graph;
 *   - a subject with zero real triples falls back to the subject IRI as
 *     title and renders empty (not fabricated) field values.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { McpClient } from '@shrubbery/source'
import { resolveGardendBin, spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { deepFreeze, type LayoutDocument, type ViewDescriptor } from '@shrubbery/nucleus/layout'
import { makeQueryBlockService } from '../../../editor-services/query-block-service.js'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { createCardSubjectFace, createCardSubjectResourceAdapter, CARD_SUBJECT_FACE_ID } from '../card-subject-face.js'
import { TestRestClient } from './support/test-rest-client.js'

const GARDEN_BIN = resolveGardendBin()
const GRAPH_ID = 'layout-laneb-card-subject-it'
const DATA_GRAPH = 'urn:test:layout-laneb:card-subject'
const SUBJECT = 'urn:test:layout-laneb:card-subject:gap-1'
const EMPTY_SUBJECT = 'urn:test:layout-laneb:card-subject:never-seeded'
const WITNESS = 'urn:test:layout-laneb:witness'
const EXPECTED_SEQ = 'urn:test:layout-laneb:expectedSeq'
const OBSERVED_SEQ = 'urn:test:layout-laneb:observedSeq'

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

function cardDoc(descriptor: ViewDescriptor): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'card-subject-real-cell',
    scope: 'session',
    graphId: GRAPH_ID,
    rootNodeId: 'K1',
    nodes: { K1: { kind: 'leaf', id: 'K1', descriptor, descriptorRevision: 0 } },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

let cell: GardendCell
let mcp: McpClient

beforeAll(async () => {
  if (!existsSync(GARDEN_BIN)) {
    throw new Error(
      `card-subject-face.integration.test.ts requires the real gardend binary at ${GARDEN_BIN}. Set GARDEN_BIN to override.`,
    )
  }
  cell = await spawnGardend()
  mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Layout Lane B card.subject integration' })
  await mcp.toolsCall('sparql_update', {
    graphId: GRAPH_ID,
    update: `INSERT DATA { GRAPH <${DATA_GRAPH}> {
      <${SUBJECT}> <${WITNESS}> "the-witness" .
      <${SUBJECT}> <${EXPECTED_SEQ}> "10"^^<http://www.w3.org/2001/XMLSchema#integer> .
      <${SUBJECT}> <${OBSERVED_SEQ}> "13"^^<http://www.w3.org/2001/XMLSchema#integer> .
    } }`,
  })
}, 30000)

afterAll(async () => {
  await cell?.kill()
}, 15000)

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

function buildInterpreter(): LayoutInterpreter {
  const service = makeQueryBlockService(new TestRestClient(mcp))
  const registry = new FaceRegistry()
  registry.register(createCardSubjectFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createCardSubjectResourceAdapter(service))
  return new LayoutInterpreter(root, { registry, broker })
}

type CardView = HTMLElement & { status: string; error: string; title: string; fields: readonly { label: string; value: string }[] }

const FIELDS_PARAM = `${EXPECTED_SEQ},${OBSERVED_SEQ}`

describe('card.subject — real gardend cell, real ?p ?o query', () => {
  it('a graph+subjectIri locator resolves the real subject and renders the real title + fields', async () => {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_SUBJECT_FACE_ID,
      resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri: SUBJECT },
      params: { titleField: WITNESS, fields: FIELDS_PARAM },
    }
    const interpreter = buildInterpreter()
    const result = await interpreter.reconcile(cardDoc(descriptor), { width: 300, height: 200 })
    expect(result.ok).toBe(true)

    const view = interpreter.leafWrapperElement('K1')!.querySelector('sh-subject-card-view') as CardView
    await waitFor(() => view.status === 'ready')
    expect(view.title).toBe('the-witness')
    expect(view.fields).toEqual([
      { label: EXPECTED_SEQ, value: '10' },
      { label: OBSERVED_SEQ, value: '13' },
    ])

    await interpreter.dispose()
  }, 20000)

  it('a bare iri locator + graphIri param resolves the SAME real subject the same way', async () => {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_SUBJECT_FACE_ID,
      resource: { kind: 'iri', iri: SUBJECT },
      params: { titleField: WITNESS, fields: FIELDS_PARAM, graphIri: GRAPH_ID },
    }
    const interpreter = buildInterpreter()
    await interpreter.reconcile(cardDoc(descriptor), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('K1')!.querySelector('sh-subject-card-view') as CardView
    await waitFor(() => view.status === 'ready')
    expect(view.title).toBe('the-witness')
    expect(view.fields.map((f) => f.value)).toEqual(['10', '13'])

    await interpreter.dispose()
  }, 20000)

  it('a bare iri locator with NO graphIri param paints an honest error, never a guessed graph', async () => {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_SUBJECT_FACE_ID,
      resource: { kind: 'iri', iri: SUBJECT },
      params: { titleField: WITNESS },
    }
    const interpreter = buildInterpreter()
    await interpreter.reconcile(cardDoc(descriptor), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('K1')!.querySelector('sh-subject-card-view') as CardView
    await waitFor(() => view.status === 'error')
    expect(view.error).toMatch(/graphIri/)

    await interpreter.dispose()
  }, 20000)

  it('a subject with zero real triples falls back to the subject IRI as title and renders empty field values', async () => {
    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: CARD_SUBJECT_FACE_ID,
      resource: { kind: 'graph', graphId: GRAPH_ID, subjectIri: EMPTY_SUBJECT },
      params: { titleField: WITNESS, fields: FIELDS_PARAM },
    }
    const interpreter = buildInterpreter()
    await interpreter.reconcile(cardDoc(descriptor), { width: 300, height: 200 })

    const view = interpreter.leafWrapperElement('K1')!.querySelector('sh-subject-card-view') as CardView
    await waitFor(() => view.status === 'ready')
    expect(view.title).toBe(EMPTY_SUBJECT)
    expect(view.fields).toEqual([
      { label: EXPECTED_SEQ, value: '' },
      { label: OBSERVED_SEQ, value: '' },
    ])

    await interpreter.dispose()
  }, 20000)
})
