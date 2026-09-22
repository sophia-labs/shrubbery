/**
 * mn-wire-radial-overlay - Garden's hover fan of wire connections, shell-neutral.
 *
 * Garden navigated, fetched block context, and built pinned-wire payloads inside
 * this component. Shrubbery keeps those as shell intents over controlled data.
 */

import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

const NODE_W = 248
const NODE_H = 80

export interface MnWireRadialWire {
  readonly id: string
  readonly predicate?: string
  readonly predicateLabel: string
  readonly otherDocumentId: string
  readonly otherGraphId: string
  readonly otherBlockId?: string
  readonly localBlockId?: string
  readonly otherTitle?: string
  readonly otherSnippet?: string
  readonly localSnippet?: string
  readonly bidirectional: boolean
}

export interface MnWireRadialSuggestion {
  readonly docId: string
  readonly blockId: string | null
  readonly title: string
  readonly snippet: string
}

export interface MnWireRadialContextBlock {
  readonly id: string
  readonly type?: string
  readonly level?: number | null
  readonly text: string
  readonly isTarget?: boolean
}

export interface MnWireRadialContextData {
  readonly mode?: string
  readonly title?: string | null
  readonly blocks: readonly MnWireRadialContextBlock[]
}

export type MnWireRadialContextState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly data: MnWireRadialContextData }

export type MnWireRadialContextMap =
  | ReadonlyMap<string, MnWireRadialContextState>
  | Readonly<Record<string, MnWireRadialContextState>>

export interface MnWireRadialNavigateDetail {
  readonly wireId: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
}

export interface MnWireRadialSuggestionDetail {
  readonly docId: string
  readonly blockId: string | null
}

export interface MnWireRadialPinDetail {
  readonly id: string
  readonly wireId: string
  readonly graphId: string
  readonly predicate: string
  readonly predicateLabel: string
  readonly bidirectional: boolean
  readonly sourceGraphId: string
  readonly sourceDocumentId: string
  readonly sourceBlockId?: string | null
  readonly sourceTitle: string
  readonly sourceText: string
  readonly targetGraphId: string
  readonly targetDocumentId: string
  readonly targetBlockId?: string | null
  readonly targetTitle: string
  readonly targetText: string
  readonly x: number
  readonly y: number
}

export interface MnWireRadialContextRequestDetail {
  readonly nodeId: string
  readonly wireId?: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
}

interface OverlayNode {
  readonly id: string
  readonly wireId?: string
  readonly title: string
  readonly snippet: string
  readonly predicate?: string
  readonly predicateLabel: string
  readonly isSuggestion: boolean
  readonly isOutgoing: boolean
  readonly bidirectional: boolean
  readonly otherDocumentId: string
  readonly otherGraphId: string
  readonly otherBlockId?: string
  readonly localBlockId?: string
  readonly localSnippet?: string
  readonly cx: number
  readonly cy: number
  readonly left: number
  readonly top: number
  readonly angle: number
}

function contextValue(
  map: MnWireRadialContextMap | null | undefined,
  key: string,
): MnWireRadialContextState | undefined {
  if (!map) return undefined
  if (map instanceof Map) return map.get(key)
  return (map as Readonly<Record<string, MnWireRadialContextState>>)[key]
}

@customElement('mn-wire-radial-overlay')
export class MnWireRadialOverlay extends LitElement {
  private static readonly NS = 'http://www.w3.org/2000/svg'

  static styles = css`
    :host {
      display: contents;
    }

    .root {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-wire-overlay, 800);
      pointer-events: none;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    svg.lines {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    svg.lines line {
      stroke: var(--mn-color-wire-300, #93c5fd);
      stroke-width: 1.5;
      animation: line-fade 700ms ease-out forwards;
      animation-delay: var(--line-delay, 0ms);
    }

    svg.lines line.suggestion {
      stroke: var(--mn-color-warning-border, #f59e0b);
    }

    @keyframes line-fade {
      0% { opacity: 0; }
      25% { opacity: 0.55; }
      100% { opacity: 0; }
    }

    .node {
      position: absolute;
      width: ${NODE_W}px;
      min-height: ${NODE_H}px;
      padding: 8px 10px 28px;
      box-sizing: border-box;
      border: 1px solid var(--mn-color-wire-200, #bfdbfe);
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #1f2937);
      box-shadow: 0 2px 16px rgba(0, 0, 0, 0.13);
      cursor: pointer;
      opacity: 0;
      pointer-events: all;
      transform: scale(0.88) translateX(-6px);
      animation: node-enter 200ms cubic-bezier(0.34, 1.36, 0.64, 1) forwards;
      animation-delay: var(--node-delay, 0ms);
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }

    .node:hover {
      z-index: 10;
      border-color: var(--mn-color-wire-400, #60a5fa);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
    }

    .node.suggestion {
      border: 1.5px dashed var(--mn-color-warning-border, #f59e0b);
    }

    @keyframes node-enter {
      to {
        opacity: 1;
        transform: scale(1) translateX(0);
      }
    }

    .title {
      margin-bottom: 3px;
      overflow: hidden;
      color: var(--mn-color-text-primary, #1f2937);
      font-size: 0.78rem;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .snippet {
      display: -webkit-box;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #6b7280);
      font-size: 0.72rem;
      line-height: 1.4;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .footer {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
    }

    .predicate {
      color: var(--mn-color-wire-500, #2563eb);
      font-size: 0.62rem;
      font-weight: 500;
      letter-spacing: 0.02em;
      text-transform: lowercase;
    }

    .dir {
      color: var(--mn-color-text-primary, #1f2937);
      font-size: 0.62rem;
      font-weight: 700;
      text-transform: lowercase;
    }

    .suggestion-badge {
      color: var(--mn-color-text-warning, #b45309);
      font-size: 0.62rem;
      font-weight: 600;
    }

    .corner {
      position: absolute;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 28px;
      border: 0;
      border-left: 1px solid var(--mn-color-border-default, #d1d5db);
      background: none;
      color: var(--mn-color-text-secondary, #6b7280);
      cursor: pointer;
      pointer-events: all;
      transition: opacity 100ms ease, color 100ms ease, background 100ms ease;
    }

    .pin {
      top: 0;
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
      border-top-right-radius: var(--mn-radius-md, 6px);
      opacity: 0;
    }

    .expand {
      bottom: 0;
      border-top: 1px solid var(--mn-color-border-default, #d1d5db);
      border-bottom-right-radius: var(--mn-radius-md, 6px);
      opacity: 0.65;
    }

    .node:hover .pin {
      opacity: 0.6;
    }

    .corner:hover {
      opacity: 1;
      background: var(--mn-color-wire-50, #eff6ff);
      color: var(--mn-color-wire-600, #1d4ed8);
    }

    .corner svg {
      width: 13px;
      height: 13px;
    }

    .expanded {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--mn-color-border-default, #d1d5db);
    }

    .expanded-mode {
      margin-bottom: 4px;
      color: var(--mn-color-text-secondary, #6b7280);
      font-size: 0.6rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .expanded-block {
      padding: 2px 0;
      color: var(--mn-color-text-secondary, #6b7280);
      font-size: 0.7rem;
      line-height: 1.5;
    }

    .expanded-block.is-target {
      color: var(--mn-color-text-primary, #1f2937);
      font-weight: 600;
    }

    .expanded-loading {
      color: var(--mn-color-text-secondary, #6b7280);
      font-size: 0.7rem;
      font-style: italic;
    }
  `

  @property({ type: Number }) anchorX = 0
  @property({ type: Number }) anchorY = 0
  @property({ attribute: false }) wires: readonly MnWireRadialWire[] = []
  @property({ attribute: false }) outgoingWireIds: ReadonlySet<string> = new Set()
  @property({ attribute: false }) suggestions: readonly MnWireRadialSuggestion[] = []
  @property({ attribute: false }) contexts: MnWireRadialContextMap | null = null
  @property({ type: String }) graphId = ''
  @property({ type: String }) localDocumentId = ''
  @property({ type: String }) localGraphId = ''
  @property({ type: String }) localTitle = ''

  @state() private expandedId: string | null = null

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('wires') || changed.has('suggestions')) {
      const nodes = this.computeNodes()
      if (this.expandedId && !nodes.some(node => node.id === this.expandedId)) {
        this.expandedId = null
      }
    }
  }

  private computeNodes(): readonly OverlayNode[] {
    const items = [
      ...this.wires.map((wire): Omit<OverlayNode, 'cx' | 'cy' | 'left' | 'top' | 'angle'> => ({
        id: `wire-${wire.id}`,
        wireId: wire.id,
        title: wire.otherTitle ?? wire.otherDocumentId,
        snippet: wire.otherSnippet ?? '',
        predicate: wire.predicate,
        predicateLabel: wire.predicateLabel,
        isSuggestion: false,
        isOutgoing: this.outgoingWireIds.has(wire.id),
        bidirectional: wire.bidirectional,
        otherDocumentId: wire.otherDocumentId,
        otherGraphId: wire.otherGraphId,
        otherBlockId: wire.otherBlockId,
        localBlockId: wire.localBlockId,
        localSnippet: wire.localSnippet,
      })),
      ...this.suggestions.map((suggestion): Omit<OverlayNode, 'cx' | 'cy' | 'left' | 'top' | 'angle'> => ({
        id: `suggestion-${suggestion.docId}-${suggestion.blockId ?? 'doc'}`,
        title: suggestion.title,
        snippet: suggestion.snippet,
        predicateLabel: 'suggested',
        isSuggestion: true,
        isOutgoing: true,
        bidirectional: false,
        otherDocumentId: suggestion.docId,
        otherGraphId: this.graphId,
        otherBlockId: suggestion.blockId ?? undefined,
      })),
    ]
    const n = items.length
    if (n === 0) return []

    const useEllipse = n > 4
    const rx = useEllipse ? 240 : n <= 2 ? 170 : 240
    const ry = useEllipse ? 220 + n * 28 : n <= 2 ? 170 : 240
    const spreadDeg = useEllipse ? Math.min(220, n * 22) : Math.min(140, n * 35)
    const vh = globalThis.innerHeight || 768
    const vw = globalThis.innerWidth || 1024
    const spaceAbove = this.anchorY - 8
    const spaceBelow = vh - this.anchorY - 8
    const totalV = spaceAbove + spaceBelow
    const verticalBias = totalV > 0 ? (spaceBelow - spaceAbove) / totalV : 0
    const arcCenter = 180 - verticalBias * Math.min(60, spreadDeg / 2)
    const startDeg = arcCenter - spreadDeg / 2
    const stepDeg = n > 1 ? spreadDeg / (n - 1) : 0

    return items.map((item, index): OverlayNode => {
      const angle = startDeg + index * stepDeg
      const rad = (angle * Math.PI) / 180
      const cx = this.anchorX + rx * Math.cos(rad)
      const cy = this.anchorY + ry * Math.sin(rad)
      const left = Math.max(8, Math.min(vw - NODE_W - 8, cx - NODE_W / 2))
      const top = Math.max(8, Math.min(vh - NODE_H - 8, cy - NODE_H / 2))
      return { ...item, cx, cy, left, top, angle }
    })
  }

  private emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private navigate(node: OverlayNode, event: Event): void {
    event.stopPropagation()
    if (node.isSuggestion) {
      const detail: MnWireRadialSuggestionDetail = {
        docId: node.otherDocumentId,
        blockId: node.otherBlockId ?? null,
      }
      this.emit('wire-suggestion', detail)
      this.emit('mn-wire-radial-suggestion', detail)
      return
    }
    const detail: MnWireRadialNavigateDetail = {
      wireId: node.wireId!,
      graphId: node.otherGraphId,
      documentId: node.otherDocumentId,
      blockId: node.otherBlockId,
    }
    this.emit('mn-wire-radial-navigate', detail)
    this.emit('overlay-navigate', detail)
  }

  private pin(node: OverlayNode, event: Event): void {
    event.stopPropagation()
    if (!node.wireId) return
    const localGraph = this.localGraphId || this.graphId
    const detail: MnWireRadialPinDetail = {
      id: node.id,
      wireId: node.wireId,
      graphId: this.graphId,
      predicate: node.predicate ?? '',
      predicateLabel: node.predicateLabel,
      bidirectional: node.bidirectional,
      sourceGraphId: node.isOutgoing ? localGraph : node.otherGraphId,
      sourceDocumentId: node.isOutgoing ? this.localDocumentId : node.otherDocumentId,
      sourceBlockId: node.isOutgoing ? node.localBlockId ?? null : node.otherBlockId ?? null,
      sourceTitle: node.isOutgoing ? this.localTitle : node.title,
      sourceText: node.isOutgoing ? node.localSnippet ?? '' : node.snippet,
      targetGraphId: node.isOutgoing ? node.otherGraphId : localGraph,
      targetDocumentId: node.isOutgoing ? node.otherDocumentId : this.localDocumentId,
      targetBlockId: node.isOutgoing ? node.otherBlockId ?? null : node.localBlockId ?? null,
      targetTitle: node.isOutgoing ? node.title : this.localTitle,
      targetText: node.isOutgoing ? node.snippet : node.localSnippet ?? '',
      x: node.left,
      y: node.top,
    }
    this.emit('wire-pin-node', detail)
    this.emit('mn-wire-radial-pin', detail)
  }

  private toggleExpand(node: OverlayNode, event: Event): void {
    event.stopPropagation()
    if (this.expandedId === node.id) {
      this.expandedId = null
      return
    }
    this.expandedId = node.id
    const detail: MnWireRadialContextRequestDetail = {
      nodeId: node.id,
      wireId: node.wireId,
      graphId: node.otherGraphId,
      documentId: node.otherDocumentId,
      blockId: node.otherBlockId,
    }
    this.emit('mn-wire-radial-context-request', detail)
  }

  private renderContext(node: OverlayNode): TemplateResult | typeof nothing {
    if (this.expandedId !== node.id) return nothing
    const state = contextValue(this.contexts, node.id) ?? { status: 'loading' as const }
    if (state.status === 'loading') {
      return html`<div class="expanded"><span class="expanded-loading">Loading...</span></div>`
    }
    if (state.status === 'error') {
      return html`<div class="expanded"><span class="expanded-loading">${state.message ?? 'Could not load'}</span></div>`
    }
    const data = state.data
    if (data.blocks.length === 0) {
      return html`<div class="expanded"><span class="expanded-loading">Preview unavailable</span></div>`
    }
    return html`
      <div class="expanded">
        <div class="expanded-mode">${data.mode === 'toc' ? 'contents' : 'text'}</div>
        ${data.blocks.map(block => html`
          <div class=${block.isTarget ? 'expanded-block is-target' : 'expanded-block'}>${block.text}</div>
        `)}
      </div>
    `
  }

  private renderFooter(node: OverlayNode): TemplateResult {
    if (node.isSuggestion) {
      return html`<span class="suggestion-badge">suggested</span>`
    }
    if (node.bidirectional || node.isOutgoing) {
      return html`<span class="dir">here</span><span class="predicate">${node.predicateLabel}</span><span class="dir">there</span>`
    }
    return html`<span class="dir">there</span><span class="predicate">${node.predicateLabel}</span><span class="dir">here</span>`
  }

  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const el = document.createElementNS(MnWireRadialOverlay.NS, tag) as SVGElement
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
    return el
  }

  protected override updated(): void {
    const lineMount = this.renderRoot.querySelector('[data-wire-radial-svg]') as SVGSVGElement | null
    if (!lineMount) return
    lineMount.replaceChildren()
    this.computeNodes().forEach((node, index) => {
      const line = this.svgEl('line', {
        class: node.isSuggestion ? 'suggestion' : '',
        style: `--line-delay:${index * 45}ms;`,
        x1: this.anchorX,
        y1: this.anchorY,
        x2: node.cx,
        y2: node.cy,
      })
      lineMount.appendChild(line)
    })
  }

  private renderNode(node: OverlayNode, index: number): TemplateResult {
    return html`
      <div
        class=${node.isSuggestion ? 'node suggestion' : 'node'}
        style="left:${node.left}px; top:${node.top}px; --node-delay:${index * 45}ms;"
        data-wire-radial-node
        data-node-id=${node.id}
        role="button"
        tabindex="0"
        aria-label=${`${node.title}${node.predicateLabel ? ` - ${node.predicateLabel}` : ''}${node.isSuggestion ? ' suggested' : ''}`}
        @click=${(event: Event) => this.navigate(node, event)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.navigate(node, event)
          }
        }}
      >
        <div class="title">${node.title}</div>
        ${node.snippet || node.isSuggestion
          ? html`<div class="snippet">${node.snippet || 'Suggested connection'}</div>`
          : nothing}
        <div class="footer">${this.renderFooter(node)}</div>
        ${node.isSuggestion
          ? nothing
          : html`
              <button class="corner pin" data-wire-radial-pin @click=${(event: Event) => this.pin(node, event)} aria-label=${`Pin ${node.title}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
              </button>
            `}
        ${this.renderContext(node)}
        <button
          class="corner expand"
          data-wire-radial-expand
          @click=${(event: Event) => this.toggleExpand(node, event)}
          aria-label=${this.expandedId === node.id ? `Collapse context for ${node.title}` : `Expand context for ${node.title}`}
          aria-expanded=${this.expandedId === node.id ? 'true' : 'false'}
        >
          ${this.expandedId === node.id
            ? html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>`
            : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`}
        </button>
      </div>
    `
  }

  override render() {
    const nodes = this.computeNodes()
    if (nodes.length === 0) return nothing
    return html`
      <div
        class="root"
        data-wire-radial-overlay
        role="region"
        aria-label="Wire connections"
        @mouseenter=${() => this.emit('overlay-mouse-enter')}
        @mouseleave=${() => this.emit('overlay-mouse-leave')}
      >
        <svg class="lines" data-wire-radial-svg aria-hidden="true"></svg>
        ${nodes.map((node, index) => this.renderNode(node, index))}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-wire-radial-overlay': MnWireRadialOverlay
  }
}
