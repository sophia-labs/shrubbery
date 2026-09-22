/**
 * wf-studio-shell - controlled Choreograph Studio screen router.
 *
 * Garden's shell owns session stores and workflow clients. The Shrubbery lift is
 * only the app surface: callers choose the screen, provide run data, and receive
 * navigation intents. It registers the existing choreograph app leaf without
 * importing any Garden runtime effects.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'
import './wf-choreograph-view.js'
import type {
  WfChoreographStatus,
  WfRunDetail,
  WfRunListItem,
  WfRunProvenance,
  WfTelemetryRun,
} from './wf-choreograph-view.js'

export type WfStudioScreen = 'home' | 'runs' | 'run' | 'launch' | 'anatomy' | 'gates' | 'compare' | string

export interface WfStudioScreenChangeDetail {
  readonly screen: string
  readonly runId?: string
  readonly graphId?: string | null
}

export interface WfStudioGraphDetail {
  readonly graphId: string | null
}

/** Shared loading posture for host-owned Studio data. */
export type WfStudioDataStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error'

/** Registry metadata returned by Choreograph's `GET /api/workflows`. */
export interface WfWorkflowDefinition {
  readonly name: string
  readonly description?: string | null
  readonly whenToUse?: string | null
  readonly phases?: readonly WfWorkflowPhaseSummary[]
}

export interface WfWorkflowPhaseSummary {
  readonly title: string
  readonly detail?: string | null
}

/** Body-shaped launch intent. The host owns authentication and transport. */
export interface WfWorkflowLaunchDetail {
  readonly graphId: string
  readonly workflowName: string
  readonly inputs: Readonly<Record<string, unknown>>
}

/** A node in a compiled/minted workflow definition. */
export interface WfWorkflowNodeDefinition {
  readonly id: string
  readonly label?: string | null
  readonly agentType?: string | null
  readonly model?: string | null
  readonly toolMode?: 'dynamic' | 'curated' | 'none' | string | null
  readonly maxTurns?: number | null
  readonly gateIds?: readonly string[]
}

export interface WfWorkflowPhaseDefinition extends WfWorkflowPhaseSummary {
  readonly index: number
  readonly nodes?: readonly WfWorkflowNodeDefinition[]
}

/** Full host-projected anatomy; unlike registry summaries this may include nodes. */
export interface WfWorkflowAnatomy {
  readonly name: string
  readonly description?: string | null
  readonly phases: readonly WfWorkflowPhaseDefinition[]
}

export interface WfWorkflowRequestDetail {
  readonly graphId: string | null
  readonly workflowName: string
}

export type WfGateKind = 'capability' | 'tool' | 'ward' | string

/** A declared crossing point or constraint, projected by the host. */
export interface WfWorkflowGate {
  readonly id: string
  readonly name: string
  readonly kind: WfGateKind
  readonly description?: string | null
  readonly binding?: string | null
  readonly access?: string | null
  readonly enabled: boolean
  readonly required?: boolean
  readonly status?: string | null
}

export interface WfGateChangeDetail extends WfWorkflowRequestDetail {
  readonly gateId: string
  readonly enabled: boolean
}

export interface WfRunCompareDetail {
  readonly graphId: string | null
  readonly leftRunId: string
  readonly rightRunId: string
}

export type WfComparisonVerdict = 'same' | 'changed' | 'better' | 'worse' | string

export interface WfRunComparisonField {
  readonly label: string
  readonly left: string | number | null
  readonly right: string | number | null
  readonly delta?: string | number | null
  readonly verdict?: WfComparisonVerdict | null
}

/** Deliberately generic: provenance and telemetry adapters can both project rows. */
export interface WfRunComparison {
  readonly leftRunId: string
  readonly rightRunId: string
  readonly fields: readonly WfRunComparisonField[]
}

const NAV: ReadonlyArray<{ screen: WfStudioScreen; label: string; iconName: string }> = [
  { screen: 'home', label: 'Home', iconName: 'history' },
  { screen: 'runs', label: 'Runs', iconName: 'database' },
  { screen: 'run', label: 'Monitor', iconName: 'graph' },
  { screen: 'launch', label: 'Launch', iconName: 'zap' },
  { screen: 'anatomy', label: 'Anatomy', iconName: 'layers' },
  { screen: 'gates', label: 'Gates', iconName: 'filter' },
  { screen: 'compare', label: 'Compare', iconName: 'git-branch' },
]

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function displayValue(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  return String(value)
}

@customElement('wf-studio-shell')
export class WfStudioShell extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .shell {
      display: flex;
      width: 100%;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
    }

    .chrome {
      display: flex;
      min-height: 54px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
    }

    .brand {
      display: inline-flex;
      width: 30px;
      height: 30px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-surface-raised, #fff);
      box-sizing: border-box;
    }

    .title-wrap {
      min-width: 9rem;
      flex: 0 1 16rem;
    }

    .title {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .subtitle {
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nav {
      display: inline-flex;
      min-width: 0;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      overflow-x: auto;
    }

    .nav-button {
      display: inline-flex;
      min-height: 30px;
      flex: 0 0 auto;
      align-items: center;
      gap: 5px;
      padding: 0 9px;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    .nav-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .nav-button[data-active='true'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
      font-weight: 700;
    }

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
    }

    wf-choreograph-view {
      width: 100%;
      height: 100%;
    }

    .state-centered {
      display: grid;
      height: 100%;
      min-height: 260px;
      align-content: center;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
      background:
        linear-gradient(180deg, rgba(37, 99, 235, 0.04), transparent 180px),
        var(--mn-color-surface-sunken, #f8fafc);
    }

    .studio-page {
      display: flex;
      height: 100%;
      min-height: 0;
      flex-direction: column;
      overflow: hidden;
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .page-head {
      display: flex;
      min-height: 54px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
      box-sizing: border-box;
    }

    .page-title-wrap {
      min-width: 0;
      flex: 1 1 auto;
    }

    .page-title {
      display: block;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 750;
    }

    .page-description {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .page-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
    }

    .panel {
      max-width: 980px;
      margin: 0 auto var(--mn-space-4, 16px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-base, #fff);
    }

    .page-stack {
      max-width: 980px;
      margin: 0 auto;
    }

    .page-stack > .panel {
      max-width: none;
    }

    .panel-head {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 10px 14px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, #f8fafc);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 750;
    }

    .panel-body {
      padding: 14px;
    }

    .field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mn-space-4, 16px);
    }

    .field {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 6px;
    }

    .field-wide {
      grid-column: 1 / -1;
    }

    .field-label {
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .field-hint,
    .workflow-copy,
    .node-copy {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
    }

    select,
    input,
    textarea,
    button {
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    select,
    input {
      min-height: 34px;
      padding: 0 9px;
    }

    textarea {
      min-height: 132px;
      padding: 9px;
      resize: vertical;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      line-height: 1.45;
    }

    select:focus,
    input:focus,
    textarea:focus,
    button:focus-visible {
      border-color: var(--mn-color-accent, #2563eb);
      outline: 2px solid color-mix(in srgb, var(--mn-color-accent, #2563eb) 24%, transparent);
      outline-offset: 1px;
    }

    button {
      display: inline-flex;
      min-height: 32px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 11px;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    button:disabled,
    select:disabled,
    input:disabled,
    textarea:disabled {
      cursor: default;
      opacity: 0.52;
    }

    .primary {
      border-color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-accent, #2563eb);
      color: #fff;
      font-weight: 700;
    }

    .primary:hover:not(:disabled) {
      filter: brightness(0.96);
      background: var(--mn-color-accent, #2563eb);
    }

    .form-actions,
    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    .form-actions {
      grid-column: 1 / -1;
      justify-content: flex-end;
      padding-top: 2px;
    }

    .toolbar {
      flex-wrap: wrap;
    }

    .validation,
    .notice {
      grid-column: 1 / -1;
      padding: 9px 11px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-secondary, #374151);
      background: var(--mn-color-panel-bg, #f8fafc);
      font-size: var(--mn-text-xs, 12px);
    }

    .validation {
      border-color: var(--mn-color-danger, #dc2626);
      color: var(--mn-color-danger, #dc2626);
      background: rgba(220, 38, 38, 0.06);
    }

    .notice[data-tone='success'] {
      border-color: var(--mn-color-success, #16a34a);
      color: var(--mn-color-success, #16a34a);
      background: rgba(22, 163, 74, 0.07);
    }

    .workflow-copy {
      margin-top: 12px;
      padding: 10px 12px;
      border-left: 3px solid var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .workflow-copy strong {
      display: block;
      margin-bottom: 3px;
      color: var(--mn-color-text-primary, #111827);
    }

    .phase-list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
    }

    .phase-card {
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-base, #fff);
    }

    .phase-head {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 10px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, #f8fafc);
    }

    .phase-index {
      display: inline-flex;
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eff6ff);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 10px;
      font-weight: 800;
    }

    .phase-name {
      min-width: 0;
      flex: 1 1 auto;
      font-weight: 700;
    }

    .node-table,
    .gate-table,
    .compare-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mn-text-xs, 12px);
    }

    th,
    td {
      padding: 9px 11px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      vertical-align: top;
      text-align: left;
    }

    th {
      color: var(--mn-color-text-tertiary, #6b7280);
      background: var(--mn-color-surface-base, #fff);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
    }

    tbody tr:last-child td {
      border-bottom: 0;
    }

    .mono {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }

    .pill {
      display: inline-flex;
      min-height: 21px;
      align-items: center;
      padding: 0 7px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #374151);
      background: var(--mn-color-panel-bg, #f8fafc);
      font-size: 10px;
      white-space: nowrap;
    }

    .gate-toggle {
      width: 16px;
      height: 16px;
      min-height: 0;
      margin: 1px 0 0;
      accent-color: var(--mn-color-accent, #2563eb);
    }

    .verdict[data-verdict='better'] {
      color: var(--mn-color-success, #16a34a);
    }

    .verdict[data-verdict='worse'] {
      color: var(--mn-color-danger, #dc2626);
    }

    .verdict[data-verdict='changed'] {
      color: var(--mn-color-warning, #b45309);
    }

    :host([data-skin='emporium']) .brand,
    :host([data-skin='emporium']) .nav-button {
      border-radius: var(--mn-radius-control, 4px);
    }

    @media (max-width: 720px) {
      .chrome {
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .title-wrap {
        flex: 1 1 calc(100% - 46px);
      }

      .nav {
        flex-basis: 100%;
      }

      .field-grid {
        grid-template-columns: minmax(0, 1fr);
      }

      .field-wide,
      .form-actions,
      .validation,
      .notice {
        grid-column: 1;
      }

      .page-body {
        padding: var(--mn-space-3, 12px);
      }
    }
  `

  @property({ type: String }) screen: WfStudioScreen = 'home'
  @property({ type: String }) graphId = ''
  @property({ type: String }) runId = ''
  @property({ type: String, attribute: 'history-status' }) historyStatus: WfChoreographStatus = 'idle'
  @property({ type: String, attribute: 'history-error' }) historyError = ''
  @property({ attribute: false }) historyRuns: readonly WfRunListItem[] = []
  @property({ type: String, attribute: 'monitor-status' }) monitorStatus: WfChoreographStatus = 'idle'
  @property({ type: String, attribute: 'monitor-error' }) monitorError = ''
  @property({ attribute: false }) provenance: WfRunProvenance | null = null
  @property({ attribute: false }) telemetry: WfTelemetryRun | null = null
  @property({ type: String }) liveMessage = ''

  /** Workflow registry + launch contract. */
  @property({ type: String, attribute: 'workflow-status' }) workflowStatus: WfStudioDataStatus = 'idle'
  @property({ type: String, attribute: 'workflow-error' }) workflowError = ''
  @property({ attribute: false }) workflows: readonly WfWorkflowDefinition[] = []
  @property({ type: String, attribute: 'selected-workflow' }) selectedWorkflowName = ''
  @property({ type: String, attribute: 'launch-inputs' }) launchInputs = '{}'
  @property({ type: Boolean, attribute: 'launch-pending' }) launchPending = false
  @property({ type: String, attribute: 'launch-error' }) launchError = ''
  @property({ type: String, attribute: 'launched-run-id' }) launchedRunId = ''

  /** Definition projection used by the anatomy screen. */
  @property({ type: String, attribute: 'anatomy-status' }) anatomyStatus: WfStudioDataStatus = 'idle'
  @property({ type: String, attribute: 'anatomy-error' }) anatomyError = ''
  @property({ attribute: false }) anatomy: WfWorkflowAnatomy | null = null

  /** Host-projected capability/tool/ward inventory. */
  @property({ type: String, attribute: 'gates-status' }) gatesStatus: WfStudioDataStatus = 'idle'
  @property({ type: String, attribute: 'gates-error' }) gatesError = ''
  @property({ attribute: false }) gates: readonly WfWorkflowGate[] = []

  /** Cross-run comparison projection. */
  @property({ type: String, attribute: 'compare-status' }) compareStatus: WfStudioDataStatus = 'idle'
  @property({ type: String, attribute: 'compare-error' }) compareError = ''
  @property({ type: String, attribute: 'compare-left-run-id' }) compareLeftRunId = ''
  @property({ type: String, attribute: 'compare-right-run-id' }) compareRightRunId = ''
  @property({ type: Boolean, attribute: 'compare-pending' }) comparePending = false
  @property({ attribute: false }) comparison: WfRunComparison | null = null

  @state() private _selectedRunId: string | null = null
  @state() private _localScreen: string | null = null
  @state() private _launchWorkflowName: string | null = null
  @state() private _launchGraphId: string | null = null
  @state() private _launchInputs: string | null = null
  @state() private _launchValidation = ''
  @state() private _anatomyWorkflowName: string | null = null
  @state() private _gatesWorkflowName: string | null = null
  @state() private _gateFilter = 'all'
  @state() private _compareLeftRunId: string | null = null
  @state() private _compareRightRunId: string | null = null
  @state() private _compareValidation = ''

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('screen')) {
      this._localScreen = null
      if (this.screen !== 'run') this._selectedRunId = null
    }
    if (changed.has('runId')) this._selectedRunId = null
    if (changed.has('selectedWorkflowName')) {
      this._launchWorkflowName = null
      this._anatomyWorkflowName = null
      this._gatesWorkflowName = null
    }
    if (changed.has('graphId')) this._launchGraphId = null
    if (changed.has('launchInputs')) this._launchInputs = null
    if (changed.has('compareLeftRunId')) this._compareLeftRunId = null
    if (changed.has('compareRightRunId')) this._compareRightRunId = null
  }

  private _graphId(): string | null {
    return trimmed(this.graphId) || null
  }

  private _screen(): string {
    return trimmed(this._localScreen) || trimmed(this.screen) || 'home'
  }

  private _activeRunId(): string {
    return trimmed(this._selectedRunId) || trimmed(this.runId) || trimmed(this.telemetry?.runId) || trimmed(this.provenance?.runId)
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _navigate(screen: string, runId = ''): void {
    this._localScreen = screen
    if (screen !== 'run') this._selectedRunId = null
    const detail: WfStudioScreenChangeDetail = {
      screen,
      graphId: this._graphId(),
      ...(runId ? { runId } : {}),
    }
    this._emit<WfStudioScreenChangeDetail>('choreo-screen-change', detail)
  }

  private _handleRunSelect(event: CustomEvent<WfRunDetail>): void {
    const runId = trimmed(event.detail?.runId)
    if (!runId) return
    this._selectedRunId = runId
    this._navigate('run', runId)
  }

  private _navButton(item: { screen: string; label: string; iconName: string }, active: string): TemplateResult {
    const isActive = active === item.screen || (active === 'home' && item.screen === 'runs')
    return html`
      <button
        type="button"
        class="nav-button"
        data-active=${isActive ? 'true' : 'false'}
        @click=${() => this._navigate(item.screen)}
      >
        ${icon(item.iconName, { size: 13 })} ${item.label}
      </button>
    `
  }

  private _renderHistory(): TemplateResult {
    return html`
      <wf-choreograph-view
        mode="history"
        .graphId=${this.graphId}
        .status=${this.historyStatus}
        .error=${this.historyError}
        .history=${this.historyRuns}
        @choreo-run-select=${this._handleRunSelect}
      ></wf-choreograph-view>
    `
  }

  private _renderMonitor(): TemplateResult {
    return html`
      <wf-choreograph-view
        mode="monitor"
        .graphId=${this.graphId}
        .runId=${this._activeRunId()}
        .status=${this.monitorStatus}
        .error=${this.monitorError}
        .provenance=${this.provenance}
        .telemetry=${this.telemetry}
        .liveMessage=${this.liveMessage}
      ></wf-choreograph-view>
    `
  }

  private _empty(iconName: string, title: string, description: string, mood: 'default' | 'danger' = 'default'): TemplateResult {
    return html`
      <div class="state-centered">
        <mn-empty-state
          icon=${iconName}
          title=${title}
          description=${description}
          mood=${mood}
          variant="compact"
        ></mn-empty-state>
      </div>
    `
  }

  private _page(
    iconName: string,
    title: string,
    description: string,
    content: TemplateResult,
    actions: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    return html`
      <section class="studio-page" role="region" aria-label=${title}>
        <header class="page-head">
          ${icon(iconName, { size: 18 })}
          <span class="page-title-wrap">
            <span class="page-title">${title}</span>
            <span class="page-description">${description}</span>
          </span>
          ${actions}
        </header>
        <div class="page-body">${content}</div>
      </section>
    `
  }

  private _workflowName(local: string | null): string {
    return trimmed(local) || trimmed(this.selectedWorkflowName) || trimmed(this.workflows[0]?.name)
  }

  private _workflowOptions(selected: string): TemplateResult[] {
    const definitions = new Map<string, string>()
    for (const workflow of this.workflows) {
      const name = trimmed(workflow.name)
      if (name) definitions.set(name, name)
    }
    if (this.anatomy?.name) definitions.set(this.anatomy.name, this.anatomy.name)
    if (selected) definitions.set(selected, selected)
    return [...definitions.values()].map((name) => html`<option value=${name}>${name}</option>`)
  }

  private _registryRefresh(): void {
    this._emit<WfStudioGraphDetail>('choreo-workflows-refresh', { graphId: this._graphId() })
  }

  private _renderLoading(text: string): TemplateResult {
    return html`<div class="state-centered"><mn-loading size="sm" text=${text}></mn-loading></div>`
  }

  private _selectedWorkflowDefinition(name: string): WfWorkflowDefinition | null {
    return this.workflows.find((workflow) => workflow.name === name) ?? null
  }

  private _submitLaunch(event: SubmitEvent): void {
    event.preventDefault()
    const workflowName = this._workflowName(this._launchWorkflowName)
    const graphId = this._launchGraphId === null ? trimmed(this.graphId) : trimmed(this._launchGraphId)
    const source = this._launchInputs === null ? this.launchInputs : this._launchInputs
    if (!workflowName) {
      this._launchValidation = 'Choose a workflow.'
      return
    }
    if (!graphId) {
      this._launchValidation = 'A graph id is required.'
      return
    }
    let inputs: unknown
    try {
      inputs = JSON.parse(source || '{}')
    } catch (cause) {
      this._launchValidation = `Inputs must be valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
      return
    }
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
      this._launchValidation = 'Inputs must be a JSON object.'
      return
    }
    this._launchValidation = ''
    this._emit<WfWorkflowLaunchDetail>('choreo-workflow-launch', {
      graphId,
      workflowName,
      inputs: inputs as Readonly<Record<string, unknown>>,
    })
  }

  private _renderLaunch(): TemplateResult {
    const workflowName = this._workflowName(this._launchWorkflowName)
    const graphId = this._launchGraphId === null ? this.graphId : this._launchGraphId
    const inputs = this._launchInputs === null ? this.launchInputs : this._launchInputs
    const selected = this._selectedWorkflowDefinition(workflowName)
    const refresh = html`<button type="button" @click=${this._registryRefresh}>
      ${icon('refresh', { size: 13 })} Refresh registry
    </button>`

    let content: TemplateResult
    if (this.workflowStatus === 'loading') {
      content = this._renderLoading('Loading workflow registry')
    } else if (this.workflowStatus === 'unavailable') {
      content = this._empty('wifi-off', 'Workflow registry unavailable', this.workflowError || 'The Choreograph registry route is not reachable.')
    } else if (this.workflowStatus === 'error') {
      content = this._empty('alert-circle', 'Could not load workflows', this.workflowError || 'The workflow registry failed.', 'danger')
    } else if (this.workflowStatus === 'empty' || !this.workflows.length) {
      const title = this.workflowStatus === 'idle' ? 'Workflow registry not loaded' : 'No workflows registered'
      content = this._empty('package', title, 'Refresh the registry after the Choreograph host is connected.')
    } else {
      content = html`<div class="page-stack">
        <form class="panel" aria-label="Launch workflow" data-workflow-name=${workflowName} @submit=${this._submitLaunch}>
          <div class="panel-head">${icon('zap', { size: 14 })} Run request</div>
          <div class="panel-body field-grid">
            <label class="field">
              <span class="field-label">Workflow</span>
              <select
                name="workflow"
                .value=${workflowName}
                ?disabled=${this.launchPending}
                @change=${(event: Event) => {
                  this._launchWorkflowName = (event.currentTarget as HTMLSelectElement).value
                  this._launchValidation = ''
                }}
              >${this._workflowOptions(workflowName)}</select>
            </label>
            <label class="field">
              <span class="field-label">Target graph</span>
              <input
                name="graph"
                autocomplete="off"
                .value=${graphId}
                ?disabled=${this.launchPending}
                @input=${(event: Event) => {
                  this._launchGraphId = (event.currentTarget as HTMLInputElement).value
                  this._launchValidation = ''
                }}
              >
            </label>
            <label class="field field-wide">
              <span class="field-label">Run inputs (JSON)</span>
              <textarea
                name="inputs"
                spellcheck="false"
                .value=${inputs}
                ?disabled=${this.launchPending}
                @input=${(event: Event) => {
                  this._launchInputs = (event.currentTarget as HTMLTextAreaElement).value
                  this._launchValidation = ''
                }}
              ></textarea>
              <span class="field-hint">Fields are projected by the host into the workflow run body; for survey-synthesize use question, doc_ids, doc_query, and k.</span>
            </label>
            ${this._launchValidation ? html`<div class="validation" role="alert">${this._launchValidation}</div>` : nothing}
            ${this.launchError ? html`<div class="validation" role="alert">${this.launchError}</div>` : nothing}
            ${this.launchedRunId ? html`<div class="notice" data-tone="success" role="status">
              Run <span class="mono">${this.launchedRunId}</span> accepted. Open Monitor to follow telemetry.
            </div>` : nothing}
            <div class="form-actions">
              <button class="primary" type="submit" ?disabled=${this.launchPending}>
                ${icon(this.launchPending ? 'clock' : 'play', { size: 13 })}
                ${this.launchPending ? 'Launching…' : 'Launch workflow'}
              </button>
            </div>
          </div>
        </form>
        ${selected ? html`<div class="panel"><div class="panel-body workflow-copy">
          <strong>${selected.name}</strong>
          ${selected.description || 'No description supplied.'}
          ${selected.whenToUse ? html`<br><span><b>When to use:</b> ${selected.whenToUse}</span>` : nothing}
          ${selected.phases?.length ? html`<br><span><b>Phases:</b> ${selected.phases.map((phase) => phase.title).join(' → ')}</span>` : nothing}
        </div></div>` : nothing}
      </div>`
    }
    return this._page('zap', 'Launch a workflow', 'Submit a typed run request to the authenticated Choreograph host.', content, refresh)
  }

  private _requestAnatomy(workflowName = this._workflowName(this._anatomyWorkflowName)): void {
    if (!workflowName) return
    this._emit<WfWorkflowRequestDetail>('choreo-anatomy-request', { graphId: this._graphId(), workflowName })
  }

  private _renderAnatomyBody(): TemplateResult {
    if (this.anatomyStatus === 'loading') return this._renderLoading('Loading workflow anatomy')
    if (this.anatomyStatus === 'unavailable') {
      return this._empty('wifi-off', 'Workflow anatomy unavailable', this.anatomyError || 'The definition projection is not reachable.')
    }
    if (this.anatomyStatus === 'error') {
      return this._empty('alert-circle', 'Could not load anatomy', this.anatomyError || 'The workflow definition failed.', 'danger')
    }
    if (!this.anatomy || this.anatomyStatus === 'empty') {
      return this._empty('layers', 'No anatomy loaded', 'Choose a registered workflow and request its phase and node definition.')
    }
    return html`
      <div class="panel">
        <div class="panel-head">${icon('network', { size: 14 })} ${this.anatomy.name}</div>
        ${this.anatomy.description ? html`<div class="panel-body workflow-copy">${this.anatomy.description}</div>` : nothing}
      </div>
      <div class="phase-list" role="list" aria-label="Workflow phases">
        ${this.anatomy.phases.map((phase) => html`
          <section class="phase-card" role="listitem" data-phase-index=${phase.index}>
            <header class="phase-head">
              <span class="phase-index">${phase.index}</span>
              <span class="phase-name">${phase.title}</span>
              <span class="pill">${phase.nodes?.length ?? 0} nodes</span>
            </header>
            ${phase.detail ? html`<div class="panel-body node-copy">${phase.detail}</div>` : nothing}
            ${phase.nodes?.length ? html`
              <table class="node-table" aria-label=${`${phase.title} nodes`}>
                <thead><tr><th>Node</th><th>Archetype</th><th>Model</th><th>Tools</th><th>Budget</th><th>Gates</th></tr></thead>
                <tbody>${phase.nodes.map((node) => html`
                  <tr data-node-id=${node.id}>
                    <td><span class="mono">${node.label || node.id}</span></td>
                    <td>${node.agentType || '-'}</td>
                    <td class="mono">${node.model || '-'}</td>
                    <td>${node.toolMode || '-'}</td>
                    <td>${node.maxTurns == null ? '-' : `${node.maxTurns} turns`}</td>
                    <td>${node.gateIds?.length ? node.gateIds.map((gate) => html`<span class="pill">${gate}</span>`) : '-'}</td>
                  </tr>
                `)}</tbody>
              </table>
            ` : html`<div class="panel-body node-copy">This projection declares the phase but does not expose agent-node detail.</div>`}
          </section>
        `)}
      </div>
    `
  }

  private _renderAnatomy(): TemplateResult {
    const workflowName = this._workflowName(this._anatomyWorkflowName)
    const actions = html`<span class="toolbar">
      <select
        aria-label="Workflow anatomy"
        .value=${workflowName}
        @change=${(event: Event) => {
          const name = (event.currentTarget as HTMLSelectElement).value
          this._anatomyWorkflowName = name
          this._requestAnatomy(name)
        }}
      >${this._workflowOptions(workflowName)}</select>
      <button type="button" ?disabled=${!workflowName || this.anatomyStatus === 'loading'} @click=${() => this._requestAnatomy()}>
        ${icon('refresh', { size: 13 })} Load
      </button>
    </span>`
    return this._page('layers', 'Run anatomy', 'Inspect declared phases, agent nodes, models, tools, and gate bindings.', this._renderAnatomyBody(), actions)
  }

  private _requestGates(workflowName = this._workflowName(this._gatesWorkflowName)): void {
    if (!workflowName) return
    this._emit<WfWorkflowRequestDetail>('choreo-gates-request', { graphId: this._graphId(), workflowName })
  }

  private _changeGate(gate: WfWorkflowGate, enabled: boolean): void {
    const workflowName = this._workflowName(this._gatesWorkflowName)
    if (!workflowName || gate.required) return
    this._emit<WfGateChangeDetail>('choreo-gate-change', {
      graphId: this._graphId(),
      workflowName,
      gateId: gate.id,
      enabled,
    })
  }

  private _renderGatesBody(): TemplateResult {
    if (this.gatesStatus === 'loading') return this._renderLoading('Loading workflow gates')
    if (this.gatesStatus === 'unavailable') {
      return this._empty('wifi-off', 'Gate inventory unavailable', this.gatesError || 'The capability projection is not reachable.')
    }
    if (this.gatesStatus === 'error') {
      return this._empty('alert-circle', 'Could not load gates', this.gatesError || 'The gate inventory failed.', 'danger')
    }
    const visible = this._gateFilter === 'all' ? this.gates : this.gates.filter((gate) => gate.kind === this._gateFilter)
    if (!this.gates.length || this.gatesStatus === 'empty') {
      return this._empty('filter', 'No declared gates', 'This workflow uses only the implicit graph capability, or its gate projection has not been minted.')
    }
    if (!visible.length) {
      return this._empty('filter', 'No matching gates', `No ${this._gateFilter} gates are declared for this workflow.`)
    }
    return html`
      <div class="panel">
        <table class="gate-table" aria-label="Workflow gates">
          <thead><tr><th>Enabled</th><th>Name</th><th>Kind</th><th>Binding</th><th>Access</th><th>Status</th></tr></thead>
          <tbody>${visible.map((gate) => html`
            <tr data-gate-id=${gate.id}>
              <td><input
                class="gate-toggle"
                type="checkbox"
                aria-label=${`${gate.enabled ? 'Disable' : 'Enable'} ${gate.name}`}
                .checked=${gate.enabled}
                ?disabled=${Boolean(gate.required)}
                @change=${(event: Event) => this._changeGate(gate, (event.currentTarget as HTMLInputElement).checked)}
              ></td>
              <td><strong>${gate.name}</strong>${gate.description ? html`<div class="node-copy">${gate.description}</div>` : nothing}</td>
              <td><span class="pill">${gate.kind}</span></td>
              <td class="mono">${gate.binding || '-'}</td>
              <td>${gate.access || '-'}</td>
              <td>${gate.required ? html`<span class="pill">required</span>` : gate.status || (gate.enabled ? 'bound' : 'off')}</td>
            </tr>
          `)}</tbody>
        </table>
      </div>
    `
  }

  private _renderGates(): TemplateResult {
    const workflowName = this._workflowName(this._gatesWorkflowName)
    const actions = html`<span class="toolbar">
      <select
        aria-label="Workflow gates"
        .value=${workflowName}
        @change=${(event: Event) => {
          const name = (event.currentTarget as HTMLSelectElement).value
          this._gatesWorkflowName = name
          this._requestGates(name)
        }}
      >${this._workflowOptions(workflowName)}</select>
      <select aria-label="Gate kind" .value=${this._gateFilter} @change=${(event: Event) => {
        this._gateFilter = (event.currentTarget as HTMLSelectElement).value
      }}>
        <option value="all">All gates</option>
        <option value="capability">Capabilities</option>
        <option value="tool">Tools</option>
        <option value="ward">Wards</option>
      </select>
      <button type="button" ?disabled=${!workflowName || this.gatesStatus === 'loading'} @click=${() => this._requestGates()}>
        ${icon('refresh', { size: 13 })} Refresh
      </button>
    </span>`
    return this._page('filter', 'Gates', 'Review the capabilities, tools, and wards exposed at the workflow boundary.', this._renderGatesBody(), actions)
  }

  private _leftRunId(): string {
    return this._compareLeftRunId ?? (trimmed(this.compareLeftRunId) || trimmed(this.historyRuns[0]?.runId))
  }

  private _rightRunId(): string {
    if (this._compareRightRunId !== null) return this._compareRightRunId
    const controlled = trimmed(this.compareRightRunId)
    if (controlled) return controlled
    const left = this._leftRunId()
    return trimmed(this.historyRuns.find((run) => run.runId !== left)?.runId)
  }

  private _submitComparison(event: SubmitEvent): void {
    event.preventDefault()
    const leftRunId = this._leftRunId()
    const rightRunId = this._rightRunId()
    if (!leftRunId || !rightRunId) {
      this._compareValidation = 'Choose two runs.'
      return
    }
    if (leftRunId === rightRunId) {
      this._compareValidation = 'Choose two different runs.'
      return
    }
    this._compareValidation = ''
    this._emit<WfRunCompareDetail>('choreo-run-compare', { graphId: this._graphId(), leftRunId, rightRunId })
  }

  private _renderComparisonResult(): TemplateResult {
    if (this.comparePending || this.compareStatus === 'loading') return this._renderLoading('Comparing workflow runs')
    if (this.compareStatus === 'unavailable') {
      return this._empty('wifi-off', 'Comparison unavailable', this.compareError || 'The run detail service is not reachable.')
    }
    if (this.compareStatus === 'error') {
      return this._empty('alert-circle', 'Could not compare runs', this.compareError || 'The comparison failed.', 'danger')
    }
    if (!this.comparison || this.compareStatus === 'empty' || this.compareStatus === 'idle') {
      return this._empty('git-branch', 'No comparison loaded', 'Choose two recorded runs to compare their provenance and telemetry rollups.')
    }
    return html`
      <div class="panel">
        <div class="panel-head">
          ${icon('scale', { size: 14 })}
          <span class="mono">${this.comparison.leftRunId}</span>
          ${icon('arrow-right', { size: 13 })}
          <span class="mono">${this.comparison.rightRunId}</span>
        </div>
        <table class="compare-table" aria-label="Run comparison">
          <thead><tr><th>Field</th><th>Left run</th><th>Right run</th><th>Delta</th></tr></thead>
          <tbody>${this.comparison.fields.map((field) => html`
            <tr data-field=${field.label}>
              <td><strong>${field.label}</strong></td>
              <td class="mono">${displayValue(field.left)}</td>
              <td class="mono">${displayValue(field.right)}</td>
              <td class="verdict" data-verdict=${field.verdict || 'same'}>${displayValue(field.delta)}</td>
            </tr>
          `)}</tbody>
        </table>
      </div>
    `
  }

  private _renderCompare(): TemplateResult {
    const leftRunId = this._leftRunId()
    const rightRunId = this._rightRunId()
    const content = html`<div class="page-stack">
      <form class="panel" aria-label="Compare workflow runs" @submit=${this._submitComparison}>
        <div class="panel-head">${icon('git-branch', { size: 14 })} Run pair</div>
        <div class="panel-body field-grid">
          <label class="field">
            <span class="field-label">Left run</span>
            <select name="left-run" .value=${leftRunId} ?disabled=${this.comparePending} @change=${(event: Event) => {
              this._compareLeftRunId = (event.currentTarget as HTMLSelectElement).value
              this._compareValidation = ''
            }}>
              <option value="">Choose a run</option>
              ${this.historyRuns.map((run) => html`<option value=${run.runId}>${run.runId} · ${run.workflowName || 'workflow'}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Right run</span>
            <select name="right-run" .value=${rightRunId} ?disabled=${this.comparePending} @change=${(event: Event) => {
              this._compareRightRunId = (event.currentTarget as HTMLSelectElement).value
              this._compareValidation = ''
            }}>
              <option value="">Choose a run</option>
              ${this.historyRuns.map((run) => html`<option value=${run.runId}>${run.runId} · ${run.workflowName || 'workflow'}</option>`)}
            </select>
          </label>
          ${this._compareValidation ? html`<div class="validation" role="alert">${this._compareValidation}</div>` : nothing}
          <div class="form-actions">
            <button class="primary" type="submit" ?disabled=${this.comparePending || this.historyRuns.length < 2}>
              ${icon('scale', { size: 13 })} ${this.comparePending ? 'Comparing…' : 'Compare runs'}
            </button>
          </div>
        </div>
      </form>
      ${this.historyStatus === 'loading' && !this.historyRuns.length
        ? this._renderLoading('Loading workflow runs')
        : this._renderComparisonResult()}
    </div>`
    return this._page('git-branch', 'Compare runs', 'Contrast two journal-backed runs field by field.', content)
  }

  private _renderScreen(screen: string): TemplateResult | typeof nothing {
    switch (screen) {
      case 'home':
      case 'runs':
        return this._renderHistory()
      case 'run':
        return this._renderMonitor()
      case 'launch':
        return this._renderLaunch()
      case 'anatomy':
        return this._renderAnatomy()
      case 'gates':
        return this._renderGates()
      case 'compare':
        return this._renderCompare()
      default:
        return this._empty('help', 'Unknown screen', `No Choreograph Studio screen is registered for "${screen}".`)
    }
  }

  render(): TemplateResult {
    const screen = this._screen()
    return html`
      <section class="shell" role="region" aria-label="Choreograph Studio">
        <header class="chrome">
          <span class="brand">${icon('zap', { size: 17 })}</span>
          <span class="title-wrap">
            <span class="title">Choreograph Studio</span>
            <span class="subtitle">${this._activeRunId() || this._graphId() || 'Workflow runs'}</span>
          </span>
          <nav class="nav" aria-label="Choreograph Studio screens">
            ${NAV.map((item) => this._navButton(item, screen))}
          </nav>
        </header>
        <div class="body">${this._renderScreen(screen)}</div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wf-studio-shell': WfStudioShell
  }
}
