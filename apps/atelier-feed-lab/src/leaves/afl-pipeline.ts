/**
 * afl-pipeline — the rolling-generation band: the pipeline title, the four
 * stage instruments, and the current reference-pack lineage.
 *
 * Stamped by the workspace frame from layout DATA as the bottom chrome
 * (region-bottom-bar → panel-pipeline → 'afl-pipeline'). Controlled: the
 * orchestrator sets title/stages/lineage; the band emits nothing.
 */

import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'

export type StageState = 'waiting' | 'active' | 'done'

export interface PipelineStage {
  /** The stable stage key (`data-stage`, unchanged from the original app). */
  readonly stage: string
  readonly label: string
  readonly detail: string
  readonly state: StageState
  /** Elapsed seconds, shown once the stage is done. */
  readonly seconds?: number
}

@customElement('afl-pipeline')
export class AflPipeline extends LitElement {
  @property({ type: String }) title = 'Idle is carrying the feed.'
  @property({ attribute: false }) stages: readonly PipelineStage[] = []
  @property({ type: String }) lineage = ''

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: minmax(200px, 0.8fr) minmax(0, 2.4fr) minmax(220px, 1fr);
      gap: var(--mn-space-5, 20px);
      align-items: center;
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      background: var(--mn-color-surface-sunken, #0e0f13);
      border-top: 1px solid var(--mn-color-border-subtle, #23242c);
      color: var(--mn-color-text-primary, #e8e9f0);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .eyebrow {
      display: block;
      margin-bottom: var(--mn-space-1, 4px);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, var(--mn-color-accent, #7fb1e8));
    }
    h2 {
      margin: 0;
      font-family: var(--mn-font-display, Georgia, serif);
      font-size: var(--mn-text-base, 14px);
      font-weight: 460;
      line-height: 1.25;
    }

    ol {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mn-space-2, 8px);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px) var(--mn-space-2, 8px) var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #23242c);
      border-radius: var(--mn-radius-control, 4px);
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    li > span {
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      line-height: 1.8;
    }
    li strong {
      display: block;
      overflow: hidden;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 620;
      color: var(--mn-color-text-secondary, #b9bcc8);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    li small {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      font-size: var(--mn-text-2xs, 10px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    li em {
      position: absolute;
      top: 6px;
      right: 8px;
      font-family: var(--mn-font-numeral, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      font-style: normal;
    }
    li.is-active {
      border-color: var(--mn-color-warning, #d98d3a);
      background: color-mix(in srgb, var(--mn-color-warning, #d98d3a) 7%, transparent);
    }
    li.is-active strong {
      color: var(--mn-color-warning, #d98d3a);
    }
    li.is-done {
      border-color: var(--mn-color-success-border, var(--mn-color-success, #52a37c));
    }
    li.is-done strong {
      color: var(--mn-color-success, #52a37c);
    }

    .lineage {
      min-width: 0;
      padding-left: var(--mn-space-4, 16px);
      border-left: 1px solid var(--mn-color-border-subtle, #23242c);
    }
    .lineage span {
      display: block;
      margin-bottom: var(--mn-space-1, 4px);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #8b8e9c);
    }
    .lineage code {
      display: block;
      overflow: hidden;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #9a9daa);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 980px) {
      :host {
        grid-template-columns: 1fr;
        gap: var(--mn-space-3, 12px);
      }
      ol {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .lineage {
        padding-left: 0;
        border-left: 0;
      }
    }
  `

  render(): TemplateResult {
    return html`
      <div>
        <span class="eyebrow">rolling generation</span>
        <h2 id="pipeline-title">${this.title}</h2>
      </div>
      <ol>
        ${this.stages.map(
          (stage, index) => html`<li
            data-stage=${stage.stage}
            class=${classMap({ 'is-active': stage.state === 'active', 'is-done': stage.state === 'done' })}
          >
            <span>${String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>${stage.label}</strong>
              <small>${stage.detail}</small>
            </div>
            <em>${stage.state === 'active' ? 'working' : stage.state === 'done' && stage.seconds ? `${stage.seconds.toFixed(1)}s` : '—'}</em>
          </li>`,
        )}
      </ol>
      <div class="lineage">
        <span>current reference pack</span>
        <code id="lineage">${this.lineage}</code>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'afl-pipeline': AflPipeline
  }
}
