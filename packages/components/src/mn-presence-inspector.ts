/**
 * mn-presence-inspector — controlled per-person live-session detail.
 *
 * HOISTED, verbatim, from `mn-bottom-bar.ts`'s own private
 * `_renderPresenceInspector(person)` template (plus its exclusively-used
 * helper methods `_presenceSessions`/`_presenceExplanation`/`_sessionLabel`/
 * `_commitPresenceName`/`_presenceNameKeydown`, and its CSS block) into a
 * REAL, standalone, separately-tagged custom element — north star §2.2's
 * "5 trapped faces" list names this the presence-inspector elevation
 * candidate (catalogue: "Per-person session detail + Follow cursor-reveal +
 * self-rename/color... Elevation candidate"), and today it exists ONLY as
 * markup inline inside the chrome bottom-bar's own shadow root, with no
 * separately-addressable tag a layout leaf could ever mount. This element is
 * that address.
 *
 * CONSOLIDATION IS COMPLETE (wave1 review r1): `mn-bottom-bar.ts` no longer
 * carries an inline copy — its chrome popover now mounts THIS element, so
 * there is exactly one implementation serving both the chrome popover and
 * `layout/faces/presence-inspector-face.ts`. Every class name,
 * data-attribute, and event name below is BYTE-IDENTICAL to the former
 * inline version, so both callers get the exact same real behavior.
 *
 * `showClose` (new): the chrome popover always shows its own close button
 * (closing = clearing `openPresenceId`); a LEAF has no such channel — closing
 * a leaf is a shell/chrome `close_leaf` operation this element has no way to
 * request (same reasoning `mn-doc-history-panel`'s `showClose` follows). The
 * layout face sets this `false`; chrome usage would keep the default `true`.
 *
 * `person = null` (new): the chrome popover only ever mounts this element
 * once a matching person is confirmed present (`inspectedPerson ? ... :
 * nothing`), so it never had to render a "gone" state. A layout LEAF stays
 * mounted even after the person it names disconnects (presence membership is
 * ephemeral; a leaf's identity is not) — `person = null` renders an honest
 * "no longer present" empty state instead of a blank pane.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './mn-empty-state.js'
import type {
  ChromePresenceFollowDetail,
  ChromePresencePerson,
  ChromePresenceSelfUpdateDetail,
  ChromePresenceSession,
} from './mn-bottom-bar.js'

export type {
  ChromePresenceFollowDetail,
  ChromePresencePerson,
  ChromePresenceSelfUpdateDetail,
  ChromePresenceSession,
} from './mn-bottom-bar.js'

@customElement('mn-presence-inspector')
export class MnPresenceInspector extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      right: var(--mn-space-3, 8px);
      bottom: calc(100% + 7px);
      z-index: 1000;
      display: grid;
      width: min(320px, calc(100vw - 16px));
      max-height: min(440px, calc(100vh - 48px));
      overflow: auto;
      box-sizing: border-box;
      gap: var(--mn-space-3, 8px);
      padding: var(--mn-space-3, 10px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 12px 30px rgba(15, 23, 42, 0.2));
      font-size: var(--mn-text-xs, 12px);
      user-select: text;
    }
    /* The inline original carried display:grid + gap on .presence-inspector
       itself — that is what spaces header/explanation/sessions/profile. The
       hoist moved the POPOVER box styling to :host (which has exactly one
       child, so grid/gap there space nothing), and the leaf face overrides
       the host to display:block besides. The section must own its internal
       layout in BOTH mounts. */
    .presence-inspector {
      display: grid;
      gap: var(--mn-space-3, 8px);
    }
    .presence-inspector-header {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) 24px;
      align-items: center;
      gap: var(--mn-space-2, 6px);
    }
    .presence-inspector-avatar {
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border-radius: 999px;
      background: var(--presence-color, #64748b);
      color: #fff;
      font-weight: 750;
      text-transform: uppercase;
    }
    .presence-inspector-avatar[data-actor-type='agent'] {
      color: var(--mn-color-primary-700, #1d4ed8);
      background: var(--mn-color-primary-100, #dbeafe);
    }
    .presence-inspector-title {
      min-width: 0;
    }
    .presence-inspector-title strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .presence-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }
    .presence-badge {
      padding: 1px 5px;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: 999px;
      color: var(--mn-color-text-secondary, #475569);
      background: var(--mn-color-surface-sunken, #f8fafc);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .presence-inspector-close {
      display: grid;
      width: 24px;
      height: 24px;
      padding: 0;
      place-items: center;
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #475569);
      cursor: pointer;
    }
    .presence-inspector-close:hover,
    .presence-inspector-close:focus-visible {
      background: var(--mn-color-surface-hover, #f1f5f9);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }
    .presence-explanation {
      margin: 0;
      color: var(--mn-color-text-secondary, #475569);
      line-height: 1.4;
    }
    .presence-sessions {
      display: grid;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .presence-session {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 6px 7px;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-control, 5px);
      background: var(--mn-color-surface-base, #fff);
    }
    .presence-session-copy {
      min-width: 0;
      line-height: 1.25;
    }
    .presence-session-copy strong,
    .presence-session-copy span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .presence-session-copy span {
      margin-top: 2px;
      color: var(--mn-color-text-muted, #64748b);
      font-size: 10px;
    }
    .presence-follow {
      min-width: 64px;
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--mn-color-border-default, #cbd5e1);
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
    }
    .presence-follow[aria-pressed='true'] {
      border-color: var(--presence-color, #2563eb);
      background: color-mix(in srgb, var(--presence-color, #2563eb) 12%, transparent);
      color: var(--presence-color, #2563eb);
    }
    .presence-follow:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .presence-profile {
      display: grid;
      gap: 7px;
      padding-top: 7px;
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }
    .presence-profile label {
      display: grid;
      gap: 4px;
      color: var(--mn-color-text-secondary, #475569);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .presence-profile input {
      width: 100%;
      height: 28px;
      box-sizing: border-box;
      padding: 0 8px;
      border: 1px solid var(--mn-color-border-default, #cbd5e1);
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      text-transform: none;
      letter-spacing: normal;
    }
    .presence-profile input:focus {
      border-color: var(--mn-color-focus, #2563eb);
      outline: 2px solid color-mix(in srgb, var(--mn-color-focus, #2563eb) 20%, transparent);
      outline-offset: 1px;
    }
    .presence-palette {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .presence-swatch {
      width: 22px;
      height: 22px;
      padding: 0;
      border: 2px solid var(--mn-color-surface-raised, #fff);
      border-radius: 999px;
      background: var(--swatch-color);
      box-shadow: 0 0 0 1px var(--mn-color-border-default, #cbd5e1);
      cursor: pointer;
    }
    .presence-swatch[aria-pressed='true'] {
      box-shadow: 0 0 0 2px var(--mn-color-text-primary, #111827);
    }
    .presence-profile-note {
      margin: 0;
      color: var(--mn-color-text-muted, #64748b);
      font-size: 10px;
      line-height: 1.35;
    }
  `

  @property({ attribute: false }) person: ChromePresencePerson | null = null
  @property({ attribute: false }) followedPresenceClientId: string | null = null
  @property({ type: Boolean }) selfPresenceEditable = false
  @property({ attribute: false }) presenceColors: readonly string[] = []
  @property({ type: Boolean }) showClose = true

  private _emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private _presenceInitial(person: ChromePresencePerson): string {
    if (person.type === 'agent') return '✦'
    return person.name.trim().slice(0, 1) || '?'
  }

  private _presenceSessions(person: ChromePresencePerson): readonly ChromePresenceSession[] {
    if (person.sessions?.length) return person.sessions
    return (person.clientIds ?? []).map(clientId => ({ clientId, hasCursor: false }))
  }

  private _presenceExplanation(person: ChromePresencePerson): string {
    const sessions = person.sessionCount ?? Math.max(1, this._presenceSessions(person).length)
    const devices = person.deviceCount ?? 1
    if (sessions === 1) {
      return person.isSelf
        ? 'This is your current tab.'
        : `One live ${person.type === 'agent' ? 'agent session' : 'tab'} in this document.`
    }
    const deviceLabel = devices === 1 ? 'one device' : `${devices} devices`
    return `${sessions} live tabs across ${deviceLabel}. Each tab keeps its own cursor; they are grouped only for display.`
  }

  private _sessionLabel(person: ChromePresencePerson, session: ChromePresenceSession, index: number): string {
    if (person.type === 'agent') return `Agent session ${index + 1}`
    if (person.isSelf) {
      return session.isLocal ? `Tab ${index + 1} (you)` : `Tab ${index + 1} (you, other tab)`
    }
    return `Tab ${index + 1}`
  }

  private _commitPresenceName(person: ChromePresencePerson, input: HTMLInputElement): void {
    const name = input.value.trim()
    if (!name || name === person.name) {
      input.value = person.name
      return
    }
    this._emit('mn-presence-self-update', { person, name } satisfies ChromePresenceSelfUpdateDetail)
  }

  private _presenceNameKeydown(event: KeyboardEvent, person: ChromePresencePerson): void {
    const input = event.currentTarget as HTMLInputElement
    if (event.key === 'Enter') {
      event.preventDefault()
      this._commitPresenceName(person, input)
      input.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      input.value = person.name
      input.blur()
    }
  }

  render() {
    const person = this.person
    if (!person) {
      return html`<mn-empty-state
        title="No longer present"
        description="This person's live session ended."
      ></mn-empty-state>`
    }
    const sessions = this._presenceSessions(person)
    const actorType = person.type === 'agent' ? 'Agent' : 'Human'
    const profileEditable = person.isSelf && person.type !== 'agent' && this.selfPresenceEditable
    return html`<section
      class="presence-inspector"
      data-presence-inspector=${person.id}
      role="dialog"
      aria-label=${`Presence details for ${person.name}`}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this._emit('mn-presence-close')
        }
      }}
    >
      <header class="presence-inspector-header">
        <span
          class="presence-inspector-avatar"
          data-actor-type=${person.type ?? 'human'}
          style=${`--presence-color:${person.color}`}
          aria-hidden="true"
        >${this._presenceInitial(person)}</span>
        <span class="presence-inspector-title">
          <strong>${person.name}</strong>
          <span class="presence-badges">
            <span class="presence-badge" data-presence-actor-type>${actorType}</span>
            ${person.isSelf ? html`<span class="presence-badge">You</span>` : nothing}
          </span>
        </span>
        ${this.showClose
          ? html`<button
              type="button"
              class="presence-inspector-close"
              aria-label="Close presence details"
              @click=${() => this._emit('mn-presence-close')}
            >×</button>`
          : nothing}
      </header>
      <p class="presence-explanation">${this._presenceExplanation(person)}</p>
      ${sessions.length > 0 ? html`<ul class="presence-sessions" aria-label="Live sessions">
        ${sessions.map((session, index) => {
          const following = this.followedPresenceClientId === session.clientId
          return html`<li class="presence-session" data-presence-client-id=${session.clientId}>
            <span class="presence-session-copy">
              <strong>${this._sessionLabel(person, session, index)}</strong>
              <span>${session.hasCursor ? 'Cursor active' : 'No cursor published yet'}</span>
            </span>
            ${person.isSelf ? nothing : html`<button
              type="button"
              class="presence-follow"
              aria-pressed=${following ? 'true' : 'false'}
              ?disabled=${!session.hasCursor}
              title=${session.hasCursor ? `${following ? 'Stop following' : 'Follow'} this exact tab cursor` : 'This tab has not published a cursor'}
              @click=${() => this._emit('mn-presence-follow', {
                person,
                session,
                following: !following,
              } satisfies ChromePresenceFollowDetail)}
            >${following ? 'Following' : 'Follow'}</button>`}
          </li>`
        })}
      </ul>` : nothing}
      ${profileEditable ? html`<div class="presence-profile" data-presence-self-controls>
        <label>Display name
          <input
            data-presence-name
            maxlength="80"
            .value=${person.name}
            @change=${(event: Event) => this._commitPresenceName(person, event.currentTarget as HTMLInputElement)}
            @keydown=${(event: KeyboardEvent) => this._presenceNameKeydown(event, person)}
          >
        </label>
        ${this.presenceColors.length > 0 ? html`<div>
          <span class="presence-badge">Cursor color</span>
          <div class="presence-palette" role="group" aria-label="Cursor color">
            ${this.presenceColors.map(color => html`<button
              type="button"
              class="presence-swatch"
              style=${`--swatch-color:${color}`}
              aria-label=${`Use cursor color ${color}`}
              aria-pressed=${color.toLowerCase() === person.color.toLowerCase() ? 'true' : 'false'}
              data-presence-color=${color}
              @click=${() => this._emit('mn-presence-self-update', {
                person,
                color,
              } satisfies ChromePresenceSelfUpdateDetail)}
            ></button>`)}
          </div>
        </div>` : nothing}
        <p class="presence-profile-note">Name and cursor color are shared through live awareness and reused by this browser. Account identity and Human/Agent type cannot be changed here.</p>
      </div>` : nothing}
    </section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-presence-inspector': MnPresenceInspector
  }
}
