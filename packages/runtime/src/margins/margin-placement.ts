/**
 * margin-placement.ts — the PURE geometry of document margins: an authored
 * center (the document sheet) with margin columns whose entries sit beside the
 * block they concern (plans/2026-09-23-tabula-scientific-writing-design.md §0).
 *
 * Inputs are measurements (the sheet's block y-offsets, each entry's height,
 * the pane width); outputs are coordinates. No DOM, no stores: the margins
 * element measures, calls these, and applies.
 *
 * Rule (the margin-note rule): an entry wants the y of its earliest anchor; in
 * each column entries are ordered by that desired y and pushed down just enough
 * not to overlap the previous one. An entry never moves ABOVE its anchor, so a
 * reader's eye always travels down or across to find a note, never back up.
 */

export type MarginColumn = 'inner' | 'outer' | 'apparatus'

export const MARGIN_COLUMNS: readonly MarginColumn[] = ['inner', 'outer', 'apparatus']

export interface MarginBoxInput {
  readonly id: string
  readonly column: MarginColumn
  /** Sheet block ids this entry concerns; the earliest measured one wins. */
  readonly anchorBlockIds: readonly string[]
  readonly height: number
}

export interface MarginPlacementInput {
  /** Sheet box, in the same coordinates the output uses. */
  readonly center: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Measured y-offset of each sheet block, relative to the sheet's top. */
  readonly anchors: ReadonlyMap<string, { readonly top: number; readonly height: number }>
  readonly entries: readonly MarginBoxInput[]
  readonly columnWidth: Readonly<Record<MarginColumn, number>>
  /** Horizontal gutter between the sheet and each margin (and between margins). */
  readonly gutter: number
  /** Vertical gap between consecutive entries of one column. */
  readonly gap: number
}

export interface PlacedMarginBox {
  readonly id: string
  readonly column: MarginColumn
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** The anchor the entry was placed against, or null when none was measured (entry parked at the column foot). */
  readonly anchorBlockId: string | null
  /** How far the entry was pushed below its anchor to avoid a collision (0 = beside it). */
  readonly displacement: number
}

export interface MarginEdge {
  readonly entryId: string
  readonly anchorBlockId: string
  /** Point on the sheet's edge, at the anchor's vertical middle. */
  readonly from: { readonly x: number; readonly y: number }
  /** Point on the entry's near edge, at its first line. */
  readonly to: { readonly x: number; readonly y: number }
}

export interface MarginPlacement {
  readonly entries: readonly PlacedMarginBox[]
  readonly edges: readonly MarginEdge[]
  /** Bounding box of sheet + margins. */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

/**
 * Column x-positions. inner sits left of the sheet; outer sits right of it;
 * apparatus is the narrow column outside the outer margin. Order is fixed so a
 * reader learns where each kind of note lives.
 */
function columnX(input: MarginPlacementInput, column: MarginColumn): number {
  const { center, columnWidth, gutter } = input
  switch (column) {
    case 'inner':
      return center.x - gutter - columnWidth.inner
    case 'outer':
      return center.x + center.width + gutter
    case 'apparatus':
      return center.x + center.width + gutter + columnWidth.outer + gutter
  }
}

export function placeMarginBoxes(input: MarginPlacementInput): MarginPlacement {
  const { center, anchors, gap } = input
  const placed: PlacedMarginBox[] = []
  const edges: MarginEdge[] = []
  let maxBottom = center.y + center.height

  for (const column of MARGIN_COLUMNS) {
    const x = columnX(input, column)
    const width = input.columnWidth[column]
    const wanted = input.entries
      .filter(e => e.column === column)
      .map((entry, order) => {
        let anchorBlockId: string | null = null
        let anchorTop = Number.POSITIVE_INFINITY
        for (const id of entry.anchorBlockIds) {
          const a = anchors.get(id)
          if (a && a.top < anchorTop) {
            anchorTop = a.top
            anchorBlockId = id
          }
        }
        return { entry, order, anchorBlockId, desired: anchorBlockId === null ? Number.POSITIVE_INFINITY : center.y + anchorTop }
      })
      // Stable: by desired y, then by input order (unanchored entries last, in input order).
      .sort((a, b) => (a.desired - b.desired) || (a.order - b.order))

    let cursor = center.y
    for (const w of wanted) {
      const desired = Number.isFinite(w.desired) ? w.desired : cursor
      const y = Math.max(desired, cursor)
      const p: PlacedMarginBox = {
        id: w.entry.id, column, x, y, width, height: w.entry.height,
        anchorBlockId: w.anchorBlockId,
        displacement: Number.isFinite(w.desired) ? y - w.desired : 0,
      }
      placed.push(p)
      cursor = y + w.entry.height + gap
      maxBottom = Math.max(maxBottom, y + w.entry.height)
      if (w.anchorBlockId !== null) {
        const a = anchors.get(w.anchorBlockId)!
        const leftOfCenter = column === 'inner'
        edges.push({
          entryId: p.id,
          anchorBlockId: w.anchorBlockId,
          from: { x: leftOfCenter ? center.x : center.x + center.width, y: center.y + a.top + Math.min(a.height, 28) / 2 },
          to: { x: leftOfCenter ? p.x + p.width : p.x, y: p.y + 14 },
        })
      }
    }
  }

  const left = columnX(input, 'inner')
  const right = columnX(input, 'apparatus') + input.columnWidth.apparatus
  return { entries: placed, edges, bounds: { x: left, y: center.y, width: right - left, height: maxBottom - center.y } }
}

// ── how many margins fit ─────────────────────────────────────────────────────

export interface MarginGeometry {
  /** The narrowest sheet still comfortable to read and write in. */
  readonly sheetMin: number
  readonly gutter: number
  /** Breathing room between an outermost column and the pane edge. */
  readonly edge: number
  /** Room kept right of the sheet for per-block markers when every margin is folded. */
  readonly markerGutter: number
  readonly columnWidth: Readonly<Record<MarginColumn, number>>
}

export const MARGIN_GEOMETRY: MarginGeometry = {
  sheetMin: 440,
  gutter: 20,
  edge: 12,
  markerGutter: 30,
  columnWidth: { inner: 220, outer: 240, apparatus: 220 },
}

export interface MarginColumnPlan {
  /** Columns laid out beside the sheet, in reading order. */
  readonly visible: readonly MarginColumn[]
  /** Where each column's entries live: itself, a visible column it folds into, or null = inline disclosure. */
  readonly home: Readonly<Record<MarginColumn, MarginColumn | null>>
  /** Room the sheet must leave on its start (left) and end (right) side. */
  readonly insetStart: number
  readonly insetEnd: number
}

/** Columns are admitted in this order as the pane widens: right margin first, then left, then apparatus. */
const ADMISSION: readonly MarginColumn[] = ['outer', 'inner', 'apparatus']

function insets(columns: ReadonlySet<MarginColumn>, g: MarginGeometry): { start: number; end: number } {
  const side = (c: MarginColumn): number => (columns.has(c) ? g.columnWidth[c] + g.gutter : 0)
  const start = side('inner')
  const end = side('outer') + side('apparatus')
  return { start: start > 0 ? start + g.edge : 0, end: end > 0 ? end + g.edge : 0 }
}

/**
 * The fold: given the pane's width, decide which margins sit beside the sheet
 * and where the rest go. The sheet never shrinks below `sheetMin` to make room
 * for a margin; a column that does not fit folds into the right-hand margin,
 * and when not even that fits every entry folds into inline disclosure behind
 * a marker in a narrow gutter beside its block.
 */
export function planMarginColumns(width: number, g: MarginGeometry = MARGIN_GEOMETRY): MarginColumnPlan {
  const admitted = new Set<MarginColumn>()
  for (const column of ADMISSION) {
    const next = new Set(admitted).add(column)
    const { start, end } = insets(next, g)
    if (g.sheetMin + start + end > width) break
    admitted.add(column)
  }
  const { start, end } = insets(admitted, g)
  const homeOf = (c: MarginColumn): MarginColumn | null =>
    admitted.has(c) ? c : admitted.has('outer') ? 'outer' : null
  return {
    visible: MARGIN_COLUMNS.filter(c => admitted.has(c)),
    home: { inner: homeOf('inner'), outer: homeOf('outer'), apparatus: homeOf('apparatus') },
    insetStart: start,
    insetEnd: admitted.size > 0 ? end : g.markerGutter,
  }
}
