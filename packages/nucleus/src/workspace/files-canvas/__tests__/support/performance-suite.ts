/**
 * The pure layer's share of the performance budget of section 10 of the design, as a suite that takes an engine: the
 * Excalidraw-backed implementation is held to the same numbers as the house one.
 *
 * Each scenario is run warm, many times, beside a calibration workload, and judged on its fastest run scaled to an idle machine
 * (a GC pause or a busy neighbour is not a regression: contention only adds time, and the calibration says how much). The
 * design's budget is the number to beat; the assertion allows `slack` times the budget (default 2) so that second-order
 * differences between a scenario and the calibration do not make a good build look bad; set FILES_CANVAS_PERF_SLACK=1 to hold it
 * to the letter. The raw and the normalised numbers are written to FILES_CANVAS_PERF_OUT when that is set, so a run leaves its
 * figures behind as a receipt.
 *
 * A fast answer is not an answer. Every scenario carries a `validate`, run on what the first and the last timed run returned: it
 * fails an engine that answers empty, answers in the wrong shape, or answers something other than what the question has (a
 * brute force over the scene, or the reference engine on the functions where the two must agree), so a budget cannot be met by
 * not doing the work. `performance.test.ts` runs the validators against an engine that answers nothing and against engines that
 * answer one question wrongly, to show each can fail.
 */
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import type { CanvasEngine, ConnectorPath, SceneSnapshot, SnapResult } from '../../engine-port.js'
import { houseEngine } from '../../engine-house.js'
import { IDENTITY_CAMERA, rectCenter, rectContainsPoint, rectFromPoints, rectsIntersect, type Pt, type Rect } from '../../geometry.js'
import { NO_MODS, initialState, reduce, type CanvasContext, type CanvasState, type CanvasStep } from '../../interaction.js'
import { buildScene, moveCards } from '../../scene.js'
import { fileKey } from '../../../folder-view-contract.js'
import { onEdge, onPath } from './engine-suite.js'
import { ALL_CAPS, file, inputOf, keyOf } from './fixtures.js'
import { lcg } from './lcg.js'
import { mustRecompute, rerouteContractFaults } from './reroute-contract.js'
import { connectionsFor, latticeSpecs } from './scenes.js'

const SLACK = Number(process.env.FILES_CANVAS_PERF_SLACK ?? 2)
const OUT = process.env.FILES_CANVAS_PERF_OUT

export interface Measure {
  readonly scenario: string
  readonly budgetMs: number
  /** The fastest run, as the machine delivered it. */
  readonly best: number
  /** The fastest run of the calibration workload, timed in the same breath. */
  readonly calibration: number
  /** `best` scaled to an idle machine: the figure that is judged. */
  readonly normalized: number
  /** The median and p95 of all the runs, and the slowest: the receipt of what the machine was doing. */
  readonly median: number
  readonly p95: number
  readonly max: number
  readonly runs: number
}

/** A measurement, with what the body answered on its first and on its last timed run. */
export interface Measured<T> extends Measure {
  readonly first: T
  readonly last: T
}

/** What the calibration workload costs on an idle machine (its floor over 400 runs on the laptop this was written on). */
export const CALIBRATION_IDLE_MS = 3.25

/** A fixed workload of the mix the engine's own work is made of: small objects, a Map, a sort, arithmetic. */
function calibrationWork(): number {
  const items: { k: string; v: number }[] = []
  for (let i = 0; i < 6000; i++) items.push({ k: `k${(i * 7919) % 6007}`, v: Math.sin(i) * 1000 })
  const m = new Map<string, number>()
  for (const it of items) m.set(it.k, (m.get(it.k) ?? 0) + it.v)
  const sorted = [...m.values()].sort((a, b) => a - b)
  let acc = 0
  for (let i = 0; i < 150000; i++) acc += Math.sqrt(i) * (sorted[i % sorted.length] ?? 1)
  return acc
}
let sink = 0

/**
 * Warm up, then time `runs` runs, each next to a run of the calibration workload. Contention on a shared machine only ever adds
 * time, and it comes in long bursts (the box this was written on ran at a load average of 20 on 16 threads, and the same fixed
 * 3 ms workload had a median of 16 ms), so neither the median nor even the fastest run of the scenario alone says what the code
 * costs. The fastest run of the scenario divided by the fastest run of the calibration, times the calibration's idle floor, does:
 * both were slowed by the same contention in the same moments. That idle-equivalent figure is what the budget is held against;
 * the raw numbers stay beside it as the receipt. What the body answered on the first and on the last timed run is kept, for the
 * caller to validate: a figure for work that was not done is no figure.
 */
export function measure<T>(scenario: string, budgetMs: number, runs: number, body: () => T): Measured<T> {
  for (let i = 0; i < Math.min(8, runs); i++) { body(); sink += calibrationWork() }
  const times: number[] = []
  let calibration = Infinity
  let first: T | undefined, last: T | undefined
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now(); sink += calibrationWork(); calibration = Math.min(calibration, performance.now() - t0)
    const t1 = performance.now(); const answer = body(); times.push(performance.now() - t1)
    if (i === 0) first = answer
    last = answer
  }
  times.sort((a, b) => a - b)
  const best = times[0]!
  // A machine that is faster than the one the floor was measured on is not credited: the scenario is judged as measured.
  const normalized = calibration > CALIBRATION_IDLE_MS ? (best / calibration) * CALIBRATION_IDLE_MS : best
  return { scenario, budgetMs, best, calibration, normalized, median: times[Math.floor(times.length / 2)]!,
    p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]!, max: times[times.length - 1]!, runs: sink >= 0 ? runs : 0,
    first: first as T, last: last as T }
}

/** 23 x 22 = 506 cards on a jittered lattice and 300 connections between random pairs: the design's stress folder. */
export function stressInput(seed = 11, connections = 300) {
  const rng = lcg(seed)
  const specs = latticeSpecs(rng, 23, 22)
  return { specs, input: inputOf(specs, { connections: connectionsFor(rng, specs, connections) }) }
}

// ---------------------------------------------------------------------------
// What a right answer is: brute force over the scene, independent of every engine.
// ---------------------------------------------------------------------------

const bruteHits = (scene: SceneSnapshot, rect: Rect): string[] => scene.cards.filter((c) => rectsIntersect(rect, c.rect)).map((c) => c.key)
const bruteDrop = (scene: SceneSnapshot, moving: readonly string[], at: Pt): string | null => {
  for (let i = scene.cards.length - 1; i >= 0; i--) {
    const c = scene.cards[i]!
    if (c.role === 'real' && c.kind === 'folder' && !moving.includes(c.key) && rectContainsPoint(c.rect, at)) return c.key
  }
  return null
}
const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y)
const isSortedBy = <T>(items: readonly T[], key: (t: T) => number) => items.every((t, i) => i === 0 || key(items[i - 1]!) < key(t))

/** The shape of a set of routes: one per connector, orthogonal, attached to the edges they name, with the label on the path. */
function routeShapeFaults(scene: SceneSnapshot, paths: ReadonlyMap<string, ConnectorPath>): string[] {
  const faults: string[] = []
  if (paths.size !== scene.connectors.length) faults.push(`${paths.size} routes for ${scene.connectors.length} connectors`)
  for (const c of scene.connectors) {
    const p = paths.get(c.id)
    if (!p) { faults.push(`${c.id}: no route`); continue }
    if (p.points.length < 2 || !p.points.every(finite)) { faults.push(`${c.id}: fewer than two finite points`); continue }
    for (let i = 1; i < p.points.length; i++) if (p.points[i]!.x !== p.points[i - 1]!.x && p.points[i]!.y !== p.points[i - 1]!.y) faults.push(`${c.id}: a diagonal segment`)
    if (!onEdge(scene.byKey.get(c.from)!.rect, p.start.side, p.start.at)) faults.push(`${c.id}: the start is not on the ${p.start.side} edge of its card`)
    if (!onEdge(scene.byKey.get(c.to)!.rect, p.end.side, p.end.at)) faults.push(`${c.id}: the end is not on the ${p.end.side} edge of its card`)
    if (!onPath(p.points, p.labelAnchor)) faults.push(`${c.id}: the label is off the path`)
  }
  return faults
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

export interface Scenario<T = unknown> {
  readonly id: string
  readonly title: string
  readonly budgetMs: number
  readonly runs: number
  /** Opens and closes what a drag opens in an engine that keeps drag state. */
  readonly before?: () => void
  readonly after?: () => void
  readonly body: () => T
  /** Throws unless `answer` is an answer to the question the body asks. */
  readonly validate: (answer: T) => void
}

export interface StressScene {
  readonly specs: ReturnType<typeof stressInput>['specs']
  readonly input: ReturnType<typeof stressInput>['input']
  readonly scene: SceneSnapshot
}

export function stressScene(): StressScene {
  const { specs, input } = stressInput()
  return { specs, input, scene: buildScene(input).scene }
}

/** The scenarios of the design's section 10 on the stress folder, for `engine`, validated against brute force and `reference`. */
export function performanceScenarios(engine: CanvasEngine, reference: CanvasEngine = houseEngine, stress: StressScene = stressScene()): Scenario[] {
  const { input, scene } = stress
  const pads = { pad: 8 }
  const scenarios: Scenario[] = []
  const add = <T>(s: Scenario<T>) => { scenarios.push(s as Scenario) }

  add({
    id: 'build', title: 're-projects 500 cards and 300 connections in a frame: buildScene <= 16 ms', budgetMs: 16, runs: 60,
    body: () => buildScene(input),
    validate: (built) => {
      expect(built.scene.cards).toHaveLength(scene.cards.length)
      expect(built.scene.connectors).toHaveLength(300)
      expect(built.scene.cards.every((c) => finite(c.rect))).toBe(true)
    },
  })

  let marquee = 0
  add({
    id: 'marquee-engine', title: 'a marquee frame (hit-test every card once) <= 4 ms', budgetMs: 4, runs: 400,
    body: () => { const rect = { x: 100, y: 100, w: 700 + (marquee++ % 400), h: 500 }; return { rect, hits: engine.hitRect(scene, rect, 'intersect') } },
    validate: ({ rect, hits }) => {
      expect(hits.length, 'the marquee hit nothing in a scene full of cards').toBeGreaterThan(0)
      expect(hits).toEqual(bruteHits(scene, rect))
    },
  })

  // Moving a card re-routes only what hangs off it: this is the interactive path. (The spike measured Excalidraw's bound
  // arrows at about 0.25-0.3 ms each: 2.9 ms for the 10 arrows of 10 moved cards, 24.8 ms for 100 arrows off 10 hubs.)
  const previous = engine.route(scene, pads)
  const degree = new Map<string, number>()
  for (const c of scene.connectors) { degree.set(c.from, (degree.get(c.from) ?? 0) + 1); degree.set(c.to, (degree.get(c.to) ?? 0) + 1) }
  const folderAt = (excluding: readonly string[]): { key: string; at: Pt } => {
    const card = scene.cards.find((c) => c.kind === 'folder' && c.role === 'real' && !excluding.includes(c.key))!
    return { key: card.key, at: rectCenter(card.rect) }
  }
  type DragAnswer = { raw: Pt; snapped: SnapResult; moved: SceneSnapshot; next: ReadonlyMap<string, ConnectorPath>; drop: string | null }
  const dragFrame = (moving: string[], label: string, budgetMs: number, runs: number, id: string, title: string): Scenario<DragAnswer> => {
    const movedSet = new Set(moving)
    const target = folderAt(moving)
    let i = 0
    return {
      id, title, budgetMs, runs,
      before: () => engine.prepareDrag?.(scene, moving), after: () => engine.releaseDrag?.(),
      body: () => {
        const raw = { x: 13 + (i++ % 50) * 0.7, y: 7 }
        const snapped = engine.snap(scene, moving, raw, { threshold: 6 })
        const moved = moveCards(scene, moving, snapped.delta)
        const next = engine.reroute(moved, movedSet, previous, pads)
        return { raw, snapped, moved, next, drop: engine.dropTarget(scene, moving, target.at) }
      },
      validate: ({ raw, snapped, moved, next, drop }) => {
        expect(moving, `${label}: ten cards drag`).toHaveLength(10)
        expect(finite(snapped.delta), `${label}: the snapped delta is not a number`).toBe(true)
        expect(Math.abs(snapped.delta.x - raw.x) <= 6 && Math.abs(snapped.delta.y - raw.y) <= 6, `${label}: the snap moved the drag by more than the threshold`).toBe(true)
        // The jittered lattice has edges within the threshold of the moving cards': a snap that finds none is not snapping.
        expect(snapped.guides.length, `${label}: no guide where the reference finds some`).toBeGreaterThan(0)
        const known = reference.snap(scene, moving, raw, { threshold: 6 }).guides
        for (const g of snapped.guides) expect(known.some((k) => k.axis === g.axis && Math.abs(k.at - g.at) < 1e-9), `${label}: guide ${g.axis}@${g.at} is unknown to the reference`).toBe(true)
        expect(drop, `${label}: the drop target`).toBe(bruteDrop(scene, moving, target.at))
        expect(drop).toBe(target.key)
        expect(mustRecompute(moved, movedSet, previous).touched.size, `${label}: the moved cards have connectors`).toBeGreaterThan(0)
        expect(next.size, `${label}: a route for every connector`).toBe(scene.connectors.length)
        expect(rerouteContractFaults(moved, movedSet, previous, next, engine.route(moved, pads))).toEqual([])
      },
    }
  }
  const light = scene.cards.filter((c) => (degree.get(c.key) ?? 0) >= 1 && (degree.get(c.key) ?? 0) <= 2).slice(40, 50).map((c) => c.key)
  const hubs = [...degree].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k)
  add(dragFrame(light, 'light drag', 6, 150, 'drag-light',
    'a drag frame of 10 cards with a connector or two each (snap, reroute what hangs off them, find the drop target) <= 6 ms'))
  add(dragFrame(hubs, 'hubs drag', 25, 60, 'drag-hubs',
    'a drag frame of the ten busiest cards, with every connector that hangs off them <= 25 ms (the hubs case)'))

  add({
    id: 'route-full', title: 'a full refresh of every route (load time, not a frame: a non-interactive path) <= 50 ms', budgetMs: 50, runs: 30,
    body: () => engine.route(scene, pads),
    validate: (paths) => { expect(routeShapeFaults(scene, paths)).toEqual([]) },
  })

  // The reducer's own frame: what one pointer move costs on the stress folder, engine included.
  const ctx = (): CanvasContext => ({
    epoch: 'perf', scope: input.scope, scene, camera: IDENTITY_CAMERA, viewport: { x: 0, y: 0, w: 1600, h: 1000 }, selection: [], focused: null,
    capabilities: ALL_CAPS, engine, naming: null, cut: [],
  })
  const begin = (target: { kind: 'background' } | { kind: 'card'; key: string }, at: Pt, then: Pt): CanvasState => {
    const down = reduce(initialState('perf'), { type: 'pointerdown', pointerId: 1, at, button: 0, mods: NO_MODS, target, t: 1 }, ctx())
    return reduce(down.state, { type: 'pointermove', pointerId: 1, at: then, mods: NO_MODS, t: 2 }, ctx()).state
  }

  let sweep = 0
  const marqueeState = begin({ kind: 'background' }, { x: 5, y: 5 }, { x: 40, y: 40 })
  add<{ at: Pt; step: CanvasStep }>({
    id: 'marquee-reducer', title: 'a marquee frame through the reducer (hit-test, select) <= 4 ms', budgetMs: 4, runs: 200,
    body: () => { const at = { x: 600 + (sweep++ % 900), y: 500 }; return { at, step: reduce(marqueeState, { type: 'pointermove', pointerId: 1, at, mods: NO_MODS, t: 3 }, ctx()) } },
    validate: ({ at, step }) => {
      expect(marqueeState.mode.kind).toBe('marquee')
      expect(step.state.mode.kind).toBe('marquee')
      const select = step.intents.find((i) => i.kind === 'select')
      expect(select, 'the marquee selected nothing').toBeDefined()
      const wanted = new Set(bruteHits(scene, rectFromPoints({ x: 5, y: 5 }, at)))
      const got = select && select.kind === 'select' ? select.files.map(fileKey) : []
      expect(got.length).toBeGreaterThan(0)
      expect(new Set(got)).toEqual(wanted)
    },
  })

  // A card the reference snaps at every frame of the sweep (the jittered lattice has one near the middle), so a snap that finds nothing is seen.
  const sweepAt = (k: number) => ({ x: 60 + k, y: 50 })
  const card = scene.cards.slice(250).find((c) => Array.from({ length: 80 }, (_, k) => k).every((k) =>
    reference.snap(scene, [c.key], sweepAt(k), { threshold: 6 }).guides.length > 0))!
  if (!card) throw new Error('the stress folder has no card that the reference snaps at every frame of the drag sweep')
  const centre = { x: card.rect.x + 72, y: card.rect.y + 64 }
  let frame = 0
  const dragState = begin({ kind: 'card', key: card.key }, centre, { x: centre.x + 40, y: centre.y + 40 })
  add<{ at: Pt; step: CanvasStep }>({
    id: 'drag-reducer', title: 'a drag frame through the reducer (snap, find the drop target) <= 6 ms', budgetMs: 6, runs: 200,
    after: () => engine.releaseDrag?.(),
    body: () => { const at = { x: centre.x + 60 + (frame++ % 80), y: centre.y + 50 }; return { at, step: reduce(dragState, { type: 'pointermove', pointerId: 1, at, mods: NO_MODS, t: 3 }, ctx()) } },
    validate: ({ at, step }) => {
      expect(dragState.mode.kind).toBe('dragging')
      const mode = step.state.mode
      expect(mode.kind).toBe('dragging')
      if (mode.kind !== 'dragging') return
      expect(mode.files).toEqual([card.key])
      expect(mode.delta).toEqual({ x: at.x - centre.x, y: at.y - centre.y })
      expect(finite(mode.snapped.delta)).toBe(true)
      expect(Math.abs(mode.snapped.delta.x - mode.delta.x) <= 6 && Math.abs(mode.snapped.delta.y - mode.delta.y) <= 6).toBe(true)
      expect(mode.dropTarget).toBe(bruteDrop(scene, mode.files, at))
      expect(mode.snapped.guides.length, 'no guide where the reference finds some').toBeGreaterThan(0)
      const known = reference.snap(scene, mode.files, mode.delta, { threshold: 6 }).guides
      for (const g of mode.snapped.guides) expect(known.some((k) => k.axis === g.axis && Math.abs(k.at - g.at) < 1e-9)).toBe(true)
    },
  })

  const key = scene.cards[250]!.key
  add({
    id: 'keyboard', title: 'a keyboard step (spatial neighbour, reading order) <= 4 ms', budgetMs: 4, runs: 100,
    body: () => ({ neighbor: engine.spatialNeighbor(scene, key, 'right'), order: engine.readingOrder(scene) }),
    validate: ({ neighbor, order }) => {
      expect(neighbor, 'no neighbour to the right of a card in the middle of the folder').not.toBeNull()
      const next = scene.byKey.get(neighbor!)
      expect(next, 'the neighbour is not a card of the scene').toBeDefined()
      expect(neighbor).not.toBe(key)
      expect(rectCenter(next!.rect).x).toBeGreaterThan(rectCenter(scene.byKey.get(key)!.rect).x)
      expect(order).toHaveLength(scene.cards.length)
      expect(new Set(order)).toEqual(new Set(scene.cards.map((c) => c.key)))
      expect(order).toEqual(reference.readingOrder(scene))
    },
  })

  const tidyOpts = { origin: { x: 16, y: 16 }, gap: 16, columns: 20 }
  add({
    id: 'tidy', title: 'tidy 506 cards <= 8 ms', budgetMs: 8, runs: 60,
    body: () => engine.tidy(scene, tidyOpts),
    validate: (spots) => {
      const movable = scene.cards.filter((c) => c.role === 'real' && !c.locked)
      expect(spots.size).toBe(movable.length)
      const { w, h } = scene.cardSize
      const slotOf = (p: Pt) => Math.round((p.y - 16) / (h + 16)) * tidyOpts.columns + Math.round((p.x - 16) / (w + 16))
      const order = reference.readingOrder(scene).filter((k) => spots.has(k))
      expect(order).toHaveLength(movable.length)
      for (const k of order) expect(finite(spots.get(k)!), k).toBe(true)
      expect(isSortedBy(order, (k) => slotOf(spots.get(k)!)), 'row-major in reading order, one card to a slot').toBe(true)
    },
  })

  add({
    id: 'free-slot', title: 'the free-slot search stays interactive: nextFreeSlot over 506 cards <= 2 ms', budgetMs: 2, runs: 100,
    body: () => engine.nextFreeSlot(scene, null, 16),
    validate: (slot) => {
      const at = { x: slot.x, y: slot.y, w: scene.cardSize.w, h: scene.cardSize.h }
      expect(scene.cards.some((c) => rectsIntersect(at, c.rect)), 'the slot is taken').toBe(false)
      expect(slot).toEqual(reference.nextFreeSlot(scene, null, 16))
    },
  })

  // Create where you look, in a folder that is full wherever the pane is: the search widens until it finds the nearest free cell.
  const view = { x: 1000, y: 800, w: 1600, h: 1000 }
  add({
    id: 'free-slot-region', title: 'create where you look in a full folder: nextFreeSlot over 506 cards and a region <= 4 ms', budgetMs: 4, runs: 100,
    body: () => engine.nextFreeSlot(scene, null, 16, view),
    validate: (slot) => {
      const at = { x: slot.x, y: slot.y, w: scene.cardSize.w, h: scene.cardSize.h }
      expect(scene.cards.some((c) => rectsIntersect(at, c.rect)), 'the slot is taken').toBe(false)
      expect(slot).toEqual(reference.nextFreeSlot(scene, null, 16, view))
    },
  })

  return scenarios
}

/** Run one scenario's body once and validate what it answered: what a failing engine is shown to fail in `performance.test.ts`. */
export function answerOf(s: Scenario): void {
  s.before?.()
  try { s.validate(s.body()) } finally { s.after?.() }
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export function performanceSuite(name: string, engine: CanvasEngine): void {
  describe(`performance of the pure layer: ${name}`, () => {
    const stress = stressScene()
    const { specs, scene } = stress
    const measures: Measure[] = []

    const judge = (m: Measure) => {
      // The receipt keeps the numbers, not the answers the run was validated on.
      measures.push({ scenario: m.scenario, budgetMs: m.budgetMs, best: m.best, calibration: m.calibration, normalized: m.normalized, median: m.median, p95: m.p95, max: m.max, runs: m.runs })
      expect(m.normalized, `${m.scenario}: ${m.normalized.toFixed(2)} ms on an idle machine (fastest run ${m.best.toFixed(2)} ms, calibration ${m.calibration.toFixed(2)} ms against ${CALIBRATION_IDLE_MS}) against a budget of ${m.budgetMs} ms (slack ${SLACK})`).toBeLessThanOrEqual(m.budgetMs * SLACK)
    }

    afterAll(() => {
      if (OUT) writeFileSync(OUT, JSON.stringify({ engine: name, slack: SLACK, cards: scene.cards.length, connectors: scene.connectors.length, measures }, null, 2))
    })

    it('has the scene of the stress case: about 500 cards and 300 connectors', () => {
      expect(scene.cards.length).toBeGreaterThanOrEqual(500)
      expect(scene.connectors.length).toBe(300)
      expect(specs.length).toBe(scene.cards.length)
    })

    for (const s of performanceScenarios(engine, houseEngine, stress)) {
      it(s.title, { timeout: 60000 }, () => {
        s.before?.()
        try {
          const m = measure(s.title, s.budgetMs, s.runs, s.body)
          // First what was answered, then how fast: a figure for work that was not done is no figure.
          s.validate(m.first)
          s.validate(m.last)
          judge(m)
        } finally { s.after?.() }
      })
    }

    it('answers questions about a card that exists, so none of the above measured an empty answer', () => {
      const first = file('f0-0'), key = keyOf(first)
      expect(key).toBe(fileKey(first))
      const around = engine.hitRect(scene, scene.byKey.get(key)!.rect, 'intersect')
      expect(around).toContain(key)
      expect(engine.route(scene, { pad: 8 }).size).toBe(300)
    })
  })
}
