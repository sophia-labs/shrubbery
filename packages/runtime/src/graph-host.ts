/**
 * Persistent Class-C host for the Garden WebGL graph panel.
 *
 * The layout arm emits an empty measured anchor. This host owns the one live
 * <mn-graph-panel> and moves its box with CSS, never re-parenting or replacing
 * the canvas when right-panel order/collapse changes. Domain state remains a
 * controlled GraphPanelOptions value; only WebGL/camera presentation survives.
 */

import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import type {
  GraphPanelEdgeSelectDetail,
  GraphPanelNodeOpenDetail,
  GraphPanelNodeSelectDetail,
  GraphPanelOptions,
  GraphPanelRefreshDetail,
  GraphPanelViewModeChangeDetail,
} from './render-workspace.js'

const GRAPH_HOST_KEY = 'sh-graph-host'
const GRAPH_ANCHOR = '[data-graph-panel-anchor]'

@customElement('sh-graph-host')
export class ShGraphHost extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      z-index: 3;
      display: block;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      pointer-events: auto;
      box-sizing: border-box;
    }

    :host(:not([data-visible])) {
      visibility: hidden;
      pointer-events: none;
    }

    mn-graph-panel {
      display: flex;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }
  `

  @property({ attribute: false }) options: GraphPanelOptions | null = null
  private _visible = false

  private _anchor: HTMLElement | null = null
  private _main: HTMLElement | null = null
  private _observer: ResizeObserver | null = null
  private _layoutObserver: MutationObserver | null = null
  private _raf = 0

  connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.defaultView?.addEventListener('resize', this._scheduleMeasure)
  }

  disconnectedCallback(): void {
    this.ownerDocument.defaultView?.removeEventListener('resize', this._scheduleMeasure)
    if (this._raf) this.ownerDocument.defaultView?.cancelAnimationFrame(this._raf)
    this._raf = 0
    this._observer?.disconnect()
    this._observer = null
    this._layoutObserver?.disconnect()
    this._layoutObserver = null
    this._anchor = null
    this._main = null
    super.disconnectedCallback()
  }

  protected firstUpdated(): void {
    this._measure()
  }

  protected updated(_changed: PropertyValues<this>): void {
    this.toggleAttribute('data-visible', this._visible)
    this._scheduleMeasure()
  }

  private _scheduleMeasure = (): void => {
    if (this._raf) return
    const view = this.ownerDocument.defaultView
    if (!view) return
    this._raf = view.requestAnimationFrame(() => {
      this._raf = 0
      this._measure()
    })
  }

  private _bindGeometry(anchor: HTMLElement | null, main: HTMLElement | null): void {
    if (anchor === this._anchor && main === this._main) return
    this._observer?.disconnect()
    this._layoutObserver?.disconnect()
    this._anchor = anchor
    this._main = main
    if (typeof MutationObserver !== 'undefined' && main) {
      this._layoutObserver = new MutationObserver(this._scheduleMeasure)
      this._layoutObserver.observe(main, { childList: true, subtree: true })
    }
    if (typeof ResizeObserver === 'undefined' || !anchor || !main) return
    this._observer = new ResizeObserver(this._scheduleMeasure)
    this._observer.observe(anchor)
    this._observer.observe(main)
  }

  private _measure(): void {
    const main = this.parentElement?.closest<HTMLElement>('.main') ?? null
    const anchor = main?.querySelector<HTMLElement>(GRAPH_ANCHOR) ?? null
    this._bindGeometry(anchor, main)
    if (!anchor || !main) {
      this._setVisible(false)
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    const visible = anchorRect.width > 1 && anchorRect.height > 1
    this.style.left = `${anchorRect.left - mainRect.left}px`
    this.style.top = `${anchorRect.top - mainRect.top}px`
    this.style.width = `${Math.max(0, anchorRect.width)}px`
    this.style.height = `${Math.max(0, anchorRect.height)}px`
    this._setVisible(visible)
  }

  private _setVisible(visible: boolean): void {
    if (visible === this._visible) return
    this._visible = visible
    this.toggleAttribute('data-visible', visible)
  }

  render(): TemplateResult {
    const graph = this.options
    return html`<mn-graph-panel
      aria-owns="mn-graph-panel-anchor"
      .title=${graph?.title ?? 'Knowledge Space'}
      .subtitle=${graph?.subtitle ?? ''}
      .status=${graph?.status ?? 'ready'}
      .error=${graph?.error ?? ''}
      .nodes=${graph?.nodes ?? []}
      .edges=${graph?.edges ?? []}
      .documentNodes=${graph?.documentNodes ?? []}
      .documentEdges=${graph?.documentEdges ?? []}
      .viewMode=${graph?.viewMode ?? 'workspace'}
      .lockWorkspaceMode=${graph?.lockWorkspaceMode ?? false}
      .selectedNodeId=${graph?.selectedNodeId ?? ''}
      .canNavigateBack=${graph?.canNavigateBack ?? false}
      .canNavigateForward=${graph?.canNavigateForward ?? false}
      @mn-graph-panel-refresh=${(event: Event) =>
        graph?.onRefresh?.((event as CustomEvent<GraphPanelRefreshDetail>).detail)}
      @mn-graph-panel-node-select=${(event: Event) =>
        graph?.onSelectNode?.((event as CustomEvent<GraphPanelNodeSelectDetail>).detail)}
      @mn-graph-panel-node-open=${(event: Event) =>
        graph?.onOpenNode?.((event as CustomEvent<GraphPanelNodeOpenDetail>).detail)}
      @mn-graph-panel-edge-select=${(event: Event) =>
        graph?.onSelectEdge?.((event as CustomEvent<GraphPanelEdgeSelectDetail>).detail)}
      @mn-graph-panel-view-mode-change=${(event: Event) =>
        graph?.onViewModeChange?.((event as CustomEvent<GraphPanelViewModeChangeDetail>).detail)}
      @mn-graph-panel-navigate-back=${() => graph?.onNavigateBack?.()}
      @mn-graph-panel-navigate-forward=${() => graph?.onNavigateForward?.()}
    ></mn-graph-panel>`
  }
}

/** Stable final-slot mount for the one non-relocatable graph panel. */
export function mountGraphHost(options: GraphPanelOptions | null | undefined): unknown {
  return keyed(
    GRAPH_HOST_KEY,
    html`<sh-graph-host .options=${options ?? null}></sh-graph-host>`,
  )
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-graph-host': ShGraphHost
  }
}
