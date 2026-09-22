/**
 * install-advanced-wire-menu-bridge.ts — connect the kernel Mod-Shift-;
 * event to the advanced wire menu and route its confirm back to wireMode.
 *
 * This is the last piece of the visual-wire-mode loop (C5 of 5):
 *
 *   [editor kernel] Mod-Shift-; pressed in editor
 *     → fires mn-editor-keyboard-wire-menu-request { blockId }   (C1)
 *   [this bridge] catches the event at doc level
 *     → opens the mn-advanced-wire-menu, stashes pending source blockId
 *   [user] picks predicate + direction in the menu, presses Enter
 *     → menu fires mn-wire-options-confirm { predicate, direction, bidirectional }
 *   [this bridge] catches confirm
 *     → calls wireMode.enter({source from blockId + scope}, {predicate, direction}, hostId)
 *   [installWireMode subscription]                                       (C2/C3/C4)
 *     → sets host attribute (crosshair via :host CSS)
 *     → calls editor.setEditable(false)
 *     → mounts source highlight overlay over source block
 *     → installs document-level keymap (Escape/Enter/J/K/Mod-;)
 *     → installs cross-pane mousedown handler
 *     → seeds target = first block
 *   [user navigates via J/K, Enter commits or Escape exits]
 *
 * On menu close-without-confirm: the bridge clears its pending source so
 * a subsequent kernel event can capture a fresh blockId without leaking.
 *
 * The bridge installs ONE document-level listener for the kernel event,
 * regardless of wire mode state. Multiple installs on the page would each
 * try to open their own menu — for now each shell installs once with one
 * menu and one host.
 */

import type {
  WireModeConfig,
  WireModeController,
  WireModeDirection,
} from '@shrubbery/nucleus'
// The kernel OWNS this event string (it fires it from the Mod-Shift-; binding).
// Import it rather than re-declaring the literal — a re-declared copy would let
// a kernel rename pass every test while the loop silently breaks at runtime.
import { EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT } from '@shrubbery/editor-kernel'

/** The minimum surface the bridge needs from the menu element. */
export interface AdvancedWireMenuHandle {
  open: boolean
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

/** The shape the menu emits as event.detail on mn-wire-options-confirm. */
export interface AdvancedWireMenuConfirmDetail {
  readonly predicate: string
  readonly direction: WireModeDirection
  readonly bidirectional: boolean
}

// Re-export the kernel-owned event so the runtime barrel surface is unchanged.
export { EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT }
// The menu's own confirm/close events. 'mn-close' is a generic close event the
// component shares with other dialogs, so these stay as bridge-local literals
// (no single component constant to import). If the component ever exports them,
// import for the same reason as the kernel event above.
export const ADVANCED_WIRE_MENU_CONFIRM_EVENT = 'mn-wire-options-confirm'
export const ADVANCED_WIRE_MENU_CLOSE_EVENT = 'mn-close'

export interface InstallAdvancedWireMenuBridgeOptions {
  readonly wireMode: WireModeController
  readonly menu: AdvancedWireMenuHandle
  /** Opaque host identifier passed to wireMode.enter. */
  readonly hostId: string
  /** Resolves the graph + document the wire source lives in. */
  readonly getDocumentScope: () => { graphId: string; documentId: string }
  /** Document used to listen for the kernel event. Defaults to `document`. */
  readonly doc?: Document
}

export function installAdvancedWireMenuBridge(
  opts: InstallAdvancedWireMenuBridgeOptions,
): () => void {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null)
  if (!doc) return () => {}

  let pendingBlockId: string | null = null

  const handleKernelRequest = (event: Event): void => {
    const detail = (event as CustomEvent<{ blockId?: string }>).detail
    if (!detail?.blockId) return
    pendingBlockId = detail.blockId
    opts.menu.open = true
  }

  const handleMenuConfirm = (event: Event): void => {
    const detail = (event as CustomEvent<AdvancedWireMenuConfirmDetail>).detail
    if (!detail) return
    const blockId = pendingBlockId
    pendingBlockId = null
    if (!blockId) return
    const scope = opts.getDocumentScope()
    const config: WireModeConfig = {
      predicate: detail.predicate,
      direction: detail.direction,
    }
    opts.wireMode.enter(
      { graphId: scope.graphId, documentId: scope.documentId, blockId },
      config,
      opts.hostId,
    )
  }

  const handleMenuClose = (): void => {
    // Close without confirm: drop the pending source so the next kernel
    // event doesn't accidentally enter mode against a stale block.
    pendingBlockId = null
  }

  doc.addEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, handleKernelRequest)
  opts.menu.addEventListener(ADVANCED_WIRE_MENU_CONFIRM_EVENT, handleMenuConfirm)
  opts.menu.addEventListener(ADVANCED_WIRE_MENU_CLOSE_EVENT, handleMenuClose)

  return () => {
    doc.removeEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, handleKernelRequest)
    opts.menu.removeEventListener(ADVANCED_WIRE_MENU_CONFIRM_EVENT, handleMenuConfirm)
    opts.menu.removeEventListener(ADVANCED_WIRE_MENU_CLOSE_EVENT, handleMenuClose)
  }
}
