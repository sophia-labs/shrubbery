/**
 * layout-persister.ts — the SERIALIZED persist-on-mutation discipline, lifted
 * out of `durable-layout-session.ts` into a small reusable, unit-testable unit
 * so a LIVE browser mount (the hosted observatory) can persist its layout
 * mutations without re-implementing the promise-chain and failure-surfacing
 * rules inside the boot.
 *
 * It composes exactly ONE primitive — `persistLayoutDocument`
 * (`observatory-layout-sink.ts`), the durable one-shot DELETE+INSERT
 * `sparql_update` — and adds only the sequencing + honesty discipline the sink
 * itself is deliberately free of:
 *   - SERIALIZED on a single promise chain (mirroring the layout-workbench
 *     `reconcileQueue` and the durable session's own chain): two rapid
 *     `persist()` calls write in FIRE ORDER, so the store lands on the final doc
 *     — never a last-writer-wins race between two overlapping in-flight writes.
 *   - Persist failure is NEVER swallowed (the repo forbids silent fallbacks): a
 *     rejected write surfaces through `onError` AND a rejecting `whenSettled()`.
 *     The caller's in-memory doc is NOT this unit's concern — it swaps
 *     optimistically upstream; durability, not the swap, is what a failed write
 *     loses, and the caller is told.
 *
 * Honest scope (inherited verbatim from the sink): DURABLE, not CRDT. Each
 * `persist()` serializes the WHOLE document and replaces the previous literal
 * wholesale. "Durable" means the same document loads back after a reload — no
 * merge, no operational transform, no conflict resolution. Not debounced here
 * (the caller may debounce upstream of `persist`); every call is one durable
 * write, serialized after the previous one.
 *
 * Island-clean: the only seam to the outside is the contract's `RestClient`
 * (its `update()`), reached solely through `persistLayoutDocument`, so this unit
 * can never drift onto a predicate/graph the reader does not query.
 */
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { persistLayoutDocument, type LayoutPersistTarget } from './observatory-layout-sink.js'

export interface CreateLayoutPersisterOptions {
  /** The contract write seam — `update()` applies the durable DELETE+INSERT. Must be a WRITABLE client. */
  readonly rest: RestClient
  /** The cell graph whose `:ux:config` slot the layout literal lives in. */
  readonly graphId: string
  /** The surface subject the `ux:layoutJson` triple hangs off (defaults to the observatory surface). */
  readonly surfaceIri?: string
  /**
   * Notified when a durable persist REJECTS. Never swallowed: `whenSettled()`
   * also rejects. `doc` is the document whose persist failed.
   */
  readonly onError?: (error: unknown, doc: LayoutDocument) => void
}

export interface LayoutPersister {
  /**
   * Enqueue a durable persist of `doc` behind every persist enqueued before it.
   * Fire-and-forget by design (returns void): the caller awaits durability via
   * `whenSettled()` when it needs to, exactly as the divider chrome kicks off
   * `reconcileAndRender()` without blocking the pointer move.
   */
  persist(doc: LayoutDocument): void
  /**
   * Resolves when the most-recently-enqueued persist (and therefore every
   * persist before it, since they are serialized) has SETTLED; REJECTS if that
   * persist failed. For deterministic tests and for a caller that wants to await
   * durability after a mutation.
   */
  whenSettled(): Promise<void>
}

/**
 * Build a persister that serializes durable writes on a single promise chain and
 * surfaces failures. See the module header for the durability model and its
 * honest limits.
 */
export function createLayoutPersister(opts: CreateLayoutPersisterOptions): LayoutPersister {
  const { rest, graphId, surfaceIri, onError } = opts
  const target: LayoutPersistTarget = { graphId, surfaceIri }

  // `tail` is the strictly-sequential gate every persist chains after — it
  // always resolves (its `.catch` swallows so a failed write never STALLS the
  // chain and blocks later writes). `pending` reflects the OUTCOME of the most
  // recently enqueued persist (it rejects on failure) — that's what
  // `whenSettled()` hands back, so a failure genuinely surfaces there.
  let tail: Promise<void> = Promise.resolve()
  let pending: Promise<void> = Promise.resolve()

  function persist(doc: LayoutDocument): void {
    const settled = tail.then(() => persistLayoutDocument(rest, target, doc))
    pending = settled
    // Keep the serialization gate alive regardless of THIS write's outcome, and
    // route a failure to `onError`. This `.catch` also attaches a handler
    // synchronously, so a rejected persist is never an unhandled rejection even
    // if nobody awaits `whenSettled()`.
    tail = settled.catch((error) => {
      onError?.(error, doc)
    })
  }

  return {
    persist,
    whenSettled: () => pending,
  }
}
