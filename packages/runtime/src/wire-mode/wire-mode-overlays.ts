/**
 * wire-mode-overlays.ts — pure DOM overlay primitives for visual wire mode.
 *
 * Ports prod's two overlay layers
 * (`mnemosyne-platform/frontend/src/components/document-editor.ts:7598-7720`):
 *
 *   - SOURCE highlight (z-index 999, teal/primary-500) — a persistent glow on
 *     the block the wire originates from. Stays in place for the lifetime of
 *     wire mode, scroll-tracked so it follows its block as the user scrolls.
 *   - TARGET highlight (z-index 1000, purple) — a roving highlight on the
 *     block the user is currently considering as the wire target. Mounts
 *     hidden; the C3 keymap and C4 mouse handlers call `setTarget(element)`
 *     to move it. Hidden when no target is selected.
 *
 * Both overlays live on `document.body` (outside any editor-host shadow
 * root), positioned with `position: fixed` + `getBoundingClientRect()` +
 * capture-phase `window.scroll` listener — same pattern prod uses. The
 * shadow-DOM boundary is irrelevant because the overlays render in the
 * document tree, not inside the editor's shadow root.
 *
 * This file is intentionally pure DOM. It has no contract knowledge, no
 * subscriptions, no editor handle. install-wire-mode.ts composes these
 * primitives with the WireModeController subscription.
 */

const PADDING = 4

const SOURCE_HIGHLIGHT_CSS = [
  'position: fixed',
  'pointer-events: none',
  'z-index: 999',
  'border: 2px solid var(--mn-color-primary-500, #4a8b6f)',
  'border-radius: 4px',
  'background: rgba(74, 139, 111, 0.1)',
  'box-shadow: 0 0 0 3px rgba(74, 139, 111, 0.15), 0 0 12px rgba(74, 139, 111, 0.1)',
  'transition: opacity 0.2s ease',
].join('; ')

const TARGET_HIGHLIGHT_CSS = [
  'position: fixed',
  'pointer-events: none',
  'z-index: 1000',
  'border: 3px solid var(--mn-color-wire-target, #8b5cf6)',
  'border-radius: 4px',
  'background: rgba(139, 92, 246, 0.15)',
  'box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.2)',
  'transition: top 0.1s ease, left 0.1s ease, width 0.1s ease, height 0.1s ease',
  'display: none',
].join('; ')

function positionOverTarget(overlay: HTMLDivElement, target: HTMLElement): void {
  // A detached target (block deleted mid-mode in collaborative editing) returns
  // an all-zero getBoundingClientRect in every browser, which would yank the
  // overlay to (-PADDING, -PADDING). Keep the overlay at its last position
  // instead — the lifecycle will tear it down when wire mode reconciles.
  if (!target.isConnected) return
  const rect = target.getBoundingClientRect()
  overlay.style.top = `${rect.top - PADDING}px`
  overlay.style.left = `${rect.left - PADDING}px`
  overlay.style.width = `${rect.width + PADDING * 2}px`
  overlay.style.height = `${rect.height + PADDING * 2}px`
}

export interface SourceHighlightOverlayHandle {
  readonly element: HTMLDivElement
  destroy(): void
}

export interface CreateSourceHighlightOverlayOptions {
  readonly doc: Document
  readonly target: HTMLElement
}

/**
 * Create a persistent source-highlight overlay positioned over `target`. The
 * overlay is `position: fixed`, follows the target via a capture-phase scroll
 * listener, and is removed (with its listener) on `destroy()`.
 */
export function createSourceHighlightOverlay(
  opts: CreateSourceHighlightOverlayOptions,
): SourceHighlightOverlayHandle {
  const overlay = opts.doc.createElement('div')
  overlay.id = 'wire-source-highlight'
  overlay.style.cssText = SOURCE_HIGHLIGHT_CSS
  opts.doc.body.appendChild(overlay)
  positionOverTarget(overlay, opts.target)

  const updatePosition = (): void => {
    positionOverTarget(overlay, opts.target)
  }

  const win = opts.doc.defaultView ?? globalThis
  win.addEventListener('scroll', updatePosition, true)

  let destroyed = false
  return {
    element: overlay,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      win.removeEventListener('scroll', updatePosition, true)
      overlay.remove()
    },
  }
}

export interface TargetHighlightOverlayHandle {
  readonly element: HTMLDivElement
  /** Move the overlay to `target`. Pass null to hide. */
  setTarget(target: HTMLElement | null): void
  destroy(): void
}

export interface CreateTargetHighlightOverlayOptions {
  readonly doc: Document
}

/**
 * Create a roving target-highlight overlay. Mounts hidden. C3 keymap and C4
 * mouse handlers move it by calling `setTarget(element)`; calling
 * `setTarget(null)` hides it. The overlay follows its current target on
 * scroll via a capture-phase listener.
 */
export function createTargetHighlightOverlay(
  opts: CreateTargetHighlightOverlayOptions,
): TargetHighlightOverlayHandle {
  const overlay = opts.doc.createElement('div')
  overlay.id = 'wire-target-highlight'
  overlay.style.cssText = TARGET_HIGHLIGHT_CSS
  opts.doc.body.appendChild(overlay)

  let currentTarget: HTMLElement | null = null

  const updatePosition = (): void => {
    if (!currentTarget) return
    positionOverTarget(overlay, currentTarget)
  }

  const win = opts.doc.defaultView ?? globalThis
  win.addEventListener('scroll', updatePosition, true)

  let destroyed = false
  return {
    element: overlay,
    setTarget(next: HTMLElement | null): void {
      if (destroyed) return
      currentTarget = next
      if (next) {
        overlay.style.display = ''
        positionOverTarget(overlay, next)
      } else {
        overlay.style.display = 'none'
      }
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      win.removeEventListener('scroll', updatePosition, true)
      overlay.remove()
      currentTarget = null
    },
  }
}
