/**
 * mn-graph-panel - controlled Garden workspace/document graph surface.
 *
 * The scene preserves Garden's paper-craft 3-D behavior while the boundary is
 * Shrubbery-native: callers project both view models, own selection/navigation,
 * and persist the active mode. The panel owns only header chrome and delegates
 * ephemeral GPU interaction to mn-graph-three. No stores or backend calls.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import type {
  MnGraphThreeEdge,
  MnGraphThreeNode,
  MnGraphThreeNodeKind,
  MnGraphThreeViewMode,
} from './mn-graph-three.js'
import './mn-empty-state.js'
import './mn-graph-three.js'
import './mn-loading.js'

export type MnGraphPanelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnGraphPanelNodeKind = MnGraphThreeNodeKind

export interface MnGraphPanelNode extends MnGraphThreeNode {
  readonly kind?: MnGraphPanelNodeKind
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly artifactId?: string | null
  readonly folderId?: string | null
  readonly tagName?: string | null
  readonly section?: 'documents' | 'artifacts' | 'tags' | string | null
  readonly parentId?: string | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  readonly status?: string | null
  readonly ingestedDocumentId?: string | null
}

export interface MnGraphPanelEdge extends MnGraphThreeEdge {
  readonly note?: string
}

export interface MnGraphPanelRefreshDetail {
  readonly reason: 'manual'
}

export interface MnGraphPanelNodeOpenDetail {
  readonly id: string
  readonly node: MnGraphPanelNode
}

export interface MnGraphPanelNodeSelectDetail {
  readonly id: string
  readonly node: MnGraphPanelNode
}

export interface MnGraphPanelEdgeSelectDetail {
  readonly edge: MnGraphPanelEdge
}

export interface MnGraphPanelViewModeChangeDetail {
  readonly mode: MnGraphThreeViewMode
}

@customElement('mn-graph-panel')
export class MnGraphPanel extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
      box-sizing: border-box;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      min-height: 48px;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.92));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .title-wrap {
      min-width: 0;
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin: 0;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 700;
      line-height: 1.2;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .subtitle {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      flex: 0 0 auto;
    }

    .count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--mn-color-surface-accent, #eef2ff);
      color: var(--mn-color-text-accent, #1d4ed8);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      box-sizing: border-box;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      box-sizing: border-box;
    }

    .text-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font: 700 var(--mn-text-xs, 12px)/1 var(--mn-font-chrome, system-ui, sans-serif);
      cursor: pointer;
      box-sizing: border-box;
    }

    .icon-button:hover,
    .text-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      box-sizing: border-box;
      background: #2a3328;
    }

    .state {
      min-height: 180px;
      display: grid;
      align-content: center;
    }

    mn-graph-three {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 0;
    }

    :host([data-skin='emporium']) .icon-button,
    :host([data-skin='emporium']) .text-button {
      border-radius: var(--mn-radius-control, 4px);
    }

    @media (max-width: 460px) {
      .header {
        align-items: flex-start;
      }

      .count,
      .center-label {
        display: none;
      }
    }
  `

  @property({ type: String }) title = 'Workspace Graph'
  @property({ type: String }) subtitle = ''
  @property({ type: String }) status: MnGraphPanelStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ attribute: false }) nodes: readonly MnGraphPanelNode[] = []
  @property({ attribute: false }) edges: readonly MnGraphPanelEdge[] = []
  @property({ attribute: false }) documentNodes: readonly MnGraphPanelNode[] = []
  @property({ attribute: false }) documentEdges: readonly MnGraphPanelEdge[] = []
  @property({ type: String, attribute: 'view-mode', reflect: true }) viewMode: MnGraphThreeViewMode = 'workspace'
  @property({ type: Boolean, attribute: 'lock-workspace-mode' }) lockWorkspaceMode = false
  @property({ type: String, attribute: 'selected-node-id' }) selectedNodeId = ''
  @property({ type: Boolean, attribute: 'can-navigate-back' }) canNavigateBack = false
  @property({ type: Boolean, attribute: 'can-navigate-forward' }) canNavigateForward = false

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _refresh(): void {
    this._emit<MnGraphPanelRefreshDetail>('mn-graph-panel-refresh', { reason: 'manual' })
  }

  private _selectNode(node: MnGraphPanelNode): void {
    this._emit<MnGraphPanelNodeSelectDetail>('mn-graph-panel-node-select', { id: node.id, node })
  }

  private _openNode(node: MnGraphPanelNode): void {
    this._emit<MnGraphPanelNodeOpenDetail>('mn-graph-panel-node-open', { id: node.id, node })
  }

  private _selectEdge(edge: MnGraphPanelEdge): void {
    this._emit<MnGraphPanelEdgeSelectDetail>('mn-graph-panel-edge-select', { edge })
  }

  private _setViewMode(mode: MnGraphThreeViewMode): void {
    if (this.lockWorkspaceMode || mode === this.viewMode) return
    this._emit<MnGraphPanelViewModeChangeDetail>('mn-graph-panel-view-mode-change', { mode })
  }

  private _navigateBack(): void {
    if (!this.canNavigateBack) return
    this.dispatchEvent(new CustomEvent('mn-graph-panel-navigate-back', { bubbles: true, composed: true }))
  }

  private _navigateForward(): void {
    if (!this.canNavigateForward) return
    this.dispatchEvent(new CustomEvent('mn-graph-panel-navigate-forward', { bubbles: true, composed: true }))
  }

  private _center(): void {
    this.shadowRoot?.querySelector<HTMLElement & { recenter?: () => void }>('mn-graph-three')?.recenter?.()
  }

  private _activeNodes(): readonly MnGraphPanelNode[] {
    return this.viewMode === 'document' ? this.documentNodes : this.nodes
  }

  private _activeEdges(): readonly MnGraphPanelEdge[] {
    return this.viewMode === 'document' ? this.documentEdges : this.edges
  }

  private _renderBody(): TemplateResult | typeof nothing {
    if (this.status === 'idle' || this.status === 'loading') {
      return html`<div class="state"><mn-loading size="sm" text="Loading graph"></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`
        <div class="state">
          <mn-empty-state
            icon="alert-circle"
            title="Could not load graph"
            description=${this.error || 'The graph projection read failed.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    const nodes = this._activeNodes()
    const edges = this._activeEdges()
    if (nodes.length === 0) {
      const documentMode = this.viewMode === 'document'
      return html`
        <div class="state">
          <mn-empty-state
            icon=${documentMode ? 'file-text' : 'network'}
            title=${documentMode ? 'No document open' : 'Your space awaits'}
            description=${documentMode
              ? 'Open a document in the editor to visualize its structure.'
              : 'Create a document to see your ideas take shape in three dimensions.'}
          ></mn-empty-state>
        </div>
      `
    }
    return html`
      <mn-graph-three
        .nodes=${nodes}
        .edges=${edges}
        .viewMode=${this.viewMode}
        .selectedNodeId=${this.selectedNodeId}
        dimension="3d"
        interactive
        animated
        hint=${this.subtitle || this.title}
        @mn-graph-node-select=${(event: CustomEvent<MnGraphPanelNode>) => this._selectNode(event.detail)}
        @mn-graph-node-activate=${(event: CustomEvent<MnGraphPanelNode>) => this._openNode(event.detail)}
        @mn-graph-edge-select=${(event: CustomEvent<MnGraphPanelEdge>) => this._selectEdge(event.detail)}
      ></mn-graph-three>
    `
  }

  render(): TemplateResult {
    const nodeCount = this._activeNodes().length
    const edgeCount = this._activeEdges().length
    const documentMode = this.viewMode === 'document'
    const title = documentMode ? 'Document Structure' : this.title || 'Knowledge Space'
    const itemLabel = documentMode ? 'block' : 'item'
    const subtitle = this.subtitle || `${nodeCount} ${itemLabel}${nodeCount === 1 ? '' : 's'} / ${edgeCount} connection${edgeCount === 1 ? '' : 's'}`
    return html`
      <header class="header">
        <span class="title-wrap">
          <h2 class="title">${icon(documentMode ? 'file-text' : 'network', { size: 15 })}${title}</h2>
          <span class="subtitle">${subtitle}</span>
        </span>
        <span class="actions">
          <button
            type="button"
            class="icon-button"
            title="Back"
            aria-label="Back to previous node"
            ?disabled=${!this.canNavigateBack}
            @click=${this._navigateBack}
          >
            ${icon('chevron-left', { size: 15 })}
          </button>
          <button
            type="button"
            class="icon-button"
            title="Forward"
            aria-label="Forward to next node"
            ?disabled=${!this.canNavigateForward}
            @click=${this._navigateForward}
          >
            ${icon('chevron-right', { size: 15 })}
          </button>
          <span class="count" title="Graph nodes">${nodeCount}</span>
          <button
            type="button"
            class="text-button"
            title="Center graph view"
            aria-label="Center graph view"
            @click=${this._center}
          >${icon('target', { size: 14 })}<span class="center-label">Center</span></button>
          ${!this.lockWorkspaceMode && (this.documentNodes.length > 0 || documentMode)
            ? html`<button
                type="button"
                class="text-button"
                title=${documentMode ? 'Show the whole workspace' : 'Show this document'}
                aria-label=${documentMode ? 'Show the whole workspace' : 'Show this document'}
                @click=${() => this._setViewMode(documentMode ? 'workspace' : 'document')}
              >${documentMode ? 'Whole Workspace' : 'This Document'}</button>`
            : nothing}
          <button
            type="button"
            class="icon-button"
            title="Refresh graph"
            aria-label="Refresh graph"
            @click=${this._refresh}
          >
            ${icon('refresh', { size: 15 })}
          </button>
        </span>
      </header>
      <div class="body">${this._renderBody()}</div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-graph-panel': MnGraphPanel
  }
}
