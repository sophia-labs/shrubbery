/**
 * Cards on the board (SPRINT D7): a typed object or a document as a live `embeddable` element. Excalidraw calls
 * `renderEmbeddable(element, appState)` on every render, so the host memoises on `element.id` + `element.version` +
 * theme; the node it returns is `<sh-injerto>` around `<sh-object-view slot="card">`, read live through the
 * typed-object seam (the `editor-services/object-embed-renderer.ts` pattern), with the snapshot label when the object
 * is gone. Cards are DOM, above the canvas, so the canvas's dark-mode filter does not invert them: they are themed
 * from `appState.theme`.
 *
 * Owned by S3. The signatures below are FINAL; S3 replaces the bodies (and may add private helpers and exports).
 * Card intents (`open-object`, `open-document`, ...) are `OBJECT_VIEW_INTENT_EVENT` events from the injerto: the
 * card lives in Excalidraw's shadow root, so the host re-dispatches them `bubbles` + `composed` from the card node
 * for the shell's document-level `onObjectViewIntent`.
 */
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import type {
  WbCanvasApi,
  WbCardHost,
  WbCardRenderer,
  WbCreateElement,
  WbSidebarNode,
  WbTarget,
  WbTypedObjectsSource,
} from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'

export interface WbCardHostOptions {
  readonly createElement: WbCreateElement
  readonly typedObjects: WbTypedObjectsSource
  /** The board's graph: the default for a card whose snapshot names none. */
  readonly graphId: string
}

/** Is this a live card: type `embeddable`, not deleted, with a `mnemosyne://` document or object link? */
export function isCard(element: WbElement): boolean {
  void element
  throw new Error('S3')
}

/** The renderer contract: an element and a theme in, the injerto node out. Never throws. */
export function makeCardRenderer(source: WbTypedObjectsSource, graphId: string): WbCardRenderer {
  void [source, graphId]
  throw new Error('S3')
}

/** The pair of Excalidraw props (`renderEmbeddable`, `validateEmbeddable`) over a {@link makeCardRenderer}. */
export function createCardHost(options: WbCardHostOptions): WbCardHost {
  void options
  throw new Error('S3')
}

/**
 * A new `embeddable` element for `target`, at scene point `at`: size 320 x 180, a fresh 21-character id, `index` after
 * the highest in `existing`, `link` from `links.ts`, `customData.mnemosyne` the snapshot and `customData.sophia
 * {by: actor, at: now}`, Excalidraw's required fields filled the way gardend's `base_element` fills them.
 */
export function cardSkeleton(
  target: WbTarget,
  at: { readonly x: number; readonly y: number },
  existing: readonly WbElement[],
  actor: string,
  now: number,
): WbElement {
  void [target, at, existing, actor, now]
  throw new Error('S3')
}

/** Client (viewport) pixels to scene coordinates: `(client - stageOffset) / zoom - scroll`. */
export function sceneFromClient(
  client: { readonly x: number; readonly y: number },
  appState: Record<string, any>,
  stageOffset: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number } {
  void [client, appState, stageOffset]
  throw new Error('S3')
}

/** The dragged sidebar node, from `application/x-shrubbery-sidebar-node` JSON; `null` when absent or malformed. */
export function readSidebarDrop(data: Pick<DataTransfer, 'getData' | 'types'>): WbSidebarNode | null {
  void data
  throw new Error('S3')
}

/** What the add-card flow and the drop target need of their host (the same shape as the bar's deps). */
export interface WbCardFlowDeps {
  readonly eventTarget: EventTarget
  readonly page: () => WhiteboardPageOptions | null
  readonly api: () => WbCanvasApi | null
  readonly notify: (message: string) => void
}

/**
 * Add card… : `page.pickLink({accept: 'any', heading: 'Add a card', ...})`, build the skeleton at `at` (default: the
 * centre of the visible canvas), add it with `api.updateScene`, select it, dispatch `WB_CARD_EVENT`. Resolves to the
 * new element, or `null` when cancelled, read-only, or the page has no picker.
 */
export function addCard(deps: WbCardFlowDeps, at?: { readonly x: number; readonly y: number }): Promise<WbElement | null> {
  void [deps, at]
  throw new Error('S3')
}

/**
 * Make `stage` a drop target for sidebar nodes: `dragover` accepts `application/x-shrubbery-sidebar-node` with
 * `dropEffect = 'move'`; `drop` resolves the node with `page.targetOfSidebarNode`, converts the pointer to scene
 * coordinates and adds a card there. Returns the detach function.
 */
export function attachSidebarDrop(stage: HTMLElement, deps: WbCardFlowDeps): () => void {
  void [stage, deps]
  throw new Error('S3')
}
