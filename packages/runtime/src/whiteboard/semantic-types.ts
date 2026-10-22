/**
 * The whiteboard's semantic surface: the types the four Shrubbery units (S1 the shell, S2 the selection bar and link
 * picker, S3 cards, S4 arrow-to-wire) and the board itself share. FINAL: no unit edits this file; a unit that needs
 * a field it does not find stops and says so rather than adding one. plans/2026-10-21-whiteboard-semantics/INTERFACES.md
 * is the contract these types belong to.
 *
 * Vocabulary, as the board stores it (gardend `whiteboard/links.rs` is the Rust twin):
 *  - an element's `link` is `mnemosyne://document/<graph>/<id>`, `mnemosyne://object/<graph>/<encoded iri>` or
 *    `mnemosyne://artifact/<graph>/<id>` (see `links.ts`); anything else is a web address and means nothing to the graph;
 *  - `customData.mnemosyne` is the snapshot the board keeps of the target ({@link WbMnemosyneRecord});
 *  - `customData.mnemosyneWire` marks an arrow promoted to a wire ({@link WbWireMark});
 *  - a card is an Excalidraw `embeddable` element whose link is a document or object link.
 */
import type { TypedObjectService } from '../object-view/typed-object-service.js'
import type { WbElement } from './whiteboard-binding.js'

/** A document of the graph (a board is a document too: `documentKind` says so). */
export interface WbDocumentTarget {
  readonly kind: 'document'
  readonly graphId: string
  readonly documentId: string
  readonly title: string
  /** The workspace `documentKind` when it has one (`whiteboard`, `flow-board`). */
  readonly documentKind?: string | null
}

/** A typed object of the graph. */
export interface WbObjectTarget {
  readonly kind: 'object'
  readonly graphId: string
  readonly iri: string
  readonly label: string
  readonly classLabel: string
}

/** What a shape's link or a card points at, and what the pickers hand back. */
export type WbTarget = WbDocumentTarget | WbObjectTarget

/** `customData.mnemosyne`: the snapshot kept so a card or link can still name its target when the target is gone. */
export type WbMnemosyneRecord =
  | { readonly kind: 'document'; readonly graphId: string; readonly id: string; readonly title: string }
  | { readonly kind: 'object'; readonly graphId: string; readonly iri: string; readonly label: string; readonly classLabel: string }

/** `customData.mnemosyneWire`: written by gardend's `wire` move, cleared by unwiring. */
export interface WbWireMark {
  readonly wireId: string
  /** The short predicate name (`supports`) or a predicate IRI. */
  readonly predicate: string
  /** The arrow's stroke colour before promotion, restored on unwire. */
  readonly strokeWas?: string | null
  /** True when the arrow had no label and the move wrote the predicate as its label; unwire removes that label. */
  readonly labelFromPredicate?: boolean
}

/** The minimal Excalidraw API the semantic modules use; `sh-whiteboard.ts` passes its own, which is structurally this. */
export interface WbCanvasApi {
  getSceneElementsIncludingDeleted(): readonly unknown[]
  getAppState(): Record<string, any>
  updateScene(data: Record<string, unknown>): void
}

/** React's `createElement`, handed in by `loadExcalidraw()` so no module imports React itself. */
export type WbCreateElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown

/** A rectangle in scene coordinates. */
export interface WbBounds {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type WbSelectionKind = 'none' | 'shape' | 'card' | 'arrow' | 'multiple'

/** What is selected, as `selectionOf` (S2) reads it and `onSelection` / {@link WB_SELECTION_EVENT} report it. */
export interface WbSelection {
  readonly kind: WbSelectionKind
  /** Every selected element id (bound text excluded when its container is selected). */
  readonly ids: readonly string[]
  /** The one element the bar acts on: the selected shape, card or arrow. `null` for none or multiple. */
  readonly elementId: string | null
  /** The union of the selected elements' bounds in scene coordinates; `null` for none. */
  readonly bounds: WbBounds | null
  /** The element's link target, when it has a `mnemosyne://` link (a web address is not a target). */
  readonly target: WbTarget | null
  /** The element's raw `link`, web addresses included. */
  readonly link: string | null
  /** The arrow's wire mark, when it was promoted. */
  readonly wire: WbWireMark | null
}

/** `pickLink`: choose a document or a typed object. The shell shows `chooseFrom` over both. */
export interface WbPickLinkRequest {
  readonly graphId: string
  /** The dialog heading: `Link to…`, `Add a card`. */
  readonly heading: string
  /** `any`: documents and objects; `object`/`document`: only that kind. */
  readonly accept: 'any' | 'object' | 'document'
  /** The board's own id, left out of the choices (a board does not link to itself). */
  readonly excludeDocumentId?: string
}

/** One end of an arrow, named for a person: what the predicate menu shows. */
export interface WbArrowEnd {
  readonly elementId: string
  /** The shape's words, or the card's label, or the shape kind. */
  readonly label: string
  /** What the end becomes as a wire end: its document, its object, or the shape itself as a block of the board. */
  readonly refersTo: WbTarget | null
}

export interface WbArrowEnds {
  readonly arrowId: string
  readonly from: WbArrowEnd
  readonly to: WbArrowEnd
  /** The arrow's own label, if any. */
  readonly label: string | null
}

/** `pickPredicate`: choose the wire's predicate (the shell shows `<mn-advanced-wire-menu>` over `list_wire_predicates`). */
export interface WbPredicateRequest {
  readonly graphId: string
  readonly ends: WbArrowEnds
  /** The arrow's label, offered as the starting text. */
  readonly suggestion: string | null
}

/** `promoteArrow`: the shell calls `whiteboard_apply {moves: [{op: 'wire', arrow, predicate}]}` and returns the mark. */
export interface WbPromoteRequest {
  readonly graphId: string
  readonly documentId: string
  readonly arrowId: string
  readonly predicate: string
}

export interface WbPromoteResult {
  readonly wireId: string
  readonly predicate: string
}

/** `demoteArrow`: the shell deletes the wire. Resolves when it is gone (a wire already gone is not an error). */
export interface WbDemoteRequest {
  readonly graphId: string
  readonly documentId: string
  readonly arrowId: string
  readonly wireId: string
}

/** What `get_backlinks` is asked about: exactly one of `documentId` and `iri`. */
export interface WbBacklinkTarget {
  readonly graphId: string
  readonly documentId?: string
  readonly iri?: string
  readonly blockId?: string
}

export type WbBacklinkKind = 'wire' | 'embed' | 'wikilink' | 'link' | 'board-link' | 'board-card' | 'board-connection'

/** One incoming pointer: gardend's `Backlink` row, camelCase, absent options omitted. */
export interface WbBacklink {
  readonly kind: WbBacklinkKind
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string
  readonly sourceTitle?: string
  readonly sourceKind?: string
  readonly predicate?: string
  readonly wireId?: string
  readonly viaConnection?: string
}

/** `get_backlinks`'s whole answer. */
export interface WbBacklinksResult {
  readonly graphId: string
  readonly target: { readonly documentId?: string; readonly iri?: string; readonly blockId?: string }
  readonly backlinks: readonly WbBacklink[]
  readonly count: number
}

/** A typed object found by `search`: the card picker's and `/object`'s row. */
export interface WbObjectHit {
  readonly iri: string
  readonly classIri: string
  readonly classLabel: string
  readonly title: string
}

/** The typed-object seam a board needs: `read` for cards (live), `search` for pickers. The shell's reader is this. */
export interface WbTypedObjects extends TypedObjectService {
  search(graphId: string): Promise<readonly WbObjectHit[]>
}

/** A source of typed objects: the service, or a function that finds it late. */
export type WbTypedObjectsSource = WbTypedObjects | (() => WbTypedObjects | null)

/**
 * The card renderer contract (SPRINT U0): an element and the theme in, a DOM node out. The node is
 * `<sh-injerto>` around `<sh-object-view slot="card">`, live against the typed-object seam. It never throws: a card
 * whose target is gone, unreadable or not an object draws its snapshot label honestly.
 */
export type WbCardRenderer = (element: WbElement, theme: 'light' | 'dark') => HTMLElement

/** The pair Excalidraw takes as props, plus the teardown. */
export interface WbCardHost {
  /** Excalidraw's `renderEmbeddable(element, appState)`: a React node, memoised on `element.id` + `element.version` + theme. */
  renderEmbeddable(element: WbElement, appState: { readonly theme?: string }): unknown
  /** Excalidraw's `validateEmbeddable(link)`: true only for a `mnemosyne://` link. Never returns undefined or a RegExp. */
  validateEmbeddable(link: unknown): boolean
  /** Drop every mounted card and any read in flight. */
  dispose(): void
}

/** What a sidebar drag carries (`application/x-shrubbery-sidebar-node`). */
export interface WbSidebarNode {
  readonly id: string
  readonly kind: string
  readonly parentId?: string | null
  readonly section?: string | null
}

// ---- events -------------------------------------------------------------------------------------------------------
// Dispatched by `<sh-whiteboard>` on itself (`bubbles`, `composed`). The page options (`onSelection`, ...) are the
// shell's direct channel; the events are for hosts that only hold the element.

/** The selection changed. `detail`: {@link WbSelection}. */
export const WB_SELECTION_EVENT = 'sh-whiteboard-selection'
/** A shape got or lost a link. `detail`: {@link WbLinkChangedDetail}. */
export const WB_LINK_EVENT = 'sh-whiteboard-link'
/** A card was added. `detail`: {@link WbCardAddedDetail}. */
export const WB_CARD_EVENT = 'sh-whiteboard-card'
/** An arrow was promoted to a wire or unwired. `detail`: {@link WbWireChangedDetail}. */
export const WB_WIRE_EVENT = 'sh-whiteboard-wire'

export interface WbLinkChangedDetail {
  readonly elementId: string
  /** `null`: the link was removed. */
  readonly target: WbTarget | null
}

export interface WbCardAddedDetail {
  readonly elementId: string
  readonly target: WbTarget
}

export interface WbWireChangedDetail {
  readonly arrowId: string
  /** `null`: the arrow was unwired. */
  readonly wire: WbWireMark | null
}
