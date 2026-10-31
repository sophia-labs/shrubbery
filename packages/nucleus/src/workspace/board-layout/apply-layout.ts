/**
 * ELK result → board (DESIGN.md "ELK result → board"). Pure: returns the elements the layout changes, unstamped;
 * the caller bumps `version`, `versionNonce` and `updated` (Shrubbery) or runs `touch` (gardend).
 *
 * 1. Anchor: the drawing stays where it was (the set's top-left before = ELK's top-level top-left after).
 * 2. Units move: an element to its node, a group by its node's translation, a frame to its compound box; every moved
 *    container's bound text by the container's translation.
 * 3. Edges take ELK's route; an all-right-angle `flow` route makes an elbow arrow. Bindings are written in the pinned
 *    Excalidraw's v2 schema, `{elementId, mode: "orbit", fixedPoint}`, the fixed point where the route meets the shape.
 * 4. Arrows bound to the set that are not edges are re-routed as gardend's `reroute` does.
 */
import type { BoardLayoutPlan, ElkEdgeJson, ElkNodeJson } from './board-graph.js'
import { type BoardElement, type Rect, bindingTarget, boundTextOf, isLinear, isLive, num, rectOf } from './elements.js'
import { exitPoint, rerouteArrow } from './reroute.js'

/** How far from axis-parallel a segment may be and still count as one (px). */
const AXIS_TOLERANCE = 0.01
/** The pinned Excalidraw never stores a fixed-point ratio of exactly 0.5 (`normalizeFixedPoint`, binding.ts:2752). */
const FIXED_POINT_EPSILON = 0.0001

export interface BoardLayoutChange {
  /** Every element the layout changed, by id, with its new fields (unstamped). */
  readonly elements: ReadonlyMap<string, BoardElement>
  readonly nodes: number
  readonly edges: number
  /** The translation applied to ELK's coordinates (the anchor). */
  readonly delta: { readonly x: number; readonly y: number }
}

type Point = { x: number; y: number }

function collectNodes(node: ElkNodeJson, into: Map<string, ElkNodeJson>): void {
  for (const child of node.children ?? []) {
    into.set(child.id, child)
    collectNodes(child, into)
  }
}

function collectEdges(node: ElkNodeJson, into: Map<string, ElkEdgeJson>): void {
  for (const edge of node.edges ?? []) into.set(edge.id, edge)
  for (const child of node.children ?? []) collectEdges(child, into)
}

/** Excalidraw's `normalizeFixedPoint` after our [0, 1] clamp: a ratio within 1e-4 of 0.5 is stored as 0.5001. */
function fixedRatio(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  return Math.abs(clamped - 0.5) < FIXED_POINT_EPSILON ? 0.5001 : clamped
}

function fixedPointOn(r: Rect, p: Point): [number, number] {
  const fx = r.w === 0 ? 0.5 : (p.x - r.x) / r.w
  const fy = r.h === 0 ? 0.5 : (p.y - r.y) / r.h
  return [fixedRatio(fx), fixedRatio(fy)]
}

function axisParallel(route: readonly Point[]): boolean {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    if (Math.abs(a.x - b.x) > AXIS_TOLERANCE && Math.abs(a.y - b.y) > AXIS_TOLERANCE) return false
  }
  return true
}

/** The point halfway along a polyline. */
function midpointAlong(route: readonly Point[]): Point {
  let total = 0
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y)
  let left = total / 2
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!
    const b = route[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len >= left && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len }
    left -= len
  }
  return route[route.length - 1] ?? { x: 0, y: 0 }
}

/**
 * ELK routes an edge to its unit's node. When the arrow is bound to one member of a group, that node is the group's box,
 * and the route may end beside the member rather than on it. Snap that end onto the member's box: a horizontal last
 * segment ends on the near vertical side, its height clamped into the box (the bend before it follows, so the route
 * keeps its right angles; a two-point route gets a Z of two bends at its middle); a vertical one likewise; a slanted
 * one ends where the ray toward its neighbour leaves the box.
 */
function snapEnd(route: Point[], atEnd: boolean, r: Rect, kind: string): void {
  const n = route.length
  const i = atEnd ? n - 1 : 0
  const j = atEnd ? n - 2 : 1
  const p = route[i]!
  const q = route[j]!
  const horizontal = Math.abs(p.y - q.y) <= AXIS_TOLERANCE
  const vertical = Math.abs(p.x - q.x) <= AXIS_TOLERANCE
  if (horizontal === vertical) {
    const [x, y] = exitPoint(kind, r, [q.x, q.y])
    route[i] = { x, y }
    return
  }
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const next: Point = horizontal
    ? { x: q.x <= p.x ? r.x : r.x + r.w, y: clamp(p.y, r.y, r.y + r.h) }
    : { x: clamp(p.x, r.x, r.x + r.w), y: q.y <= p.y ? r.y : r.y + r.h }
  const shifted = horizontal ? next.y !== p.y : next.x !== p.x
  if (shifted && n === 2) {
    // Both points are ends: keep the other one, and turn the straight run into a Z through its middle.
    const mid = horizontal ? (p.x + q.x) / 2 : (p.y + q.y) / 2
    const bends: Point[] = horizontal ? [{ x: mid, y: q.y }, { x: mid, y: next.y }] : [{ x: q.x, y: mid }, { x: next.x, y: mid }]
    if (atEnd) route.splice(1, 0, ...bends)
    else route.splice(1, 0, ...bends.reverse())
    route[atEnd ? route.length - 1 : 0] = next
    return
  }
  if (shifted) route[j] = horizontal ? { x: q.x, y: next.y } : { x: next.x, y: q.y }
  route[i] = next
}

function translated(el: BoardElement, tx: number, ty: number): BoardElement {
  return { ...el, x: num(el, 'x') + tx, y: num(el, 'y') + ty }
}

/**
 * Apply ELK's `result` (the laid-out `plan.graph`) to `elements` (the board as it is now). Elements gone since the plan
 * are skipped; a unit's members that are gone are left out of its move.
 */
export function applyBoardLayout(elements: readonly BoardElement[], plan: BoardLayoutPlan, result: ElkNodeJson): BoardLayoutChange {
  const byId = new Map<string, BoardElement>()
  for (const el of elements) byId.set(el.id, el)
  const nodes = new Map<string, ElkNodeJson>()
  collectNodes(result, nodes)
  const edges = new Map<string, ElkEdgeJson>()
  collectEdges(result, edges)

  // 1. Anchor: (min x, min y) over every unit rect before, minus (min x, min y) over ELK's top-level nodes.
  let beforeX = Infinity
  let beforeY = Infinity
  for (const unit of plan.units.values()) {
    beforeX = Math.min(beforeX, unit.rect.x)
    beforeY = Math.min(beforeY, unit.rect.y)
  }
  let afterX = Infinity
  let afterY = Infinity
  for (const top of result.children ?? []) {
    afterX = Math.min(afterX, top.x ?? 0)
    afterY = Math.min(afterY, top.y ?? 0)
  }
  const dx = Number.isFinite(beforeX) && Number.isFinite(afterX) ? beforeX - afterX : 0
  const dy = Number.isFinite(beforeY) && Number.isFinite(afterY) ? beforeY - afterY : 0

  const changed = new Map<string, BoardElement>()
  const current = (id: string): BoardElement | undefined => changed.get(id) ?? byId.get(id)
  const write = (el: BoardElement): void => { changed.set(el.id, el) }
  const moveWithText = (id: string, next: BoardElement, tx: number, ty: number): void => {
    write(next)
    const text = boundTextOf(byId, byId.get(id)!)
    if (text && (tx !== 0 || ty !== 0)) write(translated(text, tx, ty))
  }

  // 2. Units.
  for (const unit of plan.units.values()) {
    const node = nodes.get(unit.nodeId)
    if (!node) continue
    const nx = (node.x ?? 0) + dx
    const ny = (node.y ?? 0) + dy
    if (unit.kind === 'group') {
      const tx = nx - unit.rect.x
      const ty = ny - unit.rect.y
      for (const member of unit.members) {
        const el = byId.get(member)
        if (!isLive(el)) continue
        moveWithText(member, translated(el, tx, ty), tx, ty)
      }
      continue
    }
    const el = byId.get(unit.members[0]!)
    if (!isLive(el)) continue
    if (unit.kind === 'frame') {
      write({ ...el, x: nx, y: ny, width: node.width ?? num(el, 'width'), height: node.height ?? num(el, 'height') })
      continue
    }
    const before = rectOf(el)
    const tx = nx - before.x
    const ty = ny - before.y
    // A shape's x, y is its box; a line's or a freedraw's is its first point, so it moves by the translation.
    const next = isLinear(el) ? translated(el, tx, ty) : { ...el, x: nx, y: ny }
    moveWithText(el.id, next, tx, ty)
  }

  // 3. Edges: ELK's route, the bindings re-aimed at where the route meets each shape.
  let edgeCount = 0
  const routed = new Set<string>()
  for (const arrowId of plan.edgeArrows) {
    const arrow = byId.get(arrowId)
    const edge = edges.get(arrowId)
    const section = edge?.sections?.[0]
    // An edge ELK gives no route (a grid packs nodes and ignores edges) is re-routed with the others in step 4.
    if (!isLive(arrow) || !edge || !section) continue
    edgeCount++
    routed.add(arrowId)
    const route: Point[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x + dx, y: p.y + dy }))
    for (const [key, atEnd] of [['endBinding', true], ['startBinding', false]] as const) {
      const target = bindingTarget(arrow, key)
      const unit = target === null ? undefined : plan.units.get(plan.unitOfElement.get(target) ?? '')
      const shape = target === null ? undefined : current(target)
      if (unit?.kind === 'group' && isLive(shape) && route.length >= 2) snapEnd(route, atEnd, rectOf(shape), shape.type)
    }
    const origin = route[0]!
    const points = route.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number])
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const elbow = plan.options.style === 'flow' && route.length >= 3 && axisParallel(route)
    const binding = (key: 'startBinding' | 'endBinding', at: Point): Record<string, unknown> | null => {
      const target = bindingTarget(arrow, key)
      const shape = target === null ? undefined : current(target)
      if (target === null || !isLive(shape)) return (arrow[key] as Record<string, unknown> | null) ?? null
      return { elementId: target, mode: 'orbit', fixedPoint: fixedPointOn(rectOf(shape), at) }
    }
    const next: Record<string, unknown> = {
      ...arrow,
      x: origin.x,
      y: origin.y,
      points,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      roundness: null,
      startBinding: binding('startBinding', route[0]!),
      endBinding: binding('endBinding', route[route.length - 1]!),
      elbowed: elbow,
    }
    if (elbow) Object.assign(next, { fixedSegments: [], startIsSpecial: false, endIsSpecial: false })
    write(next as BoardElement)
    const label = boundTextOf(byId, arrow)
    if (label) {
      const box = edge.labels?.find((l) => l.id === label.id) ?? edge.labels?.[0]
      const center = box && typeof box.x === 'number' && typeof box.y === 'number'
        ? { x: box.x + (box.width ?? 0) / 2 + dx, y: box.y + (box.height ?? 0) / 2 + dy }
        : midpointAlong(route)
      write({ ...label, x: center.x - num(label, 'width') / 2, y: center.y - num(label, 'height') / 2 })
    }
  }

  // 4. Arrows bound to a moved shape that are not edges: re-routed straight, over the board as it now stands.
  const edgeSet = routed
  const moved = new Set(plan.unitOfElement.keys())
  const after = new Map(byId)
  for (const [id, el] of changed) after.set(id, el)
  for (const el of elements) {
    if (!isLive(el) || el.type !== 'arrow' || edgeSet.has(el.id)) continue
    const start = bindingTarget(el, 'startBinding')
    const end = bindingTarget(el, 'endBinding')
    if (!(start !== null && moved.has(start)) && !(end !== null && moved.has(end))) continue
    for (const out of rerouteArrow(after, el.id)) { write(out); after.set(out.id, out) }
  }

  // Only what actually changed is written: an element that ends where it was costs its peers nothing.
  for (const [id, el] of [...changed]) if (JSON.stringify(el) === JSON.stringify(byId.get(id))) changed.delete(id)
  return { elements: changed, nodes: plan.nodeCount, edges: edgeCount, delta: { x: dx, y: dy } }
}
