/**
 * mn-graph — a GENERAL, skin-aware, token-driven layered DAG / class-graph view.
 *
 * It renders a directed graph of NODES (boxes carrying a label) connected by
 * EDGES (directed links carrying a predicate label), laid out as a LAYERED DAG:
 * nodes are assigned to columns by their longest-path depth from a source, then
 * stacked into rows within each column, and edges are drawn as connectors with an
 * arrowhead. Two edge provenances are discriminated PURELY structurally (no color
 * code): `predicate` edges draw a SOLID connector, `wire` edges a DASHED one — the
 * same predicate-vs-CRDT-wire distinction mn-relations draws as a row, drawn here
 * as a 2-D graph.
 *
 * WHY a new GENERAL component (not a port of garden's wf-anatomy-view):
 * ────────────────────────────────────────────────────────────────────
 * The Emporium pack-detail RELATIONSHIPS section (iter-5a) already lists a pack's
 * class→class edges as ROWS via mn-relations. The natural next face of that SAME
 * read-model is a GRAPH: classes as nodes, predicate-range + CRDT-wire edges
 * between them, laid out as a DAG. Rather than PORT garden's app-specific
 * wf-anatomy / wf 3D viz (which is bound to the wf: pack + garden's scene model),
 * this GENERALIZES the idea into a vocabulary-free component: it carries NO wf:
 * (or any) vocabulary — the caller supplies general `MnGraphNode[]` +
 * `MnGraphEdge[]`. The edge shape is deliberately a SUPERSET-compatible structure
 * of mn-relations' `MnRelation` ({from,to,predicate,kind?,note?}), so a host feeds
 * BOTH views from the ONE relationship read-model (the render package's
 * VocabRelationship[]) with no transform. It therefore serves the Emporium pack
 * class graph AND any future DAG (provenance graphs, wire topologies, capability
 * graphs) without change.
 *
 * Pure presentation: a single <svg> with the layered layout computed in JS
 * (longest-path layering, cycle-safe). Node boxes + edge connectors are authored
 * DIRECTLY in the html template (NOT via Lit's `svg` fragment tag) because
 * happy-dom — this package's test engine — silently DROPS a nested Lit `svg`
 * fragment (the same gotcha mn-sparkline documents); authoring the children in the
 * html template renders + is queryable in BOTH happy-dom and real browsers (the
 * parent <svg> carries the visual namespace). Nothing is faked — an empty graph
 * renders nothing (the host shows its own honest empty state).
 *
 * Emits `mn-graph-node-select` (detail = the node) when a node box is activated,
 * so a host can focus / deep-link the class — the analogue of mn-relations'
 * `mn-relation-select`.
 *
 * SKIN-AWARE via the SkinAware mixin: square node boxes + uppercase labels under
 * Emporium, rounded under Garden. Colors flow through inherited --mn-* role tokens
 * (accent connectors + node frames recolor purple under Emporium, fern under
 * Garden) — NO per-skin color code.
 *
 * Dependencies: lit ONLY. No stores, no wf-model, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

/** One graph node — a box carrying a label, keyed by a stable id. */
export interface MnGraphNode {
  /** Stable node id (the join key edges reference via from/to). */
  readonly id: string
  /** The visible label (defaults to the id when omitted). */
  readonly label?: string
  /** Optional longer note shown as the node's hover title. */
  readonly note?: string
}

/**
 * One directed edge — from → (predicate) → to. Structurally compatible with
 * mn-relations' MnRelation, so the SAME relationship read-model feeds both views.
 */
export interface MnGraphEdge {
  /** The source node id. */
  readonly from: string
  /** The target node id. */
  readonly to: string
  /** The connector label (the linking predicate / wire short-name). */
  readonly predicate: string
  /**
   * The edge provenance — `predicate` (a value/range link, SOLID connector) or
   * `wire` (a CRDT doc-connection rule, DASHED connector). Defaults to predicate.
   */
  readonly kind?: 'predicate' | 'wire'
  /** Optional longer note shown as the edge's hover title. */
  readonly note?: string
}

/**
 * Where a resolved node came from:
 *   - `explicit` — it was in the caller's `nodes` (e.g. a pack CLASS).
 *   - `derived`  — it was discovered as an edge endpoint not in `nodes` (e.g. a
 *     CRDT-wire doc-kind endpoint, which lives in a DIFFERENT node space than the
 *     classes). Drawn so no edge dangles, but tagged so a host/test can tell the
 *     primary node set from the discovered one.
 */
export type MnGraphNodeOrigin = 'explicit' | 'derived'

/** A node placed by the layout: its grid cell (layer column, row) + geometry. */
interface PlacedNode {
  readonly node: MnGraphNode
  readonly origin: MnGraphNodeOrigin
  readonly layer: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** An edge routed by the layout: source/target placed nodes + a routed path. */
interface RoutedEdge {
  readonly edge: MnGraphEdge
  readonly d: string
  readonly labelX: number
  readonly labelY: number
}

// Layout constants (px). Tuned for legible class names; all geometry is derived.
const NODE_W = 132
const NODE_H = 34
const COL_GAP = 96 // horizontal gap between layer columns
const ROW_GAP = 22 // vertical gap between rows within a column
const PAD = 16 // svg padding around the whole graph

@customElement('mn-graph')
export class MnGraph extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
    }
    .graph {
      width: 100%;
      overflow: auto;
    }
    svg {
      display: block;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    /* ── Node boxes ── */
    .node-box {
      fill: var(--mn-color-surface-base, #fff);
      stroke: var(--mn-color-border-accent, var(--mn-color-accent, #6366f1));
      stroke-width: 1.25;
      rx: var(--mn-radius-surface, 6px);
    }
    .node.interactive {
      cursor: pointer;
    }
    .node.interactive:hover .node-box {
      fill: var(--mn-color-surface-accent, #eef2ff);
      stroke-width: 2;
    }
    .node.interactive:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 2px;
    }
    .node-label {
      fill: var(--mn-color-text-accent, var(--mn-color-accent, #4338ca));
      font-size: var(--mn-text-xs, 11px);
      font-weight: 600;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      dominant-baseline: middle;
      text-anchor: middle;
    }
    /* DERIVED nodes (edge endpoints not in the explicit set — e.g. CRDT-wire
       doc-kind endpoints, a different node space than the classes) read muted +
       dashed so the primary node set stays visually distinct. Honest, not faked. */
    .node--derived .node-box {
      stroke: var(--mn-color-border-default, #d1d5db);
      stroke-dasharray: 4 3;
    }
    .node--derived .node-label {
      fill: var(--mn-color-text-muted, #9ca3af);
      font-weight: 500;
    }

    /* ── Edge connectors ── */
    .edge-line {
      fill: none;
      stroke: var(--mn-color-accent, #6366f1);
      stroke-width: 1.5;
    }
    /* wire edges = dashed connector (the CRDT doc-connection look) — structural. */
    .edge.wire .edge-line {
      stroke-dasharray: 5 4;
    }
    .edge-label {
      fill: var(--mn-color-text-secondary, #374151);
      font-size: 9px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      text-anchor: middle;
    }
    .edge-label-bg {
      fill: var(--mn-color-surface-base, #fff);
    }
    .arrow-head {
      fill: var(--mn-color-accent, #6366f1);
    }

    /* ── EMPORIUM skin: square node boxes + uppercase labels (sophia structure) ── */
    :host([data-skin='emporium']) .node-box {
      rx: var(--mn-radius-none, 0);
    }
    :host([data-skin='emporium']) .node-label {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `

  /** The graph nodes. When empty, nodes are derived from the edges' endpoints. */
  @property({ attribute: false }) nodes: MnGraphNode[] = []
  /** The directed edges to render. */
  @property({ attribute: false }) edges: MnGraphEdge[] = []
  /** Render each node as an activatable target that emits `mn-graph-node-select`. */
  @property({ type: Boolean }) interactive = false
  /** Accessible label for the whole figure. */
  @property({ type: String }) hint = ''

  private _selectNode(node: MnGraphNode): void {
    this.dispatchEvent(
      new CustomEvent('mn-graph-node-select', { detail: node, bubbles: true, composed: true }),
    )
  }

  /**
   * Resolve the node set: the explicit `nodes` plus any edge endpoint not already
   * present (so an edge to an unlisted node still draws a real node, never a
   * dangling line). Order is preserved (explicit nodes first, then discovered).
   * Each node carries its `origin` so a host can distinguish the primary node set
   * (explicit — e.g. the pack classes) from discovered endpoints (derived — e.g.
   * CRDT-wire doc-kind endpoints, a different node space).
   */
  private _resolveNodes(): { nodes: MnGraphNode[]; origin: Map<string, MnGraphNodeOrigin> } {
    const byId = new Map<string, MnGraphNode>()
    const origin = new Map<string, MnGraphNodeOrigin>()
    for (const n of this.nodes) {
      if (!byId.has(n.id)) {
        byId.set(n.id, n)
        origin.set(n.id, 'explicit')
      }
    }
    for (const e of this.edges) {
      if (!byId.has(e.from)) {
        byId.set(e.from, { id: e.from })
        origin.set(e.from, 'derived')
      }
      if (!byId.has(e.to)) {
        byId.set(e.to, { id: e.to })
        origin.set(e.to, 'derived')
      }
    }
    return { nodes: [...byId.values()], origin }
  }

  /**
   * LAYERED layout — assign each node a layer (column) by its longest path from a
   * source, cycle-safe. Self-loops and back-edges (to an already-seen node) do not
   * push a layer, so a cyclic graph still lays out deterministically (the back
   * edge simply routes within/across the existing layers). Returns placed nodes
   * keyed by id + the overall canvas size.
   */
  private _layout(
    nodes: MnGraphNode[],
    origin: Map<string, MnGraphNodeOrigin>,
  ): {
    placed: Map<string, PlacedNode>
    width: number
    height: number
  } {
    const ids = nodes.map((n) => n.id)
    const idSet = new Set(ids)
    // Build adjacency (only edges between real nodes; ignore self-loops for depth).
    const out = new Map<string, string[]>()
    const indeg = new Map<string, number>()
    for (const id of ids) {
      out.set(id, [])
      indeg.set(id, 0)
    }
    for (const e of this.edges) {
      if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue
      out.get(e.from)!.push(e.to)
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    }
    // Longest-path layering via Kahn-style relaxation; nodes never visited (in a
    // cycle) default to layer 0 so they still place.
    const layer = new Map<string, number>()
    for (const id of ids) layer.set(id, 0)
    const queue: string[] = ids.filter((id) => (indeg.get(id) ?? 0) === 0)
    const seen = new Set<string>(queue)
    const remaining = new Map(indeg)
    let head = 0
    while (head < queue.length) {
      const id = queue[head++]
      const base = layer.get(id)!
      for (const to of out.get(id)!) {
        if (layer.get(to)! < base + 1) layer.set(to, base + 1)
        remaining.set(to, (remaining.get(to) ?? 0) - 1)
        if ((remaining.get(to) ?? 0) <= 0 && !seen.has(to)) {
          seen.add(to)
          queue.push(to)
        }
      }
    }
    // Any node left unseen (part of a pure cycle) — append in id order at layer 0+.
    for (const id of ids) if (!seen.has(id)) seen.add(id)

    // Group nodes by layer (preserving the input order within a layer).
    const byLayer = new Map<number, string[]>()
    let maxLayer = 0
    for (const id of ids) {
      const l = layer.get(id)!
      maxLayer = Math.max(maxLayer, l)
      if (!byLayer.has(l)) byLayer.set(l, [])
      byLayer.get(l)!.push(id)
    }

    // Place: columns by layer, rows stacked within each column, vertically
    // centered against the tallest column so the figure reads balanced.
    const placed = new Map<string, PlacedNode>()
    let maxRows = 0
    for (let l = 0; l <= maxLayer; l++) maxRows = Math.max(maxRows, (byLayer.get(l) ?? []).length)
    const colHeight = maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP
    for (let l = 0; l <= maxLayer; l++) {
      const col = byLayer.get(l) ?? []
      const thisColH = col.length * NODE_H + Math.max(0, col.length - 1) * ROW_GAP
      const yStart = PAD + (colHeight - thisColH) / 2
      col.forEach((id, row) => {
        const node = nodes.find((n) => n.id === id)!
        placed.set(id, {
          node,
          origin: origin.get(id) ?? 'explicit',
          layer: l,
          row,
          x: PAD + l * (NODE_W + COL_GAP),
          y: yStart + row * (NODE_H + ROW_GAP),
          w: NODE_W,
          h: NODE_H,
        })
      })
    }
    const width = PAD * 2 + (maxLayer + 1) * NODE_W + maxLayer * COL_GAP
    const height = PAD * 2 + colHeight
    return { placed, width, height }
  }

  /** Route an edge between two placed nodes as a smooth horizontal cubic. */
  private _routeEdge(edge: MnGraphEdge, placed: Map<string, PlacedNode>): RoutedEdge | null {
    const a = placed.get(edge.from)
    const b = placed.get(edge.to)
    if (!a || !b) return null
    if (a === b) {
      // Self-loop: a small arc off the right edge of the box.
      const x = a.x + a.w
      const y = a.y + a.h / 2
      const d = `M ${x} ${y - 6} C ${x + 28} ${y - 18}, ${x + 28} ${y + 18}, ${x} ${y + 6}`
      return { edge, d, labelX: x + 26, labelY: y }
    }
    // Anchor on the facing sides (left→right when going forward; otherwise route
    // from the source's right to the target's left still reads as a directed link).
    const forward = b.x >= a.x
    const sx = forward ? a.x + a.w : a.x
    const sy = a.y + a.h / 2
    const tx = forward ? b.x : b.x + b.w
    const ty = b.y + b.h / 2
    const dx = (tx - sx) / 2
    const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
    return { edge, d, labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 }
  }

  // ── Imperative SVG construction ──────────────────────────────────────────────
  // The whole <svg> subtree is built with createElementNS (NOT a Lit `svg`
  // fragment). WHY: happy-dom — this package's test engine — silently DROPS a
  // nested Lit `svg` template fragment AND a dynamic `${array.map()}` interpolated
  // inside an <svg> (the same family of gotcha mn-sparkline documents + the iter-6a
  // adjacent-binding note). createElementNS produces real, namespaced SVG nodes
  // that render + are fully queryable (complex descendant selectors included) in
  // BOTH happy-dom and real browsers — verified. So render() returns only the
  // wrapper, and `updated()` (re)builds the SVG into it. Nothing is faked.

  private static readonly NS = 'http://www.w3.org/2000/svg'

  private _svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const el = document.createElementNS(MnGraph.NS, tag) as SVGElement
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
    return el
  }

  /** Build one node box as a namespaced SVG group (activatable when interactive). */
  private _buildNode(p: PlacedNode): SVGElement {
    const label = p.node.label ?? p.node.id
    const title = p.node.note ? `${label} — ${p.node.note}` : label
    const g = this._svgEl('g', {
      class: `node node--${p.origin}${this.interactive ? ' interactive' : ''}`,
      part: 'node',
      'data-node': p.node.id,
      'data-node-origin': p.origin,
      role: this.interactive ? 'button' : 'group',
      'aria-label': label,
    })
    if (this.interactive) g.setAttribute('tabindex', '0')
    const titleEl = this._svgEl('title', {})
    titleEl.textContent = title
    const rect = this._svgEl('rect', {
      class: 'node-box',
      part: 'node-box',
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      rx: 6,
    })
    const text = this._svgEl('text', {
      class: 'node-label',
      part: 'node-label',
      x: p.x + p.w / 2,
      y: p.y + p.h / 2,
    })
    text.textContent = this._truncate(label)
    g.append(titleEl, rect, text)
    if (this.interactive) {
      g.addEventListener('click', () => this._selectNode(p.node))
      g.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault()
          this._selectNode(p.node)
        }
      })
    }
    return g
  }

  /** Build one routed edge: a connector path + an arrowhead + a label chip. */
  private _buildEdge(r: RoutedEdge, i: number): SVGElement {
    const kind = r.edge.kind ?? 'predicate'
    const title = r.edge.note
      ? `${r.edge.from} ${r.edge.predicate} ${r.edge.to} — ${r.edge.note}`
      : `${r.edge.from} ${r.edge.predicate} ${r.edge.to}`
    const label = this._truncate(r.edge.predicate, 18)
    const labelW = label.length * 5.4 + 6
    const g = this._svgEl('g', {
      class: `edge ${kind}`,
      part: 'edge',
      'data-edge': i,
      'data-edge-kind': kind,
    })
    const titleEl = this._svgEl('title', {})
    titleEl.textContent = title
    const path = this._svgEl('path', {
      class: 'edge-line',
      part: 'edge-line',
      d: r.d,
      'marker-end': 'url(#mn-graph-arrow)',
    })
    const bg = this._svgEl('rect', {
      class: 'edge-label-bg',
      x: r.labelX - labelW / 2,
      y: r.labelY - 7,
      width: labelW,
      height: 12,
      rx: 2,
    })
    const text = this._svgEl('text', {
      class: 'edge-label',
      part: 'edge-label',
      x: r.labelX,
      y: r.labelY + 2,
    })
    text.textContent = label
    g.append(titleEl, path, bg, text)
    return g
  }

  /** Build the arrowhead marker shared by every edge connector. */
  private _buildDefs(): SVGElement {
    const defs = this._svgEl('defs', {})
    const marker = this._svgEl('marker', {
      id: 'mn-graph-arrow',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    })
    marker.appendChild(this._svgEl('path', { class: 'arrow-head', d: 'M 0 0 L 10 5 L 0 10 z' }))
    defs.appendChild(marker)
    return defs
  }

  /** Clamp a label to a sane width for the box / connector. */
  private _truncate(s: string, max = 16): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
  }

  /** (Re)build the SVG subtree imperatively after each Lit render. */
  protected updated(): void {
    const mount = this.renderRoot.querySelector('.graph') as HTMLElement | null
    if (!mount) return
    mount.replaceChildren()
    const { nodes, origin } = this._resolveNodes()
    if (nodes.length === 0) return
    const { placed, width, height } = this._layout(nodes, origin)
    const routed = this.edges
      .map((e) => this._routeEdge(e, placed))
      .filter((r): r is RoutedEdge => r !== null)

    const svg = this._svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      part: 'svg',
      'aria-label': this.hint || 'class graph',
    })
    const titleEl = this._svgEl('title', {})
    titleEl.textContent = this.hint
    svg.append(titleEl, this._buildDefs())
    // Edges first (drawn under the node boxes), then the nodes on top.
    routed.forEach((r, i) => svg.appendChild(this._buildEdge(r, i)))
    placed.forEach((p) => svg.appendChild(this._buildNode(p)))
    mount.appendChild(svg)
  }

  render() {
    // The SVG itself is built imperatively in updated() (see the note above) — Lit
    // only owns the wrapper. An empty graph leaves the wrapper empty (the host
    // shows its own honest empty state).
    if (this._resolveNodes().nodes.length === 0) return nothing
    return html`<div class="graph" part="graph"></div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-graph': MnGraph
  }
}
