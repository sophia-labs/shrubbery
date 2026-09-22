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
): readonly ResourceAdapter[] {
  return [
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
  ]
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
