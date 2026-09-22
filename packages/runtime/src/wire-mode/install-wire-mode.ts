/**
 * install-wire-mode.ts — composition entry point for visual wire mode.
 *
 * Subscribes to `ShrubberyContract.wireMode` and applies per-host side
 * effects (overlay creation, host attribute toggle for shadow-DOM cursor
 * cascade, `editor.setEditable(false)`, document-level keymap) when wire
 * mode is active AND this host is the active host. On exit, on activeHostId
 * change away from us, or on uninstall, side effects are reversed.
 *
 * Per the design doc (visual-wire-mode-design-2026-06-27):
 *   - The kernel emits the keyboard event only.
 *   - ShrubberyContract.wireMode owns the authoritative state.
 *   - The runtime (this file) applies the side effects.
 *   - The organism wires the advanced wire menu + provides CSS for the host
 *     attribute (`:host([wire-mode-active])` cursor crosshair — editor-host
 *     already ships this rule in its static styles).
 *
 * What ships through C4:
 *   - C2 (f6821b6): Subscription + overlays + host attribute + setEditable.
 *   - C3 (40a68de): Document-level keymap during mode — Escape exits,
 *     Enter commits the wire to the current target via wireMode.commit(),
 *     J/ArrowDown navigates target down, K/ArrowUp navigates target up,
 *     Mod-; exits, Mod-Shift-; passes through for advanced-menu re-open.
 *   - C4 (this commit): Cross-pane mousedown gating. A document-level
 *     mousedown handler installed whenever wire mode is active (any host).
 *     When the user clicks inside our host element AND we are NOT the
 *     active host, call transferActiveHost(opts.hostId) — clicking another
 *     pane mid-mode hands focus over without exiting. When we ARE the
 *     active host, mousedown inside our host is a no-op (the click is
 *     swallowed by the existing keymap/click handlers); mousedown outside
 *     our host is a no-op (a sibling host will transfer to itself).
 *
 * What this file does NOT do yet (C5):
 *   - No mouse hover target tracking (mousemove inside the editor doesn't
 *     move the target overlay). Targeting is keyboard-only until C5 or
 *     beyond.
 *   - No advanced-wire-menu confirm → enter() wiring (so Mod-Shift-; still
 *     fires its kernel event into the void).
 *
 * Body class on `document.body`: deliberately NOT used. Prod's
 * `body.wire-mode-active` cascades the crosshair across the whole UI
 * (sidebar, status bar, etc.); shrubbery only sets the host attribute on
 * the editor host element where wire-target selection actually works.
 * Outside the editor, the cursor stays default — and clicking outside the
 * editor does nothing wire-mode-relevant, so the visual signal is accurate.
 */

import type { WireModeController, WireModeView } from '@shrubbery/nucleus'
import {
  createSourceHighlightOverlay,
  createTargetHighlightOverlay,
  type SourceHighlightOverlayHandle,
  type TargetHighlightOverlayHandle,
} from './wire-mode-overlays.js'

/** The minimum editor surface install-wire-mode needs. */
export interface WireModeEditorHandle {
  /** Disable / enable inline editing while wire mode is active. */
  setEditable(editable: boolean): void
}

/** The scope (graph + document) the host is currently rendering. */
export interface WireModeDocumentScope {
  readonly graphId: string
  readonly documentId: string
}

export interface InstallWireModeOptions {
  readonly wireMode: WireModeController
  /** Opaque host identifier; matched against `view.activeHostId`. */
  readonly hostId: string
  /**
   * The editor host element; receives the `wire-mode-active` attribute on
   * enter, has it removed on exit. Returns null when the host has not yet
   * mounted or has been torn down.
   */
  readonly getHostElement: () => HTMLElement | null
  /**
   * The TipTap editor instance; `setEditable(false)` is called on enter,
   * `setEditable(true)` on exit. Returns null when no editor is mounted.
   */
  readonly getEditor: () => WireModeEditorHandle | null
  /**
   * Resolve a block's DOM element by id. The shell owns the lookup so
   * install-wire-mode does not need to know whether blocks live in the
   * editor host's shadow root, light DOM, or some other tree. Returns null
   * when the block is not currently rendered.
   */
  readonly getBlockElement: (blockId: string) => HTMLElement | null
  /**
   * Wireable block elements in document order. Called on enter to seed the
   * target highlight (first block) and on every J/K navigation. Omit to
   * disable navigation — Escape and Mod-; still exit, but J/K become no-ops
   * and Enter cannot resolve a target without a seeded element.
   */
  readonly getOrderedBlockElements?: () => HTMLElement[]
  /**
   * The current host's graph + document scope. Called when Enter fires to
   * resolve the target endpoint passed to `wireMode.commit`. Omit if Enter
   * should be a no-op (the host has no document context to commit into).
   */
  readonly getDocumentScope?: () => WireModeDocumentScope
  /** Document used to create overlays / install keymap. Defaults to `document`. */
  readonly doc?: Document
}

export interface InstallWireModeHandle {
  /**
   * Move the target highlight to `target`. C3 keymap calls this when J/K
   * navigation changes the selected block; C4 mouse handlers call it on
   * hover. Pass null to hide.
   */
  setTarget(target: HTMLElement | null): void
  /** Tear down everything: unsubscribe + remove overlays + restore attribute + restore editable. */
  uninstall(): void
}

const NOOP_HANDLE: InstallWireModeHandle = {
  setTarget: () => {},
  uninstall: () => {},
}

export function installWireMode(opts: InstallWireModeOptions): InstallWireModeHandle {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null)
  if (!doc) return NOOP_HANDLE

  let sourceOverlay: SourceHighlightOverlayHandle | null = null
  let targetOverlay: TargetHighlightOverlayHandle | null = null
  let attributeApplied = false
  let editableSuppressed = false
  let keymapInstalled = false
  let mousedownInstalled = false
  let currentSourceBlockId: string | null = null
  let currentTarget: HTMLElement | null = null
  // The exact element/editor the side effect was applied TO, captured at apply
  // time. Teardown reverses on these cached refs rather than re-querying the
  // getter — if getHostElement()/getEditor() returns null transiently at
  // teardown, the live-getter approach would leave the flag stuck true (a
  // permanently frozen editor in the setEditable case). Caching guarantees the
  // attribute/editable state is always reversed on the thing it was set on.
  let appliedHost: HTMLElement | null = null
  let suppressedEditor: WireModeEditorHandle | null = null

  const setCurrentTarget = (target: HTMLElement | null): void => {
    currentTarget = target
    targetOverlay?.setTarget(target)
  }

  const navigate = (direction: 'up' | 'down'): void => {
    const blocks = opts.getOrderedBlockElements?.()
    if (!blocks || blocks.length === 0) return
    let nextIndex: number
    if (currentTarget) {
      const currentIndex = blocks.indexOf(currentTarget)
      if (currentIndex < 0) {
        nextIndex = direction === 'down' ? 0 : blocks.length - 1
      } else if (direction === 'down') {
        nextIndex = (currentIndex + 1) % blocks.length
      } else {
        nextIndex = (currentIndex - 1 + blocks.length) % blocks.length
      }
    } else {
      nextIndex = direction === 'down' ? 0 : blocks.length - 1
    }
    setCurrentTarget(blocks[nextIndex])
  }

  const commit = (): void => {
    // Guard against a detached target: in collaborative editing another user
    // can delete the highlighted block mid-mode. getAttribute() still returns
    // the dead id on a detached node, which would commit a wire to a
    // nonexistent block and get swallowed by the .catch below — leaving the
    // user silently stuck. isConnected rejects the detached element.
    if (!currentTarget || !currentTarget.isConnected) return
    const blockId = currentTarget.getAttribute('data-block-id')
    if (!blockId) return
    const scope = opts.getDocumentScope?.()
    if (!scope) return
    void opts.wireMode
      .commit({ graphId: scope.graphId, documentId: scope.documentId, blockId })
      .catch(() => {
        // commit errors stay on the controller (which keeps state for retry);
        // surface mechanisms (toast, etc.) live with the host / shell.
      })
  }

  // Document-level keydown handler — capture phase so it runs before the
  // editor view's ProseMirror keymap. Without capture, Enter / Escape / Mod-;
  // would reach TipTap first and fire its own bindings (newlines, picker).
  const handleKeyDown = (event: KeyboardEvent): void => {
    const view = opts.wireMode.view()
    if (!view.isActive || view.activeHostId !== opts.hostId) return
    const isMod = event.metaKey || event.ctrlKey
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      opts.wireMode.exit()
      return
    }
    if (event.key === ';' && isMod) {
      // Mod-Shift-; passes through so the advanced-wire-menu can re-open
      // mid-mode and re-fire enter() with a new predicate/direction (the
      // controller treats enter-while-active as a replace). Plain Mod-; in
      // wire mode exits; intercepting prevents the kernel's wire-shortcuts
      // extension from firing the picker on top of the active mode.
      if (event.shiftKey) return
      event.preventDefault()
      event.stopImmediatePropagation()
      opts.wireMode.exit()
      return
    }
    if (event.key === 'Enter' && !isMod) {
      event.preventDefault()
      event.stopImmediatePropagation()
      commit()
      return
    }
    if ((event.key === 'j' || event.key === 'ArrowDown') && !isMod) {
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate('down')
      return
    }
    if ((event.key === 'k' || event.key === 'ArrowUp') && !isMod) {
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate('up')
      return
    }
  }

  const installKeymap = (): void => {
    if (keymapInstalled) return
    doc.addEventListener('keydown', handleKeyDown, { capture: true })
    keymapInstalled = true
  }

  const uninstallKeymap = (): void => {
    if (!keymapInstalled) return
    doc.removeEventListener('keydown', handleKeyDown, { capture: true })
    keymapInstalled = false
  }

  // Cross-pane mousedown gating. Installed whenever wire mode is active (any
  // host), removed when inactive. Each install on the page (one per editor
  // host) attaches its own handler. The handler is local-scope: it only
  // responds when the click lands inside THIS host's element AND this host
  // is not the active wire pane. In that case it transfers ownership to us.
  // Clicking the already-active host or outside our host is a no-op (a
  // sibling host's handler will catch its own clicks).
  //
  // Shadow-DOM note: the event target inside a closed/open shadow root is
  // retargeted to the shadow host element on the way out; `host.contains
  // (event.target)` returns true for clicks inside our shadow content
  // because the retargeted target IS the host element.
  const handleMouseDown = (event: MouseEvent): void => {
    const view = opts.wireMode.view()
    if (!view.isActive) return
    if (view.activeHostId === opts.hostId) return
    const host = opts.getHostElement()
    if (!host) return
    if (!host.contains(event.target as Node)) return
    opts.wireMode.transferActiveHost(opts.hostId)
  }

  const installMousedown = (): void => {
    if (mousedownInstalled) return
    doc.addEventListener('mousedown', handleMouseDown, { capture: true })
    mousedownInstalled = true
  }

  const uninstallMousedown = (): void => {
    if (!mousedownInstalled) return
    doc.removeEventListener('mousedown', handleMouseDown, { capture: true })
    mousedownInstalled = false
  }

  const teardownLocalEffects = (): void => {
    uninstallKeymap()
    sourceOverlay?.destroy()
    sourceOverlay = null
    targetOverlay?.destroy()
    targetOverlay = null
    currentSourceBlockId = null
    currentTarget = null
    // Reverse on the cached refs, not the live getter — see the appliedHost /
    // suppressedEditor declaration. removeAttribute / setEditable(true) are
    // harmless on a detached element, and the flags ALWAYS clear so a transient
    // null getter can never strand the side effect.
    if (appliedHost && attributeApplied) {
      appliedHost.removeAttribute('wire-mode-active')
    }
    attributeApplied = false
    appliedHost = null
    if (suppressedEditor && editableSuppressed) {
      suppressedEditor.setEditable(true)
    }
    editableSuppressed = false
    suppressedEditor = null
  }

  const applyLocalEffects = (sourceBlockId: string | null): void => {
    const host = opts.getHostElement()
    if (host && !attributeApplied) {
      host.setAttribute('wire-mode-active', '')
      attributeApplied = true
      appliedHost = host
    }
    const editor = opts.getEditor()
    if (editor && !editableSuppressed) {
      editor.setEditable(false)
      editableSuppressed = true
      suppressedEditor = editor
    }
    // Recreate the source overlay when the source block changes (e.g. the user
    // re-opens the advanced menu mid-mode from a different cursor position;
    // enter() then re-fires with a new source).
    if (sourceBlockId !== currentSourceBlockId) {
      sourceOverlay?.destroy()
      sourceOverlay = null
      currentSourceBlockId = sourceBlockId
      if (sourceBlockId) {
        const sourceEl = opts.getBlockElement(sourceBlockId)
        if (sourceEl) {
          sourceOverlay = createSourceHighlightOverlay({ doc, target: sourceEl })
        }
      }
    }
    if (!targetOverlay) {
      targetOverlay = createTargetHighlightOverlay({ doc })
    }
    // Seed the target highlight to the first block on first activation.
    if (!currentTarget && opts.getOrderedBlockElements) {
      const blocks = opts.getOrderedBlockElements()
      if (blocks.length > 0) {
        setCurrentTarget(blocks[0])
      }
    }
    installKeymap()
  }

  const handleViewChange = (view: WireModeView): void => {
    // Mousedown gating is independent of "are we the active host" — it must
    // be live whenever wire mode is active, because the whole point is to
    // grab focus FROM another host when the user clicks us.
    if (view.isActive) {
      installMousedown()
    } else {
      uninstallMousedown()
    }
    if (view.isActive && view.activeHostId === opts.hostId) {
      applyLocalEffects(view.source?.blockId ?? null)
    } else {
      teardownLocalEffects()
    }
  }

  // Apply the current state immediately (in case wire mode was already active
  // when this host installed — e.g. a late-mount split pane).
  handleViewChange(opts.wireMode.view())
  const unsubscribe = opts.wireMode.subscribe(handleViewChange)

  return {
    setTarget(target: HTMLElement | null): void {
      setCurrentTarget(target)
    },
    uninstall(): void {
      unsubscribe()
      teardownLocalEffects()
      uninstallMousedown()
    },
  }
}
