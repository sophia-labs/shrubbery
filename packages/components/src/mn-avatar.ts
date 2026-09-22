/**
 * mn-avatar — Garden's avatar primitive, lifted as a backend-free component.
 *
 * Supports image, initials, explicit icons, fallback user icon, presence, group
 * stacking, and optional interactive `mn-click` emission.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type MnAvatarPresence = 'online' | 'offline' | 'away' | 'busy'

const INITIAL_COLORS = [
  '#3b82f6',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
]

@customElement('mn-avatar')
export class MnAvatar extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: relative;
      display: inline-flex;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([group]) {
      margin-left: -8px;
    }

    :host([group]):first-of-type {
      margin-left: 0;
    }

    .avatar {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      overflow: hidden;
      border-radius: 999px;
      font-weight: var(--mn-font-weight-semibold, 650);
      user-select: none;
    }

    :host([group]) .avatar {
      box-shadow: 0 0 0 2px var(--mn-color-surface-base, #fff);
    }

    :host([ring]) .avatar {
      box-shadow:
        0 0 0 2px var(--mn-color-surface-base, #fff),
        0 0 0 4px var(--mn-color-accent, #2563eb);
    }

    :host([interactive]) .avatar {
      cursor: pointer;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    :host([interactive]) .avatar:hover {
      opacity: 0.82;
      transform: scale(1.04);
    }

    :host([interactive]) .avatar:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, var(--mn-color-border-focus, #2563eb));
      outline-offset: 2px;
    }

    .size-xs {
      width: 24px;
      height: 24px;
      font-size: 10px;
    }

    .size-sm {
      width: 32px;
      height: 32px;
      font-size: var(--mn-text-xs, 12px);
    }

    .size-md {
      width: 40px;
      height: 40px;
      font-size: var(--mn-text-sm, 13px);
    }

    .size-lg {
      width: 48px;
      height: 48px;
      font-size: var(--mn-text-base, 15px);
    }

    .size-xl {
      width: 64px;
      height: 64px;
      font-size: var(--mn-text-lg, 18px);
    }

    .image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .initials,
    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    .initials {
      color: #fff;
      text-transform: uppercase;
    }

    .icon {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .presence {
      position: absolute;
      border: 2px solid var(--mn-color-surface-base, #fff);
      border-radius: 999px;
      box-shadow: var(--mn-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.12));
    }

    .size-xs .presence {
      right: -1px;
      bottom: -1px;
      width: 8px;
      height: 8px;
      border-width: 1.5px;
    }

    .size-sm .presence {
      right: -1px;
      bottom: -1px;
      width: 10px;
      height: 10px;
    }

    .size-md .presence {
      right: 0;
      bottom: 0;
      width: 12px;
      height: 12px;
    }

    .size-lg .presence {
      right: 1px;
      bottom: 1px;
      width: 14px;
      height: 14px;
    }

    .size-xl .presence {
      right: 2px;
      bottom: 2px;
      width: 18px;
      height: 18px;
    }

    .presence-online {
      background: var(--mn-color-success, #10b981);
    }

    .presence-offline {
      background: var(--mn-color-text-muted, #9ca3af);
    }

    .presence-away {
      background: var(--mn-color-warning, #f59e0b);
    }

    .presence-busy {
      background: var(--mn-color-danger, #ef4444);
    }
  `

  @property({ type: String, reflect: true }) size: MnAvatarSize = 'md'
  @property({ type: String }) src = ''
  @property({ type: String }) alt = ''
  @property({ type: String }) initials = ''
  @property({ type: String }) color = ''
  @property({ type: String, attribute: 'icon-name' }) iconName = ''
  @property({ type: String }) presence?: MnAvatarPresence
  @property({ type: Boolean, reflect: true }) ring = false
  @property({ type: Boolean, reflect: true }) group = false
  @property({ type: Boolean, reflect: true }) interactive = false

  @state() private imageError = false

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('src')) this.imageError = false
  }

  private handleImageError(): void {
    this.imageError = true
  }

  private emitClick(): void {
    if (!this.interactive) return
    this.dispatchEvent(new CustomEvent('mn-click', { bubbles: true, composed: true }))
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.interactive || (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar')) return
    event.preventDefault()
    this.emitClick()
  }

  private displayInitials(): string {
    return this.initials.trim().slice(0, 2).toUpperCase()
  }

  private backgroundColor(): string {
    if (this.color) return this.color
    const initials = this.displayInitials()
    return INITIAL_COLORS[(initials.charCodeAt(0) || 0) % INITIAL_COLORS.length]
  }

  private iconSize(): number {
    return { xs: 12, sm: 14, md: 18, lg: 22, xl: 28 }[this.size] ?? 18
  }

  override render() {
    const showImage = Boolean(this.src) && !this.imageError
    const initials = this.displayInitials()
    const showInitials = !showImage && Boolean(initials)
    const showIcon = !showImage && !showInitials && Boolean(this.iconName)
    const ariaLabel = this.alt || initials || this.iconName || 'Avatar'

    return html`
      <div
        class=${classMap({ avatar: true, [`size-${this.size}`]: true })}
        tabindex=${ifDefined(this.interactive ? '0' : undefined)}
        role=${this.interactive ? 'button' : 'img'}
        aria-label=${ariaLabel}
        @click=${() => this.emitClick()}
        @keydown=${(event: KeyboardEvent) => this.handleKeydown(event)}
      >
        ${showImage
          ? html`<img class="image" src=${this.src} alt=${this.alt} @error=${() => this.handleImageError()} />`
          : nothing}
        ${showInitials
          ? html`<div class="initials" style="background-color: ${this.backgroundColor()}">${initials}</div>`
          : nothing}
        ${showIcon
          ? html`<div class="icon">${icon(this.iconName, { size: this.iconSize() })}</div>`
          : nothing}
        ${!showImage && !showInitials && !showIcon
          ? html`<div class="icon">${icon('user', { size: this.iconSize() })}</div>`
          : nothing}
        ${this.presence
          ? html`<span class=${classMap({ presence: true, [`presence-${this.presence}`]: true })} aria-hidden="true"></span>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-avatar': MnAvatar
  }
}
