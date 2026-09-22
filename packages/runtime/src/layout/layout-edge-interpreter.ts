/**
 * layout-edge-interpreter.ts — the runtime binding that turns `LayoutEdge`s
 * (the nucleus model) into live layout mutation. This is the LayoutDocument-
 * world analogue of edge-interpreter.ts (which drives the old face:* selection
 * `ConfigEdge`s): same nucleus-model / runtime-interpreter split, same
 * closed-vocabulary + idempotent-disposer discipline, but wired to the
 * VALIDATED operation reducer instead of a selection bus.
 *
 * On a source INTENT event carrying the LIVE, ephemeral `leafId`, the
 * interpreter finds the matching edge(s), synthesizes the concrete
 * `LayoutOperation` (computing `expectedParent` via `locateParent`, minting
 * fresh ids for splits), applies it through the EXISTING total reducer
 * `applyOperation`, and hands the new — already validated + deep-frozen — doc
 * to the caller's `commit`/reconcile callback (in the layout-workbench, that
 * callback swaps the session `doc` and kicks `reconcileAndRender`).
 *
 * Discipline inherited from operations.ts + edge-interpreter.ts:
 *
 *   - CLOSED vocabulary. Only 'closesLeaf'/'opensInSplit' emit an op; ANY other
 *     predicate (only reachable via a forged/cast edge) is a no-op — mirrors
 *     edge-interpreter.ts's `default: break`. The edge may emit ONLY a vetted
 *     op, never an invented default.
 *   - TOTAL / never-throws. `applyOperation` is itself total (returns
 *     ok|diagnostic for ANY input shape); a precondition-failing or malformed
 *     fire surfaces the reducer's `Diagnostic` through `onReject` and leaves the
 *     doc UNCHANGED (no half-mutation). The interpreter adds no throwing paths.
 *   - 'apply-as-one-op' batch boundary. `applyOperation` is immutable +
 *     transactional + re-validates INSIDE apply (`finalizeCandidate`), so one
 *     intent -> one op -> one `commit`; the interpreter re-reads `getDoc`
 *     between edges (a first edge's commit is visible to a second) but never
 *     re-enters mid-apply.
 *
 * EPHEMERAL / SESSION-ONLY. Nothing here persists; it drives an in-memory
 * session doc exactly like the layout-workbench's own applyOp -> reconcile
 * cycle. Durable layout is an explicitly-deferred slice — this interpreter has
 * no writer and reads no stored state.
 *
 * Island-clean: imports only the Phase-1 model/reducer through the
 * `@shrubbery/nucleus/layout` barrel — never reimplements tree validation or
 * operation semantics (design §9.2 Phase 2: "consuming the Phase-1
 * LayoutDocument... do NOT reimplement it").
 */

import {
  applyOperation,
  createSophiaHomeDescriptor,
  locateParent,
  type Diagnostic,
  type LayoutDocument,
  type LayoutEdge,
  type LayoutOperation,
  type ParentLocation,
  type ValidateOptions,
} from '@shrubbery/nucleus/layout'

/**
 * A source INTENT event. `from` names WHICH source fired — matched against
 * `LayoutEdge.from`, exactly like edge-interpreter.ts matches `faces[edge.from]`.
 * `leafId` is the LIVE, ephemeral leaf the op acts on, supplied HERE at fire
 * time precisely because the edge cannot store an ephemeral id.
 */
export interface LayoutIntentEvent {
  readonly from: string
  readonly leafId: string
}

/**
 * The one runtime plug point a source exposes: subscribe to its intent stream,
 * get an unsubscribe back (the same onSelect-returns-unsubscribe shape
 * edge-interpreter.ts's `FacePort` uses). A single source multiplexes every
 * intent; the interpreter routes each one by `event.from`.
 */
export interface LayoutIntentSource {
  onIntent(listener: (event: LayoutIntentEvent) => void): () => void
}

/**
 * Mint a fresh node id for a `split_leaf`'s two new nodes. DETERMINISTIC by
 * contract — derived from a counter and/or the triggering event, NEVER
 * `Date.now`/`Math.random` (banned in some contexts; nondeterminism would break
 * the reducer determinism tests). `role` distinguishes the split's own id from
 * its new leaf's id so one `split_leaf` never mints two colliding ids.
 */
export type LayoutIdMinter = (role: 'leaf' | 'split', event: LayoutIntentEvent) => string

/**
 * The default deterministic minter: `layout-edge:<leafId>:<role>:<n>`, where
 * `n` increments once per minted id across the install's lifetime. Namespacing
 * under the event's `leafId` keeps repeated fires on DIFFERENT leaves from
 * colliding; the monotonic `n` keeps repeated fires on the SAME leaf distinct;
 * the `<role>` token keeps a single fire's split id and leaf id distinct. A
 * minted id that nonetheless collides with an existing node is not a crash —
 * the reducer's own `requireFreshId` rejects it as a surfaced diagnostic.
 */
export function createCounterIdMinter(): LayoutIdMinter {
  let n = 0
  return (role, event) => {
    n += 1
    return `layout-edge:${event.leafId}:${role}:${n}`
  }
}

/**
 * The `expectedParent` precondition for `id` in the LIVE doc. `locateParent`
 * returns `null` iff `id` is absent; we fall back to a well-shaped
 * `{ kind: 'root' }` so `decodeOperation` does not preempt the reducer with a
 * generic `LAYOP_MALFORMED_OPERATION` — an absent leaf then earns the reducer's
 * SPECIFIC `LAYOP_NODE_NOT_FOUND` instead (its existence check runs before the
 * parent check). In that absent case the fallback is never actually compared
 * against a real tree, because the op is rejected earlier on existence.
 */
function expectedParentFor(doc: LayoutDocument, id: string): ParentLocation {
  return locateParent(doc, id) ?? { kind: 'root' }
}

/**
 * Map ONE edge + ONE live intent event to a concrete `LayoutOperation` against
 * the CURRENT doc, or `null` for a predicate outside the closed vocabulary (the
 * closed-vocabulary no-op — never an invented default op). This is the entire
 * predicate -> op vocabulary for the slice; every op it emits is a member of
 * operations.ts's closed union and is still fully re-validated by
 * `applyOperation` before anything commits (this function computes
 * preconditions and mints ids; it does NOT itself decide legality).
 */
export function synthesizeLayoutOperation(
  edge: LayoutEdge,
  event: LayoutIntentEvent,
  doc: LayoutDocument,
  mintId: LayoutIdMinter,
): LayoutOperation | null {
  switch (edge.predicate) {
    case 'closesLeaf':
      return {
        op: 'close_leaf',
        leafId: event.leafId,
        expectedParent: expectedParentFor(doc, event.leafId),
      }
    case 'opensInSplit':
      return {
        op: 'split_leaf',
        leafId: event.leafId,
        axis: edge.axis,
        side: edge.side,
        // Ephemeral ids, minted fresh per fire (leaf ids are never durable).
        newLeafId: mintId('leaf', event),
        splitId: mintId('split', event),
        // sophia.home is always registered under the default predicate and
        // takes no face params — the safe descriptor for an opensInSplit demo.
        descriptor: createSophiaHomeDescriptor(),
        expectedParent: expectedParentFor(doc, event.leafId),
      }
    default:
      // Unknown predicate (only reachable via a forged/cast edge) — no op.
      // Never fall through to a default op; closed-vocabulary discipline.
      return null
  }
}

/**
 * A fire the reducer refused: the synthesized op and the `Diagnostic`
 * explaining why (a stale/absent target, a minted-id collision, a malformed
 * shape). The doc was NOT mutated. Surfaced through `onReject`, never thrown.
 */
export interface LayoutEdgeRejection {
  readonly edge: LayoutEdge
  readonly event: LayoutIntentEvent
  readonly operation: LayoutOperation
  readonly diagnostic: Diagnostic
}

export interface InstallLayoutEdgesOptions {
  /**
   * Face-registration/grid predicates forwarded verbatim to `applyOperation`.
   * Default: Phase-1's own allow-list, which registers `sophia.home` — enough
   * for both predicates in this slice. Pass the real registry's predicate once
   * a live shell wires this up.
   */
  readonly validate?: ValidateOptions
  /** Deterministic id source for split ops (default: a fresh counter minter). */
  readonly mintId?: LayoutIdMinter
  /** Notified when the reducer rejects a synthesized op (doc left unchanged). */
  readonly onReject?: (rejection: LayoutEdgeRejection) => void
}

/**
 * Install `edges` over a single intent `source`. On each intent event, every
 * edge whose `from` matches is fired IN ORDER against the CURRENT doc (re-read
 * through `getDoc` before each edge, so a first edge's commit is visible to a
 * second): synthesize -> `applyOperation` -> on ok `commit(result.doc)`, on
 * failure `onReject(...)` and NO commit. An unknown predicate, or an edge with
 * no matching `from`, emits nothing.
 *
 * `commit` is the caller's apply/reconcile callback — the interpreter has
 * already called the reducer, so `commit` receives the new VALIDATED, frozen
 * doc and is responsible only for adopting it (swap session state + reconcile).
 * This is the same shape the layout-workbench's `applyOp` -> `reconcileAndRender`
 * cycle already follows; the interpreter slots into that seam without wiring
 * itself into any live shell here.
 *
 * Returns an idempotent disposer (double-dispose safe) that removes the source
 * subscription — same contract as edge-interpreter.ts (re-install without
 * disposing would leak a listener).
 */
export function installLayoutEdges(
  edges: readonly LayoutEdge[],
  source: LayoutIntentSource,
  getDoc: () => LayoutDocument,
  commit: (doc: LayoutDocument) => void,
  options?: InstallLayoutEdgesOptions,
): () => void {
  const mintId = options?.mintId ?? createCounterIdMinter()
  const validate = options?.validate
  const onReject = options?.onReject

  const unsubscribe = source.onIntent((event) => {
    for (const edge of edges) {
      if (edge.from !== event.from) continue
      // One snapshot per edge: synthesize and apply read the SAME doc, and the
      // next edge re-reads to observe this edge's commit. This is the
      // apply-as-one-op boundary — no re-entry mid-apply.
      const doc = getDoc()
      const operation = synthesizeLayoutOperation(edge, event, doc, mintId)
      if (operation === null) continue
      const result = applyOperation(doc, operation, validate)
      if (result.ok) {
        commit(result.doc)
      } else {
        onReject?.({ edge, event, operation, diagnostic: result.diagnostic })
      }
    }
  })

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
  }
}
