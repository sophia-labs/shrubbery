/**
 * card-subject-face.ts — the `card.subject` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4: "property card for one
 * subject (SELECT ?p ?o) — the inspector-lite / pin-card precursor, and the
 * collection-bound item face").
 *
 * Wraps the SAME PRODUCTION `QueryBlockService` every other query-backed
 * face in this directory wraps — no query-execution logic of its own beyond
 * the fixed `SELECT ?p ?o` shape this face itself needs.
 *
 * Resource locator: accepts EITHER `{kind:'iri', iri}` (a bare subject IRI —
 * spec §4's "accepts iri") OR `{kind:'graph', graphId, subjectIri}` (a
 * graph-scoped subject — spec §4's "and graph+subjectIri"). The two differ in
 * whether a graph to query is already known from the locator itself:
 *   - `graph`-kind: `graphId` comes from the locator.
 *   - `iri`-kind: there is NO graph in the locator at all (an `iri` locator
 *     is Phase 1's generic content-free-IRI resource, `sophia.home`'s own
 *     shape) — the caller MUST supply the closed `graphIri` param, which only
 *     `mount()` (not `compute()`) ever sees (`DerivedResourceAdapter.compute
 *     (locator): Promise<T>` takes no params — resource-broker.ts's
 *     `acquire()` never threads descriptor.params through). This is exactly
 *     why `compute()` here returns a graph-PARAMETRIZED store handle:
 *     `mount()` resolves the actual graph id from `params.graphIri ??
 *     handle.locatorGraphId`, then observes `handle.store(graphId)`.
 *
 * `titleField`/`fields` match a real `?p` binding's EXACT predicate IRI text
 * (never a compacted form): this codebase has no CURIE-prefix registry at the
 * runtime layer today, so a caller passes the resolved predicate IRI, not a
 * `prefix:local` shorthand, however the spec table's "predicate CURIEs"
 * phrasing reads. A future named-prefix registry is the honest place to add
 * CURIE expansion; faking it here would silently mismatch real predicates.
 *
 * `?o` values render as `plainQueryBlockTermValue`'s PLAIN lexical text
 * (`"7"`), never `formatQueryBlockTerm`'s Turtle-notation display
 * (`"7"^^http://...#integer`) — that decorated form is right for
 * `sparql.bindings-table`'s inspection-tool table cells, wrong for a
 * property-card field value. Discovered via the real gardend-cell
 * integration test in this directory.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import { plainQueryBlockTermValue, type QueryBlockResult, type QueryBlockService } from '../../editor-services/query-block-service.js'
// Side-effect import: registers the <sh-subject-card-view> custom element.
import './subject-card-view-element.js'
import type { ShSubjectCardView, SubjectCardField } from './subject-card-view-element.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  refreshSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'

export const CARD_SUBJECT_FACE_ID = 'card.subject'
const CARD_SUBJECT_ADAPTER_ID = 'card.subject.subject-query'

/** The row cap on the subject's own `?p ?o` fan-out — mirrors the sibling query faces' shared `SERVICE_MAX_ROWS`. */
const SERVICE_MAX_ROWS = 500

export interface CardSubjectParams {
  readonly titleField: string
  readonly fields?: string
  readonly graphIri?: string
}

/**
 * A graph-parametrized query-store handle — see this file's header for why
 * `store()` takes a `graphId` argument (a normal `query` locator already
 * carries its own graph).
 */
export interface SubjectQueryHandle {
  readonly subjectIri: string
  /** The graph the LOCATOR itself already named, or `null` when the locator was bare-iri (spec §4's "accepts iri") and only a `graphIri` param can supply one. */
  readonly locatorGraphId: string | null
  /** Canonical graph-keyed reactive store used by Surface faces. */
  store(graphId: string): SurfaceResourceStore<QueryBlockResult>
  /** Compatibility one-shot over the same store; never a separate read path. */
  run(graphId: string): Promise<QueryBlockResult>
}

function isCardSubjectLocator(locator: ResourceLocator): boolean {
  if (locator.kind === 'iri') return true
  if (locator.kind === 'graph') return typeof locator.subjectIri === 'string' && locator.subjectIri.length > 0
  return false
}

function subjectAndGraphOf(locator: ResourceLocator): { readonly subjectIri: string; readonly graphId: string | null } {
  if (locator.kind === 'iri') return { subjectIri: locator.iri, graphId: null }
  if (locator.kind === 'graph' && locator.subjectIri) return { subjectIri: locator.subjectIri, graphId: locator.graphId }
  throw new Error(`card.subject: resource adapter given an unexpected locator (kind '${locator.kind}')`)
}

function cardSubjectResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOf(locator)
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('card-subject', graphId ?? undefined, subjectIri)
}

/**
 * A read-only `?p ?o` fan-out for one subject, scanned across every named
 * graph in the cell (`GRAPH ?g { ... }`) — the same cross-graph-safe SELECT
 * shape `layout-workbench-main.ts`'s own `SPARQL_DUMP_QUERY` uses, since a
 * bare `{ <iri> ?p ?o }` with no GRAPH clause only matches the (empty)
 * default graph. `?g` itself is not selected — only `?p`/`?o` are needed.
 */
function subjectPropertiesQuery(subjectIri: string): string {
  return `SELECT ?p ?o WHERE { GRAPH ?g { <${subjectIri}> ?p ?o } } LIMIT ${SERVICE_MAX_ROWS}`
}

/** The `card.subject` `DerivedResourceAdapter` — see this file's header for the graph-parametrized store shape. */
export function createCardSubjectResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<SubjectQueryHandle> {
  return {
    adapterId: CARD_SUBJECT_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isCardSubjectLocator,
    resourceKey: cardSubjectResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOf(locator)
      const stores = new Map<string, SurfaceResourceStore<QueryBlockResult>>()
      const store = (runGraphId: string): SurfaceResourceStore<QueryBlockResult> => {
        let existing = stores.get(runGraphId)
        if (!existing) {
          existing = createSurfaceResourceStore(
            () => service.run(runGraphId, subjectPropertiesQuery(subjectIri), SERVICE_MAX_ROWS),
            context,
          )
          stores.set(runGraphId, existing)
        }
        return existing
      }
      return {
        subjectIri,
        locatorGraphId: graphId,
        store,
        run: (runGraphId: string) => refreshSurfaceResourceStore(store(runGraphId)),
      }
    },
  }
}

function parseFieldList(fields: string | undefined): readonly string[] {
  if (!fields) return []
  return fields
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0)
}

function cardSubjectConstraints(): LeafConstraints {
  // The card's own `.stage` owns internal overflow:auto — 'clip' avoids a
  // redundant outer scrollbar on top of the element's own (mirrors every
  // other stamp-persistence face's constraints in this directory).
  return { minWidth: 200, minHeight: 120, overflow: 'clip' }
}

function cardSubjectParams(descriptor: ViewDescriptor): CardSubjectParams {
  // paramsSchema already validated shape/types (titleField required) before
  // mount() is ever called — mirrors sparql-bindings-table-face.ts's own
  // `displayMaxRows` cast idiom.
  return (descriptor.params ?? {}) as unknown as CardSubjectParams
}

export interface CardSubjectSelection {
  readonly title: string
  readonly fields: readonly SubjectCardField[]
}

/**
 * Pure — exported for unit testing. Groups the real `?p ?o` rows by
 * predicate (multi-valued predicates join with `, `), then selects
 * `titleField`/`fields` by EXACT predicate-text match (see this file's
 * header for why no CURIE expansion happens here). `fallbackTitle` is the
 * subject IRI itself — never a blank title, even when `titleField` has no
 * bound value for this subject.
 */
export function selectCardSubjectFields(
  result: QueryBlockResult,
  params: CardSubjectParams,
  fallbackTitle: string,
): CardSubjectSelection {
  const byPredicate = new Map<string, string[]>()
  if (result.resultKind === 'bindings') {
    for (const row of result.rows) {
      const predicate = plainQueryBlockTermValue(row.p)
      if (!predicate) continue
      const value = plainQueryBlockTermValue(row.o)
      const values = byPredicate.get(predicate)
      if (values) values.push(value)
      else byPredicate.set(predicate, [value])
    }
  }
  return {
    title: byPredicate.get(params.titleField)?.[0] ?? fallbackTitle,
    fields: parseFieldList(params.fields).map((field) => ({
      label: field,
      value: byPredicate.get(field)?.join(', ') ?? '',
    })),
  }
}

function applyResult(view: ShSubjectCardView, result: QueryBlockResult, params: CardSubjectParams): void {
  if (result.resultKind !== 'bindings') {
    // ASK/CONSTRUCT/DESCRIBE cannot happen for this face's own fixed `SELECT
    // ?p ?o` query — an honest error if it somehow ever did (mirrors the
    // sibling query faces' resultKind guards), never a fabricated card.
    view.status = 'error'
    view.error = `card.subject requires a SELECT query result (got a ${result.resultKind} result)`
    return
  }
  const selection = selectCardSubjectFields(result, params, view.subjectIri)
  view.title = selection.title
  view.fields = selection.fields
  view.status = 'ready'
}

/**
 * The `card.subject` `FaceRegistration`. `mount()` resolves the graph to
 * query (`params.graphIri ?? handle.locatorGraphId`) — an honest error, never
 * a guessed graph, when neither is present — then observes and refreshes the
 * graph-keyed store. No `refreshSeconds` param exists for this face, so there
 * is no poll interval to own.
 */
export function createCardSubjectFace(): FaceRegistration {
  return {
    faceId: CARD_SUBJECT_FACE_ID,
    // A property snapshot; cheap to recompute, nothing local worth
    // protecting across a relocate (same classification as sparql.bindings-table).
    persistence: 'stamp',
    resourceAdapterId: CARD_SUBJECT_ADAPTER_ID,
    accepts: isCardSubjectLocator,
    paramsSchema: closedParamsSchema({
      titleField: { type: 'string' },
      fields: { type: 'string', optional: true },
      graphIri: { type: 'string', optional: true },
    }),
    constraints: cardSubjectConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = cardSubjectParams(descriptor)
      const handle = lease.value as SubjectQueryHandle

      const view = document.createElement('sh-subject-card-view') as ShSubjectCardView
      view.tabIndex = 0
      view.subjectIri = handle.subjectIri
      view.title = handle.subjectIri
      view.status = 'loading'
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      if (!graphId) {
        view.status = 'error'
        view.error = 'card.subject: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else {
        const store = handle.store(graphId)
        const applyState = (state: StoreState<QueryBlockResult>): void => {
          if (disposed) return
          view.dataset.resourceState = state.status
          if (state.read !== null) {
            applyResult(view, state.read, params)
            if (state.status === 'ready') delete view.dataset.resourceStale
            else view.dataset.resourceStale = 'true'
            return
          }
          delete view.dataset.resourceStale
          if (state.status === 'error') {
            view.status = 'error'
            view.error = state.error ?? 'Unable to load this resource.'
          } else {
            view.status = 'loading'
          }
        }
        unsubscribe = observeSurfaceResourceStore(store, applyState)
        await store.refresh()
      }

      const faceView: FaceView = {
        focus(_request) {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // <sh-subject-card-view>'s :host fills 100%/100% via CSS; the
          // interpreter already sized `target`. MUST NOT write layout state
          // (design §3.2) — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          view.remove()
        },
      }
      return faceView
    },
  }
}
