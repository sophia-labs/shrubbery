/**
 * mn-advanced-wire-menu — Garden's advanced wire predicate chooser, shell-neutral.
 *
 * This component owns only local UI state. It receives predicate groups as data
 * or falls back to the pure nucleus taxonomy, then emits confirm/close intents.
 */

import { LitElement, css, html, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import {
  DEFAULT_WIRE_PREDICATE_URI,
  PREDICATE_GROUPS,
  getWirePredicateLabel,
  type PredicateDef,
  type PredicateCategoryDef,
} from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnWireDirection = 'forward' | 'reverse' | 'bidirectional'

export interface MnWirePredicateGroup {
  readonly name: string
  readonly icon?: string
  readonly description?: string
  readonly predicates: readonly PredicateDef[]
}

export interface MnAdvancedWireMenuConfirmDetail {
  readonly predicate: string
  readonly direction: MnWireDirection
  readonly bidirectional: boolean
}

function defaultPredicateGroups(): readonly MnWirePredicateGroup[] {
  return [
    {
      name: 'Default',
      description: 'General association',
      predicates: [
        {
          uri: DEFAULT_WIRE_PREDICATE_URI,
          label: getWirePredicateLabel(DEFAULT_WIRE_PREDICATE_URI),
          description: 'General association',
        },
      ],
    },
    ...Object.entries(PREDICATE_GROUPS).map(([name, group]: [string, PredicateCategoryDef]) => ({
      name,
      icon: group.icon,
      description: group.description,
      predicates: group.predicates,
    })),
  ]
}

function eventModifiers(event: MouseEvent | KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

@customElement('mn-advanced-wire-menu')
export class MnAdvancedWireMenu extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      place-items: center;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.42));
      color: var(--mn-color-text-primary, #111827);
      font: var(--mn-text-sm, 13px) / 1.35 var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: grid;
    }

    .dialog {
      display: flex;
      flex-direction: column;
      width: min(520px, calc(100vw - var(--mn-space-8, 32px)));
      max-height: min(720px, calc(100dvh - var(--mn-space-8, 32px)));
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, rgba(15, 23, 42, 0.16));
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.24));
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-4, 16px);
      flex: 0 0 auto;
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
    }

    .title {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-type-heading-size, 1rem);
      font-weight: 650;
      line-height: 1.2;
    }

    .subtitle {
      margin: var(--mn-space-1, 4px) 0 0;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .close:hover,
    .close:focus-visible {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .body {
      display: grid;
      min-height: 0;
      overflow: auto;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
    }

    .group {
      display: grid;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-raised, #f6f8fa);
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
    }

    .group-icon {
      display: inline-flex;
      color: var(--mn-color-text-muted, #6b7280);
      line-height: 0;
    }

    .group-copy {
      min-width: 0;
    }

    .group-title {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-type-ui-xs-size, 11px);
      font-weight: 700;
      letter-spacing: 0.05em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .group-description {
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .predicate-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: var(--mn-space-1-5, 6px);
    }

    .predicate {
      min-height: 34px;
      min-width: 0;
      padding: var(--mn-space-2, 8px) var(--mn-space-2, 8px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .predicate:hover,
    .predicate:focus-visible {
      border-color: var(--mn-color-border-default, rgba(15, 23, 42, 0.18));
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .predicate.selected,
    .direction.selected {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2563eb));
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      flex: 0 0 auto;
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      border-top: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      background: var(--mn-color-surface-base, #fff);
    }

    .directions,
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1-5, 6px);
    }

    .direction,
    .action {
      min-height: 32px;
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }

    .action.cancel {
      background: var(--mn-color-surface-raised, #f6f8fa);
    }

    .action.confirm {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2563eb));
      background: var(--mn-color-accent, #2563eb);
      color: var(--mn-color-text-on-accent, #fff);
    }

    .direction:hover,
    .direction:focus-visible,
    .action:hover,
    .action:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent, #2563eb));
      outline-offset: 1px;
    }

    @media (max-width: 640px) {
      :host {
        align-items: end;
        padding: 0;
      }

      .dialog {
        width: 100%;
        max-height: 90dvh;
        border-right: 0;
        border-bottom: 0;
        border-left: 0;
        border-radius: var(--mn-radius-lg, 8px) var(--mn-radius-lg, 8px) 0 0;
      }

      .footer {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) selectedPredicate = DEFAULT_WIRE_PREDICATE_URI
  @property({ type: String }) direction: MnWireDirection = 'forward'
  @property({ attribute: false }) groups: readonly MnWirePredicateGroup[] = defaultPredicateGroups()

  @query('[data-wire-advanced-predicate]') private firstPredicateButton?: HTMLButtonElement

  private focusPending = false

  override connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this.handleDocumentKeydown, true)
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleDocumentKeydown, true)
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) {
      this.focusPending = true
    }
    if (this.focusPending) {
      this.focusPending = false
      window.setTimeout(() => this.firstPredicateButton?.focus(), 0)
    }
  }

  show(): void {
    this.open = true
  }

  hide(): void {
    this.close()
  }

  reset(): void {
    this.selectedPredicate = DEFAULT_WIRE_PREDICATE_URI
    this.direction = 'forward'
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return
    if (event.key === 'Escape') {
      eventModifiers(event)
      this.close()
    } else if (event.key === 'Enter') {
      eventModifiers(event)
      this.confirm()
    } else if (event.key === 'r' || event.key === 'R') {
      // Cycle direction: forward → reverse → bidirectional → forward. Eschaton-
      // requested keyboard alias for the visible direction buttons so users
      // can flip direction without leaving the keyboard. Skip when a modifier
      // is held so it doesn't fight browser shortcuts (Cmd-R, Ctrl-R = reload).
      if (event.metaKey || event.ctrlKey || event.altKey) return
      eventModifiers(event)
      this.direction =
        this.direction === 'forward'
          ? 'reverse'
          : this.direction === 'reverse'
            ? 'bidirectional'
            : 'forward'
    }
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private confirm(): void {
    const direction = this.direction
    this.open = false
    this.dispatchEvent(
      new CustomEvent<MnAdvancedWireMenuConfirmDetail>('mn-wire-options-confirm', {
        detail: {
          predicate: this.selectedPredicate,
          direction,
          bidirectional: direction === 'bidirectional',
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private selectPredicate(predicate: string): void {
    this.selectedPredicate = predicate
  }

  private selectDirection(direction: MnWireDirection): void {
    this.direction = direction
  }

  private renderPredicate(predicate: PredicateDef): TemplateResult {
    const selected = this.selectedPredicate === predicate.uri
    return html`
      <button
        type="button"
        data-wire-advanced-predicate
        data-predicate-uri=${predicate.uri}
        class=${selected ? 'predicate selected' : 'predicate'}
        aria-pressed=${selected ? 'true' : 'false'}
        title=${predicate.description ?? predicate.label}
        @click=${() => this.selectPredicate(predicate.uri)}
      >${predicate.label}</button>
    `
  }

  private renderGroup(group: MnWirePredicateGroup): TemplateResult {
    return html`
      <section class="group">
        <div class="group-header">
          ${group.icon ? html`<span class="group-icon" aria-hidden="true">${icon(group.icon, { size: 14 })}</span>` : ''}
          <div class="group-copy">
            <div class="group-title">${group.name}</div>
            ${group.description ? html`<div class="group-description">${group.description}</div>` : ''}
          </div>
        </div>
        <div class="predicate-grid">
          ${group.predicates.map(predicate => this.renderPredicate(predicate))}
        </div>
      </section>
    `
  }

  private renderDirection(direction: MnWireDirection, label: string): TemplateResult {
    const selected = this.direction === direction
    return html`
      <button
        type="button"
        data-wire-advanced-direction=${direction}
        class=${selected ? 'direction selected' : 'direction'}
        aria-pressed=${selected ? 'true' : 'false'}
        @click=${() => this.selectDirection(direction)}
      >${label}</button>
    `
  }

  override render() {
    return html`
      <section
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-advanced-wire-title"
        data-wire-advanced-menu
        @mousedown=${(event: Event) => event.stopPropagation()}
      >
        <header class="header">
          <div>
            <h2 class="title" id="mn-advanced-wire-title">Wire Relationship</h2>
            <p class="subtitle">Select the connection type and direction.</p>
          </div>
          <button
            type="button"
            class="close"
            data-wire-advanced-close
            aria-label="Close wire relationship dialog"
            @click=${() => this.close()}
          >
            ${icon('x', { size: 16 })}
          </button>
        </header>
        <div class="body">
          ${this.groups.map(group => this.renderGroup(group))}
        </div>
        <footer class="footer">
          <div class="directions" role="group" aria-label="Wire direction">
            ${this.renderDirection('forward', 'Forward')}
            ${this.renderDirection('reverse', 'Reverse')}
            ${this.renderDirection('bidirectional', 'Both')}
          </div>
          <div class="actions">
            <button
              type="button"
              class="action cancel"
              data-wire-advanced-cancel
              @click=${() => this.close()}
            >Cancel</button>
            <button
              type="button"
              class="action confirm"
              data-wire-advanced-confirm
              @click=${() => this.confirm()}
            >Choose Target</button>
          </div>
        </footer>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-advanced-wire-menu': MnAdvancedWireMenu
  }
}
