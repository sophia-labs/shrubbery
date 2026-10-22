/**
 * The selection bar (SPRINT D8): an overlay child of the stage, anchored under the selection, that offers
 * Link… / Unlink / Open on a shape, Make wire… / Unwire on an arrow, Open on a card, and Add card…. Excalidraw has no
 * public context-menu or properties-panel slot, so the bar is ours: it is positioned from the selection's bounds
 * (`sceneCoordsToViewportCoords` reduces to `(x + scrollX) * zoom` here) minus the stage's offsets.
 *
 * Owned by S2. The signatures below are FINAL; S2 replaces the bodies (and may add private helpers and exports).
 * S2 also owns `sh-whiteboard.ts`: it mounts the bar, passes `createCardHost(...)`'s `renderEmbeddable` and
 * `validateEmbeddable`, calls `attachSidebarDrop`, and does the offline hardening.
 */
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import type { WbBounds, WbCanvasApi, WbSelection, WbTarget } from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'

/** What the bar needs of its host. The bar reads `page()` and `api()` on every use, never caches them. */
export interface WbSelectionBarDeps {
  /** The `.stage` element: the bar is appended to it, absolutely positioned. */
  readonly stage: HTMLElement
  /** The `<sh-whiteboard>` element: events are dispatched on it. */
  readonly eventTarget: EventTarget
  readonly page: () => WhiteboardPageOptions | null
  readonly api: () => WbCanvasApi | null
  /** A short status line (the board's `notice`). */
  readonly notify: (message: string) => void
}

export interface WbSelectionBar {
  /** Re-read the selection and re-anchor (called from Excalidraw's `onChange`). Also calls `page.onSelection` and
   *  dispatches `WB_SELECTION_EVENT`, but only when the selection changed. */
  update(): void
  destroy(): void
}

/**
 * Pure: the selection in `elements` per `appState.selectedElementIds`. Deleted elements and bound text are ignored
 * (a selected container stands for its text). `kind`: none, one shape, one card (an `embeddable` with a `mnemosyne://`
 * link), one arrow, or multiple. `target`/`link` come from the one element's `link` and snapshot (`links.ts`),
 * `wire` from `customData.mnemosyneWire`.
 */
export function selectionOf(elements: readonly WbElement[], appState: Record<string, any>): WbSelection {
  void [elements, appState]
  throw new Error('S2')
}

/** The union of bounds of `elements` in scene coordinates, rotation ignored; `null` for an empty list. */
export function boundsOf(elements: readonly WbElement[]): WbBounds | null {
  void elements
  throw new Error('S2')
}

/**
 * Pure: where the bar goes, in stage pixels. `appState` supplies `scrollX`, `scrollY` and `zoom.value`; `stage` is the
 * stage's size. The bar sits below the selection (`above: false`) unless that would leave the stage, then above;
 * `left` is the selection's centre clamped so a bar `barWidth` wide stays inside.
 */
export function barAnchor(
  bounds: WbBounds,
  appState: Record<string, any>,
  stage: { readonly width: number; readonly height: number },
  barWidth: number,
): { readonly left: number; readonly top: number; readonly above: boolean } {
  void [bounds, appState, stage, barWidth]
  throw new Error('S2')
}

export function createSelectionBar(deps: WbSelectionBarDeps): WbSelectionBar {
  void deps
  throw new Error('S2')
}

/**
 * Link… : `page.pickLink({accept: 'any', ...})`, then write `link` and `customData.mnemosyne` onto the element with
 * `api.updateScene` (after `showHyperlinkPopup: false`, because the hidden popup writes its value back on unmount),
 * then dispatch `WB_LINK_EVENT`. Resolves to the target, or `null` when the person cancelled or the page has no picker.
 */
export function linkElement(deps: WbSelectionBarDeps, elementId: string): Promise<WbTarget | null> {
  void [deps, elementId]
  throw new Error('S2')
}

/** Unlink: clear `link` and `customData.mnemosyne`, dispatch `WB_LINK_EVENT` with `target: null`. */
export function unlinkElement(deps: WbSelectionBarDeps, elementId: string): void {
  void [deps, elementId]
  throw new Error('S2')
}
