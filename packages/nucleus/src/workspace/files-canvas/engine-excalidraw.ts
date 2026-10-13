/**
 * The Excalidraw-backed engine of the Files canvas: `bounds`, `hitRect`, `dropTarget`'s point test, `snap`, `route` and `reroute`
 * run on Excalidraw's own engine modules (`@excalidraw/{element,math,common}`, exact-pinned at 0.18.0-4ce38fb, no React, no DOM),
 * behind the port. What Excalidraw has no equivalent for stays the house's (`ENGINE_OWNERSHIP`): reading order, spatial
 * neighbours, tidy, free-slot search, fit-camera, and the three layers an engine's elbows lack, which sit on top of its routes:
 * facing-side policy and attachment spreading (`planConnectors`), obstacle avoidance across third cards (`avoidObstacles`: an
 * Excalidraw elbow avoids only the two shapes it is bound to), and label de-collision (`placeLabels`).
 *
 * LAZY. Import this module with `import()` (see `engine-default.ts`); `index.ts` never imports it statically, so a route that does
 * not draw a canvas pays nothing for Excalidraw. No `Scene`, no `window`: elements live in a plain `Map`, which is all the
 * element modules read (`elementsMap`), so there is no scene timer to leak and no global to shim.
 *
 * What the port's rules ask, and how this keeps them:
 *  - Rule 1: no element, binding or scene JSON crosses the port. The elements are an engine-private translation of the snapshot.
 *  - Rule 2: the translation is cached on the engine, never on an answer. Every call first reconciles it against the snapshot it
 *    was given, card by card (a linear pass: a rect compared to an element's four numbers), so a snapshot patched where it stands
 *    is seen as it is now. The one memo Excalidraw keeps itself, `hitElementItself`'s, is defeated (below).
 *  - Rule 2b: `prepareDrag` primes Excalidraw's process-global `SnapCache` with the reference points of every card that is not
 *    moving; `releaseDrag` and `dispose` destroy it. The cache is shared by every engine in the realm, so each engine remembers
 *    whether it is the one that primed it, and primes again for the call when it is not (or when the cards or the moving set are not
 *    what it was primed for). One drag per realm, as upstream.
 *
 * Known edges of the pin, held by the contract suite (it is the upgrade guard: the package is a pre-release snapshot and 8% of its
 * exports vanished across the 15 months before it): the `hitElementItself` memo (`defeatHitMemo`), the snap cache above, and the
 * elbow router's habit of keeping the sides a binding names (a binding is rebuilt from the plan for every route, so a route is a
 * function of the cards and the plan, never of an earlier route).
 */
import {
  boundsContainBounds,
  doBoundsIntersect,
  getCommonBounds,
  getElementBounds,
  hitElementItself,
  mutateElement,
  newArrowElement,
  newElement,
  updateElbowArrowPoints,
} from '@excalidraw/element'
import type { ExcalidrawElbowArrowElement, ExcalidrawRectangleElement, FixedPointBinding, NonDeletedSceneElementsMap } from '@excalidraw/element/types'
import { pointFrom } from '@excalidraw/math'
import { houseEngine } from './engine-house.js'
import type { CanvasEngine, ConnectorPath, FileKey, SceneCard, SceneSnapshot, Side, SnapGuide, SnapResult } from './engine-port.js'
import { type BaseRouter, elbow, isHorizontal, type Plan, pathOf, rerouteScene, routeScene, simplify } from './engine-route.js'
import { type Pt, type Rect, rectContainsPoint } from './geometry.js'
import { getReferenceSnapPoints, SnapCache, snapDraggedElements } from './vendor/excalidraw/snapping.js'
import type { AppClassProperties, AppState } from './vendor/excalidraw/types.js'

type Card = ExcalidrawRectangleElement
type Cards = Map<FileKey, Card>

/** Far enough in every direction that every card is "visible" to the snapper (it considers only what the viewport shows). */
const FAR = 1e9
/** The viewport is this wide at any zoom the snap distance asks for (8 / threshold). */
const WIDE = 1e15
const NO_KEYS = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false } as const
/**
 * Excalidraw's point test works on the outline with a tolerance, and is strict at 0: a card's corner is a miss at any tolerance below
 * about 0.01. The engine answers "on the card, give or take a hundredth"; the port's rule for a shared edge is applied exactly after.
 */
const HIT_TOLERANCE = 0.01

/** Who primed the realm's one `SnapCache`: engines share it, so each asks whether the cache is still its own. */
let snapOwner: symbol | null = null

export interface ExcalidrawEngineStats {
  /** Connectors whose Excalidraw route was not one a plan can use (wrong side, wrong end) and fell back to the house elbow. */
  fallbacks: number
  /**
   * Connectors whose Excalidraw route had more bends than the plain elbow between the same two points and was replaced by it. The
   * router keeps 40 units of clearance in front of each bound card and loops round when the cards are nearer than that. Also a jog of a
   * few units, which it draws as a diagonal.
   */
  simplified: number
  /** Cards and connectors the translation has been rebuilt for, since the engine was made. */
  syncs: number
}

export interface ExcalidrawEngine extends CanvasEngine {
  readonly stats: ExcalidrawEngineStats
  /** True while this engine holds the realm's snap cache. */
  holdsSnapCache(): boolean
}

/**
 * Is `at` on the card? Excalidraw answers, except in the band of a few hundredths round the card's edge, where its outline test is
 * not the port's rule (near edges inclusive, far edges exclusive: adjacent cards never both contain one point) and the rect decides.
 */
function onCard(el: Card, at: Pt, engineSays: boolean): boolean {
  const inside = at.x > el.x + HIT_TOLERANCE * 2 && at.x < el.x + el.width - HIT_TOLERANCE * 2 && at.y > el.y + HIT_TOLERANCE * 2 && at.y < el.y + el.height - HIT_TOLERANCE * 2
  const outside = at.x < el.x - HIT_TOLERANCE * 2 || at.x > el.x + el.width + HIT_TOLERANCE * 2 || at.y < el.y - HIT_TOLERANCE * 2 || at.y > el.y + el.height + HIT_TOLERANCE * 2
  return inside || outside ? engineSays : rectContainsPoint(rectOf(el), at)
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/**
 * The guides with their coordinates restored to the cards' own: Excalidraw reports lines rounded to six places, and a line is where
 * a card's edge or centre is.
 */
function exactGuides(scene: SceneSnapshot, moving: ReadonlySet<FileKey>, guides: readonly SnapGuide[]): SnapGuide[] {
  const lines = (axis: 'x' | 'y'): number[] => scene.cards.flatMap((c) => {
    if (moving.has(c.key)) return []
    const lo = axis === 'x' ? c.rect.x : c.rect.y, size = axis === 'x' ? c.rect.w : c.rect.h
    return [lo, lo + size / 2, lo + size]
  })
  const xs = lines('x'), ys = lines('y')
  return guides.map((g) => {
    const at = (g.axis === 'x' ? xs : ys).find((v) => Math.abs(v - g.at) < 1e-5)
    return at === undefined ? g : { ...g, at }
  })
}

const first = <T>(items: readonly T[]): T => items[0]!
const rectOf = (el: Card): Rect => ({ x: el.x, y: el.y, w: el.width, h: el.height })

function makeCard(card: SceneCard): Card {
  return newElement({
    type: 'rectangle',
    // Honoured at runtime; absent from the declared option type.
    id: card.key,
    x: card.rect.x,
    y: card.rect.y,
    width: card.rect.w,
    height: card.rect.h,
    // A solid fill: a transparent rectangle is hit on its outline only. No stroke: bounds are the card's, not the card's plus half a line.
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeWidth: 0,
    roundness: null,
  } as Parameters<typeof newElement>[0]) as Card
}

/** The edge point's place on its card as Excalidraw states a binding: ratios of the card, on the side the connector uses. */
function bindingAt(card: Card, side: Side, at: Pt): FixedPointBinding {
  const tx = card.width ? (at.x - card.x) / card.width : 0.5
  const ty = card.height ? (at.y - card.y) / card.height : 0.5
  const fixedPoint = side === 'right' ? [1, ty] : side === 'left' ? [0, ty] : side === 'top' ? [tx, 0] : [tx, 1]
  return { elementId: card.id, mode: 'orbit', fixedPoint } as unknown as FixedPointBinding
}

/** How far the router's own endpoints may sit from the plan's before the route is not the plan's (a binding gap is 5). */
const REACH = 8

/**
 * Excalidraw's polyline for a connector, made exact: orthogonal to the last bit, starting and ending on the edge points of the plan.
 * The router's endpoints sit a binding gap off the edge, and its corner coordinates carry float noise, so the corners keep
 * Excalidraw's choice along each segment and take the previous corner's coordinate across it. Returns null when the route is not one
 * the plan can use (it ends far from the plan's points, leaves the wrong way, or does not meet the end's side), and the caller falls
 * back to the house elbow for that connector.
 */
function exact(plan: Plan, raw: readonly Pt[]): Pt[] | null {
  const n = raw.length
  if (n < 2) return null
  const first = raw[0]!, last = raw[n - 1]!
  if (Math.abs(first.x - plan.a.x) > REACH || Math.abs(first.y - plan.a.y) > REACH || Math.abs(last.x - plan.b.x) > REACH || Math.abs(last.y - plan.b.y) > REACH) return null
  const horizontalAt = (segment: number): boolean => isHorizontal(plan.sa) !== (segment % 2 === 1)
  // The last segment runs along the axis of the end side's normal, and arrives at `b`.
  const finalHorizontal = horizontalAt(n - 2)
  if (finalHorizontal !== isHorizontal(plan.sb)) return null
  const out: Pt[] = [plan.a]
  for (let i = 1; i < n - 1; i++) {
    const prev = out[i - 1]!
    out.push(horizontalAt(i - 1) ? { x: raw[i]!.x, y: prev.y } : { x: prev.x, y: raw[i]!.y })
  }
  if (n === 2) {
    if (finalHorizontal ? plan.a.y !== plan.b.y : plan.a.x !== plan.b.x) return null
  } else {
    // The corner before the end takes the end's own coordinate across the last segment.
    const corner = out[n - 2]!
    if (finalHorizontal ? Math.abs(corner.y - plan.b.y) > REACH : Math.abs(corner.x - plan.b.x) > REACH) return null
    out[n - 2] = finalHorizontal ? { x: corner.x, y: plan.b.y } : { x: plan.b.x, y: corner.y }
  }
  out.push(plan.b)
  const path = simplify(out)
  if (path.length < 2) return null
  // It leaves the card by the side it names and enters the other card by its side.
  const out0 = path[1]!, inN = path[path.length - 2]!
  const leaves = isHorizontal(plan.sa) ? (plan.sa === 'right' ? out0.x >= plan.a.x : out0.x <= plan.a.x) : (plan.sa === 'bottom' ? out0.y >= plan.a.y : out0.y <= plan.a.y)
  const enters = isHorizontal(plan.sb) ? (plan.sb === 'right' ? inN.x >= plan.b.x : inN.x <= plan.b.x) : (plan.sb === 'bottom' ? inN.y >= plan.b.y : inN.y <= plan.b.y)
  return leaves && enters ? path : null
}

export interface ExcalidrawEngineOptions {
  /** The engine the functions Excalidraw has no equivalent for come from. Default: the house engine. */
  readonly base?: CanvasEngine
  /**
   * Keep the routes it has made, by the numbers they were made from (see `made`). Default true. Off, every route is made again: the
   * figure for a scene nobody has routed before, which is what a benchmark that repeats one scene must ask for.
   */
  readonly routeCache?: boolean
  /**
   * TEST ONLY. Leave `hitElementItself`'s one-entry memo alone (the hazard `defeatHitMemo` exists for), so a test can show the
   * hazard is real and that the engine without this flag is not subject to it.
   */
  readonly unsafeKeepHitMemo?: boolean
}

export function createExcalidrawEngine(options: ExcalidrawEngineOptions = {}): ExcalidrawEngine {
  const base = options.base ?? houseEngine
  const routeCache = options.routeCache ?? true
  const cards: Cards = new Map()
  const stats: ExcalidrawEngineStats = { fallbacks: 0, simplified: 0, syncs: 0 }
  const token = Symbol('files-canvas-engine')
  /** Bumped whenever the translation changed: what a primed snap cache is valid for. */
  let revision = 0
  let primed: { revision: number; moving: ReadonlySet<FileKey> } | null = null

  // The scratch arrow routes are computed on: one object, every field reset before each route, so a route depends on nothing earlier.
  const scratch = newArrowElement({ type: 'arrow', id: 'files-canvas-scratch', x: 0, y: 0, points: [pointFrom(0, 0), pointFrom(1, 1)], elbowed: true } as Parameters<typeof newArrowElement>[0]) as ExcalidrawElbowArrowElement
  // The poison for the hit memo: an element nothing else touches, and two points inside it.
  const poison = newElement({ type: 'rectangle', id: 'files-canvas-poison', x: 0, y: 0, width: 4, height: 4, backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 0 } as Parameters<typeof newElement>[0]) as Card
  const poisonMap = new Map([[poison.id, poison]]) as unknown as NonDeletedSceneElementsMap

  const map = () => cards as unknown as NonDeletedSceneElementsMap

  /** Reconcile the translation with the snapshot: add, move, resize, drop. Linear in the cards; the whole of rule 2. */
  function sync(scene: SceneSnapshot): void {
    let changed = false
    for (const card of scene.cards) {
      const el = cards.get(card.key)
      const r = card.rect
      if (!el) {
        cards.set(card.key, makeCard(card))
        changed = true
      } else if (el.x !== r.x || el.y !== r.y || el.width !== r.w || el.height !== r.h) {
        mutateElement(el, map() as never, { x: r.x, y: r.y, width: r.w, height: r.h })
        changed = true
      }
    }
    if (cards.size !== scene.cards.length || (changed && cards.size > 0)) {
      for (const key of [...cards.keys()]) if (!scene.byKey.has(key)) { cards.delete(key); changed = true }
    }
    if (changed) { revision++; stats.syncs++ }
  }

  const elementsOf = (scene: SceneSnapshot): Card[] => scene.cards.map((c) => cards.get(c.key)!)

  /**
   * hitElementItself (0.18.0-4ce38fb) keeps a one-entry memo of the last (point, element) it was asked and validates it by comparing the
   * cached element, a WeakRef to the same object, with itself: after an IN-PLACE mutation the same point asked again gets the old answer.
   * The memo is only written once the bounding-box prefilter passes, so before a scan we ask about a point of our own element that is
   * never the scan's point; that overwrites the memo with (poison point, poison element), which no card matches.
   */
  function defeatHitMemo(at: Pt): void {
    if (options.unsafeKeepHitMemo) return
    const probe = at.x === 1 && at.y === 1 ? pointFrom<never>(2, 2) : pointFrom<never>(1, 1)
    hitElementItself({ point: probe, element: poison, threshold: HIT_TOLERANCE, elementsMap: poisonMap })
  }

  function appState(selected: ReadonlySet<FileKey>, threshold: number): AppState {
    const selectedElementIds: Record<string, true> = {}
    for (const key of selected) selectedElementIds[key] = true
    return {
      // The snap distance is 8 / zoom: the zoom that makes it the caller's threshold.
      zoom: { value: 8 / threshold },
      activeTool: { type: 'selection' },
      selectedElementsAreBeingDragged: true,
      objectsSnapModeEnabled: true,
      gridModeEnabled: false,
      selectedElementIds,
      selectedGroupIds: {},
      editingGroupId: null,
      scrollX: FAR, scrollY: FAR, width: WIDE, height: WIDE, offsetLeft: 0, offsetTop: 0,
    }
  }
  const appFor = (state: AppState): AppClassProperties => ({ props: {}, state })

  function prime(scene: SceneSnapshot, moving: ReadonlySet<FileKey>): void {
    const state = appState(moving, 1)
    const all = elementsOf(scene)
    const chosen = all.filter((el) => moving.has(el.id))
    // Reference points only: gap snapping (equal spacing) is Excalidraw's own idea, not the port's; without visible gaps it finds none.
    SnapCache.setReferenceSnapPoints(getReferenceSnapPoints(all as never, chosen as never, state as never, map() as never))
    SnapCache.setVisibleGaps(null)
    snapOwner = token
    primed = { revision, moving }
  }

  const isPrimedFor = (moving: ReadonlySet<FileKey>): boolean =>
    snapOwner === token && primed !== null && primed.revision === revision && primed.moving.size === moving.size && [...moving].every((k) => primed!.moving.has(k))

  function release(): void {
    if (snapOwner === token) { SnapCache.destroy(); snapOwner = null }
    primed = null
  }

  const guidesOf = (lines: readonly { type: string; points: readonly (readonly number[])[] }[]): SnapGuide[] => {
    const guides: SnapGuide[] = []
    const add = (g: SnapGuide) => { if (!guides.some((k) => k.axis === g.axis && k.at === g.at)) guides.push(g) }
    for (const line of lines) {
      if (line.type !== 'points' || !line.points.length) continue
      const xs = line.points.map((p) => p[0]!), ys = line.points.map((p) => p[1]!)
      const sameX = xs.every((x) => x === xs[0]), sameY = ys.every((y) => y === ys[0])
      // A line of one point (a corner met exactly on a corner) is both axes' line.
      if (sameX) add({ axis: 'x', at: xs[0]!, from: Math.min(...ys), to: Math.max(...ys) })
      if (sameY) add({ axis: 'y', at: ys[0]!, from: Math.min(...xs), to: Math.max(...xs) })
    }
    return guides.sort((p, q) => (p.axis === q.axis ? p.at - q.at : p.axis < q.axis ? -1 : 1))
  }

  /**
   * Routes already made, by connector, each with the numbers it was made from: the two cards' rects, the sides, the attachment points,
   * the stub. A route is a function of exactly those, so an entry is good for any snapshot that hands the same numbers back, and for
   * none that does not (a card has to have moved for a number to differ). This is what lets a reroute pay for the arrows a move
   * changes and not for the ones it merely touched (an unmoved neighbour on a shared side whose attachment point did not shift).
   */
  const made = new Map<string, { readonly sig: readonly number[]; readonly points: Pt[] }>()
  const SIDE: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 }
  const sigOf = (plan: Plan, pad: number): number[] => {
    const f = plan.from.rect, t = plan.to.rect
    return [f.x, f.y, f.w, f.h, t.x, t.y, t.w, t.h, plan.a.x, plan.a.y, plan.b.x, plan.b.y, SIDE[plan.sa], SIDE[plan.sb], plan.room, pad]
  }
  const sameSig = (a: readonly number[], b: readonly number[]): boolean => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  /** Excalidraw's elbow router for the connectors of a plan, made exact. */
  const excalidrawBase: BaseRouter = (plans, pad) => {
    const out = new Map<string, ConnectorPath>()
    for (const plan of plans) {
      const sig = sigOf(plan, pad)
      const kept = routeCache ? made.get(plan.connector.id) : undefined
      if (kept && sameSig(kept.sig, sig)) { out.set(plan.connector.id, pathOf(plan, kept.points)); continue }
      const from = cards.get(plan.from.key), to = cards.get(plan.to.key)
      let points: Pt[] | null = null
      let jog = false
      if (from && to) {
        const startBinding = bindingAt(from, plan.sa, plan.a), endBinding = bindingAt(to, plan.sb, plan.b)
        // Every field the router reads is set again: a route is a function of this plan and these cards.
        Object.assign(scratch, { x: plan.a.x, y: plan.a.y, points: [pointFrom(0, 0), pointFrom(plan.b.x - plan.a.x, plan.b.y - plan.a.y)], startBinding: null, endBinding: null, fixedSegments: null, startIsSpecial: null, endIsSpecial: null })
        const update = updateElbowArrowPoints(scratch, map(), { points: [pointFrom(0, 0), pointFrom(plan.b.x - plan.a.x, plan.b.y - plan.a.y)], startBinding, endBinding })
        const ox = update.x ?? plan.a.x, oy = update.y ?? plan.a.y
        const raw = (update.points ?? []).map((p) => ({ x: ox + p[0], y: oy + p[1] }))
        points = exact(plan, raw)
        // Two points that are not level are a jog of a few units that the router drew as a diagonal: the plain elbow draws it square.
        if (!points && raw.length === 2 && Math.abs(first(raw).x - plan.a.x) <= REACH && Math.abs(first(raw).y - plan.a.y) <= REACH) jog = true
      }
      const plain = (): Pt[] => elbow(plan.a, plan.sa, plan.b, plan.sb, plan.room, pad)
      if (!points && jog) {
        stats.simplified++
        points = plain()
      } else if (!points) {
        stats.fallbacks++
        points = plain()
      } else {
        // A card route is one or two bends; an elbow that needs more than the plain one has looped round a neighbour it was too near.
        const simple = plain()
        if (points.length > simple.length) { stats.simplified++; points = simple }
      }
      if (routeCache) made.set(plan.connector.id, { sig, points })
      out.set(plan.connector.id, pathOf(plan, points))
    }
    return out
  }

  const engine: ExcalidrawEngine = {
    ...base,
    stats,
    holdsSnapCache: () => snapOwner === token,

    bounds(scene) {
      if (!scene.cards.length) return null
      sync(scene)
      const [x0, y0, x1, y1] = getCommonBounds(elementsOf(scene) as never)
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    },

    hitRect(scene, rect, mode) {
      sync(scene)
      const box = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h] as never
      const hit = mode === 'contain' ? boundsContainBounds : doBoundsIntersect
      const out: FileKey[] = []
      for (const card of scene.cards) {
        const el = cards.get(card.key)!
        const b = getElementBounds(el, map() as never)
        if (mode === 'contain' ? boundsContainBounds(box, b) : hit(box, b)) out.push(card.key)
      }
      return out
    },

    dropTarget(scene, moving, at) {
      sync(scene)
      const movingSet = new Set(moving)
      defeatHitMemo(at)
      const point = pointFrom<never>(at.x, at.y)
      for (let i = scene.cards.length - 1; i >= 0; i--) {
        const card = scene.cards[i]!
        if (card.role !== 'real' || card.kind !== 'folder' || movingSet.has(card.key)) continue
        const el = cards.get(card.key)!
        if (onCard(el, at, hitElementItself({ point, element: el, threshold: HIT_TOLERANCE, elementsMap: map() as never }))) return card.key
      }
      return null
    },

    snap(scene, moving, delta, opts): SnapResult {
      const movingSet = new Set(moving.filter((k) => scene.byKey.has(k)))
      if (!movingSet.size) return { delta, guides: [] }
      // A folder that snaps to the grid lands on the grid; alignment guides would fight it. The grid is ours.
      if (scene.grid || !(opts.threshold > 0)) return base.snap(scene, moving, delta, opts)
      sync(scene)
      if (!isPrimedFor(movingSet)) prime(scene, movingSet)
      const state = appState(movingSet, opts.threshold)
      // Excalidraw works to six places; the drag offset it is given is the one its offsets are measured from.
      const rounded = { x: round6(delta.x), y: round6(delta.y) }
      const { snapOffset, snapLines } = snapDraggedElements(elementsOf(scene) as never, { ...rounded }, appFor(state) as never, NO_KEYS as never, map() as never)
      const guides = exactGuides(scene, movingSet, guidesOf(snapLines as never))
      // An axis it did not snap keeps the caller's delta to the last bit.
      const along = (axis: 'x' | 'y'): number => (snapOffset[axis] === 0 ? delta[axis] : rounded[axis] + snapOffset[axis])
      return { delta: { x: along('x'), y: along('y') }, guides }
    },

    route(scene, opts) {
      sync(scene)
      // A full route forgets the connectors that are gone, so a long-lived engine does not keep routes for a folder it left.
      if (made.size > scene.connectors.length) { const ids = new Set(scene.connectors.map((c) => c.id)); for (const id of made.keys()) if (!ids.has(id)) made.delete(id) }
      return routeScene(scene, opts, excalidrawBase)
    },

    reroute(scene, moved, previous, opts) {
      sync(scene)
      return rerouteScene(scene, moved, previous, opts, excalidrawBase)
    },

    prepareDrag(scene, moving) {
      sync(scene)
      prime(scene, new Set(moving.filter((k) => scene.byKey.has(k))))
    },
    releaseDrag: release,
    dispose() {
      release()
      cards.clear()
      made.clear()
      revision++
    },
  }
  return engine
}

/** One engine for the realm, made on first use. A host that wants its own (and its own lifecycle) calls `createExcalidrawEngine`. */
export const excalidrawEngine = (): ExcalidrawEngine => (shared ??= createExcalidrawEngine())
let shared: ExcalidrawEngine | null = null
