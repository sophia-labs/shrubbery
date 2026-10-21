/**
 * fragment-face-set.ts — the CLOSED catalogue of graph-authorable "fragment"
 * faces: the face set a `ux:layoutJson` layout fragment may name.
 *
 * This is the Surface-unification seam (docs/design/surface-unification.md,
 * Stage A): the SAME five query-backed faces the retired standalone dashboard
 * interpreter registered (`stat.scalar`, `chart.vega-lite`, `card.subject`,
 * `sparql.bindings-table`, plus `sophia.home` as the honest empty-leaf
 * fallback) become ordinary workspace-Surface citizens, registered ONCE on the
 * `<sh-workspace-surface>` element's own sealed `FaceRegistry` next to the
 * bound workspace faces — no nested interpreter, no second engine.
 *
 * PLUS `obs.evidence-chain` (P6/P7, plans/observatory-ux-implementation-
 * spec-20260728.md §3 P6/P7): the drill-down door's evidence leaf. It joins
 * this SAME closed set — not a separate one — because the Observatory's
 * `sparql.bindings-table` -> `card.subject` -> `obs.evidence-chain` chain can
 * run *inside* a graph-authored fragment (the Observatory renders as a
 * fragment spliced into the shell's ONE workspace Surface), so the fragment
 * validation registry (`createFragmentFaceRegistry`, consumer 2 below) and
 * the shell's fragment loader (consumer 3) must both recognize it, exactly
 * like the other four query-backed faces.
 *
 * PLUS `card.object` (MO object-face integration spec, WS1 §5.3/§5.4 row A;
 * master spec §3 Slice 2): the first MO-native display, reading the SOURCE
 * register (`SourceObjectService`) rather than the RDF projection every other
 * face here reads. It is the SECOND service seam this catalogue threads
 * through `createFragmentResourceAdapters` — see that function's own header.
 *
 * PLUS `agent.session-family` (Prime synthesis Arc F): a sealed, read-only
 * view of one Agent Session's projected descendant family. Its adapter reads
 * only the cell's exact `:user:rdf` named graph and owns a retained live store;
 * graph-authored layout can select the face, but cannot add behavior or actions.
 *
 * Three consumers MUST agree on this catalogue, so all three build it from
 * here and only here:
 *   1. the workspace Surface element (render-workspace's
 *      `ensureWorkspaceSurfaceDefined` engine extension) — registration + the
 *      live resource adapters;
 *   2. fragment SPLICE validation (`fragment-splice.ts` via
 *      `createFragmentFaceRegistry`) — is a graph-authored document renderable
 *      at all;
 *   3. the shell's fragment LOADER (`apps/organism`'s
 *      `observatory-layout-source` call site) — the same validation applied at
 *      load time, before the document ever reaches assembly.
 *
 * The adapters take the production `QueryBlockService` seam — the SAME service
 * shape `makeQueryBlockService(rest)` builds over a live cell `RestClient`.
 * They are all `derived`-shaped. Query-backed adapters opt into the broker's
 * short retained window so sibling faces and warm revisits can reuse one
 * reactive store; a workspace service/session swap rotates the broker
 * namespace and interpreter resource scope, so that execution cache never
 * crosses service identity. `sophia.home`'s marker adapter is the one
 * `durable` and carries no service at all.
 */
import type { QueryBlockService } from '../editor-services/query-block-service.js'
import { FaceRegistry } from './face-registry.js'
import type { FaceRegistration, ResourceAdapter } from './types.js'
import type { QueryTextResolver } from './named-query-registry.js'
import type { SourceObjectService } from './source-object-service.js'
import { createStatScalarFace, createStatScalarResourceAdapter } from './faces/stat-scalar-face.js'
import { createChartVegaLiteFace, createChartVegaLiteResourceAdapter } from './faces/chart-vega-lite-face.js'
import { createCardSubjectFace, createCardSubjectResourceAdapter } from './faces/card-subject-face.js'
import {
  createSparqlBindingsTableFace,
  createSparqlBindingsTableResourceAdapter,
} from './faces/sparql-bindings-table-face.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from './faces/sophia-home-face.js'
import { createEvidenceChainFace, createEvidenceChainResourceAdapter } from './faces/evidence-chain-face.js'
import { createCardObjectFace, createCardObjectResourceAdapter } from './faces/card-object-face.js'
import { createComputeCellFace, createComputeCellResourceAdapter } from './faces/compute-cell-face.js'
import {
  createAgentSessionFamilyFace,
  createAgentSessionFamilyResourceAdapter,
} from './faces/agent-session-family-face.js'
import {
  createFilmstripFace,
  createFilmstripResourceAdapter,
  type FilmstripEvidenceService,
} from './faces/filmstrip-face.js'
import {
  GRID_COLLECTION_QUERY_ADAPTER_ID,
  createGridCollectionQueryResourceAdapter,
} from './faces/grid-collection-query-resource-adapter.js'
import {
  NO_CUENTA_VERB_SEAM,
  createCardCuentaFace,
  createCardCuentaResourceAdapter,
  type CuentaVerbSeam,
} from './faces/card-cuenta-face.js'
import { createCardSeatFace, createCardSeatResourceAdapter } from './faces/card-seat-face.js'
import { createCardLetterFace, createCardLetterResourceAdapter } from './faces/card-letter-face.js'
import { createCardFocusFace, createCardFocusResourceAdapter } from './faces/card-focus-face.js'
import { createCardInboxFace, createCardInboxResourceAdapter } from './faces/card-inbox-face.js'
import { createCardMyWorkFace, createCardMyWorkResourceAdapter } from './faces/card-my-work-face.js'
// el Despacho W11: the roster pokédex — a seat as a catalogue entry.
import { createCardAgentFace, createCardAgentResourceAdapter } from './faces/card-agent-face.js'
// Typed objects (2026-10-20, D7 "Layout leaves"): one typed object, any absolute IRI, drawn by <sh-object-view>.
import { createObjectCardFace, createObjectCardResourceAdapter } from './faces/object-card-face.js'
import type { TypedObjectService } from '../object-view/typed-object-service.js'

/**
 * The adapter id the Surface interpreter resolves a grid's COLLECTION children
 * source through — re-exported so the workspace element wiring and the
 * standalone harnesses name the exact same registration.
 */
export const FRAGMENT_GRID_COLLECTION_ADAPTER_ID = GRID_COLLECTION_QUERY_ADAPTER_ID

/**
 * Build the fragment face registrations — one fresh set per registry (a
 * `FaceRegistration` is a plain closed object; registering one instance on two
 * registries is legal, but a fresh set keeps every registry's provenance
 * self-contained).
 */
export function createFragmentFaceRegistrations(): readonly FaceRegistration[] {
  return [
    createStatScalarFace(),
    createChartVegaLiteFace(),
    createCardSubjectFace(),
    createSparqlBindingsTableFace(),
    createSophiaHomeFace(),
    createEvidenceChainFace(),
    createCardObjectFace(),
    createFilmstripFace(),
    createComputeCellFace(),
    createAgentSessionFamilyFace(),
    // el Despacho W1 (plans/2026-09-15-despacho-design.md §7): one bead as a
    // chapter with one act. Reads through the SAME query seam; its ONE write
    // path is the verb seam threaded below (`CuentaVerbSeam`).
    createCardCuentaFace(),
    // el Despacho W2: a seat as a character with a heartbeat, a letter as a
    // page, and the focus AS WHAT IT IS (a bead, a seat or a letter) so one
    // leaf and one mixed grid can follow the cursor across kinds.
    createCardSeatFace(),
    createCardLetterFace(),
    createCardFocusFace(),
    // el Despacho W4: the two rooms that are not a subject in the graph — an
    // inbox (everything that waits on one person, and nothing else) with the
    // one act `read`, and the work one office holds. Both take WHOSE from
    // closed params; the reader is always the session's own witness.
    createCardInboxFace(),
    createCardMyWorkFace(),
    createCardAgentFace(),
    // Typed objects D7: a graph-authored layout may place any typed object (a run item, a published object).
    createObjectCardFace(),
  ]
}

/** The face ids `createFragmentFaceRegistrations` mints, for cheap membership checks. */
export function fragmentFaceIds(): readonly string[] {
  return createFragmentFaceRegistrations().map((registration) => registration.faceId)
}

/**
 * Build the live resource adapters for the fragment face set over one
 * `QueryBlockService` PLUS one `SourceObjectService` — the second engine
 * seam `card.object` resolves through (MO object-face integration spec,
 * master §2.5/§2.8/§6.10). Includes the grid-collection adapter
 * (`FRAGMENT_GRID_COLLECTION_ADAPTER_ID`) so a graph-authored grid with
 * collection children resolves through the same seam.
 */
export function createFragmentResourceAdapters(
  service: QueryBlockService,
  resolver: QueryTextResolver,
  objects: SourceObjectService,
  evidence: FilmstripEvidenceService,
  /** The THIRD service seam: `card.cuenta`'s verb port + witness (el Despacho W1). Absent = the chapter reads, the act cannot be carried. */
  verbs: CuentaVerbSeam = NO_CUENTA_VERB_SEAM,
  /** The FOURTH seam: `object.card`'s typed-object reads (typed objects D6). Absent = the leaf says it cannot read. */
  typedObjects: TypedObjectService = NO_TYPED_OBJECT_SERVICE,
): readonly ResourceAdapter[] {
  return [
    createCardCuentaResourceAdapter(service, verbs),
    createCardSeatResourceAdapter(service),
    createCardLetterResourceAdapter(service),
    createCardFocusResourceAdapter(service, verbs),
    createCardInboxResourceAdapter(service, verbs),
    createCardMyWorkResourceAdapter(service),
    createCardAgentResourceAdapter(service),
    createStatScalarResourceAdapter(service, resolver),
    createChartVegaLiteResourceAdapter(service, resolver),
    createCardSubjectResourceAdapter(service),
    createSparqlBindingsTableResourceAdapter(service, resolver),
    createSophiaHomeResourceAdapter(),
    createGridCollectionQueryResourceAdapter(service, resolver),
    createEvidenceChainResourceAdapter(service),
    createCardObjectResourceAdapter(objects),
    createFilmstripResourceAdapter(service, resolver, evidence),
    createComputeCellResourceAdapter(service),
    createAgentSessionFamilyResourceAdapter(service),
    createObjectCardResourceAdapter(typedObjects),
  ]
}

/** A session with no typed-object reader: `object.card` leaves say so, honestly. */
export const NO_TYPED_OBJECT_SERVICE: TypedObjectService = {
  read: () => Promise.reject(new Error('object.card: this session has no typed-object reader')),
}

/**
 * A sealed registry of EXACTLY the fragment face set — the VALIDATION registry
 * fragment splicing and fragment loading validate graph-authored documents
 * against. Never used to mount anything (the live mounting registry is the
 * workspace Surface element's own, which registers this same set through
 * `createFragmentFaceRegistrations`).
 */
export function createFragmentFaceRegistry(): FaceRegistry {
  const registry = new FaceRegistry()
  for (const registration of createFragmentFaceRegistrations()) registry.register(registration)
  registry.seal()
  return registry
}
