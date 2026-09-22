/**
 * layout-edge.ts — the LAYOUT-MUTATING EDGE model, native to the
 * LayoutDocument world (design §2.4's operation union), NOT the old face:*
 * `ConfigEdge` (that overlay is selection-only, on the WorkspaceConfig
 * id-space, driven by a different engine). A `LayoutEdge` binds ONE source
 * intent (`from`) to ONE layout-op predicate from a CLOSED vocabulary,
 * carrying only what is STABLE at author time.
 *
 * The op's live TARGET — a leaf id — is deliberately NOT stored on the edge:
 * leaf ids are EPHEMERAL (minted per `split_leaf`, gone on `close_leaf`), so an
 * edge cannot name one durably. The edge carries the STABLE binding ("this
 * intent maps to this op, with this axis/side"); the intent EVENT (fire time,
 * see layout-edge-interpreter.ts in @shrubbery/runtime) carries the LIVE
 * `leafId` the op actually touches. Same nucleus-model / runtime-interpreter
 * split the `ConfigEdge` subsystem already uses (nucleus holds `ConfigEdge`;
 * runtime holds `installEdgeInterpreter`).
 *
 * CLOSED predicate vocabulary (this slice) — the interpreter maps each to
 * exactly one member of operations.ts's closed `LayoutOperation` union and
 * NEVER invents a default op for anything else (mirrors `ConfigEdge`'s closed
 * predicate set and edge-interpreter.ts's `default: break`):
 *
 *   - 'closesLeaf'   -> close_leaf : needs only the live `leafId` (from the
 *                                    event) and its `expectedParent` (computed
 *                                    from the live doc via `locateParent` at
 *                                    fire time) — nothing stable to store here.
 *   - 'opensInSplit' -> split_leaf : opens a FRESH `sophia.home` leaf beside the
 *                                    live `leafId`. `axis`/`side` ARE stable at
 *                                    author time and live on the edge; the
 *                                    minted ids + `expectedParent` are computed
 *                                    at fire time.
 *
 * EPHEMERAL / SESSION-ONLY: like the `LayoutDocument` it mutates, a
 * `LayoutEdge` is in-memory only. Nothing here persists — there is no writer
 * for edges any more than there is one for the document (`ux:layoutJson` is
 * read-only). Durable layout, and durable edges, are an explicitly-deferred
 * future slice; do not read this as a persistence surface.
 *
 * Pure DATA: no DOM, no stores, no dependency on the runtime interpreter — this
 * is the authorable shape only.
 */

import type { Axis } from './types.js'
import type { Side } from './operations.js'

/** The CLOSED layout-op predicate vocabulary for this slice (see file header). */
export type LayoutEdgePredicate = 'closesLeaf' | 'opensInSplit'

/**
 * 'closesLeaf' -> close_leaf. Carries nothing beyond the binding itself:
 * close_leaf needs only the live `leafId` (from the event) and its
 * `expectedParent` (computed from the live doc at fire time) — neither is
 * stable at author time, so neither is stored.
 */
export interface CloseLeafEdge {
  readonly from: string
  readonly predicate: 'closesLeaf'
}

/**
 * 'opensInSplit' -> split_leaf opening a fresh `sophia.home` leaf. `axis`/`side`
 * describe the new split's orientation and which side the new leaf lands on —
 * both STABLE at author time, so both live on the edge. The live `leafId`, the
 * two minted ids, and `expectedParent` are all supplied/computed at fire time.
 */
export interface OpenInSplitEdge {
  readonly from: string
  readonly predicate: 'opensInSplit'
  readonly axis: Axis
  readonly side: Side
}

/**
 * The CLOSED `LayoutEdge` union — the security/shape boundary BY SHAPE (same
 * discipline as `LayoutOperation` itself): a caller can only author one of the
 * vetted predicate bindings, never an arbitrary op payload. An edge whose
 * `predicate` is outside this union (only reachable via a forged, cast value)
 * is a no-op in the interpreter — it never emits an op.
 */
export type LayoutEdge = CloseLeafEdge | OpenInSplitEdge
