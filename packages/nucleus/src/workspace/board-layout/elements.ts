/**
 * Readers over Excalidraw element JSON, the same ones gardend's `whiteboard/scene.rs` uses (`n`, `rect_of`,
 * `bound_ids`, `bound_text`, `is_bound_text`), so both sides see a board the same way.
 */

/** An Excalidraw element as plain JSON. Only `id` and `type` are relied on; every other field is read defensively. */
export type BoardElement = Readonly<Record<string, unknown>> & { readonly id: string; readonly type: string }

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A number field, 0 when absent or not a number (gardend's `n`). */
export function num(el: BoardElement, key: string): number {
  const value = el[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function str(el: BoardElement, key: string): string | null {
  const value = el[key]
  return typeof value === 'string' ? value : null
}

export function isLive(el: BoardElement | undefined): el is BoardElement {
  return !!el && el.isDeleted !== true
}

export function isBoundText(el: BoardElement): boolean {
  const container = el.containerId
  return el.type === 'text' && typeof container === 'string' && container !== ''
}

export function isFrame(el: BoardElement): boolean {
  return el.type === 'frame' || el.type === 'magicframe'
}

export function isLinear(el: BoardElement): boolean {
  return el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw'
}

/** The element's points as numbers, `[]` when it has none. */
export function pointsOf(el: BoardElement): Array<[number, number]> {
  const raw = el.points
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const pair = Array.isArray(p) ? p : []
    const px = typeof pair[0] === 'number' ? pair[0] : 0
    const py = typeof pair[1] === 'number' ? pair[1] : 0
    return [px, py] as [number, number]
  })
}

/** gardend's `rect_of`: arrows, lines and freedraw by `x, y` plus their points' box (the origin included); else the box. */
export function rectOf(el: BoardElement): Rect {
  const x = num(el, 'x')
  const y = num(el, 'y')
  if (isLinear(el) && Array.isArray(el.points)) {
    let minX = 0
    let minY = 0
    let maxX = 0
    let maxY = 0
    for (const [px, py] of pointsOf(el)) {
      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
    return { x: x + minX, y: y + minY, w: maxX - minX, h: maxY - minY }
  }
  return { x, y, w: num(el, 'width'), h: num(el, 'height') }
}

export function centerOf(r: Rect): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2]
}

/** Ids in `boundElements` of the given type (gardend's `bound_ids`). */
export function boundIds(el: BoardElement, kind: string): string[] {
  const list = el.boundElements
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const b = entry as Record<string, unknown>
    if (b.type === kind && typeof b.id === 'string') out.push(b.id)
  }
  return out
}

/** The live bound text of a container, shape or arrow (gardend's `bound_text`). */
export function boundTextOf(byId: ReadonlyMap<string, BoardElement>, el: BoardElement): BoardElement | null {
  for (const id of boundIds(el, 'text')) {
    const text = byId.get(id)
    if (isLive(text)) return text
  }
  return null
}

/** The `elementId` of an arrow's `startBinding` or `endBinding`, or null. */
export function bindingTarget(el: BoardElement, key: 'startBinding' | 'endBinding'): string | null {
  const binding = el[key]
  if (!binding || typeof binding !== 'object') return null
  const id = (binding as Record<string, unknown>).elementId
  return typeof id === 'string' && id !== '' ? id : null
}

/** The outermost group an element belongs to: the last entry of `groupIds` (Excalidraw orders innermost first). */
export function outermostGroup(el: BoardElement): string | null {
  const groups = el.groupIds
  if (!Array.isArray(groups) || groups.length === 0) return null
  const last = groups[groups.length - 1]
  return typeof last === 'string' && last !== '' ? last : null
}

/** Rust's `f64::round`: halves away from zero (JavaScript's `Math.round` rounds them up). Sorting keys must agree. */
export function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}
