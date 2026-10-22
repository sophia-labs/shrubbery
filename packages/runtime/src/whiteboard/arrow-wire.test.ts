/**
 * Arrow to wire against the shared v2 fixture. The ends are read from its real elements; where the canvas matters the
 * real `WhiteboardBinding` runs over a real Y.Doc with a small real scene model. The page options are plain functions
 * that record their calls and answer with real values: they are the far side of the seam (the shell's job).
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import fixture from './fixtures/whiteboard-fixture-v2-semantic.json'
import { arrowEndsOf, promoteSelectedArrow, unwireArrow, wireMarkOf, type WbArrowWireDeps } from './arrow-wire.js'
import { WB_WIRE_EVENT, type WbCanvasApi, type WbDemoteRequest, type WbPredicateRequest, type WbPromoteRequest, type WbWireChangedDetail } from './semantic-types.js'
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
const TXT1 = 'txt0000000000000000001'
const TXT2 = 'txt0000000000000000002'
const TXT5 = 'txt0000000000000000005'

class Canvas implements WbScene, WbCanvasApi {
  elements: WbElement[]
  calls: Array<Record<string, any>> = []
  onChange: () => void = () => {}
  constructor(elements: readonly WbElement[]) { this.elements = [...elements] }
  getElements(): readonly WbElement[] { return this.elements }
  setElements(elements: readonly WbElement[]): void { this.elements = [...elements] }
  busyIds(): ReadonlySet<string> { return new Set() }
  getSceneElementsIncludingDeleted(): readonly unknown[] { return this.elements }
  getAppState(): Record<string, any> { return {} }
  updateScene(data: Record<string, unknown>): void {
    this.calls.push(data)
    if (data.elements) this.elements = [...(data.elements as WbElement[])]
    this.onChange()
  }
  find(id: string): Record<string, any> { return this.elements.find((e) => e.id === id) as Record<string, any> }
}

function seeded(): { doc: Y.Doc; canvas: Canvas } {
  const doc = new Y.Doc()
  doc.transact(() => {
    const map = doc.getMap<string>('elements')
    for (const e of ELEMENTS) map.set(e.id, JSON.stringify(e))
  }, 'server')
  const binding = new WhiteboardBinding(doc, { throttleMs: 0, schedule: (cb) => { cb(); return 1 }, cancel: () => {} })
  const canvas = new Canvas(binding.initialElements())
  binding.attach(canvas)
  canvas.onChange = () => { binding.localChanged(); binding.flushNow() }
  return { doc, canvas }
}

interface Rig {
  deps: WbArrowWireDeps
  canvas: Canvas
  log: string[]
  asked: WbPredicateRequest[]
  promoted: WbPromoteRequest[]
  demoted: WbDemoteRequest[]
  canvasCallsAtDemote: number[]
  notices: string[]
  events: WbWireChangedDetail[]
}

function rig(canvas: Canvas, over: Partial<WhiteboardPageOptions> = {}): Rig {
  const log: string[] = []
  const asked: WbPredicateRequest[] = []
  const promoted: WbPromoteRequest[] = []
  const demoted: WbDemoteRequest[] = []
  const canvasCallsAtDemote: number[] = []
  const notices: string[] = []
  const events: WbWireChangedDetail[] = []
  const eventTarget = new EventTarget()
  eventTarget.addEventListener(WB_WIRE_EVENT, (e) => events.push((e as CustomEvent<WbWireChangedDetail>).detail))
  const page: WhiteboardPageOptions = {
    graphId: 'wb-graph', documentId: 'wb-board', title: 'Dream-work board', status: 'ready', provider: null,
    pickPredicate: async (request) => { log.push('pick'); asked.push(request); return 'condenses' },
    promoteArrow: async (request) => { log.push('promote'); promoted.push(request); return { wireId: 'wire-wb-0002', predicate: request.predicate } },
    demoteArrow: async (request) => { log.push('demote'); canvasCallsAtDemote.push(canvas.calls.length); demoted.push(request) },
    ...over,
  }
  const deps: WbArrowWireDeps = { eventTarget, page: () => page, api: () => canvas, notify: (m) => notices.push(m) }
  return { deps, canvas, log, asked, promoted, demoted, canvasCallsAtDemote, notices, events }
}

const snapshot = (canvas: Canvas): string => JSON.stringify(canvas.elements)

describe('wireMarkOf', () => {
  it('wire_mark_of_reads_the_mark_and_refuses_a_malformed_one', () => {
    const arrow = ELEMENTS.find((e) => e.id === ARW2)!
    expect(wireMarkOf(arrow)).toEqual({ wireId: 'wire-wb-0001', predicate: 'supports', strokeWas: '#1d1c19', labelFromPredicate: true })
    expect(wireMarkOf(ELEMENTS.find((e) => e.id === ARW1)!)).toBeNull()
    expect(wireMarkOf({})).toBeNull()
    // The other fields are optional.
    expect(wireMarkOf({ customData: { mnemosyneWire: { wireId: 'w', predicate: 'p' } } })).toEqual({ wireId: 'w', predicate: 'p' })
    expect(wireMarkOf({ customData: { mnemosyneWire: { wireId: 'w', predicate: 'p', strokeWas: null } } })).toEqual({ wireId: 'w', predicate: 'p', strokeWas: null })
    // Malformed: no wireId, no predicate, wrong types, not an object.
    for (const bad of [{ predicate: 'p' }, { wireId: 'w' }, { wireId: '', predicate: 'p' }, { wireId: 'w', predicate: '' }, { wireId: 7, predicate: 'p' },
      { wireId: 'w', predicate: ['p'] }, 'wire', 7, true, null, ['w', 'p']]) {
      expect(wireMarkOf({ customData: { mnemosyneWire: bad } }), JSON.stringify(bad)).toBeNull()
    }
    // A mistyped optional is dropped, not trusted.
    expect(wireMarkOf({ customData: { mnemosyneWire: { wireId: 'w', predicate: 'p', strokeWas: 5, labelFromPredicate: 'yes' } } })).toEqual({ wireId: 'w', predicate: 'p' })
  })
})

describe('arrowEndsOf', () => {
  it('arrow_ends_names_both_ends_with_their_targets', () => {
    const ends = arrowEndsOf(ELEMENTS, ARW2)
    expect(ends).toEqual({
      arrowId: ARW2,
      // A shape: its words. Its link is a document.
      from: { elementId: LNK, label: 'The Interpretation of Dreams', refersTo: { kind: 'document', graphId: 'wb-graph', documentId: 'doc-traumdeutung', title: 'The Interpretation of Dreams' } },
      // A card has no words of its own: the snapshot label. Its link is an object.
      to: { elementId: CRD, label: 'The Wolf Man dream', refersTo: { kind: 'object', graphId: 'wb-graph', iri: 'urn:mnemosyne:local:graph:wb-graph:dream:wolf-man', label: 'The Wolf Man dream', classLabel: 'DreamReport' } },
      label: 'supports',
    })
    const plain = arrowEndsOf(ELEMENTS, ARW1)!
    expect(plain.from).toEqual({ elementId: BOX, label: 'Freud: the dream-work', refersTo: null })
    expect(plain.to).toEqual({ elementId: NOTE, label: 'condensation', refersTo: null })
    expect(plain.label).toBe('condenses')
    // No words and no snapshot: the shape's kind. An arrow without a label has none.
    const bare = ELEMENTS.map((e) => (e.id === TXT2 || e.id === 'txt0000000000000000003' ? { ...e, isDeleted: true } : e))
    const unlabelled = arrowEndsOf(bare, ARW1)!
    expect(unlabelled.to.label).toBe('rectangle')
    expect(unlabelled.label).toBeNull()
  })

  it('arrow_ends_resolves_bound_text_to_its_container', () => {
    // Excalidraw can bind an arrow end to a shape's label; the end is still the shape.
    const viaText = ELEMENTS.map((e) => (e.id === ARW1 ? { ...e, startBinding: { ...(e.startBinding as object), elementId: TXT1 } } : e))
    const ends = arrowEndsOf(viaText, ARW1)!
    expect(ends.from.elementId).toBe(BOX)
    expect(ends.from.label).toBe('Freud: the dream-work')
    // The text of a deleted container is no end.
    const gone = viaText.map((e) => (e.id === BOX ? { ...e, isDeleted: true } : e))
    expect(arrowEndsOf(gone, ARW1)).toBeNull()
  })

  it('arrow_ends_is_null_for_a_dangling_or_missing_arrow', () => {
    expect(arrowEndsOf(ELEMENTS, ARW3)).toBeNull() // end unbound
    expect(arrowEndsOf(ELEMENTS, 'nope')).toBeNull()
    expect(arrowEndsOf(ELEMENTS, BOX)).toBeNull() // not an arrow
    expect(arrowEndsOf(ELEMENTS.map((e) => (e.id === ARW1 ? { ...e, isDeleted: true } : e)), ARW1)).toBeNull()
    expect(arrowEndsOf(ELEMENTS.map((e) => (e.id === NOTE ? { ...e, isDeleted: true } : e)), ARW1)).toBeNull() // end deleted
    expect(arrowEndsOf(ELEMENTS.filter((e) => e.id !== NOTE), ARW1)).toBeNull() // end absent
    expect(arrowEndsOf([], ARW1)).toBeNull()
  })
})

describe('promoteSelectedArrow', () => {
  it('promote_asks_for_a_predicate_then_promotes_and_announces', async () => {
    const { canvas } = seeded()
    const r = rig(canvas, { pickPredicate: async (request) => { r.log.push('pick'); r.asked.push(request); return '  condenses ' } })
    const before = snapshot(canvas)
    const mark = await promoteSelectedArrow(r.deps, ARW1)
    expect(mark).toEqual({ wireId: 'wire-wb-0002', predicate: 'condenses' })
    // The menu is told both ends and starts from the arrow's own label.
    expect(r.asked).toEqual([{ graphId: 'wb-graph', ends: arrowEndsOf(ELEMENTS, ARW1), suggestion: 'condenses' }])
    // Gardend is asked with the trimmed choice, only after the person chose.
    expect(r.promoted).toEqual([{ graphId: 'wb-graph', documentId: 'wb-board', arrowId: ARW1, predicate: 'condenses' }])
    expect(r.log).toEqual(['pick', 'promote'])
    expect(r.events).toEqual([{ arrowId: ARW1, wire: { wireId: 'wire-wb-0002', predicate: 'condenses' } }])
    // The mark arrives through the room, never from here.
    expect(r.canvas.calls).toEqual([])
    expect(snapshot(canvas)).toBe(before)
    expect(r.notices).toEqual([])
  })

  it('promote_refuses_an_already_wired_arrow_and_a_read_only_board', async () => {
    const { canvas } = seeded()
    const wired = rig(canvas)
    expect(await promoteSelectedArrow(wired.deps, ARW2)).toBeNull()
    expect(wired.notices).toEqual(['This arrow is already a wire.'])
    expect(wired.log).toEqual([])
    expect(wired.events).toEqual([])

    const ro = rig(canvas, { readOnly: true })
    expect(await promoteSelectedArrow(ro.deps, ARW1)).toBeNull()
    expect(ro.notices).toEqual(['This board is read-only.'])
    expect(ro.log).toEqual([])

    // A dangling arrow, and a page without the options, are refused with a reason too.
    const dangling = rig(canvas)
    expect(await promoteSelectedArrow(dangling.deps, ARW3)).toBeNull()
    expect(dangling.notices).toHaveLength(1)
    expect(dangling.log).toEqual([])
    const bare = rig(canvas, { pickPredicate: undefined })
    expect(await promoteSelectedArrow(bare.deps, ARW1)).toBeNull()
    expect(bare.notices).toHaveLength(1)
    expect(bare.log).toEqual([])
  })

  it('cancel_leaves_the_arrow_alone', async () => {
    const { canvas } = seeded()
    const before = snapshot(canvas)
    for (const answer of [null, '', '   ']) {
      const r = rig(canvas, { pickPredicate: async () => answer })
      expect(await promoteSelectedArrow(r.deps, ARW1)).toBeNull()
      expect(r.log).toEqual([])
      expect(r.events).toEqual([])
      expect(r.notices).toEqual([])
    }
    expect(canvas.calls).toEqual([])
    expect(snapshot(canvas)).toBe(before)
  })

  it('a_failing_promote_reports_and_changes_nothing', async () => {
    const { doc, canvas } = seeded()
    const before = snapshot(canvas)
    const stored = JSON.stringify([...doc.getMap<string>('elements').entries()])
    const r = rig(canvas, { promoteArrow: async () => { throw new Error('whiteboard_apply: arrow is not bound at both ends') } })
    expect(await promoteSelectedArrow(r.deps, ARW1)).toBeNull()
    expect(r.notices).toEqual(['whiteboard_apply: arrow is not bound at both ends'])
    expect(r.events).toEqual([])
    expect(canvas.calls).toEqual([])
    expect(snapshot(canvas)).toBe(before)
    expect(JSON.stringify([...doc.getMap<string>('elements').entries()])).toBe(stored)
    // A failing picker is reported the same way.
    const picker = rig(canvas, { pickPredicate: async () => { throw new Error('predicates unavailable') } })
    expect(await promoteSelectedArrow(picker.deps, ARW1)).toBeNull()
    expect(picker.notices).toEqual(['predicates unavailable'])
  })
})

describe('unwireArrow', () => {
  it('unwire_clears_mark_stroke_and_label_and_announces', async () => {
    const { doc, canvas } = seeded()
    const r = rig(canvas)
    const before = canvas.find(ARW2)
    expect(await unwireArrow(r.deps, ARW2)).toBe(true)
    // The wire goes first, then the canvas.
    expect(r.demoted).toEqual([{ graphId: 'wb-graph', documentId: 'wb-board', arrowId: ARW2, wireId: 'wire-wb-0001' }])
    expect(r.canvasCallsAtDemote).toEqual([0])
    const arrow = canvas.find(ARW2)
    expect(arrow.customData.mnemosyneWire).toBeUndefined()
    expect(arrow.customData.sophia).toBeTruthy()
    expect(arrow.strokeColor).toBe('#1d1c19')
    expect(arrow.boundElements).toEqual([])
    expect(arrow.version).toBe(before.version + 1)
    expect(arrow.versionNonce).not.toBe(before.versionNonce)
    const label = canvas.find(TXT5)
    expect(label.isDeleted).toBe(true)
    expect(label.version).toBe(ELEMENTS.find((e) => e.id === TXT5)!.version + 1)
    expect(canvas.calls).toHaveLength(1)
    expect(canvas.calls[0]!.captureUpdate).toBe('NEVER')
    // Everything else is as it was.
    for (const e of ELEMENTS) if (e.id !== ARW2 && e.id !== TXT5) expect(canvas.find(e.id)).toEqual(e)
    // The room has it too.
    const storedArrow = JSON.parse(doc.getMap<string>('elements').get(ARW2)!)
    expect('mnemosyneWire' in storedArrow.customData).toBe(false)
    expect(storedArrow.strokeColor).toBe('#1d1c19')
    expect(JSON.parse(doc.getMap<string>('elements').get(TXT5)!).isDeleted).toBe(true)
    expect(r.events).toEqual([{ arrowId: ARW2, wire: null }])
    expect(r.notices).toEqual([])
  })

  it('keeps a label the person wrote, and does nothing for an arrow that is not wired or a wire that will not go', async () => {
    const { canvas } = seeded()
    // The mark says the label was the person's own.
    canvas.elements = canvas.elements.map((e) => (e.id === ARW2
      ? { ...e, customData: { ...e.customData, mnemosyneWire: { wireId: 'wire-wb-0001', predicate: 'supports', strokeWas: '#1d1c19', labelFromPredicate: false } } }
      : e))
    const r = rig(canvas)
    expect(await unwireArrow(r.deps, ARW2)).toBe(true)
    expect(canvas.find(TXT5).isDeleted).toBeFalsy()
    expect(canvas.find(ARW2).boundElements).toEqual([{ type: 'text', id: TXT5 }])

    // Not wired: false, and the shell is not asked.
    const plain = rig(canvas)
    expect(await unwireArrow(plain.deps, ARW1)).toBe(false)
    expect(plain.log).toEqual([])

    // The wire will not go: the canvas keeps its mark.
    const { canvas: second } = seeded()
    const before = snapshot(second)
    const failing = rig(second, { demoteArrow: async () => { throw new Error('wire is locked') } })
    expect(await unwireArrow(failing.deps, ARW2)).toBe(false)
    expect(failing.notices).toEqual(['wire is locked'])
    expect(failing.events).toEqual([])
    expect(second.calls).toEqual([])
    expect(snapshot(second)).toBe(before)

    // Read-only boards cannot unwire.
    const ro = rig(second, { readOnly: true })
    expect(await unwireArrow(ro.deps, ARW2)).toBe(false)
    expect(ro.log).toEqual([])
  })
})
