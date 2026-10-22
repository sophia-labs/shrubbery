/**
 * Arrow to wire in the app (SPRINT D9): on a selected arrow, pick a predicate (`page.pickPredicate`), then ask
 * gardend to promote it (`page.promoteArrow`, which the shell implements as `whiteboard_apply {moves: [{op: 'wire',
 * arrow, predicate}]}`). The promotion rule lives in gardend, in one place; this file only asks. The result reaches
 * the canvas through the room like any other write: gardend marks the arrow `customData.mnemosyneWire`, gives it
 * the accent stroke and (if it has no label) the predicate as its label, so a wired arrow reads as wired for every
 * viewer, agent-promoted or person-promoted alike.
 *
 * Owned by S4. The signatures below are FINAL; S4 replaces the bodies (and may add private helpers and exports).
 */
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import type { WbArrowEnds, WbCanvasApi, WbWireMark } from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'

export interface WbArrowWireDeps {
  readonly eventTarget: EventTarget
  readonly page: () => WhiteboardPageOptions | null
  readonly api: () => WbCanvasApi | null
  readonly notify: (message: string) => void
}

/** `customData.mnemosyneWire` of an element, or `null` when absent or malformed (no `wireId` or `predicate`). */
export function wireMarkOf(element: { readonly customData?: Record<string, unknown> }): WbWireMark | null {
  void element
  throw new Error('S4')
}

/**
 * The two ends of `arrowId` in `elements`, named for a person. An end is the element in `startBinding.elementId` /
 * `endBinding.elementId` (bound text resolved to its container); `label` is the shape's words, the card's snapshot
 * label, or its kind; `refersTo` is `targetOfElement` of the end. `null` when the arrow is missing, deleted, not an
 * arrow, or either end is unbound or deleted (the same cases gardend's `wire` move refuses).
 */
export function arrowEndsOf(elements: readonly WbElement[], arrowId: string): WbArrowEnds | null {
  void [elements, arrowId]
  throw new Error('S4')
}

/**
 * Make wire… : ends from `arrowEndsOf`, predicate from `page.pickPredicate` (suggestion: the arrow's label), then
 * `page.promoteArrow`. Dispatches `WB_WIRE_EVENT` with the new mark and resolves to it. Resolves to `null` (and
 * tells the person via `notify`) when cancelled, read-only, the arrow has a dangling end, the arrow is already wired,
 * or the page lacks the options; a failing `promoteArrow` is reported through `notify` and resolves `null`.
 */
export function promoteSelectedArrow(deps: WbArrowWireDeps, arrowId: string): Promise<WbWireMark | null> {
  void [deps, arrowId]
  throw new Error('S4')
}

/**
 * Unwire: `page.demoteArrow` deletes the wire, then the arrow on the canvas loses `customData.mnemosyneWire`, gets
 * `mark.strokeWas` back as `strokeColor`, and loses its label when `mark.labelFromPredicate`. Dispatches
 * `WB_WIRE_EVENT` with `wire: null`. Resolves true when the mark was cleared.
 */
export function unwireArrow(deps: WbArrowWireDeps, arrowId: string): Promise<boolean> {
  void [deps, arrowId]
  throw new Error('S4')
}
