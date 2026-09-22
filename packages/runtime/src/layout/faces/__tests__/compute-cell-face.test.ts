/**
 * @vitest-environment jsdom
 *
 * The MIME battery includes the real DOMPurify security boundary. DOMPurify's
 * own supported server-side DOM is jsdom; happy-dom cannot be used as an XSS
 * proof (see chat-kernel's sanitizer battery for the same scoped choice).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QueryBlockResult, QueryBlockService } from '../../../editor-services/query-block-service.js'
import { createFragmentFaceRegistry } from '../../fragment-face-set.js'
import {
  COMPUTE_CELL_ADAPTER_ID,
  COMPUTE_CELL_FACE_ID,
  computeCellFromResult,
  createComputeCellFace,
  createComputeCellResourceAdapter,
} from '../compute-cell-face.js'
import '../compute-cell-view-element.js'
import { preferredComputeMime, type ShComputeCellView } from '../compute-cell-view-element.js'

const CELL_IRI = 'urn:sophia:compute-cell:abc123'
const OUTPUTS = [
  { kind: 'stream', name: 'stdout', text: 'prime kernel online\n' },
  {
    kind: 'result',
    data: {
      'text/plain': "{'answer': 42}",
      'application/json': { answer: 42 },
      'text/html': '<strong data-answer="42">forty-two</strong><script>globalThis.pwned=true</script>',
    },
  },
] as const

function result(overrides: Record<string, string> = {}): QueryBlockResult {
  const values: Record<string, string> = {
    cellRef: 'compute.cell:session:0:0',
    ordinal: '0',
    generation: '0',
    source: 'print("prime kernel online")\n{"answer": 42}',
    status: 'ok',
    executionCount: '1',
    outputsJson: JSON.stringify(OUTPUTS),
    startedAt: '1786104000100',
    completedAt: '1786104000250',
    durationMs: '150',
    cellDigest: 'sha256:cell-digest',
    ...overrides,
  }
  return {
    queryKind: 'select',
    resultKind: 'bindings',
    columns: Object.keys(values),
    rows: [Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: 'literal' as const, value }]))],
    durationMs: 4,
    raw: {},
  }
}

describe('compute.cell — closed face and graph adapter', () => {
  it('is admitted by the graph-authored fragment catalogue', () => {
    const registry = createFragmentFaceRegistry()
    expect(registry.has(COMPUTE_CELL_FACE_ID)).toBe(true)
    expect(createComputeCellFace().resourceAdapterId).toBe(COMPUTE_CELL_ADAPTER_ID)
  })

  it('accepts only a non-empty IRI resource', () => {
    const adapter = createComputeCellResourceAdapter({ async run() { return result() } })
    expect(adapter.accepts({ kind: 'iri', iri: CELL_IRI })).toBe(true)
    expect(adapter.accepts({ kind: 'iri', iri: '' })).toBe(false)
    expect(adapter.accepts({ kind: 'iri', iri: `${CELL_IRI}> } UNION { ?s ?p ?o` })).toBe(false)
    expect(adapter.accepts({ kind: 'graph', graphId: 'prime-notebook-lab', subjectIri: CELL_IRI })).toBe(false)
  })

  it('queries the selected graph for the exact cell resource', async () => {
    const calls: Array<{ graphId: string; sparql: string; maxRows?: number }> = []
    const service: QueryBlockService = {
      async run(graphId, sparql, maxRows) {
        calls.push({ graphId, sparql, maxRows })
        return result()
      },
    }
    const adapter = createComputeCellResourceAdapter(service)
    const handle = await adapter.compute({ kind: 'iri', iri: CELL_IRI })
    await handle.store('prime-notebook-lab').refresh()
    expect(calls).toHaveLength(1)
    expect(calls[0].graphId).toBe('prime-notebook-lab')
    expect(calls[0].sparql).toContain(`<${CELL_IRI}> a comp:ComputeCell`)
    expect(calls[0].maxRows).toBe(1)
  })

  it('decodes canonical cell fields and preserves ordered outputs', () => {
    const cell = computeCellFromResult(result(), CELL_IRI)
    expect(cell).toMatchObject({
      cellIri: CELL_IRI,
      ordinal: 0,
      generation: 0,
      executionCount: 1,
      status: 'ok',
      durationMs: 150,
    })
    expect(cell.outputs).toEqual(OUTPUTS)
  })

  it('rejects malformed output testimony instead of silently dropping it', () => {
    expect(() => computeCellFromResult(result({ outputsJson: '{bad json' }), CELL_IRI)).toThrow(/not valid JSON/)
    expect(() => computeCellFromResult(result({ outputsJson: '[{"kind":"future"}]' }), CELL_IRI)).toThrow(/unknown output kind/)
  })
})

describe('compute.cell — MIME selection and rendered view', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => root.remove())

  it('prefers sanitized HTML while keeping every representation inspectable', async () => {
    expect(preferredComputeMime(OUTPUTS[1].data)?.mediaType).toBe('text/html')
    const view = document.createElement('sh-compute-cell-view') as ShComputeCellView
    view.status = 'ready'
    view.cell = computeCellFromResult(result(), CELL_IRI)
    root.appendChild(view)
    await view.updateComplete

    const shadow = view.shadowRoot!
    expect(shadow.querySelector('code')!.textContent).toContain('prime kernel online')
    expect(shadow.querySelector('.stream')!.textContent).toBe('prime kernel online\n')
    expect(shadow.querySelector('.html-output strong')!.textContent).toBe('forty-two')
    expect(shadow.querySelector('.html-output script')).toBeNull()
    expect(shadow.querySelector('.html-output')!.textContent).not.toContain('globalThis.pwned')
    expect(shadow.querySelector('details')!.textContent).toContain('application/json')
  })

  it('renders a bounded base64 image and refuses malformed image data', async () => {
    const view = document.createElement('sh-compute-cell-view') as ShComputeCellView
    view.status = 'ready'
    const base = computeCellFromResult(result(), CELL_IRI)
    view.cell = { ...base, outputs: [{ kind: 'display', data: { 'image/png': 'iVBORw0KGgo=' } }] }
    root.appendChild(view)
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')

    view.cell = { ...base, outputs: [{ kind: 'display', data: { 'image/png': '<not-base64>' } }] }
    await view.updateComplete
    expect(view.shadowRoot!.querySelector('img')).toBeNull()
    expect(view.shadowRoot!.textContent).toContain('Invalid or oversized image/png payload')
  })
})
