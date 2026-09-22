/**
 * durable-layout-session.ts — the composable unit that wires the durable write
 * (`observatory-layout-sink.ts`) to fire on LIVE layout mutation, so a
 * data-declared `LayoutEdge`'s structural change AUTO-PERSISTS and survives a
 * reload. This is the reusable "persist-on-mutation" seam the future
 * production-shell adoption will call.
 *
 * It composes the three already-committed primitives, adding no new layout
 * semantics of its own:
 *   - SOURCE: `loadObservatoryLayoutDocument` — reads the graph's `ux:layoutJson`
 *     literal for the initial doc (`source:'graph'`), or reports `'fallback'`
 *     when the graph carries no such triple. On `'fallback'` the session seeds
 *     from the CALLER-supplied `fallbackDoc` (the source's own canned builder is
 *     bypassed — a live shell supplies its own seed).
 *   - EDGES: `installLayoutEdges` — turns an intent event into a validated
 *     `applyOperation` mutation and hands the new frozen doc to `commit`.
 *   - SINK: `persistLayoutDocument` — one `sparql_update` (DELETE+INSERT) that
 *     durably REPLACES the `ux:layoutJson` literal. `commit` calls it on every
 *     mutation.
 *
 * Honest scope (read before extending — inherited verbatim from the sink):
 *   - DURABLE, not CRDT. Each mutation serializes the WHOLE document and replaces
 *     the previous literal wholesale. "Durable" means the same document loads
 *     back after a reload — no merge, no operational transform, no conflict
 *     resolution.
 *   - One-shot `sparql_update` PER mutation. Not batched, not debounced here
 *     (the caller may debounce upstream of `fire`); every committed mutation is
 *     one durable write.
 *   - Multi-tab convergence is POLL-BASED last-writer-wins: a second tab only
 *     observes a write when it next runs the reader's query. No live
 *     subscription.
 *   - Persist failure is NEVER swallowed (the repo forbids silent fallbacks): a
 *     rejected write surfaces through `onPersistError` AND a rejected
 *     `whenPersisted()`. The session doc still swaps optimistically (the reducer
 *     already validated it) — durability, not the in-memory swap, is what a
 *     failed write loses, and the caller is told.
 *   - Persists are SERIALIZED on a single promise chain (mirroring the
 *     layout-workbench `reconcileQueue`), so two rapid mutations write in fire
 *     order and the store lands on the final doc — never a last-writer-wins race
 *     between two overlapping in-flight writes.
 *
 * Island-clean: the only seam to the outside is the contract's `RestClient`
 * (query + update). It reuses the source/sink constants as the single source of
 * truth for subject/predicate/graph, so the write can never drift onto a
 * predicate the reader does not query.
 *
 * STATUS: the production-shell adoption LANDED via
 * `cell/layout-dashboard-mount.ts` (the workspace-hosted dashboard center),
 * which composes the SAME source + persister primitives directly — its divider
 * chrome drives `applyOperation` itself, so it does not need this module's
 * edge-driven intent seam. This session unit remains the reusable
 * persist-on-mutation composition for the NEXT step (data-declared
 * `LayoutEdge`s mutating a live, cell-connected layout); it is complete and
 * proven on its own (see durable-layout-session.test.ts).
 */
import type {
  FaceGridEligibilityPredicate,
  FaceRegistrationPredicate,
  LayoutDocument,
  LayoutEdge,
} from '@shrubbery/nucleus/layout'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { makeQueryBlockService } from '@shrubbery/runtime'
import {
  FaceRegistry,
  createSophiaHomeFace,
  installLayoutEdges,
  type LayoutIdMinter,
  type LayoutIntentEvent,
  type LayoutIntentSource,
} from '@shrubbery/runtime/layout'
import {
  loadObservatoryLayoutDocument,
  type ObservatoryLayoutSource,
} from './observatory-layout-source.js'
import { createLayoutPersister } from './layout-persister.js'

/**
 * The three registry-derived predicates the SOURCE loader needs to validate a
 * graph-authored document, bundled so a caller passes ONE object off its own
 * sealed `FaceRegistry` (`registry.toFaceRegistrationPredicate()` etc.) instead
 * of three loose arguments. `isFaceRegistered` doubles as the interpreter's
 * `applyOperation` validate predicate, so a mutation is checked against the SAME
 * registry the load was.
 */
export interface LayoutFaceRegistration {
  readonly isFaceRegistered: FaceRegistrationPredicate
  readonly isFaceGridEligible: FaceGridEligibilityPredicate
  readonly hasRegisteredFace: (faceId: string) => boolean
}

/**
 * The default face registration: a real sealed `FaceRegistry` carrying exactly
 * `sophia.home` — the SAME face the edge interpreter's own default validate
 * allow-list registers, and enough for both closed-vocabulary predicates
 * (`closesLeaf`/`opensInSplit`). Honest, not a permissive `() => true` escape
 * hatch: a graph-authored document naming an unregistered face is still
 * rejected. A live shell passes its real registry's bundle instead.
 */
export function defaultLayoutFaceRegistration(): LayoutFaceRegistration {
  const registry = new FaceRegistry()
  registry.register(createSophiaHomeFace())
  registry.seal()
  return {
    isFaceRegistered: registry.toFaceRegistrationPredicate(),
    isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
    hasRegisteredFace: (faceId) => registry.has(faceId),
  }
}

export interface DurableLayoutSessionOptions {
  /** The contract write/read seam — query() answers the loader, update() applies the durable persist. */
  readonly rest: RestClient
  /** The cell graph whose `:ux:config` slot the layout literal lives in. */
  readonly graphId: string
  /** The surface subject the `ux:layoutJson` triple hangs off (defaults to the observatory surface). */
  readonly surfaceIri?: string
  /** The data-declared layout-mutating edges to install over the internal intent source. */
  readonly edges: readonly LayoutEdge[]
  /**
   * The seed the session starts from when the source reports `source:'fallback'`
   * (the graph carries no `ux:layoutJson`). The session must start from
   * SOMETHING; the caller supplies it rather than inheriting the source's canned
   * observatory builder.
   */
  readonly fallbackDoc: LayoutDocument
  /** Registry predicates for load-validation + interpreter validation (default: `sophia.home` only). */
  readonly faceRegistration?: LayoutFaceRegistration
  /** Deterministic id minter for `split_leaf` ops (default: the interpreter's own counter minter). */
  readonly mintId?: LayoutIdMinter
  /**
   * Notified when a durable persist REJECTS (the mutation applied in-memory but
   * did not reach the store). Never swallowed: `whenPersisted()` also rejects.
   * `doc` is the document whose persist failed.
   */
  readonly onPersistError?: (error: unknown, doc: LayoutDocument) => void
}

export interface DurableLayoutSession {
  /**
   * Load the initial doc, seat it as the session doc, and install the edges over
   * the internal intent source with a `commit` that swaps the doc AND durably
   * persists it. Returns the seated doc and where it came from (`'graph'` = the
   * store already had a persisted layout; `'fallback'` = seeded from `fallbackDoc`).
   */
  start(): Promise<{ readonly doc: LayoutDocument; readonly source: ObservatoryLayoutSource }>
  /** The current in-memory session doc (post any committed mutations). */
  getDoc(): LayoutDocument
  /**
   * Fire a layout intent over the internal source — drives the installed edges
   * exactly as a live source would. A matched edge synthesizes + applies its op
   * and the resulting mutation auto-persists; an unmatched `from` or forged
   * predicate is inert.
   */
  fire(event: LayoutIntentEvent): void
  /**
   * Resolves when the most-recently-enqueued persist (and therefore every
   * persist before it, since they are serialized) has SETTLED; REJECTS if that
   * persist failed. For deterministic tests and for a caller that wants to await
   * durability after a mutation.
   */
  whenPersisted(): Promise<void>
  /** Dispose the edge interpreter (removes the source subscription). Idempotent. */
  dispose(): void
}

/**
 * Compose source + edges + sink into a persist-on-mutation session. See the
 * module header for the durability model and its honest limits.
 */
export function createDurableLayoutSession(opts: DurableLayoutSessionOptions): DurableLayoutSession {
  const { rest, graphId, surfaceIri, edges, fallbackDoc, mintId, onPersistError } = opts
  const faceRegistration = opts.faceRegistration ?? defaultLayoutFaceRegistration()

  // The single session doc. `getDoc` reads it; `commit` swaps it.
  let doc: LayoutDocument = fallbackDoc

  // ── serialized persist chain (the shared layout-persister, mirroring the
  // workbench reconcileQueue): two rapid commits write in fire order, and a
  // failure surfaces via `onPersistError` AND a rejecting `whenPersisted()`. ──
  const persister = createLayoutPersister({ rest, graphId, surfaceIri, onError: onPersistError })

  // The interpreter's commit seam: adopt the reducer's validated+frozen doc,
  // then durably persist it. Optimistic swap (the reducer already validated);
  // durability — not the swap — is what a failed write loses, and the caller is
  // told via onPersistError / whenPersisted.
  function commit(next: LayoutDocument): void {
    doc = next
    persister.persist(next)
  }

  // The session OWNS its intent source (the caller drives it via `fire`).
  const listeners = new Set<(event: LayoutIntentEvent) => void>()
  const source: LayoutIntentSource = {
    onIntent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  let disposer: (() => void) | null = null

  async function start(): Promise<{ readonly doc: LayoutDocument; readonly source: ObservatoryLayoutSource }> {
    const loaded = await loadObservatoryLayoutDocument({
      queryService: makeQueryBlockService(rest),
      graphId,
      isFaceRegistered: faceRegistration.isFaceRegistered,
      isFaceGridEligible: faceRegistration.isFaceGridEligible,
      hasRegisteredFace: faceRegistration.hasRegisteredFace,
    })
    // Use the loaded doc ONLY when it genuinely came from the graph; otherwise
    // seed from the caller's fallbackDoc (bypassing the source's canned builder).
    doc = loaded.source === 'graph' ? loaded.doc : fallbackDoc

    disposer = installLayoutEdges(edges, source, () => doc, commit, {
      validate: {
        isFaceRegistered: faceRegistration.isFaceRegistered,
        isFaceGridEligible: faceRegistration.isFaceGridEligible,
      },
      mintId,
    })

    return { doc, source: loaded.source }
  }

  return {
    start,
    getDoc: () => doc,
    fire(event: LayoutIntentEvent) {
      for (const listener of [...listeners]) listener(event)
    },
    whenPersisted: () => persister.whenSettled(),
    dispose() {
      disposer?.()
      disposer = null
    },
  }
}
