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
import { t } from '@shrubbery/nucleus'
import type { ShInjerto } from '../object-view/injerto-element.js'
import '../object-view/injerto-element.js'
import { OBJECT_VIEW_INTENT_EVENT, type ObjectViewIntent } from '../object-view/object-view-element.js'
import { objectModelOfRead } from '../object-view/typed-object-service.js'
import { isMnemosyneLink, linkOfTarget, parseLink, recordOfElement, recordOfTarget } from './links.js'
import {
  WB_CARD_EVENT,
  type WbCanvasApi,
  type WbCardAddedDetail,
  type WbCardHost,
  type WbCardRenderer,
  type WbCreateElement,
  type WbSidebarNode,
  type WbTarget,
  type WbTypedObjects,
  type WbTypedObjectsSource,
} from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'
import type { WhiteboardPageOptions } from './sh-whiteboard.js'

export interface WbCardHostOptions {
  readonly createElement: WbCreateElement
  readonly typedObjects: WbTypedObjectsSource
  /** The board's graph: the default for a card whose snapshot names none. */
  readonly graphId: string
}

const CARD_WIDTH = 320
const CARD_HEIGHT = 180
const SIDEBAR_MIME = 'application/x-shrubbery-sidebar-node'

function serviceOf(source: WbTypedObjectsSource): WbTypedObjects | null {
  return typeof source === 'function' ? source() : source
}

/** Is this a live card: type `embeddable`, not deleted, with a `mnemosyne://` document or object link? */
export function isCard(element: WbElement): boolean {
  if (element.type !== 'embeddable' || element.isDeleted === true) return false
  const parsed = parseLink(element.link)
  return parsed !== null && (parsed.kind === 'document' || parsed.kind === 'object')
}

// ---- the renderer ---------------------------------------------------------------------------------------------------

interface CardRenderer {
  render: WbCardRenderer
  /** Cancel the read behind one card node. */
  release(card: HTMLElement): void
  /** Cancel every read in flight. */
  dispose(): void
}

function emptyCard(theme: 'light' | 'dark', element: WbElement): HTMLElement {
  const card = document.createElement('div')
  card.className = 'wb-card'
  card.dataset.theme = theme
  card.dataset.cardId = element.id
  const height = typeof element.height === 'number' ? element.height : CARD_HEIGHT
  card.style.cssText =
    'display:block;width:100%;height:100%;box-sizing:border-box;overflow:auto;' +
    `color-scheme:${theme};--sh-injerto-max-height:${Math.max(80, Math.round(height - 70))}px;` +
    'color:var(--mn-color-text-primary);font:13px/1.5 var(--mn-font-chrome, system-ui, sans-serif);'
  return card
}

function labelCard(card: HTMLElement, text: string, note: string): void {
  const box = document.createElement('div')
  box.style.cssText =
    'padding:10px 12px;display:grid;gap:4px;height:100%;box-sizing:border-box;border:1px dashed var(--mn-color-border-default);' +
    'border-radius:var(--mn-radius-surface, 8px);background:var(--mn-color-surface-raised);'
  const what = document.createElement('span')
  what.textContent = text
  what.style.fontWeight = '600'
  const small = document.createElement('span')
  small.textContent = note
  small.style.color = 'var(--mn-color-text-secondary)'
  box.append(what, small)
  card.replaceChildren(box)
}

function buildRenderer(source: WbTypedObjectsSource, defaultGraph: string): CardRenderer {
  const cancels = new Map<HTMLElement, () => void>()

  const drawObject = (card: HTMLElement, element: WbElement, graphId: string, iri: string): void => {
    const record = recordOfElement(element)
    const frame = document.createElement('sh-injerto') as ShInjerto
    frame.iri = iri
    frame.graphId = graphId
    frame.label = record?.kind === 'object' ? record.label : ''
    frame.classLabel = record?.kind === 'object' ? record.classLabel : ''
    frame.style.margin = '0'
    card.replaceChildren(frame)
    let live = true
    cancels.set(card, () => {
      live = false
    })
    let service: WbTypedObjects | null = null
    try {
      service = serviceOf(source)
    } catch {
      service = null
    }
    if (!service) {
      frame.status = 'error'
      frame.error = 'this board has no typed-object reader'
      return
    }
    frame.status = 'loading'
    let pending: Promise<unknown>
    try {
      pending = service.read(graphId, iri).then(
        (result) => {
          if (!live) return
          if (!result) {
            frame.model = null
            frame.status = 'absent'
            return
          }
          try {
            frame.model = objectModelOfRead(result)
            frame.status = 'ready'
          } catch (error) {
            frame.model = null
            frame.error = error instanceof Error ? error.message : String(error)
            frame.status = 'error'
          }
        },
        (error: unknown) => {
          if (!live) return
          frame.model = null
          frame.error = error instanceof Error ? error.message : String(error)
          frame.status = 'error'
        },
      )
    } catch (error) {
      frame.error = error instanceof Error ? error.message : String(error)
      frame.status = 'error'
      return
    }
    void pending
  }

  const drawDocument = (card: HTMLElement, element: WbElement, graphId: string, documentId: string): void => {
    const record = recordOfElement(element)
    const title = record?.kind === 'document' && record.title ? record.title : documentId
    const box = document.createElement('div')
    box.className = 'wb-card-document'
    box.style.cssText =
      'display:flex;align-items:center;gap:10px;padding:10px 12px;height:100%;box-sizing:border-box;' +
      'border:1px solid var(--mn-color-border-default);border-radius:var(--mn-radius-surface, 8px);' +
      'background:var(--mn-color-surface-raised);'
    const glyph = document.createElement('span')
    glyph.textContent = '▤'
    glyph.setAttribute('aria-hidden', 'true')
    glyph.style.cssText = 'font-size:22px;color:var(--mn-color-text-secondary);flex:none;'
    const name = document.createElement('span')
    name.className = 'wb-card-title'
    name.textContent = title
    name.style.cssText = 'flex:1;min-width:0;font-weight:600;overflow-wrap:anywhere;'
    const open = document.createElement('button')
    open.type = 'button'
    open.textContent = t('Open')
    open.title = t('Open it full size')
    open.style.cssText =
      'flex:none;font:inherit;font-size:12px;padding:1px 10px;border-radius:999px;cursor:pointer;' +
      'border:1px solid var(--mn-color-border-default);background:var(--mn-color-surface-raised);color:inherit;'
    // Excalidraw hands the card pointer events only once it is active; Open is the one control that works before.
    open.style.pointerEvents = 'auto'
    open.addEventListener('pointerdown', (event) => event.stopPropagation())
    open.addEventListener('click', () => {
      const intent: ObjectViewIntent = { kind: 'open-document', documentId, blockId: null, graphId: graphId || null }
      card.dispatchEvent(new CustomEvent(OBJECT_VIEW_INTENT_EVENT, { detail: { intent }, bubbles: true, composed: true }))
    })
    box.append(glyph, name, open)
    card.replaceChildren(box)
  }

  const render: WbCardRenderer = (element, theme) => {
    const card = emptyCard(theme, element)
    try {
      // The injerto's events are composed already; the card re-dispatches them from itself so they cross Excalidraw's
      // shadow root as one event the shell's document-level handler hears once.
      card.addEventListener(OBJECT_VIEW_INTENT_EVENT, (event) => {
        if (event.target === card) return
        event.stopPropagation()
        const detail = (event as CustomEvent).detail
        card.dispatchEvent(new CustomEvent(OBJECT_VIEW_INTENT_EVENT, { detail, bubbles: true, composed: true }))
      })
      const parsed = parseLink(element.link)
      if (parsed?.kind === 'object') drawObject(card, element, parsed.graphId || defaultGraph, parsed.iri)
      else if (parsed?.kind === 'document') drawDocument(card, element, parsed.graphId || defaultGraph, parsed.documentId)
      else labelCard(card, 'Not a card', typeof element.link === 'string' ? element.link : 'no link')
    } catch (error) {
      labelCard(card, 'Could not draw this card', error instanceof Error ? error.message : String(error))
    }
    return card
  }

  return {
    render,
    release(card) {
      cancels.get(card)?.()
      cancels.delete(card)
    },
    dispose() {
      for (const cancel of cancels.values()) cancel()
      cancels.clear()
    },
  }
}

/** The renderer contract: an element and a theme in, the injerto node out. Never throws. */
export function makeCardRenderer(source: WbTypedObjectsSource, graphId: string): WbCardRenderer {
  return buildRenderer(source, graphId).render
}

function cardContentKey(element: WbElement): string {
  const custom = (element as { customData?: Record<string, unknown> }).customData
  return JSON.stringify([element.link ?? null, custom?.mnemosyne ?? null])
}

/** The pair of Excalidraw props (`renderEmbeddable`, `validateEmbeddable`) over a {@link makeCardRenderer}. */
export function createCardHost(options: WbCardHostOptions): WbCardHost {
  const renderer = buildRenderer(options.typedObjects, options.graphId)
  const entries = new Map<string, { key: string; theme: 'light' | 'dark'; node: unknown; card: HTMLElement }>()
  return {
    renderEmbeddable(element, appState) {
      const theme = appState?.theme === 'dark' ? 'dark' : 'light'
      // What draws a card is its link, the snapshot it remembers and the theme. `version` also moves on every drag or
      // resize frame, which would rebuild the DOM and re-read the object per frame.
      const key = cardContentKey(element)
      const have = entries.get(element.id)
      if (have && have.key === key && have.theme === theme) return have.node
      if (have) renderer.release(have.card)
      const card = renderer.render(element, theme)
      const node = options.createElement('div', {
        key: element.id,
        ref: (host: HTMLElement | null) => {
          if (host && card.parentNode !== host) host.replaceChildren(card)
        },
        // No pointer-events override: Excalidraw's container is inert until a centre click activates the card, so the
        // canvas still selects, drags, resizes and binds arrows to it.
        style: { width: '100%', height: '100%' },
      })
      entries.set(element.id, { key, theme, node, card })
      return node
    },
    validateEmbeddable(link) {
      return isMnemosyneLink(link)
    },
    dispose() {
      renderer.dispose()
      for (const entry of entries.values()) entry.card.remove()
      entries.clear()
    },
  }
}

// ---- the skeleton -----------------------------------------------------------------------------------------------------

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** gardend `index_after`: a fractional index that sorts after `max`. */
function indexAfter(max: string | null): string {
  if (!max) return 'a0'
  const head = max.charCodeAt(0)
  if (head < 97 || head > 121) return `${max}V`
  const intLen = head - 97 + 2
  if (max.length < intLen) return `${max}V`
  const digits = max.slice(1, intLen).split('')
  let i = digits.length
  for (;;) {
    if (i === 0) {
      const nextHead = head + 1
      return String.fromCharCode(nextHead) + '0'.repeat(nextHead - 97 + 1)
    }
    i -= 1
    const at = B62.indexOf(digits[i]!)
    if (at < 0) return `${max}V`
    if (at + 1 < B62.length) {
      digits[i] = B62[at + 1]!
      break
    }
    digits[i] = B62[0]!
  }
  return String.fromCharCode(head) + digits.join('')
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

function randomId(): string {
  const bytes = new Uint8Array(21)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length]
  return out
}

function randomInt(): number {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]! % 2_000_000_000
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
  let max: string | null = null
  for (const e of existing) if (typeof e.index === 'string' && e.index !== '' && (max === null || e.index > max)) max = e.index
  return {
    id: randomId(),
    type: 'embeddable',
    x: at.x,
    y: at.y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    angle: 0,
    strokeColor: '#1d1c19',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: indexAfter(max),
    roundness: null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: [],
    updated: now,
    link: linkOfTarget(target),
    locked: false,
    customData: { sophia: { by: actor, at: now }, mnemosyne: recordOfTarget(target) },
  }
}

/** Client (viewport) pixels to scene coordinates: `(client - stageOffset) / zoom - scroll`. */
export function sceneFromClient(
  client: { readonly x: number; readonly y: number },
  appState: Record<string, any>,
  stageOffset: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number } {
  const zoom = Number(appState?.zoom?.value) > 0 ? Number(appState.zoom.value) : 1
  const scrollX = Number(appState?.scrollX) || 0
  const scrollY = Number(appState?.scrollY) || 0
  return { x: (client.x - stageOffset.left) / zoom - scrollX, y: (client.y - stageOffset.top) / zoom - scrollY }
}

/** The dragged sidebar node, from `application/x-shrubbery-sidebar-node` JSON; `null` when absent or malformed. */
export function readSidebarDrop(data: Pick<DataTransfer, 'getData' | 'types'>): WbSidebarNode | null {
  try {
    if (!Array.from(data.types ?? []).includes(SIDEBAR_MIME)) return null
    const raw = JSON.parse(data.getData(SIDEBAR_MIME)) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.kind !== 'string' || raw.kind === '') return null
    const node: { id: string; kind: string; parentId?: string | null; section?: string | null } = { id: raw.id, kind: raw.kind }
    if (typeof raw.parentId === 'string' || raw.parentId === null) node.parentId = raw.parentId
    if (typeof raw.section === 'string' || raw.section === null) node.section = raw.section
    return node
  } catch {
    return null
  }
}

/** What the add-card flow and the drop target need of their host (the same shape as the bar's deps). */
export interface WbCardFlowDeps {
  readonly eventTarget: EventTarget
  readonly page: () => WhiteboardPageOptions | null
  readonly api: () => WbCanvasApi | null
  readonly notify: (message: string) => void
}

function nameOf(target: WbTarget): string {
  return target.kind === 'document' ? target.title || target.documentId : target.label || target.iri
}

/** Put a card for `target` on the board at `at` (top-left), select it and announce it. */
function placeCard(deps: WbCardFlowDeps, target: WbTarget, at: { x: number; y: number }): WbElement | null {
  const api = deps.api()
  if (!api) {
    deps.notify(t('The board is not ready yet'))
    return null
  }
  const all = api.getSceneElementsIncludingDeleted() as readonly WbElement[]
  const card = cardSkeleton(target, at, all, 'person', Date.now())
  api.updateScene({
    elements: [...all, card],
    appState: { selectedElementIds: { [card.id]: true } },
    captureUpdate: 'IMMEDIATELY',
  })
  const detail: WbCardAddedDetail = { elementId: card.id, target }
  deps.eventTarget.dispatchEvent(new CustomEvent(WB_CARD_EVENT, { detail, bubbles: true, composed: true }))
  deps.notify(t('whiteboard.addedCard', { name: nameOf(target) }))
  return card
}

/**
 * Add card… : `page.pickLink({accept: 'any', heading: 'Add a card', ...})`, build the skeleton at `at` (default: the
 * centre of the visible canvas), add it with `api.updateScene`, select it, dispatch `WB_CARD_EVENT`. Resolves to the
 * new element, or `null` when cancelled, read-only, or the page has no picker.
 */
export async function addCard(deps: WbCardFlowDeps, at?: { readonly x: number; readonly y: number }): Promise<WbElement | null> {
  const page = deps.page()
  if (!page) return null
  if (page.readOnly) {
    deps.notify(t('This board is read-only'))
    return null
  }
  if (!page.pickLink) {
    deps.notify(t('Cards need the graph: this board cannot pick a document or object'))
    return null
  }
  let target: WbTarget | null
  try {
    target = await page.pickLink({ graphId: page.graphId, get heading() { return t('Add a card') }, accept: 'any', excludeDocumentId: page.documentId })
  } catch (error) {
    deps.notify(error instanceof Error ? error.message : 'Could not pick a card')
    return null
  }
  if (!target) return null
  let where = at
  if (!where) {
    const app = deps.api()?.getAppState() ?? {}
    const zoom = Number(app.zoom?.value) > 0 ? Number(app.zoom.value) : 1
    const cx = (Number(app.width) || 0) / 2 / zoom - (Number(app.scrollX) || 0)
    const cy = (Number(app.height) || 0) / 2 / zoom - (Number(app.scrollY) || 0)
    where = { x: cx - CARD_WIDTH / 2, y: cy - CARD_HEIGHT / 2 }
  }
  return placeCard(deps, target, { x: where.x, y: where.y })
}

/**
 * Make `stage` a drop target for sidebar nodes: `dragover` accepts `application/x-shrubbery-sidebar-node` with
 * `dropEffect = 'move'`; `drop` resolves the node with `page.targetOfSidebarNode`, converts the pointer to scene
 * coordinates and adds a card there. Returns the detach function.
 */
export function attachSidebarDrop(stage: HTMLElement, deps: WbCardFlowDeps): () => void {
  const carries = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes(SIDEBAR_MIME)
  const onOver = (event: Event): void => {
    const drag = event as DragEvent
    if (!carries(drag) || deps.page()?.readOnly) return
    drag.preventDefault()
    if (drag.dataTransfer) drag.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (event: Event): void => {
    const drag = event as DragEvent
    if (!carries(drag)) return
    drag.preventDefault()
    const page = deps.page()
    if (!page || page.readOnly) return
    const node = drag.dataTransfer ? readSidebarDrop(drag.dataTransfer) : null
    if (!node) return
    const target = page.targetOfSidebarNode?.(node) ?? null
    if (!target) {
      deps.notify(t('A board can only hold documents and objects'))
      return
    }
    const rect = stage.getBoundingClientRect()
    const at = sceneFromClient({ x: drag.clientX, y: drag.clientY }, deps.api()?.getAppState() ?? {}, { left: rect.left, top: rect.top })
    placeCard(deps, target, { x: at.x, y: at.y })
  }
  stage.addEventListener('dragover', onOver)
  stage.addEventListener('drop', onDrop)
  return () => {
    stage.removeEventListener('dragover', onOver)
    stage.removeEventListener('drop', onDrop)
  }
}
