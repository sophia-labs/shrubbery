/**
 * install-document-switcher-wire-bridge.ts — bind mn-document-switcher to
 * the wire-mode controller.
 *
 * The `mn-document-switcher` component already ships wire-mode awareness:
 * a `wireMode` boolean property, a `mn-document-switcher-wire-target`
 * custom event emitted when the user picks an item with Enter while
 * wireMode is true, and Mod+Enter as the force-open escape hatch.
 *
 * What this file provides is the runtime glue:
 *   - On wireMode enter (false → true): set switcher.wireMode = true AND
 *     reset switcher.scope = 'documents'. Matching prod's openSwitcher path
 *     (frontend/src/components/document-switcher.ts:1048-1052): wire mode
 *     scopes the picker to documents-only by default. The user can still
 *     change scope mid-search.
 *   - On wireMode exit (true → false): set switcher.wireMode = false.
 *   - On every wire-target event: build the WireModeTarget from the event
 *     detail (falling back to the wire mode source's graphId when the
 *     switcher emits a null graphId) and call wireMode.commit(target).
 *     The controller exits wire mode on success; this bridge then closes the
 *     switcher (sets switcher.open = false). On a commit error the switcher is
 *     left OPEN so the user can retry or pick a different target. The
 *     mn-document-switcher component does NOT self-close on a wire-target
 *     selection (that is the bridge's responsibility, mirroring prod's
 *     document-switcher wiringInProgress + handleClose-on-success).
 *
 * Shells call installDocumentSwitcherWireBridge() once when the switcher
 * mounts and call the returned uninstall when it unmounts. The function
 * is idempotent in subscription terms — calling it twice for the same
 * (switcher, wireMode) pair installs two independent subscriptions and
 * two duplicate listeners, so don't.
 */

import type {
  WireModeController,
  WireModeTarget,
  WireModeView,
} from '@shrubbery/nucleus'

/**
 * The narrow surface the bridge needs from a document switcher. Matching
 * mn-document-switcher's existing public API so the bridge can be tested
 * against a plain mock element.
 */
export interface DocumentSwitcherHandle {
  wireMode: boolean
  scope: 'all' | 'documents' | 'blocks' | 'actions'
  /** Set false to close the switcher after a successful wire commit. */
  open: boolean
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

/** The shape the switcher emits as event.detail on mn-document-switcher-wire-target. */
export interface DocumentSwitcherWireTargetDetail {
  readonly graphId: string | null
  readonly documentId: string
  readonly blockId?: string
}

export const DOCUMENT_SWITCHER_WIRE_TARGET_EVENT = 'mn-document-switcher-wire-target'

export interface InstallDocumentSwitcherWireBridgeOptions {
  readonly wireMode: WireModeController
  readonly switcher: DocumentSwitcherHandle
  /**
   * Default graph id to use when the switcher emits a null graphId on a
   * wire-target event. Defaults to the current wire mode source's graphId
   * at commit time, which is the right answer for the common "wire within
   * the same graph" case. Override when the host is cross-graph aware.
   */
  readonly resolveTargetGraphId?: (detail: DocumentSwitcherWireTargetDetail) => string | null
}

export function installDocumentSwitcherWireBridge(
  opts: InstallDocumentSwitcherWireBridgeOptions,
): () => void {
  let lastIsActive = false

  const reflectView = (view: WireModeView): void => {
    const next = view.isActive
    if (next !== lastIsActive) {
      opts.switcher.wireMode = next
      // Reset scope ONLY on the false → true transition, so the user can
      // change scope mid-search without it being clobbered by every
      // unrelated wire-mode state event (e.g. transferActiveHost).
      if (next) {
        opts.switcher.scope = 'documents'
      }
      lastIsActive = next
    }
  }

  const handleWireTarget = (event: Event): void => {
    const detail = (event as CustomEvent<DocumentSwitcherWireTargetDetail>).detail
    if (!detail) return
    const view = opts.wireMode.view()
    if (!view.isActive) return
    // Precedence: explicit detail.graphId → caller's resolver → wire mode
    // source's graphId. Refuse the commit if none yields a graphId rather than
    // sending an empty string to wire.create.
    const graphId =
      detail.graphId ?? opts.resolveTargetGraphId?.(detail) ?? view.source?.graphId ?? null
    if (!graphId) return
    const target: WireModeTarget = {
      graphId,
      documentId: detail.documentId,
      blockId: detail.blockId ?? null,
    }
    void opts.wireMode
      .commit(target)
      .then(() => {
        // Close the switcher on success — the component does not self-close on
        // a wire-target selection, so without this it sits open in normal-nav
        // mode and a stray Enter would duplicate or navigate.
        opts.switcher.open = false
      })
      .catch(() => {
        // commit failures keep the controller active (per its contract) AND
        // leave the switcher open so the user can retry or pick another target.
      })
  }

  reflectView(opts.wireMode.view())
  const unsubscribe = opts.wireMode.subscribe(reflectView)
  opts.switcher.addEventListener(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, handleWireTarget)

  return () => {
    unsubscribe()
    opts.switcher.removeEventListener(DOCUMENT_SWITCHER_WIRE_TARGET_EVENT, handleWireTarget)
  }
}
