/**
 * Visual wire mode runtime — overlays + lifecycle composition.
 *
 * See ./install-wire-mode.ts for the entry point. Shells call
 * `installWireMode({...})` once per editor-host instance and call
 * `handle.uninstall()` on host disconnect.
 */
export {
  createSourceHighlightOverlay,
  createTargetHighlightOverlay,
  type CreateSourceHighlightOverlayOptions,
  type CreateTargetHighlightOverlayOptions,
  type SourceHighlightOverlayHandle,
  type TargetHighlightOverlayHandle,
} from './wire-mode-overlays.js'

export {
  installWireMode,
  type InstallWireModeHandle,
  type InstallWireModeOptions,
  type WireModeDocumentScope,
  type WireModeEditorHandle,
} from './install-wire-mode.js'

export {
  installDocumentSwitcherWireBridge,
  DOCUMENT_SWITCHER_WIRE_TARGET_EVENT,
  type DocumentSwitcherHandle,
  type DocumentSwitcherWireTargetDetail,
  type InstallDocumentSwitcherWireBridgeOptions,
} from './install-document-switcher-wire-bridge.js'

export {
  installAdvancedWireMenuBridge,
  ADVANCED_WIRE_MENU_CONFIRM_EVENT,
  ADVANCED_WIRE_MENU_CLOSE_EVENT,
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
  type AdvancedWireMenuConfirmDetail,
  type AdvancedWireMenuHandle,
  type InstallAdvancedWireMenuBridgeOptions,
} from './install-advanced-wire-menu-bridge.js'
