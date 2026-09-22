/**
 * mn-excalidraw-canvas - controlled scene canvas workbench.
 *
 * Garden's scene canvas owned the drawing runtime, artifact save/load,
 * projection, node linking, and wire sync. Shrubbery keeps this package as
 * chrome only: callers mount the real canvas in the named slot, provide the
 * current projection/selection status, and receive composed intents for all
 * host work.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'
import './mn-node-link-picker.js'
import type {
  MnNodeLinkCandidate,
  MnNodeLinkKind,
  MnNodeLinkPickDetail,
} from './mn-node-link-picker.js'

export type MnExcalidrawCanvasStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnSceneSaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type MnSceneOperationStatus = 'idle' | 'ready' | 'running' | 'success' | 'error'
export type MnSceneDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface MnSceneProjectionSummary {
  readonly anchors?: number
  readonly arrows?: number
  readonly wireCandidates?: number
  readonly text?: number
  readonly frames?: number
  readonly diagnostics?: number
  readonly searchText?: string | null
}

export interface MnSceneDiagnostic {
  readonly id?: string
  readonly code: string
  readonly message: string
  readonly sceneElementId?: string | null
  readonly severity?: MnSceneDiagnosticSeverity
}

export interface MnSceneSelectedElement {
  readonly id: string
  readonly type?: string | null
  readonly label?: string | null
  readonly linkKind?: MnNodeLinkKind | null
  readonly linkTargetId?: string | null
  readonly linkTitle?: string | null
  readonly predicate?: string | null
  readonly canRecreateTarget?: boolean
  readonly canRemoveLink?: boolean
  readonly canLink?: boolean
  readonly canOpenLink?: boolean
}

export interface MnSceneWireSummary {
  readonly missing?: number
  readonly hydratable?: number
  readonly hydrated?: number
  readonly created?: number
  readonly skipped?: number
  readonly lastMessage?: string | null
}

export interface MnScenePredicateOption {
  readonly value: string
  readonly label: string
}

export interface MnSceneCanvasIntentDetail {
  readonly graphId: string | null
  readonly artifactId: string | null
}

export interface MnSceneElementIntentDetail extends MnSceneCanvasIntentDetail {
  readonly elementId: string | null
}

export interface MnScenePredicateChangeDetail extends MnSceneElementIntentDetail {
  readonly predicate: string
}

export interface MnSceneNodeLinkPickDetail extends MnSceneElementIntentDetail {
  readonly kind: MnNodeLinkKind
  readonly id: string
  readonly title: string
  readonly mimeType?: string
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function count(value: number | null | undefined): string {
  return String(value ?? 0)
}

function statusText(status: MnSceneOperationStatus | MnSceneSaveStatus): string {
  switch (status) {
    case 'saving':
      return 'saving'
    case 'saved':
      return 'saved'
    case 'running':
      return 'running'
    case 'success':
      return 'done'
    case 'error':
      return 'error'
    case 'ready':
      return 'ready'
    case 'idle':
    default:
      return 'idle'
  }
}

function diagnosticSeverity(item: MnSceneDiagnostic): MnSceneDiagnosticSeverity {
  return item.severity ?? (item.code.includes('missing') ? 'error' : 'warning')
}

@customElement('mn-excalidraw-canvas')
export class MnExcalidrawCanvas extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      height: 100%;
      min-height: 320px;
      min-width: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .shell {
      display: flex;
      height: 100%;
      min-height: inherit;
      min-width: 0;
      flex-direction: column;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
    }

    .toolbar {
      display: flex;
      min-height: 48px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
    }

    .title-wrap {
      display: flex;
      min-width: 150px;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
    }

    .title-row,
    .meta-row {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    .title {
      margin: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-base, 14px);
      font-weight: 650;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status {
      display: inline-flex;
      min-height: 22px;
      flex: 0 0 auto;
      align-items: center;
      gap: 5px;
      padding: 0 7px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      box-sizing: border-box;
    }

    .status.ready,
    .status.saved,
    .status.success {
      border-color: var(--mn-color-success-border, #86efac);
      background: var(--mn-color-success-surface, #f0fdf4);
      color: var(--mn-color-success-text, #166534);
    }

    .status.loading,
    .status.running,
    .status.saving {
      border-color: var(--mn-color-accent-border, #bfdbfe);
      background: var(--mn-color-accent-surface, #eff6ff);
      color: var(--mn-color-accent-text, #1d4ed8);
    }

    .status.error {
      border-color: var(--mn-color-danger-border, #fecaca);
      background: var(--mn-color-danger-surface, #fef2f2);
      color: var(--mn-color-danger-text, #991b1b);
    }

    .actions {
      display: flex;
      min-width: 0;
      flex: 0 1 auto;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-1, 4px);
      flex-wrap: wrap;
    }

    button,
    select {
      font: inherit;
    }

    .action {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 9px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      box-sizing: border-box;
      white-space: nowrap;
    }

    .action:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .action:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .primary {
      border-color: var(--mn-color-accent-solid, #2563eb);
      background: var(--mn-color-accent-solid, #2563eb);
      color: var(--mn-color-on-accent, #fff);
    }

    .danger {
      color: var(--mn-color-danger-text, #991b1b);
    }

    .workbench {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 330px);
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background:
        linear-gradient(90deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
        linear-gradient(180deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px),
        var(--mn-color-canvas-bg, #f8fafc);
      background-size: 24px 24px;
    }

    .canvas-host {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
      min-width: 0;
      min-height: 0;
    }

    .canvas-slot {
      display: contents;
    }

    .preview,
    .state-wrap {
      position: absolute;
      inset: var(--mn-space-4, 16px);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .preview img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-md, 0 10px 28px rgba(15, 23, 42, 0.14));
    }

    .placeholder {
      width: min(380px, 92%);
      padding: var(--mn-space-5, 20px);
      border: 1px dashed var(--mn-color-border-default, #cbd5e1);
      border-radius: var(--mn-radius-lg, 8px);
      background: color-mix(in srgb, var(--mn-color-surface-base, #fff) 88%, transparent);
      color: var(--mn-color-text-secondary, #475569);
      text-align: center;
      box-sizing: border-box;
    }

    .placeholder-icon {
      display: inline-flex;
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .placeholder-title {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
    }

    .placeholder-text {
      margin: 6px 0 0;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    .side {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      overflow: auto;
      background: var(--mn-color-surface-base, #fff);
    }

    .panel {
      padding: var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mn-space-2, 8px);
    }

    .metric {
      min-width: 0;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .metric-value {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-lg, 18px);
      font-weight: 700;
      line-height: 1.1;
    }

    .metric-label {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      min-height: 28px;
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
    }

    .row strong {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inline-actions {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      flex-wrap: wrap;
      margin-top: var(--mn-space-2, 8px);
    }

    .predicate {
      width: 100%;
      min-height: 30px;
      margin-top: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-sizing: border-box;
    }

    .diagnostics {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
    }

    .diagnostic {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--mn-space-2, 8px);
      align-items: flex-start;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .diagnostic.error {
      border-color: var(--mn-color-danger-border, #fecaca);
      background: var(--mn-color-danger-surface, #fef2f2);
    }

    .diagnostic.warning {
      border-color: var(--mn-color-warning-border, #fde68a);
      background: var(--mn-color-warning-surface, #fffbeb);
    }

    .diagnostic-code {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
    }

    .empty-note {
      margin: 0;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    @media (max-width: 820px) {
      .toolbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .actions {
        justify-content: flex-start;
      }

      .workbench {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(280px, 1fr) auto;
      }

      .stage {
        border-right: 0;
        border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      }
    }
  `

  @property({ type: String }) graphId = ''
  @property({ type: String }) artifactId = ''
  @property({ type: String }) title = 'Drawing'
  @property({ type: String }) status: MnExcalidrawCanvasStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: String }) previewUrl = ''
  @property({ type: String, attribute: 'save-status' }) saveStatus: MnSceneSaveStatus = 'idle'
  @property({ type: String, attribute: 'projection-status' }) projectionStatus: MnSceneOperationStatus = 'idle'
  @property({ type: String, attribute: 'sync-status' }) syncStatus: MnSceneOperationStatus = 'idle'
  @property({ type: String, attribute: 'hydrate-status' }) hydrateStatus: MnSceneOperationStatus = 'idle'
  @property({ type: String, attribute: 'live-message' }) liveMessage = ''
  @property({ type: Boolean, reflect: true, attribute: 'node-link-picker-open' }) nodeLinkPickerOpen = false
  @property({ attribute: false }) projection: MnSceneProjectionSummary | null = null
  @property({ attribute: false }) diagnostics: readonly MnSceneDiagnostic[] = []
  @property({ attribute: false }) selectedElement: MnSceneSelectedElement | null = null
  @property({ attribute: false }) wireSummary: MnSceneWireSummary | null = null
  @property({ attribute: false }) predicateOptions: readonly MnScenePredicateOption[] = []
  @property({ attribute: false }) linkCandidates: readonly MnNodeLinkCandidate[] = []

  @state() private hasCanvasSlot = false

  private intent(): MnSceneCanvasIntentDetail {
    return {
      graphId: trimmed(this.graphId) || null,
      artifactId: trimmed(this.artifactId) || null,
    }
  }

  private elementIntent(): MnSceneElementIntentDetail {
    return {
      ...this.intent(),
      elementId: this.selectedElement?.id ?? null,
    }
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private emitCanvas(type: string): void {
    this.emit<MnSceneCanvasIntentDetail>(type, this.intent())
  }

  private emitElement(type: string): void {
    this.emit<MnSceneElementIntentDetail>(type, this.elementIntent())
  }

  private changePredicate(predicate: string): void {
    this.emit<MnScenePredicateChangeDetail>('mn-excalidraw-predicate-change', {
      ...this.elementIntent(),
      predicate,
    })
  }

  private onCanvasSlotChange(event: Event): void {
    const slot = event.currentTarget as HTMLSlotElement
    this.hasCanvasSlot = slot.assignedElements({ flatten: true }).length > 0
  }

  private onNodeLinkPick(event: CustomEvent<MnNodeLinkPickDetail>): void {
    const detail = event.detail
    if (!detail?.id) return
    this.emit<MnSceneNodeLinkPickDetail>('mn-excalidraw-node-link-pick', {
      ...this.elementIntent(),
      kind: detail.kind,
      id: detail.id,
      title: detail.title,
      mimeType: detail.mimeType,
    })
  }

  private onNodeLinkClose(): void {
    this.emit<MnSceneElementIntentDetail>('mn-excalidraw-node-link-picker-close', this.elementIntent())
  }

  private get ready(): boolean {
    return this.status === 'ready'
  }

  private get liveText(): string {
    if (trimmed(this.liveMessage)) return this.liveMessage
    if (this.status === 'loading') return 'Scene canvas loading'
    if (this.status === 'error') return `Scene canvas failed${this.error ? `: ${this.error}` : ''}`
    if (this.syncStatus === 'running') return 'Syncing scene wires'
    if (this.hydrateStatus === 'running') return 'Hydrating scene wires'
    if (this.saveStatus === 'saving') return 'Saving scene version'
    return this.ready ? 'Scene canvas ready' : 'Scene canvas idle'
  }

  private renderStatus(label: string, status: MnSceneOperationStatus | MnSceneSaveStatus | MnExcalidrawCanvasStatus): TemplateResult {
    return html`
      <span class=${`status ${status}`} data-status=${label}>
        ${icon(status === 'error' ? 'alert-circle' : status === 'idle' ? 'circle' : status === 'loading' || status === 'running' || status === 'saving' ? 'refresh' : 'check', { size: 13 })}
        ${label}: ${status === 'loading' ? 'loading' : statusText(status as MnSceneOperationStatus | MnSceneSaveStatus)}
      </span>
    `
  }

  private renderStage(): TemplateResult {
    if (this.status === 'loading') {
      return html`<div class="state-wrap"><mn-loading size="sm" text="Loading scene canvas"></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`
        <div class="state-wrap">
          <mn-empty-state
            icon="alert-circle"
            title="Scene canvas failed"
            description=${this.error || 'The drawing surface could not be prepared.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    if (!this.hasCanvasSlot && trimmed(this.previewUrl)) {
      return html`
        <div class="preview">
          <img src=${this.previewUrl} alt=${`${trimmed(this.title) || 'Scene'} preview`} />
        </div>
      `
    }
    if (!this.hasCanvasSlot) {
      return html`
        <div class="state-wrap">
          <div class="placeholder">
            <span class="placeholder-icon" aria-hidden="true">${icon('graph', { size: 20 })}</span>
            <p class="placeholder-title">Scene host slot</p>
            <p class="placeholder-text">
              The host owns the interactive drawing runtime. Slot it with name "canvas" to fill this workbench.
            </p>
          </div>
        </div>
      `
    }
    return html``
  }

  private renderProjection(): TemplateResult {
    const projection = this.projection
    return html`
      <section class="panel" aria-label="Scene projection">
        <h3 class="panel-title">${icon('graph', { size: 15 })} Projection</h3>
        <div class="metric-grid">
          <span class="metric"><span class="metric-value">${count(projection?.anchors)}</span><span class="metric-label">anchors</span></span>
          <span class="metric"><span class="metric-value">${count(projection?.arrows)}</span><span class="metric-label">arrows</span></span>
          <span class="metric"><span class="metric-value">${count(projection?.wireCandidates)}</span><span class="metric-label">wire candidates</span></span>
          <span class="metric"><span class="metric-value">${count(projection?.diagnostics ?? this.diagnostics.length)}</span><span class="metric-label">diagnostics</span></span>
        </div>
        ${trimmed(projection?.searchText)
          ? html`<div class="row"><span>Search text</span><strong title=${projection!.searchText!}>${projection!.searchText}</strong></div>`
          : nothing}
      </section>
    `
  }

  private renderWireSummary(): TemplateResult {
    const wires = this.wireSummary
    return html`
      <section class="panel" aria-label="Scene wires">
        <h3 class="panel-title">${icon('git-branch', { size: 15 })} Wires</h3>
        <div class="row"><span>Unsynced candidates</span><strong>${count(wires?.missing)}</strong></div>
        <div class="row"><span>Hydratable wires</span><strong>${count(wires?.hydratable)}</strong></div>
        <div class="row"><span>Created</span><strong>${count(wires?.created)}</strong></div>
        <div class="row"><span>Hydrated</span><strong>${count(wires?.hydrated)}</strong></div>
        ${trimmed(wires?.lastMessage)
          ? html`<div class="row"><span>Last result</span><strong title=${wires!.lastMessage!}>${wires!.lastMessage}</strong></div>`
          : nothing}
      </section>
    `
  }

  private renderSelectedElement(): TemplateResult {
    const selected = this.selectedElement
    if (!selected) {
      return html`
        <section class="panel" aria-label="Selected scene element">
          <h3 class="panel-title">${icon('panel-left', { size: 15 })} Selection</h3>
          <p class="empty-note">Select one scene element to link it, inspect its target, or edit its wire predicate.</p>
        </section>
      `
    }
    const canLink = selected.canLink !== false
    const canRemove = selected.canRemoveLink ?? !!selected.linkTargetId
    const canOpen = selected.canOpenLink ?? !!selected.linkTargetId
    const canRecreate = !!selected.canRecreateTarget
    const currentPredicate = trimmed(selected.predicate)
    const hasPredicate = currentPredicate && !this.predicateOptions.some(option => option.value === currentPredicate)
    return html`
      <section class="panel" aria-label="Selected scene element" data-selected-element-id=${selected.id}>
        <h3 class="panel-title">${icon('panel-left', { size: 15 })} Selection</h3>
        <div class="row"><span>Element</span><strong title=${selected.id}>${selected.label || selected.id}</strong></div>
        ${trimmed(selected.type) ? html`<div class="row"><span>Type</span><strong>${selected.type}</strong></div>` : nothing}
        ${trimmed(selected.linkTargetId)
          ? html`
              <div class="row"><span>Linked ${selected.linkKind ?? 'node'}</span><strong title=${selected.linkTargetId!}>${selected.linkTitle || selected.linkTargetId}</strong></div>
            `
          : html`<div class="row"><span>Linked node</span><strong>none</strong></div>`}
        ${this.predicateOptions.length || currentPredicate
          ? html`
              <select
                class="predicate"
                aria-label="Wire predicate"
                .value=${currentPredicate}
                @change=${(event: Event) => this.changePredicate((event.currentTarget as HTMLSelectElement).value)}
              >
                ${hasPredicate ? html`<option value=${currentPredicate}>${currentPredicate}</option>` : nothing}
                ${this.predicateOptions.map(option => html`<option value=${option.value}>${option.label}</option>`)}
              </select>
            `
          : nothing}
        <div class="inline-actions">
          <button type="button" class="action" data-action="link-selected" ?disabled=${!this.ready || !canLink} @click=${() => this.emitElement('mn-excalidraw-link-selected')}>
            ${icon('link', { size: 14 })} ${selected.linkTargetId ? 'Relink' : 'Link'}
          </button>
          <button type="button" class="action" data-action="open-selected-link" ?disabled=${!canOpen} @click=${() => this.emitElement('mn-excalidraw-open-selected-link')}>
            ${icon('external-link', { size: 14 })} Open
          </button>
          <button type="button" class="action" data-action="recreate-target" ?disabled=${!canRecreate} @click=${() => this.emitElement('mn-excalidraw-recreate-target')}>
            ${icon('file-text', { size: 14 })} Recreate
          </button>
          <button type="button" class="action danger" data-action="remove-link" ?disabled=${!canRemove} @click=${() => this.emitElement('mn-excalidraw-remove-selected-link')}>
            ${icon('trash', { size: 14 })} Unlink
          </button>
        </div>
      </section>
    `
  }

  private renderDiagnostics(): TemplateResult {
    const items = this.diagnostics.slice(0, 6)
    return html`
      <section class="panel" aria-label="Scene diagnostics">
        <h3 class="panel-title">${icon('alert-triangle', { size: 15 })} Diagnostics</h3>
        ${items.length === 0
          ? html`<p class="empty-note">No scene diagnostics.</p>`
          : html`
              <div class="diagnostics">
                ${items.map(item => {
                  const severity = diagnosticSeverity(item)
                  return html`
                    <div class=${`diagnostic ${severity}`} data-diagnostic-code=${item.code}>
                      <span aria-hidden="true">${icon(severity === 'error' ? 'alert-circle' : severity === 'info' ? 'info' : 'warning', { size: 14 })}</span>
                      <span>
                        <span class="diagnostic-code">${item.code}</span>
                        ${item.message}
                      </span>
                    </div>
                  `
                })}
              </div>
            `}
      </section>
    `
  }

  render(): TemplateResult {
    const title = trimmed(this.title) || 'Drawing'
    const canOperate = this.ready && trimmed(this.graphId) !== '' && trimmed(this.artifactId) !== ''
    const canSync = canOperate && (this.wireSummary?.missing ?? 0) > 0
    const canHydrate = canOperate && (this.wireSummary?.hydratable ?? 0) > 0
    const canLinkSelected = canOperate && !!this.selectedElement && this.selectedElement.canLink !== false
    return html`
      <section class="shell" aria-label=${`Scene canvas ${title}`}>
        <div class="toolbar">
          <div class="title-wrap">
            <div class="title-row">
              <h2 class="title">${title}</h2>
              ${this.renderStatus('canvas', this.status)}
            </div>
            <div class="meta-row">
              <span class="meta">${trimmed(this.graphId) || 'No graph'} / ${trimmed(this.artifactId) || 'No artifact'}</span>
            </div>
          </div>
          <div class="actions">
            ${this.renderStatus('save', this.saveStatus)}
            <button type="button" class="action" data-action="reload" ?disabled=${!trimmed(this.artifactId)} @click=${() => this.emitCanvas('mn-excalidraw-reload')} title="Reload scene">
              ${icon('refresh', { size: 14 })} Reload
            </button>
            <button type="button" class="action" data-action="refresh-projection" ?disabled=${!canOperate} @click=${() => this.emitCanvas('mn-excalidraw-refresh-projection')} title="Refresh scene projection">
              ${icon('graph', { size: 14 })} Project
            </button>
            <button type="button" class="action" data-action="refresh-link-titles" ?disabled=${!canOperate} @click=${() => this.emitCanvas('mn-excalidraw-refresh-link-titles')} title="Refresh linked node titles">
              ${icon('refresh-cw', { size: 14 })} Links
            </button>
            <button type="button" class="action" data-action="sync-wires" ?disabled=${!canSync || this.syncStatus === 'running'} @click=${() => this.emitCanvas('mn-excalidraw-sync-wires')} title="Create graph wires from scene arrows">
              ${icon('git-branch', { size: 14 })} ${this.syncStatus === 'running' ? 'Syncing' : 'Sync'}
            </button>
            <button type="button" class="action" data-action="hydrate-wires" ?disabled=${!canHydrate || this.hydrateStatus === 'running'} @click=${() => this.emitCanvas('mn-excalidraw-hydrate-wires')} title="Add graph wires to the scene">
              ${icon('download', { size: 14 })} ${this.hydrateStatus === 'running' ? 'Hydrating' : 'Hydrate'}
            </button>
            <button type="button" class="action" data-action="link-selected-toolbar" ?disabled=${!canLinkSelected} @click=${() => this.emitElement('mn-excalidraw-link-selected')} title="Link selected element">
              ${icon('link', { size: 14 })} Link
            </button>
            <button type="button" class="action primary" data-action="save" ?disabled=${!canOperate || this.saveStatus === 'saving'} @click=${() => this.emitCanvas('mn-excalidraw-save')} title="Save scene version">
              ${icon('save', { size: 14 })} ${this.saveStatus === 'saving' ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>

        <div class="workbench">
          <div class="stage" data-scene-stage>
            <div class="canvas-host">
              <slot class="canvas-slot" name="canvas" @slotchange=${this.onCanvasSlotChange}></slot>
              ${this.renderStage()}
            </div>
          </div>
          <aside class="side" aria-label="Scene details">
            ${this.renderProjection()}
            ${this.renderWireSummary()}
            ${this.renderSelectedElement()}
            ${this.renderDiagnostics()}
          </aside>
        </div>
        <span aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;">${this.liveText}</span>
        ${this.nodeLinkPickerOpen
          ? html`
              <mn-node-link-picker
                open
                .candidates=${this.linkCandidates}
                @mn-node-link-pick=${this.onNodeLinkPick}
                @mn-close=${this.onNodeLinkClose}
              ></mn-node-link-picker>
            `
          : nothing}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-excalidraw-canvas': MnExcalidrawCanvas
  }
}
