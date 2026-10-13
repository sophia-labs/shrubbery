/**
 * Geometry for the Files canvas: points, rectangles, and the camera.
 *
 * Pure TypeScript: no DOM, no React, no Lit, runnable in node. Every coordinate a
 * caller writes down comes through here, so there is one convention.
 *
 *   scene space     the `folder-canvas` space of `FilePlacementRecord`; one unit is one
 *                   CSS pixel at zoom 1; `x, y` of a card is its top-left.
 *   viewport space  pixels relative to the host element's top-left corner.
 *   camera          `{ x, y, zoom }` with `viewport = (scene + {x, y}) * zoom`, which is
 *                   Excalidraw's `scrollX/scrollY/zoom` convention.
 */

export interface Pt { readonly x: number; readonly y: number }
export interface Size { readonly w: number; readonly h: number }
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Camera { readonly x: number; readonly y: number; readonly zoom: number }

/** Zoom is geometric and clamped; `iconSize` is the semantic knob for legibility. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const IDENTITY_CAMERA: Camera = Object.freeze({ x: 0, y: 0, zoom: 1 })

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : 1
}

export function toViewport(camera: Camera, p: Pt): Pt {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom }
}

export function toScene(camera: Camera, p: Pt): Pt {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y }
}

/** Move the content with the pointer: the pointer travelled `dv` viewport pixels. */
export function panByViewport(camera: Camera, dv: Pt): Camera {
  return { x: camera.x + dv.x / camera.zoom, y: camera.y + dv.y / camera.zoom, zoom: camera.zoom }
}

/** Zoom by `factor`, clamped, keeping the scene point under the viewport point `at` where it is. */
export function zoomAbout(camera: Camera, at: Pt, factor: number): Camera {
  return zoomTo(camera, at, camera.zoom * factor)
}

export function zoomTo(camera: Camera, at: Pt, zoom: number): Camera {
  const next = clampZoom(zoom)
  if (next === camera.zoom) return camera
  const under = toScene(camera, at)
  return { x: at.x / next - under.x, y: at.y / next - under.y, zoom: next }
}

/**
 * The camera that shows `bounds` centred in `viewport` with `inset` pixels of room on every side.
 * The zoom is the largest that fits, never above `zoomMax` and never below `ZOOM_MIN`: content
 * too large for the minimum zoom overflows the viewport equally on both sides.
 */
export function fitCamera(bounds: Rect, viewport: Size, inset: number, zoomMax: number): Camera {
  const availW = Math.max(1, viewport.w - 2 * inset)
  const availH = Math.max(1, viewport.h - 2 * inset)
  const fit = Math.min(zoomMax, availW / Math.max(bounds.w, 1), availH / Math.max(bounds.h, 1))
  const zoom = clamp(fit, Math.min(ZOOM_MIN, zoomMax), zoomMax)
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  return { x: viewport.w / (2 * zoom) - cx, y: viewport.h / (2 * zoom) - cy, zoom }
}

/**
 * The smallest pan that brings `rect` (scene space) inside the viewport with `margin` viewport pixels
 * of room. A rect larger than the viewport aligns its top-left corner instead. Zoom is untouched.
 */
export function revealRect(camera: Camera, viewport: Size, rect: Rect, margin: number): Camera {
  const m = margin / camera.zoom
  const left = -camera.x
  const top = -camera.y
  const spanW = viewport.w / camera.zoom
  const spanH = viewport.h / camera.zoom
  const axis = (start: number, size: number, lo: number, span: number): number => {
    if (size > span - 2 * m || start < lo + m) return lo + m - start
    if (start + size > lo + span - m) return lo + span - m - (start + size)
    return 0
  }
  const dx = axis(rect.x, rect.w, left, spanW)
  const dy = axis(rect.y, rect.h, top, spanH)
  return dx === 0 && dy === 0 ? camera : { x: camera.x + dx, y: camera.y + dy, zoom: camera.zoom }
}

export function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function rectRight(r: Rect): number { return r.x + r.w }
export function rectBottom(r: Rect): number { return r.y + r.h }
export function rectCenter(r: Rect): Pt { return { x: r.x + r.w / 2, y: r.y + r.h / 2 } }

/** The smallest rect holding every rect, or null for none. */
export function rectUnion(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    if (r.x < x0) x0 = r.x
    if (r.y < y0) y0 = r.y
    if (r.x + r.w > x1) x1 = r.x + r.w
    if (r.y + r.h > y1) y1 = r.y + r.h
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Overlap of positive area; rects that merely touch do not intersect. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** `inner` lies inside `outer`, edges inclusive. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/** Near edges inclusive, far edges exclusive: adjacent rects never both contain one point. */
export function rectContainsPoint(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h
}

export function inflateRect(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d }
}

export function translateRect(r: Rect, d: Pt): Rect {
  return { x: r.x + d.x, y: r.y + d.y, w: r.w, h: r.h }
}

/** The rect with corners `a` and `b`, whichever way round they are. */
export function rectFromPoints(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

/**
 * Does the segment `a`-`b` pass through the open interior of `r`? A segment that only touches the
 * boundary, or runs along it, does not. Liang-Barsky clip, then a test of the clipped midpoint.
 */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
    return true
  }
  if (!clip(-dx, a.x - r.x) || !clip(dx, r.x + r.w - a.x) || !clip(-dy, a.y - r.y) || !clip(dy, r.y + r.h - a.y)) return false
  if (t1 <= t0) return false
  const tm = (t0 + t1) / 2
  const mx = a.x + dx * tm
  const my = a.y + dy * tm
  return mx > r.x && mx < r.x + r.w && my > r.y && my < r.y + r.h
}

export function roundPt(p: Pt): Pt {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

// ---------------------------------------------------------------------------
// The slot lattice: where cards without a placement record sit.
//
// Slots are cells of a fixed lattice, `columns` wide and unbounded downwards, anchored at
// `(gap, gap)` with pitch `(size.w + gap, size.h + gap)`. A slot is "free" when no card rect
// overlaps it. Reading order is row-major: index = row * columns + column.
// ---------------------------------------------------------------------------

export interface SlotLattice {
  readonly size: Size
  readonly gap: number
  readonly columns: number
}

export function slotRect(lattice: SlotLattice, index: number): Rect {
  const row = Math.floor(index / lattice.columns)
  const col = index - row * lattice.columns
  return {
    x: lattice.gap + col * (lattice.size.w + lattice.gap),
    y: lattice.gap + row * (lattice.size.h + lattice.gap),
    w: lattice.size.w, h: lattice.size.h,
  }
}

/** The reading-order index of the slot whose cell holds `p`; 0 for no point or a point before the lattice. */
export function slotIndexAt(lattice: SlotLattice, p: Pt | null): number {
  if (!p) return 0
  const col = clamp(Math.floor((p.x - lattice.gap) / (lattice.size.w + lattice.gap)), 0, lattice.columns - 1)
  const row = Math.max(0, Math.floor((p.y - lattice.gap) / (lattice.size.h + lattice.gap)))
  return row * lattice.columns + col
}

/** Occupancy of a slot lattice by arbitrary rects, with a constant-time free test. */
export interface SlotOccupancy {
  add(rect: Rect): void
  /** Does any added rect overlap the slot? */
  isTaken(index: number): boolean
  /** The first free slot at or after `from`. */
  firstFree(from: number): number
  /** Does `rect` overlap no added rect? Exact, linear. */
  isRectFree(rect: Rect): boolean
}

export function createSlotOccupancy(lattice: SlotLattice, rects: Iterable<Rect> = []): SlotOccupancy {
  const taken = new Set<number>()
  const added: Rect[] = []
  const px = lattice.size.w + lattice.gap
  const py = lattice.size.h + lattice.gap
  const add = (rect: Rect): void => {
    added.push(rect)
    // Slot cells whose rect the added rect overlaps with positive area.
    const c0 = Math.max(0, Math.floor((rect.x - lattice.gap - lattice.size.w) / px) + 1)
    const c1 = Math.min(lattice.columns - 1, Math.ceil((rect.x + rect.w - lattice.gap) / px) - 1)
    const r0 = Math.max(0, Math.floor((rect.y - lattice.gap - lattice.size.h) / py) + 1)
    const r1 = Math.ceil((rect.y + rect.h - lattice.gap) / py) - 1
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) taken.add(row * lattice.columns + col)
  }
  for (const r of rects) add(r)
  return {
    add,
    isTaken: (index) => taken.has(index),
    firstFree: (from) => { let i = Math.max(0, from); while (taken.has(i)) i++; return i },
    isRectFree: (rect) => !added.some((other) => rectsIntersect(rect, other)),
  }
}

// ---------------------------------------------------------------------------
// The slot lattice beyond its columns: where a card is put so that it can be seen.
//
// The lattice above is as wide as the pane and anchored at the scene's top-left, which is where
// cards without a placement flow. A new card that must appear where a person is looking may need a
// cell the lattice does not have (the pane has been panned a thousand units to the right). So there
// is also the lattice's grid without its column bound: the same pitch and the same phase, the cells of
// any integer column and row. A card put on a cell of that grid lines up with the ones the lattice
// laid out, wherever it is.
// ---------------------------------------------------------------------------

/** The cell of the lattice's grid at any integer column and row (negative ones included). */
export function latticeCell(lattice: SlotLattice, col: number, row: number): Rect {
  return {
    x: lattice.gap + col * (lattice.size.w + lattice.gap),
    y: lattice.gap + row * (lattice.size.h + lattice.gap),
    w: lattice.size.w, h: lattice.size.h,
  }
}

/**
 * How far the view has to pan to show `cell` in full inside `region`: zero when it is already inside. A cell larger than the
 * region lines its top-left corner up with the region's, as `revealRect` does.
 */
export function panToReveal(region: Rect, cell: Rect): number {
  const axis = (start: number, size: number, lo: number, span: number): number =>
    size > span || start < lo ? lo - start : start + size > lo + span ? start + size - (lo + span) : 0
  return Math.hypot(axis(cell.x, cell.w, region.x, region.w), axis(cell.y, cell.h, region.y, region.h))
}

/**
 * The cell of the lattice's grid to put a new card on so that it is seen. The first free cell lying wholly inside `region`, in
 * reading order (rows, then columns). When no cell inside the region is free (the view is full, or smaller than a card), the free
 * cell that needs the smallest pan to be shown (`panToReveal`), the earlier in reading order on a tie; never one above or to the
 * left of both the lattice's first cell and the view's first row and column (a new card does not go above everything, where the
 * lattice never reaches). There is always one, because the grid is unbounded below and to the right. A cell is free when no rect of
 * `taken` overlaps it with positive area.
 */
export function freeCellFor(lattice: SlotLattice, region: Rect, taken: readonly Rect[]): Rect {
  const px = lattice.size.w + lattice.gap
  const py = lattice.size.h + lattice.gap
  const OFFSET = 1 << 21
  const key = (col: number, row: number): number => (row + OFFSET) * (OFFSET * 2) + (col + OFFSET)
  /** The cells that `taken` overlaps, for the cells that touch `around` (a rect that overlaps such a cell is within a cell's size of it). */
  const occupied = (around: Rect): Set<number> => {
    const cells = new Set<number>()
    const reach = inflateRect(around, Math.max(lattice.size.w, lattice.size.h))
    for (const rect of taken) {
      if (!rectsIntersect(rect, reach)) continue
      const c0 = Math.floor((rect.x - lattice.gap - lattice.size.w) / px) + 1, c1 = Math.ceil((rect.x + rect.w - lattice.gap) / px) - 1
      const r0 = Math.floor((rect.y - lattice.gap - lattice.size.h) / py) + 1, r1 = Math.ceil((rect.y + rect.h - lattice.gap) / py) - 1
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) cells.add(key(col, row))
    }
    return cells
  }
  // Cells wholly inside the region, row by row.
  const inside = occupied(region)
  const c0 = Math.ceil((region.x - lattice.gap) / px), c1 = Math.floor((region.x + region.w - lattice.gap - lattice.size.w) / px)
  const r0 = Math.ceil((region.y - lattice.gap) / py), r1 = Math.floor((region.y + region.h - lattice.gap - lattice.size.h) / py)
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (!inside.has(key(col, row))) return latticeCell(lattice, col, row)
  // Nothing inside is free: the cheapest pan. A window that grows until it holds a free cell, then once more to the cost found:
  // a cell further from the region than that cost cannot need a smaller pan.
  const pitch = Math.max(px, py)
  const bestIn = (reach: number): { cell: Rect; pan: number } | null => {
    const around = inflateRect(region, reach)
    const here = occupied(around)
    const cA = Math.max(Math.min(0, c0), Math.floor((around.x - lattice.gap - lattice.size.w) / px)), cB = Math.ceil((around.x + around.w - lattice.gap) / px)
    const rA = Math.max(Math.min(0, r0), Math.floor((around.y - lattice.gap - lattice.size.h) / py)), rB = Math.ceil((around.y + around.h - lattice.gap) / py)
    let best: { cell: Rect; pan: number } | null = null
    // Rows then columns, so the first of equal pans is the earlier in reading order.
    for (let row = rA; row <= rB; row++) for (let col = cA; col <= cB; col++) {
      if (here.has(key(col, row))) continue
      const cell = latticeCell(lattice, col, row)
      if (!rectsIntersect(cell, around)) continue
      const pan = panToReveal(region, cell)
      if (!best || pan < best.pan) best = { cell, pan }
    }
    return best
  }
  let found: { cell: Rect; pan: number } | null = null
  for (let reach = pitch; !found; reach *= 2) found = bestIn(reach)
  return (bestIn(found.pan + pitch) ?? found).cell
}
