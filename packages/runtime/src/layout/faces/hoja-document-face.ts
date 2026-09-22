/**
 * hoja-document-face.ts — the `hoja.document` face (design doc §7.4, §9.1
 * "Proving leaf A"; Builder-2 task brief item (a)).
 *
 * Wraps the PRODUCTION `<sh-editor-host>` + `EditorRoomPool` — real per-leaf
 * `EditorView`/selection, one shared provider/Y.Doc/awareness per document key
 * (design §4.1: "The generic ResourceBroker SHOULD initially wrap this proven
 * pool for hoja.document, not replace it").
 *
 * Two-tier lifetime, concretely:
 *   - AUTHORITATIVE resource = `EditorRoomLease` (this module's
 *     `DurableResourceAdapter<EditorRoomLease>` T). `load()` is a thin
 *     delegation to `pool.acquire(room, resourceKey)` — ONE pool attachment
 *     per resourceKey, because the broker's OWN ref-count (resource-
 *     broker.ts) already dedupes concurrent layout leases of the same key and
 *     calls `load()` exactly once per key; `dispose()` is `value.release()`.
 *     This is composition ON TOP OF the pool, never a second refcount
 *     implementation (resource-broker.ts's own header comment names this
 *     exact split).
 *   - EPHEMERAL view = one `<sh-editor-host layout-mode="contained">` per
 *     leaf/`FaceView`, each with its OWN imperative TipTap `EditorView` +
 *     local selection, bound (via a tiny static `ReactiveSource`) to the SAME
 *     `ProviderHandle` object every concurrent leaseholder of that key holds
 *     — "two leaves on the same document share one exact provider; each leaf
 *     has a distinct EditorView and local selection" (design §9.1).
 *
 * `layoutMode = 'contained'` is the host's OWN pre-existing escape from its
 * historical floating/measured-anchor positioning (editor-host.ts's own
 * `:host([layout-mode='contained'])` rule: fills the parent at 0/0/100%/100%)
 * — exactly what lets several independent hosts live inside the split tree's
 * per-leaf wrappers without a document-global anchor id.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { ReactiveSource } from '@shrubbery/nucleus'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostBinding,
  type EditorHostState,
} from '../../editor-host-binding.js'
import type {
  EditorContentChange,
  EditorContentSubscribeOptions,
  LiveDocumentJSON,
  ShEditorHost,
} from '../../editor-host.js'
// Side-effect import: registers the <sh-editor-host> custom element (mirrors
// mount.ts's own `import './editor-host.js'`).
import '../../editor-host.js'
import { type EditorRoomLease, type EditorRoomPool } from '../../collab/editor-room-pool.js'
import { noFaceParams, type DurableResourceAdapter, type FaceRegistration, type FaceView, type LeafConstraints, type ResourceKey } from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const HOJA_DOCUMENT_FACE_ID = 'hoja.document'

/**
 * W14.1 — the lossless read of ONE mounted `hoja.document` leaf, exposed on the
 * leaf's `FaceView` so a controller OUTSIDE the face can consume it.
 *
 * WHY THE FACE VIEW, and not the room pool or the resource lease:
 *   - the pool is content-free by charter. It owns room IDENTITY (one
 *     `ProviderHandle`/`Y.Doc`/awareness per document key) and knows nothing
 *     about ProseMirror. Reading a document there would mean re-deriving JSON
 *     from the Y.Doc (`yDocToProsemirrorJSON` at the collab field name) — the
 *     escape hatch, and a second, drifting implementation of a binding
 *     `<sh-editor-host>` already owns;
 *   - the pool is also the WRONG GRAIN: one lease is shared by every leaf on
 *     that document, while "the document this pane is showing" is exactly a
 *     per-leaf question — and a workbench controller watches a pane;
 *   - `LayoutInterpreter.mountedView(leafId)` is the supported, already-shipped
 *     route from a layout node id to its live view, so a controller that knows
 *     which leaf holds the constitution can reach this port with no new
 *     plumbing and no `querySelector` archaeology.
 *
 * Exposed HERE ONLY (W14.1: "on `FaceView` or on the controller's handle, not
 * both"). The port is a pure read + subscription; every side effect stays with
 * the host and whatever owns the controller.
 */
export interface HojaDocumentContentPort {
  /** The pane's document as TipTap JSON, or null when its body is not live yet. */
  getJSON(): LiveDocumentJSON | null
  /** Debounced, content-coalesced change notifications. Returns an unsubscribe. */
  onChanged(
    listener: (change: EditorContentChange) => void,
    options?: EditorContentSubscribeOptions,
  ): () => void
}

/**
 * The `FaceView` this face returns — a plain `FaceView` widened with `content`.
 * The generic `FaceView` type is deliberately NOT widened: content exposure is
 * this face's capability, not every face's.
 */
export interface HojaDocumentFaceView extends FaceView {
  readonly content: HojaDocumentContentPort
}

/**
 * Narrow an arbitrary `FaceView` (e.g. whatever `LayoutInterpreter.mountedView`
 * returns for a leaf id) to one that exposes W14.1's content port — `null` when
 * the leaf holds some other face. A structural check, so it stays correct if a
 * second face ever grows the same capability.
 */
export function hojaDocumentContentPort(
  view: FaceView | null | undefined,
): HojaDocumentContentPort | null {
  const candidate = (view as HojaDocumentFaceView | null | undefined)?.content
  if (!candidate) return null
  return typeof candidate.getJSON === 'function' && typeof candidate.onChanged === 'function'
    ? candidate
    : null
}

/** A `ReactiveSource` whose value never changes after construction — the whole
 * point of the two-tier split: the resource lease (and its `ProviderHandle`)
 * is already live and stable by the time `mount()` builds this; the host's
 * own imperative collab plane (not this binding) is what evolves after that. */
function staticSource<T>(value: T): ReactiveSource<T> {
  return {
    get: () => value,
    subscribe: () => () => {},
  }
}

function documentResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'document') {
    throw new Error(`hoja.document: resource adapter given a non-document locator (kind '${locator.kind}')`)
  }
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('document', locator.graphId, locator.documentId)
}

/**
 * F1 fix (repair round 3) — a MODULE-level (not per-adapter-instance)
 * monotonic counter that seeds every pool attachment id this face ever
 * mints, across every `createHojaDocumentResourceAdapter(...)` call.
 *
 * Why module-level, not a closure-local counter reset to 0 per adapter
 * instance: two independent `LayoutResourceBroker`s can each register their
 * OWN `createHojaDocumentResourceAdapter(pool)` instance against the SAME
 * shared `EditorRoomPool` (F1's required "two brokers sharing one
 * EditorRoomPool on the same document" proof). A closure-local counter would
 * start both adapters' sequences at 0, so the FIRST `load()` on each would
 * both mint attachment id `<key>#0` for the identical document key — a
 * pool-level collision no less real than the reacquire race this fix
 * targets. A single counter shared by the whole module guarantees every
 * attachment id minted by ANY `hoja.document` adapter instance, against ANY
 * pool, is unique for the lifetime of this module.
 */
let nextHojaAttachmentSeq = 0

/**
 * The durable-resource half: a thin delegation to `pool.acquire`/lease-
 * `.release()`. `load` runs once per resourceKey (the broker's own guarantee,
 * resource-broker.ts), so ONE pool attachment — keyed deterministically by the
 * resourceKey itself — exists per live document key regardless of how many
 * leaves reference it.
 *
 * The pool ATTACHMENT id itself, however, is intentionally NOT that
 * deterministic key — see `nextHojaAttachmentSeq`'s doc comment and the
 * comment on `load()` below for why.
 */
export function createHojaDocumentResourceAdapter(pool: EditorRoomPool): DurableResourceAdapter<EditorRoomLease> {
  return {
    adapterId: 'hoja.document.room-pool',
    shape: 'durable',
    accepts: (locator) => locator.kind === 'document',
    resourceKey: documentResourceKey,
    async load(locator) {
      const key = documentResourceKey(locator)
      if (locator.kind !== 'document') throw new Error('unreachable: resourceKey already validated the kind')
      // F1 fix (repair round 3): mint a FRESH attachment id per `load()`
      // call, never the bare canonical `key`.
      //
      // `resource-broker.ts`'s `acquireDurable` dedupes concurrent
      // `acquire()`s of the SAME broker key against `pendingLoads`/
      // `durableEntries`, so `load()` runs exactly once per outstanding
      // broker entry — but `release()` deletes that broker entry
      // SYNCHRONOUSLY while the actual disposal call (`adapter.dispose` →
      // `value.release()` → `pool.release`) is deferred one microtask via
      // `runDisposal`. A caller that releases a lease and immediately
      // re-acquires the SAME document locator (e.g. a leaf reload/remount
      // driven by the interpreter) reaches this `load()` again BEFORE that
      // deferred pool-level release has run. Previously this passed the bare
      // canonical `key` straight through as `pool.acquire`'s `attachmentId`
      // — a value reused byte-for-byte across every load of that document —
      // so the still-live PREVIOUS attachment collided with the new one and
      // `EditorRoomPool.acquire` (editor-room-pool.ts:124) threw `attachment
      // "..." is already live`. Reproduced by hoja-document-face.test.ts's
      // "release then immediately reacquire the same document key" test
      // before this fix.
      //
      // Fix: append a module-shared monotonic sequence number so two
      // overlapping claims on the same document never collide at the pool's
      // attachment layer, while the FIRST argument to `pool.acquire` — the
      // room locator (`kind`/`graphId`/`docId`) — stays the canonical,
      // unchanged document identity, so both claims still resolve to the
      // exact SAME `CrdtRoom`/`ProviderHandle` (`editorRoomKey` never sees
      // the attachment id). Retains "canonical room identity" per the repair
      // brief; only the per-claim attachment identity is made unique.
      const attachmentId = `${key}#${nextHojaAttachmentSeq++}`
      return pool.acquire({ kind: 'doc', graphId: locator.graphId, docId: locator.documentId }, attachmentId)
    },
    dispose(value) {
      value.release()
    },
  }
}

/** Leaf sizing for a document editor: real minimums, and CLIP — `.editor-mount`
 * inside `<sh-editor-host>` already owns its own internal `overflow:auto`, so
 * the interpreter's wrapper must not ALSO scroll (double scrollbars). */
function hojaDocumentConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 160, overflow: 'clip' }
}

/**
 * The `hoja.document` `FaceRegistration`. `mount()` creates ONE fresh
 * `<sh-editor-host>` per call (per leaf) — never reused across leaves/leases —
 * and feeds it a static binding whose `provider` is the shared
 * `EditorRoomLease.provider` the resource adapter above resolved.
 */
export function createHojaDocumentFace(): FaceRegistration {
  return {
    faceId: HOJA_DOCUMENT_FACE_ID,
    // Real caret/selection/local-history-lease state that MUST survive
    // ratio/axis/focus/move/swap (design §7.4's catalog table + §4.2's
    // "a real-browser identity test is a release gate").
    persistence: 'persistent-relocatable',
    // Binds this face to the EXACT registered adapter it expects — see
    // createHojaDocumentResourceAdapter's own `adapterId` above (diff-review
    // r2 WRONG: "the broker silently selects the first adapter whose
    // accepts() returns true").
    resourceAdapterId: 'hoja.document.room-pool',
    accepts: (locator) => locator.kind === 'document',
    // v1 takes no params (design guard rail: no open escape hatch by default).
    paramsSchema: noFaceParams,
    constraints: hojaDocumentConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      if (descriptor.resource.kind !== 'document') {
        throw new Error(`hoja.document: unexpected resource kind '${descriptor.resource.kind}'`)
      }
      const { graphId, documentId } = descriptor.resource
      const roomLease = lease.value as EditorRoomLease

      const host = document.createElement('sh-editor-host') as ShEditorHost
      host.layoutMode = 'contained'
      // Starts inactive; FaceView.focus() below flips it true. Only the
      // active pane should consume document-level editor keyboard shortcuts
      // (editor-host.ts's own `paneActive` contract).
      host.paneActive = false

      const state: EditorHostState = {
        ...NULL_EDITOR_HOST_STATE,
        centerMode: 'document',
        graphId,
        documentId,
        status: 'ready',
        // The exact SAME ProviderHandle object every concurrent leaseholder
        // of this resourceKey holds (design §9.1's shared-provider proof).
        provider: roomLease.provider,
      }
      const binding: EditorHostBinding = staticSource(state)
      host.binding = binding

      target.replaceChildren(host)

      const proseMirrorEl = (): HTMLElement | null =>
        host.shadowRoot?.querySelector<HTMLElement>('.editor-mount .ProseMirror') ?? null

      let disposed = false
      // W14.1 — every subscription this port hands out, so `dispose()` can
      // guarantee no leaf keeps notifying a controller after its pane is gone
      // (the host element is removed on dispose, but a caller that never
      // unsubscribed would otherwise hold a live reference to it).
      const contentUnsubscribes = new Set<() => void>()
      const content: HojaDocumentContentPort = {
        getJSON: () => host.getDocumentJSON(),
        onChanged: (listener, options) => {
          if (disposed) return () => {}
          const unsubscribe = host.onDocumentContentChanged(listener, options)
          const wrapped = (): void => {
            contentUnsubscribes.delete(wrapped)
            unsubscribe()
          }
          contentUnsubscribes.add(wrapped)
          return wrapped
        },
      }

      const view: HojaDocumentFaceView = {
        content,
        focus(_request) {
          host.paneActive = true
          const pm = proseMirrorEl()
          if (!pm) return false // editor body not live yet (still awaiting provider.whenRenderable) — honest false, not a fake success
          pm.focus()
          return true
        },
        blur() {
          host.paneActive = false
          proseMirrorEl()?.blur()
        },
        resize() {
          // layout-mode="contained" fills the wrapper purely via CSS
          // (`:host([layout-mode='contained'])`); the interpreter already
          // sized `target` before calling this. MUST NOT write layout state
          // (design §3.2) — intentionally a no-op.
        },
        serialize(): ViewDescriptor {
          // v1 has no locally-drifting params (no zoom-block/mode posture is
          // tracked outside the descriptor yet) — the mount-time descriptor
          // IS the current durable intent (design §3.2: "returns a validated
          // descriptor, not ephemeral state").
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          // Drop content subscriptions BEFORE the element goes: a subscriber
          // must not be told about the pane it no longer has.
          for (const unsubscribe of [...contentUnsubscribes]) unsubscribe()
          contentUnsubscribes.clear()
          // Removing the element runs its disconnectedCallback, which tears
          // down the live EditorView/listeners (editor-host.ts's own
          // `_teardownEditor`). This releases the VIEW only — the resource
          // LEASE is released by the interpreter after this resolves.
          host.remove()
        },
      }
      return view
    },
  }
}
