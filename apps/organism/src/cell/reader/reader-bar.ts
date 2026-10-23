/**
 * `<mn-reader-bar>` — the one bar of the Reader, the same whether the original or the text made from it is shown.
 *
 *   sidebar | title and author | location | tools | Original / Text | more
 *
 * The Original / Text control and the more button sit at the right edge, so they are at the same place in every view
 * (the tools and the location around them change with the view, the right end does not). The Reader (`<mn-reader>`)
 * puts its zoom, type and note buttons in the `tools` and `tools-end` slots and its page or chapter in `location`; the
 * editor's host draws the bar by itself for a read-only document's text, and gives it a find box ({@link ReaderBarFind}).
 *
 * Events (bubble, composed):
 *   `rd-bar-sidebar` · `rd-bar-find` { open } · `rd-bar-menu` { id, modifiers } · `rd-bar-context` { id } (the right-click menu, see `showContextMenu`)
 *   `mn-editor-original-view-toggle` (the other side of Original / Text; the shell remembers the choice)
 *   `mn-editor-search-input` { value } · `mn-editor-search-keydown` { keyboardEvent } · `mn-editor-search-prev|next|close`
 *     (the find box speaks the editor toolbar's events, so the editor host needs nothing new)
 */
import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import type { MenuEntry, MenuSelectDetail } from '@shrubbery/nucleus'
// The context menu alone: the components barrel would bring every component (an xterm terminal among them).
import '@shrubbery/components/context-menu'
import type { MnContextMenu } from '@shrubbery/components/context-menu'
import './reader-contents.js'
import { icon } from './reader-icons.js'
import { READER_BAR_STYLES, READER_TOKENS } from './reader-styles.js'

export interface ReaderBarFind {
  readonly open: boolean
  readonly query: string
  readonly count: number
  readonly index: number
}

@customElement('mn-reader-bar')
export class MnReaderBar extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static override styles = [
    READER_TOKENS,
    READER_BAR_STYLES,
  ]

  @property({ type: String }) override title = ''
  @property({ type: String }) author = ''
  /** Which side of Original / Text is showing. */
  @property({ type: String, reflect: true }) view: 'original' | 'text' = 'original'
  /** Both sides exist: show the Original / Text control. */
  @property({ type: Boolean, attribute: 'view-toggle' }) viewToggle = false
  @property({ type: Boolean, attribute: 'sidebar-pressed' }) sidebarPressed = false
  @property({ type: Boolean, attribute: 'sidebar-disabled' }) sidebarDisabled = false
  /** No sidebar in this view: the button keeps its place, unseen, so the title does not move. */
  @property({ type: Boolean, attribute: 'no-sidebar' }) noSidebar = false
  @property({ type: Boolean, attribute: 'find-pressed' }) findPressed = false
  @property({ type: Boolean, attribute: 'find-disabled' }) findDisabled = false
  /** A thin line under the bar: how far through (0..1); null for none. */
  @property({ type: Number }) progress: number | null = null
  /** The ⋯ menu. */
  @property({ attribute: false }) menu: readonly MenuEntry[] = []
  /** A line of status where the location goes when the view has none (the text's "View only"). */
  @property({ type: String }) status = ''
  @property({ type: String }) error = ''
  /** The find box under the bar, when the view's find lives here (the text; the Reader draws its own). */
  @property({ attribute: false }) find: ReaderBarFind | null = null

  @query('mn-context-menu.more') private menuElement?: MnContextMenu
  @query('mn-context-menu.ctx') private contextElement?: MnContextMenu

  protected override updated(changed: PropertyValues): void {
    if (changed.has('find') && this.find?.open && !(changed.get('find') as ReaderBarFind | null | undefined)?.open) this.focusSearchInput()
  }

  /** The editor host asks for focus here when it opens find, as it does of the editor toolbar. */
  focusSearchInput(): void {
    void this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>('[data-search-input]')
      input?.focus()
      input?.select()
    })
  }

  private say<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T | undefined>(type, { bubbles: true, composed: true, detail }))
  }

  private openMenu(event: MouseEvent): void {
    const button = event.currentTarget as HTMLElement
    const rect = button.getBoundingClientRect()
    const menu = this.menuElement
    if (!menu) return
    menu.items = this.menu
    menu.show({ x: rect.right, y: rect.bottom + 4 }, 'top-right')
  }

  /** The right-click menu of the text under the bar (the editor host owns the text; the bar owns the menu's look). */
  showContextMenu(items: readonly MenuEntry[], point: { x: number; y: number }): void {
    const menu = this.contextElement
    if (!menu) return
    menu.items = items
    menu.show(point)
  }

  private onContextSelect(event: CustomEvent<MenuSelectDetail>): void {
    event.stopPropagation()
    this.say('rd-bar-context', { id: event.detail.id })
  }

  private onSelect(event: CustomEvent<MenuSelectDetail>): void {
    // The menu's own event stays here: the bar says what was chosen in its own words.
    event.stopPropagation()
    this.say('rd-bar-menu', { id: event.detail.id, modifiers: event.detail.modifiers })
  }

  protected override render(): TemplateResult {
    const find = this.find
    return html`<header class="bar" role="toolbar" aria-label=${t('Reader')}>
        <div class="bar-start">
          <button type="button" class="btn" aria-label=${t('Contents and pages')} title=${t('Contents and pages')} aria-pressed=${this.sidebarPressed ? 'true' : 'false'}
            ?disabled=${this.sidebarDisabled} style=${this.noSidebar ? 'visibility:hidden' : ''} tabindex=${this.noSidebar ? '-1' : '0'}
            @click=${() => this.say('rd-bar-sidebar')}>${icon('sidebar')}</button>
          <div class="title"><b>${this.title}</b>${this.author ? html`<small>${this.author}</small>` : nothing}</div>
        </div>
        <div class="loc"><slot name="location">${this.status ? html`<span class="status" role="status">${this.status}</span>` : nothing}</slot></div>
        <div class="bar-end">
          <slot name="tools"></slot>
          <button type="button" class="btn" aria-label=${t('Find')} title=${t('Find (⌘F)')} aria-pressed=${this.findPressed ? 'true' : 'false'} ?disabled=${this.findDisabled}
            data-search-open @click=${() => this.say('rd-bar-find', { open: !this.findPressed })}>${icon('search')}</button>
          <slot name="tools-end"></slot>
          ${this.viewToggle ? html`<span class="sep"></span>
            <div class="seg" role="group" aria-label=${t('View')}>
              <button type="button" aria-pressed=${this.view === 'original' ? 'true' : 'false'} title=${t('The original')}
                @click=${() => { if (this.view !== 'original') this.say('mn-editor-original-view-toggle', {}) }}>${t('Original')}</button>
              <button type="button" aria-pressed=${this.view === 'text' ? 'true' : 'false'} title=${t('The text made from it')}
                @click=${() => { if (this.view !== 'text') this.say('mn-editor-original-view-toggle', {}) }}>${t('Text')}</button>
            </div>` : nothing}
          <button type="button" class="btn" aria-label=${t('More')} title=${t('More')} aria-haspopup="menu" data-more @click=${(e: MouseEvent) => this.openMenu(e)}>${icon('more')}</button>
        </div>
        ${this.progress !== null ? html`<div class="bar-progress" style=${`width:${(this.progress * 100).toFixed(2)}%`}></div>` : nothing}
      </header>
      ${this.error ? html`<p class="bar-error" role="alert">${this.error}</p>` : nothing}
      ${find?.open ? html`<div class="find-pop" role="search">
        <input type="search" autocomplete="off" spellcheck="false" placeholder=${t('Find')} aria-label=${t('Find')} data-search-input .value=${find.query}
          @input=${(e: Event) => this.say('mn-editor-search-input', { value: (e.target as HTMLInputElement).value })}
          @keydown=${(e: KeyboardEvent) => this.say('mn-editor-search-keydown', { keyboardEvent: e })} />
        <span class="count" data-search-count aria-live="polite">${find.query ? `${find.count > 0 ? find.index + 1 : 0} / ${find.count}` : ''}</span>
        <button type="button" class="btn" aria-label=${t('Previous match')} ?disabled=${find.count === 0} @click=${() => this.say('mn-editor-search-prev')}>${icon('up')}</button>
        <button type="button" class="btn" aria-label=${t('Next match')} ?disabled=${find.count === 0} @click=${() => this.say('mn-editor-search-next')}>${icon('down')}</button>
        <button type="button" class="btn" aria-label=${t('Close find')} @click=${() => this.say('mn-editor-search-close')}>${icon('x')}</button>
      </div>` : nothing}
      <mn-context-menu class="more" @mn-select=${(e: CustomEvent<MenuSelectDetail>) => this.onSelect(e)}></mn-context-menu>
      <mn-context-menu class="ctx" @mn-select=${(e: CustomEvent<MenuSelectDetail>) => this.onContextSelect(e)}></mn-context-menu>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'mn-reader-bar': MnReaderBar }
}
