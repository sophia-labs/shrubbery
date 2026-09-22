/**
 * observatory-layout-source.ts — loads the hosted Observatory `LayoutDocument`
 * from graph-authored `ux:layoutJson`, falling back to the canned, in-repo
 * `buildObservatorySurfaceDocument()` builder (P7: the tabs-composed
 * Pulse/Fleet/Capture "observatory surface v1" — graduated from the earlier
 * v0 `buildObservatoryDashboardDocument()`, plans/observatory-ux-
 * implementation-spec-20260728.md §3 P7 step 4) ONLY when the graph genuinely
 * carries no such triple.
 *
 * Convention (NEW — this module is the one place in the codebase that names
 * it; nothing else defines `ux:layoutJson` yet):
 *   subject     `<urn:sophia:ux:surface:observatory-dashboard>`
 *   predicate   `ux:layoutJson`  (`PREFIX ux: <http://mnemosyne.dev/ux#>`)
 *   value       ONE string literal: a JSON-serialized `LayoutDocument` — the
 *               query below asks for TWO (`LIMIT 2`) precisely so this
 *               module can DETECT a second `ux:layoutJson` triple and treat
 *               it as a real error, rather than an unordered `LIMIT 1`
 *               letting one arbitrary value win silently (grid-laneb
 *               hosted-dashboard review WRONG finding 3).
 *   named graph `urn:mnemosyne:local:graph:{graphId}:ux:config` — the SAME
 *               per-cell `:ux:config` slot `uxConfigGraphIri`
 *               (`@shrubbery/nucleus`) already names for the older `sux:`
 *               `WorkspaceConfig` vocabulary (`workspace/ux-rdf.ts`). One
 *               named graph, two disjoint predicate vocabularies (`sux:` vs
 *               `ux:`) — this module only ever reads `ux:layoutJson`, never
 *               touches `sux:`.
 *
 * Three outcomes, never conflated (Builder brief item 2: "Fall back to
 * buildObservatoryDashboardDocument() ONLY if the graph has no ux:layoutJson,
 * and say so in the page chrome"):
 *   source: 'graph'    — EXACTLY ONE `ux:layoutJson` literal was found,
 *                         parsed as JSON, and passed
 *                         `createValidatedLayoutDocument` against the
 *                         CALLER's own sealed `FaceRegistry` predicate
 *                         (`registry.toFaceRegistrationPredicate()` — the
 *                         "sealed registry predicate" the brief names).
 *   source: 'fallback' — the graph carries NO `ux:layoutJson` triple at all
 *                         (the query returned zero rows). The ONLY condition
 *                         this module falls back on.
 *   throws (`ObservatoryLayoutSourceError`) — a `ux:layoutJson` triple
 *                         EXISTS but is not parseable JSON, fails
 *                         `LayoutDocument` validation, is not a literal
 *                         term, MORE THAN ONE such triple exists (the
 *                         uniqueness invariant this value's contract
 *                         requires), or the query itself failed. Silently
 *                         falling back or silently picking one here would
 *                         hide a real authoring/auth bug behind the canned
 *                         dashboard; the caller renders this as an explicit
 *                         error state, never a silent substitution.
 */
import {
  createValidatedLayoutDocument,
  type FaceGridEligibilityPredicate,
  type FaceRegistrationPredicate,
  type LayoutDocument,
} from '@shrubbery/nucleus/layout'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import { validateVegaThemeOverride, type QueryBlockService } from '@shrubbery/runtime'
import { buildObservatorySurfaceDocument } from './observatory-surface-document.js'

/** The one subject this module reads `ux:layoutJson` off of (v0: a single, well-known dashboard surface — not yet a catalog of surfaces). */
export const OBSERVATORY_UX_SURFACE_IRI = 'urn:sophia:ux:surface:observatory-dashboard'

/**
 * The `ux:` vocabulary namespace and the ONE local predicate name this module
 * reads (`ux:layoutJson`). Exported as the single source of truth so the WRITE
 * side (`observatory-layout-sink.ts`) targets the EXACT same predicate the
 * reader queries — a divergence here would let a durable write land on a
 * predicate the loader never looks at.
 */
export const UX_NS = 'http://mnemosyne.dev/ux#'
export const UX_LAYOUT_JSON_PREDICATE_LOCAL = 'layoutJson'

/**
 * `ux:vegaTheme` — the SAME subject/named-graph pattern as `ux:layoutJson`
 * above (this module's own convention, now extended: B2's chart-grammar
 * pass, `packages/runtime/src/editor-services/vega-theme.ts`), a SIBLING
 * literal, never nested inside the `ux:layoutJson` JSON itself — a chart
 * theme is a property of the SURFACE, not of any one leaf's persisted
 * layout document, and keeping it a separate triple means re-authoring the
 * theme never touches (or risks corrupting) the layout document's own
 * uniqueness/validation contract. OPTIONAL: unlike `ux:layoutJson`, a
 * missing `ux:vegaTheme` is never an error for ANY surface (not just the
 * default one) — the in-repo `buildVegaTheme` default already makes every
 * existing chart conform with no graph authoring at all.
 */
export const UX_VEGA_THEME_PREDICATE_LOCAL = 'vegaTheme'

/**
 * Reject any graph id outside the platform's canonical grammar — the EXACT
 * rule the gateway's `validate_graph_id` (platform-next `cell.rs`) enforces
 * at graph creation: 1–40 chars of `[a-z0-9-]`. Strictly narrower than the
 * SPARQL IRIREF exclusion set (review WRONG finding 4, round 2: a deny-list
 * of `>`/whitespace still let `<`, quotes, braces, pipes, carets, backslash
 * and controls form an invalid IRIREF), so nothing that passes here can
 * corrupt the `<IRI>` tokens below — and nothing the gateway would refuse
 * to serve is ever queried for.
 */
export function assertEmbeddableGraphId(graphId: string): void {
  if (!/^[a-z0-9-]{1,40}$/.test(graphId)) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: graph id ${JSON.stringify(graphId)} is outside the platform graph-id grammar ([a-z0-9-]{1,40})`,
    )
  }
}

/**
 * Reject a surface IRI that could not be embedded verbatim inside a SPARQL
 * `<IRIREF>` token — the IRIREF production's own exclusion set (`<>"{}|^\``,
 * backslash, space, and C0 controls). A `sux:fragmentSurface` value arrives
 * from a parsed RDF IRI term and normally satisfies this trivially; the
 * assert keeps a corrupt/hand-typed value from ever corrupting the query.
 */
export function assertEmbeddableSurfaceIri(surfaceIri: string): void {
  // eslint-disable-next-line no-control-regex
  if (surfaceIri.length === 0 || /[\u0000-\u0020<>"{}|^`\\]/.test(surfaceIri)) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: surface IRI ${JSON.stringify(surfaceIri)} cannot be embedded in a SPARQL IRIREF`,
    )
  }
}

/**
 * The exact SPARQL text this module runs — exported for tests/documentation,
 * never mutated. `LIMIT 2`, not `LIMIT 1`: this module needs to tell "exactly
 * one `ux:layoutJson` triple" apart from "two or more" so it can raise a real
 * uniqueness-violation error instead of an unordered `LIMIT 1` letting one
 * arbitrary triple win (grid-laneb hosted-dashboard review WRONG finding 3).
 *
 * `surfaceIri` (Surface unification): the `ux:layoutJson` SUBJECT — a config
 * region's `sux:fragmentSurface`, defaulting to the well-known observatory
 * dashboard surface for back-compat with every pre-vocab graph.
 */
export function observatoryLayoutJsonQuery(graphId: string, surfaceIri: string = OBSERVATORY_UX_SURFACE_IRI): string {
  assertEmbeddableGraphId(graphId)
  assertEmbeddableSurfaceIri(surfaceIri)
  const graphIri = uxConfigGraphIri(graphId)
  return (
    `PREFIX ux: <${UX_NS}>\n` +
    `SELECT ?layoutJson WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_LAYOUT_JSON_PREDICATE_LOCAL} ?layoutJson .\n` +
    `  }\n` +
    `} LIMIT 2`
  )
}

/** Mirrors `observatoryLayoutJsonQuery` exactly — same subject, same named graph, same `LIMIT 2` uniqueness discipline — for the sibling `ux:vegaTheme` literal. */
export function observatoryVegaThemeQuery(graphId: string, surfaceIri: string = OBSERVATORY_UX_SURFACE_IRI): string {
  assertEmbeddableGraphId(graphId)
  assertEmbeddableSurfaceIri(surfaceIri)
  const graphIri = uxConfigGraphIri(graphId)
  return (
    `PREFIX ux: <${UX_NS}>\n` +
    `SELECT ?vegaTheme WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_VEGA_THEME_PREDICATE_LOCAL} ?vegaTheme .\n` +
    `  }\n` +
    `} LIMIT 2`
  )
}

export type ObservatoryLayoutSource = 'graph' | 'fallback'

export interface ObservatoryLayoutLoadResult {
  readonly doc: LayoutDocument
  readonly source: ObservatoryLayoutSource
}

/** Thrown for every failure OTHER than "no ux:layoutJson triple" — see this module's header. */
export class ObservatoryLayoutSourceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ObservatoryLayoutSourceError'
  }
}

export interface LoadObservatoryLayoutDocumentOptions {
  readonly queryService: QueryBlockService
  readonly graphId: string
  /**
   * The `ux:layoutJson` SUBJECT to load (Surface unification: a region's
   * `sux:fragmentSurface`). Defaults to `OBSERVATORY_UX_SURFACE_IRI`. The
   * canned observatory fallback applies ONLY to that default surface — a
   * non-default surface with no authored triple is an honest ERROR (showing
   * the observatory dashboard for an unrelated surface would be a silent
   * substitution).
   */
  readonly surfaceIri?: string
  /** Typically `registry.toFaceRegistrationPredicate()` off the SAME sealed `FaceRegistry` the interpreter mounts against. */
  readonly isFaceRegistered: FaceRegistrationPredicate
  /**
   * Typically `registry.toFaceGridEligibilityPredicate()` off the SAME
   * sealed `FaceRegistry` — without this, `createValidatedLayoutDocument`
   * falls back to `validate.ts`'s permissive `() => true` default and a
   * graph-authored document could name a `persistent-non-relocatable` face
   * in a grid cell undetected (grid-laneb hosted-dashboard review WRONG
   * finding 5).
   */
  readonly isFaceGridEligible: FaceGridEligibilityPredicate
  /**
   * Typically `registry.has.bind(registry)` off the SAME sealed
   * `FaceRegistry`. `validate.ts`'s own preflight deliberately defers
   * checking a grid COLLECTION's `itemFaceId` against `isFaceRegistered`
   * (no concrete `ViewDescriptor` exists pre-render — see that module's own
   * comment); this loader closes that gap for graph-authored documents with
   * an explicit membership check, so an unregistered collection face is
   * rejected here rather than surfacing later as a per-cell render error
   * (grid-laneb hosted-dashboard review WRONG finding 5).
   */
  readonly hasRegisteredFace: (faceId: string) => boolean
}

/** Every grid node in `doc` whose children are a collection binding (`grid.children.kind === 'collection'`). */
function collectionGridNodes(
  doc: LayoutDocument,
): ReadonlyArray<{ readonly nodeId: string; readonly itemFaceId: string }> {
  const found: Array<{ nodeId: string; itemFaceId: string }> = []
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'grid' && node.children.kind === 'collection') {
      found.push({ nodeId, itemFaceId: node.children.itemFaceId })
    }
  }
  return found
}

export async function loadObservatoryLayoutDocument(
  options: LoadObservatoryLayoutDocumentOptions,
): Promise<ObservatoryLayoutLoadResult> {
  const { queryService, graphId, isFaceRegistered, isFaceGridEligible, hasRegisteredFace } = options
  const surfaceIri = options.surfaceIri ?? OBSERVATORY_UX_SURFACE_IRI
  const query = observatoryLayoutJsonQuery(graphId, surfaceIri)

  let result: Awaited<ReturnType<QueryBlockService['run']>>
  try {
    // maxRows=2 matches the query's own `LIMIT 2` — enough to tell "exactly
    // one" apart from "more than one" without ever needing an exact count.
    result = await queryService.run(graphId, query, 2)
  } catch (error) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: querying ux:layoutJson in graph "${graphId}" failed: ` +
        (error instanceof Error ? error.message : String(error)),
      error,
    )
  }

  if (result.resultKind !== 'bindings') {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: expected a SELECT bindings result for graph "${graphId}", got '${result.resultKind}'`,
    )
  }

  if (result.rows.length === 0) {
    // No ux:layoutJson triple at all — the ONLY condition this module falls
    // back on, and ONLY for the well-known default observatory surface
    // (back-compat with the deployed canary seed). Parameterized with the
    // SAME `graphId` the query above just ran against (grid-laneb
    // hosted-dashboard review WRONG finding 1). For any OTHER surface, an
    // absent triple is an honest error, never a canned substitution.
    if (surfaceIri === OBSERVATORY_UX_SURFACE_IRI) {
      // P7 (plans/observatory-ux-implementation-spec-20260728.md §3 P7,
      // step 4): the in-repo fallback graduates from the canned v0 dashboard
      // to the tabs-composed "observatory surface v1" document. This is the
      // ONLY place `buildObservatorySurfaceDocument` is wired to a live
      // reader — P1's deploy-order rule ("no `tabs` node may be written into
      // any graph, seed file, or canned document builder until the SPA build
      // that understands it is deployed") permits authoring a tabs document
      // ONLY into this in-repo fallback, never into a graph — so this swap
      // carries no seed change with it.
      return { doc: buildObservatorySurfaceDocument(graphId), source: 'fallback' }
    }
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: graph "${graphId}" carries no ux:layoutJson for <${surfaceIri}> — ` +
        'this surface has not been authored yet',
    )
  }

  if (result.rows.length > 1) {
    // The `ux:layoutJson` contract (this module's own header) is ONE literal
    // per graph. An unordered `LIMIT 1` would have let one arbitrary triple
    // win silently here; this module surfaces the violation instead (grid-
    // laneb hosted-dashboard review WRONG finding 3).
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: graph "${graphId}" carries more than one ux:layoutJson triple ` +
        `for <${surfaceIri}> — expected exactly one`,
    )
  }

  const term = result.rows[0]?.layoutJson
  if (!term || term.type !== 'literal') {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:layoutJson in graph "${graphId}" is not a literal term ` +
        `(got ${term ? JSON.stringify(term) : 'no binding'})`,
    )
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(term.value)
  } catch (error) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:layoutJson in graph "${graphId}" is not valid JSON: ` +
        (error instanceof Error ? error.message : String(error)),
      error,
    )
  }

  const verdict = createValidatedLayoutDocument(candidate as LayoutDocument, { isFaceRegistered, isFaceGridEligible })
  if (!verdict.ok) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:layoutJson in graph "${graphId}" failed LayoutDocument validation: ` +
        JSON.stringify(verdict.diagnostics),
    )
  }

  // validate.ts deliberately defers checking a collection's itemFaceId
  // against isFaceRegistered (no concrete ViewDescriptor exists pre-render)
  // — close that gap here for graph-authored documents specifically.
  const unregisteredCollectionFaces = collectionGridNodes(verdict.doc).filter(
    ({ itemFaceId }) => !hasRegisteredFace(itemFaceId),
  )
  if (unregisteredCollectionFaces.length > 0) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:layoutJson in graph "${graphId}" names an unregistered collection itemFaceId: ` +
        unregisteredCollectionFaces.map(({ nodeId, itemFaceId }) => `${nodeId}="${itemFaceId}"`).join(', '),
    )
  }

  return { doc: verdict.doc, source: 'graph' }
}

// ── ux:vegaTheme — the sibling read, same trichotomy shape ─────────────────

export type ObservatoryVegaThemeSource = 'graph' | 'fallback'

export interface ObservatoryVegaThemeLoadResult {
  /** The parsed, law-validated theme override, or `null` on `source: 'fallback'` — the caller stores it on the region (`WorkspaceFragmentRegion.vegaTheme`) for the scoped per-region resolution. */
  readonly theme: Record<string, unknown> | null
  readonly source: ObservatoryVegaThemeSource
}

export interface LoadObservatoryVegaThemeOptions {
  readonly queryService: QueryBlockService
  readonly graphId: string
  /** The `ux:vegaTheme` SUBJECT to load — same default and same meaning as `LoadObservatoryLayoutDocumentOptions.surfaceIri`. */
  readonly surfaceIri?: string
}

/**
 * Load the graph-authored `ux:vegaTheme` literal, mirroring
 * `loadObservatoryLayoutDocument`'s own honest trichotomy:
 *   - `source: 'graph'`    — EXACTLY ONE `ux:vegaTheme` literal was found,
 *                            parsed as JSON, and passed
 *                            `validateVegaThemeOverride` (a plain object of
 *                            law-safe style keys — never the palette ranges,
 *                            the chart surface, or a mark color).
 *   - `source: 'fallback'` — the graph carries NO `ux:vegaTheme` triple.
 *                            UNLIKE the layout loader, this is never
 *                            surface-restricted: a theme is optional
 *                            everywhere (the in-repo default already makes
 *                            every existing chart conform with no graph
 *                            authoring), so `theme: null` here is the
 *                            ordinary, expected case, not a special-cased
 *                            back-compat default.
 *   - throws (`ObservatoryLayoutSourceError`) — a `ux:vegaTheme` triple
 *                            EXISTS but is not parseable JSON, is not a
 *                            literal term, fails the structural theme-key
 *                            check, or more than one such triple exists.
 *                            Same reasoning as the layout loader: silently
 *                            falling back or silently picking one here would
 *                            hide a real authoring bug behind the in-repo
 *                            default theme.
 */
export async function loadObservatoryVegaTheme(
  options: LoadObservatoryVegaThemeOptions,
): Promise<ObservatoryVegaThemeLoadResult> {
  const { queryService, graphId } = options
  const surfaceIri = options.surfaceIri ?? OBSERVATORY_UX_SURFACE_IRI
  const query = observatoryVegaThemeQuery(graphId, surfaceIri)

  let result: Awaited<ReturnType<QueryBlockService['run']>>
  try {
    result = await queryService.run(graphId, query, 2)
  } catch (error) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: querying ux:vegaTheme in graph "${graphId}" failed: ` +
        (error instanceof Error ? error.message : String(error)),
      error,
    )
  }

  if (result.resultKind !== 'bindings') {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: expected a SELECT bindings result for graph "${graphId}", got '${result.resultKind}'`,
    )
  }

  if (result.rows.length === 0) {
    return { theme: null, source: 'fallback' }
  }

  if (result.rows.length > 1) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: graph "${graphId}" carries more than one ux:vegaTheme triple ` +
        `for <${surfaceIri}> — expected exactly one`,
    )
  }

  const term = result.rows[0]?.vegaTheme
  if (term?.type !== 'literal') {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:vegaTheme in graph "${graphId}" is not a literal term ` +
        `(got ${term ? JSON.stringify(term) : 'no binding'})`,
    )
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(term.value)
  } catch (error) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:vegaTheme in graph "${graphId}" is not valid JSON: ` +
        (error instanceof Error ? error.message : String(error)),
      error,
    )
  }

  const verdict = validateVegaThemeOverride(candidate)
  if (!verdict.ok) {
    throw new ObservatoryLayoutSourceError(
      `observatory layout-source: ux:vegaTheme in graph "${graphId}" is not a valid theme override — ` +
        `${verdict.reason} (got ${JSON.stringify(candidate)})`,
    )
  }

  return { theme: verdict.theme, source: 'graph' }
}
