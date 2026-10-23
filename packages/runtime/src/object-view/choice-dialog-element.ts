/**
 * `<sh-choice-dialog>` — choose one of a list, filtered as you type: the document an object is embedded in
 * ("Embed in a document…"), the typed object a `/object` command embeds. Controlled: the host gives the choices and
 * gets back the one chosen (`sh-choice`) or none (`sh-choice-cancel`). Keyboard: type to filter, ↑ ↓ to move,
 * Enter to choose, Esc to cancel. `chooseFrom()` mounts one and resolves to the chosen id, or null.
 */

import { LocaleController, localeSource, localizeLabel, t } from '@shrubbery/nucleus'
import { css, html, LitElement, nothing } from 'lit'

export interface ChoiceItem {
  readonly id: string
  readonly label: string
  /** A quiet second line: a path, a class. */
  readonly sub?: string
  /** A short mono tag before the label: a class label, a kind. */
  readonly tag?: string
}

export const CHOICE_EVENT = 'sh-choice'
export const CHOICE_CANCEL_EVENT = 'sh-choice-cancel'

export function filterChoices(items: readonly ChoiceItem[], query: string): readonly ChoiceItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return items
  return items.filter((item) => {
    const text = `${item.tag ?? ''} ${item.label} ${item.sub ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

export class ShChoiceDialog extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static override properties = {
    heading: { type: String },
    placeholder: { type: String },
    emptyText: { type: String, attribute: 'empty-text' },
    items: { attribute: false },
    loading: { type: Boolean },
    query: { state: true },
    active: { state: true },
  }

  declare heading: string
  declare placeholder: string
  declare emptyText: string
  declare items: readonly ChoiceItem[]
  declare loading: boolean
  declare query: string
  declare active: number

  constructor() {
    super()
    this.heading = 'Choose'
    this.placeholder = 'Filter'
    this.emptyText = 'Nothing to choose from.'
    this.items = []
    this.loading = false
    this.query = ''
    this.active = 0
  }

  static override styles = css`
    :host {
      position: fixed; inset: 0; z-index: var(--mn-z-modal, 1400); display: flex; align-items: flex-start; justify-content: center;
      padding: 12vh 16px 16px; box-sizing: border-box; background: var(--mn-color-overlay, rgba(15, 23, 42, 0.45));
      font: var(--mn-text-sm, 13px)/1.45 var(--mn-font-chrome, system-ui, sans-serif); color: var(--mn-color-text-primary);
    }
    * { box-sizing: border-box; }
    .dialog {
      width: min(100%, 520px); max-height: 70vh; display: flex; flex-direction: column; overflow: hidden;
      background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-surface, 10px); box-shadow: var(--mn-shadow-raised, 0 12px 40px rgba(0, 0, 0, .25));
    }
    h2 { margin: 0; padding: 12px 14px 4px; font-size: 13px; font-weight: 600; }
    input {
      margin: 6px 12px 8px; font: inherit; padding: 7px 10px; border-radius: 8px; color: inherit;
      border: 1px solid var(--mn-color-border-default); background: var(--mn-color-surface-canvas);
    }
    input:focus { outline: 2px solid var(--mn-color-accent); outline-offset: 1px; }
    ul { list-style: none; margin: 0; padding: 4px 6px 8px; overflow: auto; }
    li button {
      width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 8px; align-items: baseline; text-align: left;
      font: inherit; color: inherit; background: none; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer;
    }
    li button[aria-selected='true'], li button:hover { background: var(--mn-color-surface-hover); }
    .tag { font: 500 11px var(--mn-font-mono, ui-monospace, monospace); color: var(--mn-color-text-secondary); white-space: nowrap; }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { grid-column: 2; font-size: 11.5px; color: var(--mn-color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { padding: 10px 14px 14px; color: var(--mn-color-text-secondary); }
  `

  override firstUpdated(): void {
    this.shadowRoot?.querySelector('input')?.focus()
  }

  private visible(): readonly ChoiceItem[] {
    return filterChoices(this.items, this.query)
  }

  private choose(item: ChoiceItem | undefined): void {
    if (!item) return
    this.dispatchEvent(new CustomEvent(CHOICE_EVENT, { detail: { id: item.id }, bubbles: true, composed: true }))
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent(CHOICE_CANCEL_EVENT, { bubbles: true, composed: true }))
  }

  private onKey = (e: KeyboardEvent): void => {
    const visible = this.visible()
    if (e.key === 'Escape') {
      e.preventDefault()
      this.cancel()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.active = Math.min(visible.length - 1, this.active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.active = Math.max(0, this.active - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.choose(visible[this.active])
    }
  }

  override render() {
    const visible = this.visible()
    return html`<div class="dialog" role="dialog" aria-modal="true" aria-label=${localizeLabel(this.heading)} @keydown=${this.onKey}
      @click=${(e: Event) => e.stopPropagation()}>
      <h2>${localizeLabel(this.heading)}</h2>
      <input type="search" .value=${this.query} placeholder=${localizeLabel(this.placeholder)} aria-label=${localizeLabel(this.placeholder)}
        @input=${(e: Event) => { this.query = (e.target as HTMLInputElement).value; this.active = 0 }}>
      ${this.loading ? html`<p class="empty">${t('Looking…')}</p>`
        : visible.length === 0 ? html`<p class="empty">${this.items.length === 0 ? localizeLabel(this.emptyText) : t('Nothing matches.')}</p>`
          : html`<ul role="listbox">${visible.slice(0, 200).map((item, i) => html`<li><button role="option" aria-selected=${i === this.active ? 'true' : 'false'}
            @click=${() => this.choose(item)}>${item.tag ? html`<span class="tag">${item.tag}</span>` : html`<span></span>`}<span class="label">${item.label}</span>
            ${item.sub ? html`<span class="sub">${item.sub}</span>` : nothing}</button></li>`)}</ul>`}
    </div>`
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-choice-dialog')) {
  customElements.define('sh-choice-dialog', ShChoiceDialog)
}

/**
 * Mount a chooser over the page and resolve to the chosen id, or null (Esc, a click outside). `items` may be a
 * promise: the dialog says "Looking…" until it settles.
 */
export function chooseFrom(
  doc: Document,
  options: { readonly heading: string; readonly placeholder?: string; readonly emptyText?: string; readonly items: readonly ChoiceItem[] | Promise<readonly ChoiceItem[]> },
): Promise<string | null> {
  const el = doc.createElement('sh-choice-dialog') as ShChoiceDialog
  el.heading = options.heading
  if (options.placeholder) el.placeholder = options.placeholder
  if (options.emptyText) el.emptyText = options.emptyText
  if (Array.isArray(options.items)) el.items = options.items
  else {
    el.loading = true
    void Promise.resolve(options.items).then(
      (items) => { el.items = items; el.loading = false },
      () => { el.items = []; el.loading = false },
    )
  }
  return new Promise((resolve) => {
    const unsubscribeLocale = localeSource.subscribe(() => {
      el.heading = options.heading
      if (options.placeholder) el.placeholder = options.placeholder
      if (options.emptyText) el.emptyText = options.emptyText
    })
    const done = (id: string | null): void => {
      unsubscribeLocale()
      el.remove()
      resolve(id)
    }
    el.addEventListener(CHOICE_EVENT, (e) => done((e as CustomEvent<{ id: string }>).detail.id))
    el.addEventListener(CHOICE_CANCEL_EVENT, () => done(null))
    el.addEventListener('click', () => done(null))
    doc.body.append(el)
  })
}
