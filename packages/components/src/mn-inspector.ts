/**
 * mn-inspector — Garden's right-rail object inspector, made controlled.
 *
 * Garden's original inspector subscribed to session/filesystem/document/wire
 * stores, projected relations, and executed commands in the component. This
 * Shrubbery lift keeps the visual contract but makes the host own all state and
 * side effects: model/actions are props, and close/action/relation requests leave
 * as composed intents.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnInspectorIdentityChip {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}

export interface MnInspectorIdentity {
  readonly kind: string
  readonly icon?: string
  readonly title: string
  readonly typeLabel: string
  readonly chips?: readonly MnInspectorIdentityChip[]
}

export type MnInspectorRelationsScope = 'active' | 'inactive' | 'none'

export interface MnInspectorRelationItem {
  readonly id: string
  readonly primary: string
  readonly secondary?: string
  readonly icon?: string
}

export interface MnInspectorRelationGroup {
  readonly key: string
  readonly label: string
  readonly icon?: string
  readonly items: readonly MnInspectorRelationItem[]
}

export interface MnInspectorRelations {
  readonly scope: MnInspectorRelationsScope
  readonly groups?: readonly MnInspectorRelationGroup[]
}

export interface MnInspectorModel {
  readonly identity: MnInspectorIdentity
  readonly relations?: MnInspectorRelations
}

export interface MnInspectorActionHeader {
  readonly type: 'header'
  readonly content: string
}

export interface MnInspectorActionDivider {
  readonly type: 'divider'
}

export interface MnInspectorActionItem {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly variant?: 'default' | 'danger'
}

export type MnInspectorAction =
  | MnInspectorActionHeader
  | MnInspectorActionDivider
  | MnInspectorActionItem

export interface MnInspectorModifiers {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

export interface MnInspectorActionDetail {
  readonly id: string
  readonly action: MnInspectorActionItem
  readonly modifiers: MnInspectorModifiers
}

export interface MnInspectorRelationOpenDetail {
  readonly groupKey: string
  readonly id: string
  readonly item: MnInspectorRelationItem
}

function isActionHeader(entry: MnInspectorAction): entry is MnInspectorActionHeader {
  return 'type' in entry && entry.type === 'header'
}

function isActionDivider(entry: MnInspectorAction): entry is MnInspectorActionDivider {
  return 'type' in entry && entry.type === 'divider'
}

function isActionItem(entry: MnInspectorAction): entry is MnInspectorActionItem {
  return !('type' in entry)
}

function modifiersFrom(event: MouseEvent | KeyboardEvent): MnInspectorModifiers {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  }
}

@customElement('mn-inspector')
export class MnInspector extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-panel-bg, var(--mn-color-surface-base, #fff));
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      min-height: var(--mn-y-slice-1-height, 44px);
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: var(--mn-panel-header-rule, 1px solid var(--mn-color-border-subtle, #e5e7eb));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .header-left {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
    }

    .header-icon {
      display: inline-flex;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .header-title {
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      font-weight: var(--mn-font-weight-semibold, 650);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .close-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .close-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .inspector-body {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
      overflow: auto;
      padding: var(--mn-space-4, 16px);
      box-sizing: border-box;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .section-title .count {
      color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-weight: 500;
      letter-spacing: 0;
    }

    .identity-card {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-base, #fff));
      box-sizing: border-box;
    }

    .identity-head {
      display: flex;
      align-items: flex-start;
      gap: var(--mn-space-3, 12px);
      min-width: 0;
    }

    .identity-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #2563eb);
    }

    .identity-text {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 2px;
    }

    .identity-title {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .identity-type {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .chips {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }

    .chip {
      display: flex;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      font-size: var(--mn-text-2xs, 11px);
    }

    .chip-label {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .chip-value {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #4b5563);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chip-value.mono {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    }

    .relation-group {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }

    .relation-group-label {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .relation-item {
      display: flex;
      width: 100%;
      align-items: flex-start;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-base, #fff));
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .relation-item:hover,
    .relation-item:focus-visible {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .relation-icon {
      display: inline-flex;
      flex: 0 0 auto;
      margin-top: 1px;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .relation-text {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 1px;
    }

    .relation-primary {
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .relation-secondary {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      line-height: 1.35;
    }

    .relations-lazy {
      padding: var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
      line-height: 1.45;
    }

    .empty {
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      text-align: center;
    }

    .empty-title {
      margin-bottom: var(--mn-space-1, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-weight: 650;
    }

    .actions-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .action-header {
      padding: var(--mn-space-2, 8px) var(--mn-space-1, 4px) var(--mn-space-1, 4px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .action-divider {
      height: 1px;
      margin: var(--mn-space-1, 4px) 0;
      background: var(--mn-color-border-subtle, #e5e7eb);
    }

    .action-btn {
      display: flex;
      width: 100%;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: 30px;
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-align: left;
    }

    .action-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .action-btn:disabled {
      color: var(--mn-color-text-muted, #6b7280);
      cursor: not-allowed;
      opacity: 0.62;
    }

    .action-btn.danger {
      color: var(--mn-color-danger-strong, #b91c1c);
    }

    .action-btn.danger:hover {
      background: var(--mn-color-danger-surface, #fef2f2);
    }

    .action-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .action-label {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .action-shortcut {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
    }
  `

  @property({ attribute: false }) model: MnInspectorModel | null = null
  @property({ attribute: false }) actions: readonly MnInspectorAction[] = []
  @property({ type: Boolean, attribute: 'show-close' }) showClose = true

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('mn-inspector-close', { bubbles: true, composed: true }))
  }

  private actionClick(action: MnInspectorActionItem, event: MouseEvent): void {
    if (action.disabled) return
    this.emit<MnInspectorActionDetail>('mn-inspector-action', {
      id: action.id,
      action,
      modifiers: modifiersFrom(event),
    })
  }

  private relationOpen(group: MnInspectorRelationGroup, item: MnInspectorRelationItem): void {
    this.emit<MnInspectorRelationOpenDetail>('mn-inspector-relation-open', {
      groupKey: group.key,
      id: item.id,
      item,
    })
  }

  private relationKeydown(
    group: MnInspectorRelationGroup,
    item: MnInspectorRelationItem,
    event: KeyboardEvent,
  ): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.relationOpen(group, item)
  }

  private renderNoSelection(): TemplateResult {
    return html`
      <div class="empty" data-empty-state="nothing-selected">
        <div class="empty-title">Nothing selected</div>
        <div>Select a document, block, wire, comment, or workspace to inspect it.</div>
      </div>
    `
  }

  private renderIdentity(identity: MnInspectorIdentity): TemplateResult {
    const chips = identity.chips ?? []
    return html`
      <section class="section" data-section="identity">
        <div class="section-title">${icon('info', { size: 12 })}<span>Identity</span></div>
        <div class="identity-card">
          <div class="identity-head">
            <div class="identity-icon">${icon(identity.icon ?? 'info', { size: 18 })}</div>
            <div class="identity-text">
              <div class="identity-title">${identity.title}</div>
              <div class="identity-type">${identity.typeLabel}</div>
            </div>
          </div>
          ${chips.length > 0
            ? html`<div class="chips">
                ${repeat(
                  chips,
                  (chip) => `${chip.label}:${chip.value}`,
                  (chip) => html`
                    <div class="chip">
                      <span class="chip-label">${chip.label}</span>
                      <span class=${classMap({ 'chip-value': true, mono: chip.mono === true })}>${chip.value}</span>
                    </div>
                  `,
                )}
              </div>`
            : nothing}
        </div>
      </section>
    `
  }

  private relationCount(relations: MnInspectorRelations): number {
    return (relations.groups ?? []).reduce((count, group) => count + group.items.length, 0)
  }

  private renderRelations(relations: MnInspectorRelations | undefined): TemplateResult {
    const safeRelations = relations ?? { scope: 'none', groups: [] }
    const groups = safeRelations.groups ?? []
    const total = this.relationCount(safeRelations)
    const relationContent =
      safeRelations.scope === 'inactive'
        ? html`<div class="relations-lazy">Open this document to see its connections.</div>`
        : total === 0
          ? html`
              <div class="empty" data-empty-state="no-relations">
                <div class="empty-title">No relations</div>
                <div>This object has no wires, backlinks, or comments yet.</div>
              </div>
            `
          : groups
              .filter((group) => group.items.length > 0)
              .map((group) => this.renderRelationGroup(group))
    return html`
      <section class="section" data-section="relations">
        <div class="section-title">
          ${icon('git-branch', { size: 12 })}
          <span>Relations</span>
          ${total > 0 ? html`<span class="count">${total}</span>` : nothing}
        </div>
        ${relationContent}
      </section>
    `
  }

  private renderRelationGroup(group: MnInspectorRelationGroup): TemplateResult {
    return html`
      <div class="relation-group" data-group=${group.key}>
        <div class="relation-group-label">${group.label} (${group.items.length})</div>
        ${group.items.map(
          (item) => html`
            <button
              type="button"
              class="relation-item"
              data-relation-id=${item.id}
              @click=${() => this.relationOpen(group, item)}
              @keydown=${(event: KeyboardEvent) => this.relationKeydown(group, item, event)}
            >
              <span class="relation-icon">${icon(item.icon ?? group.icon ?? 'git-branch', { size: 12 })}</span>
              <span class="relation-text">
                <span class="relation-primary">${item.primary}</span>
                ${item.secondary ? html`<span class="relation-secondary">${item.secondary}</span>` : nothing}
              </span>
            </button>
          `,
        )}
      </div>
    `
  }

  private renderActions(): TemplateResult {
    const actions = this.actions
    return html`
      <section class="section" data-section="actions">
        <div class="section-title">${icon('zap', { size: 12 })}<span>Actions</span></div>
        ${actions.length === 0
          ? html`
              <div class="empty" data-empty-state="no-actions">
                <div class="empty-title">No actions</div>
                <div>No actions are available for this selection.</div>
              </div>
            `
          : html`<div class="actions-list">
              ${repeat(actions, (entry, index) => this.actionKey(entry, index), (entry) => this.renderAction(entry))}
            </div>`}
      </section>
    `
  }

  private actionKey(entry: MnInspectorAction, index: number): string {
    if (isActionItem(entry)) return entry.id
    if (isActionHeader(entry)) return `header:${entry.content}:${index}`
    return `divider:${index}`
  }

  private renderAction(entry: MnInspectorAction): TemplateResult | typeof nothing {
    if (isActionHeader(entry)) {
      return html`<div class="action-header">${entry.content}</div>`
    }
    if (isActionDivider(entry)) {
      return html`<div class="action-divider" role="separator"></div>`
    }
    if (!isActionItem(entry)) return nothing
    return html`
      <button
        type="button"
        class=${classMap({ 'action-btn': true, danger: entry.variant === 'danger' })}
        data-action-id=${entry.id}
        ?disabled=${entry.disabled === true}
        @click=${(event: MouseEvent) => this.actionClick(entry, event)}
      >
        ${entry.icon ? html`<span class="action-icon">${icon(entry.icon, { size: 14 })}</span>` : nothing}
        <span class="action-label">${entry.label}</span>
        ${entry.shortcut ? html`<span class="action-shortcut">${entry.shortcut}</span>` : nothing}
      </button>
    `
  }

  override render(): TemplateResult {
    const model = this.model
    const body =
      model === null
        ? [this.renderNoSelection()]
        : [
            this.renderIdentity(model.identity),
            this.renderRelations(model.relations),
            this.renderActions(),
          ]
    return html`
      <header class="header">
        <div class="header-left">
          <span class="header-icon">${icon('info', { size: 14 })}</span>
          <span class="header-title">Inspector</span>
        </div>
        ${this.showClose
          ? html`<button
              type="button"
              class="close-btn"
              title="Close inspector"
              aria-label="Close inspector"
              @click=${() => this.close()}
            >${icon('x', { size: 14 })}</button>`
          : nothing}
      </header>
      <div class="inspector-body">
        ${body}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-inspector': MnInspector
  }
}
