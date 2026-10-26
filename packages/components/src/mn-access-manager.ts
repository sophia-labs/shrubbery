/**
 * Controlled hosted workspace access popover: the Share dialog.
 *
 * This is the backend-free half of Garden's sharing. It owns only the popover
 * and form state; a shell owns authentication, gateway reads/writes,
 * permissions, confirmation, and error handling. The owner adds people by
 * email (the host grants a known account or invites the address), sees the
 * people with access by name with their roles and pending invitations, and
 * picks one General access (restricted, anyone signed in, anyone with the
 * link). Invite links stay, folded away. Everyone else sees their own role
 * and that only the owner changes access; everyone may copy the graph's link.
 * A join link's URL is displayed only as the host hands it over, once; the
 * public link's URL is the host's to give again.
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

import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
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

export type MnSharingBusyAction = 'everyone' | 'link-create' | 'link-revoke' | 'general' | 'invitation-cancel'

/** General access, one choice: people with access only, every signed-in account, or anyone with the link. */
export type MnGeneralAccess = 'restricted' | 'signed-in' | 'public'

export interface MnShareLink {
  readonly linkId: string
  readonly role: Exclude<MnAccessRole, 'owner'>
  readonly createdAt: string
  readonly expiresAt: string | null
  readonly label: string | null
  readonly live: boolean
}

/** An email invited to the graph; it gets the role when it signs in. */
export interface MnAccessInvitation {
  readonly invitationId: string
  readonly email: string
  readonly role: Exclude<MnAccessRole, 'owner'>
  readonly createdAt: string
  readonly expiresAt: string | null
}

/** What the last "Add people" did: a known account got access, or an email was invited. */
export type MnAccessInviteResult =
  | { readonly outcome: 'granted'; readonly email: string; readonly name: string | null; readonly role: Exclude<MnAccessRole, 'owner'> }
  | { readonly outcome: 'invited'; readonly email: string; readonly role: Exclude<MnAccessRole, 'owner'>; readonly message: string }

export interface MnAccessSharing {
  readonly status: MnAccessStatus
  readonly everyone: boolean
  readonly links: readonly MnShareLink[]
  readonly createdLinkUrl?: string | null
  readonly busyAction?: MnSharingBusyAction | null
  readonly error?: string | null
  /** The one choice the owner sees; absent means it follows `everyone`. */
  readonly generalAccess?: MnGeneralAccess
  /** The public link's page URL while "Anyone with the link" is on. */
  readonly publicLinkUrl?: string | null
  readonly invitations?: readonly MnAccessInvitation[]
}

export interface MnEveryoneChangeDetail {
  readonly enabled: boolean
}

export interface MnGeneralAccessChangeDetail {
  readonly access: MnGeneralAccess
}

export interface MnShareLinkCreateDetail {
  readonly role: Exclude<MnAccessRole, 'owner'>
  readonly expiresInSeconds: number | null
}

export interface MnShareLinkRevokeDetail {
  readonly linkId: string
}

export interface MnAccessInviteDetail {
  readonly email: string
  readonly role: Exclude<MnAccessRole, 'owner'>
}

export interface MnAccessInvitationCancelDetail {
  readonly invitationId: string
}

const LINK_EXPIRY_CHOICES: readonly { readonly value: string, readonly label: string, readonly seconds: number | null }[] = [
  { value: '7d', get label() { return t('7 days') }, seconds: 7 * 24 * 60 * 60 },
  { value: '30d', get label() { return t('30 days') }, seconds: 30 * 24 * 60 * 60 },
  { value: 'never', get label() { return t('Until revoked') }, seconds: null },
]

function shortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(localeSource.get(), { year: 'numeric', month: 'short', day: 'numeric' })
    : iso
}

function roleLabel(role: MnAccessRole): string {
  switch (role) {
    case 'owner': return t('Owner')
    case 'editor': return t('Editor')
    case 'viewer': return t('Viewer')
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

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
  /** Owner sharing controls; absent when the host has no sharing capability. */
  readonly sharing?: MnAccessSharing | null
  /** The signed-in account, so its own row reads "(you)". */
  readonly currentUserId?: string
  /** The graph's address, for "Copy link" (it opens only for people with access). */
  readonly memberLinkUrl?: string | null
  readonly inviteResult?: MnAccessInviteResult | null
  /** A new value opens the dialog (the host asks, e.g. Home's Share button). */
  readonly openRequest?: number | null
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
  protected readonly _locale = new LocaleController(this)

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

    .sharing-section {
      margin-block-start: var(--mn-space-3, 8px);
      padding-block-start: var(--mn-space-3, 8px);
      border-block-start: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }

    .section-title {
      margin-block-end: var(--mn-space-2, 6px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .everyone-row {
      display: flex;
      align-items: flex-start;
      gap: var(--mn-space-2, 6px);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .everyone-row input {
      margin: 2px 0 0;
    }

    .hint {
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
    }

    .link-form {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      align-items: end;
      gap: var(--mn-space-2, 6px);
    }

    .link-create {
      min-height: 32px;
      padding: 0 var(--mn-space-3, 8px);
      border: 1px solid var(--mn-color-border-accent, #356b50);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-action-primary, #356b50);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .created-link {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--mn-space-2, 6px);
      margin-block-start: var(--mn-space-2, 6px);
    }

    .created-link input {
      min-width: 0;
      height: 30px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-2, 6px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-subtle, #f8fafc);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .copy,
    .dismiss {
      min-height: 30px;
      padding: 0 var(--mn-space-2, 6px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 650;
    }

    .link-list {
      margin: var(--mn-space-2, 6px) 0 0;
      padding: 0;
      list-style: none;
    }

    .link-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      min-height: 34px;
      font-size: var(--mn-text-2xs, 10px);
    }

    .link-row.expired {
      opacity: 0.6;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 6px);
      margin-block-end: var(--mn-space-2, 6px);
    }

    .section-header .section-title {
      margin: 0;
    }

    .invite-form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 96px auto;
      align-items: end;
      gap: var(--mn-space-2, 6px);
    }

    .invite-form .validation {
      grid-column: 1 / -1;
    }

    .invite-button {
      min-height: 32px;
      padding: 0 var(--mn-space-3, 8px);
      border: 1px solid var(--mn-color-border-accent, #356b50);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-action-primary, #356b50);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .invite-result {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      margin-block-start: var(--mn-space-2, 6px);
      padding: var(--mn-space-2, 6px) var(--mn-space-3, 8px);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-subtle, #f8fafc);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.4;
    }

    .invite-result .hint {
      grid-column: 1 / -1;
    }

    .member-row.invitation .avatar {
      background: var(--mn-color-surface-subtle, #f3f4f6);
      color: var(--mn-color-text-muted, #6b7280);
    }

    .you {
      color: var(--mn-color-text-muted, #6b7280);
      font-weight: 500;
    }

    .general-options {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 6px);
    }

    .public-link {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-2, 6px);
      margin-block-start: var(--mn-space-2, 6px);
    }

    .public-link input {
      min-width: 0;
      height: 30px;
      box-sizing: border-box;
      padding: 0 var(--mn-space-2, 6px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-subtle, #f8fafc);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    details.invite-links > summary {
      cursor: pointer;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    details.invite-links[open] > summary {
      margin-block-end: var(--mn-space-2, 6px);
    }

    .invite-links-note {
      margin: 0 0 var(--mn-space-2, 6px);
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 6px);
      margin-block-start: var(--mn-space-3, 8px);
      padding-block-start: var(--mn-space-3, 8px);
      border-block-start: 1px solid var(--mn-color-border-subtle, #e5e7eb);
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
      .optional-fields,
      .invite-form {
        grid-template-columns: 1fr;
      }
    }
  `

  @property({ attribute: false }) model: MnAccessManagerModel | null = null
  /** Wave-1 leaf mode (this file's own header) — default false; unset by every existing (chrome) consumer. */
  @property({ type: Boolean, reflect: true }) embedded = false

  @state() private panelOpen = false
  @state() private addEmail = ''
  @state() private addRole: 'viewer' | 'editor' = 'editor'
  @state() private validationError = ''
  @state() private linkRole: 'viewer' | 'editor' = 'viewer'
  @state() private linkExpiry = '30d'
  /** Which copy button last succeeded (`link`, `message`, `public`, `member`). */
  @state() private copiedKey: string | null = null
  private pendingAddKey: string | null = null
  private seenOpenRequest: number | null = null

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
    const pending = this.pendingAddKey
    if (pending && (this.model?.grants.some(grant => grant.userId === pending || grant.email?.toLowerCase() === pending)
      || this.model?.inviteResult?.email === pending)) {
      this.addEmail = ''
      this.pendingAddKey = null
      this.validationError = ''
    } else if (pending && this.model?.error) {
      this.pendingAddKey = null
    }
    const request = this.model?.openRequest
    if (typeof request === 'number' && request !== this.seenOpenRequest) {
      this.seenOpenRequest = request
      if (!this.embedded && !this.panelOpen) void this.openPanel()
    }
  }

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private async openPanel(): Promise<void> {
    if (!this.model) return
    this.panelOpen = true
    this.validationError = ''
    this.emit('mn-access-open')
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(
      this.model?.currentRole === 'owner' && this.model.status === 'ready' ? '[name="access-email"]' : '.close',
    )?.focus()
  }

  private async togglePanel(): Promise<void> {
    if (!this.model) return
    if (this.panelOpen) {
      this.closePanel()
      return
    }
    await this.openPanel()
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

  /** Add people: an email shares or invites; a typed `user:<subject>` is a direct grant, as before. */
  private add(event: SubmitEvent): void {
    event.preventDefault()
    const model = this.model
    if (!model || model.currentRole !== 'owner' || model.status !== 'ready' || model.busyAction) return
    const value = this.addEmail.trim()
    if (/^user:[^\s]+$/u.test(value)) {
      if (model.grants.some(grant => grant.userId === value)) {
        this.validationError = t('sharing.alreadyHasAccess')
        return
      }
      this.validationError = ''
      this.pendingAddKey = value
      this.emit('mn-access-add', { userId: value, role: this.addRole } satisfies MnAccessAddDetail)
      return
    }
    const email = value.toLowerCase()
    if (!EMAIL.test(email)) {
      this.validationError = t('sharing.invalidEmail')
      return
    }
    if (model.grants.some(grant => grant.email?.trim().toLowerCase() === email)) {
      this.validationError = t('sharing.alreadyHasAccess')
      return
    }
    this.validationError = ''
    this.pendingAddKey = email
    this.copiedKey = null
    this.emit('mn-access-invite', { email, role: this.addRole } satisfies MnAccessInviteDetail)
  }

  private async copy(key: string, text: string, fallbackField?: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      this.copiedKey = key
    } catch {
      // Clipboard can be denied; a visible field stays selectable for manual copy.
      if (fallbackField) this.renderRoot.querySelector<HTMLInputElement>(`[name="${fallbackField}"]`)?.select()
    }
  }

  private copyButton(key: string, text: string, label: string, fallbackField?: string) {
    return html`<button class="copy" type="button" data-copy=${key} @click=${() => void this.copy(key, text, fallbackField)}>
      ${this.copiedKey === key ? t('sharing.copied') : label}
    </button>`
  }

  private createLink(event: SubmitEvent): void {
    event.preventDefault()
    const sharing = this.model?.sharing
    if (!sharing || sharing.busyAction || this.model?.currentRole !== 'owner') return
    const choice = LINK_EXPIRY_CHOICES.find(item => item.value === this.linkExpiry) ?? LINK_EXPIRY_CHOICES[1]
    if (this.copiedKey === 'link') this.copiedKey = null
    this.emit('mn-access-link-create', {
      role: this.linkRole,
      expiresInSeconds: choice.seconds,
    } satisfies MnShareLinkCreateDetail)
  }

  private generalAccess(sharing: MnAccessSharing): MnGeneralAccess {
    return sharing.generalAccess ?? (sharing.everyone ? 'signed-in' : 'restricted')
  }

  private renderGeneralAccess(sharing: MnAccessSharing) {
    const busy = Boolean(sharing.busyAction) || sharing.status !== 'ready'
    const current = this.generalAccess(sharing)
    const option = (value: MnGeneralAccess, label: string, hint: string) => html`<label class="everyone-row">
      <input
        type="radio"
        name="access-general"
        .value=${value}
        .checked=${live(current === value)}
        ?disabled=${busy}
        @change=${(event: Event) => {
          if (!(event.currentTarget as HTMLInputElement).checked) return
          this.emit('mn-access-general-change', { access: value } satisfies MnGeneralAccessChangeDetail)
        }}
      />
      <span>
        ${label}
        <div class="hint">${hint}</div>
      </span>
    </label>`
    return html`<div class="sharing-section" aria-label=${t('General access')} role="group">
      <div class="section-title">${t('General access')}</div>
      <div class="general-options" role="radiogroup" aria-label=${t('General access')}>
        ${option('restricted', t('sharing.restricted'), t('sharing.restrictedHint'))}
        ${option('signed-in', t('sharing.signedIn'), t('sharing.signedInHint'))}
        ${option('public', t('sharing.public'), t('sharing.publicHint'))}
      </div>
      ${current === 'public' && sharing.publicLinkUrl ? html`<div class="public-link">
        <input name="public-link-url" readonly .value=${sharing.publicLinkUrl} aria-label=${t('sharing.publicLinkLabel')} data-private="true" />
        ${this.copyButton('public', sharing.publicLinkUrl, t('sharing.copyLink'), 'public-link-url')}
      </div>` : nothing}
    </div>`
  }

  private renderInviteLinks(sharing: MnAccessSharing) {
    const busy = Boolean(sharing.busyAction) || sharing.status === 'loading'
    const now = Date.now()
    return html`<details class="sharing-section invite-links" ?open=${Boolean(sharing.createdLinkUrl)}>
      <summary>${t('sharing.inviteLinks')}</summary>
      <p class="hint invite-links-note">${t('sharing.inviteLinksNote')}</p>
      <form class="link-form" @submit=${this.createLink} novalidate>
        <label class="field">
          <span>${t('Link gives')}</span>
          <select
            name="share-link-role"
            .value=${this.linkRole}
            ?disabled=${busy}
            @change=${(event: Event) => { this.linkRole = (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor' }}
          >
            <option value="viewer">${t('Viewer')}</option>
            <option value="editor">${t('Editor')}</option>
          </select>
        </label>
        <label class="field">
          <span>${t('Expires')}</span>
          <select
            name="share-link-expiry"
            .value=${this.linkExpiry}
            ?disabled=${busy}
            @change=${(event: Event) => { this.linkExpiry = (event.currentTarget as HTMLSelectElement).value }}
          >
            ${LINK_EXPIRY_CHOICES.map(choice => html`<option value=${choice.value}>${choice.label}</option>`)}
          </select>
        </label>
        <button class="link-create" type="submit" ?disabled=${busy || sharing.status !== 'ready'}>
          ${sharing.busyAction === 'link-create' ? t('sharing.creating') : t('Create link')}
        </button>
      </form>
      ${sharing.createdLinkUrl ? html`<div class="created-link" role="status" aria-live="polite">
        <input name="share-link-url" readonly .value=${sharing.createdLinkUrl} aria-label=${t('New share link')} data-private="true" />
        ${this.copyButton('link', sharing.createdLinkUrl, t('Copy'), 'share-link-url')}
        <button class="dismiss" type="button" aria-label=${t('Hide link')} @click=${() => {
          if (this.copiedKey === 'link') this.copiedKey = null
          this.emit('mn-access-link-dismiss')
        }}>${t('Done')}</button>
      </div>
      <div class="hint">${t('Copy it now: the link is shown only once. Anyone who opens it and signs in joins with the link\'s role.')}</div>` : nothing}
      ${sharing.links.length ? html`<ul class="link-list" aria-label=${t('Share links')}>
        ${sharing.links.map(link => {
          const expired = !link.live || (link.expiresAt !== null && Date.parse(link.expiresAt) <= now)
          const created = shortDate(link.createdAt)
          return html`<li class="link-row ${expired ? 'expired' : ''}" data-link-id=${link.linkId}>
            <span>
              ${link.label ? html`${link.label} · ` : nothing}${t('sharing.linkCreated', { date: created })}
              <span class="hint">${expired
                ? t('sharing.linkExpired')
                : link.expiresAt ? t('sharing.linkUntil', { date: shortDate(link.expiresAt) }) : t('sharing.linkUntilRevoked')}</span>
            </span>
            <span class="role ${link.role}">${roleLabel(link.role)}</span>
            <button
              class="remove"
              type="button"
              aria-label=${t('sharing.revokeLinkFor', { role: roleLabel(link.role), date: created })}
              title=${t('Revoke link')}
              ?disabled=${busy}
              @click=${() => this.emit('mn-access-link-revoke', { linkId: link.linkId } satisfies MnShareLinkRevokeDetail)}
            >${icon('x', { size: 14 })}</button>
          </li>`
        })}
      </ul>` : sharing.status === 'ready'
        ? html`<div class="hint">${t('No share links yet.')}</div>`
        : nothing}
    </details>`
  }

  private renderSharing(model: MnAccessManagerModel) {
    const sharing = model.sharing
    if (!sharing || model.currentRole !== 'owner') return nothing
    return html`<div class="sharing-body">
      ${sharing.error ? html`<div class="error" role="alert">${sharing.error}</div>` : nothing}
      ${this.renderGeneralAccess(sharing)}
      ${this.renderInviteLinks(sharing)}
    </div>`
  }

  private renderGrant(grant: MnAccessGrant) {
    const model = this.model!
    const canManage = model.currentRole === 'owner' && grant.role !== 'owner'
    const busy = Boolean(model.busyAction) || model.status !== 'ready'
    const label = identity(grant)
    const you = Boolean(model.currentUserId) && grant.userId === model.currentUserId
    return html`<li class="member-row" data-user-id=${grant.userId} data-private="true">
      <span class="avatar" aria-hidden="true">${initials(grant)}</span>
      <div class="identity">
        <div class="name">${label}${you ? html` <span class="you">${t('sharing.you')}</span>` : nothing}</div>
        ${grant.displayName && grant.email
          ? html`<div class="secondary">${grant.email}</div>`
          : nothing}
        ${!grant.displayName && !grant.email && !you
          ? html`<div class="user-id" title=${grant.userId}>${grant.userId}</div>`
          : nothing}
      </div>
      ${canManage ? html`<select
        class="role-select"
        aria-label=${t('sharing.roleFor', { name: label })}
        .value=${grant.role}
        ?disabled=${busy}
        @change=${(event: Event) => this.emit('mn-access-role-change', {
          userId: grant.userId,
          role: (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor',
        } satisfies MnAccessRoleChangeDetail)}
      >
        <option value="editor">${t('Editor')}</option>
        <option value="viewer">${t('Viewer')}</option>
      </select>` : html`<span class="role ${grant.role}">${roleLabel(grant.role)}</span>`}
      ${canManage ? html`<button
        class="remove"
        type="button"
        aria-label=${t('sharing.removePerson', { name: label })}
        title=${t('Remove member')}
        ?disabled=${busy}
        @click=${() => this.emit('mn-access-remove', { userId: grant.userId } satisfies MnAccessRemoveDetail)}
      >${icon('x', { size: 14 })}</button>` : nothing}
    </li>`
  }

  private renderInvitation(invitation: MnAccessInvitation, busy: boolean) {
    return html`<li class="member-row invitation" data-invitation-id=${invitation.invitationId} data-private="true">
      <span class="avatar" aria-hidden="true">${invitation.email.slice(0, 1).toLocaleUpperCase()}</span>
      <div class="identity">
        <div class="name">${invitation.email}</div>
        <div class="secondary">${t('sharing.invitedRole', { role: roleLabel(invitation.role) })}</div>
      </div>
      <span></span>
      <button
        class="remove"
        type="button"
        aria-label=${t('sharing.cancelInvitationFor', { email: invitation.email })}
        title=${t('sharing.cancelInvitation')}
        ?disabled=${busy}
        @click=${() => this.emit('mn-access-invitation-cancel', { invitationId: invitation.invitationId } satisfies MnAccessInvitationCancelDetail)}
      >${icon('x', { size: 14 })}</button>
    </li>`
  }

  private renderInviteResult(model: MnAccessManagerModel) {
    const result = model.inviteResult
    if (!result) return nothing
    if (result.outcome === 'granted') {
      const name = result.name?.trim() || result.email
      return html`<div class="invite-result" role="status" aria-live="polite" data-outcome="granted">
        <span>${result.role === 'editor' ? t('sharing.grantedEditor', { name }) : t('sharing.grantedViewer', { name })}</span>
      </div>`
    }
    return html`<div class="invite-result" role="status" aria-live="polite" data-outcome="invited">
      <span><strong>${result.email}</strong><br />${t('sharing.invited')}</span>
      ${this.copyButton('message', result.message, t('sharing.copyMessage'))}
      <div class="hint">${t('sharing.noEmailSent')}</div>
    </div>`
  }

  private renderAddPeople() {
    const model = this.model!
    if (model.currentRole !== 'owner') return nothing
    const busy = Boolean(model.busyAction) || model.status !== 'ready'
    return html`<div class="sharing-section add-people" role="group" aria-label=${t('sharing.addPeople')}>
      <div class="section-title">${t('sharing.addPeople')}</div>
      <form class="invite-form" @submit=${this.add} novalidate>
        <label class="field">
          <span>${t('sharing.emailLabel')}</span>
          <input
            name="access-email"
            type="email"
            autocomplete="off"
            inputmode="email"
            placeholder=${t('sharing.emailPlaceholder')}
            .value=${this.addEmail}
            ?disabled=${busy}
            @input=${(event: Event) => {
              this.addEmail = (event.currentTarget as HTMLInputElement).value
              this.validationError = ''
            }}
          />
        </label>
        <label class="field">
          <span>${t('Role')}</span>
          <select
            name="access-role"
            .value=${this.addRole}
            ?disabled=${busy}
            @change=${(event: Event) => { this.addRole = (event.currentTarget as HTMLSelectElement).value as 'viewer' | 'editor' }}
          >
            <option value="editor">${t('Editor')}</option>
            <option value="viewer">${t('Viewer')}</option>
          </select>
        </label>
        <button class="invite-button" type="submit" ?disabled=${busy || !this.addEmail.trim()}>
          ${model.busyAction === 'add' ? t('sharing.sharing') : t('sharing.share')}
        </button>
        ${this.validationError
          ? html`<div class="validation" role="alert">${this.validationError}</div>`
          : nothing}
      </form>
      ${this.renderInviteResult(model)}
    </div>`
  }

  private renderPeople(model: MnAccessManagerModel) {
    const invitations: readonly MnAccessInvitation[] = model.currentRole === 'owner' ? model.sharing?.invitations ?? [] : []
    const busy = Boolean(model.busyAction) || model.status !== 'ready' || Boolean(model.sharing?.busyAction)
    return html`<div class="sharing-section people" role="group" aria-label=${t('sharing.peopleWithAccess')}>
      <div class="section-header">
        <div class="section-title">${t('sharing.peopleWithAccess')}</div>
        <button
          class="refresh"
          type="button"
          aria-label=${t('Refresh workspace access')}
          title=${t('sharing.refreshPeople')}
          ?disabled=${Boolean(model.busyAction) || model.status === 'loading'}
          @click=${() => this.emit('mn-access-refresh')}
        >${icon('refresh-cw', { size: 14 })}</button>
      </div>
      ${model.status === 'loading' && model.grants.length === 0
        ? html`<div class="state" role="status" aria-live="polite">${t('sharing.loadingPeople')}</div>`
        : nothing}
      ${model.status === 'error' && model.grants.length === 0 && !model.error
        ? html`<div class="state">${t('sharing.peopleUnavailable')}</div>`
        : nothing}
      ${model.grants.length > 0 || invitations.length > 0
        ? html`<ul class="member-list" aria-label=${t('Workspace members')}>
            ${model.grants.map(grant => this.renderGrant(grant))}
            ${invitations.map(invitation => this.renderInvitation(invitation, busy))}
          </ul>`
        : nothing}
    </div>`
  }

  private renderReadOnlySummary(model: MnAccessManagerModel) {
    if (model.currentRole === 'owner') return nothing
    const summary = model.currentRole === 'editor'
      ? t('sharing.readOnlyEditor')
      : model.currentRole === 'viewer'
        ? t('sharing.readOnlyViewer')
        : t('sharing.readOnlyUnknown')
    return html`<div class="permission-note" role="note">
      <div>${summary}</div>
      <div>${t('sharing.ownerManages')}</div>
    </div>`
  }

  private renderFooter(model: MnAccessManagerModel) {
    if (!model.memberLinkUrl) return nothing
    return html`<div class="footer">
      <span class="hint">${t('sharing.memberLinkHint')}</span>
      ${this.copyButton('member', model.memberLinkUrl, t('sharing.copyLink'))}
    </div>`
  }

  /**
   * The dialog's content, shared verbatim by the popover-mode `.panel` and the
   * Wave-1 `embedded` mode; only the wrapper around this differs (this file's
   * own header). Wrapped in a real static `<div class="panel-body">` —
   * empirically required (see `mn-workspace-selector.ts`'s `renderMenuBody()`,
   * the same fix): a nested `TemplateResult` mounted one level deeper than its
   * original inline call site needs a real static element as its own outermost
   * node in this lit-html/happy-dom combination, or content silently fails to
   * render. `.panel-body` carries no styling of its own.
   *
   * Owners see Add people, People with access (with pending invitations),
   * General access and the folded Invite links; everyone else sees their role
   * and that only the owner changes access. Everyone gets Copy link.
   */
  private renderPanelBody(model: MnAccessManagerModel, closeButton: boolean) {
    const owner = model.currentRole === 'owner'
    return html`<div class="panel-body">
      <div class="header">
        <div class="heading">
          <div class="title">${t('sharing.title', { name: model.graphTitle || model.graphId })}</div>
        </div>
        ${closeButton ? html`<button class="close" type="button" aria-label=${t('Close workspace access')} @click=${this.closePanel}>
          ${icon('x', { size: 15 })}
        </button>` : nothing}
      </div>

      ${model.error ? html`<div class="error-row">
        <div class="error" role="alert">${model.error}</div>
        ${model.status === 'error' && owner
          ? html`<button class="retry" type="button" @click=${() => this.emit('mn-access-refresh')}>${t('Retry')}</button>`
          : nothing}
      </div>` : nothing}
      ${model.notice ? html`<div class="notice" role="status" aria-live="polite">${model.notice}</div>` : nothing}

      ${this.renderReadOnlySummary(model)}
      ${this.renderAddPeople()}
      ${owner || model.grants.length > 0 ? this.renderPeople(model) : nothing}
      ${this.renderSharing(model)}
      ${this.renderFooter(model)}
    </div>`
  }

  private renderEmbedded(model: MnAccessManagerModel) {
    return html`<section
      class="embedded-panel"
      role="group"
      aria-label=${t('Workspace access')}
      @keydown=${this.onKeyDown}
    >${this.renderPanelBody(model, false)}</section>`
  }

  render() {
    const model = this.model
    if (!model) return nothing
    if (this.embedded) return this.renderEmbedded(model)
    const hasSharedMembers = model.grants.some(grant => grant.role !== 'owner')
      || Boolean(model.sharing && (model.sharing.everyone || model.sharing.generalAccess === 'public'))
    return html`
      <button
        class="trigger ${hasSharedMembers ? 'active' : ''}"
        type="button"
        aria-label=${t('Manage workspace access')}
        aria-haspopup="dialog"
        aria-expanded=${this.panelOpen ? 'true' : 'false'}
        aria-controls="workspace-access-panel"
        @click=${this.togglePanel}
      >${icon('share', { size: 18 })}</button>

      <section
        id="workspace-access-panel"
        class="panel"
        role="dialog"
        aria-label=${t('Workspace access')}
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
