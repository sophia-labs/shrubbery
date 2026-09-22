/**
 * mn-lifetime-banner — a standing announcement that a LIFETIME ended (master
 * spec §3 Slice 7, WS3 §2 D1, §6.1): this graph was recreated while this
 * client held work for its previous life.
 *
 * A NEW sibling element in the banner stack, not a `mn-continuity-status`
 * enum member (D1). Register discipline: continuity is about whether work is
 * reaching its destination; a lifetime banner is about whether the
 * destination is still the same place. `mn-continuity-status` supports
 * exactly one action and forces `role="alert"`/assertive on its error state
 * — wrong on both counts for a persistent standing condition with two
 * actions and a verbatim-testimony disclosure. This component never infers
 * anything: the host supplies an honest `state` and handles both intents.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

/** Why this client's mirror no longer matches this graph id's current
 *  lifetime. All three are fences (Law VI); none is a Law IV contest. */
export type MnLifetimeReason =
  | 'graph-recreated' // the graph incarnation rotated under us
  | 'graph-name-taken' // our local `create` intent lost the id
  | 'graph-already-gone' // our local `delete` intent named a life that had already ended

export interface MnLifetimeBannerState {
  readonly reason: MnLifetimeReason
  /** Display title of the graph, host-resolved. Never a bare id when a title exists. */
  readonly graphTitle: string
  /** Short form of the previous graph incarnation (e.g. first 8 hex). May be ''. */
  readonly previousLife: string
  readonly parkedDocuments: number
  readonly parkedOperations: number
  /** The authority's own words. Rendered verbatim under a disclosure, never
   *  paraphrased into the headline (§7.1 — the one scoped exception to the
   *  terminology law's "conflict" ban). */
  readonly testimony: string
  /** True while the host is adopting the new life; both actions go inert. */
  readonly busy?: boolean
}

export interface MnLifetimeBannerDetail {
  readonly reason: MnLifetimeReason
}

const HEADLINE: Record<MnLifetimeReason, (graphTitle: string) => string> = {
  'graph-recreated': graphTitle => `${graphTitle} was recreated while you were away.`,
  'graph-name-taken': graphTitle => `${graphTitle} already existed when your copy tried to create it.`,
  'graph-already-gone': graphTitle => `${graphTitle} had already ended when your copy tried to delete it.`,
}

const BODY: Record<MnLifetimeReason, string> = {
  'graph-recreated': 'Your work from its previous life is parked and safe. Nothing was merged.',
  'graph-name-taken': 'The workspace you made offline is parked under its own name. Nothing was overwritten.',
  'graph-already-gone': 'The graph with this name now is a different one. Your work from the earlier one is parked.',
}

const BUSY_LABEL = "Loading this graph's current life…"

/** FB-7/8/9/10 — the parked-counts line. Never both zero without saying so. */
function countsLine(documents: number, operations: number): string {
  if (documents <= 0 && operations <= 0) return 'Nothing of yours was waiting.'
  const parts: string[] = []
  if (documents > 0) parts.push(`${documents} parked document${documents === 1 ? '' : 's'}`)
  if (operations > 0) parts.push(`${operations} unsent change${operations === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

@customElement('mn-lifetime-banner')
export class MnLifetimeBanner extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      color: var(--mn-color-warning-strong, #92400e);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .banner {
      display: flex;
      align-items: flex-start;
      gap: var(--mn-space-3, 12px);
      margin: var(--mn-space-2, 8px) var(--mn-space-4, 16px) 0;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-radius: var(--mn-radius-md, 8px);
      background: var(--mn-color-warning-surface, #fffbeb);
      color: var(--mn-color-warning-strong, #92400e);
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      line-height: 1.5;
      animation: mn-lifetime-banner-in 300ms ease-out;
      box-sizing: border-box;
    }

    @keyframes mn-lifetime-banner-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .icon {
      display: inline-grid;
      flex: 0 0 auto;
      place-items: center;
      margin-top: 2px;
    }

    .banner-body {
      min-width: 0;
      flex: 1 1 auto;
    }

    .banner-text strong {
      font-weight: 650;
    }

    .banner-counts {
      margin-top: var(--mn-space-1, 4px);
      color: var(--mn-color-text-warning, #b45309);
      font-variant-numeric: tabular-nums;
    }

    .banner-previous-life {
      margin-top: var(--mn-space-1, 4px);
      color: var(--mn-color-text-warning, #b45309);
      font-size: var(--mn-type-ui-sm-size, var(--mn-text-xs, 12px));
    }

    .banner-disclosure {
      margin-top: var(--mn-space-2, 8px);
    }

    .banner-disclosure summary {
      cursor: pointer;
      font-size: var(--mn-type-ui-sm-size, var(--mn-text-xs, 12px));
      color: var(--mn-color-text-warning, #b45309);
    }

    .banner-disclosure summary:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-warning, #d97706));
      outline-offset: 1px;
    }

    .testimony {
      max-width: 100%;
      margin-top: var(--mn-space-1, 4px);
      overflow-wrap: anywhere;
      color: var(--mn-color-text-warning, #b45309);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-type-ui-sm-size, var(--mn-text-xs, 12px));
    }

    .banner-actions {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    button {
      font: inherit;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-warning, #d97706));
      outline-offset: 1px;
    }

    .primary-btn {
      display: inline-flex;
      min-height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-warning, #d97706);
      color: var(--mn-color-text-on-accent, #fff);
      cursor: pointer;
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      font-weight: 600;
      white-space: nowrap;
      transition: background var(--mn-transition-fast, 120ms ease);
    }

    .primary-btn:hover:not(:disabled) {
      background: var(--mn-color-warning-strong, #92400e);
    }

    .secondary-btn {
      display: inline-flex;
      min-height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-warning, #d97706);
      border-radius: var(--mn-radius-full, 999px);
      background: transparent;
      color: var(--mn-color-warning-strong, #92400e);
      cursor: pointer;
      font-size: var(--mn-type-ui-size, var(--mn-text-sm, 13px));
      font-weight: 600;
      white-space: nowrap;
      transition: background var(--mn-transition-fast, 120ms ease);
    }

    .secondary-btn:hover:not(:disabled) {
      background: color-mix(in srgb, currentColor 9%, transparent);
    }

    button:disabled {
      cursor: default;
      opacity: 0.65;
    }

    :host([mobile]) .banner {
      flex-direction: column;
      align-items: stretch;
      margin: 0;
      padding:
        var(--mn-space-2, 8px)
        max(var(--mn-space-3, 12px), env(safe-area-inset-right, 0px))
        var(--mn-space-2, 8px)
        max(var(--mn-space-3, 12px), env(safe-area-inset-left, 0px));
      border-radius: 0;
      font-size: var(--mn-type-ui-sm-size, var(--mn-text-xs, 12px));
    }

    :host([mobile]) .banner-actions {
      flex-direction: column;
      align-items: stretch;
      margin-top: var(--mn-space-2, 8px);
    }

    :host([mobile]) .primary-btn,
    :host([mobile]) .secondary-btn {
      min-height: 44px;
    }
  `

  /** Null renders NOTHING — no reserved space, no placeholder. */
  @property({ attribute: false }) state: MnLifetimeBannerState | null = null
  /** Host-owned responsive mode, matching `mn-storage-banner`/`mn-upgrade-banner`. */
  @property({ type: Boolean, reflect: true }) mobile = false
  @property({ type: String, attribute: 'primary-label' }) primaryLabel = 'Reload this graph'
  @property({ type: String, attribute: 'secondary-label' }) secondaryLabel = 'View parked work'

  private detail(): MnLifetimeBannerDetail {
    return { reason: this.state?.reason ?? 'graph-recreated' }
  }

  private primary(): void {
    if (this.state?.busy) return
    this.dispatchEvent(new CustomEvent<MnLifetimeBannerDetail>('mn-lifetime-primary', {
      detail: this.detail(),
      bubbles: true,
      composed: true,
    }))
  }

  private secondary(): void {
    if (this.state?.busy) return
    this.dispatchEvent(new CustomEvent<MnLifetimeBannerDetail>('mn-lifetime-secondary', {
      detail: this.detail(),
      bubbles: true,
      composed: true,
    }))
  }

  override render(): TemplateResult | typeof nothing {
    const state = this.state
    if (!state) return nothing
    const busy = state.busy === true
    const showSecondary = state.parkedDocuments + state.parkedOperations > 0

    return html`
      <div class="banner" role="status" aria-live="polite" aria-atomic="true" data-lifetime-reason=${state.reason}>
        <span class="icon" aria-hidden="true">${icon('history', { size: 16 })}</span>
        <div class="banner-body">
          <div class="banner-text">
            <strong>${HEADLINE[state.reason](state.graphTitle)}</strong> ${BODY[state.reason]}
          </div>
          <div class="banner-counts">${countsLine(state.parkedDocuments, state.parkedOperations)}</div>
          ${state.previousLife
            ? html`<div class="banner-previous-life">Previous life ${state.previousLife}</div>`
            : nothing}
          ${state.testimony
            ? html`<details class="banner-disclosure">
                <summary>What the server said</summary>
                <div class="testimony">${state.testimony}</div>
              </details>`
            : nothing}
        </div>
        <div class="banner-actions">
          <button type="button" class="primary-btn" ?disabled=${busy} @click=${this.primary}>
            ${busy ? BUSY_LABEL : this.primaryLabel}
          </button>
          ${showSecondary
            ? html`<button type="button" class="secondary-btn" ?disabled=${busy} @click=${this.secondary}>
                ${this.secondaryLabel}
              </button>`
            : nothing}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-lifetime-banner': MnLifetimeBanner
  }
}
