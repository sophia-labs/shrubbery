/**
 * "Lay out" end to end on the parity fixture (plans/2026-10-30-elk-layout/fixture-board.excalidraw), with the real
 * elkjs (the host's in-thread engine), real Yjs and the real `WhiteboardBinding` over the small real scene model the
 * other whiteboard tests use. The result is written to the hub as `fixture-expected.shrubbery.json`, where gardend's
 * own layout of the same fixture must agree with it to 0.01 px.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import fixture from '../../../nucleus/src/workspace/board-layout/fixture-board.json'
import { type BoardElement, rectOf } from '@shrubbery/nucleus/board-layout'
import { createElkHost, type ElkHost } from '../elk/elk-host.js'
import { layOut } from './layout-action.js'
import { actionsFor, selectionOf, type WbSelectionBarDeps } from './selection-bar.js'
import type { WbCanvasApi } from './semantic-types.js'
import { layoutPaletteItems, layoutShortcutCommand, type WhiteboardPageOptions } from './sh-whiteboard.js'
import { type WbElement, type WbScene, WhiteboardBinding } from './whiteboard-binding.js'

const ELEMENTS = (fixture as unknown as { elements: WbElement[] }).elements
const isBoundText = (e: WbElement) => e.type === 'text' && typeof e.containerId === 'string' && e.containerId !== ''
/** Every live element that is not an arrow or bound text, except "waking". */
const SELECTION = ELEMENTS.filter((e) => e.isDeleted !== true && e.type !== 'arrow' && !isBoundText(e) && e.id !== 'waking').map((e) => e.id)
const labelOf = (container: string) => ELEMENTS.find((e) => e.containerId === container)!.id

/** A scene and a canvas API in one, the way the pane adapts Excalidraw (as in selection-bar.test.ts). */
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
  /** A person's edit: a new version of one element, as Excalidraw's own mutation would make it. */
  personMoves(id: string, dx: number): void {
    this.elements = this.elements.map((e) => (e.id === id ? { ...e, x: (e.x as number) + dx, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e))
  }
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

function rig(canvas: Canvas, over: Partial<WhiteboardPageOptions> = {}): { deps: WbSelectionBarDeps; notices: string[] } {
  const notices: string[] = []
  const page: WhiteboardPageOptions = { graphId: 'wb-graph', documentId: 'wb-board', title: 't', status: 'ready', provider: null, ...over }
  const stage = document.createElement('div')
  return { deps: { stage, eventTarget: stage, page: () => page, api: () => canvas, notify: (m) => notices.push(m) }, notices }
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

/** Is (x, y) on the box's outline (within tol)? */
function onOutline(r: { x: number; y: number; w: number; h: number }, x: number, y: number, tol = 0.5): boolean {
  const inX = x >= r.x - tol && x <= r.x + r.w + tol
  const inY = y >= r.y - tol && y <= r.y + r.h + tol
  return (inX && inY) && (near(x, r.x, tol) || near(x, r.x + r.w, tol) || near(y, r.y, tol) || near(y, r.y + r.h, tol))
}

describe('Lay out on the fixture, with the real ELK', () => {
  it('lays the selection out in one undo step, keeps the drawing in place, and routes the arrows at right angles', async () => {
    const { doc, canvas } = seeded()
    const { deps } = rig(canvas)
    const host = createElkHost({ inThread: true })
    const outcome = await layOut(deps, { ids: SELECTION }, host)
    expect(outcome).toMatchObject({ ok: true, nodes: 8, edges: 8 })

    // One scene update, on the undo stack.
    expect(canvas.calls).toHaveLength(1)
    expect(canvas.calls[0]!.captureUpdate).toBe('IMMEDIATELY')
    const after = new Map(canvas.elements.map((e) => [e.id, e as unknown as BoardElement]))
    const before = new Map(ELEMENTS.map((e) => [e.id, e as unknown as BoardElement]))

    // Anchored: the set's top-left is where it was.
    const minOf = (m: Map<string, BoardElement>, axis: 'x' | 'y') => Math.min(...['latent', 'dreamwork', 'revision', 'mechanisms', 'manifest', 'remembered'].map((id) => rectOf(m.get(id)!)[axis]))
    expect(near(minOf(after, 'x'), minOf(before, 'x'))).toBe(true)
    expect(near(minOf(after, 'y'), minOf(before, 'y'))).toBe(true)

    // Flow runs right: latent before the dream-work, the mechanisms after it, the manifest content last.
    const cx = (id: string) => { const r = rectOf(after.get(id)!); return r.x + r.w / 2 }
    expect(cx('latent')).toBeLessThan(cx('dreamwork'))
    expect(cx('dreamwork')).toBeLessThan(cx('condensation'))
    expect(cx('condensation')).toBeLessThan(cx('manifest'))

    // The frame holds its children.
    const frame = rectOf(after.get('mechanisms')!)
    for (const child of ['condensation', 'displacement', 'representability']) {
      const r = rectOf(after.get(child)!)
      expect(r.x >= frame.x && r.y >= frame.y && r.x + r.w <= frame.x + frame.w && r.y + r.h <= frame.y + frame.h).toBe(true)
    }
    // The group moved as one: the note keeps its offset from the box.
    const offset = (m: Map<string, BoardElement>) => [(m.get('remembered')!.x as number) - (m.get('manifest')!.x as number), (m.get('remembered')!.y as number) - (m.get('manifest')!.y as number)]
    expect(offset(after)[0]).toBeCloseTo(offset(before)[0]!, 9)
    expect(offset(after)[1]).toBeCloseTo(offset(before)[1]!, 9)
    // Labels went with their containers.
    for (const id of ['latent', 'dreamwork', 'condensation', 'manifest']) {
      const box = rectOf(after.get(id)!)
      const text = rectOf(after.get(labelOf(id))!)
      expect(near(text.x + text.w / 2, box.x + box.w / 2, 1)).toBe(true)
      expect(near(text.y + text.h / 2, box.y + box.h / 2, 1)).toBe(true)
    }

    // Every edge: ELK's route, bound with v2 orbit bindings at the shapes' outlines; an all-right-angle route is an elbow.
    for (const id of ['a-latent', 'a-cond', 'a-disp', 'a-repr', 'a-cond-m', 'a-disp-m', 'a-repr-m', 'a-rev']) {
      const arrow = after.get(id)!
      const pts = (arrow.points as number[][]).map(([px, py]) => [(arrow.x as number) + px!, (arrow.y as number) + py!] as const)
      expect(pts[0]).toEqual([arrow.x, arrow.y])
      for (const key of ['startBinding', 'endBinding'] as const) {
        const binding = arrow[key] as { elementId: string; mode: string; fixedPoint: [number, number] }
        expect(binding.mode).toBe('orbit')
        expect(binding.fixedPoint.every((v) => v >= 0 && v <= 1 && v !== 0.5)).toBe(true)
        const end = key === 'startBinding' ? pts[0]! : pts[pts.length - 1]!
        expect(onOutline(rectOf(after.get(binding.elementId)!), end[0], end[1])).toBe(true)
      }
      const rightAngles = pts.every((p, i) => i === 0 || near(p[0], pts[i - 1]![0]) || near(p[1], pts[i - 1]![1]))
      expect(arrow.elbowed).toBe(pts.length >= 3 && rightAngles)
      if (arrow.elbowed) expect([arrow.fixedSegments, arrow.startIsSpecial, arrow.endIsSpecial]).toEqual([[], false, false])
    }
    // The arrow out to the shape left out of the selection is re-routed straight, as gardend's reroute does.
    const wake = after.get('a-wake')!
    expect(wake.elbowed).toBe(false)
    expect((wake.points as unknown[]).length).toBe(2)
    expect(after.get('waking')).toEqual(before.get('waking'))

    // Versions bumped on what changed; the room has it.
    for (const id of ['dreamwork', 'a-latent']) expect((after.get(id)!.version as number)).toBe((before.get(id)!.version as number) + 1)
    const stored = JSON.parse(doc.getMap<string>('elements').get('dreamwork')!)
    expect(stored.x).toBe(after.get('dreamwork')!.x)

    // The parity record: every element after layout, for the gardend lane to compare against.
    const record: Record<string, unknown> = {}
    for (const e of canvas.elements) {
      const el = e as Record<string, any>
      record[e.id] = {
        x: el.x, y: el.y, width: el.width, height: el.height,
        ...(el.points ? { points: el.points } : {}),
        ...(e.type === 'arrow' ? { elbowed: el.elbowed ?? false, startBinding: el.startBinding ?? null, endBinding: el.endBinding ?? null } : {}),
      }
    }
    const planDir = join(process.env.SOPHIA_HUB_DIR ?? join(homedir(), 'dev/sophia'), 'plans/2026-10-30-elk-layout')
    if (existsSync(planDir)) {
      writeFileSync(join(planDir, 'fixture-expected.shrubbery.json'), `${JSON.stringify({
        fixture: 'fixture-board.excalidraw', ids: SELECTION, request: { style: 'flow', direction: 'right', spacing: 'normal' }, elkjs: '0.12.0', elements: record,
      }, null, 1)}\n`)
    }
  })

  it('gives the same layout twice from the same board', async () => {
    const run = async () => {
      const { canvas } = seeded()
      await layOut(rig(canvas).deps, { ids: SELECTION }, createElkHost({ inThread: true }))
      return JSON.stringify(canvas.elements.map((e) => { const el = e as Record<string, any>; return [e.id, el.x, el.y, el.points ?? null, el.startBinding ?? null] }))
    }
    expect(await run()).toBe(await run())
  })

  it('runs every style: tree and grid place; only flow makes elbows', async () => {
    for (const style of ['tree', 'grid'] as const) {
      const { canvas } = seeded()
      const outcome = await layOut(rig(canvas).deps, { ids: SELECTION, style }, createElkHost({ inThread: true }))
      expect(outcome.ok).toBe(true)
      for (const e of canvas.elements) if (e.type === 'arrow') expect((e as Record<string, any>).elbowed).toBe(false)
    }
    const { canvas } = seeded()
    expect((await layOut(rig(canvas).deps, { ids: SELECTION, direction: 'down' }, createElkHost({ inThread: true }))).ok).toBe(true)
    const after = new Map(canvas.elements.map((e) => [e.id, e as unknown as BoardElement]))
    const cy = (id: string) => { const r = rectOf(after.get(id)!); return r.y + r.h / 2 }
    expect(cy('latent')).toBeLessThan(cy('dreamwork'))
  })

  it('gives a person\'s edit during the layout one fresh attempt, then gives up and writes nothing', async () => {
    const real = createElkHost({ inThread: true })
    // The far side of the seam: while ELK works, the person drags the dream-work box (once, then on every attempt).
    const editing = (canvas: Canvas, times: number): ElkHost => {
      let left = times
      return { get mode() { return real.mode }, dispose: () => real.dispose(), layout: async (graph, options) => {
        const result = await real.layout(graph, options)
        if (left-- > 0) canvas.personMoves('dreamwork', 7)
        return result
      } }
    }
    const once = seeded().canvas
    expect((await layOut(rig(once).deps, { ids: SELECTION }, editing(once, 1))).ok).toBe(true)
    expect(once.calls).toHaveLength(1)

    const always = seeded().canvas
    const { deps, notices } = rig(always)
    const outcome = await layOut(deps, { ids: SELECTION }, editing(always, 2))
    expect(outcome).toMatchObject({ ok: false, reason: 'stale' })
    expect(always.calls).toHaveLength(0)
    expect(notices).toEqual(['The board changed while laying out. Try again.'])
  })

  it('refuses a read-only board, and one shape, and says why', async () => {
    const { canvas } = seeded()
    const ro = rig(canvas, { readOnly: true })
    expect(await layOut(ro.deps, { ids: SELECTION }, createElkHost({ inThread: true }))).toMatchObject({ ok: false, reason: 'read-only' })
    const one = rig(canvas)
    expect(await layOut(one.deps, { ids: ['latent'] }, createElkHost({ inThread: true }))).toMatchObject({ ok: false, reason: 'nothing' })
    expect(one.notices).toEqual(['Select at least two shapes to lay out.'])
    expect(canvas.calls).toHaveLength(0)
  })
})

describe('where Lay out is offered', () => {
  const pick = (...ids: string[]): Record<string, any> => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) })
  const page: WhiteboardPageOptions = { graphId: 'g', documentId: 'd', title: 't', status: 'ready', provider: null }

  it('the bar offers it for several shapes only', () => {
    expect(actionsFor(selectionOf(ELEMENTS, pick('latent', 'dreamwork')), page, ELEMENTS).map((a) => a.id)).toEqual(['layout'])
    expect(actionsFor(selectionOf(ELEMENTS, pick('latent', 'a-latent')), page, ELEMENTS).map((a) => a.id)).toEqual([])
  })

  it('Alt+Shift+L lays out several shapes, else the whole board when nothing is selected, never a read-only board', () => {
    expect(layoutShortcutCommand(ELEMENTS, pick('latent', 'dreamwork'), false)).toEqual({ ids: ['latent', 'dreamwork'] })
    expect(layoutShortcutCommand(ELEMENTS, pick(), false)).toEqual({ ids: null })
    expect(layoutShortcutCommand(ELEMENTS, pick('latent'), false)).toBeNull()
    expect(layoutShortcutCommand(ELEMENTS, pick(), true)).toBeNull()
  })

  it('the command palette: four selection entries and the whole board, each running what it says', () => {
    const ran: unknown[] = []
    let state = pick('latent', 'dreamwork')
    const items = layoutPaletteItems(() => true, () => ELEMENTS, () => selectionOf(ELEMENTS, state), (c) => ran.push(c))
    expect(items.map((i) => i.label)).toEqual(['Lay out selection', 'Lay out selection downward', 'Lay out as tree', 'Lay out as grid', 'Lay out board'])
    expect(items.every((i) => (i.predicate as () => boolean)())).toBe(true)
    for (const item of items) (item.perform as () => void)()
    expect(ran).toEqual([
      { ids: ['latent', 'dreamwork'] },
      { direction: 'down', ids: ['latent', 'dreamwork'] },
      { style: 'tree', ids: ['latent', 'dreamwork'] },
      { style: 'grid', ids: ['latent', 'dreamwork'] },
      { ids: null },
    ])
    state = pick('latent')
    expect(items.slice(0, 4).some((i) => (i.predicate as () => boolean)())).toBe(false)
    expect(layoutPaletteItems(() => false, () => ELEMENTS, () => null, () => {}).some((i) => (i.predicate as () => boolean)())).toBe(false)
  })
})
