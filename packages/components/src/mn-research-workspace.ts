/**
 * mn-research-workspace - controlled research workspace organism.
 *
 * This component owns layout and pane selection only. Data-bearing children are
 * slotted by the host, so chat, source adapters, workflow canvases, and traces
 * stay independently reusable and backend-free.
 */

import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnResearchWorkspaceMode = 'source' | 'workflow'

export interface MnResearchWorkspaceModeDetail {
  readonly mode: MnResearchWorkspaceMode
}

@customElement('mn-research-workspace')
export class MnResearchWorkspace extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .workspace {
      display: grid;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      grid-template-rows: var(--mn-research-header-height, 44px) minmax(0, 1fr);
      background: inherit;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-width: 0;
      gap: var(--mn-space-4, 16px);
      box-sizing: border-box;
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-default, #e5e7eb);
    }

    .brand {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    .brand-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-accent, #2563eb);
      line-height: 0;
    }

    .titles {
      display: grid;
      min-width: 0;
      gap: 1px;
    }

    h2,
    .subtitle {
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    h2 {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 700;
      letter-spacing: 0;
    }

    .subtitle {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
    }

    .header-actions {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 0 0 auto;
      gap: var(--mn-space-2, 8px);
    }

    .mode-switcher {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
    }

    .mode-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 92px;
      min-height: var(--mn-control-height, 28px);
      gap: var(--mn-space-1-5, 6px);
      padding: 0 var(--mn-space-3, 12px);
      border: 0;
      border-inline-end: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .mode-button:last-child {
      border-inline-end: 0;
    }

    .mode-button:hover,
    .mode-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .mode-button.active {
      background: var(--mn-color-interactive-selected, #dbeafe);
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2563eb));
      font-weight: 650;
    }

    .body {
      display: grid;
      min-width: 0;
      min-height: 0;
      grid-template-columns: minmax(220px, 260px) minmax(360px, 1fr) minmax(340px, 0.86fr);
    }

    .pane {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .sidebar-pane {
      border-inline-end: 1px solid var(--mn-color-border-default, #e5e7eb);
    }

    .chat-pane {
      border-inline-end: 1px solid var(--mn-color-border-default, #e5e7eb);
    }

    .detail-pane {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      background: var(--mn-color-surface-base, #fff);
    }

    .detail-main {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    .trace-pane {
      display: block;
      min-width: 0;
      min-height: 136px;
      height: var(--mn-research-trace-height, 24vh);
      max-height: 52vh;
      overflow: auto;
      resize: vertical;
      padding: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    :host([data-skin='greenhouse']) .workspace {
      grid-template-rows: 48px minmax(0, 1fr);
    }

    :host([data-skin='greenhouse']) header {
      border-bottom-color: var(--mn-top-bar-border, var(--mn-color-border-default, #e5e7eb));
      background: var(--mn-top-bar-bg, var(--mn-color-surface-base, #fff));
    }

    :host([data-skin='greenhouse']) .body {
      grid-template-columns: minmax(208px, 248px) minmax(460px, 1.18fr) minmax(320px, 0.72fr);
    }

    :host([data-skin='greenhouse']) .detail-pane {
      background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #fff));
    }

    :host([data-skin='greenhouse']) .trace-pane {
      min-height: 152px;
      height: var(--mn-research-trace-height, 24vh);
      max-height: 56vh;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
    }

    .hidden {
      display: none;
    }

    slot[name='sidebar']::slotted(*),
    slot[name='chat']::slotted(*),
    slot[name='source']::slotted(*),
    slot[name='workflow']::slotted(*) {
      display: block;
      width: 100%;
      height: 100%;
    }

    @media (max-width: 1120px) {
      .body {
        grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
      }

      .detail-pane {
        display: none;
      }
    }

    @media (max-width: 760px) {
      header {
        align-items: stretch;
        min-height: 72px;
        flex-direction: column;
        justify-content: center;
        gap: var(--mn-space-2, 8px);
        padding-block: var(--mn-space-2, 8px);
      }

      .header-actions,
      .mode-switcher {
        width: 100%;
      }

      .mode-button {
        flex: 1 1 0;
        min-width: 0;
      }

      .body {
        grid-template-columns: 1fr;
      }

      .sidebar-pane {
        display: none;
      }

      .chat-pane {
        border-inline-end: 0;
      }
    }

    :host([data-skin='emporium']) .mode-switcher {
      border-radius: var(--mn-radius-surface, 4px);
    }
  `

  @property({ type: String }) title = 'Sophia Research Service'
  @property({ type: String }) subtitle = 'Paper trail'
  @property({ type: String, reflect: true }) mode: MnResearchWorkspaceMode = 'source'
  @property({ type: String }) sourceLabel = 'Source'
  @property({ type: String }) workflowLabel = 'Workflow'

  private setMode(mode: MnResearchWorkspaceMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.dispatchEvent(
      new CustomEvent<MnResearchWorkspaceModeDetail>('mn-research-workspace-mode-change', {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private modeButton(mode: MnResearchWorkspaceMode, label: string, iconName: string) {
    return html`
      <button
        class=${classMap({ 'mode-button': true, active: this.mode === mode })}
        type="button"
        aria-pressed=${this.mode === mode ? 'true' : 'false'}
        @click=${() => this.setMode(mode)}
      >
        ${icon(iconName, { size: 13 })}
        <span>${label}</span>
      </button>
    `
  }

  override render() {
    return html`
      <section class="workspace" aria-label=${this.title}>
        <header>
          <div class="brand">
            <span class="brand-icon" aria-hidden="true">${icon('book-open', { size: 17 })}</span>
            <span class="titles">
              <h2>${this.title}</h2>
              <span class="subtitle">${this.subtitle}</span>
            </span>
          </div>
          <div class="header-actions">
            <slot name="header-actions"></slot>
            <div class="mode-switcher" role="group" aria-label="Research pane">
              ${this.modeButton('source', this.sourceLabel, 'file-text')}
              ${this.modeButton('workflow', this.workflowLabel, 'network')}
            </div>
          </div>
        </header>

        <div class="body">
          <aside class="pane sidebar-pane"><slot name="sidebar"></slot></aside>
          <main class="pane chat-pane"><slot name="chat"></slot></main>
          <aside class="pane detail-pane">
            <div class=${classMap({ 'detail-main': true, hidden: this.mode !== 'source' })}>
              <slot name="source"></slot>
            </div>
            <div class=${classMap({ 'detail-main': true, hidden: this.mode !== 'workflow' })}>
              <slot name="workflow"></slot>
            </div>
            <div class="trace-pane">
              <slot name="trace"></slot>
            </div>
          </aside>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-research-workspace': MnResearchWorkspace
  }
}
