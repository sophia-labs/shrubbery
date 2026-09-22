/**
 * wf-choreograph-view - controlled Choreograph history/monitor surface.
 *
 * Garden's original element owns run-list fetches, provenance SPARQL reads, and
 * live telemetry clients. This Shrubbery lift keeps only the view contract:
 * callers provide history/provenance/telemetry snapshots and receive intents for
 * refresh, selection, replay, retry, manual connect, and node expansion.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type WfChoreographMode = 'history' | 'monitor'
export type WfChoreographStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error' | 'connecting'
export type WfRunStatus = 'queued' | 'running' | 'finished' | 'failed' | 'unknown' | string
export type WfPhaseStatus = 'active' | 'exited' | 'unknown' | string
export type WfNodeStatus = 'queued' | 'running' | 'finished' | 'failed' | 'unknown' | string

export interface WfRunListItem {
  readonly runId: string
  readonly workflowName?: string | null
  readonly status?: WfRunStatus | null
  readonly startedAt?: number | string | Date | null
  readonly durationMs?: number | null
}

export interface WfAgentRun {
  readonly id: string
  readonly label?: string | null
  readonly status?: WfNodeStatus | null
  readonly startedAt?: number | string | Date | null
  readonly durationMs?: number | null
  readonly resultRef?: string | null
}

export interface WfRunProvenance {
  readonly runId: string
  readonly workflowName?: string | null
  readonly status?: WfRunStatus | null
  readonly startedAt?: number | string | Date | null
  readonly durationMs?: number | null
  readonly agentRuns?: readonly WfAgentRun[]
}

export interface WfTelemetryNode {
  readonly id: string
  readonly label?: string | null
  readonly status?: WfNodeStatus | null
  readonly outputFragment?: string | null
  readonly resultDetail?: string | null
  readonly resultRef?: string | null
  readonly detailStatus?: WfChoreographStatus | null
}

export interface WfTelemetryPhase {
  readonly phaseIndex: number
  readonly label?: string | null
  readonly status?: WfPhaseStatus | null
  readonly nodes?: readonly WfTelemetryNode[]
}

export interface WfTelemetryRun {
  readonly runId: string
  readonly workflowName?: string | null
  readonly status?: WfRunStatus | null
  readonly phases?: readonly WfTelemetryPhase[]
}

export interface WfRunDetail {
  readonly runId: string
}

export interface WfGraphIntentDetail {
  readonly graphId: string | null
}

export interface WfRunConnectDetail extends WfGraphIntentDetail {
  readonly runId: string
}

export interface WfNodeToggleDetail extends WfRunDetail {
  readonly phaseIndex: number
  readonly nodeId: string
  readonly expanded: boolean
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function statusIcon(status: string | null | undefined): string {
  switch (trimmed(status).toLowerCase()) {
    case 'running':
    case 'active':
    case 'connecting':
      return 'zap'
    case 'finished':
    case 'completed':
    case 'exited':
      return 'check'
    case 'failed':
    case 'error':
      return 'alert-circle'
    case 'paused':
      return 'pause'
    case 'stopped':
      return 'square'
    case 'queued':
      return 'clock'
    default:
      return 'circle'
  }
}

function statusTone(status: string | null | undefined): string {
  const s = trimmed(status).toLowerCase()
  if (s === 'running' || s === 'active' || s === 'connecting') return 'running'
  if (s === 'finished' || s === 'completed' || s === 'exited') return 'finished'
  if (s === 'failed' || s === 'error') return 'failed'
  if (s === 'paused' || s === 'stopped') return 'queued'
  if (s === 'queued') return 'queued'
  return 'unknown'
}

function timestamp(value: number | string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatTime(value: number | string | Date | null | undefined): string {
  const ms = timestamp(value)
  if (!ms) return '-'
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

@customElement('wf-choreograph-view')
export class WfChoreographView extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .root {
      display: flex;
      width: 100%;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
    }

    .head {
      display: flex;
      min-height: 52px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.94));
      box-sizing: border-box;
    }

    .title-wrap {
      min-width: 0;
      flex: 1 1 auto;
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

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-4, 16px);
      box-sizing: border-box;
    }

    .actions,
    .run-picker {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      flex: 0 0 auto;
    }

    button,
    .run-input {
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
    }

    button {
      display: inline-flex;
      min-height: 30px;
      align-items: center;
      gap: 5px;
      padding: 0 10px;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    button:disabled {
      cursor: default;
      opacity: 0.48;
    }

    .run-input {
      width: min(240px, 32vw);
      min-height: 30px;
      padding: 0 8px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      outline: none;
    }

    .run-input:focus {
      border-color: var(--mn-color-accent, #2563eb);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 22px;
      padding: 0 8px;
      border: 1px solid var(--mn-color-border-subtle, #d1d5db);
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #374151);
      background: var(--mn-color-surface-raised, #fff);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .status-pill[data-tone='running'] {
      border-color: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .status-pill[data-tone='finished'] {
      border-color: var(--mn-color-success, #16a34a);
      color: var(--mn-color-success, #16a34a);
      background: rgba(22, 163, 74, 0.08);
    }

    .status-pill[data-tone='failed'] {
      border-color: var(--mn-color-danger, #dc2626);
      color: var(--mn-color-danger, #dc2626);
      background: rgba(220, 38, 38, 0.08);
    }

    .history-table,
    .provenance-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mn-text-xs, 12px);
    }

    th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 8px 10px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0;
      text-align: left;
      text-transform: uppercase;
    }

    td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      vertical-align: middle;
    }

    .history-row {
      cursor: pointer;
    }

    .history-row:hover,
    .history-row:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .mono {
      max-width: 18rem;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .muted {
      color: var(--mn-color-text-tertiary, #6b7280);
      white-space: nowrap;
    }

    .section {
      margin-bottom: var(--mn-space-4, 16px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-surface-base, #fff);
    }

    .section-head {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 9px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, #f8fafc);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--mn-space-3, 12px);
      padding: 12px;
    }

    .meta-item {
      min-width: 0;
    }

    .meta-label {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .meta-value {
      margin-top: 2px;
      overflow: hidden;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .phase-head,
    .node-summary {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 9px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, #f8fafc);
    }

    .phase-index {
      width: 24px;
      color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      text-align: right;
    }

    .phase-title,
    .node-id {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .node-summary {
      width: 100%;
      min-height: 38px;
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: 0;
      text-align: left;
    }

    .node-summary .chevron {
      transition: transform 120ms ease;
    }

    .node-summary[aria-expanded='true'] .chevron {
      transform: rotate(90deg);
    }

    .node-detail {
      padding: 10px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .node-detail[hidden] {
      display: none;
    }

    .pre {
      max-height: 220px;
      overflow: auto;
      margin: 0;
      padding: 10px;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .state {
      display: grid;
      min-height: 220px;
      align-content: center;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `

  @property({ type: String }) mode: WfChoreographMode = 'monitor'
  @property({ type: String }) status: WfChoreographStatus = 'idle'
  @property({ type: String }) error = ''
  @property({ type: String }) graphId = ''
  @property({ type: String }) runId = ''
  @property({ type: String }) liveMessage = ''
  @property({ attribute: false }) history: readonly WfRunListItem[] = []
  @property({ attribute: false }) provenance: WfRunProvenance | null = null
  @property({ attribute: false }) telemetry: WfTelemetryRun | null = null
  @state() private _runInput = ''
  @state() private _expandedNodes = new Set<string>()

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _graphIntent(): WfGraphIntentDetail {
    return { graphId: trimmed(this.graphId) || null }
  }

  private _activeRunId(): string {
    return trimmed(this.runId) || trimmed(this.telemetry?.runId) || trimmed(this.provenance?.runId)
  }

  private _refresh(): void {
    this._emit<WfGraphIntentDetail>('choreo-refresh', this._graphIntent())
  }

  private _selectRun(runId: string): void {
    this._emit<WfRunDetail>('choreo-run-select', { runId })
  }

  private _connectRun(): void {
    const runId = this._runInput.trim()
    if (!runId) return
    this._emit<WfRunConnectDetail>('choreo-run-connect', { ...this._graphIntent(), runId })
  }

  private _runIntent(type: 'choreo-retry' | 'choreo-replay' | 'choreo-provenance-refresh'): void {
    const runId = this._activeRunId()
    if (!runId) return
    this._emit<WfRunDetail>(type, { runId })
  }

  private _toggleNode(phaseIndex: number, nodeId: string): void {
    const runId = this._activeRunId()
    if (!runId) return
    const key = `${phaseIndex}:${nodeId}`
    const next = new Set(this._expandedNodes)
    const expanded = !next.has(key)
    if (expanded) next.add(key)
    else next.delete(key)
    this._expandedNodes = next
    this._emit<WfNodeToggleDetail>('choreo-node-toggle', { runId, phaseIndex, nodeId, expanded })
  }

  private _pill(status: string | null | undefined): TemplateResult {
    const label = trimmed(status) || 'unknown'
    return html`<span class="status-pill" data-tone=${statusTone(label)}>
      ${icon(statusIcon(label), { size: 12 })} ${label}
    </span>`
  }

  private _state(iconName: string, title: string, description: string, mood: 'default' | 'danger' = 'default'): TemplateResult {
    return html`<div class="state">
      <mn-empty-state
        icon=${iconName}
        title=${title}
        description=${description}
        mood=${mood}
        variant="compact"
      ></mn-empty-state>
    </div>`
  }

  private _renderHistoryBody(): TemplateResult {
    const graphLabel = trimmed(this.graphId) || 'the active graph'
    if (this.status === 'loading' || this.status === 'connecting') {
      return html`<div class="state"><mn-loading size="sm" text="Loading workflow runs"></mn-loading></div>`
    }
    if (this.status === 'unavailable') {
      return this._state('clock', 'Run history unavailable', this.error || 'The run-list service is not reachable yet.')
    }
    if (this.status === 'error') {
      return this._state('alert-circle', 'Could not load runs', this.error || 'The workflow run list failed.', 'danger')
    }
    if (!this.history.length || this.status === 'empty') {
      return this._state('database', 'No runs yet', `No workflow runs have been recorded in ${graphLabel}.`)
    }
    return html`
      <table class="history-table" role="table" aria-label=${`Workflow runs in ${graphLabel}`}>
        <thead>
          <tr>
            <th scope="col">Run</th>
            <th scope="col">Workflow</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${repeat(this.history, (run) => run.runId, (run) => html`
            <tr
              class="history-row"
              tabindex="0"
              data-run-id=${run.runId}
              @click=${() => this._selectRun(run.runId)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  this._selectRun(run.runId)
                }
              }}
            >
              <td class="mono" title=${run.runId}>${run.runId}</td>
              <td class="mono" title=${run.workflowName ?? ''}>${run.workflowName || '-'}</td>
              <td>${this._pill(run.status)}</td>
              <td class="muted">${formatTime(run.startedAt)}</td>
              <td class="muted">${formatDuration(run.durationMs)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `
  }

  private _renderHistory(): TemplateResult {
    const graphLabel = trimmed(this.graphId) || 'the active graph'
    return html`
      <section class="root" role="region" aria-label="Choreograph run history">
        <header class="head">
          ${icon('history', { size: 18 })}
          <span class="title-wrap">
            <span class="title">Runs</span>
            <span class="subtitle">Workflow run history in ${graphLabel}</span>
          </span>
          <span class="actions">
            <button type="button" @click=${this._refresh} aria-label="Refresh workflow runs">
              ${icon('refresh', { size: 13 })} Refresh
            </button>
          </span>
        </header>
        <div class="body">${this._renderHistoryBody()}</div>
      </section>
    `
  }

  private _renderProvenance(): TemplateResult | typeof nothing {
    const run = this.provenance
    if (this.status === 'loading' && !run) {
      return html`<section class="section"><div class="section-head">${icon('database', { size: 13 })} Provenance</div>
        <mn-loading size="sm" text="Loading provenance"></mn-loading>
      </section>`
    }
    if (!run) return nothing
    return html`
      <section class="section" aria-label="Run provenance">
        <div class="section-head">
          ${icon('database', { size: 13 })} Provenance
          <span class="spacer"></span>
          <button type="button" @click=${() => this._runIntent('choreo-provenance-refresh')}>${icon('refresh', { size: 12 })} Refresh</button>
        </div>
        <div class="meta-grid">
          <span class="meta-item"><span class="meta-label">Run</span><span class="meta-value">${run.runId}</span></span>
          <span class="meta-item"><span class="meta-label">Workflow</span><span class="meta-value">${run.workflowName || '-'}</span></span>
          <span class="meta-item"><span class="meta-label">Started</span><span class="meta-value">${formatTime(run.startedAt)}</span></span>
          <span class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${formatDuration(run.durationMs)}</span></span>
        </div>
        ${(run.agentRuns ?? []).length
          ? html`<table class="provenance-table" aria-label="Agent runs">
              <thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Result</th></tr></thead>
              <tbody>
                ${(run.agentRuns ?? []).map((agent) => html`
                  <tr>
                    <td class="mono" title=${agent.label ?? agent.id}>${agent.label || agent.id}</td>
                    <td>${this._pill(agent.status)}</td>
                    <td class="muted">${formatDuration(agent.durationMs)}</td>
                    <td class="mono" title=${agent.resultRef ?? ''}>${agent.resultRef || '-'}</td>
                  </tr>
                `)}
              </tbody>
            </table>`
          : nothing}
      </section>
    `
  }

  private _renderManualPicker(): TemplateResult {
    return html`
      <div class="state">
        <mn-empty-state
          icon="database"
          title="Open a run"
          description="Choose a run from history or enter a run id to inspect provenance and telemetry."
          variant="compact"
        ></mn-empty-state>
        <div class="run-picker" style="justify-content:center;margin-top:12px;">
          <input
            class="run-input"
            aria-label="Run id"
            placeholder="run id"
            .value=${this._runInput}
            @input=${(event: Event) => { this._runInput = (event.target as HTMLInputElement).value }}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === 'Enter') this._connectRun()
            }}
          />
          <button type="button" ?disabled=${!this._runInput.trim()} @click=${this._connectRun}>Open</button>
        </div>
      </div>
    `
  }

  private _renderPhases(run: WfTelemetryRun): TemplateResult | typeof nothing {
    const phases = run.phases ?? []
    if (!phases.length) return nothing
    return html`
      <section class="phase-list" role="tree" aria-label="Run phases">
        ${phases.map((phase) => html`
          <article class="phase-card" role="treeitem" aria-label=${phase.label || `Phase ${phase.phaseIndex + 1}`}>
            <div class="phase-head">
              <span class="phase-index">${phase.phaseIndex + 1}</span>
              <span class="phase-title">${phase.label || `Phase ${phase.phaseIndex + 1}`}</span>
              ${this._pill(phase.status)}
            </div>
            ${(phase.nodes ?? []).map((node) => {
              const key = `${phase.phaseIndex}:${node.id}`
              const expanded = this._expandedNodes.has(key)
              return html`
                <button
                  type="button"
                  class="node-summary"
                  aria-expanded=${expanded ? 'true' : 'false'}
                  @click=${() => this._toggleNode(phase.phaseIndex, node.id)}
                >
                  <span class="chevron">${icon('chevron-right', { size: 13 })}</span>
                  <span class="node-id">${node.label || node.id}</span>
                  ${this._pill(node.status)}
                </button>
                <div class="node-detail" ?hidden=${!expanded} aria-hidden=${expanded ? 'false' : 'true'}>
                  ${node.detailStatus === 'loading'
                    ? html`<mn-loading size="sm" text="Loading node detail"></mn-loading>`
                    : html`<pre class="pre">${node.resultDetail || node.outputFragment || node.resultRef || 'No node detail loaded.'}</pre>`}
                </div>
              `
            })}
          </article>
        `)}
      </section>
    `
  }

  private _renderMonitorBody(): TemplateResult | ReadonlyArray<TemplateResult | typeof nothing> {
    const runId = this._activeRunId()
    const run = this.telemetry
    if (!runId && !run) return this._renderManualPicker()
    if (this.status === 'connecting') {
      return [
        this._renderProvenance(),
        html`<div class="state"><mn-loading size="sm" text="Connecting to run telemetry"></mn-loading></div>`,
      ]
    }
    if (this.status === 'unavailable') {
      return [
        this._renderProvenance(),
        this._state('clock', 'Telemetry unavailable', this.error || 'The live run event route is not reachable yet.'),
      ]
    }
    if (this.status === 'error') {
      return [
        this._renderProvenance(),
        html`<div class="state">
          <mn-empty-state icon="alert-circle" title="Run monitor failed" description=${this.error || 'The run monitor failed.'} mood="danger" variant="compact">
            <button slot="action" type="button" @click=${() => this._runIntent('choreo-retry')}>Retry</button>
          </mn-empty-state>
        </div>`,
      ]
    }
    return [
      this._renderProvenance(),
      run ? this._renderPhases(run) : this._state('clock', 'Awaiting run events', 'The monitor is connected, but no run events have arrived yet.'),
    ]
  }

  private _renderMonitor(): TemplateResult {
    const runId = this._activeRunId()
    const status = this.telemetry?.status ?? this.provenance?.status ?? this.status
    return html`
      <section class="root" role="region" aria-label="Choreograph workflow run">
        <header class="head">
          ${icon('graph', { size: 18 })}
          <span class="title-wrap">
            <span class="title">${runId || 'Run monitor'}</span>
            <span class="subtitle">${this.telemetry?.workflowName || this.provenance?.workflowName || 'Provenance, replay, and live monitor'}</span>
          </span>
          ${runId ? this._pill(status) : nothing}
          <span class="actions">
            <button type="button" ?disabled=${!runId} @click=${() => this._runIntent('choreo-replay')}>
              ${icon('undo', { size: 13 })} Replay
            </button>
          </span>
        </header>
        <div class="body">${this._renderMonitorBody()}</div>
        <span class="sr-only" aria-live="polite">${this.liveMessage}</span>
      </section>
    `
  }

  render(): TemplateResult {
    return this.mode === 'history' ? this._renderHistory() : this._renderMonitor()
  }
}

/**
 * Garden compatibility alias.
 *
 * Older workspace fixtures and persisted configs may still resolve the
 * Choreograph center as <wf-mission-control>. Keep that tag live while the
 * implementation remains the single controlled Shrubbery view above.
 */
@customElement('wf-mission-control')
export class WfMissionControl extends WfChoreographView {}

declare global {
  interface HTMLElementTagNameMap {
    'wf-choreograph-view': WfChoreographView
    'wf-mission-control': WfMissionControl
  }
}
