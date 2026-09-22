/**
 * Organism composition for the visual wire-mode runtime.
 *
 * The state machine already belongs to the live cell's single
 * `ShrubberyContract.wireMode`. This module does not create another controller;
 * it binds that controller to the current editor host, the shared advanced wire
 * menu, and the shared document switcher for one editor claim.
 *
 * The document-level wire-mode keymap owns Enter/Escape while the editor host is
 * active. Modal surfaces therefore receive temporary active-host ids while they
 * are open. That lets their own keyboard handlers run without duplicating or
 * bypassing the controller:
 *
 *   editor -> advanced menu -> editor (confirm/reconfigure)
 *   editor -> document switcher -> commit target / editor (cancel)
 */

import type { ShrubberyContract } from '@shrubbery/nucleus'
import {
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
  installAdvancedWireMenuBridge,
  installDocumentSwitcherWireBridge,
  installWireMode,
  type AdvancedWireMenuHandle,
  type DocumentSwitcherHandle,
  type LiveEditorHandle,
  type WireModeDocumentScope,
  type WireModeEditorHandle,
} from '@shrubbery/runtime'

const DOCUMENT_SWITCHER_CLOSE_EVENT = 'mn-document-switcher-close'

export interface OrganismDocumentSwitcherHandle extends DocumentSwitcherHandle {
  open: boolean
}

export interface OrganismWireModeLifecycle {
  /**
   * Hand keyboard ownership to the document switcher before opening it.
   * Returns true when the switcher is selecting a wire target.
   */
  handoffToDocumentSwitcher(): boolean
  /** Exit owned mode, remove every bridge/listener, and restore editor UI. */
  uninstall(): void
}

export interface InstallOrganismWireModeOptions {
  /** The live cell contract; its existing wireMode controller is authoritative. */
  readonly contract: Pick<ShrubberyContract, 'wireMode'>
  /** Stable for the lifetime of this editor claim. */
  readonly hostId: string
  readonly getHostElement: () => HTMLElement | null
  readonly getEditor: () => WireModeEditorHandle | null
  readonly getDocumentScope: () => WireModeDocumentScope
  readonly menu: AdvancedWireMenuHandle
  readonly switcher: OrganismDocumentSwitcherHandle
  readonly doc?: Document
}

/**
 * TipTap remains private to `sh-editor-host`, so the app adapts its runtime
 * object structurally at the shell boundary instead of widening runtime's
 * public editor command handle solely for one DOM lifecycle concern.
 */
export function wireModeEditorFromHost(host: HTMLElement | null): WireModeEditorHandle | null {
  return (
    host as unknown as { readonly liveEditor?: LiveEditorHandle | null } | null
  )?.liveEditor ?? null
}

/** Return the rendered wireable blocks in editor document order. */
export function wireModeBlockElements(host: HTMLElement | null): HTMLElement[] {
  const live = (
    host as unknown as { readonly liveEditor?: LiveEditorHandle | null } | null
  )?.liveEditor
  if (live) return live.getOrderedBlockElements()
  if (!host) return []
  const root: ParentNode = host.shadowRoot ?? host
  const editorRoot = root.querySelector('.editor-mount .ProseMirror')
    ?? root.querySelector('.editor-mount')
    ?? root
  return Array.from(editorRoot.querySelectorAll<HTMLElement>('[data-block-id]'))
}

/** Resolve exact ids first, then tolerate Garden's historical `block-` prefix. */
export function wireModeBlockElement(host: HTMLElement | null, blockId: string): HTMLElement | null {
  const live = (
    host as unknown as { readonly liveEditor?: LiveEditorHandle | null } | null
  )?.liveEditor
  if (live) return live.getBlockElement(blockId)
  const normalized = blockId.trim()
  if (!normalized) return null
  const candidates = new Set<string>([normalized])
  if (normalized.startsWith('block-')) {
    const short = normalized.slice('block-'.length)
    if (short) candidates.add(short)
  } else {
    candidates.add(`block-${normalized}`)
  }
  return wireModeBlockElements(host).find((block) => {
    const candidate = block.getAttribute('data-block-id')
    return !!candidate && candidates.has(candidate)
  }) ?? null
}

export function installOrganismWireMode(
  options: InstallOrganismWireModeOptions,
): OrganismWireModeLifecycle {
  const { contract, hostId, menu, switcher } = options
  const wireMode = contract.wireMode
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : null)
  const menuHostId = `${hostId}:advanced-menu`
  const switcherHostId = `${hostId}:document-switcher`

  const wireHandle = installWireMode({
    wireMode,
    hostId,
    getHostElement: options.getHostElement,
    getEditor: options.getEditor,
    getBlockElement: (blockId) => wireModeBlockElement(options.getHostElement(), blockId),
    getOrderedBlockElements: () => wireModeBlockElements(options.getHostElement()),
    getDocumentScope: options.getDocumentScope,
    ...(doc ? { doc } : {}),
  })
  const uninstallSwitcherBridge = installDocumentSwitcherWireBridge({ wireMode, switcher })
  const uninstallMenuBridge = installAdvancedWireMenuBridge({
    wireMode,
    menu,
    hostId,
    getDocumentScope: options.getDocumentScope,
    ...(doc ? { doc } : {}),
  })

  // Re-opening the advanced menu while mode is active must release the editor's
  // capture-phase Enter/Escape keymap so the dialog can receive those keys.
  const handleAdvancedMenuRequest = (): void => {
    const view = wireMode.view()
    if (view.isActive && view.activeHostId === hostId) {
      wireMode.transferActiveHost(menuHostId)
    }
  }
  const handleAdvancedMenuClose = (): void => {
    const view = wireMode.view()
    if (view.isActive && view.activeHostId === menuHostId) {
      wireMode.transferActiveHost(hostId)
    }
  }
  const handleDocumentSwitcherClose = (): void => {
    const view = wireMode.view()
    if (view.isActive && view.activeHostId === switcherHostId) {
      wireMode.transferActiveHost(hostId)
    }
  }

  doc?.addEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, handleAdvancedMenuRequest)
  menu.addEventListener('mn-close', handleAdvancedMenuClose)
  switcher.addEventListener(DOCUMENT_SWITCHER_CLOSE_EVENT, handleDocumentSwitcherClose)

  let wasActive = wireMode.view().isActive
  const unsubscribeCompletion = wireMode.subscribe((view) => {
    // Target commit and explicit exit both close transient target UI. Property
    // assignment is intentional: neither component exposes a close-without-
    // emitting public method, and emitting close here would transfer ownership
    // during the controller's inactive transition.
    if (wasActive && !view.isActive) {
      switcher.open = false
      menu.open = false
    }
    wasActive = view.isActive
  })

  let uninstalled = false
  return {
    handoffToDocumentSwitcher(): boolean {
      const view = wireMode.view()
      if (!view.isActive) return false
      switcher.wireMode = true
      switcher.scope = 'documents'
      if (view.activeHostId !== switcherHostId) {
        wireMode.transferActiveHost(switcherHostId)
      }
      return true
    },

    uninstall(): void {
      if (uninstalled) return
      uninstalled = true

      const view = wireMode.view()
      if (
        view.isActive
        && (view.activeHostId === hostId
          || view.activeHostId === menuHostId
          || view.activeHostId === switcherHostId)
      ) {
        // Exit while subscriptions are still attached so every surface restores
        // its inactive state and the editor is made editable before teardown.
        wireMode.exit()
      }

      unsubscribeCompletion()
      doc?.removeEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, handleAdvancedMenuRequest)
      menu.removeEventListener('mn-close', handleAdvancedMenuClose)
      switcher.removeEventListener(DOCUMENT_SWITCHER_CLOSE_EVENT, handleDocumentSwitcherClose)
      uninstallMenuBridge()
      uninstallSwitcherBridge()
      wireHandle.uninstall()

      // If another host still owns the shared controller, leave its shared UI
      // alone. In Organism's current single-editor shape the controller is now
      // inactive, so close and normalize both global surfaces.
      if (!wireMode.view().isActive) {
        switcher.wireMode = false
        switcher.open = false
        menu.open = false
      }
    },
  }
}
