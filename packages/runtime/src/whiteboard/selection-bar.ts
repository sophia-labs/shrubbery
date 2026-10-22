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
import {
  WB_LINK_EVENT,
  WB_SELECTION_EVENT,
  type WbBacklinkTarget,
  type WbBounds,
  type WbCanvasApi,
  type WbLinkChangedDetail,
  type WbSelection,
  type WbSelectionKind,
  type WbTarget,
} from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'
import { isMnemosyneLink, linkOfTarget, recordOfTarget, targetOfElement } from './links.js'
import { arrowEndsOf, promoteSelectedArrow, unwireArrow, wireMarkOf } from './arrow-wire.js'
import { addCard } from './card-embed.js'

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

type Loose = Record<string, any>

/** Height of the bar, px. The CSS gives the bar exactly this height so `barAnchor` can place it without measuring. */
export const BAR_HEIGHT = 40
/** Gap between the selection and the bar, px. */
export const BAR_GAP = 8
/** Used until the bar has been laid out and can be measured. */
const BAR_WIDTH_GUESS = 280

function isBoundText(e: WbElement): boolean {
  return e.type === 'text' && typeof e.containerId === 'string' && e.containerId !== ''
}

function isLive(e: WbElement | undefined): e is WbElement {
  return !!e && e.isDeleted !== true
}

/**
 * Pure: the selection in `elements` per `appState.selectedElementIds`. Deleted elements and bound text are ignored
 * (a selected container stands for its text). `kind`: none, one shape, one card (an `embeddable` with a `mnemosyne://`
 * link), one arrow, or multiple. `target`/`link` come from the one element's `link` and snapshot (`links.ts`),
 * `wire` from `customData.mnemosyneWire`.
 */
export function selectionOf(elements: readonly WbElement[], appState: Record<string, any>): WbSelection {
  const chosen = (appState?.selectedElementIds ?? {}) as Record<string, unknown>
  const byId = new Map<string, WbElement>()
  for (const e of elements) byId.set(e.id, e)
  const picked = new Set<string>()
  for (const [id, on] of Object.entries(chosen)) {
    if (!on) continue
    const e = byId.get(id)
    if (!isLive(e)) continue
    if (isBoundText(e)) {
      // A bound label stands for its container: counted once through the container, never on its own.
      const container = byId.get(String(e.containerId))
      if (isLive(container)) picked.add(container.id)
      continue
    }
    picked.add(e.id)
  }
  // Scene order, so the result does not depend on the order of the selection map.
  const selected = elements.filter((e) => picked.has(e.id) && isLive(e) && !isBoundText(e))
  const ids = selected.map((e) => e.id)
  const bounds = boundsOf(selected)
  if (selected.length === 0) {
    return { kind: 'none', ids, elementId: null, bounds: null, target: null, link: null, wire: null }
  }
  if (selected.length > 1) {
    return { kind: 'multiple', ids, elementId: null, bounds, target: null, link: null, wire: null }
  }
  const one = selected[0]!
  const rawLink = typeof one.link === 'string' && one.link !== '' ? (one.link as string) : null
  const target = targetOfElement(one as { link?: unknown; customData?: Record<string, unknown> })
  let kind: WbSelectionKind = 'shape'
  if (one.type === 'arrow') kind = 'arrow'
  else if (one.type === 'embeddable' && isMnemosyneLink(rawLink)) kind = 'card'
  return {
    kind,
    ids,
    elementId: one.id,
    bounds,
    target,
    link: rawLink,
    wire: kind === 'arrow' ? wireMarkOf(one) : null,
  }
}

/** The union of bounds of `elements` in scene coordinates, rotation ignored; `null` for an empty list. */
export function boundsOf(elements: readonly WbElement[]): WbBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const e of elements) {
    const x = Number(e.x)
    const y = Number(e.y)
    const w = Number(e.width ?? 0)
    const h = Number(e.height ?? 0)
    if (![x, y, w, h].every(Number.isFinite)) continue
    // A flipped element can carry a negative extent; the box is the same either way.
    minX = Math.min(minX, x, x + w)
    minY = Math.min(minY, y, y + h)
    maxX = Math.max(maxX, x, x + w)
    maxY = Math.max(maxY, y, y + h)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
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
  const zoom = Number(appState?.zoom?.value) || 1
  const scrollX = Number(appState?.scrollX) || 0
  const scrollY = Number(appState?.scrollY) || 0
  // sceneCoordsToViewportCoords with the stage at the origin: (x + scroll) * zoom.
  const x = (bounds.x + scrollX) * zoom
  const y = (bounds.y + scrollY) * zoom
  const w = bounds.w * zoom
  const h = bounds.h * zoom
  const below = y + h + BAR_GAP
  const above = below + BAR_HEIGHT > stage.height
  const rawTop = above ? y - BAR_GAP - BAR_HEIGHT : below
  return {
    left: clamp(x + w / 2 - barWidth / 2, 0, stage.width - barWidth),
    top: clamp(rawTop, 0, stage.height - BAR_HEIGHT),
    above,
  }
}

// ---- what the bar offers --------------------------------------------------------------------------------------

export type WbBarActionId = 'link' | 'unlink' | 'open' | 'wire' | 'unwire' | 'card'

export interface WbBarAction {
  readonly id: WbBarActionId
  readonly label: string
}

/**
 * Pure: the buttons for `selection` on `page`, in order. Editing actions need an editable page and the option that
 * performs them (a missing `pickLink` means no Link… and no Add card…); Open needs only a link and a way to open it.
 * `elements` lets the Make wire… offer check that both ends of the arrow are bound.
 */
export function actionsFor(
  selection: WbSelection,
  page: WhiteboardPageOptions | null,
  elements: readonly WbElement[] = [],
): readonly WbBarAction[] {
  if (!page || selection.elementId === null) return []
  const out: WbBarAction[] = []
  const editable = page.readOnly !== true
  const canOpen = !!selection.link && !!page.onOpenLink
  if (selection.kind === 'shape') {
    if (editable && page.pickLink) out.push({ id: 'link', label: selection.link ? 'Relink…' : 'Link…' })
    if (editable && selection.link) out.push({ id: 'unlink', label: 'Unlink' })
    if (canOpen) out.push({ id: 'open', label: 'Open' })
  } else if (selection.kind === 'card') {
    if (canOpen) out.push({ id: 'open', label: 'Open' })
  } else if (selection.kind === 'arrow' && editable) {
    if (selection.wire) {
      if (page.demoteArrow) out.push({ id: 'unwire', label: 'Unwire' })
    } else if (page.pickPredicate && page.promoteArrow && arrowEndsOf(elements, selection.elementId)) {
      out.push({ id: 'wire', label: 'Make wire…' })
    }
  }
  if (editable && page.pickLink) out.push({ id: 'card', label: 'Add card…' })
  return out
}

function selectionKey(selection: WbSelection): string {
  return [selection.kind, selection.ids.join(','), selection.link ?? '', selection.wire?.wireId ?? '', selection.wire?.predicate ?? ''].join('|')
}

function backlinkTargetOf(target: WbTarget): WbBacklinkTarget {
  return target.kind === 'document'
    ? { graphId: target.graphId, documentId: target.documentId }
    : { graphId: target.graphId, iri: target.iri }
}

function dispatch(eventTarget: EventTarget, type: string, detail: unknown): void {
  eventTarget.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
}

function stageSize(stage: HTMLElement): { width: number; height: number } {
  const rect = stage.getBoundingClientRect()
  return { width: rect.width || stage.clientWidth || 800, height: rect.height || stage.clientHeight || 600 }
}

function interacting(state: Loose): boolean {
  return !!(
    state.selectedElementsAreBeingDragged || state.isResizing || state.isRotating ||
    state.editingTextElement || state.newElement || state.resizingElement || state.multiElement
  )
}

export function createSelectionBar(deps: WbSelectionBarDeps): WbSelectionBar {
  const doc = deps.stage.ownerDocument
  const bar = doc.createElement('div')
  bar.className = 'selbar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Selection actions')
  bar.hidden = true
  deps.stage.appendChild(bar)

  // Nothing selected is where it starts: the first announcement is the first real selection.
  let announced = selectionKey(selectionOf([], {}))
  let renderedKey = ''
  let dismissedKey = ''
  let backlinkToken = 0
  const backlinkCache = new Map<string, number>()
  let destroyed = false

  const hide = (): void => {
    bar.hidden = true
    renderedKey = ''
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    dismissedKey = announced
    hide()
  }
  bar.addEventListener('keydown', onKeyDown)

  const run = (id: WbBarActionId, selection: WbSelection): void => {
    const elementId = selection.elementId
    if (!elementId) return
    const page = deps.page()
    switch (id) {
      case 'link': void linkElement(deps, elementId); break
      case 'unlink': unlinkElement(deps, elementId); break
      case 'open':
        if (selection.link && page?.onOpenLink && !page.onOpenLink(selection.link)) deps.notify('This link cannot be opened here.')
        break
      case 'wire': void promoteSelectedArrow(deps, elementId); break
      case 'unwire': void unwireArrow(deps, elementId); break
      case 'card': void addCard(deps); break
    }
  }

  const paint = (selection: WbSelection, actions: readonly WbBarAction[]): void => {
    bar.replaceChildren()
    for (const action of actions) {
      const button = doc.createElement('button')
      button.type = 'button'
      button.dataset.action = action.id
      button.textContent = action.label
      button.setAttribute('aria-label', action.label.replace('…', ''))
      button.addEventListener('click', () => run(action.id, selection))
      bar.appendChild(button)
    }
    const note = doc.createElement('span')
    note.className = 'selbar-note'
    note.setAttribute('role', 'status')
    note.hidden = true
    bar.appendChild(note)
  }

  /** "Linked from N": asked once per target and shown when the page can answer and N is above zero. */
  const showBacklinks = (selection: WbSelection): void => {
    const page = deps.page()
    const target = selection.target
    const note = bar.querySelector<HTMLElement>('.selbar-note')
    if (!note || !target || !page?.loadBacklinks || (selection.kind !== 'shape' && selection.kind !== 'card')) return
    const request = backlinkTargetOf(target)
    const key = `${request.graphId}|${request.documentId ?? ''}|${request.iri ?? ''}`
    const apply = (count: number): void => {
      if (count > 0) { note.textContent = `Linked from ${count}`; note.hidden = false } else { note.hidden = true }
    }
    const known = backlinkCache.get(key)
    if (known !== undefined) { apply(known); return }
    const token = ++backlinkToken
    page.loadBacklinks(request).then(
      (rows) => {
        backlinkCache.set(key, rows.length)
        if (!destroyed && token === backlinkToken && bar.contains(note)) apply(rows.length)
      },
      () => { /* the count is a courtesy; a failed read shows nothing */ },
    )
  }

  const update = (): void => {
    if (destroyed) return
    const api = deps.api()
    const page = deps.page()
    if (!api) { hide(); return }
    let elements: readonly WbElement[]
    let state: Loose
    try {
      elements = api.getSceneElementsIncludingDeleted() as readonly WbElement[]
      state = api.getAppState()
    } catch { hide(); return }
    const selection = selectionOf(elements, state)
    const key = selectionKey(selection)
    if (key !== announced) {
      announced = key
      dismissedKey = ''
      dispatch(deps.eventTarget, WB_SELECTION_EVENT, selection)
      try { page?.onSelection?.(selection) } catch { /* the shell's listener must not break the canvas */ }
    }
    const actions = actionsFor(selection, page, elements)
    if (!selection.bounds || actions.length === 0 || interacting(state) || dismissedKey === key || state.showHyperlinkPopup === 'editor') {
      hide()
      return
    }
    const wasHidden = bar.hidden
    const actionKey = `${key}#${actions.map((a) => a.label).join(',')}`
    if (wasHidden || actionKey !== renderedKey) {
      paint(selection, actions)
      renderedKey = actionKey
      bar.hidden = false
      showBacklinks(selection)
    }
    const width = bar.offsetWidth || BAR_WIDTH_GUESS
    const at = barAnchor(selection.bounds, state, stageSize(deps.stage), width)
    bar.style.left = `${Math.round(at.left)}px`
    bar.style.top = `${Math.round(at.top)}px`
    bar.dataset.placement = at.above ? 'above' : 'below'
  }

  return {
    update,
    destroy(): void {
      destroyed = true
      bar.removeEventListener('keydown', onKeyDown)
      bar.remove()
    },
  }
}

function freshNonce(): number {
  return Math.floor(Math.random() * 2_000_000_000)
}

/** Excalidraw's capture action: IMMEDIATELY puts a person's link edit on their undo stack. */
const CAPTURE_IMMEDIATELY = 'IMMEDIATELY'

function replaceElement(api: WbCanvasApi, elementId: string, change: (e: WbElement) => WbElement | null): WbElement | null {
  const all = api.getSceneElementsIncludingDeleted() as readonly WbElement[]
  const index = all.findIndex((e) => e.id === elementId)
  const found = all[index]
  if (!found || found.isDeleted === true) return null
  const next = change(found)
  if (!next) return null
  // Excalidraw's own mutations bump version, nonce and `updated`; the binding diffs by version, so a raw copy must too.
  const bumped: WbElement = { ...next, version: found.version + 1, versionNonce: freshNonce(), updated: Date.now() }
  const elements = all.slice()
  elements[index] = bumped
  api.updateScene({ elements, captureUpdate: CAPTURE_IMMEDIATELY })
  return bumped
}

/**
 * Link… : `page.pickLink({accept: 'any', ...})`, then write `link` and `customData.mnemosyne` onto the element with
 * `api.updateScene` (after `showHyperlinkPopup: false`, because the hidden popup writes its value back on unmount),
 * then dispatch `WB_LINK_EVENT`. Resolves to the target, or `null` when the person cancelled or the page has no picker.
 */
export async function linkElement(deps: WbSelectionBarDeps, elementId: string): Promise<WbTarget | null> {
  const page = deps.page()
  const api = deps.api()
  if (!page || !api) return null
  if (page.readOnly) { deps.notify('This board is read-only.'); return null }
  if (!page.pickLink) return null
  // The popup first: it writes its own value back to the element when it unmounts, which would undo our link.
  api.updateScene({ appState: { showHyperlinkPopup: false } })
  let target: WbTarget | null
  try {
    target = await page.pickLink({ graphId: page.graphId, heading: 'Link to…', accept: 'any', excludeDocumentId: page.documentId })
  } catch (error) {
    deps.notify(error instanceof Error ? error.message : 'Could not open the link picker.')
    return null
  }
  if (!target) return null
  const picked: WbTarget = target
  const live = deps.api()
  if (!live) return null
  const written = replaceElement(live, elementId, (e) => ({
    ...e,
    link: linkOfTarget(picked),
    customData: { ...(e.customData ?? {}), mnemosyne: recordOfTarget(picked) },
  }))
  if (!written) { deps.notify('That shape is gone.'); return null }
  const detail: WbLinkChangedDetail = { elementId, target: picked }
  dispatch(deps.eventTarget, WB_LINK_EVENT, detail)
  return picked
}

/** Unlink: clear `link` and `customData.mnemosyne`, dispatch `WB_LINK_EVENT` with `target: null`. */
export function unlinkElement(deps: WbSelectionBarDeps, elementId: string): void {
  const page = deps.page()
  const api = deps.api()
  if (!api) return
  if (page?.readOnly) { deps.notify('This board is read-only.'); return }
  api.updateScene({ appState: { showHyperlinkPopup: false } })
  const written = replaceElement(api, elementId, (e) => {
    const { mnemosyne: _gone, ...rest } = (e.customData ?? {}) as Record<string, unknown>
    void _gone
    return { ...e, link: null, customData: rest }
  })
  if (!written) return
  const detail: WbLinkChangedDetail = { elementId, target: null }
  dispatch(deps.eventTarget, WB_LINK_EVENT, detail)
}
