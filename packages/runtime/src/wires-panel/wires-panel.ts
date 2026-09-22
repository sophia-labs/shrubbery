import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { WireBundle, WireSummary } from '../editor-services/index.js'
import {
  EMPTY_WIRE_BUNDLE,
  OPEN_DOCUMENT_EVENT,
  type OpenDocumentDetail,
} from '../editor-services/index.js'
import {
  WIRE_DOCUMENT_REQUEST_EVENT,
  WIRE_HIGHLIGHT_BLOCK_EVENT,
  WIRE_PIN_BLOCK_REQUEST_EVENT,
  WIRE_PIN_DOCUMENT_REQUEST_EVENT,
  WIRE_PIN_WIRE_REQUEST_EVENT,
  type DocumentWireRequestDetail,
  type WirePinBlockRequestDetail,
  type WirePinDocumentRequestDetail,
  type WirePinWireRequestDetail,
  type WireHighlightBlockDetail,
} from '../wire-events.js'

export interface WireDeleteRequestDetail {
  readonly wireId: string
}

export const WIRE_CONTEXT_REQUEST_EVENT = 'mn-wire-context-request'
export const WIRE_REFRESH_REQUEST_EVENT = 'mn-wire-refresh-request'
export const WIRE_REFRESH_ALL_REQUEST_EVENT = 'mn-wire-refresh-all-request'
export const WIRE_PANEL_CLOSE_EVENT = 'mn-wire-panel-close'

export type WirePanelStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Host-projected capabilities. The panel never infers write authority from the
 * presence of a wire bundle; omitted members retain the backwards-compatible
 * interactive surface, while an explicit `false` removes the affordance.
 */
export interface WirePanelCapabilities {
  readonly createDocumentWire?: boolean
  readonly open?: boolean
  readonly context?: boolean
  readonly refresh?: boolean
  readonly pin?: boolean
  readonly delete?: boolean
}

export interface WireContextBlock {
  readonly id: string
  readonly type: string
  readonly level: number | null
  readonly text: string
  readonly isTarget: boolean
}

export interface WireContextData {
  readonly mode: string
  readonly title: string | null
  readonly wireTitle?: string | null
  readonly blocks: readonly WireContextBlock[]
}

export type WireContextState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly data: WireContextData }

export type WireContextMap = ReadonlyMap<string, WireContextState> | Readonly<Record<string, WireContextState>>

export interface WireContextRequestDetail {
  readonly wireId: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
  readonly title?: string
}

export interface WireRefreshRequestDetail {
  readonly wireId: string
}

export interface WirePinRequestDetail extends WirePinDocumentRequestDetail {}

type WirePanelIcon = 'add' | 'block' | 'close' | 'layers' | 'link' | 'pin' | 'refresh' | 'trash' | 'wire'

function panelIcon(name: WirePanelIcon): TemplateResult {
  const body = (() => {
    switch (name) {
      case 'add':
        return html`<path d="M12 5v14M5 12h14" />`
      case 'block':
        return html`<rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" />`
      case 'close':
        return html`<path d="m6 6 12 12M18 6 6 18" />`
      case 'layers':
        return html`<path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" />`
      case 'link':
        return html`<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9L10.9 5" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />`
      case 'pin':
        return html`<path d="M5 5h14M8 5v7l-3 5h14l-3-5V5M12 17v5" />`
      case 'refresh':
        return html`<path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />`
      case 'trash':
        return html`<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />`
      case 'wire':
        return html`<circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h3a7 7 0 0 1 7 7v3" />`
    }
  })()
  return html`
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      ${body}
    </svg>
  `
}

@customElement('sh-wires-panel')
export class ShWiresPanel extends LitElement {
  private static readonly WIRE_PREVIEW_LIMIT = 8

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #17202a);
      box-sizing: border-box;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: var(--mn-y-slice-1-height, 44px);
      padding: 0 14px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .header-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }

    .title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 600;
      color: var(--mn-color-text-secondary, #394150);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 550;
      box-sizing: border-box;
    }

    .icon {
      display: block;
      width: 15px;
      height: 15px;
      pointer-events: none;
    }

    .icon-button,
    .action-button,
    .show-more {
      border: 0;
      color: var(--mn-color-text-muted, #697386);
      background: transparent;
      font: inherit;
      cursor: pointer;
    }

    .icon-button,
    .action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: var(--mn-radius-default, 6px);
      flex: 0 0 auto;
    }

    .icon-button:hover,
    .action-button:hover {
      color: var(--mn-color-text-primary, #17202a);
      background: var(--mn-color-surface-active, #e9eef3);
    }

    .icon-button:focus-visible,
    .action-button:focus-visible,
    .show-more:focus-visible {
      outline: 2px solid var(--mn-color-border-accent, #6aa4ff);
      outline-offset: 2px;
    }

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 14px;
      box-sizing: border-box;
    }

    .state {
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 8px;
      min-height: 210px;
      padding: 24px;
      text-align: center;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.45;
      box-sizing: border-box;
    }

    .state-icon {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      margin-bottom: 2px;
      opacity: 0.48;
    }

    .state-icon .icon {
      width: 42px;
      height: 42px;
    }

    .state-title {
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 650;
      color: var(--mn-color-text-secondary, #394150);
    }

    .state-copy {
      max-width: 230px;
    }

    .state.error .state-title,
    .state.error .state-icon {
      color: var(--mn-color-text-danger, #b42318);
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--mn-color-border-subtle, #e6e8eb);
      border-top-color: var(--mn-color-text-muted, #697386);
      border-radius: 50%;
      animation: spin 800ms linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .section + .section {
      margin-top: 16px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .wire-card {
      display: grid;
      border: 1px solid var(--mn-color-border-default, #d0d7de);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-raised, #f6f8fa));
      padding: 10px;
      box-sizing: border-box;
      transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
    }

    .wire-card:hover {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      background: var(--mn-color-surface-hover, #f1f5f9);
    }

    .wire-card.is-openable {
      cursor: pointer;
    }

    .wire-card.is-openable:focus-visible {
      outline: 2px solid var(--mn-color-border-accent, #6aa4ff);
      outline-offset: 2px;
    }

    .wire-endpoint {
      min-width: 0;
    }

    .endpoint-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .flow-label {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .endpoint-title {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mn-color-text-primary, #17202a);
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 600;
    }

    .relation-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      margin: 6px 0;
    }

    .predicate {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-accent, #2557a7);
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .bi {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
    }

    .snippet {
      margin: 5px 0 0;
      padding-left: 8px;
      border-left: 2px solid var(--mn-color-border-default, #d0d7de);
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      font-style: italic;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      quotes: "“" "”" "‘" "’";
    }

    .snippet::before {
      content: open-quote;
    }

    .snippet::after {
      content: close-quote;
    }

    .snippet.local {
      border-left-color: var(--mn-color-border-accent, #6aa4ff);
    }

    .snippet.missing {
      opacity: 0.65;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
      flex: 0 0 auto;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 120ms ease;
    }

    .wire-card:hover .actions,
    .wire-card:focus-within .actions,
    .wire-card[data-expanded] .actions {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .action-button.delete:hover {
      background: var(--mn-color-danger-surface, #fff1f1);
      color: var(--mn-color-text-danger, #b42318);
    }

    .action-button.context.active {
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-accent, #2557a7);
    }

    .context-inline {
      border-top: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      margin: 2px -10px -10px;
      padding: 10px;
      background: var(--mn-color-surface-base, #fff);
      border-radius: 0 0 8px 8px;
    }

    .context-loading,
    .context-empty,
    .context-error {
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.4;
    }

    .context-error {
      color: var(--mn-color-text-danger, #b42318);
    }

    .context-title {
      margin-bottom: 8px;
      color: var(--mn-color-text-primary, #17202a);
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 650;
      line-height: 1.35;
    }

    .context-mode {
      margin-bottom: 4px;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .context-block {
      padding: 5px 8px;
      border-radius: 5px;
    }

    .context-block.is-target {
      border-left: 2px solid var(--mn-color-border-accent, #6aa4ff);
      background: var(--mn-color-surface-accent, #e8f0fe);
    }

    .context-block-type {
      margin-bottom: 2px;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .context-block-text {
      color: var(--mn-color-text-secondary, #394150);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.45;
    }

    .show-more {
      width: 100%;
      margin-top: 8px;
      min-height: 32px;
      border: 1px dashed var(--mn-color-border-default, #d0d7de);
      border-radius: var(--mn-radius-default, 6px);
      color: var(--mn-color-text-muted, #697386);
      background: transparent;
      font-size: var(--mn-text-xs, 0.75rem);
    }

    .show-more:hover {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      color: var(--mn-color-text-accent, #2557a7);
      background: var(--mn-color-surface-accent, #e8f0fe);
    }

    @media (max-width: 768px), (hover: none) {
      .actions {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }

      .icon-button,
      .action-button {
        width: 44px;
        height: 44px;
      }

      .header {
        padding-inline: 10px;
      }

      .body {
        padding: 10px;
      }
    }
  `

  @property({ attribute: false })
  bundle: WireBundle | null = null

  @property({ attribute: false })
  wireContexts: WireContextMap | null = null

  @property({ attribute: false })
  localGraphId: string | null = null

  @property({ attribute: false })
  localDocumentId: string | null = null

  @property({ attribute: false })
  localDocumentTitle: string | null = null

  @property({ attribute: false })
  status: WirePanelStatus = 'ready'

  @property({ attribute: false })
  error: string | null = null

  @property({ attribute: false })
  capabilities: WirePanelCapabilities | null = null

  @property({ type: Boolean, attribute: 'show-close' })
  showClose = false

  @state()
  private showAllOutgoing = false

  @state()
  private showAllIncoming = false

  @state()
  private expandedWireId: string | null = null

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('bundle')) {
      this.showAllOutgoing = false
      this.showAllIncoming = false
      this.expandedWireId = null
    }
  }

  private get safeBundle(): WireBundle {
    return this.bundle ?? EMPTY_WIRE_BUNDLE
  }

  private get outgoingWires(): readonly WireSummary[] {
    return this.safeBundle.outgoingWires
  }

  private get incomingWires(): readonly WireSummary[] {
    return this.safeBundle.incomingWires
  }

  private hasCapability(capability: keyof WirePanelCapabilities): boolean {
    return this.capabilities?.[capability] ?? true
  }

  private closePanel(): void {
    this.dispatchEvent(new CustomEvent(WIRE_PANEL_CLOSE_EVENT, { bubbles: true, composed: true }))
  }

  private openWire(wire: WireSummary): void {
    const detail: OpenDocumentDetail = {
      graphId: wire.otherGraphId,
      documentId: wire.otherDocumentId,
      ...(wire.otherBlockId ? { blockId: wire.otherBlockId } : {}),
    }
    this.dispatchEvent(
      new CustomEvent<OpenDocumentDetail>(OPEN_DOCUMENT_EVENT, {
        bubbles: true,
        composed: true,
        detail,
      }),
    )
  }

  private openWireFromCard(event: Event, wire: WireSummary): void {
    if (!this.hasCapability('open') || event.defaultPrevented) return
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, select, textarea, [role="button"]')) return
    this.openWire(wire)
  }

  private openWireFromKeyboard(event: KeyboardEvent, wire: WireSummary): void {
    if (event.target !== event.currentTarget || !this.hasCapability('open')) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.openWire(wire)
  }

  private runCardAction(event: Event, action: () => void): void {
    event.stopPropagation()
    action()
  }

  private deleteWire(wire: WireSummary): void {
    this.dispatchEvent(
      new CustomEvent<WireDeleteRequestDetail>('mn-wire-delete-request', {
        bubbles: true,
        composed: true,
        detail: { wireId: wire.id },
      }),
    )
  }

  private refreshWire(wire: WireSummary): void {
    this.dispatchEvent(
      new CustomEvent<WireRefreshRequestDetail>(WIRE_REFRESH_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: { wireId: wire.id },
      }),
    )
  }

  private refreshAllWires(): void {
    this.dispatchEvent(
      new CustomEvent(WIRE_REFRESH_ALL_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
      }),
    )
  }

  private pinWireDocument(wire: WireSummary): void {
    this.dispatchEvent(
      new CustomEvent<WirePinDocumentRequestDetail>(WIRE_PIN_DOCUMENT_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          graphId: wire.otherGraphId,
          documentId: wire.otherDocumentId,
          title: wire.otherTitle ?? wire.otherDocumentId,
        },
      }),
    )
  }

  private pinWireBlock(wire: WireSummary): void {
    const blockId = wire.localBlockId?.trim()
    const graphId = this.localGraphId?.trim()
    const documentId = this.localDocumentId?.trim()
    if (!blockId || !graphId || !documentId) return
    this.dispatchEvent(
      new CustomEvent<WirePinBlockRequestDetail>(WIRE_PIN_BLOCK_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          graphId,
          documentId,
          blockId,
          text: wire.localSnippet?.trim() || blockId,
          documentTitle: this.localDocumentTitle?.trim() || documentId,
        },
      }),
    )
  }

  private pinWire(wire: WireSummary, direction: 'outgoing' | 'incoming'): void {
    const localGraphId = this.localGraphId?.trim()
    const localDocumentId = this.localDocumentId?.trim()
    if (!localGraphId || !localDocumentId) return
    const localTitle = this.localDocumentTitle?.trim() || localDocumentId
    const localBlockId = wire.localBlockId ?? null
    const otherBlockId = wire.otherBlockId ?? null
    const localEndpoint = {
      graphId: localGraphId,
      documentId: localDocumentId,
      blockId: localBlockId,
      title: localTitle,
      text: wire.localSnippet?.trim() || '',
    }
    const otherEndpoint = {
      graphId: wire.otherGraphId,
      documentId: wire.otherDocumentId,
      blockId: otherBlockId,
      title: wire.otherTitle ?? wire.otherDocumentId,
      text: wire.otherSnippet?.trim() || '',
    }
    const source = direction === 'outgoing' ? localEndpoint : otherEndpoint
    const target = direction === 'outgoing' ? otherEndpoint : localEndpoint
    this.dispatchEvent(
      new CustomEvent<WirePinWireRequestDetail>(WIRE_PIN_WIRE_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          wireId: wire.id,
          graphId: localGraphId,
          predicate: wire.predicate,
          predicateLabel: wire.predicateLabel,
          bidirectional: wire.bidirectional,
          sourceGraphId: source.graphId,
          sourceDocumentId: source.documentId,
          sourceBlockId: source.blockId,
          sourceTitle: source.title,
          sourceText: source.text,
          targetGraphId: target.graphId,
          targetDocumentId: target.documentId,
          targetBlockId: target.blockId,
          targetTitle: target.title,
          targetText: target.text,
        },
      }),
    )
  }

  private requestDocumentWire(event: MouseEvent): void {
    this.dispatchEvent(
      new CustomEvent<DocumentWireRequestDetail>(WIRE_DOCUMENT_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        },
      }),
    )
  }

  private highlightWire(wire: WireSummary): void {
    this.dispatchHighlight(wire.localBlockId ?? null)
  }

  private clearHighlight(): void {
    this.dispatchHighlight(null)
  }

  private dispatchHighlight(blockId: string | null): void {
    this.dispatchEvent(
      new CustomEvent<WireHighlightBlockDetail>(WIRE_HIGHLIGHT_BLOCK_EVENT, {
        bubbles: true,
        composed: true,
        detail: { blockId },
      }),
    )
  }

  private toggleContext(wire: WireSummary): void {
    if (this.expandedWireId === wire.id) {
      this.expandedWireId = null
      return
    }
    this.expandedWireId = wire.id
    if (this.contextFor(wire.id)?.status === 'ready' || this.contextFor(wire.id)?.status === 'loading') return
    this.dispatchEvent(
      new CustomEvent<WireContextRequestDetail>(WIRE_CONTEXT_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          wireId: wire.id,
          graphId: wire.otherGraphId,
          documentId: wire.otherDocumentId,
          ...(wire.otherBlockId ? { blockId: wire.otherBlockId } : {}),
          ...(wire.otherTitle ? { title: wire.otherTitle } : {}),
        },
      }),
    )
  }

  private contextFor(wireId: string): WireContextState | null {
    const contexts = this.wireContexts
    if (!contexts) return null
    const maybeMap = contexts as ReadonlyMap<string, WireContextState>
    if (typeof maybeMap.get === 'function') return maybeMap.get(wireId) ?? null
    return (contexts as Readonly<Record<string, WireContextState>>)[wireId] ?? null
  }

  private renderSection(label: string, wires: readonly WireSummary[], direction: 'outgoing' | 'incoming'): TemplateResult | typeof nothing {
    if (wires.length === 0) return nothing
    const showAll = direction === 'outgoing' ? this.showAllOutgoing : this.showAllIncoming
    const visible = showAll ? wires : wires.slice(0, ShWiresPanel.WIRE_PREVIEW_LIMIT)
    const hiddenCount = wires.length - visible.length
    return html`
      <section class="section" data-wire-section=${direction}>
        <div class="section-header">
          <span>${label}</span>
          <span>(${wires.length})</span>
        </div>
        <ul class="list">
          ${visible.map((wire) => this.renderWire(wire, direction))}
        </ul>
        ${hiddenCount > 0
          ? html`<button
              type="button"
              class="show-more"
              data-wire-panel-show-more=${direction}
              @click=${() => {
                if (direction === 'outgoing') this.showAllOutgoing = true
                else this.showAllIncoming = true
              }}
            >Show ${hiddenCount} more...</button>`
          : nothing}
      </section>
    `
  }

  private renderEndpoint(
    label: 'here' | 'there',
    title: string,
    snippet: string | undefined,
    blockId: string | undefined,
    showTitle: boolean,
    actions: TemplateResult | typeof nothing = nothing,
  ): TemplateResult | typeof nothing {
    const text = snippet?.trim() || ''
    const isDocumentLevel = !blockId?.trim()
    if (!showTitle && isDocumentLevel && !text && actions === nothing) return nothing
    return html`
      <div class="wire-endpoint" data-wire-endpoint=${label}>
        ${showTitle
          ? html`<div class="endpoint-title-row">
              <span class="flow-label">${label}</span>
              <strong class="endpoint-title" title=${title}>${title}</strong>
              ${actions}
            </div>`
          : actions}
        ${isDocumentLevel && !text
          ? nothing
          : html`<blockquote class="snippet ${label === 'here' ? 'local' : ''} ${text ? '' : 'missing'}">
              ${text || `No ${label} snippet yet`}
            </blockquote>`}
      </div>
    `
  }

  private renderWireActions(
    wire: WireSummary,
    direction: 'outgoing' | 'incoming',
    expanded: boolean,
  ): TemplateResult | typeof nothing {
    const buttons: TemplateResult[] = []
    const canPinBlock = Boolean(wire.localBlockId && this.localGraphId && this.localDocumentId)
    const canPinWire = Boolean(this.localGraphId && this.localDocumentId)

    if (this.hasCapability('context')) {
      const label = expanded ? 'Collapse context' : 'Expand context'
      buttons.push(html`<button
        type="button"
        class="action-button context ${expanded ? 'active' : ''}"
        data-wire-panel-context
        title=${label}
        aria-label=${label}
        aria-expanded=${String(expanded)}
        @click=${(event: Event) => this.runCardAction(event, () => this.toggleContext(wire))}
      >${panelIcon('layers')}</button>`)
    }
    if (this.hasCapability('pin') && canPinWire) {
      buttons.push(html`<button
        type="button"
        class="action-button"
        data-wire-panel-pin-wire
        title="Pin full wire"
        aria-label="Pin full wire"
        @click=${(event: Event) => this.runCardAction(event, () => this.pinWire(wire, direction))}
      >${panelIcon('link')}</button>`)
    }
    if (this.hasCapability('pin') && canPinBlock) {
      buttons.push(html`<button
        type="button"
        class="action-button"
        data-wire-panel-pin-block
        title="Pin local block"
        aria-label="Pin local block"
        @click=${(event: Event) => this.runCardAction(event, () => this.pinWireBlock(wire))}
      >${panelIcon('block')}</button>`)
    }
    if (this.hasCapability('pin')) {
      buttons.push(html`<button
        type="button"
        class="action-button"
        data-wire-panel-pin
        title="Pin connected document"
        aria-label="Pin connected document"
        @click=${(event: Event) => this.runCardAction(event, () => this.pinWireDocument(wire))}
      >${panelIcon('pin')}</button>`)
    }
    if (this.hasCapability('refresh')) {
      buttons.push(html`<button
        type="button"
        class="action-button"
        data-wire-panel-refresh
        title="Refresh snapshot"
        aria-label="Refresh snapshot"
        @click=${(event: Event) => this.runCardAction(event, () => this.refreshWire(wire))}
      >${panelIcon('refresh')}</button>`)
    }
    if (this.hasCapability('delete')) {
      buttons.push(html`<button
        type="button"
        class="action-button delete"
        data-wire-panel-delete
        title="Delete wire"
        aria-label="Delete wire"
        @click=${(event: Event) => this.runCardAction(event, () => this.deleteWire(wire))}
      >${panelIcon('trash')}</button>`)
    }

    return buttons.length > 0 ? html`<div class="actions">${buttons}</div>` : nothing
  }

  private renderWire(wire: WireSummary, direction: 'outgoing' | 'incoming'): TemplateResult {
    const localTitle = this.localDocumentTitle?.trim() || this.localDocumentId?.trim() || 'Current document'
    const otherTitle = wire.otherTitle?.trim() || wire.otherDocumentId
    const incoming = direction === 'incoming'
    const firstLabel = incoming ? 'there' : 'here'
    const firstTitle = incoming ? otherTitle : localTitle
    const firstSnippet = incoming ? wire.otherSnippet : wire.localSnippet
    const firstBlockId = incoming ? wire.otherBlockId : wire.localBlockId
    const secondLabel = incoming ? 'here' : 'there'
    const secondTitle = incoming ? localTitle : otherTitle
    const secondSnippet = incoming ? wire.localSnippet : wire.otherSnippet
    const secondBlockId = incoming ? wire.localBlockId : wire.otherBlockId
    const showSecondTitle = !this.localDocumentId || wire.otherDocumentId !== this.localDocumentId
    const expanded = this.expandedWireId === wire.id
    const canOpen = this.hasCapability('open')
    const actions = this.renderWireActions(wire, direction, expanded)
    return html`
      <li
        class="wire-card ${canOpen ? 'is-openable' : ''}"
        data-wire-panel-item
        data-wire-id=${wire.id}
        data-wire-direction=${direction}
        ?data-wire-panel-open=${canOpen}
        ?data-expanded=${expanded}
        role=${canOpen ? 'link' : nothing}
        tabindex=${canOpen ? '0' : nothing}
        aria-label=${canOpen ? `Open connected document ${otherTitle}` : nothing}
        @click=${(event: MouseEvent) => this.openWireFromCard(event, wire)}
        @keydown=${(event: KeyboardEvent) => this.openWireFromKeyboard(event, wire)}
        @mouseenter=${() => this.highlightWire(wire)}
        @mouseleave=${() => this.clearHighlight()}
      >
        ${this.renderEndpoint(firstLabel, firstTitle, firstSnippet, firstBlockId, true, actions)}
        <div class="relation-line">
          <span class="predicate" title=${wire.predicate}>${wire.predicateLabel}</span>
          ${wire.bidirectional ? html`<span class="bi">↔ bidirectional</span>` : nothing}
        </div>
        ${this.renderEndpoint(secondLabel, secondTitle, secondSnippet, secondBlockId, showSecondTitle)}
        ${expanded ? this.renderContext(wire) : nothing}
      </li>
    `
  }

  private renderContext(wire: WireSummary): TemplateResult {
    const state = this.contextFor(wire.id)
    if (!state || state.status === 'loading') {
      return html`<div class="context-inline" @click=${(event: Event) => event.stopPropagation()}><div class="context-loading">Loading…</div></div>`
    }
    if (state.status === 'error') {
      return html`<div class="context-inline" @click=${(event: Event) => event.stopPropagation()}><div class="context-error">${state.message ?? 'Could not load context'}</div></div>`
    }

    const data = state.data
    const title = data.title ?? data.wireTitle ?? null
    return html`
      <div class="context-inline" @click=${(event: Event) => event.stopPropagation()}>
        ${title ? html`<div class="context-title">${title}</div>` : nothing}
        ${data.mode === 'toc' ? html`<div class="context-mode">Table of contents</div>` : nothing}
        ${data.blocks.length === 0
          ? html`<div class="context-empty">No preview available</div>`
          : data.blocks.map((block) => html`
              <div class="context-block ${block.isTarget ? 'is-target' : ''}">
                ${block.type === 'heading' && block.level
                  ? html`<div class="context-block-type">H${block.level}</div>`
                  : nothing}
                <div class="context-block-text">${block.text}</div>
              </div>
            `)}
      </div>
    `
  }

  override render(): TemplateResult {
    const total = this.outgoingWires.length + this.incomingWires.length
    const ready = this.status === 'ready'
    return html`
      <div class="header">
        <div class="title">
          <span>Wires</span>
          ${ready && total > 0 ? html`<span class="count">${total}</span>` : nothing}
        </div>
        <div class="header-actions">
          ${this.hasCapability('createDocumentWire')
            ? html`<button
                type="button"
                class="icon-button"
                data-wire-panel-wire-document
                title="Create document wire"
                aria-label="Create document wire"
                @click=${(event: MouseEvent) => this.requestDocumentWire(event)}
              >${panelIcon('add')}</button>`
            : nothing}
          ${this.hasCapability('refresh')
            ? html`<button
                type="button"
                class="icon-button"
                data-wire-panel-refresh-all
                title="Refresh all snapshots"
                aria-label="Refresh all snapshots"
                @click=${() => this.refreshAllWires()}
              >${panelIcon('refresh')}</button>`
            : nothing}
          ${this.showClose
            ? html`<button
                type="button"
                class="icon-button"
                data-wire-panel-close
                title="Close wires panel"
                aria-label="Close wires panel"
                @click=${() => this.closePanel()}
              >${panelIcon('close')}</button>`
            : nothing}
        </div>
      </div>
      <div class="body" aria-live="polite">
        ${this.status === 'loading'
          ? html`<div class="state loading" data-wire-panel-state="loading" role="status">
              <div class="spinner" aria-hidden="true"></div>
              <div class="state-copy">Loading wires…</div>
            </div>`
          : this.status === 'error'
            ? html`<div class="state error" data-wire-panel-state="error" role="alert">
                <div class="state-icon">${panelIcon('wire')}</div>
                <div class="state-title">Could not load wires</div>
                <div class="state-copy">${this.error?.trim() || 'The wire projection is currently unavailable.'}</div>
              </div>`
            : this.status === 'idle'
              ? html`<div class="state idle" data-wire-panel-state="idle">
                  <div class="state-icon">${panelIcon('wire')}</div>
                  <div class="state-title">Wires not loaded</div>
                  <div class="state-copy">Open a document to inspect its semantic connections.</div>
                </div>`
              : total === 0
                ? html`<div class="state empty" data-wire-panel-state="empty">
                    <div class="state-icon">${panelIcon('wire')}</div>
                    <div class="state-title">No wires yet</div>
                    <div class="state-copy">Click the wire button in the toolbar to create semantic connections between documents.</div>
                  </div>`
                : [
                    this.renderSection('Outgoing', this.outgoingWires, 'outgoing'),
                    this.renderSection('Incoming', this.incomingWires, 'incoming'),
                  ]}
      </div>
    `
  }
}

export interface WiresPanelMountOptions {
  readonly wireContexts?: WireContextMap | null
  readonly localGraphId?: string | null
  readonly localDocumentId?: string | null
  readonly localDocumentTitle?: string | null
  readonly status?: WirePanelStatus
  readonly error?: string | null
  readonly capabilities?: WirePanelCapabilities | null
  readonly showClose?: boolean
  readonly onClose?: () => void
}

export function mountWiresPanel(
  bundle: WireBundle | null | undefined,
  options: WiresPanelMountOptions = {},
): TemplateResult {
  return html`<sh-wires-panel
    .bundle=${bundle ?? EMPTY_WIRE_BUNDLE}
    .wireContexts=${options.wireContexts ?? null}
    .localGraphId=${options.localGraphId ?? null}
    .localDocumentId=${options.localDocumentId ?? null}
    .localDocumentTitle=${options.localDocumentTitle ?? null}
    .status=${options.status ?? 'ready'}
    .error=${options.error ?? null}
    .capabilities=${options.capabilities ?? null}
    .showClose=${options.showClose ?? Boolean(options.onClose)}
    @mn-wire-panel-close=${options.onClose ?? null}
  ></sh-wires-panel>`
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-wires-panel': ShWiresPanel
  }
}
