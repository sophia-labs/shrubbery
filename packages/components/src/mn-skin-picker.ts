/**
 * mn-skin-picker — the drop-down that replaced the cycling skin toggle.
 *
 * One press used to walk to the NEXT visual identity; with six of them that is a lottery. This lists
 * every skin by its label and icon (the shared order, Hotdog Stand last), marks the one that is on,
 * and says what was chosen with ONE composed event, `mn-skin-select` ({ skin }). It owns no state
 * beyond what its host tells it (`value`, `skins`): the shell applies the skin and persists it, the
 * way it did for the toggle.
 *
 * It is a thin face over `mn-dropdown-button`, so it inherits that menu's behaviour wholesale:
 * keyboard (ArrowDown/ArrowUp open on the first/last item, arrows move, Enter or Space choose,
 * Escape closes and returns focus, Tab leaves), outside-press close, and a top-layer popover that
 * escapes every stacking context. The dropdown's own `mn-select` is stopped here so a shell
 * listening for menu selections never hears the skin menu.
 */
import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { MenuEntry } from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import { BEVELLED } from './bevelled-skins.js'
import { CHROME_PICKER_SKINS, chromeSkinMeta, type ChromeSkinId } from './chrome-skin.js'
import './mn-dropdown-button.js'

export interface MnSkinSelectDetail {
  readonly skin: ChromeSkinId
}

@customElement('mn-skin-picker')
export class MnSkinPicker extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }
    :host([hidden]) {
      display: none;
    }
    /* The trigger is the dropdown's own, restyled through its part to sit among the bar's action
       buttons: a control-height square-ish button, icon and caret, the bar's muted ink. */
    mn-dropdown-button::part(trigger) {
      min-height: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      padding: 0 var(--mn-space-1, 4px) 0 var(--mn-space-2, 6px);
      gap: 2px;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
    }
    mn-dropdown-button::part(trigger):hover,
    mn-dropdown-button[open]::part(trigger) {
      background: var(--mn-color-surface-accent, #f3f4f6);
      color: var(--mn-top-bar-text, #111);
    }
    /* The bevelled skins (98, Hotdog Stand) draw it as the raised button its neighbours are. */
    :host(${BEVELLED}) mn-dropdown-button::part(trigger) {
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host(${BEVELLED}) mn-dropdown-button::part(trigger):hover {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
    }
    :host(${BEVELLED}) mn-dropdown-button[open]::part(trigger) {
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='glass']) mn-dropdown-button::part(trigger) {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
  `

  /** The skin that is on. */
  @property({ type: String }) value: ChromeSkinId = 'garden'
  /** The skins on offer, in order. Defaults to the shared set; an app with its own passes its own. */
  @property({ attribute: false }) skins: readonly ChromeSkinId[] = CHROME_PICKER_SKINS
  /** What the control is called, for the trigger's accessible name and the menu. */
  @property({ type: String }) label = 'Visual style'

  private _entries(): readonly MenuEntry[] {
    return this.skins.map((skin) => {
      const meta = chromeSkinMeta(skin)
      return { id: skin, label: meta.label, icon: meta.icon }
    })
  }

  private _select(event: CustomEvent<{ id: string }>): void {
    // The dropdown's own event is composed and bubbles; a shell must not mistake it for a menu choice.
    event.stopPropagation()
    const skin = event.detail.id as ChromeSkinId
    if (!this.skins.includes(skin)) return
    this.dispatchEvent(new CustomEvent<MnSkinSelectDetail>('mn-skin-select', { detail: { skin }, bubbles: true, composed: true }))
  }

  override render() {
    const meta = chromeSkinMeta(this.value)
    return html`<mn-dropdown-button
      variant="ghost"
      size="sm"
      placement="bottom-end"
      icon-name=${meta.icon}
      trigger-label=${`${this.label}: ${meta.label}`}
      menu-label=${this.label}
      .entries=${this._entries()}
      selected-id=${this.value}
      @mn-select=${this._select}
    ></mn-dropdown-button>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-skin-picker': MnSkinPicker
  }
}
