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
import { t } from '@shrubbery/nucleus'
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import {
  WB_WIRE_EVENT,
  type WbArrowEnd,
  type WbArrowEnds,
  type WbCanvasApi,
  type WbWireChangedDetail,
  type WbWireMark,
} from './semantic-types.js'
import type { WbElement } from './whiteboard-binding.js'
import { recordOfElement, targetOfElement } from './links.js'

export interface WbArrowWireDeps {
  readonly eventTarget: EventTarget
  readonly page: () => WhiteboardPageOptions | null
  readonly api: () => WbCanvasApi | null
  readonly notify: (message: string) => void
}

/** The words of a text element, or `null` when it has none. */
function wordsOf(e: WbElement | undefined): string | null {
  if (!e || e.isDeleted === true) return null
  const raw = typeof e.originalText === 'string' ? e.originalText : typeof e.text === 'string' ? e.text : ''
  return raw.trim() === '' ? null : raw
}

/** The live bound text of `container`: through `boundElements` first, then by `containerId`. */
function boundTextOf(elements: readonly WbElement[], container: WbElement): string | null {
  const byId = new Map(elements.map((e) => [e.id, e] as const))
  const bound = Array.isArray(container.boundElements) ? (container.boundElements as Array<{ type?: string; id?: string }>) : []
  for (const b of bound) {
    if (b?.type !== 'text' || typeof b.id !== 'string') continue
    const words = wordsOf(byId.get(b.id))
    if (words !== null) return words
  }
  for (const e of elements) {
    if (e.type === 'text' && e.containerId === container.id) {
      const words = wordsOf(e)
      if (words !== null) return words
    }
  }
  return null
}

/** `customData.mnemosyneWire` of an element, or `null` when absent or malformed (no `wireId` or `predicate`). */
export function wireMarkOf(element: { readonly customData?: Record<string, unknown> }): WbWireMark | null {
  const raw = element.customData?.mnemosyneWire as Record<string, unknown> | null | undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const wireId = raw.wireId
  const predicate = raw.predicate
  if (typeof wireId !== 'string' || wireId === '' || typeof predicate !== 'string' || predicate === '') return null
  return {
    wireId,
    predicate,
    ...(typeof raw.strokeWas === 'string' || raw.strokeWas === null ? { strokeWas: raw.strokeWas as string | null } : {}),
    ...(typeof raw.labelFromPredicate === 'boolean' ? { labelFromPredicate: raw.labelFromPredicate } : {}),
  }
}

function endOf(elements: readonly WbElement[], binding: unknown): WbArrowEnd | null {
  const id = (binding as { elementId?: unknown } | null | undefined)?.elementId
  if (typeof id !== 'string') return null
  const byId = new Map(elements.map((e) => [e.id, e] as const))
  let end = byId.get(id)
  // Bound text stands for its container.
  if (end && end.type === 'text' && typeof end.containerId === 'string') end = byId.get(end.containerId)
  if (!end || end.isDeleted === true) return null
  const record = recordOfElement(end)
  const snapshot = record ? (record.kind === 'document' ? record.title : record.label) : ''
  return {
    elementId: end.id,
    label: boundTextOf(elements, end) ?? (snapshot.trim() !== '' ? snapshot : end.type),
    refersTo: targetOfElement(end as { link?: unknown; customData?: Record<string, unknown> }),
  }
}

/**
 * The two ends of `arrowId` in `elements`, named for a person. An end is the element in `startBinding.elementId` /
 * `endBinding.elementId` (bound text resolved to its container); `label` is the shape's words, the card's snapshot
 * label, or its kind; `refersTo` is `targetOfElement` of the end. `null` when the arrow is missing, deleted, not an
 * arrow, or either end is unbound or deleted (the same cases gardend's `wire` move refuses).
 */
export function arrowEndsOf(elements: readonly WbElement[], arrowId: string): WbArrowEnds | null {
  const arrow = elements.find((e) => e.id === arrowId)
  if (!arrow || arrow.isDeleted === true || arrow.type !== 'arrow') return null
  const from = endOf(elements, arrow.startBinding)
  const to = endOf(elements, arrow.endBinding)
  if (!from || !to) return null
  return { arrowId, from, to, label: boundTextOf(elements, arrow) }
}

function dispatchWire(eventTarget: EventTarget, detail: WbWireChangedDetail): void {
  eventTarget.dispatchEvent(new CustomEvent(WB_WIRE_EVENT, { detail, bubbles: true, composed: true }))
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : typeof error === 'string' && error ? error : fallback
}

/**
 * Make wire… : ends from `arrowEndsOf`, predicate from `page.pickPredicate` (suggestion: the arrow's label), then
 * `page.promoteArrow`. Dispatches `WB_WIRE_EVENT` with the new mark and resolves to it. Resolves to `null` (and
 * tells the person via `notify`) when cancelled, read-only, the arrow has a dangling end, the arrow is already wired,
 * or the page lacks the options; a failing `promoteArrow` is reported through `notify` and resolves `null`.
 */
export async function promoteSelectedArrow(deps: WbArrowWireDeps, arrowId: string): Promise<WbWireMark | null> {
  const page = deps.page()
  const api = deps.api()
  if (!page) return null
  if (page.readOnly) { deps.notify(t('This board is read-only.')); return null }
  if (!api || !page.pickPredicate || !page.promoteArrow) { deps.notify(t('Wires are not available on this board.')); return null }
  const elements = api.getSceneElementsIncludingDeleted() as readonly WbElement[]
  const arrow = elements.find((e) => e.id === arrowId)
  if (arrow && wireMarkOf(arrow)) { deps.notify(t('This arrow is already a wire.')); return null }
  const ends = arrowEndsOf(elements, arrowId)
  if (!ends) { deps.notify(t('Connect both ends of the arrow to shapes before making it a wire.')); return null }

  let predicate: string | null
  try {
    predicate = await page.pickPredicate({ graphId: page.graphId, ends, suggestion: ends.label })
  } catch (error) {
    deps.notify(messageOf(error, t('Could not choose a predicate.')))
    return null
  }
  const chosen = predicate?.trim() ?? ''
  if (chosen === '') return null

  // The page may have been replaced while the person chose: ask the current one, never a cached function.
  const current = deps.page()
  if (!current?.promoteArrow) return null
  if (current.readOnly) { deps.notify(t('This board is read-only.')); return null }
  try {
    const result = await current.promoteArrow({ graphId: current.graphId, documentId: current.documentId, arrowId, predicate: chosen })
    const mark: WbWireMark = { wireId: result.wireId, predicate: result.predicate }
    dispatchWire(deps.eventTarget, { arrowId, wire: mark })
    return mark
  } catch (error) {
    deps.notify(messageOf(error, t('Could not make this arrow a wire.')))
    return null
  }
}

/** Excalidraw's capture action: a wire's removal is not something Ctrl+Z may bring back as a mark. */
const CAPTURE_NEVER = 'NEVER'

/**
 * Unwire: `page.demoteArrow` deletes the wire, then the arrow on the canvas loses `customData.mnemosyneWire`, gets
 * `mark.strokeWas` back as `strokeColor`, and loses its label when `mark.labelFromPredicate`. Dispatches
 * `WB_WIRE_EVENT` with `wire: null`. Resolves true when the mark was cleared.
 */
export async function unwireArrow(deps: WbArrowWireDeps, arrowId: string): Promise<boolean> {
  const page = deps.page()
  const api = deps.api()
  if (!page || !api) return false
  const before = (api.getSceneElementsIncludingDeleted() as readonly WbElement[]).find((e) => e.id === arrowId)
  const mark = before ? wireMarkOf(before) : null
  if (!before || !mark) return false
  if (page.readOnly) { deps.notify(t('This board is read-only.')); return false }
  if (!page.demoteArrow) { deps.notify(t('Wires are not available on this board.')); return false }
  try {
    await page.demoteArrow({ graphId: page.graphId, documentId: page.documentId, arrowId, wireId: mark.wireId })
  } catch (error) {
    deps.notify(messageOf(error, t('Could not remove this wire.')))
    return false
  }

  // Now the canvas, read fresh: a collaborator may have moved things while the wire was going.
  const live = deps.api() ?? api
  const all = live.getSceneElementsIncludingDeleted() as readonly WbElement[]
  const arrow = all.find((e) => e.id === arrowId)
  if (!arrow || arrow.isDeleted === true) return false
  const now = Date.now()
  const nonce = () => Math.floor(Math.random() * 2_000_000_000)
  const labelIds = new Set<string>()
  if (mark.labelFromPredicate === true) {
    const bound = Array.isArray(arrow.boundElements) ? (arrow.boundElements as Array<{ type?: string; id?: string }>) : []
    for (const b of bound) if (b?.type === 'text' && typeof b.id === 'string') labelIds.add(b.id)
    for (const e of all) if (e.type === 'text' && e.containerId === arrowId) labelIds.add(e.id)
  }
  const { mnemosyneWire: _mark, ...restData } = (arrow.customData ?? {}) as Record<string, unknown>
  void _mark
  const elements = all.map((e): WbElement => {
    if (e.id === arrowId) {
      const kept = Array.isArray(e.boundElements)
        ? (e.boundElements as Array<{ id?: string }>).filter((b) => !(typeof b?.id === 'string' && labelIds.has(b.id)))
        : e.boundElements
      return {
        ...e,
        customData: restData,
        ...(typeof mark.strokeWas === 'string' ? { strokeColor: mark.strokeWas } : {}),
        ...(kept !== undefined ? { boundElements: kept } : {}),
        version: e.version + 1,
        versionNonce: nonce(),
        updated: now,
      }
    }
    if (labelIds.has(e.id) && e.isDeleted !== true) {
      return { ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce(), updated: now }
    }
    return e
  })
  live.updateScene({ elements, captureUpdate: CAPTURE_NEVER })
  dispatchWire(deps.eventTarget, { arrowId, wire: null })
  return true
}
