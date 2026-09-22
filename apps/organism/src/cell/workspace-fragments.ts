/**
 * workspace-fragments.ts — the ORGANISM side of the unified Surface's
 * graph-authored fragment regions (docs/design/surface-unification.md,
 * Stage C). Replaces the retired nested-interpreter dashboard mount
 * (`layout-dashboard-mount.ts`): the shell no longer mounts anything — it
 * LOADS each marker region's `ux:layoutJson` fragment, hands the documents to
 * `renderWorkspace` (which splices them into the ONE workspace Surface), and
 * PERSISTS each fragment's settle points back to its own literal.
 *
 * What this controller owns, per (rest-client × graph) session:
 *   - REGION DISCOVERY: every config region whose resolved tag is the
 *     `sh-layout-dashboard` marker, each with its `sux:fragmentSurface` IRI
 *     (default: the well-known observatory surface — back-compat with every
 *     pre-vocab graph, including the deployed canary seed).
 *   - LOADING: `loadObservatoryLayoutDocument` per region — validated against
 *     the SAME closed fragment face catalogue the Surface element mounts
 *     (`createFragmentFaceRegistry`), landing in an honest
 *     loading → ready | error state that renderWorkspace turns into content
 *     or a status leaf. A settle triggers ONE `requestRender()`.
 *   - PERSISTENCE: `onFragmentChange` keeps the held fragment doc current on
 *     BOTH phases (so the next shell render can't snap a drag back) and, at a
 *     `commit` settle point, enqueues a durable write through the SAME
 *     serialized persister/sink primitive the retired mount used — scoped to
 *     the fragment's OWN surface IRI, never the spine.
 *
 * Persist failures surface through `onPersistError` (the shell logs them; the
 * optimistic in-memory state is deliberately NOT reverted — durability, not
 * the swap, is what a failed write loses) AND through `whenPersisted()` for
 * deterministic tests.
 */
import { resolveSurfaceTag, type WorkspaceConfig } from '@shrubbery/nucleus'
import type { RestClient } from '@shrubbery/nucleus/contract'
import {
  LAYOUT_DASHBOARD_COMPONENT,
  makeQueryBlockService,
  type QueryBlockService,
  type WorkspaceFragmentChangeDetail,
  type WorkspaceFragmentRegion,
  type WorkspaceFragmentsOptions,
} from '@shrubbery/runtime'
import {
  createFragmentFaceRegistry,
  type FaceRegistry,
  type FilmstripEvidenceService,
  type SourceObjectService,
} from '@shrubbery/runtime/layout'
import {
  OBSERVATORY_UX_SURFACE_IRI,
  ObservatoryLayoutSourceError,
  loadObservatoryLayoutDocument,
  loadObservatoryVegaTheme,
} from '../harness/observatory-layout-source.js'
import { createLayoutPersister, type LayoutPersister } from '../harness/layout-persister.js'

/** True when any region of `config` resolves to the fragment marker (kept under its historical name — the seed test pins it). */
export function configDeclaresDashboardCenter(config: WorkspaceConfig): boolean {
  return fragmentRegionsOf(config).length > 0
}

/** True only for the Observatory's own well-known fragment surface. */
export function configDeclaresObservatoryCenter(config: WorkspaceConfig): boolean {
  return fragmentRegionsOf(config).some(region => region.surfaceIri === OBSERVATORY_UX_SURFACE_IRI)
}

export interface FragmentRegionDeclaration {
  readonly regionId: string
  /** The declared `sux:fragmentSurface`, or the well-known default when absent. */
  readonly surfaceIri: string
}

/** Every marker region with its resolved surface IRI (config vocab → shell default). */
export function fragmentRegionsOf(config: WorkspaceConfig): readonly FragmentRegionDeclaration[] {
  const found: FragmentRegionDeclaration[] = []
  for (const regionId of Object.keys(config.regions)) {
    if (resolveSurfaceTag(config, regionId) !== LAYOUT_DASHBOARD_COMPONENT) continue
    found.push({
      regionId,
      surfaceIri: config.regions[regionId].fragmentSurface ?? OBSERVATORY_UX_SURFACE_IRI,
    })
  }
  return found
}

/** The live cell session a fragment set is scoped to. */
export interface WorkspaceFragmentSession {
  readonly rest: RestClient
  readonly graphId: string
  /**
   * Opaque content revision for the graph's complete `:ux:config` read.
   * A changed revision revalidates every declared `ux:layoutJson`/theme pair
   * without resetting the graph session or flashing a loading replacement.
   */
  readonly configRevision?: string
  readonly queryService?: QueryBlockService
  /** MO object-face integration spec (master §2.5/§2.8): the seam card.object resolves through. */
  readonly objectService?: SourceObjectService
  /** Hosted, authenticated resolver for private Observatory evidence. */
  readonly evidenceService?: FilmstripEvidenceService
}

export interface WorkspaceFragmentsControllerOptions {
  /** Called (once per settle) when an async fragment load lands — the shell re-renders. */
  readonly requestRender: () => void
  /** A durable persist REJECTED. The in-memory doc is NOT reverted; the shell decides how to surface it. */
  readonly onPersistError?: (error: unknown, detail: FragmentRegionDeclaration) => void
}

interface RegionRuntime {
  readonly declaration: FragmentRegionDeclaration
  state: WorkspaceFragmentRegion
  load?: Promise<void>
  /** Fences an older same-session read when a newer config revision arrives. */
  loadGeneration: number
}

export class WorkspaceFragmentsController {
  readonly #options: WorkspaceFragmentsControllerOptions
  readonly #registry: FaceRegistry = createFragmentFaceRegistry()
  #session: WorkspaceFragmentSession | null = null
  #queryService: QueryBlockService | null = null
  #objectService: SourceObjectService | null = null
  #evidenceService: FilmstripEvidenceService | null = null
  #regions = new Map<string, RegionRuntime>()
  #persisters = new Map<string, LayoutPersister>()
  /** Bumped on every session reset — a settling load from a dead session must never write state or render. */
  #epoch = 0

  constructor(options: WorkspaceFragmentsControllerOptions) {
    this.#options = options
  }

  /**
   * The one shell entry point: called from every renderConfig pass. Returns
   * the `fragments` option for `renderWorkspace`, or null when the config has
   * no marker regions / there is no live session. Kicks async loads for
   * regions not yet loaded in this session; each settle calls
   * `requestRender()` exactly once.
   */
  optionsFor(config: WorkspaceConfig, session: WorkspaceFragmentSession | null): WorkspaceFragmentsOptions | null {
    const declarations = fragmentRegionsOf(config)
    if (!session || declarations.length === 0) {
      this.#reset(null)
      return null
    }
    let configRevisionChanged = false
    if (!this.#session || this.#session.rest !== session.rest || this.#session.graphId !== session.graphId) {
      this.#reset(session)
    } else {
      // A mirror epoch rotates `surfaceQueryService()` by identity so Surface
      // can invalidate graph-derived resource stores. That is a RESOURCE
      // boundary, not a graph/session boundary: dropping the already-loaded
      // authored fragment here transiently replaces its tabs with a loading
      // leaf while the old interpreter plan is still visible. Keep the
      // fragment documents and persisters; only rotate the live services the
      // next Surface build receives.
      const previousExplicitQueryService = this.#session.queryService
      configRevisionChanged = this.#session.configRevision !== session.configRevision
      this.#session = session
      if (session.queryService) this.#queryService = session.queryService
      else if (previousExplicitQueryService) this.#queryService = makeQueryBlockService(session.rest)
      this.#objectService = session.objectService ?? null
      this.#evidenceService = session.evidenceService ?? null
    }

    const regions: Record<string, WorkspaceFragmentRegion> = {}
    for (const declaration of declarations) {
      const existing = this.#regions.get(declaration.regionId)
      const runtime = this.#ensureRegion(declaration)
      if (
        configRevisionChanged
        && existing === runtime
        && existing.declaration.surfaceIri === declaration.surfaceIri
      ) {
        this.#startLoad(runtime)
      }
      regions[declaration.regionId] = runtime.state
    }
    return {
      queryService: this.#queryService,
      objectService: this.#objectService,
      evidenceService: this.#evidenceService,
      regions,
      onFragmentChange: (detail) => this.#onFragmentChange(detail),
    }
  }

  /** Deterministic test/await hook: settles when every load kicked so far has settled. */
  async whenLoaded(): Promise<void> {
    await Promise.all(Array.from(this.#regions.values(), (runtime) => runtime.load ?? Promise.resolve()))
  }

  /** Deterministic test/await hook: resolves when the most recent persist per surface settled; rejects on failure. */
  async whenPersisted(): Promise<void> {
    await Promise.all(Array.from(this.#persisters.values(), (persister) => persister.whenSettled()))
  }

  #reset(session: WorkspaceFragmentSession | null): void {
    this.#epoch += 1
    this.#session = session
    this.#queryService = session
      ? session.queryService ?? makeQueryBlockService(session.rest)
      : null
    this.#objectService = session?.objectService ?? null
    this.#evidenceService = session?.evidenceService ?? null
    this.#regions = new Map()
    this.#persisters = new Map()
  }

  #ensureRegion(declaration: FragmentRegionDeclaration): RegionRuntime {
    const existing = this.#regions.get(declaration.regionId)
    if (existing && existing.declaration.surfaceIri === declaration.surfaceIri) return existing

    const runtime: RegionRuntime = {
      declaration,
      state: { surfaceIri: declaration.surfaceIri, state: { status: 'loading' } },
      loadGeneration: 0,
    }
    this.#regions.set(declaration.regionId, runtime)
    this.#startLoad(runtime)
    return runtime
  }

  #startLoad(runtime: RegionRuntime): void {
    runtime.loadGeneration += 1
    runtime.load = this.#load(runtime, runtime.loadGeneration)
  }

  async #load(runtime: RegionRuntime, loadGeneration: number): Promise<void> {
    const session = this.#session
    const queryService = this.#queryService
    const epoch = this.#epoch
    if (!session || !queryService) return
    try {
      // Layout + theme are SIBLING literals at the same subject
      // (observatory-layout-source.ts's own header) — loaded in parallel, so
      // an authored theme is never a second round trip's worth of extra
      // latency on top of the layout fetch.
      const [loaded, theme] = await Promise.all([
        loadObservatoryLayoutDocument({
          queryService,
          graphId: session.graphId,
          surfaceIri: runtime.declaration.surfaceIri,
          isFaceRegistered: this.#registry.toFaceRegistrationPredicate(),
          isFaceGridEligible: this.#registry.toFaceGridEligibilityPredicate(),
          hasRegisteredFace: (faceId) => this.#registry.has(faceId),
        }),
        loadObservatoryVegaTheme({ queryService, graphId: session.graphId, surfaceIri: runtime.declaration.surfaceIri }),
      ])
      if (epoch !== this.#epoch || loadGeneration !== runtime.loadGeneration) return
      // The theme rides ON the region state — per region, per session, no
      // module/global anywhere: render-workspace registers each pass's
      // per-region themes against the surface root, and each chart resolves
      // its OWN region's theme at mount (`resolveVegaThemeOverride`). A
      // session reset simply drops this region (and its theme) with it.
      runtime.state = {
        surfaceIri: runtime.declaration.surfaceIri,
        vegaTheme: theme.theme,
        state: { status: 'ready', doc: loaded.doc },
      }
    } catch (error) {
      if (epoch !== this.#epoch || loadGeneration !== runtime.loadGeneration) return
      const message =
        error instanceof ObservatoryLayoutSourceError
          ? error.message
          : `fragment load failed: ${error instanceof Error ? error.message : String(error)}`
      runtime.state = { surfaceIri: runtime.declaration.surfaceIri, state: { status: 'error', error: message } }
    }
    if (epoch === this.#epoch && loadGeneration === runtime.loadGeneration) {
      this.#options.requestRender()
    }
  }

  #onFragmentChange(detail: WorkspaceFragmentChangeDetail): void {
    const runtime = this.#regions.get(detail.regionId)
    if (!runtime || runtime.declaration.surfaceIri !== detail.surfaceIri) return
    // BOTH phases update the held doc — a shell render mid-drag must re-splice
    // the dragged geometry, not the pre-drag snapshot. Spread keeps the
    // region's OWN loaded vegaTheme riding along.
    runtime.state = { ...runtime.state, surfaceIri: detail.surfaceIri, state: { status: 'ready', doc: detail.doc } }
    if (detail.phase !== 'commit') return
    // Commit IS the settle point: one durable, serialized write of the
    // fragment's OWN document to its OWN surface literal.
    this.#persisterFor(runtime.declaration).persist(detail.doc)
  }

  #persisterFor(declaration: FragmentRegionDeclaration): LayoutPersister {
    const session = this.#session
    if (!session) throw new Error('workspace-fragments: persist requested with no live session')
    let persister = this.#persisters.get(declaration.surfaceIri)
    if (!persister) {
      persister = createLayoutPersister({
        rest: session.rest,
        graphId: session.graphId,
        surfaceIri: declaration.surfaceIri,
        onError: (error) => this.#options.onPersistError?.(error, declaration),
      })
      this.#persisters.set(declaration.surfaceIri, persister)
    }
    return persister
  }
}
