/**
 * workspace-surface-engine-faces.test.ts — Stage A of the Surface unification
 * (docs/design/surface-unification.md): QUERY-BACKED engine faces are
 * first-class citizens of the SAME `<sh-workspace-surface>` element that hosts
 * the bound workspace faces. One sealed registry, one broker, one interpreter
 * — no nested engine.
 *
 * Everything real (no vi.*): the real `defineWorkspaceSurfaceElement` with the
 * real `createFragmentFaceRegistrations`/`createFragmentResourceAdapters`
 * catalogue, a REAL closure-recorder `QueryBlockService` (a genuine
 * implementation of the production seam over canned bindings — the same
 * pattern the layout-dashboard tests used for their store-backed RestClient),
 * and the element's own lifecycle.
 */
import { html } from 'lit'
import { afterEach, describe, expect, it } from 'vitest'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import type { QueryBlockResult, QueryBlockService } from '../../editor-services/query-block-service.js'
import type { SourceObjectService } from '../source-object-service.js'
import type { FilmstripEvidenceService } from '../faces/filmstrip-face.js'
import {
  FRAGMENT_GRID_COLLECTION_ADAPTER_ID,
  createFragmentFaceRegistrations,
  createFragmentResourceAdapters,
} from '../fragment-face-set.js'
import { createRawTextQueryResolver } from '../named-query-registry.js'

// This suite never mounts card.object — a real, unused SourceObjectService
// (never a vi.fn stand-in) satisfies createFragmentResourceAdapters' third
// parameter, mirroring card-subject-face.test.ts's own `unusedService`.
const unusedObjectService: SourceObjectService = {
  async read() {
    throw new Error('workspace-surface-engine-faces.test.ts: read() should never be invoked by this suite')
  },
}
const unusedEvidenceService: FilmstripEvidenceService = {
  async read() {
    throw new Error('workspace-surface-engine-faces.test.ts: evidence read() should never be invoked by this suite')
  },
}
import {
  defineWorkspaceSurfaceElement,
  type WorkspaceBoundFaceDefinition,
  type WorkspaceSurfaceElement,
  type WorkspaceSurfaceModel,
} from '../workspace-surface-element.js'

const BOUND_FACE_ID = 'test.bound-banner'
let tagSequence = 0
const mounted: WorkspaceSurfaceElement[] = []

function testTag(): string {
  tagSequence += 1
  return `test-engine-face-surface-${tagSequence}`
}

/** A REAL QueryBlockService over canned bindings; records every run call. */
function recordingQueryService(scalarValue: string): {
  readonly service: QueryBlockService
  readonly calls: Array<{ readonly graphId: string; readonly sparql: string }>
} {
  const calls: Array<{ readonly graphId: string; readonly sparql: string }> = []
  const service: QueryBlockService = {
    async run(graphId, sparql): Promise<QueryBlockResult> {
      calls.push({ graphId, sparql })
      return {
        queryKind: 'select',
        resultKind: 'bindings',
        columns: ['value'],
        rows: [{ value: { type: 'literal', value: scalarValue } }],
        totalRowCount: 1,
        durationMs: 1,
        raw: null,
      }
    },
  }
  return { service, calls }
}

function surfaceDocument(): LayoutDocument {
  return {
    schemaVersion: 1,
    layoutId: 'engine-face-test',
    scope: 'session',
    graphId: 'engine-test-graph',
    rootNodeId: 'root-split',
    nodes: {
      'root-split': {
        kind: 'split',
        id: 'root-split',
        axis: 'horizontal',
        startNodeId: 'banner',
        endNodeId: 'stat',
        startBasisPoints: 5000,
      },
      banner: {
        kind: 'leaf',
        id: 'banner',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: BOUND_FACE_ID,
          resource: { kind: 'iri', iri: 'urn:test:banner' },
          params: { bindingId: 'banner' },
        },
      },
      stat: {
        kind: 'leaf',
        id: 'stat',
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: 'stat.scalar',
          resource: { kind: 'query', graphId: 'engine-test-graph', queryId: 'SELECT ?value WHERE { }' },
          params: { label: 'Total quads' },
        },
      },
    },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}

function defineEngineSurface(): string {
  const tag = testTag()
  const bound: WorkspaceBoundFaceDefinition = {
    faceId: BOUND_FACE_ID,
    persistence: 'stamp',
    accepts: (locator) => locator.kind === 'iri',
    render: (_target, value) => html`<p data-banner-value=${String(value)}>${String(value)}</p>`,
  }
  defineWorkspaceSurfaceElement(tag, [bound], {
    faces: createFragmentFaceRegistrations(),
    createAdapters: (resolveService) => {
      const delegating: QueryBlockService = {
        run(graphId, sparql, maxRows) {
          const service = resolveService() as QueryBlockService | null
          if (!service) return Promise.reject(new Error('engine-face test: no query service in this build'))
          return service.run(graphId, sparql, maxRows)
        },
      }
      return createFragmentResourceAdapters(
        delegating,
        createRawTextQueryResolver(),
        unusedObjectService,
        unusedEvidenceService,
      )
    },
    gridCollectionResourceAdapterId: FRAGMENT_GRID_COLLECTION_ADAPTER_ID,
  })
  return tag
}

function modelFor(service: QueryBlockService | null): WorkspaceSurfaceModel {
  const bindings = new Map<string, unknown>([['banner', 'hello-bound-face']])
  return {
    build: () => ({
      document: surfaceDocument(),
      bindings,
      metadata: null,
      engineService: service,
    }),
  }
}

async function mountSurface(tag: string, service: QueryBlockService | null): Promise<WorkspaceSurfaceElement> {
  const surface = document.createElement(tag) as WorkspaceSurfaceElement
  document.body.appendChild(surface)
  mounted.push(surface)
  surface.model = modelFor(service)
  const controller = (surface as unknown as { controller: { setSize(w: number, h: number): void } | null }).controller
  controller?.setSize(800, 600)
  await surface.whenReady()
  return surface
}

afterEach(() => {
  for (const surface of mounted.splice(0)) surface.remove()
})

describe('workspace Surface engine faces (Stage A unification)', () => {
  it('mounts stat.scalar and a bound face through ONE registry/interpreter, over the live query service', async () => {
    const { service, calls } = recordingQueryService('90210')
    const surface = await mountSurface(defineEngineSurface(), service)

    // The bound face painted normally.
    expect(surface.querySelector('[data-banner-value="hello-bound-face"]')).not.toBeNull()

    // The engine face mounted through the broker over the REAL service: the
    // exact graph/sparql from the leaf's own query locator, and the canned
    // scalar formatted into the live view.
    expect(calls).toEqual([{ graphId: 'engine-test-graph', sparql: 'SELECT ?value WHERE { }' }])
    const stat = surface.querySelector('sh-stat-scalar-view')
    expect(stat).not.toBeNull()
    const statWrapper = surface.querySelector('[data-layout-node-id="stat"]')
    expect(statWrapper?.contains(stat)).toBe(true)
    expect((stat as unknown as { status: string }).status).toBe('ready')
    // No `format` param → the raw first-term text, honestly unformatted.
    expect((stat as unknown as { value: string }).value).toBe('90210')
    expect((stat as unknown as { label: string }).label).toBe('Total quads')
  })

  it('with NO query service the engine leaf degrades to the face own honest error state (never blank)', async () => {
    const surface = await mountSurface(defineEngineSurface(), null)

    // The bound face still works; the stat face mounted, ran its first query
    // through the delegator, and surfaced the missing-service rejection as its
    // own visible error state — an honest message, never a blank pane.
    expect(surface.querySelector('[data-banner-value="hello-bound-face"]')).not.toBeNull()
    const stat = surface.querySelector('sh-stat-scalar-view')
    expect(stat).not.toBeNull()
    expect((stat as unknown as { status: string }).status).toBe('error')
    expect((stat as unknown as { error: string }).error).toContain('no query service')
  })

  it('treats an engine-service swap as a resource-scope boundary, never a warm cross-session hit', async () => {
    const first = recordingQueryService('111')
    const second = recordingQueryService('222')
    const surface = await mountSurface(defineEngineSurface(), first.service)

    expect((surface.querySelector('sh-stat-scalar-view') as unknown as { value: string }).value).toBe('111')
    surface.model = modelFor(second.service)
    await surface.whenReady()

    expect(first.calls).toHaveLength(1)
    expect(second.calls).toEqual([
      { graphId: 'engine-test-graph', sparql: 'SELECT ?value WHERE { }' },
    ])
    expect((surface.querySelector('sh-stat-scalar-view') as unknown as { value: string }).value).toBe('222')
  })
})
