/** Read-only, deliberately non-operational Agent Session family display. */
import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export interface AgentSessionFamilyBudgetView {
  readonly admissionStatus: 'admitted'
  readonly runtimeKind: 'simple' | 'prime'
  readonly allocationState: 'reserved' | 'settled' | 'released' | 'accounting_hold'
  readonly allocationHoldKind: 'unresolved_child_reservations' | null
  readonly settledActualCostUsdMicros: number | null
  readonly allocatedTurns: number
  readonly allocatedWallTimeMs: number
  readonly allocatedTokens: number
  readonly allocatedCostUsdMicros: number
  readonly allocatedArtifactBytes: number
}

export type AgentSessionFamilySessionState = 'open' | 'closing' | 'closed' | 'faulted'
export type AgentSessionFamilyChildRunState =
  | 'queued'
  | 'claimed'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type AgentSessionFamilyMaterializationState =
  | 'claimed'
  | 'running'
  | 'quiescing'
  | 'quiescent'
  | 'passivated'
  | 'completed'
  | 'faulted'
  | 'cancelled'
export type AgentSessionFamilyKernelState = 'running' | 'released' | 'shutdown' | 'faulted' | 'cancelled'
export type AgentSessionFamilyFaultKind =
  | 'worker_spawn'
  | 'worker_exit'
  | 'worker_timeout'
  | 'worker_oom'
  | 'worker_protocol'
  | 'kernel_fault'
  | 'quiescence_fault'
  | 'checkpoint_fault'
  | 'replay_divergence'
  | 'host_invariant'

export interface AgentSessionFamilyMaterializationView {
  readonly generation: number
  readonly state: AgentSessionFamilyMaterializationState
  readonly workerState: AgentSessionFamilyMaterializationState
  readonly kernelState: AgentSessionFamilyKernelState | null
  readonly faultKind: AgentSessionFamilyFaultKind | null
  readonly recoverable: boolean | null
}

export interface AgentSessionFamilyBudgetAccountView {
  readonly directAcceptedChildren: number
  readonly maxChildren: number
  readonly occupiedChildren: number
  readonly maxConcurrentChildren: number
  readonly budgetCostSpentUsdMicros: number
  readonly budgetCostReservedUsdMicros: number
  readonly budgetCostRemainingUsdMicros: number
  readonly budgetCostMaxUsdMicros: number
  readonly budgetAccountRevision: number
  readonly budgetAccountExhausted: boolean
}

export interface AgentSessionFamilyChildView {
  readonly childName: string
  readonly childSessionId: string
  readonly depth: number
  readonly registrationStatus: 'registered'
  readonly registeredAt: string
  readonly sessionState: AgentSessionFamilySessionState
  readonly childRunState: AgentSessionFamilyChildRunState | null
  readonly budget: AgentSessionFamilyBudgetView | null
  readonly materialization: AgentSessionFamilyMaterializationView | null
}

export interface AgentSessionFamilyViewModel {
  readonly parentSessionId: string
  readonly parentState: AgentSessionFamilySessionState
  readonly projectionRevision: number
  readonly parentMaterialization: AgentSessionFamilyMaterializationView | null
  readonly budgetAccount: AgentSessionFamilyBudgetAccountView
  readonly children: readonly AgentSessionFamilyChildView[]
}

export type AgentSessionFamilyViewStatus = 'loading' | 'ready' | 'error'

/** Opaque identifiers stay opaque and are never exposed in full by the DOM. */
export function shortAgentSessionId(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 7)}…${value.slice(-6)}`
}

@customElement('sh-agent-session-family-view')
export class ShAgentSessionFamilyView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 220px;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      overflow: hidden;
      color: var(--mn-color-text-primary);
      background: var(--mn-color-surface-base);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .family {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card);
    }
    header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle);
    }
    h2 {
      margin: 0;
      font-size: var(--mn-text-base, 15px);
      color: var(--mn-color-text-title, inherit);
    }
    .summary { margin-left: auto; color: var(--mn-color-text-muted); }
    .status {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      padding: 1px var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-full, 999px);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-sunken);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
    }
    .alert {
      color: var(--mn-color-danger-strong);
      background: color-mix(in srgb, var(--mn-color-danger-strong) 12%, transparent);
    }
    .warning {
      color: var(--mn-color-warning-strong, var(--mn-color-text-primary));
      background: color-mix(in srgb, var(--mn-color-warning-strong, currentColor) 12%, transparent);
    }
    .rows { overflow: auto; }
    .ledger {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-sunken);
      border-bottom: 1px solid var(--mn-color-border-subtle);
      font-size: var(--mn-text-xs, 12px);
    }
    .ledger-metric { display: inline-flex; gap: var(--mn-space-1, 4px); align-items: baseline; }
    .ledger-revision { margin-left: auto; color: var(--mn-color-text-muted); }
    .child {
      display: grid;
      grid-template-columns: minmax(150px, 1.2fr) minmax(130px, 1fr) minmax(220px, 1.8fr);
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle);
    }
    .child:last-child { border-bottom: 0; }
    .identity, .runtime, .allocation { min-width: 0; }
    .name { font-weight: 650; overflow-wrap: anywhere; }
    .session-id, .minor, .empty {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    .session-id, .number { font-family: var(--mn-font-mono, ui-monospace, monospace); }
    .badges, .states, .budgets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      margin-top: var(--mn-space-1, 4px);
    }
    .label { color: var(--mn-color-text-tertiary); }
    .state {
      color: var(--mn-color-text-secondary);
      font-size: var(--mn-text-xs, 12px);
    }
    .state.warning { color: var(--mn-color-warning-strong, var(--mn-color-text-primary)); }
    .state.alert { color: var(--mn-color-danger-strong); }
    .budget {
      display: inline-flex;
      gap: var(--mn-space-1, 4px);
      white-space: nowrap;
      font-size: var(--mn-text-xs, 12px);
    }
    .empty, .loading, .error {
      display: grid;
      flex: 1 1 auto;
      min-height: 180px;
      place-content: center;
      padding: var(--mn-space-4, 16px);
      text-align: center;
    }
    .error { color: var(--mn-color-danger-strong); }
    @media (max-width: 700px) {
      .child { grid-template-columns: 1fr; }
    }
  `

  @property({ type: String }) status: AgentSessionFamilyViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ attribute: false }) family: AgentSessionFamilyViewModel | null = null

  private budget(label: string, value: number, unit: string): TemplateResult {
    return html`<span class="budget"><span class="label">${label}</span><span class="number">${value}</span><span>${unit}</span></span>`
  }

  private materialization(
    materialization: AgentSessionFamilyMaterializationView | null,
    className = 'states',
  ): TemplateResult | typeof nothing {
    if (!materialization) return nothing
    const fault = materialization.faultKind === null
      ? nothing
      : html`<span class="state fault-state ${materialization.recoverable ? 'warning' : 'alert'}">
          <span class="label">fault </span>${materialization.faultKind.replaceAll('_', ' ')}
          <span aria-hidden="true"> · </span>${materialization.recoverable ? 'recoverable' : 'terminal'}
        </span>`
    return html`<div class=${className}>
      <span class="state generation-state"><span class="label">generation </span><span class="number">${materialization.generation}</span></span>
      <span class="state materialization-state"><span class="label">materialization </span>${materialization.state}</span>
      <span class="state worker-state"><span class="label">worker </span>${materialization.workerState}</span>
      ${materialization.kernelState === null
        ? nothing
        : html`<span class="state kernel-state"><span class="label">kernel </span>${materialization.kernelState}</span>`}
      ${fault}
    </div>`
  }

  private sessionTone(state: AgentSessionFamilySessionState): string {
    if (state === 'faulted') return 'alert'
    if (state === 'closing') return 'warning'
    return ''
  }

  private runTone(state: AgentSessionFamilyChildRunState): string {
    if (state === 'failed') return 'alert'
    if (state === 'cancelling') return 'warning'
    return ''
  }

  private childRow(child: AgentSessionFamilyChildView): TemplateResult {
    const budget = child.budget
    const allocationOverage = budget !== null
      && budget.settledActualCostUsdMicros !== null
      && budget.settledActualCostUsdMicros > budget.allocatedCostUsdMicros
    const accountingHold = budget?.allocationState === 'accounting_hold'
    return html`
      <article class="child">
        <div class="identity">
          <div class="name">${child.childName}</div>
          <div class="session-id">${shortAgentSessionId(child.childSessionId)}</div>
          <div class="badges">
            <span class="status">${child.registrationStatus}</span>
            <span class="status session-state ${this.sessionTone(child.sessionState)}">session ${child.sessionState}</span>
            ${budget ? html`<span class="status">${budget.admissionStatus}</span>` : nothing}
            ${child.childRunState
              ? html`<span class="status child-run-state ${this.runTone(child.childRunState)}">run ${child.childRunState}</span>`
              : nothing}
            ${budget
              ? html`<span class="status allocation-state ${accountingHold ? 'warning allocation-hold' : ''}">
                  allocation ${budget.allocationState.replaceAll('_', ' ')}
                </span>`
              : nothing}
            ${allocationOverage ? html`<span class="status alert allocation-overage">cost overage</span>` : nothing}
          </div>
        </div>
        <div class="runtime">
          ${budget
            ? html`<div><span class="label">runtime </span>${budget.runtimeKind}</div>`
            : html`<div class="minor">No admission allocation projected.</div>`}
          <div class="minor">depth <span class="number">${child.depth}</span></div>
          ${this.materialization(child.materialization)}
        </div>
        <div class="allocation">
          ${budget
            ? html`<div class="budgets">
                ${this.budget('turns', budget.allocatedTurns, '')}
                ${this.budget('time', budget.allocatedWallTimeMs, 'ms')}
                ${this.budget('tokens', budget.allocatedTokens, '')}
                ${this.budget('cost', budget.allocatedCostUsdMicros, 'µUSD')}
                ${budget.settledActualCostUsdMicros === null
                  ? nothing
                  : this.budget('actual', budget.settledActualCostUsdMicros, 'µUSD')}
                ${this.budget('artifacts', budget.allocatedArtifactBytes, 'bytes')}
              </div>`
            : nothing}
        </div>
      </article>
    `
  }

  render(): TemplateResult {
    if (this.status === 'loading') return html`<section class="family"><div class="loading">Loading Agent Session family…</div></section>`
    if (this.status === 'error' || !this.family) {
      return html`<section class="family"><div class="error">${this.error || 'This Agent Session family could not be loaded.'}</div></section>`
    }
    const family = this.family
    const account = family.budgetAccount
    return html`
      <section class="family" aria-label="Agent Session family">
        <header>
          <h2>Agent Session family</h2>
          <span class="status parent-session-state ${this.sessionTone(family.parentState)}">session ${family.parentState}</span>
          <span class="summary">${family.children.length} ${family.children.length === 1 ? 'child' : 'children'}</span>
        </header>
        ${family.parentMaterialization
          ? html`<div class="ledger parent-materialization" aria-label="Parent materialization">
              ${this.materialization(family.parentMaterialization, 'states parent-states')}
            </div>`
          : nothing}
        <div class="ledger" aria-label="Parent admission ledger">
          <span class="ledger-metric"><span class="label">accepted</span><span class="number">${account.directAcceptedChildren} / ${account.maxChildren}</span></span>
          <span class="ledger-metric"><span class="label">active</span><span class="number">${account.occupiedChildren} / ${account.maxConcurrentChildren}</span></span>
          <span class="ledger-metric">
            <span class="label">cost</span>
            <span class="number">${account.budgetCostSpentUsdMicros}</span><span>spent</span>
            <span aria-hidden="true">·</span>
            <span class="number">${account.budgetCostReservedUsdMicros}</span><span>reserved</span>
            <span aria-hidden="true">·</span>
            <span class="number">${account.budgetCostRemainingUsdMicros}</span><span>remaining /</span>
            <span class="number">${account.budgetCostMaxUsdMicros}</span><span>µUSD</span>
          </span>
          ${account.budgetAccountExhausted ? html`<span class="status alert account-exhausted">exhausted</span>` : nothing}
          <span class="ledger-revision">ledger rev <span class="number">${account.budgetAccountRevision}</span></span>
        </div>
        <div class="rows">
          ${family.children.length === 0
            ? html`<div class="empty">No child sessions registered.</div>`
            : family.children.map((child) => this.childRow(child))}
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-agent-session-family-view': ShAgentSessionFamilyView
  }
}
