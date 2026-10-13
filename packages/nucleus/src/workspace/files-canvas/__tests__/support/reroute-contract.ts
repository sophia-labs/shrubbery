/**
 * The port's `reroute` contract, as an oracle over one move. It is engine-independent: it is handed what an engine answered
 * (`next`), what the engine answered for the scene before (`before`), and what a full `route` of the scene after answers (`full`),
 * and lists every way `next` breaks the contract. The engine suite runs it over random moves, and the house tests run it over
 * answers they have corrupted, to show it can fail.
 *
 *   - A connector a moved card touches (an endpoint, or a card that such a connector touches) or has newly blocked (the route in
 *     `before` now crosses the moved card's glyph) is recomputed: its `points`, `start` and `end` are what `route` gives it.
 *   - A recomputed connector's label anchor need not be where `route` puts it (a kept label stays pinned, so a recomputed label is
 *     placed around it), but it is a valid placement: a point of the route's label region (`labelCandidates`), as free as any
 *     point of that region is of card glyphs and of the labels placed before it (the kept ones, then the recomputed ones in id order).
 *   - Every connector that is not recomputed keeps the very object it had.
 */
import type { ConnectorPath, SceneSnapshot } from '../../engine-port.js'
import { rectsIntersect, segmentHitsRect, type Pt, type Rect } from '../../geometry.js'
import { labelBox, labelCandidates } from '../../engine-route.js'

export function crossesGlyph(points: readonly Pt[], glyph: Rect): boolean {
  for (let i = 1; i < points.length; i++) if (segmentHitsRect(points[i - 1]!, points[i]!, glyph)) return true
  return false
}

/** The connectors a move must recompute, by the contract's words: touched by a moved card, or newly blocked by one. */
export function mustRecompute(after: SceneSnapshot, moved: ReadonlySet<string>, before: ReadonlyMap<string, ConnectorPath>): { touched: Set<string>; blocked: Set<string> } {
  const direct = after.connectors.filter((c) => moved.has(c.from) || moved.has(c.to))
  const reach = new Set(direct.flatMap((c) => [c.from, c.to]))
  const touched = new Set<string>(), blocked = new Set<string>()
  const glyphs = [...moved].flatMap((key) => after.byKey.get(key)?.glyph ?? [])
  for (const c of after.connectors) {
    if (reach.has(c.from) || reach.has(c.to)) { touched.add(c.id); continue }
    const was = before.get(c.id)
    if (was && glyphs.some((g) => crossesGlyph(was.points, g))) blocked.add(c.id)
  }
  return { touched, blocked }
}

const geometry = (p: ConnectorPath) => JSON.stringify({ id: p.id, points: p.points, start: p.start, end: p.end })

export function rerouteContractFaults(
  after: SceneSnapshot, moved: ReadonlySet<string>, before: ReadonlyMap<string, ConnectorPath>,
  next: ReadonlyMap<string, ConnectorPath>, full: ReadonlyMap<string, ConnectorPath>,
): string[] {
  const faults: string[] = []
  const { touched, blocked } = mustRecompute(after, moved, before)
  const kept = new Set(after.connectors.filter((c) => next.get(c.id) === before.get(c.id)).map((c) => c.id))
  for (const c of after.connectors) {
    const got = next.get(c.id)
    if (!got) { faults.push(`${c.id}: missing from the result`); continue }
    const must = touched.has(c.id) ? 'touched' : blocked.has(c.id) ? 'blocked' : null
    if (must) {
      if (kept.has(c.id)) faults.push(`${c.id}: ${must} by a move but kept as it was`)
      const want = full.get(c.id)
      if (!want) faults.push(`${c.id}: ${must} by a move, and a full route omits it`)
      else if (geometry(got) !== geometry(want)) faults.push(`${c.id}: ${must} by a move, and its route is not the one a full route gives it`)
    }
    if (kept.has(c.id)) continue
    const at = got.labelAnchor
    const region = labelCandidates(got.points)
    if (!region.some((p) => p.x === at.x && p.y === at.y)) { faults.push(`${c.id}: the label is outside its route's label region`); continue }
    const placedBefore = after.connectors
      .filter((o) => o.id !== c.id && (kept.has(o.id) || o.id < c.id))
      .flatMap((o) => { const other = next.get(o.id); return other ? labelBox(o.label, other.labelAnchor) ?? [] : [] })
    // 0: free; 1: covers a glyph; 2: overlaps a label placed before it.
    const rank = (p: Pt): number => {
      const box = labelBox(c.label, p)
      if (!box) return 0
      if (placedBefore.some((b) => rectsIntersect(box, b))) return 2
      return after.cards.some((card) => rectsIntersect(box, card.glyph)) ? 1 : 0
    }
    const best = Math.min(...region.map(rank))
    if (rank(at) > best) faults.push(`${c.id}: the label sits on ${rank(at) === 2 ? 'another label' : 'a card glyph'} although its route has a better place for it`)
  }
  return faults
}
