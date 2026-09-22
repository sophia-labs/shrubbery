/**
 * mn-relations — a GENERAL, skin-aware, token-driven RELATIONS view: a list of
 * directed FROM → (predicate) → TO links between named nodes.
 *
 * NOT lifted from a single garden primitive — and deliberately NOT a copy of
 * garden's wf 3D/graph viz (Vera's rule: generalize, don't port the wf shells).
 * It GENERALIZES the recurring "socket-style class-link / edge row" shape that
 * any RELATIONSHIPS / anatomy view needs: a source endpoint, a labeled connector
 * carrying the predicate, and a target endpoint. It carries NO vocabulary — the
 * caller supplies general `MnRelation[]` ({ from, to, predicate, kind?, note? }),
 * so it serves the Emporium pack-detail class→class view AND any future edge
 * list (provenance graphs, wires, capability links) without change.
 *
 * Pure presentation: a flex column of edge rows, each a [from socket] —pred→
 * [to socket]. The connector tints route to the skin ACCENT role token (purple
 * under Emporium, fern under Garden) for FREE; a `kind` discriminates predicate
 * edges (solid) from wire edges (dashed) purely via a structural class. Optional
 * per-edge note. Emits `mn-relation-select` (detail = the edge) when a row is
 * activated, so a host can focus/scroll the linked node. No content is faked — an
 * empty `relations` renders nothing (the host shows its own honest empty state).
 *
 * SKIN-AWARE via the SkinAware mixin: square sockets + uppercase endpoints under
 * Emporium, rounded under Garden. Colors flow through inherited --mn-* tokens —
 * no per-skin color code.
 *
 * Dependencies: lit ONLY. No stores, no wf-model, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

/** One directed relation edge: from → (predicate) → to. */
export interface MnRelation {
  /** The source endpoint label (a node / class name). */
  readonly from: string
  /** The target endpoint label (a node / class name). */
  readonly to: string
  /** The connector label (the linking predicate / wire short-name). */
  readonly predicate: string
  /**
   * The edge provenance — `predicate` (a value/range link, solid connector) or
   * `wire` (a CRDT doc-connection rule, dashed connector). Defaults to predicate.
   */
  readonly kind?: 'predicate' | 'wire'
  /** Optional longer note shown as the row's hover title. */
  readonly note?: string
}

@customElement('mn-relations')
export class MnRelations extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
    }
    .relations {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .edge {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 4px 6px;
      border-radius: var(--mn-radius-control, 4px);
      border: 1px solid transparent;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 11px);
    }
    button.edge {
      cursor: pointer;
      text-align: left;
      background: transparent;
      width: 100%;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    button.edge:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      background: var(--mn-color-surface-raised, transparent);
    }
    button.edge:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 1px;
    }

    /* The from / to endpoint sockets. */
    .socket {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: var(--mn-radius-full, 9999px);
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111);
      font-weight: 600;
      white-space: nowrap;
    }
    .socket.from {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* The connector: an arrow carrying the predicate label. */
    .connector {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mn-color-text-secondary, #374151);
    }
    .line {
      width: 14px;
      height: 0;
      border-top: 1.5px solid var(--mn-color-accent);
    }
    /* wire edges = dashed connector (the CRDT doc-connection look). */
    .edge.wire .line {
      border-top-style: dashed;
    }
    .arrow {
      color: var(--mn-color-accent);
      line-height: 1;
    }
    .pred {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .kind {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── EMPORIUM skin: square sockets + uppercase endpoints (sophia structure) ── */
    :host([data-skin='emporium']) .socket {
      border-radius: var(--mn-radius-surface, 4px);
      text-transform: uppercase;
    }
    :host([data-skin='emporium']) .edge {
      border-radius: var(--mn-radius-surface, 4px);
    }
  `

  /** The relation edges to render. */
  @property({ attribute: false }) relations: MnRelation[] = []
  /** Render each edge as a clickable button that emits `mn-relation-select`. */
  @property({ type: Boolean }) interactive = false

  private _select(rel: MnRelation): void {
    this.dispatchEvent(
      new CustomEvent('mn-relation-select', { detail: rel, bubbles: true, composed: true }),
    )
  }

  /** One edge row: [from] —pred→ [to], with an optional kind tag + note title. */
  private renderEdge(rel: MnRelation) {
    const kind = rel.kind ?? 'predicate'
    const inner = html`
      <span class="socket from" part="socket-from">${rel.from}</span>
      <span class="connector" part="connector">
        <span class="line"></span>
        <span class="pred" part="pred">${rel.predicate}</span>
        <span class="arrow" aria-hidden="true">→</span>
      </span>
      <span class="socket to" part="socket-to">${rel.to}</span>
      <span class="kind" part="kind">${kind}</span>
    `
    const cls = classMap({ edge: true, [kind]: true })
    const title = rel.note
      ? `${rel.from} ${rel.predicate} ${rel.to} — ${rel.note}`
      : `${rel.from} ${rel.predicate} ${rel.to}`
    if (this.interactive) {
      return html`<button
        class=${cls}
        part="edge"
        title=${title}
        @click=${() => this._select(rel)}
      >
        ${inner}
      </button>`
    }
    return html`<div class=${cls} part="edge" title=${title}>${inner}</div>`
  }

  render() {
    if (!this.relations.length) return nothing
    return html`
      <div class="relations" part="relations" role="list">
        ${this.relations.map((rel) => this.renderEdge(rel))}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-relations': MnRelations
  }
}
