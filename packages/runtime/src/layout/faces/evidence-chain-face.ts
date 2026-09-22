/**
 * evidence-chain-face.ts — the `obs.evidence-chain` face (P6, plans/
 * observatory-ux-implementation-spec-20260728.md §3 P6: "table-row ->
 * subject-card -> evidence-chain along `obs:evidenceEventId`").
 *
 * Mirrors `card-subject-face.ts`'s graph-parametrized store pattern exactly:
 * `compute()` returns a handle carrying `subjectIri` + `locatorGraphId` and
 * graph-keyed reactive stores; `mount()` resolves the graph to query as
 * `params.graphIri ?? handle.locatorGraphId`, then renders through the SAME
 * `<sh-sparql-table-view>` `sparql.bindings-table` uses (`subjectColumn` left
 * `''` — an evidence row is not itself a further drill-down door in this
 * packet).
 *
 * Resource locator: ONLY `{kind:'graph', graphId, subjectIri}` — unlike
 * `card.subject`, a bare `iri` locator is never accepted (this face's one
 * fixed query is meaningless without a graph to run it against; there is no
 * `graphIri` param on `card.subject`'s `iri`-locator branch to borrow the
 * pattern from without a real graph already in hand).
 *
 * The fixed query (code, never data — ruling 4, plans/observatory-ux-
 * implementation-spec-20260728.md §1) bridges a machine run's LITERAL
 * `obs:evidenceEventId` (a `text_term`, so there is no direct RDF link from a
 * run to its CaptureEvents) to the raw capture subject the event actually
 * lives under, by synthesizing `urn:sophia:observatory:capture:<eid>` and
 * re-joining on that IRI. `raw` capture events are a 72h sliding window, so a
 * run older than the window legitimately has zero — that renders as an empty
 * table, never an error (see `applyEvidenceChainResult` below).
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import {
  formatQueryBlockTerm,
  type QueryBlockResult,
  type QueryBlockService,
} from '../../editor-services/query-block-service.js'
// Side-effect import: registers the <sh-sparql-table-view> custom element.
import './sparql-table-view-element.js'
import type { ShSparqlTableView } from './sparql-table-view-element.js'
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

export const EVIDENCE_CHAIN_FACE_ID = 'obs.evidence-chain'
export const EVIDENCE_CHAIN_ADAPTER_ID = 'obs.evidence-chain.subject-query'

/** Mirrors the sibling query faces' shared `SERVICE_MAX_ROWS` (card-subject-face.ts, sparql-bindings-table-face.ts). */
const SERVICE_MAX_ROWS = 500

export interface EvidenceChainParams {
  readonly graphIri?: string
  readonly maxRows?: number
}

/**
 * A graph-parametrized query-store handle (mirrors `SubjectQueryHandle` in
 * card-subject-face.ts).
 */
export interface EvidenceChainQueryHandle {
  readonly subjectIri: string
  /** The graph the LOCATOR itself already named — never `null` here (unlike `SubjectQueryHandle`), since this face accepts only graph-scoped locators. */
  readonly locatorGraphId: string | null
  store(graphId: string): SurfaceResourceStore<QueryBlockResult>
  /** Compatibility one-shot over the same store. */
  run(graphId: string): Promise<QueryBlockResult>
}

function isEvidenceChainLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'graph' }> {
  return locator.kind === 'graph' && typeof locator.subjectIri === 'string' && locator.subjectIri.length > 0
}

function subjectAndGraphOf(locator: ResourceLocator): { readonly subjectIri: string; readonly graphId: string } {
  if (isEvidenceChainLocator(locator) && locator.subjectIri) {
    return { subjectIri: locator.subjectIri, graphId: locator.graphId }
  }
  throw new Error(`obs.evidence-chain: resource adapter given an unexpected locator (kind '${locator.kind}')`)
}

function evidenceChainResourceKey(locator: ResourceLocator): ResourceKey {
  const { subjectIri, graphId } = subjectAndGraphOf(locator)
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('evidence-chain', graphId, subjectIri)
}

/**
 * The one non-obvious join: `obs:evidenceEventId` is a plain literal, so a
 * run has no direct RDF edge to its CaptureEvents — this query synthesizes
 * the raw capture subject (`urn:sophia:observatory:capture:<eid>`) and reads
 * ITS properties from whatever named graph (`?wg`) carries them. `<S>` is the
 * activated row's own subject IRI, substituted verbatim (mirrors
 * `card-subject-face.ts`'s `subjectPropertiesQuery` — code-built text, never
 * caller-supplied SPARQL).
 */
function evidenceChainQuery(subjectIri: string): string {
  return `SELECT ?event ?capturedAt ?kind ?outcome ?seq WHERE {
  GRAPH ?rg { <${subjectIri}> <http://mnemosyne.dev/observatory#evidenceEventId> ?eid . }
  BIND(IRI(CONCAT("urn:sophia:observatory:capture:", ?eid)) AS ?event)
  GRAPH ?wg {
    ?event <http://mnemosyne.dev/observatory#capturedAt> ?capturedAt ;
           <http://mnemosyne.dev/observatory#kind> ?kind ;
           <http://mnemosyne.dev/observatory#outcome> ?outcome ;
           <http://mnemosyne.dev/observatory#seq> ?seq .
  }
} ORDER BY ?seq LIMIT 200`
}

/** The `obs.evidence-chain` adapter — see this file's header for the graph-parametrized store shape. */
export function createEvidenceChainResourceAdapter(service: QueryBlockService): DerivedResourceAdapter<EvidenceChainQueryHandle> {
  return {
    adapterId: EVIDENCE_CHAIN_ADAPTER_ID,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isEvidenceChainLocator,
    resourceKey: evidenceChainResourceKey,
    async compute(locator, context) {
      const { subjectIri, graphId } = subjectAndGraphOf(locator)
      const stores = new Map<string, SurfaceResourceStore<QueryBlockResult>>()
      const store = (runGraphId: string): SurfaceResourceStore<QueryBlockResult> => {
        let existing = stores.get(runGraphId)
        if (!existing) {
          existing = createSurfaceResourceStore(
            () => service.run(runGraphId, evidenceChainQuery(subjectIri), SERVICE_MAX_ROWS),
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

function evidenceChainConstraints(): LeafConstraints {
  // <sh-sparql-table-view> owns its own internal overflow:auto stage — same
  // rationale as sparql-bindings-table-face.ts's own constraints.
  return { minWidth: 280, minHeight: 120, overflow: 'clip' }
}

function evidenceChainParams(descriptor: ViewDescriptor): EvidenceChainParams {
  // paramsSchema already validated shape/types before mount() is ever called
  // — mirrors sparql-bindings-table-face.ts's own `displayMaxRows` cast idiom.
  return (descriptor.params ?? {}) as unknown as EvidenceChainParams
}

function displayMaxRows(params: EvidenceChainParams): number {
  const requested = params.maxRows
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 200
  return Math.max(1, Math.min(SERVICE_MAX_ROWS, Math.trunc(requested)))
}

/**
 * The `obs.evidence-chain` `FaceRegistration`. `mount()` populates ONE fresh
 * `<sh-sparql-table-view>` — same shape as `sparql.bindings-table`'s own
 * mount, including the `resultKind` guard (design's "typed error face when a
 * face or resource is unavailable") — `subjectColumn` is left `''`: an
 * evidence row is not itself a further drill-down door in this packet.
 */
export function createEvidenceChainFace(): FaceRegistration {
  return {
    faceId: EVIDENCE_CHAIN_FACE_ID,
    // A query result is cheap to recompute and carries no local state worth
    // protecting across a relocate — same classification as sparql.bindings-table.
    persistence: 'stamp',
    resourceAdapterId: EVIDENCE_CHAIN_ADAPTER_ID,
    accepts: isEvidenceChainLocator,
    paramsSchema: closedParamsSchema({
      graphIri: { type: 'string', optional: true },
      maxRows: { type: 'number', optional: true },
    }),
    constraints: evidenceChainConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = evidenceChainParams(descriptor)
      const handle = lease.value as EvidenceChainQueryHandle

      const view = document.createElement('sh-sparql-table-view') as ShSparqlTableView
      view.tabIndex = 0
      view.status = 'loading'
      target.replaceChildren(view)

      let disposed = false
      let unsubscribe = (): void => {}
      const graphId = params.graphIri ?? handle.locatorGraphId ?? null
      if (!graphId) {
        view.status = 'error'
        view.error = 'obs.evidence-chain: no graph to query — pass a `graphIri` param, or use a graph-scoped resource locator'
      } else {
        const store = handle.store(graphId)
        const applyState = (state: StoreState<QueryBlockResult>): void => {
          if (disposed) return
          view.dataset.resourceState = state.status
          if (state.read !== null) {
            const result = state.read
            if (result.resultKind === 'bindings' || result.resultKind === 'ask') {
              const cap = displayMaxRows(params)
              view.status = 'ready'
              view.queryKind = result.queryKind
              view.durationMs = result.durationMs
              view.columns = result.columns
              view.rows = result.rows.slice(0, cap)
            } else {
              // CONSTRUCT/DESCRIBE ('serialized') is not a bindings table — an
              // honest error, not a fabricated empty table.
              view.status = 'error'
              view.error = `obs.evidence-chain only renders SELECT/ASK results (got a ${result.resultKind} result)`
            }
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
          // <sh-sparql-table-view>'s :host fills 100%/100% via CSS; the
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

// Re-exported for callers that want to format a term the SAME way this face
// does — mirrors sparql-bindings-table-face.ts's own re-export.
export { formatQueryBlockTerm }
export type { QueryBlockResult, QueryBlockService }
