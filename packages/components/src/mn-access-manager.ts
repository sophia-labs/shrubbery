/**
 * Controlled hosted workspace access popover.
 *
 * This is the backend-free half of Garden's members panel. It owns only the
 * popover and form state; a shell owns authentication, gateway reads/writes,
 * permissions, confirmation, and error handling. Cloud-2 currently exposes
 * member grants but no public share-token API, so this component deliberately
 * has no link tab or fabricated share URL.
 *
 * `embedded` (Wave 1, north star §2.2/§3: access manager is the second clean
 * "data-driven ≠ face" illustration) is an ADDITIVE, opt-in mode — default
 * `false`, so every existing (chrome) consumer is byte-for-byte unchanged.
 * When `true`, this SAME real element renders `renderPanelBody()` — header/
 * toolbar/state/error/notice/member-list/add-form, unchanged — inline,
 * filling its host at 100%/100%, with the `.trigger` icon button and the
 * absolutely-positioned popover panel wrapper omitted entirely; only the
 * delivery form changes, never the member-grant CRUD logic itself.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnAccessRole = 'viewer' | 'editor' | 'owner'
export type MnAccessCurrentRole = MnAccessRole | 'unknown'
export type MnAccessStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnAccessBusyAction = 'add' | 'role' | 'remove' | 'refresh'

export interface MnAccessGrant {
  readonly userId: string
  readonly role: MnAccessRole
  readonly grantedAt: string
  readonly grantedBy: string
  readonly email?: string
  readonly displayName?: string
}

export interface MnAccessManagerModel {
  readonly graphId: string
  readonly graphTitle: string
  readonly currentRole: MnAccessCurrentRole
  readonly status: MnAccessStatus
  readonly grants: readonly MnAccessGrant[]
  readonly error?: string | null
  readonly notice?: string | null
  readonly busyUserId?: string | null
  readonly busyAction?: MnAccessBusyAction | null
}

export interface MnAccessAddDetail {
  readonly userId: string
  readonly role: Exclude<MnAccessRole, 'owner'>
  readonly email?: string
  readonly displayName?: string
}

export interface MnAccessRoleChangeDetail {
  readonly userId: string
  readonly role: Exclude<MnAccessRole, 'owner'>
}

export interface MnAccessRemoveDetail {
  readonly userId: string
}

function identity(grant: MnAccessGrant): string {
  return grant.displayName?.trim() || grant.email?.trim() || grant.userId
}

function initials(grant: MnAccessGrant): string {
  const source = identity(grant).trim()
  if (!source) return '?'
  if (source.includes('@')) return source.slice(0, 1).toLocaleUpperCase()
  return source.split(/\s+/u).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase()
}

@customElement('mn-access-manager')
export class MnAccessManager extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: relative;
      display: inline-flex;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    button,
    input,
    select {
      font: inherit;
    }

    .trigger {
      display: inline-flex;
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      cursor: pointer;
    }

    .trigger:hover,
    .trigger[aria-expanded='true'],
    .trigger.active {
      background: var(--mn-color-surface-accent, #f3f4f6);
      color: var(--mn-top-bar-text, #111827);
    }

    .panel {
      position: absolute;
      z-index: 70;
      inset-block-start: calc(100% + var(--mn-space-2, 6px));
      inset-inline-end: 0;
      width: min(390px, calc(100vw - 24px));
      max-height: min(650px, calc(100vh - 72px));
      overflow: auto;
      box-sizing: border-box;
      padding: var(--mn-space-4, 12px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 12px 28px rgb(0 0 0 / 0.16));
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mn-space-3, 8px);
      margin-block-end: var(--mn-space-3, 8px);
    }

    .heading {
      min-width: 0;
    }

    .title {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 700;
    }

    .graph-title {
      overflow: hidden;
      margin-block-start: 2px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .close,
    .refresh,
    .remove {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .close,
    .refresh {
      width: 26px;
      height: 26px;
    }

    .remove {
      width: 24px;
      height: 24px;
    }

    .close:hover,
    .refresh:hover:not(:disabled),
    .remove:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .remove:hover:not(:disabled) {
      color: var(--mn-color-text-danger, #b42318);
    }

    button:disabled,
    select:disabled,
    input:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 6px);
      margin-block-end: var(--mn-space-2, 6px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .state,
    .error,
    .notice,
    .permission-note,
    .capability-note,
    .validation {
      padding: var(--mn-space-2, 6px) var(--mn-space-3, 8px);
      border-radius: var(--mn-radius-control, 5px);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .state,
    .permission-note,
    .capability-note {
      background: var(--mn-color-surface-subtle, #f8fafc);
      color: var(--mn-color-text-muted, #6b7280);
    }

    .error,
    .validation {
      background: var(--mn-color-surface-danger, #fef2f2);
      color: var(--mn-color-text-danger, #b42318);
    }

    .notice {
      background: var(--mn-color-surface-success, #ecfdf3);
      color: var(--mn-color-text-success, #26734d);
    }

    .error-row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 6px);
    }

    .retry {
      flex: none;
      min-height: 28px;
      padding: 0 var(--mn-space-3, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
    }

    .member-list {
      margin: 0 0 var(--mn-space-3, 8px);
      padding: 0;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 7px);
      list-style: none;
    }

    .member-row {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) auto auto;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      min-height: 48px;
      padding: var(--mn-space-2, 6px) var(--mn-space-3, 8px);
      border-block-end: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .member-row:last-child {
      border-block-end: 0;
    }

    .avatar {
      display: inline-flex;
      width: 28px;
      height: 28px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--mn-color-surface-accent, #e7efe9);
      color: var(--mn-color-text-accent-strong, #356b50);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
    }

    .identity {
      min-width: 0;
    }

    .name,
    .secondary,
    .user-id {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .name {
      font-size: var(--mn-text-xs, 12px);
      font-weight: 650;
    }

    .secondary,
    .user-id {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
    }

    .role,
    .role-select {
      min-height: 26px;
      box-sizing: border-box;
      border-radius: 999px;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      text-transform: capitalize;
    }

    .role {
      display: inline-flex;
      align-items: center;
      padding: 0 var(--mn-space-2, 6px);
      background: var(--mn-color-surface-subtle, #f3f4f6);
      color: var(--mn-color-text-muted, #4b5563);
    }

    .role.owner {
      background: var(--mn-color-surface-accent, #e7efe9);
      color: var(--mn-color-text-accent-strong, #356b50);
    }

    .role-select {
      padding: 0 var(--mn-space-2, 6px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
    }

    .add-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 112px;
      gap: var(--mn-space-2, 6px);
      margin-block-start: var(--mn-space-3, 8px);
      padding-block-start: var(--mn-space-3, 8px);
      border-block-start: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .field {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 3px;
    }

    .field span {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 650;
    }

    .field input,
    .field select {
      width: 100%;
      height: 32px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-3, 8px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      outline: none;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-xs, 12px);
    }

    .field input:focus,
    .field select:focus {
      border-color: var(--mn-color-border-focus, #4f7c65);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--mn-color-border-focus, #4f7c65) 20%, transparent);
    }

    .optional-fields {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: 1fr 1fr;
      gap: var(--mn-space-2, 6px);
    }

    .validation {
      grid-column: 1 / -1;
    }

    .add-button {
      grid-column: 1 / -1;
      min-height: 32px;
      border: 1px solid var(--mn-color-border-accent, #356b50);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-action-primary, #356b50);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .capability-note {
      margin-block-start: var(--mn-space-3, 8px);
    }

    :host([data-skin='emporium']) .panel,
    :host([data-skin='emporium']) .member-list {
      border-radius: var(--mn-radius-surface, 0);
    }

    :host([embedded]) {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
    }

    .embedded-panel {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      overflow: auto;
      padding: var(--mn-space-4, 12px);
    }

    @media (max-width: 520px) {
      .panel {
        position: fixed;
        inset: 54px 8px auto;
        width: auto;
      }

      .member-row {
        grid-template-columns: 30px minmax(0, 1fr) auto;
      }

      .remove {
        grid-column: 3;
      }

      .add-form,
      .optional-fields {
        grid-template-columns: 1fr;
      }
    }
  `

  @property({ attribute: false }) model: MnAccessManagerModel | null = null
  /** Wave-1 leaf mode (this file's own header) — default false; unset by every existing (chrome) consumer. */
  @property({ type: Boolean, reflect: true }) embedded = false

  @state() private panelOpen = false
  @state() private addUserId = ''
  @state() private addEmail = ''
  @state() private addDisplayName = ''
  @state() private addRole: 'viewer' | 'editor' = 'editor'
  @state() private validationError = ''
  private pendingAddUserId: string | null = null

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.panelOpen || event.composedPath().includes(this)) return
    this.closePanel()
  }

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('pointerdown', this.onDocumentPointerDown)
    // Embedded content has no trigger click to hang `togglePanel`'s
    // open-triggers-`mn-access-open` behavior off of — a leaf is always
    // "open" — so request the host's first load directly. The host's own
    // `open()` orchestration (mirrors `OrganismAccessGrantController.open()`)
    // already no-ops unless status is genuinely idle.
    if (this.embedded) this.emit('mn-access-open')
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown)
    super.disconnectedCallback()
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
    if (!changed.has('model')) return
    const previous = changed.get('model') as MnAccessManagerModel | null | undefined
    if (previous?.graphId && previous.graphId !== this.model?.graphId) this.closePanel()
    if (this.pendingAddUserId && this.model?.grants.some(grant => grant.userId === this.pendingAddUserId)) {
      this.addUserId = ''
      this.addEmail = ''
      this.addDisplayName = ''
      this.pendingAddUserId = null
      this.validationError = ''
    } else if (this.pendingAddUserId && this.model?.error) {
      this.pendingAddUserId = null
    }
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private async togglePanel(): Promise<void> {
    if (!this.model) return
    if (this.panelOpen) {
      this.closePanel()
      return
    }
    this.panelOpen = true
    this.validationError = ''
    this.emit('mn-access-open')
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(
      this.model.currentRole === 'owner' ? '[name="access-user-id"]' : '.close',
    )?.focus()
  }

  private closePanel(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.validationError = ''
    this.emit('mn-access-open-change', { open: false })
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.closePanel()
  }

  private add(event: SubmitEvent): void {
    event.preventDefault()
    const model = this.model
    if (!model || model.currentRole !== 'owner' || model.busyAction) return
    const userId = this.addUserId.trim()
    const email = this.addEmail.trim()
    const displayName = this.addDisplayName.trim()
    if (!userId) {
      this.validationError = 'Enter the member’s stable user ID.'
      return
    }
    if (model.grants.some(grant => grant.userId === userId)) {
      this.validationError = 'This user already has access. Change their role in the member list.'
      return
    }
    if (email && !email.includes('@')) {
      this.validationError = 'Enter a valid email address or leave the email field empty.'
      return
    }
    this.validationError = ''
    this.pendingAddUserId = userId
    this.emit('mn-access-add', {
      userId,
      role: this.addRole,
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {}),
    } satisfies MnAccessAddDetail)
  }

  private renderGrant(grant: MnAccessGrant) {
    const model = this.model!
    const canManage = model.currentRole === 'owner' && grant.role !== 'owner'
    const busy = Boolean(model.busyAction)
    const label = identity(grant)
    return html`<li class="member-row" data-user-id=${grant.userId} data-private="true">
      <span class="avatar" aria-hidden="true">${initials(grant)}</span>
      <div class="identity">
        <div class="name">${label}</div>
        ${grant.displayName && grant.email
          ? html`<div class="secondary">${grant.email}</div>`
          : nothing}
        ${label !== grant.userId
          ? html`<div class="user-id" title=${grant.userId}>${grant.userId}</div>`
          : nothing}
      </div>
      ${canManage ? html`<select
        class="role-select"
        aria-label=${`Role for ${label}`}
        .value=${grant.role}
        ?disabled=${busy}
        @change=${(event: Event) => this.emit('mn-access-role-change', {
          userId: grant.userId,
          role: (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor',
        } satisfies MnAccessRoleChangeDetail)}
      >
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>` : html`<span class="role ${grant.role}">${grant.role}</span>`}
      ${canManage ? html`<button
        class="remove"
        type="button"
        aria-label=${`Remove ${label}`}
        title="Remove member"
        ?disabled=${busy}
        @click=${() => this.emit('mn-access-remove', { userId: grant.userId } satisfies MnAccessRemoveDetail)}
      >${icon('x', { size: 14 })}</button>` : nothing}
    </li>`
  }

  private renderAddForm() {
    const model = this.model!
    if (model.currentRole !== 'owner') return nothing
    const busy = Boolean(model.busyAction)
    return html`<form class="add-form" @submit=${this.add} novalidate>
      <label class="field">
        <span>Member user ID</span>
        <input
          name="access-user-id"
          autocomplete="off"
          placeholder="Platform subject / user ID"
          .value=${this.addUserId}
          ?disabled=${busy}
          @input=${(event: Event) => {
            this.addUserId = (event.currentTarget as HTMLInputElement).value
            this.validationError = ''
          }}
        />
      </label>
      <label class="field">
        <span>Role</span>
        <select
          name="access-role"
          .value=${this.addRole}
          ?disabled=${busy}
          @change=${(event: Event) => { this.addRole = (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor' }}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <div class="optional-fields">
        <label class="field">
          <span>Email (optional metadata)</span>
          <input
            name="access-email"
            type="email"
            autocomplete="off"
            .value=${this.addEmail}
            ?disabled=${busy}
            @input=${(event: Event) => {
              this.addEmail = (event.currentTarget as HTMLInputElement).value
              this.validationError = ''
            }}
          />
        </label>
        <label class="field">
          <span>Display name (optional)</span>
          <input
            name="access-display-name"
            autocomplete="off"
            .value=${this.addDisplayName}
            ?disabled=${busy}
            @input=${(event: Event) => { this.addDisplayName = (event.currentTarget as HTMLInputElement).value }}
          />
        </label>
      </div>
      ${this.validationError
        ? html`<div class="validation" role="alert">${this.validationError}</div>`
        : nothing}
      <button class="add-button" type="submit" ?disabled=${busy || !this.addUserId.trim()}>
        ${model.busyAction === 'add' ? 'Adding member…' : 'Add member'}
      </button>
    </form>`
  }

  /**
   * The real member-grant CRUD content — header/toolbar/state/error/notice/
   * member-list/add-form, unchanged — shared verbatim by the popover-mode
   * `.panel` and the Wave-1 `embedded` mode; only the wrapper around this
   * differs (this file's own header). Wrapped in a real static
   * `<div class="panel-body">` — empirically required (see
   * `mn-workspace-selector.ts`'s `renderMenuBody()`, the same fix): a nested
   * `TemplateResult` mounted one level deeper than its original inline call
   * site needs a real static element as its own outermost node in this
   * lit-html/happy-dom combination, or content silently fails to render.
   * `.panel-body` carries no styling of its own — no CSS rule below targets
   * it, and no existing `.panel > x` child-combinator selector depends on
   * `.header`/`.member-list`/etc being a DIRECT child of `.panel`.
   */
  private renderPanelBody(model: MnAccessManagerModel, closeButton: boolean) {
    return html`<div class="panel-body">
      <div class="header">
        <div class="heading">
          <div class="title">Workspace access</div>
          <div class="graph-title">${model.graphTitle || model.graphId}</div>
        </div>
        ${closeButton ? html`<button class="close" type="button" aria-label="Close workspace access" @click=${this.closePanel}>
          ${icon('x', { size: 15 })}
        </button>` : nothing}
      </div>

      <div class="toolbar">
        <span>${model.grants.length} ${model.grants.length === 1 ? 'member' : 'members'}</span>
        <button
          class="refresh"
          type="button"
          aria-label="Refresh workspace access"
          title="Refresh members"
          ?disabled=${Boolean(model.busyAction) || model.status === 'loading'}
          @click=${() => this.emit('mn-access-refresh')}
        >${icon('refresh-cw', { size: 14 })}</button>
      </div>

      ${model.status === 'loading' && model.grants.length === 0
        ? html`<div class="state" role="status" aria-live="polite">Loading members…</div>`
        : nothing}
      ${model.error ? html`<div class="error-row">
        <div class="error" role="alert">${model.error}</div>
        ${model.status === 'error'
          ? html`<button class="retry" type="button" @click=${() => this.emit('mn-access-refresh')}>Retry</button>`
          : nothing}
      </div>` : nothing}
      ${model.notice ? html`<div class="notice" role="status" aria-live="polite">${model.notice}</div>` : nothing}

      ${model.grants.length > 0
        ? html`<ul class="member-list" aria-label="Workspace members">
            ${model.grants.map(grant => this.renderGrant(grant))}
          </ul>`
        : model.status === 'ready'
          ? html`<div class="state">No access grants were returned.</div>`
          : nothing}

      ${model.currentRole === 'unknown' && model.status !== 'loading'
        ? html`<div class="permission-note">Your role could not be resolved. Member access is read-only.</div>`
        : model.currentRole !== 'owner'
          ? html`<div class="permission-note">Only the workspace owner can add, change, or remove members.</div>`
          : nothing}

      ${this.renderAddForm()}

      <div class="capability-note">
        Member grants only. Public share links are unavailable because this gateway does not expose share-token creation or revocation.
      </div>
    </div>`
  }

  private renderEmbedded(model: MnAccessManagerModel) {
    return html`<section
      class="embedded-panel"
      role="group"
      aria-label="Workspace access"
      @keydown=${this.onKeyDown}
    >${this.renderPanelBody(model, false)}</section>`
  }

  render() {
    const model = this.model
    if (!model) return nothing
    if (this.embedded) return this.renderEmbedded(model)
    const hasSharedMembers = model.grants.some(grant => grant.role !== 'owner')
    return html`
      <button
        class="trigger ${hasSharedMembers ? 'active' : ''}"
        type="button"
        aria-label="Manage workspace access"
        aria-haspopup="dialog"
        aria-expanded=${this.panelOpen ? 'true' : 'false'}
        aria-controls="workspace-access-panel"
        @click=${this.togglePanel}
      >${icon('share', { size: 18 })}</button>

      <section
        id="workspace-access-panel"
        class="panel"
        role="dialog"
        aria-label="Workspace access"
        ?hidden=${!this.panelOpen}
        aria-hidden=${this.panelOpen ? 'false' : 'true'}
        @keydown=${this.onKeyDown}
      >${this.renderPanelBody(model, true)}</section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-access-manager': MnAccessManager
  }
}
