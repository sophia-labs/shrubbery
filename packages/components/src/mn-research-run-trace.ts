/**
 * mn-research-run-trace - controlled research step/provenance molecule.
 *
 * The component does not execute tools. It renders caller-owned run steps and
 * emits an open intent for hosts that want to focus a step, tool call, or trace.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, type IconName } from './icons.js'

export type MnResearchRunStepStatus = 'idle' | 'running' | 'completed' | 'warning' | 'error' | 'blocked'

export interface MnResearchRunStep {
  readonly id: string
  readonly label: string
  readonly status: MnResearchRunStepStatus
  readonly description?: string | null
  readonly tool?: string | null
  readonly meta?: string | null
}

export interface MnResearchRunStepDetail {
  readonly stepId: string
  readonly step: MnResearchRunStep
}

function iconForStatus(status: MnResearchRunStepStatus): IconName {
  switch (status) {
    case 'running':
      return 'play'
    case 'completed':
      return 'check'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'blocked':
      return 'alert-triangle'
    case 'idle':
    default:
      return 'circle'
  }
}

@customElement('mn-research-run-trace')
export class MnResearchRunTrace extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .trace {
      display: grid;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    h3 {
      margin: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, var(--mn-font-chrome, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .count {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    ol {
      display: grid;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      min-width: 0;
    }

    button {
      display: grid;
      width: 100%;
      min-width: 0;
      grid-template-columns: 26px minmax(0, 1fr);
      gap: var(--mn-space-2, 8px);
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, var(--mn-radius-lg, 8px));
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-sm, none);
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    button:hover,
    button:focus-visible,
    button.active {
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    .marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-tertiary, #6b7280);
      line-height: 0;
    }

    .body {
      display: grid;
      min-width: 0;
      gap: 2px;
    }

    .label {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .description,
    .meta {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .meta {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }

    .status-running .marker {
      background: color-mix(in srgb, var(--mn-color-warning, #d97706) 14%, transparent);
      color: var(--mn-color-warning, #d97706);
    }

    .status-completed .marker {
      background: color-mix(in srgb, var(--mn-color-success, #16a34a) 14%, transparent);
      color: var(--mn-color-success, #16a34a);
    }

    .status-warning .marker,
    .status-blocked .marker {
      background: color-mix(in srgb, var(--mn-color-warning, #d97706) 14%, transparent);
      color: var(--mn-color-warning, #d97706);
    }

    .status-error .marker {
      background: color-mix(in srgb, var(--mn-color-danger, #be123c) 14%, transparent);
      color: var(--mn-color-danger, #be123c);
    }

    :host([data-skin='emporium']) button {
      border-radius: var(--mn-radius-surface, 4px);
    }

    :host([data-skin='emporium']) .marker {
      border-radius: var(--mn-radius-surface, 4px);
    }
  `

  @property({ type: String }) title = 'Run trace'
  @property({ type: String }) activeId = ''
  @property({ attribute: false }) steps: readonly MnResearchRunStep[] = []

  private emitOpen(step: MnResearchRunStep): void {
    this.dispatchEvent(
      new CustomEvent<MnResearchRunStepDetail>('mn-research-step-open', {
        detail: { stepId: step.id, step },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private renderStep(step: MnResearchRunStep) {
    const classes = {
      [`status-${step.status}`]: true,
      active: this.activeId === step.id,
    }

    return html`
      <li>
        <button
          class=${classMap(classes)}
          type="button"
          data-step-id=${step.id}
          aria-current=${this.activeId === step.id ? 'step' : nothing}
          @click=${() => this.emitOpen(step)}
        >
          <span class="marker" aria-hidden="true">${icon(iconForStatus(step.status), { size: 13 })}</span>
          <span class="body">
            <span class="label">${step.label}</span>
            ${step.description ? html`<span class="description">${step.description}</span>` : nothing}
            ${step.tool || step.meta
              ? html`<span class="meta">${[step.tool, step.meta].filter(Boolean).join(' - ')}</span>`
              : nothing}
          </span>
        </button>
      </li>
    `
  }

  override render() {
    return html`
      <section class="trace" aria-label=${this.title}>
        <header>
          <h3>${this.title}</h3>
          <span class="count">${this.steps.length}</span>
        </header>
        ${this.steps.length > 0
          ? html`<ol>${repeat(this.steps, (step) => step.id, (step) => this.renderStep(step))}</ol>`
          : html`<div class="description">No steps yet</div>`}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-research-run-trace': MnResearchRunTrace
  }
}
