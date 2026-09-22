/**
 * editor-host-binding.ts — the ReactiveSource seam the live Class-B editor host
 * consumes (SE3 of the editor-host milestone).
 *
 * This is the EDITOR's slice of the four hard couplings the frontend audit named.
 * It declares the fields the host actually consumes:
 *   - `centerMode` (which center is anchored), `graphId`/`documentId` (the open
 *     doc, null when nothing is open), and the load `status`/`error` — what the
 *     honest labelled placeholder reflects (the no-binding/error/loading states);
 *   - `provider` (rung-3, NOW DUE): the opened CRDT room — a `ProviderHandle`
 *     bundling the shared doc, awareness, live lifecycle, `whenRenderable`,
 *     `whenEditable`, and `whenSynced`. This is the ONE
 *     member the live ProseMirror body consumes to compose @tiptap/extension-
 *     collaboration. It is `null` when nothing is open (home/idle). It is the
 *     contract.crdt `ProviderHandle` the SHELL injects (a shell's crdt-backend
 *     open(room, doc) return) — not a faked field, and not a raw concrete doc (the
 *     opaque `CrdtDoc` inside it is the shell's concern; the host resolves it to a
 *     concrete shared-doc INSIDE its collab module, never here).
 *
 * Why `ProviderHandle` and not separate sharedDoc+awareness+undoManager fields: the
 * contract already bundles
 * `{ doc, awareness, lifecycle, whenRenderable, whenEditable, whenSynced, destroy() }` in one
 * type — exactly the plane the shell hands over and the live body consumes. The
 * lifted-UndoManager-survives-remount concern (garden keyed it by
 * graphId:docId:paneRole through a store) is a SHELL concern owned upstream of
 * this binding, not a binding field — the host just feeds the ProviderHandle.doc
 * to Collaboration.
 *
 * PLACEMENT: this file lives at the TOP LEVEL of packages/runtime/src so the
 * island guard (render-workspace-island.test.ts, non-recursive readdirSync)
 * SCANS it — proving it imports only lit + @shrubbery/nucleus and carries no
 * forbidden coupling token. A subdir would evade the scan; we honor it instead.
 *
 * NAMING: `EditorHostBinding` / `EditorHostState` are collision-safe (the bare
 * `Context` / `EditorContext` / `context.ts` names are forbidden — `context.ts`
 * already exists in @shrubbery/render as the JSON-LD @context vocabulary). The
 * binding is a `ReactiveSource` (D4), NOT @lit/context.
 *
 * Dependency: a TYPE-ONLY import of ReactiveSource + StoreStatus from
 * @shrubbery/nucleus. ReactiveSource/EditorHostBinding/EditorHostState are NOT
 * in the island guard's forbidden-token list; @shrubbery/nucleus is an allowed
 * import. StoreStatus is REUSED (not re-inlined) so the canonical 4-member union
 * is the single source of truth across the store layer and the editor host.
 */

import type { ReactiveSource, StoreStatus, ProviderHandle } from '@shrubbery/nucleus'

/**
 * What the live editor host READS to render its placeholder body.
 *
 * Only the honest-placeholder-reflectable fields. Mirrors the garden host's
 * home|document|artifact center modes; `status` reuses the canonical StoreStatus
 * 4-member union (consistency with the store layer — same source of truth).
 *
 * `graphId`/`documentId` are null when nothing is open (home mode) — never faked.
 * `error` carries the verbatim message when status==='error'.
 */
export interface EditorHostState {
  /** Which center the editor is showing — home (nothing open) | document | artifact. */
  readonly centerMode: 'home' | 'document' | 'artifact'
  /** The open document/artifact's graph, or null when nothing is open. */
  readonly graphId: string | null
  /** The open document/artifact's id, or null when nothing is open. */
  readonly documentId: string | null
  /** The load status — the canonical StoreStatus union. */
  readonly status: StoreStatus
  /** The verbatim error message when status==='error', else null. */
  readonly error: string | null
  /**
   * The opened CRDT room the live editor body binds to, or null when nothing is
   * open (home/idle, or a center that has no doc). The contract.crdt
   * `ProviderHandle` —
   * `{ doc, awareness, lifecycle, whenRenderable, whenEditable, whenSynced, destroy() }`. The host
   * composes the collaboration plane over `provider.doc` (resolved to a
   * concrete shared-doc inside the host's collab module), gates first init on
   * `provider.whenRenderable`, gates editing on `provider.whenEditable`, and reads
   * `provider.awareness` for the optional cursor
   * plane. NULL until a shell opens a room — never faked.
   */
  readonly provider: ProviderHandle | null
}

/**
 * The injected reactive seam the host consumes (D4 — ReactiveSource, never
 * @lit/context). get()/subscribe(): the shell adapts its session-store via
 * `asReactiveStore` at the boundary; the host imports NO store/contract/CRDT.
 *
 * NOTE the ReactiveSource contract mandates only get()/subscribe(); a concrete
 * binding the shell (or a test) drives may ALSO expose a set()/refresh(), but
 * those are not part of the consumed surface — the host only ever reads.
 */
export type EditorHostBinding = ReactiveSource<EditorHostState>

/**
 * The null/default EditorHostState a shell (or test) can seed a binding with
 * before a document is selected: home mode, nothing open, idle. An honest inert
 * default — NOT fake content.
 */
export const NULL_EDITOR_HOST_STATE: EditorHostState = Object.freeze({
  centerMode: 'home',
  graphId: null,
  documentId: null,
  status: 'idle',
  error: null,
  provider: null,
})
