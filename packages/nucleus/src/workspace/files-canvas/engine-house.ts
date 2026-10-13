/**
 * The house implementation of the engine port: all ten functions in plain TypeScript.
 *
 * Status under the Excalidraw-first posture (see `ENGINE_OWNERSHIP`):
 *  - `dropTarget`, `spatialNeighbor`, `readingOrder`, `tidy`, `nextFreeSlot` and `fitCamera` are OURS:
 *    Excalidraw has nothing equivalent, and this is the implementation.
 *  - `bounds`, `hitRect`, `snap`, `route` and `reroute` are TEST STAND-INS for the Excalidraw-backed functions:
 *    the minimum that lets the reducer, the scene and the suite run today. They are the subject the
 *    port suite was shown to pass and fail on, they are not to be extended, and they are replaced by
 *    `engine-excalidraw.ts` behind the same port.
 */
import type { CanvasEngine, Direction, SceneCard, SceneSnapshot, SnapGuide, SnapResult } from './engine-port.js'
import {
  createSlotOccupancy, fitCamera, freeCellFor, rectCenter, rectContainsPoint, rectContainsRect, rectUnion, rectsIntersect, slotIndexAt, slotRect,
  translateRect, type Pt, type Rect,
} from './geometry.js'
import { rerouteScene, routeScene } from './engine-route.js'

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Cards in reading order: rows, then columns. A row is a band as tall as half a card, starting at
 * its topmost card; the order depends only on positions and keys, never on the order of the array.
 */
function ordered(scene: SceneSnapshot): SceneCard[] {
  const byPosition = [...scene.cards].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || compare(a.key, b.key))
  const band = scene.cardSize.h / 2
  const rows: SceneCard[][] = []
  let anchor = -Infinity
  for (const card of byPosition) {
    if (rows.length && card.rect.y - anchor < band) rows[rows.length - 1]!.push(card)
    else { rows.push([card]); anchor = card.rect.y }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y || compare(a.key, b.key)))
}

function bounds(scene: SceneSnapshot): Rect | null {
  return rectUnion(scene.cards.map((card) => card.rect))
}

function hitRect(scene: SceneSnapshot, rect: Rect, mode: 'intersect' | 'contain'): readonly string[] {
  const hit = mode === 'contain' ? (r: Rect) => rectContainsRect(rect, r) : (r: Rect) => rectsIntersect(rect, r)
  return scene.cards.filter((card) => hit(card.rect)).map((card) => card.key)
}

function readingOrder(scene: SceneSnapshot): readonly string[] {
  return ordered(scene).map((card) => card.key)
}

function spatialNeighbor(scene: SceneSnapshot, from: string, dir: Direction): string | null {
  const origin = scene.byKey.get(from)
  if (!origin) return null
  const order = ordered(scene)
  const c = rectCenter(origin.rect)
  let best: { key: string; dist: number; perp: number; rank: number } | null = null
  for (const [rank, card] of order.entries()) {
    if (card.key === from) continue
    const o = rectCenter(card.rect)
    const dx = o.x - c.x, dy = o.y - c.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const perp = Math.abs(dir === 'left' || dir === 'right' ? dy : dx)
    if (along <= 0 || perp > along) continue
    const dist = Math.hypot(dx, dy)
    if (!best || dist < best.dist || (dist === best.dist && (perp < best.perp || (perp === best.perp && rank < best.rank)))) {
      best = { key: card.key, dist, perp, rank }
    }
  }
  if (best) return best.key
  // At an edge of the layout: step through reading order, so an arrow never traps focus.
  const at = order.findIndex((card) => card.key === from)
  return (dir === 'right' || dir === 'down' ? order[at + 1] : order[at - 1])?.key ?? null
}

function snapAxis(offsets: readonly number[], threshold: number): number | null {
  let best: number | null = null
  for (const o of offsets) {
    if (Math.abs(o) > threshold) continue
    if (best === null || Math.abs(o) < Math.abs(best) || (Math.abs(o) === Math.abs(best) && o < best)) best = o
  }
  return best
}

function snap(scene: SceneSnapshot, moving: readonly string[], delta: Pt, opts: { readonly threshold: number }): SnapResult {
  const movingSet = new Set(moving)
  const movers = scene.cards.filter((card) => movingSet.has(card.key))
  const box = rectUnion(movers.map((card) => card.rect))
  if (!box) return { delta, guides: [] }
  const g = scene.grid
  // A folder that snaps to the grid lands on the grid; alignment guides would fight it.
  if (g) return { delta: { x: Math.round((box.x + delta.x) / g) * g - box.x, y: Math.round((box.y + delta.y) / g) * g - box.y }, guides: [] }

  const refs = scene.cards.filter((card) => !movingSet.has(card.key)).map((card) => card.rect)
  const proposed = translateRect(box, delta)
  const lines = (lo: number, size: number): number[] => [lo, lo + size / 2, lo + size]
  const pairs = (axis: 'x' | 'y'): { offset: number; at: number; ref: Rect }[] => {
    const mine = axis === 'x' ? lines(proposed.x, proposed.w) : lines(proposed.y, proposed.h)
    const out: { offset: number; at: number; ref: Rect }[] = []
    for (const ref of refs) for (const at of axis === 'x' ? lines(ref.x, ref.w) : lines(ref.y, ref.h)) {
      for (const m of mine) out.push({ offset: at - m, at, ref })
    }
    return out
  }
  const chosen = (axis: 'x' | 'y') => {
    const all = pairs(axis)
    const best = snapAxis(all.map((p) => p.offset), opts.threshold)
    return { best, matches: best === null ? [] : all.filter((p) => Math.abs(p.offset - best) < 1e-9) }
  }
  const sx = chosen('x'), sy = chosen('y')
  const snapped: Pt = { x: delta.x + (sx.best ?? 0), y: delta.y + (sy.best ?? 0) }
  const landed = translateRect(box, snapped)
  const guides: SnapGuide[] = []
  const merge = (axis: 'x' | 'y', matches: { at: number; ref: Rect }[]) => {
    const byLine = new Map<number, { from: number; to: number }>()
    for (const { at, ref } of matches) {
      const lo = Math.min(axis === 'x' ? landed.y : landed.x, axis === 'x' ? ref.y : ref.x)
      const hi = Math.max(axis === 'x' ? landed.y + landed.h : landed.x + landed.w, axis === 'x' ? ref.y + ref.h : ref.x + ref.w)
      const seen = byLine.get(at)
      byLine.set(at, seen ? { from: Math.min(seen.from, lo), to: Math.max(seen.to, hi) } : { from: lo, to: hi })
    }
    for (const [at, extent] of [...byLine].sort((p, q) => p[0] - q[0])) guides.push({ axis, at, ...extent })
  }
  merge('x', sx.matches)
  merge('y', sy.matches)
  return { delta: snapped, guides }
}

function dropTarget(scene: SceneSnapshot, moving: readonly string[], at: Pt): string | null {
  const movingSet = new Set(moving)
  for (let i = scene.cards.length - 1; i >= 0; i--) {
    const card = scene.cards[i]!
    if (card.role === 'real' && card.kind === 'folder' && !movingSet.has(card.key) && rectContainsPoint(card.rect, at)) return card.key
  }
  return null
}

function tidy(scene: SceneSnapshot, opts: { readonly origin: Pt; readonly gap: number; readonly columns?: number }): ReadonlyMap<string, Pt> {
  const movable = (card: SceneCard) => card.role === 'real' && !card.locked
  const cards = ordered(scene).filter(movable)
  const fixed = scene.cards.filter((card) => !movable(card)).map((card) => card.rect)
  const columns = Math.max(1, Math.floor(opts.columns ?? Math.ceil(Math.sqrt(cards.length))))
  const { w, h } = scene.cardSize
  const result = new Map<string, Pt>()
  let slot = 0
  for (const card of cards) {
    let rect: Rect
    do {
      rect = { x: opts.origin.x + (slot % columns) * (w + opts.gap), y: opts.origin.y + Math.floor(slot / columns) * (h + opts.gap), w, h }
      slot++
    } while (fixed.some((other) => rectsIntersect(other, rect)))
    result.set(card.key, { x: rect.x, y: rect.y })
  }
  return result
}

function nextFreeSlot(scene: SceneSnapshot, near: Pt | null, gap: number, region?: Rect): Pt {
  const lattice = { size: scene.cardSize, gap, columns: scene.slotColumns }
  if (region) {
    const { x, y } = freeCellFor(lattice, region, scene.cards.map((card) => card.rect))
    return { x, y }
  }
  const occupancy = createSlotOccupancy(lattice, scene.cards.map((card) => card.rect))
  const { x, y } = slotRect(lattice, occupancy.firstFree(slotIndexAt(lattice, near)))
  return { x, y }
}

export const houseEngine: CanvasEngine = {
  bounds,
  hitRect,
  spatialNeighbor,
  readingOrder,
  snap,
  dropTarget,
  route: (scene, opts) => routeScene(scene, opts),
  reroute: (scene, moved, previous, opts) => rerouteScene(scene, moved, previous, opts),
  tidy,
  nextFreeSlot,
  fitCamera,
}
