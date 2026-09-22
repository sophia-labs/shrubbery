/**
 * doc-history-face.ts — the `doc.history` face (Wave 1, north star §2.2/§3:
 * "Elevate the 5 trapped faces... Start with doc-history beside the live
 * document it diffs").
 *
 * LIVE-VS-DERIVED VERDICT (north star §2.1's open Q4/Q5 for doc-history):
 * DERIVED. `mn-doc-history-panel` itself is a fully controlled, IO-free Lit
 * element (`packages/components/src/mn-doc-history-panel.ts` header: "all IO
 * and restore work are shell-owned props/events") — it never subscribes to
 * anything. Its REAL production data source, `apps/organism/src/main.ts`'s
 * `loadDocHistorySurface`/`refreshDocHistoryDiff`, is a genuine, non-mocked
 * REST round-trip (`GET /v1/documents/{graphId}/{documentId}/snapshots` +
 * `.../count` + `.../{id}/text|html`, `POST`/`DELETE` for
 * save/bookmark/delete) against the real gardend cell — but it is a
 * fetch-on-demand, explicitly-refetchable query (a "Refresh" button, a cursor
 * change re-running the diff), never a subscribed/streaming resource the way
 * `hoja.document`'s Y.Doc room is. That is exactly the north star's own
 * DERIVED definition ("computed/refetchable... history/diff" clusters here
 * by name in §2.1). The data is 100% real, live production data; the
 * RESOURCE SHAPE is derived, not durable-shared.
 *
 * Given that verdict this face's resource adapter is `derived` in spirit —
 * `compute()` hands back an UN-RUN handle (mirrors
 * `query-handle-resource-adapter.ts`'s "the CALLER decides cadence" design),
 * never a resolved snapshot list — but it is registered with `shape:
 * 'durable'` for ONE concrete, load-bearing reason: the "live (now)" side of
 * every diff needs to read the SAME document's CURRENT text, and the only
 * non-duplicative way to do that is to share `hoja.document`'s own
 * `EditorRoomPool` room (design's proven "two leaves on the same document
 * share one exact provider" mechanism) rather than re-deriving Y.Doc text
 * extraction here (which would be exactly the kind of parallel
 * implementation this wave's mount-not-rewrite rule forbids — `Editor.
 * getText()`/`restoreHtml()` already exist on `LiveEditorHandle` and are
 * reused verbatim). A pool room is a durable, ref-counted, shared resource by
 * construction, so this adapter's `load()` acquires one (its OWN pool
 * attachment, namespaced under this face's own `adapterId` — see
 * `resource-broker.ts`'s per-adapter key namespacing) alongside the
 * (stateless, non-cached) `DocumentSnapshotService`. Every snapshot
 * list/diff/save/bookmark/delete call inside `mount()` is still a fresh REST
 * round-trip each time it runs — the DERIVED verdict above describes the
 * SNAPSHOT DATA's own refetch semantics, which nothing about the durable
 * pool-room plumbing changes.
 *
 * WRAPS THE REAL `mn-doc-history-panel` (`@shrubbery/components`) — today
 * mounted ONLY as `render-workspace.ts`'s `position:fixed inset:0
 * z-index:9000` modal takeover (`renderDocHistoryOverlay`). This face is a
 * CHANGE OF MOUNT, not a rewrite: `mount()` below drives the exact same
 * component through the exact same property/event contract
 * `renderDocHistoryOverlay` already uses (this file's own `DocHistory*`
 * types are `render-workspace.ts`'s own re-exported types, a same-package
 * sibling import, not a redeclaration) — just imperatively, inside a leaf
 * wrapper, with `showClose=false` (a leaf has no "close the overlay"
 * concept; closing a LEAF is a shell/chrome `close_leaf` operation this face
 * has no channel to request — design: "chrome is shell-owned"). `packages/
 * runtime` cannot depend on `@shrubbery/components` (see `media-face.ts`'s
 * own header) so, exactly like `render-workspace.ts` itself already does,
 * this file never statically imports the component's class — it creates the
 * element by TAG NAME and drives it through a locally-typed property bag,
 * relying on the SAME real custom-element registration every other consumer
 * of `@shrubbery/components` already triggers.
 *
 * DESTRUCTIVE-ACTION PARITY (wave1 review r1 WRONG fix): the ONE place this
 * used to genuinely fall short of "same mount, same behavior" — production's
 * `main.ts` gates BOTH delete and restore behind `confirmAction(...)`; this
 * file's `mn-doc-history-delete`/`mn-doc-history-restore` handlers used to
 * run the REST call straight off the raw component event, with no
 * confirmation at all. Fixed via a REQUIRED `confirmDialog` dependency (see
 * `createDocHistoryFace`'s own doc comment) — the transport hoist itself
 * (`document-snapshot-service.ts`) is unchanged; only the missing safety
 * rail is added.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { ReactiveSource } from '@shrubbery/nucleus'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostBinding,
  type EditorHostState,
} from '../../editor-host-binding.js'
import type { ShEditorHost } from '../../editor-host.js'
// Side-effect import: registers the <sh-editor-host> custom element (the
// hidden companion host this face mounts for live-text/restore access).
import '../../editor-host.js'
import { type EditorRoomLease, type EditorRoomPool } from '../../collab/editor-room-pool.js'
import type {
  DocHistoryCursorDetail,
  DocHistoryDiffStyle,
  DocHistoryDiffStyleDetail,
  DocHistoryFocusedSide,
  DocHistoryRestoreDetail,
  DocHistorySnapshot,
  DocHistorySnapshotDetail,
  DocHistoryStatus,
} from '../../render-workspace.js'
import type { DocumentSnapshotService } from '../../editor-services/document-snapshot-service.js'
import {
  closedParamsSchema,
  type DurableResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'

export const DOC_HISTORY_FACE_ID = 'doc.history'
export const DOC_HISTORY_RESOURCE_ADAPTER_ID = 'doc.history.snapshot-service'

export interface DocHistoryParams {
  /** Caps `DocumentSnapshotService.list`'s page size; default 200 (organism's own production default). */
  readonly snapshotLimit?: number
}

/** The durable, broker-shared resource `doc.history`'s adapter loads once per (graphId, documentId). */
export interface DocHistoryRoomResource {
  readonly roomLease: EditorRoomLease
  readonly snapshots: DocumentSnapshotService
  readonly graphId: string
  readonly documentId: string
}

function staticSource<T>(value: T): ReactiveSource<T> {
  return {
    get: () => value,
    subscribe: () => () => {},
  }
}

function documentResourceKey(locator: ResourceLocator): ResourceKey {
  if (locator.kind !== 'document') {
    throw new Error(`doc.history: resource adapter given a non-document locator (kind '${locator.kind}')`)
  }
  return resourceKeyTuple('document', locator.graphId, locator.documentId)
}

/** Module-level monotonic seq, mirrors `hoja-document-face.ts`'s own `nextHojaAttachmentSeq` — a fresh pool attachment id per `load()`, never the bare canonical key (see that file's header for the reacquire-race this avoids). */
let nextDocHistoryAttachmentSeq = 0

export function createDocHistoryResourceAdapter(
  pool: EditorRoomPool,
  snapshots: DocumentSnapshotService,
): DurableResourceAdapter<DocHistoryRoomResource> {
  return {
    adapterId: DOC_HISTORY_RESOURCE_ADAPTER_ID,
    shape: 'durable',
    accepts: (locator) => locator.kind === 'document',
    resourceKey: documentResourceKey,
    async load(locator) {
      if (locator.kind !== 'document') throw new Error('unreachable: resourceKey already validated the kind')
      const key = documentResourceKey(locator)
      const attachmentId = `${key}#dh#${nextDocHistoryAttachmentSeq++}`
      const roomLease = await pool.acquire({ kind: 'doc', graphId: locator.graphId, docId: locator.documentId }, attachmentId)
      return { roomLease, snapshots, graphId: locator.graphId, documentId: locator.documentId }
    },
    dispose(value) {
      value.roomLease.release()
    },
  }
}

function docHistoryConstraints(): LeafConstraints {
  // The panel owns its own internal `.rail-list`/`.diff-host` overflow:auto —
  // 'clip' avoids a redundant outer scrollbar, same reasoning as
  // hoja-document-face.ts's own constraints.
  return { minWidth: 320, minHeight: 220, overflow: 'clip' }
}

function snapshotLimitFromParams(descriptor: ViewDescriptor): number {
  const params = descriptor.params as DocHistoryParams | undefined
  const requested = params?.snapshotLimit
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 200
  return Math.max(1, Math.min(500, Math.trunc(requested)))
}

/** Minimal, mutable controller state for one mounted `doc.history` FaceView — the leaf-scoped analogue of `apps/organism/src/main.ts`'s module-global `currentDocHistorySurface` (necessarily per-instance here: multiple `doc.history` leaves, possibly over different documents, coexist). */
interface DocHistoryViewState {
  status: DocHistoryStatus
  error: string
  snapshots: readonly DocHistorySnapshot[]
  olderId: string
  newerId: string
  focusedSide: DocHistoryFocusedSide
  olderText: string
  newerText: string
  diffStatus: DocHistoryStatus
  diffError: string
  diffStyle: DocHistoryDiffStyle
  restoreBusy: boolean
}

function initialState(liveText: string): DocHistoryViewState {
  return {
    status: 'loading',
    error: '',
    snapshots: [],
    olderId: '',
    newerId: 'live',
    focusedSide: 'older',
    olderText: '',
    newerText: liveText,
    diffStatus: 'idle',
    diffError: '',
    diffStyle: 'split',
    restoreBusy: false,
  }
}

/** The (loosely typed) property/event surface `mn-doc-history-panel` exposes — mirrors `render-workspace.ts`'s `renderDocHistoryOverlay` binding 1:1, kept local because `packages/runtime` cannot statically import `@shrubbery/components`'s class (this file's own header). */
interface MnDocHistoryPanelElement extends HTMLElement {
  title: string
  subtitle: string
  status: DocHistoryStatus
  error: string
  snapshots: readonly DocHistorySnapshot[]
  olderId: string
  newerId: string
  focusedSide: DocHistoryFocusedSide
  olderText: string
  newerText: string
  diffStatus: DocHistoryStatus
  diffError: string
  diffStyle: DocHistoryDiffStyle
  restoreDisabled: boolean
  showClose: boolean
}

export interface DocHistoryConfirmOptions {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly variant: 'danger' | 'warning'
}

/**
 * The `doc.history` `FaceRegistration`. `mount()` creates a hidden companion
 * `<sh-editor-host>` bound to the SAME shared `EditorRoomLease.provider` the
 * resource adapter resolved (real read access to the live document's text +
 * a real `restoreHtml()` — never a second, parallel Y.Doc-text-extraction
 * implementation), plus the REAL `<mn-doc-history-panel>` driven off a
 * per-leaf controller that calls the REAL `DocumentSnapshotService` on every
 * user action (cursor change, refresh, save, bookmark, delete, restore).
 *
 * `confirmDialog` is REQUIRED (wave1 review r1 WRONG fix): production's
 * `handleDocHistoryDelete`/`handleDocHistoryRestore` (`apps/organism/src/
 * main.ts`) both gate their destructive action behind `confirmAction(...)`
 * — this face used to skip straight to the REST call on the raw component
 * event, so a leaf-mounted user could delete a saved version or overwrite
 * the live document's contents with zero confirmation. The caller MUST
 * supply a real confirm implementation (the harness backs it with the real
 * `<mn-confirmation-dialog>` element, the same component `confirmAction`
 * itself drives) — mirrors `access-manager-face.ts`'s own required
 * `confirmRemove` for the identical reason.
 */
export function createDocHistoryFace(
  confirmDialog: (options: DocHistoryConfirmOptions) => Promise<boolean>,
): FaceRegistration {
  return {
    faceId: DOC_HISTORY_FACE_ID,
    // Carries real, meaningful local state (which snapshot pair is selected,
    // diff style, a live hidden EditorView) that a user would not want
    // silently discarded across a move/swap/focus handoff — the same
    // reasoning hoja-document-face.ts gives for its own classification.
    persistence: 'persistent-relocatable',
    resourceAdapterId: DOC_HISTORY_RESOURCE_ADAPTER_ID,
    accepts: (locator) => locator.kind === 'document',
    paramsSchema: closedParamsSchema({ snapshotLimit: { type: 'number', optional: true } }),
    constraints: docHistoryConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      if (descriptor.resource.kind !== 'document') {
        throw new Error(`doc.history: unexpected resource kind '${descriptor.resource.kind}'`)
      }
      const { graphId, documentId } = descriptor.resource
      const { roomLease, snapshots } = lease.value as DocHistoryRoomResource
      const limit = snapshotLimitFromParams(descriptor)

      // ── hidden companion editor host: real read access to the live text,
      // real restore — the SAME `<sh-editor-host>`/`EditorRoomPool` mechanism
      // hoja-document-face.ts uses for its VISIBLE editor, just never shown.
      const liveHost = document.createElement('sh-editor-host') as ShEditorHost
      liveHost.layoutMode = 'contained'
      liveHost.paneActive = false
      liveHost.tabIndex = -1
      liveHost.setAttribute('aria-hidden', 'true')
      liveHost.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;'
      const hostState: EditorHostState = {
        ...NULL_EDITOR_HOST_STATE,
        centerMode: 'document',
        graphId,
        documentId,
        status: 'ready',
        provider: roomLease.provider,
      }
      const binding: EditorHostBinding = staticSource(hostState)
      liveHost.binding = binding

      const panel = document.createElement('mn-doc-history-panel') as MnDocHistoryPanelElement
      panel.style.cssText = 'display:block;width:100%;height:100%;min-height:0;'
      panel.title = 'Document History'
      panel.subtitle = documentId
      panel.showClose = false // no channel to request close_leaf — chrome owns that (design: "chrome is shell-owned")

      const wrapper = document.createElement('div')
      wrapper.style.cssText = 'position:relative;width:100%;height:100%;min-height:0;'
      wrapper.append(panel, liveHost)
      target.replaceChildren(wrapper)

      function liveText(): string {
        return liveHost.liveEditor?.getText() ?? ''
      }

      let state: DocHistoryViewState = initialState(liveText())
      let disposed = false
      let listRequestSeq = 0
      let diffRequestSeq = 0

      function render(): void {
        panel.status = state.status
        panel.error = state.error
        panel.snapshots = state.snapshots
        panel.olderId = state.olderId
        panel.newerId = state.newerId
        panel.focusedSide = state.focusedSide
        panel.olderText = state.olderText
        panel.newerText = state.newerText
        panel.diffStatus = state.diffStatus
        panel.diffError = state.diffError
        panel.diffStyle = state.diffStyle
        panel.restoreDisabled = !state.olderId || state.olderId === 'live' || state.restoreBusy
      }

      async function readCursorText(id: string): Promise<string> {
        if (id === 'live' || id === '') return liveText()
        return snapshots.readText(graphId, documentId, id)
      }

      async function refreshDiff(): Promise<void> {
        if (disposed) return
        if (!state.olderId) {
          state = { ...state, olderText: '', newerText: liveText(), diffStatus: 'idle', diffError: '' }
          render()
          return
        }
        const requestId = ++diffRequestSeq
        state = { ...state, diffStatus: 'loading', diffError: '' }
        render()
        try {
          const [olderText, newerText] = await Promise.all([
            readCursorText(state.olderId),
            readCursorText(state.newerId),
          ])
          if (disposed || requestId !== diffRequestSeq) return
          state = { ...state, olderText, newerText, diffStatus: 'ready', diffError: '' }
          render()
        } catch (error) {
          if (disposed || requestId !== diffRequestSeq) return
          state = { ...state, diffStatus: 'error', diffError: error instanceof Error ? error.message : String(error) }
          render()
        }
      }

      async function reload(): Promise<void> {
        if (disposed) return
        const requestId = ++listRequestSeq
        state = { ...state, status: 'loading', error: '' }
        render()
        try {
          const { snapshots: list } = await snapshots.list(graphId, documentId, limit)
          if (disposed || requestId !== listRequestSeq) return
          const olderId = list[0]?.id ?? ''
          state = { ...state, status: 'ready', error: '', snapshots: list, olderId, newerId: 'live' }
          render()
          await refreshDiff()
        } catch (error) {
          if (disposed || requestId !== listRequestSeq) return
          state = { ...state, status: 'error', error: error instanceof Error ? error.message : String(error), snapshots: [] }
          render()
        }
      }

      panel.addEventListener('mn-doc-history-cursor-change', (event) => {
        const detail = (event as CustomEvent<DocHistoryCursorDetail>).detail
        state = {
          ...state,
          olderId: detail.olderId === 'live' ? '' : detail.olderId,
          newerId: detail.newerId,
          focusedSide: detail.focusedSide,
        }
        render()
        void refreshDiff()
      })
      panel.addEventListener('mn-doc-history-diff-style-change', (event) => {
        const detail = (event as CustomEvent<DocHistoryDiffStyleDetail>).detail
        state = { ...state, diffStyle: detail.diffStyle }
        render()
      })
      panel.addEventListener('mn-doc-history-refresh', () => {
        void reload()
      })
      panel.addEventListener('mn-doc-history-save-current', () => {
        void snapshots.save(graphId, documentId).then(() => reload())
      })
      panel.addEventListener('mn-doc-history-bookmark', (event) => {
        const { snapshotId } = (event as CustomEvent<DocHistorySnapshotDetail>).detail
        const found = state.snapshots.find((item) => item.id === snapshotId)
        void snapshots.bookmark(graphId, documentId, snapshotId, found?.label || 'Saved version').then(() => reload())
      })
      panel.addEventListener('mn-doc-history-delete', (event) => {
        const { snapshotId } = (event as CustomEvent<DocHistorySnapshotDetail>).detail
        // wave1 review r1 WRONG fix: production's `handleDocHistoryDelete`
        // ALWAYS confirms before deleting a saved version — this face used
        // to delete immediately on the raw component event. Byte-identical
        // copy (title/message/confirmLabel/variant) of `apps/organism/src/
        // main.ts`'s own `confirmAction` call.
        void confirmDialog({
          title: 'Delete Saved Version',
          message: 'Delete this saved version? This cannot be undone.',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          variant: 'danger',
        }).then((confirmed) => {
          if (!confirmed) return
          void snapshots.remove(graphId, documentId, snapshotId).then(() => reload())
        })
      })
      panel.addEventListener('mn-doc-history-restore', (event) => {
        const { snapshotId } = (event as CustomEvent<DocHistoryRestoreDetail>).detail
        const found = state.snapshots.find((item) => item.id === snapshotId)
        const label = found?.label || snapshotId
        // Same fix, same production precedent: `handleDocHistoryRestore`
        // ALWAYS confirms before overwriting the live document's contents —
        // this is the single most destructive action this face exposes.
        void confirmDialog({
          title: 'Restore Version',
          message: `Restore "${documentId}" to "${label}"? This replaces the current document contents.`,
          confirmLabel: 'Restore',
          cancelLabel: 'Cancel',
          variant: 'warning',
        }).then((confirmed) => {
          if (!confirmed) return
          void performRestore(snapshotId)
        })
      })
      function performRestore(snapshotId: string): void {
        state = { ...state, restoreBusy: true }
        render()
        void snapshots.readHtml(graphId, documentId, snapshotId)
          .then((html) => {
            const ok = liveHost.liveEditor?.restoreHtml(html) ?? false
            if (!ok) throw new Error('the editor rejected the snapshot content')
            state = { ...state, restoreBusy: false, olderId: '' }
            render()
            return refreshDiff()
          })
          .catch((error: unknown) => {
            state = { ...state, restoreBusy: false, diffError: error instanceof Error ? error.message : String(error) }
            render()
          })
      }

      render()
      void reload()

      const view: FaceView = {
        focus(_request) {
          const panelWithFocus = panel as unknown as { focus?: () => void }
          panelWithFocus.focus?.()
          return true
        },
        blur() {},
        resize() {
          // The panel/liveHost both fill 100%/100% via the wrapper's CSS; the
          // interpreter already sized `target`. MUST NOT write layout state.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          panel.remove()
          liveHost.remove()
          wrapper.remove()
        },
      }
      return view
    },
  }
}
