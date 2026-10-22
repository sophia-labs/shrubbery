/**
 * The whiteboard binding against real Yjs: two `Y.Doc`s exchanging updates, the real binding on each, and a small real
 * scene model (an element list plus the busy set Excalidraw would report), not a mocking library.
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import fixture from './fixtures/whiteboard-fixture-v1.json'
import {
  LOCAL_ORIGIN, remoteWins, WhiteboardBinding, type WbElement, type WbScene, type WbToolWrite,
} from './whiteboard-binding.js'

/** The fixture is gardend's `src-tauri/tests/fixtures/whiteboard/whiteboard-fixture-v1.json`, copied at its commit (gardend feat/whiteboard-20261021 @ 5e7be74). */
const FIXTURE_ELEMENTS = fixture.elements as unknown as WbElement[]

class SceneModel implements WbScene {
  elements: WbElement[] = []
  busy = new Set<string>()
  history = 0
  getElements(): readonly WbElement[] { return this.elements }
  setElements(elements: readonly WbElement[]): void { this.elements = [...elements] }
  busyIds(): ReadonlySet<string> { return this.busy }
  /** A person edits an element: Excalidraw bumps version and nonce, then calls onChange. */
  edit(id: string, patch: Record<string, unknown>, nonce = Math.floor(Math.random() * 1e9)): WbElement {
    const index = this.elements.findIndex((e) => e.id === id)
    const next = { ...this.elements[index], ...patch, version: this.elements[index].version + 1, versionNonce: nonce } as WbElement
    this.elements[index] = next
    return next
  }
}

/** Two docs exchanging updates the way y-websocket would, synchronously. */
function link(a: Y.Doc, b: Y.Doc): () => void {
  const toB = (update: Uint8Array, origin: unknown) => { if (origin !== 'from-b') Y.applyUpdate(b, update, 'from-a') }
  const toA = (update: Uint8Array, origin: unknown) => { if (origin !== 'from-a') Y.applyUpdate(a, update, 'from-b') }
  a.on('update', toB)
  b.on('update', toA)
  return () => { a.off('update', toB); b.off('update', toA) }
}

interface Peer { doc: Y.Doc; scene: SceneModel; binding: WhiteboardBinding; writes: WbToolWrite[] }

function peer(doc: Y.Doc, extra: Partial<ConstructorParameters<typeof WhiteboardBinding>[1]> = {}): Peer {
  const scene = new SceneModel()
  const writes: WbToolWrite[] = []
  const binding = new WhiteboardBinding(doc, { throttleMs: 0, schedule: (cb) => { cb(); return 1 }, cancel: () => {}, onToolWrite: (w) => writes.push(w), ...extra })
  scene.elements = [...binding.initialElements()]
  binding.attach(scene)
  return { doc, scene, binding, writes }
}

function seed(doc: Y.Doc, elements: readonly WbElement[]): void {
  doc.transact(() => {
    const map = doc.getMap<string>('elements')
    for (const e of elements) map.set(e.id, JSON.stringify(e))
  }, 'server')
}

function el(id: string, version: number, nonce: number, extra: Record<string, unknown> = {}): WbElement {
  return { id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version, versionNonce: nonce, isDeleted: false, index: 'a0', ...extra } as WbElement
}

describe('the shared fixture', () => {
  it('loads: six live elements and one tombstone, bound text and a bound arrow intact', () => {
    const doc = new Y.Doc()
    seed(doc, FIXTURE_ELEMENTS)
    const p = peer(doc)
    expect(p.scene.elements).toHaveLength(7)
    const byId = new Map(p.scene.elements.map((e) => [e.id, e]))
    expect(byId.get('del0000000000000000001')?.isDeleted).toBe(true)
    const arrow = byId.get('arw0000000000000000001') as Record<string, any>
    expect(arrow.startBinding.elementId).toBe('box0000000000000000001')
    expect(arrow.endBinding.mode).toBe('orbit')
    expect((byId.get('txt0000000000000000001') as Record<string, any>).containerId).toBe('box0000000000000000001')
    // The loaded elements are the fixture's, value for value.
    for (const e of FIXTURE_ELEMENTS) expect(byId.get(e.id)).toEqual(e)
    expect(doc.getMap('meta').size).toBe(0) // the server seeds meta; a reader never needs it
  })
})

describe('the version and nonce rule', () => {
  it('remote wins on a higher version, and on a tie only with the lower nonce', () => {
    expect(remoteWins(el('a', 1, 5), el('a', 2, 9))).toBe(true)
    expect(remoteWins(el('a', 2, 5), el('a', 1, 1))).toBe(false)
    expect(remoteWins(el('a', 2, 5), el('a', 2, 4))).toBe(true)
    expect(remoteWins(el('a', 2, 5), el('a', 2, 6))).toBe(false)
    expect(remoteWins(el('a', 2, 5), el('a', 2, 5))).toBe(false)
  })
})

describe('two peers on one board', () => {
  it('concurrent edits to different elements both survive', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    seed(a, [el('x', 1, 1), el('y', 1, 2)])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = peer(a); const pb = peer(b)
    const unlink = link(a, b)
    // Both edit before either hears of the other: edits are made offline, then the docs meet.
    unlink()
    pa.scene.edit('x', { x: 100 }); pa.binding.localChanged(); pa.binding.flushNow()
    pb.scene.edit('y', { y: 200 }); pb.binding.localChanged(); pb.binding.flushNow()
    link(a, b)
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'from-a')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'from-b')
    for (const p of [pa, pb]) {
      const by = new Map(p.scene.elements.map((e) => [e.id, e]))
      expect(by.get('x')?.x).toBe(100)
      expect(by.get('y')?.y).toBe(200)
    }
  })

  it('concurrent edits to one element: the higher version wins, then the lower nonce, on both peers', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = peer(a); const pb = peer(b)
    // A edits twice (v3), B once (v2): A wins whatever the arrival order.
    pa.scene.edit('x', { x: 1 }, 50); pa.scene.edit('x', { x: 2 }, 51); pa.binding.localChanged(); pa.binding.flushNow()
    pb.scene.edit('x', { x: 9 }, 5); pb.binding.localChanged(); pb.binding.flushNow()
    link(a, b)
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'from-a')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'from-b')
    expect(pa.scene.elements.find((e) => e.id === 'x')?.x).toBe(2)
    expect(pb.scene.elements.find((e) => e.id === 'x')?.x).toBe(2)
    expect(JSON.parse(a.getMap<string>('elements').get('x')!).x).toBe(2) // the room converges on the winner too

    // A tie on version: the lower nonce wins.
    const c = new Y.Doc(); const d = new Y.Doc()
    seed(c, [el('t', 1, 1)])
    Y.applyUpdate(d, Y.encodeStateAsUpdate(c))
    const pc = peer(c); const pd = peer(d)
    pc.scene.edit('t', { x: 10 }, 700); pc.binding.localChanged(); pc.binding.flushNow()
    pd.scene.edit('t', { x: 20 }, 300); pd.binding.localChanged(); pd.binding.flushNow()
    link(c, d)
    Y.applyUpdate(d, Y.encodeStateAsUpdate(c), 'from-a')
    Y.applyUpdate(c, Y.encodeStateAsUpdate(d), 'from-b')
    // Yjs picks one map value (by client id), and the scenes follow the rule on whatever arrived:
    // both converge on the same element.
    expect(pc.scene.elements.find((e) => e.id === 't')?.x).toBe(20)
    expect(pd.scene.elements.find((e) => e.id === 't')?.x).toBe(20)
    expect(JSON.parse(c.getMap<string>('elements').get('t')!).x).toBe(20) // and so does the room itself
  })

  it('a local edit reaches the other peer live, attributed to a person', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = peer(a); const pb = peer(b)
    link(a, b)
    pa.scene.edit('x', { x: 321 }); pa.binding.localChanged()
    const seen = pb.scene.elements.find((e) => e.id === 'x')!
    expect(seen.x).toBe(321)
    expect((seen.customData as any).sophia.by).toBe('person')
  })

  it('a tombstone is not resurrected by a stale peer', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = peer(a); const pb = peer(b)
    link(a, b)
    pa.scene.edit('x', { isDeleted: true }); pa.binding.localChanged()
    expect(pb.scene.elements.find((e) => e.id === 'x')?.isDeleted).toBe(true)
    // B, stale, still believes v1 is live and re-announces it: the tombstone (v2) stays.
    pb.binding.attach(pb.scene)
    const stale = el('x', 1, 1)
    a.transact(() => a.getMap<string>('elements').set('x', JSON.stringify(stale)), 'server')
    // The server's old copy arrives: the scene keeps its tombstone because v2 beats v1.
    expect(pa.scene.elements.find((e) => e.id === 'x')?.isDeleted).toBe(true)
  })

  it('never clobbers the element a person is dragging, and judges it again afterwards', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const pa = peer(a); const pb = peer(b)
    link(a, b)
    pb.scene.busy.add('x')
    pb.scene.edit('x', { x: 5 }) // v2, mid-drag, not yet written
    pa.scene.edit('x', { x: 50 }); pa.scene.edit('x', { x: 60 }); pa.scene.edit('x', { x: 70 }) // v4 from the other side
    pa.binding.localChanged()
    expect(pb.scene.elements.find((e) => e.id === 'x')?.x).toBe(5) // the drag is not taken from under the hand
    pb.scene.busy.clear()
    pb.binding.localChanged() // the interaction ended: v4 beats the local v2
    expect(pb.scene.elements.find((e) => e.id === 'x')?.x).toBe(70)
  })

  it('ignores the echo of its own writes', () => {
    const a = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    const pa = peer(a)
    let setCalls = 0
    const original = pa.scene.setElements.bind(pa.scene)
    pa.scene.setElements = (els) => { setCalls += 1; original(els) }
    pa.scene.edit('x', { x: 9 })
    pa.binding.localChanged() // writes to the doc with LOCAL_ORIGIN
    expect(setCalls).toBe(0)
    // A write by something else is applied.
    a.transact(() => a.getMap<string>('elements').set('y', JSON.stringify(el('y', 1, 1))), 'server')
    expect(setCalls).toBe(1)
    expect(LOCAL_ORIGIN).toBeTypeOf('symbol')
  })

  it('a tool-written element is re-measured, corrected by one client, and reported', () => {
    const a = new Y.Doc(); const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const measure = (els: readonly WbElement[]) => els.map((e) => (e.type === 'text' ? ({ ...e, width: 99 } as WbElement) : e))
    const pa = peer(a, { refresh: measure, isLeader: () => true })
    const pb = peer(b, { refresh: measure, isLeader: () => false })
    link(a, b)
    const text = el('t1', 1, 4, { type: 'text', width: 120, customData: { sophia: { by: 'agent:claude', at: 1 } } })
    a.transact(() => a.getMap<string>('elements').set('t1', JSON.stringify(text)), 'server')
    // The leader re-measured and wrote the correction (version 2); the other took it.
    const fixed = JSON.parse(a.getMap<string>('elements').get('t1')!)
    expect(fixed.width).toBe(99)
    expect(fixed.version).toBe(2)
    expect(fixed.customData.sophia.by).toBe('agent:claude') // the correction keeps who drew it
    expect(pb.scene.elements.find((e) => e.id === 't1')?.width).toBe(99)
    expect(pa.writes[0]).toEqual({ by: 'agent:claude', ids: ['t1'] })
    expect(pb.writes.length).toBeGreaterThan(0)
  })

  it('leaves images out of what is shared and counts them', () => {
    const a = new Y.Doc()
    let left = 0
    const pa = peer(a, { onImagesLeftOut: (n) => { left = n } })
    pa.scene.elements.push(el('img', 1, 1, { type: 'image', fileId: 'f1' }))
    pa.binding.localChanged()
    expect(a.getMap('elements').has('img')).toBe(false)
    expect(left).toBe(1)
    expect(pa.binding.droppedImages).toBe(1)
  })

  it('flushes the final state on demand (pointer-up) even when throttled', () => {
    const a = new Y.Doc()
    seed(a, [el('x', 1, 1)])
    const timers: Array<() => void> = []
    const pa = peer(a, { throttleMs: 80, schedule: (cb) => { timers.push(cb); return timers.length }, cancel: () => {} })
    pa.scene.edit('x', { x: 42 })
    pa.binding.localChanged()
    expect(JSON.parse(a.getMap<string>('elements').get('x')!).x).toBe(0) // still queued
    pa.binding.flushNow()
    expect(JSON.parse(a.getMap<string>('elements').get('x')!).x).toBe(42)
  })
})

describe('leaving a board', () => {
  it('writes what the scene holds even when onChange has not reported it yet', () => {
    const doc = new Y.Doc()
    const scene = new SceneModel()
    // A real timer that has not fired: the leave comes inside the throttle window.
    const binding = new WhiteboardBinding(doc, { throttleMs: 60_000 })
    binding.attach(scene)
    const card = { ...FIXTURE_ELEMENTS[0], id: 'dropped-card', version: 1, versionNonce: 7 } as WbElement
    scene.elements = [card] // the canvas has it; onChange never ran
    binding.destroy()
    expect(doc.getMap<string>('elements').has('dropped-card')).toBe(true)
  })
})
