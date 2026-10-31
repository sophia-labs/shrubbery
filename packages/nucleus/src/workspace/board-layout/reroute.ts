/**
 * gardend's `reroute` (`whiteboard/scene.rs`, with `exit_point`, `outline_point`, `center_of`), ported line for line:
 * an arrow re-routed from its bound shapes is a straight segment between their outline points, `BIND_GAP` outside
 * each, each aimed at the other shape's centre. An unbound end keeps its absolute position.
 */
import { type BoardElement, type Rect, bindingTarget, boundTextOf, centerOf, isLive, num, pointsOf, rectOf } from './elements.js'

/** gardend's `BIND_GAP`: how far outside a shape a re-routed arrow stops. */
export const BIND_GAP = 5.5

/** Where the ray from `r`'s centre toward `toward` leaves the shape's outline (gardend's `exit_point`). */
export function exitPoint(kind: string, r: Rect, toward: readonly [number, number]): [number, number] {
  const [cx, cy] = centerOf(r)
  const dx = toward[0] - cx
  const dy = toward[1] - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const hw = r.w / 2
  const hh = r.h / 2
  let t: number
  if (kind === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
  else if (kind === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else {
    const tx = dx === 0 ? Infinity : hw / Math.abs(dx)
    const ty = dy === 0 ? Infinity : hh / Math.abs(dy)
    t = Math.min(tx, ty)
  }
  return [cx + dx * t, cy + dy * t]
}

/** The arrow end on `shape`'s outline, `BIND_GAP` outside it, on the centre-to-centre line toward `other` (`outline_point`). */
export function outlinePoint(shape: BoardElement, otherCenter: readonly [number, number]): [number, number] {
  const r = rectOf(shape)
  const [ex, ey] = exitPoint(shape.type, r, otherCenter)
  const [cx, cy] = centerOf(r)
  const dx = ex - cx
  const dy = ey - cy
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return [ex, ey]
  return [ex + (dx / len) * BIND_GAP, ey + (dy / len) * BIND_GAP]
}

function absolutePoint(arrow: BoardElement, index: number): [number, number] {
  const points = pointsOf(arrow)
  const p = points[index] ?? [0, 0]
  return [num(arrow, 'x') + p[0], num(arrow, 'y') + p[1]]
}

/**
 * The fields `reroute` writes for `arrowId` over `byId` (the board as it stands after the layout moved its shapes):
 * the arrow's `x, y, points, width, height, elbowed: false, roundness: null`, and its label's `x, y` at the midpoint.
 * Returns the changed elements (unstamped), or an empty list when the arrow is gone.
 */
export function rerouteArrow(byId: ReadonlyMap<string, BoardElement>, arrowId: string): BoardElement[] {
  const arrow = byId.get(arrowId)
  if (!arrow) return []
  const shape = (key: 'startBinding' | 'endBinding'): BoardElement | null => {
    const id = bindingTarget(arrow, key)
    const el = id === null ? undefined : byId.get(id)
    return isLive(el) ? el : null
  }
  const startShape = shape('startBinding')
  const endShape = shape('endBinding')
  const last = Math.max(0, pointsOf(arrow).length - 1)
  const oldStart = absolutePoint(arrow, 0)
  const oldEnd = absolutePoint(arrow, last)
  const startHint = endShape ? centerOf(rectOf(endShape)) : oldEnd
  const endHint = startShape ? centerOf(rectOf(startShape)) : oldStart
  const start = startShape ? outlinePoint(startShape, startHint) : oldStart
  const end = endShape ? outlinePoint(endShape, endHint) : oldEnd
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const out: BoardElement[] = [{
    ...arrow,
    x: start[0],
    y: start[1],
    points: [[0, 0], [dx, dy]],
    width: Math.abs(dx),
    height: Math.abs(dy),
    elbowed: false,
    roundness: null,
  }]
  const label = boundTextOf(byId, arrow)
  if (label) {
    const mid: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    out.push({ ...label, x: mid[0] - num(label, 'width') / 2, y: mid[1] - num(label, 'height') / 2 })
  }
  return out
}
