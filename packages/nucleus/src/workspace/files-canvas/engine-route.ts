/**
 * Connector routing for the house engine, in layers.
 *
 * STATUS: `baseElbows` and `rerouteScene` are TEST STAND-INS for the Excalidraw-backed `route` and `reroute` (see
 * `ENGINE_OWNERSHIP`): bound arrows kept attached by `scene.mutateElement` + `updateBoundElements`. They exist so the reducer, the
 * scene and the port suite have something real to run against today; they are not to be extended. `avoidObstacles` and
 * `placeLabels` are OURS and stay: they are written to sit on top of any router, because an engine's route avoids only its two
 * bound shapes (Excalidraw's elbows cross a third card in the way, and label placement is nowhere in it).
 *
 *   1. `baseElbows`      the elbow between the facing sides of each connector's two cards: attached to the edges it names, one or two
 *                        bends (a straight line when aligned), attachment points spread along an edge several connectors share.
 *   2. `avoidObstacles`  a connector whose path crosses a glyph box is routed again between the same two ends: first a lane beside
 *                        the endpoints' glyphs, then a lane beside any glyph in the way (five segments), then an A* search over the
 *                        lines through the glyph boxes near it, with a bend penalty. When overlapping cards leave no route the path
 *                        is returned as it was: still attached to the edges it names, with its label still on the path.
 *   3. `placeLabels`     label anchors that do not pile on each other.
 *   `routeScene` is 1, 2 and 3 in turn. `rerouteScene` redoes only what a move reaches (the connectors it touches, and those it has
 *   newly blocked), each from the elbow as `routeScene` would, and places their labels around the labels it kept.
 */
import type { ConnectorPath, SceneCard, SceneConnector, SceneSnapshot, Side } from './engine-port.js'
import {
  inflateRect, rectBottom, rectCenter, rectRight, rectsIntersect, segmentHitsRect, type Pt, type Rect,
} from './geometry.js'
import { graphemeCount } from './labels.js'

const LABEL_H = 18
const LABEL_CHAR_W = 6.5
const LABEL_PAD_X = 8
const LABEL_MAX_W = 200
const LABEL_STEP = 20
const BEND_PENALTY = 24
const MAX_SEARCH_NODES = 8000
const MAX_LANE_TRIES = 24

/** Estimated width of a label: the engine has no font to measure with, so it counts grapheme clusters. */
function labelWidth(label: string): number {
  const text = label.trim()
  // Plain ASCII is one grapheme per character; only other text needs the (slow) segmenter.
  const count = /^[\x20-\x7e]*$/.test(text) ? text.length : graphemeCount(text)
  return count === 0 ? 0 : Math.min(LABEL_MAX_W, LABEL_PAD_X * 2 + LABEL_CHAR_W * count)
}

const boxAt = (w: number, at: Pt): Rect => ({ x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H })

/** The estimated box of a connector label centred on `at`; null for a label with no text. */
export function labelBox(label: string, at: Pt): Rect | null {
  const w = labelWidth(label)
  return w === 0 ? null : boxAt(w, at)
}

/**
 * A dense uniform grid over glyph boxes, so a segment test only meets the boxes near it. Cells are
 * stored compressed (offsets into one array of box indices); the grid is capped at about 512 x 512
 * cells by growing the cell size for very spread-out scenes.
 */
class GlyphIndex {
  readonly rects: readonly Rect[]
  private readonly x0: number
  private readonly y0: number
  private readonly cell: number
  private readonly cols: number
  private readonly rows: number
  private readonly offsets: Int32Array
  private readonly items: Int32Array
  private readonly mark: Int32Array
  private stamp = 0
  constructor(rects: readonly Rect[], baseCell: number) {
    this.rects = rects
    this.mark = new Int32Array(rects.length)
    const union = rects.reduce<Rect | null>((u, r) => (u ? {
      x: Math.min(u.x, r.x), y: Math.min(u.y, r.y),
      w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x), h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y),
    } : r), null) ?? { x: 0, y: 0, w: 1, h: 1 }
    this.x0 = union.x
    this.y0 = union.y
    this.cell = Math.max(baseCell, Math.ceil(Math.max(union.w, union.h) / 512))
    this.cols = Math.floor(union.w / this.cell) + 1
    this.rows = Math.floor(union.h / this.cell) + 1
    const counts = new Int32Array(this.cols * this.rows + 1)
    const span = (r: Rect) => [this.col(r.x), this.col(r.x + r.w), this.row(r.y), this.row(r.y + r.h)] as const
    for (const r of rects) {
      const [c0, c1, r0, r1] = span(r)
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) counts[row * this.cols + col + 1]!++
    }
    for (let i = 1; i < counts.length; i++) counts[i]! += counts[i - 1]!
    this.offsets = counts
    this.items = new Int32Array(counts[counts.length - 1]!)
    const fill = counts.slice(0, -1)
    rects.forEach((r, i) => {
      const [c0, c1, r0, r1] = span(r)
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) this.items[fill[row * this.cols + col]!++] = i
    })
  }
  private col(x: number): number { return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))) }
  private row(y: number): number { return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell))) }
  /** Does the segment pass through the interior of any glyph box? */
  hits(a: Pt, b: Pt): boolean {
    const stamp = ++this.stamp
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
    // Cells outside the grid hold no boxes, but a segment may start outside it: clamp, do not skip.
    const c0 = this.col(lo.x), c1 = this.col(hi.x), r0 = this.row(lo.y), r1 = this.row(hi.y)
    const horizontal = a.y === b.y, vertical = a.x === b.x
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const cellIndex = row * this.cols + col
      for (let k = this.offsets[cellIndex]!; k < this.offsets[cellIndex + 1]!; k++) {
        const i = this.items[k]!
        if (this.mark[i] === stamp) continue
        this.mark[i] = stamp
        const r = this.rects[i]!
        if (horizontal) { if (r.y < a.y && a.y < r.y + r.h && r.x < hi.x && lo.x < r.x + r.w) return true }
        else if (vertical) { if (r.x < a.x && a.x < r.x + r.w && r.y < hi.y && lo.y < r.y + r.h) return true }
        else if (segmentHitsRect(a, b, r)) return true
      }
    }
    return false
  }
  /** Glyph boxes overlapping `region`. */
  query(region: Rect): Rect[] {
    const stamp = ++this.stamp
    const found: Rect[] = []
    const c0 = this.col(region.x), c1 = this.col(region.x + region.w), r0 = this.row(region.y), r1 = this.row(region.y + region.h)
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const cellIndex = row * this.cols + col
      for (let k = this.offsets[cellIndex]!; k < this.offsets[cellIndex + 1]!; k++) {
        const i = this.items[k]!
        if (this.mark[i] === stamp) continue
        this.mark[i] = stamp
        if (rectsIntersect(region, this.rects[i]!)) found.push(this.rects[i]!)
      }
    }
    return found
  }
}

const NORMAL: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
export const isHorizontal = (side: Side): boolean => side === 'left' || side === 'right'

/** Facing sides by relative position, preferring the axis where the cards are further apart and actually have room. */
function chooseSides(a: Rect, b: Rect): { sa: Side; sb: Side; room: number } {
  const ca = rectCenter(a), cb = rectCenter(b)
  const dx = cb.x - ca.x, dy = cb.y - ca.y
  const gapX = dx >= 0 ? b.x - rectRight(a) : a.x - rectRight(b)
  const gapY = dy >= 0 ? b.y - rectBottom(a) : a.y - rectBottom(b)
  let horizontal = Math.abs(dx) >= Math.abs(dy)
  if (horizontal && gapX <= 0 && gapY > 0) horizontal = false
  else if (!horizontal && gapY <= 0 && gapX > 0) horizontal = true
  const sa: Side = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
  return { sa, sb: OPPOSITE[sa], room: Math.max(0, horizontal ? gapX : gapY) }
}

function edgePoint(rect: Rect, side: Side, t: number): Pt {
  switch (side) {
    case 'right': return { x: rect.x + rect.w, y: rect.y + t * rect.h }
    case 'left': return { x: rect.x, y: rect.y + t * rect.h }
    case 'top': return { x: rect.x + t * rect.w, y: rect.y }
    default: return { x: rect.x + t * rect.w, y: rect.y + rect.h }
  }
}


export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!, b = out[i]!, c = out[i + 1]!
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(i, 1)
  }
  return out
}

const clear = (index: GlyphIndex, points: readonly Pt[]): boolean => {
  for (let i = 0; i + 1 < points.length; i++) if (index.hits(points[i]!, points[i + 1]!)) return false
  return true
}

/** A* over the lines through the glyph boxes near a connector; null when nothing within reach connects the stubs. */
function searchPath(pa: Pt, pb: Pt, index: GlyphIndex, pad: number): Pt[] | null {
  const box = { x: Math.min(pa.x, pb.x), y: Math.min(pa.y, pb.y), w: Math.abs(pb.x - pa.x), h: Math.abs(pb.y - pa.y) }
  const reachStart = 4 * Math.max(pad, 8) + 96
  for (let reach = reachStart; reach <= reachStart * 8; reach *= 2) {
    const region = inflateRect(box, reach)
    const obstacles = index.query(region)
    const xs = new Set<number>([pa.x, pb.x, region.x, region.x + region.w])
    const ys = new Set<number>([pa.y, pb.y, region.y, region.y + region.h])
    for (const g of obstacles) {
      for (const x of [g.x - pad, g.x + g.w + pad]) if (x >= region.x && x <= region.x + region.w) xs.add(x)
      for (const y of [g.y - pad, g.y + g.h + pad]) if (y >= region.y && y <= region.y + region.h) ys.add(y)
    }
    const X = [...xs].sort((p, q) => p - q), Y = [...ys].sort((p, q) => p - q)
    if (X.length * Y.length > MAX_SEARCH_NODES) return null
    const found = astar(pa, pb, X, Y, obstacles)
    if (found) return found
  }
  return null
}

function astar(pa: Pt, pb: Pt, X: number[], Y: number[], obstacles: readonly Rect[]): Pt[] | null {
  const nx = X.length, ny = Y.length
  const xi = new Map(X.map((x, i) => [x, i])), yi = new Map(Y.map((y, i) => [y, i]))
  const si = xi.get(pa.x)!, sj = yi.get(pa.y)!, gi = xi.get(pb.x)!, gj = yi.get(pb.y)!
  const inside = (x: number, y: number) => obstacles.some((g) => x > g.x && x < g.x + g.w && y > g.y && y < g.y + g.h)
  const nodeFree = new Int8Array(nx * ny)
  const free = (i: number, j: number): boolean => {
    const k = i * ny + j
    if (nodeFree[k] === 0) nodeFree[k] = inside(X[i]!, Y[j]!) ? 2 : 1
    return nodeFree[k] === 1
  }
  if (!free(si, sj) || !free(gi, gj)) return null
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1]
  const stateCount = nx * ny * 5
  const best = new Float64Array(stateCount).fill(Infinity)
  const parent = new Int32Array(stateCount).fill(-1)
  const heap: { f: number; s: number }[] = []
  const push = (f: number, s: number) => {
    heap.push({ f, s })
    let i = heap.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.f <= heap[i]!.f) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l]!.f < heap[m]!.f) m = l
        if (r < heap.length && heap[r]!.f < heap[m]!.f) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
        i = m
      }
    }
    return top
  }
  const h = (i: number, j: number) => Math.abs(X[i]! - pb.x) + Math.abs(Y[j]! - pb.y)
  const start = (si * ny + sj) * 5 + 4
  best[start] = 0
  push(h(si, sj), start)
  while (heap.length) {
    const { s } = pop()
    const dir = s % 5, cell = (s - dir) / 5, i = Math.floor(cell / ny), j = cell - i * ny
    if (i === gi && j === gj) {
      const pts: Pt[] = []
      for (let cur = s; cur !== -1; cur = parent[cur]!) {
        const c = Math.floor(cur / 5), ci = Math.floor(c / ny), cj = c - ci * ny
        pts.push({ x: X[ci]!, y: Y[cj]! })
      }
      return pts.reverse()
    }
    for (let d = 0; d < 4; d++) {
      const ni = i + DX[d]!, nj = j + DY[d]!
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !free(ni, nj)) continue
      const a = { x: X[i]!, y: Y[j]! }, b = { x: X[ni]!, y: Y[nj]! }
      if (obstacles.some((g) => segmentHitsRect(a, b, g))) continue
      const cost = best[s]! + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (dir !== 4 && dir !== d ? BEND_PENALTY : 0)
      const t = (ni * ny + nj) * 5 + d
      if (cost < best[t]!) { best[t] = cost; parent[t] = s; push(cost + h(ni, nj), t) }
    }
  }
  return null
}

export interface RouteOptions { readonly pad: number }

/**
 * Layer 1 as a parameter: given the plans of the connectors to route, the path of each before obstacle avoidance and label
 * placement. The house elbow is the default; the Excalidraw-backed engine passes its own (bound elbow arrows). Layers 2 and 3 are
 * ours and sit on top of whichever is given.
 */
export type BaseRouter = (plans: readonly Plan[], pad: number) => Map<string, ConnectorPath>

const houseBase: BaseRouter = (plans, pad) => {
  const out = new Map<string, ConnectorPath>()
  for (const plan of plans) out.set(plan.connector.id, pathOf(plan, elbow(plan.a, plan.sa, plan.b, plan.sb, plan.room, pad)))
  return out
}

/** The facing gap along the axis a connector leaves its card by: how much room the two stubs have between them. */
function facingRoom(from: Rect, to: Rect, side: Side): number {
  switch (side) {
    case 'right': return Math.max(0, to.x - rectRight(from))
    case 'left': return Math.max(0, from.x - rectRight(to))
    case 'bottom': return Math.max(0, to.y - rectBottom(from))
    default: return Math.max(0, from.y - rectBottom(to))
  }
}

/** One connector's plan: the cards it joins, the sides it leaves and enters by, and its attachment points. */
export interface Plan {
  readonly connector: SceneConnector
  readonly from: SceneCard
  readonly to: SceneCard
  readonly sa: Side
  readonly sb: Side
  readonly room: number
  a: Pt
  b: Pt
}

/**
 * Sides by relative position, and attachment points: several connectors on one side of one card spread
 * along the edge in the order of their other ends. Depends on every connector, so it is computed for all.
 */
export function planConnectors(scene: SceneSnapshot): Plan[] {
  const ports = new Map<string, { plan: Plan; end: 'a' | 'b'; other: Pt }[]>()
  const ts = new Map<Plan, { ta: number; tb: number }>()
  const plans: Plan[] = []
  for (const connector of scene.connectors) {
    const from = scene.byKey.get(connector.from), to = scene.byKey.get(connector.to)
    if (!from || !to || from === to) continue
    const { sa, sb, room } = chooseSides(from.rect, to.rect)
    const plan: Plan = { connector, from, to, sa, sb, room, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
    plans.push(plan)
    ts.set(plan, { ta: 0.5, tb: 0.5 })
    for (const end of ['a', 'b'] as const) {
      const key = `${(end === 'a' ? from : to).key}\u0000${end === 'a' ? sa : sb}`
      const member = { plan, end, other: rectCenter((end === 'a' ? to : from).rect) }
      const list = ports.get(key)
      if (list) list.push(member); else ports.set(key, [member])
    }
  }
  for (const [key, members] of ports) {
    const side = key.slice(key.indexOf('\u0000') + 1) as Side
    members.sort((p, q) => {
      const d = isHorizontal(side) ? p.other.y - q.other.y : p.other.x - q.other.x
      return d || (p.plan.connector.id < q.plan.connector.id ? -1 : p.plan.connector.id > q.plan.connector.id ? 1 : 0)
    })
    members.forEach((m, i) => { const t = (i + 1) / (members.length + 1); const slot = ts.get(m.plan)!; if (m.end === 'a') slot.ta = t; else slot.tb = t })
  }
  for (const plan of plans) {
    const { ta, tb } = ts.get(plan)!
    plan.a = edgePoint(plan.from.rect, plan.sa, ta)
    plan.b = edgePoint(plan.to.rect, plan.sb, tb)
  }
  return plans
}

/** The geometry of one connector's ends: the stubs that leave the cards, and how to write a point along and across. */
function frame(a: Pt, sa: Side, b: Pt, sb: Side, room: number, pad: number) {
  const stub = Math.max(0, Math.min(pad, room / 2))
  const pa = { x: a.x + NORMAL[sa].x * stub, y: a.y + NORMAL[sa].y * stub }
  const pb = { x: b.x + NORMAL[sb].x * stub, y: b.y + NORMAL[sb].y * stub }
  const horizontal = isHorizontal(sa)
  const at = (u: number, v: number): Pt => (horizontal ? { x: u, y: v } : { x: v, y: u })
  const U = (p: Pt): number => (horizontal ? p.x : p.y)
  const V = (p: Pt): number => (horizontal ? p.y : p.x)
  const make = (middle: Pt[]): Pt[] => simplify([a, pa, ...middle, pb, b])
  return { pa, pb, horizontal, at, U, V, make }
}

/** The elbow between facing sides: one or two bends, a straight line when aligned. It looks at no other card. */
export function elbow(a: Pt, sa: Side, b: Pt, sb: Side, room: number, pad: number): Pt[] {
  const f = frame(a, sa, b, sb, room, pad)
  const mid = (f.U(f.pa) + f.U(f.pb)) / 2
  return f.make([f.at(mid, f.V(f.pa)), f.at(mid, f.V(f.pb))])
}

/** A route between the same ends that crosses no glyph box, or `fallback` when overlapping cards leave none. */
function detour(a: Pt, sa: Side, ga: Rect, b: Pt, sb: Side, gb: Rect, room: number, pad: number, index: GlyphIndex, fallback: Pt[]): Pt[] {
  const f = frame(a, sa, b, sb, room, pad)
  const lane = (v: number): Pt[] => f.make([f.at(f.U(f.pa), v), f.at(f.U(f.pb), v)])
  const tried = new Set<number>()
  const tryLanes = (values: number[]): Pt[] | null => {
    let tries = 0
    for (const v of values) {
      if (tried.has(v)) continue
      tried.add(v)
      const candidate = lane(v)
      if (clear(index, candidate)) return candidate
      if (++tries >= MAX_LANE_TRIES) break
    }
    return null
  }
  const cost = (v: number) => Math.abs(v - f.V(f.pa)) + Math.abs(v - f.V(f.pb))
  const edges = (g: Rect): number[] => (f.horizontal ? [g.y - pad, g.y + g.h + pad] : [g.x - pad, g.x + g.w + pad])
  const byCost = (values: number[]) => [...new Set(values)].sort((p, q) => cost(p) - cost(q))

  // Lanes beside the endpoints' own glyphs first, then beside any glyph in the way.
  const first = tryLanes(byCost([ga, gb].flatMap(edges)))
  if (first) return first
  const second = tryLanes(byCost(index.query(boxOf(a, b)).flatMap(edges)))
  if (second) return second
  const found = searchPath(f.pa, f.pb, index, pad)
  return found ? simplify([a, ...found, b]) : fallback
}

function longestMidpoint(points: readonly Pt[]): Pt {
  let best = 0, bestLen = -1
  for (let i = 0; i + 1 < points.length; i++) {
    const len = Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y)
    if (len > bestLen) { best = i; bestLen = len }
  }
  const a = points[best]!, b = points[best + 1] ?? a
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function pathOf(plan: Plan, points: Pt[]): ConnectorPath {
  return { id: plan.connector.id, points, start: { side: plan.sa, at: points[0]! }, end: { side: plan.sb, at: points[points.length - 1]! },
    labelAnchor: longestMidpoint(points) }
}

/**
 * Layer 1: the elbow of every connector, attached to the edges it names, looking at no card but its own two.
 * This is the shape an engine's own bound-arrow routing gives; the label anchor is the longest segment's midpoint.
 */
export function baseElbows(scene: SceneSnapshot, opts: RouteOptions): Map<string, ConnectorPath> {
  const pad = Math.max(0, opts.pad)
  const out = new Map<string, ConnectorPath>()
  for (const plan of planConnectors(scene)) out.set(plan.connector.id, pathOf(plan, elbow(plan.a, plan.sa, plan.b, plan.sb, plan.room, pad)))
  return out
}

function glyphIndexOf(scene: SceneSnapshot): GlyphIndex {
  return new GlyphIndex(scene.cards.map((c) => c.glyph), Math.max(64, Math.max(scene.cardSize.w, scene.cardSize.h)))
}

/**
 * Layer 2, ours, on top of any router: a connector whose path crosses a glyph box is routed again between the
 * same two ends, round the boxes. Engines route round their own two bound shapes only (Excalidraw's elbows cross
 * a third card in the way), so "no wire crosses a glyph" is this function's guarantee, not the engine's.
 * Paths that are already clear are returned as they are (same objects).
 */
export function avoidObstacles(scene: SceneSnapshot, paths: ReadonlyMap<string, ConnectorPath>, opts: RouteOptions): Map<string, ConnectorPath> {
  return avoidWith(glyphIndexOf(scene), scene, paths, Math.max(0, opts.pad))
}

function avoidWith(index: GlyphIndex, scene: SceneSnapshot, paths: ReadonlyMap<string, ConnectorPath>, pad: number): Map<string, ConnectorPath> {
  const byId = new Map(scene.connectors.map((c) => [c.id, c]))
  const out = new Map<string, ConnectorPath>()
  for (const [id, path] of paths) {
    const connector = byId.get(id)
    const from = connector && scene.byKey.get(connector.from), to = connector && scene.byKey.get(connector.to)
    if (!from || !to || clear(index, path.points)) { out.set(id, path); continue }
    const room = facingRoom(from.rect, to.rect, path.start.side)
    const points = detour(path.start.at, path.start.side, from.glyph, path.end.at, path.end.side, to.glyph, room, pad, index, [...path.points])
    out.set(id, points === path.points ? path : { ...path, points, start: { ...path.start, at: points[0]! }, end: { ...path.end, at: points[points.length - 1]! },
      labelAnchor: longestMidpoint(points) })
  }
  return out
}

/**
 * Layer 3, ours: label anchors that do not pile on each other. Connectors are placed in id order, so the result
 * does not depend on the order they were listed in. With `only`, the others keep their anchors and are
 * respected as already placed; this is what an incremental reroute needs.
 */
export function placeLabels(scene: SceneSnapshot, paths: ReadonlyMap<string, ConnectorPath>, opts: RouteOptions, only?: ReadonlySet<string>): Map<string, ConnectorPath> {
  void opts
  return placeLabelsWith(glyphIndexOf(scene), scene, paths, only)
}

function placeLabelsWith(index: GlyphIndex, scene: SceneSnapshot, paths: ReadonlyMap<string, ConnectorPath>, only?: ReadonlySet<string>): Map<string, ConnectorPath> {
  const labels = new Map(scene.connectors.map((c) => [c.id, c.label]))
  const placed: Rect[] = []
  const out = new Map<string, ConnectorPath>(paths)
  if (only) {
    for (const [id, path] of paths) {
      if (only.has(id)) continue
      const box = labelBox(labels.get(id) ?? '', path.labelAnchor)
      if (box) placed.push(box)
    }
  }
  for (const id of [...paths.keys()].filter((k) => !only || only.has(k)).sort()) {
    const path = paths.get(id)!
    const anchor = placeLabel(path.points, labels.get(id) ?? '', placed, index)
    out.set(id, { ...path, labelAnchor: anchor })
  }
  return out
}

/** Elbows, then obstacle avoidance, then labels: the house route. */
export function routeScene(scene: SceneSnapshot, opts: RouteOptions, base: BaseRouter = houseBase): Map<string, ConnectorPath> {
  if (!scene.connectors.length) return new Map()
  const routed = avoidObstacles(scene, base(planConnectors(scene), Math.max(0, opts.pad)), opts)
  const placed = placeLabels(scene, routed, opts)
  // The map lists connectors in the order the scene does.
  return new Map(scene.connectors.flatMap((c) => (placed.has(c.id) ? [[c.id, placed.get(c.id)!] as const] : [])))
}

/**
 * What moving `moved` changes: the port's `reroute` contract, for the house router.
 *
 * Recomputed: a connector with an endpoint in `moved`; one that touches a card such a connector touches (its attachment point
 * on a shared side shifts); one `previous` lacks; and one whose previous route a card now stands in the way of (a moved card has
 * come to rest on it). Each is routed from the elbow, then round the boxes in its way, exactly as `routeScene` routes it, so its
 * points, start and end equal a full route's. A blocked kept route is therefore not mended where it is: its elbow may well be
 * clear again, and then the elbow is the route. Its label is placed again around the labels of the connectors that were kept,
 * which stay where they were: so a recomputed label need not be where `routeScene` would put it, but it is as good a place.
 *
 * Kept, as the very objects they had in `previous`, so a host can patch only what changed: every other connector; one may still
 * detour round a card that has since gone, which is valid and merely longer than it need be.
 */
export function rerouteScene(scene: SceneSnapshot, moved: ReadonlySet<string>, previous: ReadonlyMap<string, ConnectorPath>, opts: RouteOptions, base: BaseRouter = houseBase): Map<string, ConnectorPath> {
  const pad = Math.max(0, opts.pad)
  const index = glyphIndexOf(scene)
  const direct = scene.connectors.filter((c) => moved.has(c.from) || moved.has(c.to))
  const cards = new Set(direct.flatMap((c) => [c.from, c.to]))
  const recomputed = new Set<string>()
  for (const c of scene.connectors) {
    const kept = previous.get(c.id)
    // A kept route that now crosses a glyph box is routed again from the elbow, as a full route would.
    if (!kept || cards.has(c.from) || cards.has(c.to) || !clear(index, kept.points)) recomputed.add(c.id)
  }
  const fresh = base(planConnectors(scene).filter((plan) => recomputed.has(plan.connector.id)), pad)
  const routed = avoidWith(index, scene, fresh, pad)
  const merged = new Map<string, ConnectorPath>()
  for (const c of scene.connectors) {
    const path = routed.get(c.id) ?? previous.get(c.id)
    if (path) merged.set(c.id, path)
  }
  return placeLabelsWith(index, scene, merged, new Set(routed.keys()))
}

function boxOf(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/**
 * The label region of a route: the points of it where its label may sit, best first. The midpoint of the longest segment; then
 * the midpoints of the others, longest first; then one to four steps (`LABEL_STEP`) either side of each midpoint, the same order.
 * Anything further and the label no longer reads as belonging to the line. A placement is chosen from this list, and the port's
 * `reroute` contract is stated in terms of it.
 */
export function labelCandidates(points: readonly Pt[]): Pt[] {
  const segments = points.slice(1).map((p, i) => ({ a: points[i]!, b: p, len: Math.abs(p.x - points[i]!.x) + Math.abs(p.y - points[i]!.y) }))
  const order = segments.map((_, i) => i).sort((p, q) => segments[q]!.len - segments[p]!.len || p - q)
  const candidates: Pt[] = []
  for (const si of order) {
    const { a, b, len } = segments[si]!
    const at = (s: number): Pt => ({ x: a.x + ((b.x - a.x) * s) / (len || 1), y: a.y + ((b.y - a.y) * s) / (len || 1) })
    candidates.push(at(len / 2))
  }
  for (const si of order) {
    const { a, b, len } = segments[si]!
    const at = (s: number): Pt => ({ x: a.x + ((b.x - a.x) * s) / (len || 1), y: a.y + ((b.y - a.y) * s) / (len || 1) })
    for (let k = 1; k <= 4; k++) for (const sign of [-1, 1]) {
      const s = len / 2 + sign * k * LABEL_STEP
      if (s > 0 && s < len) candidates.push(at(s))
    }
  }
  if (!candidates.length) candidates.push(points[0]!)
  return candidates
}

/** The first candidate that overlaps no placed label and no glyph box; failing that the first that overlaps only a glyph box; failing that the first. */
function placeLabel(points: readonly Pt[], label: string, placed: Rect[], index: GlyphIndex): Pt {
  const candidates = labelCandidates(points)
  const first = candidates[0]!
  const w = labelWidth(label)
  if (w === 0) return first
  const overlapsLabel = (box: Rect) => placed.some((other) => rectsIntersect(box, other))
  let chosen: Pt | null = null
  let fallback: Pt | null = null
  for (const c of candidates) {
    const box = boxAt(w, c)
    if (overlapsLabel(box)) continue
    if (!index.query(box).length) { chosen = c; break }
    fallback ??= c
  }
  const anchor = chosen ?? fallback ?? first
  placed.push(boxAt(w, anchor))
  return anchor
}
