import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  DEFAULT_WIRE_PREDICATE_URI,
  PREDICATE_GROUPS,
  getWirePredicateLabel,
} from '@shrubbery/nucleus'
import type { BlockWireRequestDetail } from '../editor-host.js'
import {
  WIRE_PINNED_BLOCK_CLOSE_EVENT,
  WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_BLOCK_MOVE_EVENT,
  WIRE_PINNED_BLOCK_OPEN_EVENT,
  WIRE_PINNED_BLOCK_REFRESH_EVENT,
  WIRE_PINNED_DOC_CLOSE_EVENT,
  WIRE_PINNED_DOC_MOVE_EVENT,
  WIRE_PINNED_DOC_OPEN_EVENT,
  WIRE_PINNED_WIRE_CLOSE_EVENT,
  WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT,
  WIRE_PINNED_WIRE_MOVE_EVENT,
  WIRE_PINNED_WIRE_OPEN_EVENT,
  WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT,
  type WirePinnedBlockCloseDetail,
  type WirePinnedBlockContextRequestDetail,
  type WirePinnedBlockMoveDetail,
  type WirePinnedBlockOpenDetail,
  type WirePinnedBlockRefreshDetail,
  type WirePinnedDocCloseDetail,
  type WirePinnedDocMoveDetail,
  type WirePinnedDocOpenDetail,
  type WirePinnedWireCloseDetail,
  type WirePinnedWireContextRequestDetail,
  type WirePinnedWireMoveDetail,
  type WirePinnedWireOpenDetail,
  type WirePinnedWireUpdateRequestDetail,
} from '../wire-events.js'

export interface PinnedWireDocument {
  readonly id: string
  readonly graphId: string
  readonly documentId: string
  readonly title: string
  readonly x: number
  readonly y: number
}

export interface PinnedWireBlock {
  readonly id: string
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
  readonly text: string
  readonly documentTitle: string
  readonly x: number
  readonly y: number
}

export interface PinnedWireNode {
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

export interface PinnedWireBlockContextBlock {
  readonly id: string
  readonly text: string
  readonly isTarget: boolean
}

export interface PinnedWireBlockContextData {
  readonly blocks: readonly PinnedWireBlockContextBlock[]
}

export type PinnedWireBlockContextState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly data: PinnedWireBlockContextData }

export type PinnedWireBlockContextMap =
  | ReadonlyMap<string, PinnedWireBlockContextState>
  | Readonly<Record<string, PinnedWireBlockContextState>>

export type PinnedWireNodeContextMap = PinnedWireBlockContextMap

@customElement('sh-wire-pinned-layer')
export class ShWirePinnedLayer extends LitElement {
  private static readonly DOC_CARD_WIDTH = 220
  private static readonly BLOCK_CARD_WIDTH = 220
  private static readonly WIRE_CARD_WIDTH = 292

  static styles = css`
    :host {
      display: contents;
      font-family: var(--mn-font-sans, system-ui, sans-serif);
    }

    .pinned-layer {
      position: fixed;
      inset: 0;
      z-index: 900;
      pointer-events: none;
    }

    .pinned-wire,
    .pinned-doc,
    .pinned-block {
      position: absolute;
      width: ${ShWirePinnedLayer.DOC_CARD_WIDTH}px;
      min-height: 78px;
      border: 1px solid var(--mn-color-wire-200, var(--mn-color-border-default, #d0d7de));
      border-top: 3px solid var(--mn-color-wire-400, var(--mn-color-border-accent, #6aa4ff));
      border-radius: 8px;
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.16);
      color: var(--mn-color-text-primary, #17202a);
      pointer-events: auto;
      box-sizing: border-box;
      overflow: hidden;
    }

    .pinned-wire {
      width: ${ShWirePinnedLayer.WIRE_CARD_WIDTH}px;
      min-height: 148px;
    }

    .wire-endpoint {
      display: contents;
    }

    .pinned-block {
      width: ${ShWirePinnedLayer.BLOCK_CARD_WIDTH}px;
      min-height: 96px;
      border-color: var(--mn-color-border-accent, #6aa4ff);
      border-top-color: var(--mn-color-border-accent, #6aa4ff);
    }

    .titlebar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 7px 34px 6px 10px;
      cursor: grab;
      background: var(--mn-color-surface-base, #fff);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      box-sizing: border-box;
    }

    .titlebar.dragging {
      cursor: grabbing;
    }

    .doc-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mn-color-text-primary, #17202a);
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 650;
      text-align: left;
      background: transparent;
      border: 0;
      padding: 0;
      cursor: pointer;
    }

    .wire-doc-label,
    .block-doc-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 650;
      text-align: left;
      background: transparent;
      border: 0;
      padding: 0;
      cursor: pointer;
    }

    .wire-doc-label {
      color: var(--mn-color-text-secondary, #394150);
    }

    .wire-doc-label:hover,
    .block-doc-label:hover {
      color: var(--mn-color-text-primary, #17202a);
      text-decoration: underline;
    }

    .close {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: var(--mn-color-text-muted, #697386);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 700;
      line-height: 1;
    }

    .close:hover {
      background: var(--mn-color-danger-surface, #fff1f1);
      color: var(--mn-color-text-danger, #b42318);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      padding: 8px 10px 10px;
    }

    .block-body {
      max-height: 176px;
      overflow: auto;
      padding: 8px 10px 2px;
      color: var(--mn-color-text-primary, #17202a);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .wire-body {
      max-height: 128px;
      overflow: auto;
      padding: 8px 10px;
      color: var(--mn-color-text-primary, #17202a);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .wire-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 7px 10px;
      border-top: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-accent, #2557a7);
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 650;
      text-align: center;
    }

    .wire-control {
      min-height: 24px;
      border: 1px solid var(--mn-color-border-subtle, #d0d7de);
      border-radius: 5px;
      background: var(--mn-color-surface-raised, #f6f8fa);
      color: var(--mn-color-text-secondary, #394150);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 650;
      padding: 0 7px;
    }

    .wire-control:hover,
    .wire-control.active {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-accent, #2557a7);
    }

    .wire-control:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .wire-bidirectional {
      border: 1px solid var(--mn-color-border-subtle, #d0d7de);
      border-radius: 999px;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      line-height: 1;
      padding: 3px 6px;
      text-transform: uppercase;
    }

    .predicate-picker {
      display: grid;
      gap: 8px;
      padding: 9px 10px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      background: var(--mn-color-surface-base, #fff);
    }

    .predicate-group {
      display: grid;
      gap: 5px;
    }

    .predicate-group-label {
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .predicate-options {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .predicate-option {
      min-height: 24px;
      border: 1px solid var(--mn-color-border-subtle, #d0d7de);
      border-radius: 5px;
      background: var(--mn-color-surface-raised, #f6f8fa);
      color: var(--mn-color-text-secondary, #394150);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 0.625rem);
      padding: 0 7px;
    }

    .predicate-option.selected {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-accent, #2557a7);
      font-weight: 650;
    }

    .block-placeholder {
      color: var(--mn-color-text-muted, #697386);
      font-style: italic;
    }

    .context-row {
      display: flex;
      gap: 6px;
      padding: 6px 8px 4px;
      border-top: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e6e8eb);
      background: var(--mn-color-surface-base, #fff);
    }

    .context-button {
      flex: 1 1 0;
      min-height: 24px;
      border: 1px solid var(--mn-color-border-subtle, #d0d7de);
      border-radius: 5px;
      background: var(--mn-color-surface-raised, #f6f8fa);
      color: var(--mn-color-text-muted, #697386);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 650;
      padding: 0 6px;
      text-transform: uppercase;
    }

    .context-button.active {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      background: var(--mn-color-surface-accent, #e8f0fe);
      color: var(--mn-color-text-accent, #2557a7);
    }

    .context-blocks {
      display: grid;
      gap: 4px;
      padding: 6px 8px;
      background: var(--mn-color-surface-base, #fff);
    }

    .context-block {
      border-left: 2px solid var(--mn-color-border-subtle, #d0d7de);
      padding: 4px 7px;
      color: var(--mn-color-text-muted, #697386);
      font-size: var(--mn-text-2xs, 0.625rem);
      line-height: 1.45;
    }

    .context-block.message {
      border-left-color: transparent;
      font-style: italic;
    }

    .action {
      min-height: 26px;
      border: 1px solid var(--mn-color-border-subtle, #d0d7de);
      border-radius: 6px;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #394150);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 0.75rem);
      font-weight: 600;
      padding: 0 9px;
    }

    .action:hover {
      border-color: var(--mn-color-border-accent, #6aa4ff);
      color: var(--mn-color-text-primary, #17202a);
    }
  `

  @property({ attribute: false })
  docs: readonly PinnedWireDocument[] = []

  @property({ attribute: false })
  nodes: readonly PinnedWireNode[] = []

  @property({ attribute: false })
  blocks: readonly PinnedWireBlock[] = []

  @property({ attribute: false })
  blockContexts: PinnedWireBlockContextMap | null = null

  @property({ attribute: false })
  nodeContexts: PinnedWireNodeContextMap | null = null

  @state()
  private dragging: { readonly id: string; readonly offsetX: number; readonly offsetY: number } | null = null

  @state()
  private expandedContextSlots: ReadonlySet<string> = new Set()

  @state()
  private openPredicateNodeId: string | null = null

  @state()
  private zOrder: readonly string[] = []

  private requestedNodeContextIds = new Set<string>()
  private requestedBlockContextIds = new Set<string>()

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('nodes') || changed.has('nodeContexts')) {
      this.requestMissingWireNodeContexts()
    }
    if (changed.has('blocks') || changed.has('blockContexts')) {
      this.requestMissingBlockContexts()
    }
  }

  private orderedPinnedIds(): readonly string[] {
    return [
      ...this.nodes.map((node) => node.id),
      ...this.docs.map((doc) => doc.id),
      ...this.blocks.map((block) => block.id),
    ]
  }

  private normalizedZOrder(): readonly string[] {
    const ids = this.orderedPinnedIds()
    const idSet = new Set(ids)
    const kept = this.zOrder.filter((id) => idSet.has(id))
    const keptSet = new Set(kept)
    return [
      ...ids.filter((id) => !keptSet.has(id)),
      ...kept,
    ]
  }

  private cardZIndex(id: string): number {
    const index = this.normalizedZOrder().indexOf(id)
    return 900 + Math.max(0, index)
  }

  private bringToFront(id: string): void {
    const ids = new Set(this.orderedPinnedIds())
    if (!ids.has(id)) return
    this.zOrder = [
      ...this.normalizedZOrder().filter((item) => item !== id),
      id,
    ]
  }

  private requestMissingWireNodeContexts(): void {
    const currentIds = new Set(this.orderedPinnedIds())
    for (const id of Array.from(this.requestedNodeContextIds)) {
      const nodeId = id.slice(0, id.lastIndexOf(':'))
      if (!currentIds.has(nodeId)) this.requestedNodeContextIds.delete(id)
    }
    for (const node of this.nodes) {
      for (const side of ['source', 'target'] as const) {
        const key = this.wireNodeContextKey(node, side)
        const blockId = side === 'source' ? node.sourceBlockId : node.targetBlockId
        if (!blockId || this.requestedNodeContextIds.has(key) || this.wireNodeContextFor(node, side)) continue
        this.requestedNodeContextIds.add(key)
        this.requestWireNodeContext(node, side)
      }
    }
  }

  private requestMissingBlockContexts(): void {
    const currentIds = new Set(this.blocks.map((block) => block.id))
    for (const id of Array.from(this.requestedBlockContextIds)) {
      if (!currentIds.has(id)) this.requestedBlockContextIds.delete(id)
    }
    for (const block of this.blocks) {
      if (this.requestedBlockContextIds.has(block.id) || this.blockContextFor(block.id)) continue
      this.requestedBlockContextIds.add(block.id)
      this.requestBlockContext(block)
    }
  }

  private openDoc(doc: PinnedWireDocument): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedDocOpenDetail>(WIRE_PINNED_DOC_OPEN_EVENT, {
        bubbles: true,
        composed: true,
        detail: { graphId: doc.graphId, documentId: doc.documentId },
      }),
    )
  }

  private closeDoc(doc: PinnedWireDocument): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedDocCloseDetail>(WIRE_PINNED_DOC_CLOSE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: doc.id },
      }),
    )
  }

  private moveDoc(doc: PinnedWireDocument, x: number, y: number): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedDocMoveDetail>(WIRE_PINNED_DOC_MOVE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: doc.id, x, y },
      }),
    )
  }

  private openWireNodeEndpoint(
    graphId: string,
    documentId: string,
    blockId: string | null | undefined,
  ): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedWireOpenDetail>(WIRE_PINNED_WIRE_OPEN_EVENT, {
        bubbles: true,
        composed: true,
        detail: { graphId, documentId, blockId },
      }),
    )
  }

  private closeWireNode(node: PinnedWireNode): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedWireCloseDetail>(WIRE_PINNED_WIRE_CLOSE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: node.id },
      }),
    )
  }

  private moveWireNode(node: PinnedWireNode, x: number, y: number): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedWireMoveDetail>(WIRE_PINNED_WIRE_MOVE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: node.id, x, y },
      }),
    )
  }

  private updateWireNode(
    node: PinnedWireNode,
    predicate: string,
    bidirectional: boolean,
    swap: boolean,
  ): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedWireUpdateRequestDetail>(WIRE_PINNED_WIRE_UPDATE_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          id: node.id,
          wireId: node.wireId,
          predicate,
          bidirectional,
          swap,
        },
      }),
    )
  }

  private requestWireNodeContext(
    node: PinnedWireNode,
    side: 'source' | 'target',
  ): void {
    const graphId = side === 'source' ? node.sourceGraphId : node.targetGraphId
    const documentId = side === 'source' ? node.sourceDocumentId : node.targetDocumentId
    const blockId = side === 'source' ? node.sourceBlockId : node.targetBlockId
    if (!blockId) return
    this.dispatchEvent(
      new CustomEvent<WirePinnedWireContextRequestDetail>(WIRE_PINNED_WIRE_CONTEXT_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          id: this.wireNodeContextKey(node, side),
          side,
          graphId,
          documentId,
          blockId,
        },
      }),
    )
  }

  private openBlock(block: PinnedWireBlock): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedBlockOpenDetail>(WIRE_PINNED_BLOCK_OPEN_EVENT, {
        bubbles: true,
        composed: true,
        detail: { graphId: block.graphId, documentId: block.documentId, blockId: block.blockId },
      }),
    )
  }

  private closeBlock(block: PinnedWireBlock): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedBlockCloseDetail>(WIRE_PINNED_BLOCK_CLOSE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: block.id },
      }),
    )
  }

  private moveBlock(block: PinnedWireBlock, x: number, y: number): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedBlockMoveDetail>(WIRE_PINNED_BLOCK_MOVE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { id: block.id, x, y },
      }),
    )
  }

  private refreshBlock(block: PinnedWireBlock): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedBlockRefreshDetail>(WIRE_PINNED_BLOCK_REFRESH_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          id: block.id,
          graphId: block.graphId,
          documentId: block.documentId,
          blockId: block.blockId,
        },
      }),
    )
  }

  private requestBlockContext(block: PinnedWireBlock): void {
    this.dispatchEvent(
      new CustomEvent<WirePinnedBlockContextRequestDetail>(WIRE_PINNED_BLOCK_CONTEXT_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: {
          id: block.id,
          graphId: block.graphId,
          documentId: block.documentId,
          blockId: block.blockId,
        },
      }),
    )
  }

  private wireBlock(block: PinnedWireBlock, event: MouseEvent): void {
    this.dispatchEvent(
      new CustomEvent<BlockWireRequestDetail>('mn-block-wire-request', {
        bubbles: true,
        composed: true,
        detail: {
          graphId: block.graphId,
          documentId: block.documentId,
          blockId: block.blockId,
          clientX: event.clientX,
          clientY: event.clientY,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        },
      }),
    )
  }

  private contextFromMap(
    contexts: PinnedWireBlockContextMap | null,
    id: string,
  ): PinnedWireBlockContextState | null {
    if (!contexts) return null
    const maybeMap = contexts as ReadonlyMap<string, PinnedWireBlockContextState>
    if (typeof maybeMap.get === 'function') return maybeMap.get(id) ?? null
    return (contexts as Readonly<Record<string, PinnedWireBlockContextState>>)[id] ?? null
  }

  private blockContextFor(blockId: string): PinnedWireBlockContextState | null {
    return this.contextFromMap(this.blockContexts, blockId)
  }

  private wireNodeContextKey(node: PinnedWireNode, side: 'source' | 'target'): string {
    return `${node.id}:${side}`
  }

  private wireNodeContextFor(node: PinnedWireNode, side: 'source' | 'target'): PinnedWireBlockContextState | null {
    return this.contextFromMap(this.nodeContexts, this.wireNodeContextKey(node, side))
  }

  private contextSlotKey(block: PinnedWireBlock, direction: 'above' | 'below'): string {
    return `${block.id}:${direction}`
  }

  private wireNodeContextSlotKey(
    node: PinnedWireNode,
    side: 'source' | 'target',
    direction: 'above' | 'below',
  ): string {
    return `wire:${this.wireNodeContextKey(node, side)}:${direction}`
  }

  private toggleBlockContext(block: PinnedWireBlock, direction: 'above' | 'below'): void {
    const slotKey = this.contextSlotKey(block, direction)
    const next = new Set(this.expandedContextSlots)
    if (next.has(slotKey)) {
      next.delete(slotKey)
    } else {
      next.add(slotKey)
      if (!this.blockContextFor(block.id)) this.requestBlockContext(block)
    }
    this.expandedContextSlots = next
  }

  private toggleWireNodeContext(
    node: PinnedWireNode,
    side: 'source' | 'target',
    direction: 'above' | 'below',
  ): void {
    const slotKey = this.wireNodeContextSlotKey(node, side, direction)
    const next = new Set(this.expandedContextSlots)
    if (next.has(slotKey)) {
      next.delete(slotKey)
    } else {
      next.add(slotKey)
      if (!this.wireNodeContextFor(node, side)) this.requestWireNodeContext(node, side)
    }
    this.expandedContextSlots = next
  }

  private onTitlePointerDown(event: PointerEvent, doc: PinnedWireDocument): void {
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    if (typeof target.setPointerCapture === 'function' && Number.isFinite(event.pointerId)) {
      target.setPointerCapture(event.pointerId)
    }
    target.classList.add('dragging')
    this.bringToFront(doc.id)
    this.dragging = {
      id: doc.id,
      offsetX: event.clientX - doc.x,
      offsetY: event.clientY - doc.y,
    }
  }

  private onTitlePointerMove(event: PointerEvent, doc: PinnedWireDocument): void {
    const drag = this.dragging
    if (!drag || drag.id !== doc.id) return
    const view = this.ownerDocument.defaultView
    const maxX = Math.max(0, (view?.innerWidth ?? ShWirePinnedLayer.DOC_CARD_WIDTH) - ShWirePinnedLayer.DOC_CARD_WIDTH - 8)
    const maxY = Math.max(0, (view?.innerHeight ?? 120) - 40)
    const x = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX))
    const y = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY))
    this.moveDoc(doc, x, y)
  }

  private onBlockTitlePointerDown(event: PointerEvent, block: PinnedWireBlock): void {
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    if (typeof target.setPointerCapture === 'function' && Number.isFinite(event.pointerId)) {
      target.setPointerCapture(event.pointerId)
    }
    target.classList.add('dragging')
    this.bringToFront(block.id)
    this.dragging = {
      id: block.id,
      offsetX: event.clientX - block.x,
      offsetY: event.clientY - block.y,
    }
  }

  private onBlockTitlePointerMove(event: PointerEvent, block: PinnedWireBlock): void {
    const drag = this.dragging
    if (!drag || drag.id !== block.id) return
    const view = this.ownerDocument.defaultView
    const maxX = Math.max(0, (view?.innerWidth ?? ShWirePinnedLayer.BLOCK_CARD_WIDTH) - ShWirePinnedLayer.BLOCK_CARD_WIDTH - 8)
    const maxY = Math.max(0, (view?.innerHeight ?? 120) - 40)
    const x = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX))
    const y = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY))
    this.moveBlock(block, x, y)
  }

  private onWireTitlePointerDown(event: PointerEvent, node: PinnedWireNode): void {
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    if (typeof target.setPointerCapture === 'function' && Number.isFinite(event.pointerId)) {
      target.setPointerCapture(event.pointerId)
    }
    target.classList.add('dragging')
    this.bringToFront(node.id)
    this.dragging = {
      id: node.id,
      offsetX: event.clientX - node.x,
      offsetY: event.clientY - node.y,
    }
  }

  private onWireTitlePointerMove(event: PointerEvent, node: PinnedWireNode): void {
    const drag = this.dragging
    if (!drag || drag.id !== node.id) return
    const view = this.ownerDocument.defaultView
    const maxX = Math.max(0, (view?.innerWidth ?? ShWirePinnedLayer.WIRE_CARD_WIDTH) - ShWirePinnedLayer.WIRE_CARD_WIDTH - 8)
    const maxY = Math.max(0, (view?.innerHeight ?? 160) - 40)
    const x = Math.max(0, Math.min(maxX, event.clientX - drag.offsetX))
    const y = Math.max(0, Math.min(maxY, event.clientY - drag.offsetY))
    this.moveWireNode(node, x, y)
  }

  private onTitlePointerUp(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement
    target.classList.remove('dragging')
    if (
      typeof target.hasPointerCapture === 'function' &&
      Number.isFinite(event.pointerId) &&
      target.hasPointerCapture(event.pointerId)
    ) {
      target.releasePointerCapture(event.pointerId)
    }
    this.dragging = null
  }

  private renderDoc(doc: PinnedWireDocument): TemplateResult {
    return html`
      <section
        class="pinned-doc"
        data-wire-pinned-doc
        data-pinned-doc-id=${doc.id}
        style="left:${doc.x}px;top:${doc.y}px;z-index:${this.cardZIndex(doc.id)};"
        role="dialog"
        aria-modal="false"
        aria-label=${`Pinned document: ${doc.title}`}
        @pointerdown=${() => this.bringToFront(doc.id)}
      >
        <button
          type="button"
          class="close"
          data-wire-pinned-doc-close
          aria-label="Close pinned document"
          @click=${() => this.closeDoc(doc)}
        >x</button>
        <div
          class="titlebar"
          data-wire-pinned-doc-drag
          @pointerdown=${(event: PointerEvent) => this.onTitlePointerDown(event, doc)}
          @pointermove=${(event: PointerEvent) => this.onTitlePointerMove(event, doc)}
          @pointerup=${(event: PointerEvent) => this.onTitlePointerUp(event)}
          @pointercancel=${(event: PointerEvent) => this.onTitlePointerUp(event)}
        >
          <button
            type="button"
            class="doc-title"
            data-wire-pinned-doc-title
            title=${doc.title}
            @click=${() => this.openDoc(doc)}
          >${doc.title}</button>
        </div>
        <div class="actions">
          <button type="button" class="action" data-wire-pinned-doc-open @click=${() => this.openDoc(doc)}>Open</button>
        </div>
      </section>
    `
  }

  private renderWireNodeContextBlocks(
    node: PinnedWireNode,
    side: 'source' | 'target',
    direction: 'above' | 'below',
  ): TemplateResult {
    const state = this.wireNodeContextFor(node, side)
    if (!state || state.status === 'loading') {
      return html`<div class="context-blocks"><div class="context-block message">Loading...</div></div>`
    }
    if (state.status === 'error') {
      return html`<div class="context-blocks"><div class="context-block message">${state.message ?? 'Could not load'}</div></div>`
    }
    const blocks = state.data.blocks
    const targetIndex = blocks.findIndex((entry) => entry.isTarget)
    const visible = direction === 'above'
      ? blocks.slice(Math.max(0, targetIndex - 2), targetIndex)
      : blocks.slice(targetIndex + 1, targetIndex + 3)
    if (targetIndex < 0 || visible.length === 0) {
      return html`<div class="context-blocks"><div class="context-block message">No ${direction} context</div></div>`
    }
    return html`
      <div class="context-blocks">
        ${visible.map((entry) => html`<div class="context-block">${entry.text}</div>`)}
      </div>
    `
  }

  private wireNodeEndpointText(
    node: PinnedWireNode,
    side: 'source' | 'target',
    snippet: string,
  ): string {
    const state = this.wireNodeContextFor(node, side)
    if (state?.status !== 'ready') return snippet
    return state.data.blocks.find((entry) => entry.isTarget)?.text ?? snippet
  }

  private renderWireEndpoint(
    node: PinnedWireNode,
    title: string,
    text: string,
    graphId: string,
    documentId: string,
    blockId: string | null | undefined,
    side: 'source' | 'target',
    dragNode: PinnedWireNode | null = null,
  ): TemplateResult {
    const body = this.wireNodeEndpointText(node, side, text).trim()
    const aboveOpen = this.expandedContextSlots.has(this.wireNodeContextSlotKey(node, side, 'above'))
    const belowOpen = this.expandedContextSlots.has(this.wireNodeContextSlotKey(node, side, 'below'))
    if (dragNode) {
      return html`
        <div class="wire-endpoint" data-wire-endpoint-section="source">
          ${aboveOpen ? this.renderWireNodeContextBlocks(node, side, 'above') : nothing}
          <div
            class="titlebar"
            data-wire-pinned-wire-endpoint
            data-wire-endpoint="source"
            data-wire-pinned-wire-drag=""
            @pointerdown=${(event: PointerEvent) => this.onWireTitlePointerDown(event, dragNode)}
            @pointermove=${(event: PointerEvent) => this.onWireTitlePointerMove(event, dragNode)}
            @pointerup=${(event: PointerEvent) => this.onTitlePointerUp(event)}
            @pointercancel=${(event: PointerEvent) => this.onTitlePointerUp(event)}
          >
            <button
              type="button"
              class="wire-doc-label"
              data-wire-pinned-wire-endpoint-title
              data-wire-pinned-wire-source-title=""
              data-wire-endpoint="source"
              title=${title}
              @click=${() => this.openWireNodeEndpoint(graphId, documentId, blockId)}
            >${title}</button>
          </div>
          <div
            class="wire-body"
            data-wire-pinned-wire-endpoint-body
            data-wire-pinned-wire-source-body=""
            data-wire-endpoint="source"
          >
            ${body
              ? body
              : blockId
                ? html`<span class="block-placeholder">Empty block</span>`
                : html`<span class="block-placeholder">No block preview</span>`}
          </div>
          ${blockId
            ? html`
              <div class="context-row">
                <button
                  type="button"
                  class="context-button ${aboveOpen ? 'active' : ''}"
                  data-wire-pinned-wire-context-above
                  data-wire-endpoint="source"
                  aria-pressed=${aboveOpen ? 'true' : 'false'}
                  @click=${() => this.toggleWireNodeContext(node, side, 'above')}
                >Above</button>
                <button
                  type="button"
                  class="context-button ${belowOpen ? 'active' : ''}"
                  data-wire-pinned-wire-context-below
                  data-wire-endpoint="source"
                  aria-pressed=${belowOpen ? 'true' : 'false'}
                  @click=${() => this.toggleWireNodeContext(node, side, 'below')}
                >Below</button>
              </div>
            `
            : nothing}
          ${belowOpen ? this.renderWireNodeContextBlocks(node, side, 'below') : nothing}
        </div>
      `
    }
    return html`
      <div class="wire-endpoint" data-wire-endpoint-section="target">
        ${aboveOpen ? this.renderWireNodeContextBlocks(node, side, 'above') : nothing}
        <div
          class="titlebar"
          data-wire-pinned-wire-endpoint
          data-wire-endpoint="target"
        >
          <button
            type="button"
            class="wire-doc-label"
            data-wire-pinned-wire-endpoint-title
            data-wire-endpoint="target"
            title=${title}
            @click=${() => this.openWireNodeEndpoint(graphId, documentId, blockId)}
          >${title}</button>
        </div>
        <div
          class="wire-body"
          data-wire-pinned-wire-endpoint-body
          data-wire-endpoint="target"
        >
          ${body
            ? body
            : blockId
              ? html`<span class="block-placeholder">Empty block</span>`
              : html`<span class="block-placeholder">No block preview</span>`}
        </div>
        ${blockId
          ? html`
            <div class="context-row">
              <button
                type="button"
                class="context-button ${aboveOpen ? 'active' : ''}"
                data-wire-pinned-wire-context-above
                data-wire-endpoint="target"
                aria-pressed=${aboveOpen ? 'true' : 'false'}
                @click=${() => this.toggleWireNodeContext(node, side, 'above')}
              >Above</button>
              <button
                type="button"
                class="context-button ${belowOpen ? 'active' : ''}"
                data-wire-pinned-wire-context-below
                data-wire-endpoint="target"
                aria-pressed=${belowOpen ? 'true' : 'false'}
                @click=${() => this.toggleWireNodeContext(node, side, 'below')}
              >Below</button>
            </div>
          `
          : nothing}
        ${belowOpen ? this.renderWireNodeContextBlocks(node, side, 'below') : nothing}
      </div>
    `
  }

  private renderPredicatePicker(node: PinnedWireNode): TemplateResult {
    const groups = [
      [
        'Default',
        {
          predicates: [
            {
              uri: DEFAULT_WIRE_PREDICATE_URI,
              label: getWirePredicateLabel(DEFAULT_WIRE_PREDICATE_URI),
              description: 'General association',
            },
          ],
        },
      ] as const,
      ...Object.entries(PREDICATE_GROUPS),
    ]
    return html`
      <div class="predicate-picker" data-wire-pinned-wire-predicate-picker>
        ${groups.map(([groupName, category]) => html`
          <div class="predicate-group">
            <div class="predicate-group-label">${groupName}</div>
            <div class="predicate-options">
              ${category.predicates.map((predicate) => html`
                <button
                  type="button"
                  class="predicate-option ${node.predicate === predicate.uri ? 'selected' : ''}"
                  data-wire-pinned-wire-predicate-option
                  data-predicate-uri=${predicate.uri}
                  title=${predicate.description ?? predicate.label}
                  @click=${() => {
                    this.openPredicateNodeId = null
                    if (predicate.uri !== node.predicate) {
                      this.updateWireNode(node, predicate.uri, node.bidirectional, false)
                    }
                  }}
                >${predicate.label}</button>
              `)}
            </div>
          </div>
        `)}
      </div>
    `
  }

  private renderWireNode(node: PinnedWireNode): TemplateResult {
    const predicateOpen = this.openPredicateNodeId === node.id
    return html`
      <section
        class="pinned-wire"
        data-wire-pinned-wire
        data-pinned-wire-id=${node.id}
        style="left:${node.x}px;top:${node.y}px;z-index:${this.cardZIndex(node.id)};"
        role="dialog"
        aria-modal="false"
        aria-label=${`Pinned wire: ${node.sourceTitle} ${node.predicateLabel} ${node.targetTitle}`}
        @pointerdown=${() => this.bringToFront(node.id)}
      >
        <button
          type="button"
          class="close"
          data-wire-pinned-wire-close
          aria-label="Close pinned wire"
          @click=${() => this.closeWireNode(node)}
        >x</button>
        ${this.renderWireEndpoint(
          node,
          node.sourceTitle,
          node.sourceText,
          node.sourceGraphId,
          node.sourceDocumentId,
          node.sourceBlockId,
          'source',
          node,
        )}
        <div class="wire-divider" data-wire-pinned-wire-predicate title=${node.predicate}>
          <button
            type="button"
            class="wire-control"
            data-wire-pinned-wire-swap
            title="Swap direction"
            aria-label="Swap wire direction"
            ?disabled=${node.bidirectional}
            @click=${() => this.updateWireNode(node, node.predicate, false, true)}
          >⇄</button>
          <button
            type="button"
            class="wire-control ${predicateOpen ? 'active' : ''}"
            data-wire-pinned-wire-predicate-button
            aria-expanded=${predicateOpen ? 'true' : 'false'}
            @click=${() => {
              this.openPredicateNodeId = predicateOpen ? null : node.id
            }}
          >${node.predicateLabel}</button>
          <button
            type="button"
            class="wire-control ${node.bidirectional ? 'active' : ''}"
            data-wire-pinned-wire-bidirectional
            aria-pressed=${node.bidirectional ? 'true' : 'false'}
            @click=${() => this.updateWireNode(node, node.predicate, !node.bidirectional, false)}
          >Both</button>
        </div>
        ${predicateOpen ? this.renderPredicatePicker(node) : nothing}
        ${this.renderWireEndpoint(
          node,
          node.targetTitle,
          node.targetText,
          node.targetGraphId,
          node.targetDocumentId,
          node.targetBlockId,
          'target',
        )}
      </section>
    `
  }

  private renderContextBlocks(block: PinnedWireBlock, direction: 'above' | 'below'): TemplateResult {
    const state = this.blockContextFor(block.id)
    if (!state || state.status === 'loading') {
      return html`<div class="context-blocks"><div class="context-block message">Loading...</div></div>`
    }
    if (state.status === 'error') {
      return html`<div class="context-blocks"><div class="context-block message">${state.message ?? 'Could not load'}</div></div>`
    }
    const blocks = state.data.blocks
    const targetIndex = blocks.findIndex((entry) => entry.isTarget)
    const visible = direction === 'above'
      ? blocks.slice(Math.max(0, targetIndex - 2), targetIndex)
      : blocks.slice(targetIndex + 1, targetIndex + 3)
    if (targetIndex < 0 || visible.length === 0) {
      return html`<div class="context-blocks"><div class="context-block message">No ${direction} context</div></div>`
    }
    return html`
      <div class="context-blocks">
        ${visible.map((entry) => html`<div class="context-block">${entry.text}</div>`)}
      </div>
    `
  }

  private renderBlock(block: PinnedWireBlock): TemplateResult {
    const text = block.text.trim()
    const aboveOpen = this.expandedContextSlots.has(this.contextSlotKey(block, 'above'))
    const belowOpen = this.expandedContextSlots.has(this.contextSlotKey(block, 'below'))
    return html`
      <section
        class="pinned-block"
        data-wire-pinned-block
        data-pinned-block-id=${block.id}
        style="left:${block.x}px;top:${block.y}px;z-index:${this.cardZIndex(block.id)};"
        role="dialog"
        aria-modal="false"
        aria-label=${`Pinned block: ${block.documentTitle}`}
        @pointerdown=${() => this.bringToFront(block.id)}
      >
        <button
          type="button"
          class="close"
          data-wire-pinned-block-close
          aria-label="Close pinned block"
          @click=${() => this.closeBlock(block)}
        >x</button>
        <div
          class="titlebar"
          data-wire-pinned-block-drag
          @pointerdown=${(event: PointerEvent) => this.onBlockTitlePointerDown(event, block)}
          @pointermove=${(event: PointerEvent) => this.onBlockTitlePointerMove(event, block)}
          @pointerup=${(event: PointerEvent) => this.onTitlePointerUp(event)}
          @pointercancel=${(event: PointerEvent) => this.onTitlePointerUp(event)}
        >
          <button
            type="button"
            class="block-doc-label"
            data-wire-pinned-block-title
            title=${block.documentTitle}
            @click=${() => this.openBlock(block)}
          >${block.documentTitle}</button>
        </div>
        ${aboveOpen ? this.renderContextBlocks(block, 'above') : nothing}
        <div class="block-body" data-wire-pinned-block-body>
          ${text ? text : html`<span class="block-placeholder">Empty block</span>`}
        </div>
        <div class="context-row">
          <button
            type="button"
            class="context-button ${aboveOpen ? 'active' : ''}"
            data-wire-pinned-block-context-above
            aria-pressed=${aboveOpen ? 'true' : 'false'}
            @click=${() => this.toggleBlockContext(block, 'above')}
          >Above</button>
          <button
            type="button"
            class="context-button ${belowOpen ? 'active' : ''}"
            data-wire-pinned-block-context-below
            aria-pressed=${belowOpen ? 'true' : 'false'}
            @click=${() => this.toggleBlockContext(block, 'below')}
          >Below</button>
        </div>
        ${belowOpen ? this.renderContextBlocks(block, 'below') : nothing}
        <div class="actions">
          <button type="button" class="action" data-wire-pinned-block-refresh @click=${() => this.refreshBlock(block)}>Refresh</button>
          <button type="button" class="action" data-wire-pinned-block-wire @click=${(event: MouseEvent) => this.wireBlock(block, event)}>Wire</button>
          <button type="button" class="action" data-wire-pinned-block-open @click=${() => this.openBlock(block)}>Open</button>
        </div>
      </section>
    `
  }

  override render(): TemplateResult | typeof nothing {
    if (this.nodes.length === 0 && this.docs.length === 0 && this.blocks.length === 0) return nothing
    return html`
      <div class="pinned-layer" data-wire-pinned-layer>
        ${this.nodes.map((node) => this.renderWireNode(node))}
        ${this.docs.map((doc) => this.renderDoc(doc))}
        ${this.blocks.map((block) => this.renderBlock(block))}
      </div>
    `
  }
}

export interface WirePinnedLayerMountOptions {
  readonly nodes?: readonly PinnedWireNode[] | null
  readonly docs?: readonly PinnedWireDocument[] | null
  readonly blocks?: readonly PinnedWireBlock[] | null
  readonly blockContexts?: PinnedWireBlockContextMap | null
  readonly nodeContexts?: PinnedWireNodeContextMap | null
}

export function mountWirePinnedLayer(options: WirePinnedLayerMountOptions = {}): TemplateResult {
  return html`<sh-wire-pinned-layer
    .nodes=${options.nodes ?? []}
    .docs=${options.docs ?? []}
    .blocks=${options.blocks ?? []}
    .blockContexts=${options.blockContexts ?? null}
    .nodeContexts=${options.nodeContexts ?? null}
  ></sh-wire-pinned-layer>`
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-wire-pinned-layer': ShWirePinnedLayer
  }
}
