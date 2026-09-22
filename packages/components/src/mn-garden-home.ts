/**
 * Controlled account-level Garden home.
 *
 * This is the doorway into graphs, not the existing graph-scoped mn-home-view.
 * The host supplies account and graph-catalog truth; this component emits only
 * graph, access, account, refresh, and create intents. Object kinds and their
 * compatible faces belong to Emporium inside an opened graph — Home never
 * invents an invitation inbox, app template, or launchable "surface".
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { workspaceDisplayPath } from './mn-workspace-selector-model.js'
import type {
  MnWorkspaceRole,
  MnWorkspaceSummary,
} from './mn-workspace-selector-model.js'
import './mn-avatar.js'
import './mn-badge.js'
import './mn-button.js'

export type MnGardenHomeStatus = 'idle' | 'loading' | 'ready' | 'error'
export type MnGardenHomeCreateStatus = 'idle' | 'creating' | 'error'

export interface MnGardenHomeAccount {
  readonly userId: string
  readonly displayName: string
  readonly email?: string
  readonly avatarUrl?: string
}

export interface MnGardenHomeWorkspaceDetail {
  readonly workspace: MnWorkspaceSummary
}

export type MnGardenHomeCreateDetail = Readonly<Record<string, never>>

export interface MnGardenHomeAccountDetail {
  readonly account: MnGardenHomeAccount
}

export interface MnGardenHomeIntentDetailMap {
  readonly 'mn-garden-home-refresh': Readonly<Record<string, never>>
  readonly 'mn-garden-home-open-graph': MnGardenHomeWorkspaceDetail
  readonly 'mn-garden-home-manage-access': MnGardenHomeWorkspaceDetail
  readonly 'mn-garden-home-create': MnGardenHomeCreateDetail
  readonly 'mn-garden-home-account': MnGardenHomeAccountDetail
}

function workspaceTitle(workspace: MnWorkspaceSummary): string {
  return workspace.title.trim() || workspace.graphId
}

function roleLabel(role: MnWorkspaceRole): string {
  switch (role) {
    case 'owner': return 'Owner'
    case 'editor': return 'Editor'
    case 'viewer': return 'Viewer'
  }
}

function memberLabel(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
  const integer = Math.floor(count)
  return `${integer} ${integer === 1 ? 'member' : 'members'}`
}

function relativeTime(timestamp: number | null | undefined): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    .format(new Date(timestamp))
}

function initials(account: MnGardenHomeAccount): string {
  const source = account.displayName.trim() || account.email?.trim() || account.userId
  if (source.includes('@')) return source.slice(0, 1).toLocaleUpperCase()
  return source.split(/\s+/u).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase()
}

function firstName(account: MnGardenHomeAccount | null): string | null {
  const name = account?.displayName.trim()
  return name ? name.split(/\s+/u)[0]! : null
}

@customElement('mn-garden-home')
export class MnGardenHome extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      min-width: 0;
      min-height: 100%;
      color: var(--mn-color-text-primary, #18211b);
      background: var(--mn-color-surface-canvas, #f5f3ed);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    *, *::before, *::after { box-sizing: border-box; }
    button { font: inherit; }

    .home {
      min-height: 100%;
      background-color: var(--mn-color-surface-canvas, #f5f3ed);
      background-image: var(--mn-atmosphere, none);
    }

    .masthead {
      display: flex;
      min-height: 58px;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-4, 1rem);
      padding: 0 max(var(--mn-space-6, 1.5rem), calc((100vw - 1120px) / 2));
      border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
      background: var(--mn-color-surface-raised, rgba(255, 254, 249, 0.9));
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      color: var(--mn-color-text-accent-strong, #2d6a4f);
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-lg, 1.125rem);
      font-weight: 650;
      letter-spacing: -0.02em;
    }

    .account {
      display: inline-flex;
      min-height: 42px;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      padding: 4px 6px;
      border: 0;
      border-radius: var(--mn-radius-control, 8px);
      background: transparent;
      color: var(--mn-color-text-secondary, #526159);
      cursor: pointer;
      text-align: left;
    }

    .account:hover { background: var(--mn-color-surface-hover, #eef2ed); }
    .account:focus-visible,
    .open-graph:focus-visible,
    .recent-card:focus-visible,
    .access:focus-visible,
    .create-toggle:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #376d57));
      outline-offset: 2px;
    }

    .account-copy {
      display: grid;
      min-width: 0;
    }

    .account-name,
    .account-email {
      overflow: hidden;
      max-width: 24ch;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .account-name { color: var(--mn-color-text-primary, #18211b); font-size: var(--mn-text-sm, 0.8125rem); font-weight: 650; }
    .account-email { color: var(--mn-color-text-muted, #66736a); font-size: var(--mn-text-xs, 0.75rem); }

    main {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: clamp(2rem, 6vw, 4.5rem) var(--mn-space-6, 1.5rem) var(--mn-space-16, 4rem);
    }

    .intro { max-width: 700px; margin-bottom: clamp(2rem, 5vw, 3.5rem); }

    h1 {
      margin: 0;
      color: var(--mn-color-text-title, var(--mn-color-text-primary, #18211b));
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: clamp(2.2rem, 6vw, 4.25rem);
      font-weight: 500;
      letter-spacing: -0.055em;
      line-height: 0.98;
    }

    .lede {
      max-width: 58ch;
      margin: var(--mn-space-4, 1rem) 0 0;
      color: var(--mn-color-text-secondary, #526159);
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: clamp(1rem, 2vw, 1.15rem);
      line-height: 1.55;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.75fr) minmax(270px, 0.85fr);
      gap: clamp(2rem, 5vw, 4rem);
      align-items: start;
    }

    .column { min-width: 0; }
    section + section { margin-top: var(--mn-space-10, 2.5rem); }

    .section-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-3, 0.75rem);
      margin-bottom: var(--mn-space-3, 0.75rem);
      padding-bottom: var(--mn-space-2, 0.5rem);
      border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
    }

    h2 {
      margin: 0;
      color: var(--mn-color-text-primary, #18211b);
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-lg, 1.125rem);
      font-weight: 600;
    }

    .section-count,
    .quiet {
      color: var(--mn-color-text-muted, #66736a);
      font-size: var(--mn-text-xs, 0.75rem);
    }

    .recent-list,
    .graph-list {
      display: grid;
      gap: var(--mn-space-3, 0.75rem);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .recent-card {
      display: grid;
      width: 100%;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: var(--mn-space-3, 0.75rem);
      align-items: center;
      min-height: 76px;
      padding: var(--mn-space-4, 1rem);
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffef9);
      color: inherit;
      cursor: pointer;
      text-align: left;
      transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
    }

    .recent-card:hover:not(:disabled) {
      border-color: var(--mn-color-border-accent, #89a996);
      background: var(--mn-color-surface-accent, #edf6ef);
      transform: translateY(-1px);
    }

    .recent-card:disabled,
    .open-graph:disabled,
    .access:disabled { cursor: not-allowed; opacity: 0.55; }

    .recent-glyph {
      display: inline-flex;
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--mn-color-surface-accent, #edf6ef);
      color: var(--mn-color-text-accent, #376d57);
    }

    .recent-copy { display: grid; min-width: 0; gap: 2px; }
    .recent-title { overflow: hidden; font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif)); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .recent-meta { color: var(--mn-color-text-muted, #66736a); font-size: var(--mn-text-xs, 0.75rem); }

    .graph-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-3, 0.75rem) var(--mn-space-4, 1rem);
      padding: var(--mn-space-4, 1rem);
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffef9);
    }

    .graph-main { min-width: 0; }

    .graph-heading {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
    }

    .graph-heading h3 {
      flex: 1;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      font-size: inherit;
      font-weight: inherit;
    }

    .open-graph {
      min-width: 0;
      overflow: hidden;
      padding: 3px 0;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #18211b);
      cursor: pointer;
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-base, 0.9375rem);
      font-weight: 650;
      text-align: left;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 3px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .open-graph:hover:not(:disabled) { color: var(--mn-color-text-accent-strong, #2d6a4f); text-decoration-color: currentColor; }

    .graph-reference,
    .graph-testimony {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 0.5rem);
      margin-top: 5px;
      color: var(--mn-color-text-muted, #66736a);
      font-size: var(--mn-text-xs, 0.75rem);
      line-height: 1.4;
    }

    .graph-reference code { overflow-wrap: anywhere; font-family: var(--mn-font-mono, ui-monospace, monospace); }

    .access {
      min-height: 32px;
      border: 1px solid var(--mn-color-border-default, #ccd6cf);
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #526159);
      cursor: pointer;
      font-size: var(--mn-text-xs, 0.75rem);
    }

    .access:hover:not(:disabled) { border-color: var(--mn-color-border-accent, #89a996); background: var(--mn-color-surface-accent, #edf6ef); color: var(--mn-color-text-accent-strong, #2d6a4f); }

    .graph-actions { display: flex; align-items: flex-start; }
    .access { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; }

    .disabled-reason {
      grid-column: 1 / -1;
      margin: 0;
      padding: var(--mn-space-2, 0.5rem) var(--mn-space-3, 0.75rem);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-warning-surface, #fff8e7);
      color: var(--mn-color-warning-strong, #8a5a10);
      font-size: var(--mn-text-xs, 0.75rem);
    }

    .side-card {
      padding: var(--mn-space-4, 1rem);
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffef9);
    }

    .side-card p { margin: 0; color: var(--mn-color-text-secondary, #526159); font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif)); font-size: var(--mn-text-sm, 0.8125rem); line-height: 1.5; }
    .create-toggle {
      display: inline-flex;
      min-height: 36px;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      margin-top: var(--mn-space-4, 1rem);
      padding: 0 var(--mn-space-3, 0.75rem);
      border: 1px solid var(--mn-color-border-default, #ccd6cf);
      border-radius: var(--mn-radius-control, 7px);
      background: var(--mn-color-surface-hover, #eef2ed);
      color: var(--mn-color-text-primary, #18211b);
      cursor: pointer;
      font-size: var(--mn-text-sm, 0.8125rem);
      font-weight: 650;
    }

    .create-toggle:hover:not(:disabled) {
      border-color: var(--mn-color-border-accent, #89a996);
      background: var(--mn-color-surface-accent, #edf6ef);
      color: var(--mn-color-text-accent-strong, #2d6a4f);
    }

    .create-toggle:disabled { cursor: not-allowed; opacity: 0.55; }

    .state {
      display: grid;
      min-height: 180px;
      place-items: center;
      padding: var(--mn-space-8, 2rem);
      border: 1px solid var(--mn-color-border-subtle, #d8ded9);
      border-radius: var(--mn-radius-surface, 10px);
      background: var(--mn-color-surface-raised, #fffef9);
      color: var(--mn-color-text-muted, #66736a);
      text-align: center;
    }

    .state-copy { max-width: 44ch; }
    .state h2 { margin-bottom: var(--mn-space-2, 0.5rem); }
    .state p { margin: 0; line-height: 1.5; }
    .state mn-button { margin-top: var(--mn-space-4, 1rem); }
    .error { color: var(--mn-color-danger-strong, #9d2b2b); }

    @media (max-width: 780px) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .masthead { padding-inline: var(--mn-space-4, 1rem); }
      main { padding-inline: var(--mn-space-4, 1rem); }
      .account-email { display: none; }
    }

    @media (max-width: 520px) {
      .account-copy { display: none; }
      .graph-card { grid-template-columns: minmax(0, 1fr); }
      .graph-actions { justify-content: flex-start; }
      .recent-card { grid-template-columns: auto minmax(0, 1fr); }
      .recent-card > .arrow { display: none; }
      .access { min-height: 40px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .recent-card { transition: none; }
      .recent-card:hover:not(:disabled) { transform: none; }
    }
  `

  @property({ attribute: false }) account: MnGardenHomeAccount | null = null
  @property({ attribute: false }) workspaces: readonly MnWorkspaceSummary[] = []
  @property({ type: String }) status: MnGardenHomeStatus = 'idle'
  @property({ type: String }) error: string | null = null
  @property({ attribute: false }) busyGraphId: string | null = null
  @property({ type: String, attribute: 'create-status' }) createStatus: MnGardenHomeCreateStatus = 'idle'
  @property({ type: String, attribute: 'create-error' }) createError: string | null = null

  private emit<Name extends keyof MnGardenHomeIntentDetailMap>(
    name: Name,
    detail: MnGardenHomeIntentDetailMap[Name],
  ): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private recentWorkspaces(): readonly MnWorkspaceSummary[] {
    return this.workspaces
      .filter(workspace => !workspace.disabled && typeof workspace.lastOpenedAt === 'number' && Number.isFinite(workspace.lastOpenedAt))
      .slice()
      .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))
      .slice(0, 3)
  }

  private openGraph(workspace: MnWorkspaceSummary): void {
    if (workspace.disabled || this.busyGraphId === workspace.graphId) return
    this.emit('mn-garden-home-open-graph', { workspace })
  }

  private renderMasthead() {
    return html`
      <header class="masthead">
        <div class="brand" aria-label="Garden home">
          ${icon('sprout', { size: 18 })}
          <span>Garden</span>
        </div>
        ${this.account ? html`
          <button
            class="account"
            type="button"
            aria-label="Open account"
            @click=${() => this.emit('mn-garden-home-account', { account: this.account! })}
          >
            <mn-avatar
              size="sm"
              .src=${this.account.avatarUrl ?? ''}
              .alt=${this.account.displayName || this.account.email || 'Account'}
              .initials=${initials(this.account)}
            ></mn-avatar>
            <span class="account-copy">
              <span class="account-name">${this.account.displayName || 'Garden account'}</span>
              ${this.account.email ? html`<span class="account-email">${this.account.email}</span>` : nothing}
            </span>
            ${icon('chevron-down', { size: 14 })}
          </button>
        ` : nothing}
      </header>
    `
  }

  private renderRecent(workspaces: readonly MnWorkspaceSummary[]) {
    if (workspaces.length === 0) return nothing
    return html`
      <section aria-labelledby="garden-continue-heading">
        <div class="section-heading">
          <h2 id="garden-continue-heading">Continue</h2>
          <span class="section-count">Recent graphs</span>
        </div>
        <ol class="recent-list">
          ${workspaces.map(workspace => {
            const time = relativeTime(workspace.lastOpenedAt)
            const busy = this.busyGraphId === workspace.graphId
            return html`
              <li>
                <button
                  class="recent-card"
                  type="button"
                  ?disabled=${busy}
                  aria-busy=${busy ? 'true' : 'false'}
                  @click=${() => this.openGraph(workspace)}
                >
                  <span class="recent-glyph" aria-hidden="true">${icon('book-open', { size: 17 })}</span>
                  <span class="recent-copy">
                    <span class="recent-title">${workspaceTitle(workspace)}</span>
                    <span class="recent-meta">${busy ? 'Opening…' : time ? `Opened ${time}` : roleLabel(workspace.role)}</span>
                  </span>
                  <span class="arrow" aria-hidden="true">${icon('arrow-right', { size: 16 })}</span>
                </button>
              </li>
            `
          })}
        </ol>
      </section>
    `
  }

  private renderGraph(workspace: MnWorkspaceSummary) {
    const title = workspaceTitle(workspace)
    const path = workspaceDisplayPath(workspace)
    const count = memberLabel(workspace.memberCount)
    const time = relativeTime(workspace.lastOpenedAt)
    const busy = this.busyGraphId === workspace.graphId
    const disabled = Boolean(workspace.disabled) || busy
    return html`
      <li>
        <article class="graph-card" data-graph-id=${workspace.graphId}>
          <div class="graph-main">
            <div class="graph-heading">
              <h3>
                <button
                  class="open-graph"
                  type="button"
                  title=${title}
                  ?disabled=${disabled}
                  aria-busy=${busy ? 'true' : 'false'}
                  @click=${() => this.openGraph(workspace)}
                >${busy ? `Opening ${title}…` : title}</button>
              </h3>
              <mn-badge pill size="sm" .label=${roleLabel(workspace.role)}></mn-badge>
            </div>
            ${path.length > 0 ? html`
              <div class="graph-reference" aria-label="Graph reference">
                ${path.map(segment => html`<code>${segment}</code>`)}
              </div>
            ` : nothing}
            ${(count || time) ? html`
              <div class="graph-testimony">
                ${count ? html`<span>${count}</span>` : nothing}
                ${time ? html`<span>Opened ${time}</span>` : nothing}
              </div>
            ` : nothing}
          </div>
          <div class="graph-actions">
            <button
              class="access"
              type="button"
              ?disabled=${busy}
              aria-label=${workspace.role === 'owner' ? `Manage access to ${title}` : `View people in ${title}`}
              @click=${() => this.emit('mn-garden-home-manage-access', { workspace })}
            >
              ${icon('share', { size: 14 })}
              <span>${workspace.role === 'owner' ? 'Share' : 'People'}</span>
            </button>
          </div>
          ${workspace.disabled ? html`
            <p class="disabled-reason">${workspace.disabledReason?.trim() || 'This graph is not available to open.'}</p>
          ` : nothing}
        </article>
      </li>
    `
  }

  private renderCatalog() {
    return html`
      <section aria-labelledby="garden-all-heading">
        <div class="section-heading">
          <h2 id="garden-all-heading">All graphs</h2>
          <span class="section-count">${this.workspaces.length}</span>
        </div>
        ${this.workspaces.length > 0
          ? html`<ol class="graph-list">${this.workspaces.map(workspace => this.renderGraph(workspace))}</ol>`
          : html`
              <div class="side-card">
                <p>You do not have any graphs yet. Plant one to begin.</p>
              </div>
            `}
      </section>
    `
  }

  private renderCreate() {
    const creating = this.createStatus === 'creating'
    return html`
      <section aria-labelledby="garden-new-heading">
        <div class="section-heading">
          <h2 id="garden-new-heading">New graph</h2>
        </div>
        <div class="side-card">
          <p>A new graph starts empty. Inside it, Emporium describes the meaningful objects it can hold and Shrubbery supplies their compatible faces.</p>
          <button
            class="create-toggle"
            type="button"
            ?disabled=${creating}
            aria-busy=${creating ? 'true' : 'false'}
            @click=${() => {
              if (!creating) this.emit('mn-garden-home-create', {})
            }}
          >
            ${icon('plus', { size: 15 })}
            <span>${creating ? 'Creating graph…' : 'Create graph'}</span>
          </button>
          ${this.createStatus === 'error' ? html`
            <p class="disabled-reason error" role="alert">${this.createError?.trim() || 'The graph could not be created.'}</p>
          ` : nothing}
        </div>
      </section>
    `
  }

  private renderState() {
    if (this.status === 'error') {
      return html`
        <div class="state" role="alert">
          <div class="state-copy error">
            <h2>Your Garden could not be opened</h2>
            <p>${this.error?.trim() || 'The graph catalog is unavailable.'}</p>
            <mn-button
              variant="secondary"
              size="sm"
              icon="refresh-cw"
              label="Try again"
              @click=${() => this.emit('mn-garden-home-refresh', {})}
            ></mn-button>
          </div>
        </div>
      `
    }
    return html`
      <div class="state" role="status" aria-live="polite">
        <div class="state-copy">
          <h2>${this.status === 'loading' ? 'Opening your Garden…' : 'Preparing your Garden…'}</h2>
          <p>Your accessible graphs will appear here.</p>
        </div>
      </div>
    `
  }

  override render() {
    const name = firstName(this.account)
    const recent = this.recentWorkspaces()
    return html`
      <div class="home">
        ${this.renderMasthead()}
        <main aria-labelledby="garden-home-title">
          <div class="intro">
            <h1 id="garden-home-title">${name ? `Welcome back, ${name}.` : 'Welcome to Garden.'}</h1>
            <p class="lede">Open an accessible graph or plant a new one. The objects and faces inside belong to the graph, not this account screen.</p>
          </div>
          ${this.status !== 'ready'
            ? this.renderState()
            : html`
                <div class="layout">
                  <div class="column">
                    ${this.renderRecent(recent)}
                    ${this.renderCatalog()}
                  </div>
                  <aside class="column" aria-label="Garden account actions">
                    ${this.renderCreate()}
                  </aside>
                </div>
              `}
        </main>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-garden-home': MnGardenHome
  }
}
