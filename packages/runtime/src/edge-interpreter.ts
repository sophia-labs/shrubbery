/**
 * edge-interpreter.ts — the generic reactive reader of `:ux:config` selection
 * edges (semantic edge overlay, slice 1).
 *
 * `installEdgeInterpreter(config, faces, bus)` turns the typed, directed
 * `ConfigEdge` list into live cross-pane behavior: a `drivesSelection` edge makes
 * a source face's select event publish a normalized `SelectedObject` onto the
 * bus; a `reflects` (or `drivesSelection`) edge makes a target face's `reflect()`
 * mirror publishes FROM THAT EDGE'S SOURCE; a `reveals` edge makes a source
 * select imperatively focus a target (block focus / comment scroll) WITHOUT
 * touching the bus. A coupling
 * that today is a hardcoded `currentInspectorSelection = …; rerender()` becomes
 * one triple, read here — the same edge set `mn-relations` renders as a diagram.
 *
 * Lives OUTSIDE `render-workspace.ts` (which is subscription-free by contract):
 * the shell invokes this right after `renderWorkspace(config, …)`, passing
 * `FacePort` adapters that wrap the real plug points. Because it runs on every
 * config reload, the returned disposer MUST run before re-install or subscribers
 * leak — the disposer is idempotent, so a double-dispose is safe.
 *
 * Island-clean: imports only @shrubbery/nucleus types + no runtime deps.
 */

import type { ConfigEdge, NavResource, SelectedObject, SelectionBus, WorkspaceConfig } from '@shrubbery/nucleus'

/**
 * The runtime plug points a face exposes to the interpreter. Every method is
 * optional: which ones a face supplies decides how an edge touching it installs.
 *
 *   - `onSelect`/`normalize` — a Tier-A PUSH source. A standalone select event
 *     already exists, so the interpreter subscribes it and turns each raw detail
 *     into a `SelectedObject`. A Tier-B source omits these and publishes inline.
 *   - `reflect` — a selection SINK. Subscribed once per distinct source→target
 *     route (the dedup below), it mirrors only that source's publications into
 *     the face's model (e.g. the inspector's `currentInspectorSelection`).
 *   - `reveal` — an IMPERATIVE focus, no bus write: block focus / comment scroll.
 *   - `onOpen`/`toResource` — an OPEN source (distinct from a select source): a
 *     separate open event (mn-graph-panel-node-OPEN vs -node-SELECT; the sidebar's
 *     open emitter vs its dropped select) normalized to a `NavResource`.
 *   - `navigate` — a navigatesTo SINK. Opens a `NavResource` as the active
 *     surface (swaps the mounted document). A COMMAND, not a selection: like
 *     `reveal` it bypasses the bus, but where `reveal` focuses WITHIN the open
 *     doc, `navigate` SWAPS which doc is open.
 */
export interface FacePort {
  /** Subscribe to the face's raw select event; returns an unsubscribe. */
  onSelect?(cb: (raw: unknown) => void): () => void
  /** Turn a raw select detail into the shared selection currency (or null). */
  normalize?(raw: unknown): SelectedObject | null
  /** Mirror the published selection into this face's own model. */
  reflect?(sel: SelectedObject | null): void
  /** Imperatively focus this face on an anchor — no layout swap, no bus write. */
  reveal?(anchor: { blockId?: string; commentId?: string }): void
  /** Subscribe to the face's raw OPEN event (distinct from onSelect); unsubscribe. */
  onOpen?(cb: (raw: unknown) => void): () => void
  /** Turn a raw open detail into a navigation resource (or null). */
  toResource?(raw: unknown): NavResource | null
  /** Open a resource as this face's active surface — swaps the mounted doc, no bus write. */
  navigate?(resource: NavResource): void
}

/**
 * Derive a `reveals` anchor from the normalized selection. A block pick focuses
 * its `blockId`; a comment pick scrolls to its `commentId`. Returns null when the
 * selection carries neither, so an unrevealtable pick is a no-op rather than a
 * reveal to nowhere. (`SelectedObject` variants carry an index signature, so the
 * field reads are `unknown` and narrowed by `typeof`.)
 */
function revealAnchorFor(sel: SelectedObject | null): { blockId?: string; commentId?: string } | null {
  if (!sel) return null
  const anchor: { blockId?: string; commentId?: string } = {}
  if (typeof sel.blockId === 'string') anchor.blockId = sel.blockId
  if (typeof sel.commentId === 'string') anchor.commentId = sel.commentId
  return anchor.blockId !== undefined || anchor.commentId !== undefined ? anchor : null
}

/**
 * Install the config's selection edges over the given faces and bus. Three passes:
 *
 *   PASS 1 (routes, DEDUPED — load-bearing): compute distinct source→target
 *   routes for {drivesSelection, reflects}, then subscribe each target to only
 *   that source's bus publications. Duplicate triples collapse, while divergent
 *   routes (A→X, B→Y) stay isolated.
 *
 *   PASS 2 (publishers, DEDUPED): each Tier-A source with at least one valid
 *   `drivesSelection` edge gets ONE `onSelect` subscription, regardless of its
 *   number of targets. It publishes with the source face id. Tier-B sources
 *   publish inline with that same id.
 *
 *   PASS 3 (per edge): `reveals` installs an imperative focus from a Tier-A
 *   source into a target's `reveal`; `navigatesTo` installs an imperative
 *   surface-swap from an OPEN source (has `onOpen`+`toResource`) into a target's
 *   `navigate` — DIRECT, like reveals, because opening a resource is a command,
 *   not selection currency, so it never touches the bus; every other predicate
 *   is already handled or is an unknown no-op.
 *
 * Edges whose `from` or `to` face is not installed are skipped. Returns an
 * idempotent disposer that removes every subscription this call added.
 */
export function installEdgeInterpreter(
  config: WorkspaceConfig,
  faces: Record<string, FacePort>,
  bus: SelectionBus,
): () => void {
  const edges: readonly ConfigEdge[] = config.edges ?? []
  const unsubscribes: Array<() => void> = []

  // PASS 1 — one scoped reflect subscription per DISTINCT source→target route.
  // A nested map avoids lossy string keys and lets duplicate triples collapse
  // without collapsing routes from different sources into a global broadcast.
  const reflectRoutes = new Map<string, Set<string>>()
  const driveSources = new Set<string>()
  for (const edge of edges) {
    if (edge.predicate !== 'drivesSelection' && edge.predicate !== 'reflects') continue

    const from = faces[edge.from]
    const to = faces[edge.to]
    if (!from || !to) continue

    if (edge.predicate === 'drivesSelection') driveSources.add(edge.from)
    if (!to.reflect) continue

    let targets = reflectRoutes.get(edge.from)
    if (!targets) {
      targets = new Set()
      reflectRoutes.set(edge.from, targets)
    }
    targets.add(edge.to)
  }
  for (const [sourceId, targetIds] of reflectRoutes) {
    for (const targetId of targetIds) {
      const target = faces[targetId]
      if (!target?.reflect) continue
      const reflect = target.reflect.bind(target)
      unsubscribes.push(bus.subscribeFrom(sourceId, reflect))
    }
  }

  // PASS 2 — one publisher per source. A single selection is globally observable
  // once and is then delivered only along that source's scoped routes.
  for (const sourceId of driveSources) {
    const source = faces[sourceId]
    if (!source?.onSelect || !source.normalize) continue
    const normalize = source.normalize.bind(source)
    unsubscribes.push(source.onSelect((raw) => {
      bus.publishFrom(sourceId, normalize(raw))
    }))
  }

  // PASS 3 — direct imperative behaviors, one behavior per edge.
  for (const edge of edges) {
    const from = faces[edge.from]
    const to = faces[edge.to]
    // Skip couplings whose endpoints this shell has not wired up.
    if (!from || !to) continue

    switch (edge.predicate) {
      case 'drivesSelection':
      case 'reflects':
        // Scoped route + optional Tier-A publisher were installed above.
        break
      case 'reveals': {
        // Imperative focus, no bus write: on select, normalize to an anchor and
        // reveal it. Requires a Tier-A source and a target that can reveal.
        if (from.onSelect && from.normalize && to.reveal) {
          const normalize = from.normalize.bind(from)
          const reveal = to.reveal.bind(to)
          unsubscribes.push(from.onSelect((raw) => {
            const anchor = revealAnchorFor(normalize(raw))
            if (anchor) reveal(anchor)
          }))
        }
        break
      }
      case 'navigatesTo': {
        // Imperative surface swap, no bus write: on the source's OPEN event
        // (distinct from onSelect), normalize to a NavResource and open it as the
        // target's active surface. Requires an OPEN source and a navigable target.
        // DIRECT/bus-bypassing like reveals — opening is a command, not selection
        // currency — but reads the open event (not select) and swaps the mounted
        // doc (not focus within it).
        if (from.onOpen && from.toResource && to.navigate) {
          const toResource = from.toResource.bind(from)
          const navigate = to.navigate.bind(to)
          unsubscribes.push(from.onOpen((raw) => {
            const resource = toResource(raw)
            if (resource) navigate(resource)
          }))
        }
        break
      }
      default:
        // Unknown predicate — no-op. Never fall through to a default behavior.
        break
    }
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
