/**
 * mn-wire-radial-overlay - Garden's hover fan of wire connections, shell-neutral.
 *
 * Garden navigated, fetched block context, and built pinned-wire payloads inside
 * this component. Shrubbery keeps those as shell intents over controlled data.
 */

import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

/**
 * The card's RENDERED height, which is not `NODE_H`.
 *
 * `NODE_H` is the CSS `min-height`; a card also carries 8px top padding and
 * 28px bottom padding for its footer, so it occupies ~96px. The layout used to
 * space and clamp against `NODE_H`, which under-counted every card by 16px and
 * let neighbours graze each other at the edges of the frame.
 */
const CARD_H = 96

/**
 * The least vertical distance between neighbouring cards before they stop
 * reading as separate cards. Overlap is fine; coincidence is not.
 */
const MIN_VERTICAL_GAP = 28

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

/**
 * The closest any two cards sit to each other, corner to corner. Overlap is
 * fine and expected; coincidence is the failure.
 */
function closestSeparation(nodes: readonly OverlayNode[]): number {
  let closest = Number.POSITIVE_INFINITY
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i]!.left - nodes[j]!.left
      const dy = nodes[i]!.top - nodes[j]!.top
      closest = Math.min(closest, Math.hypot(dx, dy))
    }
  }
  return nodes.length < 2 ? Number.POSITIVE_INFINITY : closest
}

@customElement('mn-wire-radial-overlay')
export class MnWireRadialOverlay extends LitElement {
  protected readonly _locale = new LocaleController(this)

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

  /**
   * The box the cards are actually positioned inside, in viewport coordinates.
   *
   * WHY THIS IS MEASURED RATHER THAN ASSUMED. `.root` is `position: fixed;
   * inset: 0`, which is the viewport -- until any ancestor carries a
   * `transform`, `filter`, `perspective`, `contain` or `will-change`. Any one of
   * those makes that ancestor the containing block, and `.root` then covers the
   * ANCESTOR, not the window. The layout below used `globalThis.innerWidth/
   * innerHeight` regardless, so in that situation it placed cards for a frame
   * far larger than the one they live in: everything past the real edge clamped
   * to the same 8px corner and stacked into a single unreadable pile, while the
   * connector lines -- drawn from a viewport-coordinate anchor into the same
   * shifted space -- still fanned out to where the cards were supposed to be.
   * Measuring the frame makes the component correct inside ANY containing
   * block, which is the only version of this that stays fixed.
   */
  @state() private frame: { x: number; y: number; width: number; height: number } | null = null

  private measuredFrame(): { x: number; y: number; width: number; height: number } {
    const root = this.renderRoot?.querySelector?.('.root') as HTMLElement | null
    const rect = root?.getBoundingClientRect()
    if (rect && rect.width > 1 && rect.height > 1) {
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    }
    // First render, before `.root` exists. The viewport is the right guess
    // because it is correct whenever nothing has captured the fixed layer.
    return { x: 0, y: 0, width: globalThis.innerWidth || 1024, height: globalThis.innerHeight || 768 }
  }

  private activeFrame(): { x: number; y: number; width: number; height: number } {
    return this.frame ?? this.measuredFrame()
  }

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

    // Everything below works in FRAME-relative coordinates. The anchor arrives
    // in viewport coordinates (both callers read a `getBoundingClientRect`), so
    // it is translated once, here, and never mixed with frame coordinates again.
    const frame = this.activeFrame()
    const vw = frame.width
    const vh = frame.height
    const ax = this.anchorX - frame.x
    const ay = this.anchorY - frame.y

    const minX = 8
    const maxX = Math.max(8, vw - NODE_W - 8)
    const minY = 8
    const maxY = Math.max(8, vh - CARD_H - 8)

    const useEllipse = n > 4
    const rx = useEllipse ? 240 : n <= 2 ? 170 : 240
    const ry = useEllipse ? 220 + n * 28 : n <= 2 ? 170 : 240
    const spreadDeg = useEllipse ? Math.min(220, n * 22) : Math.min(140, n * 35)
    const spaceAbove = ay - 8
    const spaceBelow = vh - ay - 8
    const totalV = spaceAbove + spaceBelow
    const verticalBias = totalV > 0 ? (spaceBelow - spaceAbove) / totalV : 0
    const arcCenter = 180 - verticalBias * Math.min(60, spreadDeg / 2)
    const startDeg = arcCenter - spreadDeg / 2
    const stepDeg = n > 1 ? spreadDeg / (n - 1) : 0

    /**
     * FIT THE WHOLE ARC, THEN PLACE IT. The arc's shape is cloud-1's, verbatim,
     * and stays that way.
     *
     * What changed is what happens when the arc does not fit. Each card used to
     * be clamped into the frame INDIVIDUALLY, and an individual clamp is a
     * projection: every card whose ideal position lay past the same edge landed
     * on that edge, at the same point. At twelve document-level wires -- an
     * ordinary count in `default_x1` -- `ry` is 556px against an anchor ~70px
     * below the top of the frame, so the upper half of the arc fell outside it
     * and four cards collapsed into the corner, two at EXACTLY (8,8). One card
     * visible, a dozen lines fanning out past it.
     *
     * Scaling the arc and then shifting it as a single body is the difference.
     * The fan gets longer and tighter as wires accumulate, cards overlap more
     * as they crowd -- which is intended and is what makes a dense fan feel
     * dense -- but no two of them ever land on the same point, because a
     * uniform scale preserves the angular separation the layout gave them.
     *
     * Only the vertical is fitted. Horizontal clamping is cloud-1's behaviour
     * and is harmless: the fan opens sideways from the anchor, so cards pressed
     * against the left edge still separate along y, and holding the fan on one
     * side is what lets the pointer dismiss it by moving to the other.
     */
    const place = (radiusY: number, shiftY: number): OverlayNode[] =>
      items.map((item, index): OverlayNode => {
        const angle = startDeg + index * stepDeg
        const rad = (angle * Math.PI) / 180
        const cx = ax + rx * Math.cos(rad)
        const cy = ay + radiusY * Math.sin(rad) + shiftY
        const left = Math.max(minX, Math.min(maxX, cx - NODE_W / 2))
        const top = cy - CARD_H / 2
        return { ...item, cx, cy, left, top, angle }
      })

    const ideal = place(ry, 0)
    const room = Math.max(0, maxY - minY)
    const tops = ideal.map(node => node.top)
    const span = Math.max(...tops) - Math.min(...tops)

    // Scale about the anchor so the run of cards fits the room there is.
    const scale = span > room && span > 0 ? room / span : 1
    const scaled = place(ry * scale, 0)

    // Then move the whole body inside the frame -- one shift for every card, so
    // their spacing survives it.
    const scaledTops = scaled.map(node => node.top)
    const lo = Math.min(...scaledTops)
    const hi = Math.max(...scaledTops)
    const shift = lo < minY ? minY - lo : hi > maxY ? maxY - hi : 0
    const nodes = shift === 0 ? scaled : place(ry * scale, shift)

    /**
     * A FLOOR UNDER THE SPACING, for when the fit above squeezes hard.
     *
     * Equal steps in ANGLE are not equal steps in height: near the vertical
     * extremes of the sweep the sine barely changes, so cards bunch there. In a
     * roomy frame that is invisible (twelve wires still leave ~83px between the
     * closest pair, which reads as a crowded fan and is meant to). In a small
     * one it collapses -- measured inside an 811x835 pane, twelve cards closed
     * to 12px apart, which is a pile again by a different route.
     *
     * So when the tightest neighbours fall under a legible gap, heights are
     * redistributed evenly across the room, in the order the arc already put
     * them. The curve is kept -- x still comes from the arc -- and only the
     * bunching is removed. Fans that fit are untouched: this runs only where
     * the alternative is cards on top of each other.
     */
    const byHeight = [...nodes].sort((a, b) => a.top - b.top)
    let tightest = Number.POSITIVE_INFINITY
    for (let index = 1; index < byHeight.length; index += 1) {
      tightest = Math.min(tightest, byHeight[index]!.top - byHeight[index - 1]!.top)
    }
    if (n > 1 && tightest < MIN_VERTICAL_GAP) {
      const step = room / (n - 1)
      const heightFor = new Map(byHeight.map((node, index) => [node.id, minY + index * step]))
      return nodes.map(node => ({ ...node, top: heightFor.get(node.id) ?? node.top }))
    }

    // A final guard against rounding at extreme aspect ratios: `top` is only
    // clamped here, after the fit, where it can no longer collapse the fan.
    return nodes.map(node => ({
      ...node,
      top: Math.max(minY, Math.min(maxY, node.top)),
    }))
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
      return html`<div class="expanded"><span class="expanded-loading">${t('Loading...')}</span></div>`
    }
    if (state.status === 'error') {
      return html`<div class="expanded"><span class="expanded-loading">${state.message ?? t('Could not load')}</span></div>`
    }
    const data = state.data
    if (data.blocks.length === 0) {
      return html`<div class="expanded"><span class="expanded-loading">${t('Preview unavailable')}</span></div>`
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
      return html`<span class="suggestion-badge">${t('suggested')}</span>`
    }
    if (node.bidirectional || node.isOutgoing) {
      return html`<span class="dir">${t('here')}</span><span class="predicate">${node.predicateLabel}</span><span class="dir">${t('there')}</span>`
    }
    return html`<span class="dir">${t('there')}</span><span class="predicate">${node.predicateLabel}</span><span class="dir">${t('here')}</span>`
  }

  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const el = document.createElementNS(MnWireRadialOverlay.NS, tag) as SVGElement
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
    return el
  }

  /**
   * Draw one connector per node, from the anchor to the card the node ACTUALLY
   * OCCUPIES.
   *
   * It used to draw to `node.cx, cy` — the ideal point on the arc, before
   * viewport clamping. Whenever a card was clamped (which is most of them once
   * the anchor sits near an edge, and the document-level bubble sits near two
   * of them), the line ended somewhere the card is not: measured in the running
   * app, a card rendered at 8,8 with its line terminating at 56,39, and another
   * at 8,200 with its line ending at 125,240. Every line pointed into empty
   * space, which is exactly the "the little line doesn't render right" report.
   *
   * `left`/`top` are the clamped, rendered position, so the card's centre is
   * where the line belongs. The cards paint above the SVG, so a line ending at
   * a centre reads as a line touching the card — the tail under it is hidden.
   */
  /**
   * Gated instrument, off unless someone turns it on:
   *
   *     window.__wireFanDebug = true
   *
   * It exists because this fan has been reported broken in the PACKAGED app —
   * "it shows just the first wire and then none of the others render" — and
   * measured correct in the dev page at one, three and six wires, in Chromium
   * and in WebKit, at four viewport sizes. When the app and the harness
   * disagree, the harness is not the app; the console is the only witness in
   * the room where it actually happens. The same gated-logging pattern found
   * the two intermittent drag bugs that reading could not.
   *
   * Logs where every card ACTUALLY landed, which is the question: nodes can all
   * exist and share a position (clamped into a pile, reading as one card), or
   * be laid out fine and be clipped away by a containing ancestor.
   */
  private debugDump(nodes: readonly OverlayNode[]): void {
    if (!(globalThis as { __wireFanDebug?: unknown }).__wireFanDebug) return
    const frame = this.activeFrame()
    console.log('[wire-fan]', {
      anchor: [this.anchorX, this.anchorY],
      viewport: [globalThis.innerWidth, globalThis.innerHeight],
      // If these differ, something upstream captured the fixed layer and the
      // frame -- not the window -- is what the cards are laid out inside.
      frame: [Math.round(frame.x), Math.round(frame.y), Math.round(frame.width), Math.round(frame.height)],
      frameIsViewport: Math.round(frame.width) === globalThis.innerWidth
        && Math.round(frame.height) === globalThis.innerHeight,
      closestSeparation: Number(closestSeparation(nodes).toFixed(1)),
      wires: this.wires.length,
      nodes: nodes.map(node => ({
        title: node.title,
        angle: Math.round(node.angle),
        ideal: [Math.round(node.cx), Math.round(node.cy)],
        placed: [Math.round(node.left), Math.round(node.top)],
        clamped: Math.round(node.left) !== Math.round(node.cx - NODE_W / 2)
          || Math.round(node.top) !== Math.round(node.cy - NODE_H / 2),
      })),
      distinctPositions: new Set(nodes.map(node => `${Math.round(node.left)},${Math.round(node.top)}`)).size,
      renderedInDom: this.renderRoot.querySelectorAll('[data-wire-radial-node]').length,
    })
  }

  protected override updated(): void {
    const lineMount = this.renderRoot.querySelector('[data-wire-radial-svg]') as SVGSVGElement | null
    if (!lineMount) return

    // `.root` only exists once something has rendered, so the FIRST layout runs
    // on the viewport guess. Re-measure now and re-render if the real frame is
    // not the viewport; the second pass is the one that lands. Guarded by an
    // equality check so this settles in one extra render and cannot loop.
    const measured = this.measuredFrame()
    const current = this.frame
    if (
      !current
      || Math.abs(current.x - measured.x) > 0.5
      || Math.abs(current.y - measured.y) > 0.5
      || Math.abs(current.width - measured.width) > 0.5
      || Math.abs(current.height - measured.height) > 0.5
    ) {
      this.frame = measured
      return
    }

    const nodes = this.computeNodes()
    this.debugDump(nodes)
    lineMount.replaceChildren()
    // The anchor is a VIEWPORT point and the SVG's coordinate space is the
    // frame, so the line's origin is translated exactly like the cards were.
    // Before, one end of every line was in viewport coordinates and the other
    // in frame coordinates -- which agreed only while the frame WAS the
    // viewport, and drew lines into empty space the moment it wasn't.
    const originX = this.anchorX - measured.x
    const originY = this.anchorY - measured.y
    nodes.forEach((node, index) => {
      const line = this.svgEl('line', {
        class: node.isSuggestion ? 'suggestion' : '',
        style: `--line-delay:${index * 45}ms;`,
        x1: originX,
        y1: originY,
        x2: node.left + NODE_W / 2,
        y2: node.top + CARD_H / 2,
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
          ? html`<div class="snippet">${node.snippet || t('Suggested connection')}</div>`
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
        aria-label=${t('Wire connections')}
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
