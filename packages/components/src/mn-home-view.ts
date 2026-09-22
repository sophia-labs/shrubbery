/**
 * Controlled Garden home surface.
 *
 * The component owns presentation and emits intents only. Document truth,
 * activity history, daily-note creation, and persistence remain shell concerns.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-daily-note-row.js'

export interface MnHomeDocument {
  readonly graphId: string
  readonly documentId: string
  readonly title: string
  readonly timestamp?: number | null
  readonly readOnly?: boolean
}

export interface MnHomeOpenDocumentDetail {
  readonly document: MnHomeDocument
}

export interface MnHomePinDetail extends MnHomeOpenDocumentDetail {
  readonly pinned: boolean
}

export type MnHomeStatus = 'loading' | 'ready' | 'error'

function relativeTime(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return ''
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

@customElement('mn-home-view')
export class MnHomeView extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      height: 100%;
      overflow: hidden;
      color: var(--mn-color-text-primary, #18211b);
      background: var(--mn-color-surface-canvas, #f5f3ed);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    .home {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: var(--mn-space-10, 2.5rem) var(--mn-space-8, 2rem) var(--mn-space-16, 4rem);
      overflow-y: auto;
      user-select: none;
      background-color: var(--mn-color-surface-canvas, #f5f3ed);
      background-image: var(--mn-atmosphere, none);
      scrollbar-gutter: stable;
    }
    .home-inner {
      width: 100%;
      max-width: 460px;
      margin: 0 auto;
    }
    .heading {
      margin-bottom: var(--mn-space-8, 2rem);
      text-align: center;
    }
    .bookplate {
      display: grid;
      grid-template-columns: minmax(28px, 72px) auto minmax(28px, 72px);
      gap: var(--mn-space-3, 0.75rem);
      align-items: center;
      justify-content: center;
      margin: 0 auto var(--mn-space-3, 0.75rem);
      color: var(--mn-color-text-accent, #376d57);
    }
    .bookplate::before,
    .bookplate::after {
      width: 100%;
      height: 1px;
      content: '';
      background: var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
    }
    .mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }
    h1 {
      margin: 0;
      color: var(--mn-color-text-title, var(--mn-color-text-primary, #18211b));
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: clamp(var(--mn-text-4xl, 2.375rem), 7vw, 3.25rem);
      font-weight: 500;
      letter-spacing: -0.045em;
      line-height: 1;
    }
    .workspace {
      margin: 0 0 var(--mn-space-2, 0.5rem);
      color: var(--mn-color-text-accent, var(--mn-color-text-muted, #66736a));
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .actions {
      display: flex;
      width: 100%;
      margin-bottom: var(--mn-space-5, 1.25rem);
    }
    .actions.resume-actions { margin-bottom: var(--mn-space-2, 0.5rem); }
    .home-action-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-width: 0;
      min-height: 48px;
      padding: 0.625rem 0.875rem;
      border: 0;
      border-top: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      border-bottom: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      border-radius: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #66736a);
      cursor: pointer;
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 0.875rem);
      font-weight: 600;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }
    .home-action-btn:hover {
      color: var(--mn-color-text-accent-strong, #2d6a4f);
      background: var(--mn-color-surface-accent, #edf6ef);
    }
    .home-action-btn:active { background: var(--mn-color-surface-active, #e4eee7); }
    .home-action-btn.resume {
      justify-content: flex-start;
      gap: var(--mn-space-3, 0.75rem);
      min-height: 68px;
      padding-inline: var(--mn-space-4, 1rem);
      color: var(--mn-color-text-accent-strong, #2d6a4f);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-accent, #edf6ef));
      text-align: left;
    }
    .resume-glyph { display: inline-flex; flex: 0 0 auto; }
    .resume-copy { display: flex; min-width: 0; flex-direction: column; gap: 0.1rem; }
    .resume-kicker {
      color: var(--mn-color-text-tertiary, var(--mn-color-text-muted, #66736a));
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 600;
      letter-spacing: 0.11em;
      text-transform: uppercase;
    }
    .resume-title {
      overflow: hidden;
      color: var(--mn-color-text-primary, #18211b);
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-base, 0.9375rem);
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .action-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .practice { margin-top: var(--mn-space-7, 1.75rem); }
    .daily { width: 100%; margin-top: var(--mn-space-1, 0.25rem); }
    .dream {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-height: 48px;
      margin-top: var(--mn-space-1, 0.25rem);
      padding: 0.625rem 0.75rem;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-base, 0.9375rem);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background var(--mn-transition-fast, 120ms ease);
    }
    .dream:hover { background: var(--mn-color-surface-accent, #edf6ef); }
    .dream:active { background: var(--mn-color-surface-active, #e4eee7); }
    .dream .time, .row .time {
      margin-left: auto;
      color: var(--mn-color-text-muted, #66736a);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 0.75rem);
      flex-shrink: 0;
    }
    .state {
      min-height: 120px;
      display: grid;
      place-items: center;
      border-top: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      border-bottom: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      color: var(--mn-color-text-muted, #66736a);
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-style: italic;
      text-align: center;
    }
    .state.error { color: var(--mn-color-text-danger, #a12a2a); }
    section { width: 100%; margin-top: var(--mn-space-8, 2rem); }
    h2 {
      display: flex;
      gap: var(--mn-space-3, 0.75rem);
      align-items: center;
      margin: 0 0 var(--mn-space-2, 0.5rem);
      color: var(--mn-color-text-quiet, var(--mn-color-text-muted, #66736a));
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-2xs, 0.625rem);
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h2::after {
      height: 1px;
      flex: 1;
      content: '';
      background: var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 0.5rem);
      min-height: 52px;
      border-bottom: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      transition: background var(--mn-transition-fast, 120ms ease);
    }
    .row:hover { background: var(--mn-color-neutral-100, var(--mn-color-surface-hover, #f3f7f4)); }
    .row:active { background: var(--mn-color-surface-active, #e4eee7); }
    .open {
      flex: 1;
      min-width: 0;
      min-height: 52px;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      border: 0;
      padding: 0 var(--mn-space-2, 0.5rem);
      background: transparent;
      color: var(--mn-color-text-primary, #18211b);
      cursor: pointer;
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-base, 0.9375rem);
      text-align: left;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .open .mn-icon { color: var(--mn-color-text-accent, var(--mn-color-text-muted, #66736a)); flex-shrink: 0; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pin {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 44px;
      min-height: 44px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #66736a);
      cursor: pointer;
      opacity: 0;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition:
        opacity var(--mn-transition-fast, 120ms ease),
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }
    .row:hover .pin, .pin:focus-visible, .pin[aria-pressed='true'] {
      opacity: 1;
    }
    .pin:hover {
      color: var(--mn-color-text-primary, #18211b);
      background: var(--mn-color-surface-hover, #f3f7f4);
    }
    .empty {
      width: 100%;
      margin: var(--mn-space-8, 2rem) 0 0;
      padding-top: var(--mn-space-5, 1.25rem);
      border-top: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #d8ded9));
      color: var(--mn-color-text-muted, #66736a);
      font-family: var(--mn-font-prose, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-base, 0.9375rem);
      font-style: italic;
      text-align: center;
    }
    button:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px #2d6a4f);
    }
    @media (hover: none) {
      .pin { opacity: 0.68; }
    }
    @media (max-width: 620px) {
      .home { padding: var(--mn-space-7, 1.75rem) var(--mn-space-4, 1rem) var(--mn-space-10, 2.5rem); }
      .heading { margin-bottom: var(--mn-space-7, 1.75rem); }
      .bookplate { grid-template-columns: 40px auto 40px; }
      section { margin-top: var(--mn-space-7, 1.75rem); }
    }
  `

  @property({ type: String }) status: MnHomeStatus = 'ready'
  @property({ type: String }) error = ''
  @property({ type: String }) graphId = ''
  @property({ type: String }) graphTitle = ''
  @property({ type: String }) todayKey = ''
  @property({ attribute: false }) todayDoc: { readonly id: string; readonly updatedAt?: number } | null = null
  @property({ attribute: false }) resume: MnHomeDocument | null = null
  @property({ attribute: false }) dreamJournal: MnHomeDocument | null = null
  @property({ attribute: false }) pinned: readonly MnHomeDocument[] = []
  @property({ attribute: false }) newlyCreated: readonly MnHomeDocument[] = []
  @property({ attribute: false }) recent: readonly MnHomeDocument[] = []

  private emit(name: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private open(document: MnHomeDocument): void {
    this.emit('mn-home-open-document', { document } satisfies MnHomeOpenDocumentDetail)
  }

  private pin(document: MnHomeDocument, pinned: boolean): void {
    this.emit('mn-home-pin-document', { document, pinned } satisfies MnHomePinDetail)
  }

  private renderSection(label: string, documents: readonly MnHomeDocument[], pinned: boolean) {
    if (documents.length === 0) return nothing
    return html`<section aria-label=${label}>
      <h2>${label}</h2>
      <div class="rows">
        ${documents.map(document => html`<div class="row" data-document-id=${document.documentId}>
          <button class="open" type="button" @click=${() => this.open(document)}>
            ${icon(document.readOnly ? 'book-open' : pinned ? 'pin' : 'file-text', { size: 16 })}
            <span class="title">${document.title || 'Untitled'}</span>
          </button>
          ${document.timestamp ? html`<span class="time">${relativeTime(document.timestamp)}</span>` : nothing}
          <button
            class="pin"
            type="button"
            aria-label=${pinned ? `Unpin ${document.title}` : `Pin ${document.title}`}
            aria-pressed=${pinned ? 'true' : 'false'}
            @click=${() => this.pin(document, !pinned)}
          >${icon(pinned ? 'x' : 'pin', { size: 14 })}</button>
        </div>`)}
      </div>
    </section>`
  }

  render() {
    const hasDocuments = this.pinned.length + this.newlyCreated.length + this.recent.length > 0
    return html`<main class="home" aria-label="Garden home">
      <div class="home-inner">
        <header class="heading">
          <span class="bookplate" aria-hidden="true"><span class="mark">${icon('sprout', { size: 30 })}</span></span>
          ${this.graphTitle || this.graphId ? html`<p class="workspace">${this.graphTitle || this.graphId}</p>` : nothing}
          <h1>Garden</h1>
        </header>

        ${this.status === 'loading'
          ? html`<div class="state" role="status" aria-busy="true">Gathering this garden…</div>`
          : this.status === 'error'
            ? html`<div class="state error" role="alert">${this.error || 'Workspace documents are unavailable.'}</div>`
            : html`<div class="ready">
              ${this.resume ? html`<div class="actions resume-actions">
                <button
                  class="home-action-btn resume"
                  type="button"
                  aria-label=${`Resume ${this.resume.title || 'Untitled'}`}
                  @click=${() => this.open(this.resume!)}
                >
                  <span class="resume-glyph">${icon('arrow-left', { size: 15 })}</span>
                  <span class="resume-copy">
                    <span class="resume-kicker">Continue writing</span>
                    <span class="resume-title">${this.resume.title || 'Untitled'}</span>
                  </span>
                </button>
              </div>` : nothing}
              <div class="actions">
                <button class="home-action-btn new-document" type="button" @click=${() => this.emit('mn-home-new-document')}>
                  ${icon('file-plus-corner', { size: 15 })}<span class="action-label">New document</span>
                </button>
              </div>
              ${this.todayKey || this.dreamJournal ? html`<section class="practice" aria-label="Daily practice">
                <h2>Daily practice</h2>
                ${this.todayKey ? html`<div class="daily">
                  <mn-daily-note-row
                    displayed-date=${this.todayKey}
                    today-key=${this.todayKey}
                    .doc=${this.todayDoc}
                  ></mn-daily-note-row>
                </div>` : nothing}
                ${this.dreamJournal ? html`<button class="dream" type="button" @click=${() => this.open(this.dreamJournal!)}>
                  ${icon('moon', { size: 16 })}<span>Dream Journal</span>
                  ${this.dreamJournal.timestamp ? html`<span class="time">${relativeTime(this.dreamJournal.timestamp)}</span>` : nothing}
                </button>` : nothing}
              </section>` : nothing}
              ${this.renderSection('Pinned', this.pinned, true)}
              ${this.renderSection('Newly Created', this.newlyCreated, false)}
              ${this.renderSection('Recently Opened', this.recent, false)}
              ${!hasDocuments ? html`<p class="empty">Your first pages will gather here.</p>` : nothing}
            </div>`}
      </div>
    </main>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-home-view': MnHomeView
  }
}
