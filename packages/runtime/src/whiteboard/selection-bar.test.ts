/**
 * The selection bar against the shared v2 fixture: the pure readers on its real elements, and the link flow against
 * real Yjs and the real `WhiteboardBinding` over a small real scene model (the same model `whiteboard-binding.test.ts`
 * uses, here also answering the canvas API). The page options are plain functions that record their calls and
 * resolve with real values: they are the far side of the seam, the shell's job.
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import fixture from './fixtures/whiteboard-fixture-v2-semantic.json'
import { WB_LINK_EVENT, WB_SELECTION_EVENT, type WbCanvasApi, type WbLinkChangedDetail, type WbObjectTarget, type WbPickLinkRequest, type WbSelection, type WbTarget } from './semantic-types.js'
import {
  actionsFor, barAnchor, boundsOf, createSelectionBar, linkActionApplies, linkElement, selectionOf, unlinkElement, type WbSelectionBarDeps,
} from './selection-bar.js'
import type { WhiteboardPageOptions } from './sh-whiteboard.js'
import { type WbElement, type WbScene, WhiteboardBinding } from './whiteboard-binding.js'

const ELEMENTS = fixture.elements as unknown as WbElement[]
const BOX = 'box0000000000000000001'
const NOTE = 'note000000000000000001'
const LNK = 'lnk0000000000000000001'
const CRD = 'crd0000000000000000001'
const ARW1 = 'arw0000000000000000001'
const ARW2 = 'arw0000000000000000002'
const ARW3 = 'arw0000000000000000003'
const DEL = 'del0000000000000000001'
const TXT1 = 'txt0000000000000000001'
const WOLF = 'urn:mnemosyne:local:graph:wb-graph:dream:wolf-man'

const pick = (...ids: string[]): Record<string, any> => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) })

/** A scene and a canvas API in one: the binding's port and the bar's `api`, the way the pane adapts Excalidraw. */
class Canvas implements WbScene, WbCanvasApi {
  elements: WbElement[]
  state: Record<string, any> = { selectedElementIds: {}, scrollX: 0, scrollY: 0, zoom: { value: 1 } }
  calls: Array<Record<string, any>> = []
  onChange: () => void = () => {}
  constructor(elements: readonly WbElement[]) { this.elements = [...elements] }
  getElements(): readonly WbElement[] { return this.elements }
  setElements(elements: readonly WbElement[]): void { this.elements = [...elements] }
  busyIds(): ReadonlySet<string> { return new Set() }
  getSceneElementsIncludingDeleted(): readonly unknown[] { return this.elements }
  getAppState(): Record<string, any> { return this.state }
  updateScene(data: Record<string, unknown>): void {
    this.calls.push(data)
    if (data.elements) this.elements = [...(data.elements as WbElement[])]
    if (data.appState) this.state = { ...this.state, ...(data.appState as Record<string, any>) }
    this.onChange()
  }
  find(id: string): Record<string, any> { return this.elements.find((e) => e.id === id) as Record<string, any> }
}

function seeded(): { doc: Y.Doc; canvas: Canvas; binding: WhiteboardBinding } {
  const doc = new Y.Doc()
  doc.transact(() => {
    const map = doc.getMap<string>('elements')
    for (const e of ELEMENTS) map.set(e.id, JSON.stringify(e))
  }, 'server')
  const binding = new WhiteboardBinding(doc, { throttleMs: 0, schedule: (cb) => { cb(); return 1 }, cancel: () => {} })
  const canvas = new Canvas(binding.initialElements())
  binding.attach(canvas)
  // Excalidraw's onChange, then the pointer-up flush the pane also does.
  canvas.onChange = () => { binding.localChanged(); binding.flushNow() }
  return { doc, canvas, binding }
}

interface Rig {
  deps: WbSelectionBarDeps
  canvas: Canvas
  notices: string[]
  picks: WbPickLinkRequest[]
  popupAtPick: unknown[]
  events: WbLinkChangedDetail[]
  opened: string[]
  selections: WbSelection[]
}

function rig(canvas: Canvas, over: Partial<WhiteboardPageOptions> & { answer?: WbTarget | null } = {}): Rig {
  const notices: string[] = []
  const picks: WbPickLinkRequest[] = []
  const popupAtPick: unknown[] = []
  const events: WbLinkChangedDetail[] = []
  const opened: string[] = []
  const selections: WbSelection[] = []
  const eventTarget = new EventTarget()
  eventTarget.addEventListener(WB_LINK_EVENT, (e) => events.push((e as CustomEvent<WbLinkChangedDetail>).detail))
  const answer = 'answer' in over ? over.answer! : ({ kind: 'object', graphId: 'wb-graph', iri: WOLF, label: 'The Wolf Man dream', classLabel: 'DreamReport' } satisfies WbObjectTarget)
  const { answer: _a, ...options } = over
  void _a
  const page: WhiteboardPageOptions = {
    graphId: 'wb-graph', documentId: 'wb-board', title: 'Dream-work board', status: 'ready', provider: null,
    pickLink: async (request) => { picks.push(request); popupAtPick.push(canvas.state.showHyperlinkPopup); return answer },
    onOpenLink: (link) => { opened.push(link); return true },
    onSelection: (s) => selections.push(s),
    ...options,
  }
  const deps: WbSelectionBarDeps = { stage: document.createElement('div'), eventTarget, page: () => page, api: () => canvas, notify: (m) => notices.push(m) }
  return { deps, canvas, notices, picks, popupAtPick, events, opened, selections }
}

describe('selectionOf on the v2 fixture', () => {
  it('selection_of_a_linked_shape', () => {
    const s = selectionOf(ELEMENTS, pick(LNK))
    expect(s.kind).toBe('shape')
    expect(s.ids).toEqual([LNK])
    expect(s.elementId).toBe(LNK)
    expect(s.link).toBe('mnemosyne://document/wb-graph/doc-traumdeutung')
    expect(s.target).toEqual({ kind: 'document', graphId: 'wb-graph', documentId: 'doc-traumdeutung', title: 'The Interpretation of Dreams' })
    expect(s.wire).toBeNull()
    expect(s.bounds).toEqual({ x: 100, y: 300, w: 220, h: 80 })
  })

  it('selection_of_a_card', () => {
    const s = selectionOf(ELEMENTS, pick(CRD))
    expect(s.kind).toBe('card')
    expect(s.elementId).toBe(CRD)
    expect(s.target).toEqual({ kind: 'object', graphId: 'wb-graph', iri: WOLF, label: 'The Wolf Man dream', classLabel: 'DreamReport' })
    // An embeddable with a web address is not a card.
    const web = ELEMENTS.map((e) => (e.id === CRD ? { ...e, link: 'https://example.org/' } : e))
    expect(selectionOf(web, pick(CRD)).kind).toBe('shape')
    expect(selectionOf(web, pick(CRD)).target).toBeNull()
    expect(selectionOf(web, pick(CRD)).link).toBe('https://example.org/')
  })

  it('selection_of_a_wired_arrow', () => {
    const s = selectionOf(ELEMENTS, pick(ARW2))
    expect(s.kind).toBe('arrow')
    expect(s.wire).toEqual({ wireId: 'wire-wb-0001', predicate: 'supports', strokeWas: '#1d1c19', labelFromPredicate: true })
    expect(selectionOf(ELEMENTS, pick(ARW1)).wire).toBeNull()
    expect(selectionOf(ELEMENTS, pick(ARW1)).kind).toBe('arrow')
  })

  it('selection_ignores_deleted_and_bound_text', () => {
    // Deleted element dropped, bound text stands for its container (counted once).
    const both = selectionOf(ELEMENTS, pick(DEL, TXT1, BOX))
    expect(both.ids).toEqual([BOX])
    expect(both.kind).toBe('shape')
    // Bound text alone is its container.
    expect(selectionOf(ELEMENTS, pick(TXT1)).ids).toEqual([BOX])
    // Only a deleted element: nothing.
    expect(selectionOf(ELEMENTS, pick(DEL)).kind).toBe('none')
    // An id the scene does not hold.
    expect(selectionOf(ELEMENTS, pick('nope')).kind).toBe('none')
    // Bound text of a deleted container selects nothing.
    const gone = ELEMENTS.map((e) => (e.id === BOX ? { ...e, isDeleted: true } : e))
    expect(selectionOf(gone, pick(TXT1)).kind).toBe('none')
  })

  it('selection_of_nothing_and_of_many', () => {
    const none = selectionOf(ELEMENTS, { selectedElementIds: {} })
    expect(none).toEqual({ kind: 'none', ids: [], elementId: null, bounds: null, target: null, link: null, wire: null })
    expect(selectionOf(ELEMENTS, {}).kind).toBe('none')
    expect(selectionOf(ELEMENTS, { selectedElementIds: { [BOX]: false } }).kind).toBe('none')
    const many = selectionOf(ELEMENTS, pick(NOTE, BOX))
    expect(many.kind).toBe('multiple')
    expect(many.ids).toEqual([BOX, NOTE]) // scene order, not selection order
    expect(many.elementId).toBeNull()
    expect(many.target).toBeNull()
    expect(many.bounds).toEqual({ x: 100, y: 100, w: 560, h: 80 })
  })
})

describe('bounds and placement', () => {
  it('bounds_of_unions_the_elements', () => {
    const by = (id: string) => ELEMENTS.find((e) => e.id === id)!
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([by(BOX)])).toEqual({ x: 100, y: 100, w: 300, h: 80 })
    expect(boundsOf([by(BOX), by(NOTE)])).toEqual({ x: 100, y: 100, w: 560, h: 80 })
    expect(boundsOf([by(BOX), by(LNK)])).toEqual({ x: 100, y: 100, w: 300, h: 280 })
    // A flipped (negative-extent) element covers the same box.
    expect(boundsOf([{ ...by(BOX), x: 400, width: -300 }])).toEqual({ x: 100, y: 100, w: 300, h: 80 })
  })

  it('bar_anchor_sits_below_then_flips_above_and_stays_inside', () => {
    const state = { scrollX: 10, scrollY: 20, zoom: { value: 2 } }
    const bounds = { x: 100, y: 100, w: 200, h: 50 } // viewport: x 220, y 240, w 400, h 100
    const stage = { width: 1000, height: 800 }
    const below = barAnchor(bounds, state, stage, 200)
    expect(below).toEqual({ left: 320, top: 348, above: false })
    // Not enough room under the selection: above it.
    const flipped = barAnchor(bounds, state, { width: 1000, height: 380 }, 200)
    expect(flipped.above).toBe(true)
    expect(flipped.top).toBe(192)
    expect(flipped.top + 40).toBeLessThanOrEqual(240)
    // Horizontal clamps at both edges.
    expect(barAnchor({ x: -500, y: 0, w: 10, h: 10 }, state, stage, 200).left).toBe(0)
    expect(barAnchor({ x: 5000, y: 0, w: 10, h: 10 }, state, stage, 200).left).toBe(800)
    // A selection filling the stage: the bar still stays inside it.
    const tall = barAnchor({ x: 0, y: 0, w: 100, h: 800 }, { zoom: { value: 1 } }, stage, 200)
    expect(tall.above).toBe(true)
    expect(tall.top).toBe(0)
    // Defaults: no scroll, no zoom.
    expect(barAnchor({ x: 10, y: 10, w: 20, h: 20 }, {}, stage, 100)).toEqual({ left: 0, top: 38, above: false })
  })
})

describe('Link and Unlink', () => {
  it('link_element_writes_link_and_record_and_closes_the_popup_first', async () => {
    const { doc, canvas } = seeded()
    canvas.state = { ...canvas.state, showHyperlinkPopup: 'editor' } // the popup is open when Ctrl+K fires
    const r = rig(canvas)
    const before = canvas.find(BOX)
    const target = await linkElement(r.deps, BOX)
    expect(target).toEqual({ kind: 'object', graphId: 'wb-graph', iri: WOLF, label: 'The Wolf Man dream', classLabel: 'DreamReport' })
    // The picker was asked for documents and objects, never the board itself.
    expect(r.picks).toEqual([{ graphId: 'wb-graph', heading: 'Link to…', accept: 'any', excludeDocumentId: 'wb-board' }])
    // The hyperlink popup was already closed when the picker opened, and the first canvas call closed it.
    expect(r.popupAtPick).toEqual([false])
    expect(canvas.calls[0]).toEqual({ appState: { showHyperlinkPopup: false } })
    // The element on the canvas.
    const after = canvas.find(BOX)
    expect(after.link).toBe('mnemosyne://object/wb-graph/urn%3Amnemosyne%3Alocal%3Agraph%3Awb-graph%3Adream%3Awolf-man')
    expect(after.customData.mnemosyne).toEqual({ kind: 'object', graphId: 'wb-graph', iri: WOLF, label: 'The Wolf Man dream', classLabel: 'DreamReport' })
    expect(after.customData.sophia).toBeTruthy()
    expect(after.version).toBe(before.version + 1)
    expect(after.versionNonce).not.toBe(before.versionNonce)
    expect(canvas.calls[1]!.captureUpdate).toBe('IMMEDIATELY')
    // The binding carried it to the room.
    const stored = JSON.parse(doc.getMap<string>('elements').get(BOX)!)
    expect(stored.link).toBe(after.link)
    expect(stored.customData.mnemosyne.kind).toBe('object')
    expect(stored.customData.sophia.by).toBe('person')
    // And announced it.
    expect(r.events).toEqual([{ elementId: BOX, target }])
  })

  it('a cancelled or unavailable picker writes nothing', async () => {
    const { canvas } = seeded()
    const cancelled = rig(canvas, { answer: null })
    expect(await linkElement(cancelled.deps, BOX)).toBeNull()
    expect(canvas.find(BOX).link ?? null).toBeNull()
    expect(cancelled.events).toEqual([])
    const noPicker = rig(canvas, { pickLink: undefined })
    const calls = canvas.calls.length
    expect(await linkElement(noPicker.deps, BOX)).toBeNull()
    expect(canvas.calls.length).toBe(calls)
    // The element vanished while the person chose.
    const gone = rig(canvas)
    const pickAndDelete = { ...gone, deps: { ...gone.deps, page: () => ({ ...gone.deps.page()!, pickLink: async () => { canvas.elements = canvas.elements.filter((e) => e.id !== BOX); return { kind: 'document', graphId: 'wb-graph', documentId: 'd', title: 'D' } as WbTarget } }) } }
    expect(await linkElement(pickAndDelete.deps, BOX)).toBeNull()
    expect(gone.notices).toEqual(['That shape is gone.'])
  })

  it('unlink_element_clears_both', () => {
    const { doc, canvas } = seeded()
    const r = rig(canvas)
    unlinkElement(r.deps, LNK)
    const after = canvas.find(LNK)
    expect(after.link).toBeNull()
    expect(after.customData.mnemosyne).toBeUndefined()
    expect(after.customData.sophia.by).toBe('person') // nothing else on the element was lost
    const stored = JSON.parse(doc.getMap<string>('elements').get(LNK)!)
    expect(stored.link).toBeNull()
    expect('mnemosyne' in stored.customData).toBe(false)
    expect(r.events).toEqual([{ elementId: LNK, target: null }])
    // A link that is not there changes nothing and says nothing.
    const calls = canvas.calls.length
    unlinkElement(r.deps, 'nope')
    expect(canvas.calls.length).toBe(calls + 1) // only the popup close
    expect(r.events).toHaveLength(1)
  })
})

describe('what the bar offers', () => {
  const wireOptions = { pickPredicate: async () => 'supports', promoteArrow: async () => ({ wireId: 'w', predicate: 'supports' }), demoteArrow: async () => {} }
  const pageOf = (over: Partial<WhiteboardPageOptions>): WhiteboardPageOptions => ({
    graphId: 'wb-graph', documentId: 'wb-board', title: 't', status: 'ready', provider: null,
    pickLink: async () => null, onOpenLink: () => true, ...wireOptions, ...over,
  })
  const ids = (selection: WbSelection, page: WhiteboardPageOptions | null) => actionsFor(selection, page, ELEMENTS).map((a) => a.id)

  it('a_read_only_board_offers_no_editing_actions', () => {
    const editable = pageOf({})
    const readOnly = pageOf({ readOnly: true })
    const linked = selectionOf(ELEMENTS, pick(LNK))
    expect(ids(linked, editable)).toEqual(['link', 'unlink', 'open', 'card'])
    expect(ids(linked, readOnly)).toEqual(['open'])
    expect(ids(selectionOf(ELEMENTS, pick(BOX)), readOnly)).toEqual([])
    expect(ids(selectionOf(ELEMENTS, pick(CRD)), editable)).toEqual(['open', 'card'])
    expect(ids(selectionOf(ELEMENTS, pick(CRD)), readOnly)).toEqual(['open'])
    expect(ids(selectionOf(ELEMENTS, pick(ARW2)), editable)).toEqual(['unwire', 'card'])
    expect(ids(selectionOf(ELEMENTS, pick(ARW2)), readOnly)).toEqual([])
    expect(ids(selectionOf(ELEMENTS, pick(ARW1)), editable)).toEqual(['wire', 'card'])
    expect(ids(selectionOf(ELEMENTS, pick(ARW1)), readOnly)).toEqual([])
    // A dangling arrow cannot be made a wire; a page without the options offers nothing it cannot do.
    expect(ids(selectionOf(ELEMENTS, pick(ARW3)), editable)).toEqual(['card'])
    expect(ids(selectionOf(ELEMENTS, pick(BOX)), pageOf({ pickLink: undefined }))).toEqual([])
    expect(ids(selectionOf(ELEMENTS, pick(ARW1)), pageOf({ pickPredicate: undefined }))).toEqual(['card'])
    // Several shapes: the one thing the bar offers is to lay them out (ELK), and not on a read-only board.
    expect(ids(selectionOf(ELEMENTS, pick(BOX, NOTE)), editable)).toEqual(['layout'])
    expect(ids(selectionOf(ELEMENTS, pick(BOX, NOTE)), readOnly)).toEqual([])
    // A shape and an arrow are not two shapes: an arrow is routed, never placed.
    expect(ids(selectionOf(ELEMENTS, pick(BOX, ARW1)), editable)).toEqual([])
    expect(ids(selectionOf(ELEMENTS, pick(LNK)), null)).toEqual([])
  })

  it('the bar in the stage shows only what the page allows, reports a selection once, and Escape dismisses', () => {
    const { canvas } = seeded()
    const ro = rig(canvas, { readOnly: true })
    const bar = createSelectionBar(ro.deps)
    const toolbar = ro.deps.stage.querySelector('[role="toolbar"]') as HTMLElement
    expect(toolbar).toBeTruthy()
    expect(toolbar.hidden).toBe(true)
    canvas.state = { ...canvas.state, selectedElementIds: { [LNK]: true } }
    bar.update()
    bar.update()
    expect(toolbar.hidden).toBe(false)
    expect([...toolbar.querySelectorAll('button')].map((b) => b.dataset.action)).toEqual(['open'])
    expect(ro.selections.map((s) => s.kind)).toEqual(['shape']) // twice updated, once reported
    ;(toolbar.querySelector('button') as HTMLButtonElement).click()
    expect(ro.opened).toEqual(['mnemosyne://document/wb-graph/doc-traumdeutung'])
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(toolbar.hidden).toBe(true)
    bar.update()
    expect(toolbar.hidden).toBe(true) // dismissed for this selection
    canvas.state = { ...canvas.state, selectedElementIds: { [CRD]: true } }
    bar.update()
    expect(toolbar.hidden).toBe(false)
    expect(ro.selections.map((s) => s.kind)).toEqual(['shape', 'card'])
    bar.destroy()
    expect(ro.deps.stage.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('the bar announces the selection as an event and shows how many link here', async () => {
    const { canvas } = seeded()
    const asked: unknown[] = []
    const r = rig(canvas, { loadBacklinks: async (t) => { asked.push(t); return [{ kind: 'wire', sourceDocumentId: 'a' }, { kind: 'link', sourceDocumentId: 'b' }] } })
    const heard: WbSelection[] = []
    r.deps.eventTarget.addEventListener(WB_SELECTION_EVENT, (e) => heard.push((e as CustomEvent<WbSelection>).detail))
    const bar = createSelectionBar(r.deps)
    canvas.state = { ...canvas.state, selectedElementIds: { [LNK]: true } }
    bar.update()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked).toEqual([{ graphId: 'wb-graph', documentId: 'doc-traumdeutung' }])
    expect(r.deps.stage.querySelector('.selbar-note')?.textContent).toBe('Linked from 2')
    expect(heard.map((s) => s.elementId)).toEqual([LNK])
    bar.destroy()
  })

  it('linked_from_does_not_count_the_boards_own_shapes', async () => {
    const { canvas } = seeded()
    const r = rig(canvas, { loadBacklinks: async () => [{ kind: 'board-link', sourceDocumentId: 'wb-board' }, { kind: 'wire', sourceDocumentId: 'a' }] })
    const bar = createSelectionBar(r.deps)
    canvas.state = { ...canvas.state, selectedElementIds: { [LNK]: true } }
    bar.update()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.deps.stage.querySelector('.selbar-note')?.textContent).toBe('Linked from 1')
    bar.destroy()
  })

  it('an_artifact_or_malformed_embeddable_is_not_a_card', () => {
    const artifact = { ...ELEMENTS.find((e) => e.id === CRD)!, id: 'art', link: 'mnemosyne://artifact/wb-graph/file-1' } as WbElement
    const broken = { ...artifact, id: 'bad', link: 'mnemosyne://' } as WbElement
    expect(selectionOf([artifact], pick('art')).kind).toBe('shape')
    expect(selectionOf([broken], pick('bad')).kind).toBe('shape')
    expect(selectionOf(ELEMENTS, pick(CRD)).kind).toBe('card')
  })

  it('ctrl_k_applies_to_one_shape_or_card_and_never_to_an_arrow', () => {
    expect(linkActionApplies(ELEMENTS, pick(BOX))).toBe(true)
    expect(linkActionApplies(ELEMENTS, pick(CRD))).toBe(true)
    expect(linkActionApplies(ELEMENTS, pick(ARW2))).toBe(false)
    expect(linkActionApplies(ELEMENTS, pick(BOX, NOTE))).toBe(false)
    expect(linkActionApplies(ELEMENTS, pick())).toBe(false)
  })
})
