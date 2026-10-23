/**
 * mn-file-info — the Files "Show info" panel (Finder's Get Info): one metadata panel for the selected item that replaces the
 * right pane until it is closed. Controlled, like mn-inspector: the host owns every fact and every side effect; this draws them and
 * says what the person asked (close, rename, press a row, copy).
 *
 * A model is a title, a kind line and sections of rows. A row is a label and a text; it may carry a corroboration mark, be set in
 * monospace, be copyable (a digest), or be an `action` (a button that says its id back: a clickable location, a connection, "Open in reader").
 */
import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnFileInfoRow {
  readonly label: string
  readonly text: string
  /** A corroboration mark drawn after the text ('●●●', '⚠'). */
  readonly mark?: string
  readonly markTitle?: string
  readonly mono?: boolean
  /** Offers a Copy button for `copyText` (default: `text`). */
  readonly copy?: boolean
  readonly copyText?: string
  /** Makes the row a button; the id is handed back in `mn-file-info-action`. */
  readonly action?: string
  readonly title?: string
}

export interface MnFileInfoSection {
  readonly id: string
  readonly title: string
  readonly count?: number
  readonly rows: readonly MnFileInfoRow[]
  /** Said when the section has no rows ('No connections.'); a section with neither rows nor a note is not drawn. */
  readonly note?: string
}

export interface MnFileInfoModel {
  /** The item's name; renamable in place when `renamable`. */
  readonly title: string
  /** 'PDF file', 'Folder', '3 items'. */
  readonly typeLabel: string
  readonly icon?: string
  readonly renamable?: boolean
  readonly sections: readonly MnFileInfoSection[]
}

export interface MnFileInfoActionDetail { readonly action: string }
export interface MnFileInfoRenameDetail { readonly name: string }

@customElement('mn-file-info')
export class MnFileInfo extends SkinAware(LitElement) {
  protected readonly _locale = new LocaleController(this)

  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--mn-color-panel-bg, var(--mn-color-surface-base, #fff));
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }
    .header {
      display: flex; align-items: center; justify-content: space-between; gap: var(--mn-space-3, 12px);
      min-height: var(--mn-y-slice-1-height, 44px); padding: 0 var(--mn-space-4, 16px); box-sizing: border-box; flex: 0 0 auto;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }
    .header-left { display: inline-flex; align-items: center; gap: var(--mn-space-2, 8px); min-width: 0; color: var(--mn-color-text-muted, #6b7280); }
    .header-title {
      color: var(--mn-color-text-secondary, #4b5563); font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px); font-weight: var(--mn-font-weight-semibold, 650); letter-spacing: 0.05em; text-transform: uppercase;
    }
    button { font: inherit; color: inherit; }
    .close-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0;
      border-radius: var(--mn-radius-md, 6px); background: transparent; color: var(--mn-color-text-muted, #6b7280); cursor: pointer;
    }
    .close-btn:hover, .row-action:hover, .copy:hover { background: var(--mn-color-surface-hover, #f3f4f6); color: var(--mn-color-text-primary, #111827); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--mn-color-border-focus, var(--mn-color-text-accent, #2563eb)); outline-offset: 1px; }
    .body {
      display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; gap: var(--mn-space-4, 16px); overflow: auto;
      padding: var(--mn-space-4, 16px); box-sizing: border-box;
    }
    .identity {
      display: flex; align-items: flex-start; gap: var(--mn-space-3, 12px); padding: var(--mn-space-3, 12px); box-sizing: border-box;
      border: 1px solid var(--mn-color-border-default, #d1d5db); border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-warm, var(--mn-color-surface-base, #fff));
    }
    .identity-icon {
      display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 32px; height: 32px;
      border-radius: var(--mn-radius-md, 6px); background: var(--mn-color-surface-accent, #eff6ff); color: var(--mn-color-text-accent, #2563eb);
    }
    .identity-text { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 2px; }
    .title { font-size: var(--mn-text-sm, 13px); font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
    .rename {
      width: 100%; box-sizing: border-box; padding: 2px 4px; margin: -3px -5px; border: 1px solid transparent; border-radius: var(--mn-radius-md, 6px);
      background: transparent; font: inherit; font-weight: 650; color: inherit;
    }
    .rename:hover { border-color: var(--mn-color-border-subtle, #e5e7eb); }
    .rename:focus { border-color: var(--mn-color-border-default, #d1d5db); background: var(--mn-color-surface-base, #fff); }
    .type { color: var(--mn-color-text-muted, #6b7280); font-size: var(--mn-text-xs, 12px); }
    .section { display: flex; flex-direction: column; gap: var(--mn-space-2, 8px); }
    .section-title {
      display: flex; align-items: center; gap: var(--mn-space-2, 8px); margin: 0; color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif); font-size: var(--mn-text-2xs, 11px); font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase;
    }
    .section-title .count { font-family: var(--mn-font-chrome, system-ui, sans-serif); font-weight: 500; letter-spacing: 0; }
    .rows { display: flex; flex-direction: column; gap: var(--mn-space-1, 4px); margin: 0; padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: minmax(4.5rem, 7.5rem) minmax(0, 1fr); gap: var(--mn-space-2, 8px); align-items: baseline; font-size: var(--mn-text-xs, 12px); }
    .row-label { color: var(--mn-color-text-muted, #6b7280); }
    .row-value { display: flex; align-items: baseline; gap: var(--mn-space-1, 4px); min-width: 0; overflow-wrap: anywhere; color: var(--mn-color-text-secondary, #4b5563); }
    .row-value.mono { font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
    .mark { flex: 0 0 auto; color: var(--mn-color-text-muted, #6b7280); letter-spacing: 0.02em; }
    .row-action {
      display: inline-flex; max-width: 100%; align-items: baseline; gap: var(--mn-space-1, 4px); padding: 0 4px; margin: 0 -4px; border: 0; border-radius: var(--mn-radius-md, 6px);
      background: transparent; color: var(--mn-color-text-accent, #2563eb); cursor: pointer; text-align: left; overflow-wrap: anywhere;
    }
    .row-action.verb { grid-column: 1 / -1; padding: 4px 8px; margin: 0; border: 1px solid var(--mn-color-border-default, #d1d5db); justify-content: center; }
    .copy {
      flex: 0 0 auto; padding: 0 4px; border: 0; border-radius: var(--mn-radius-md, 6px); background: transparent; color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer; font-size: var(--mn-text-2xs, 11px);
    }
    .note { color: var(--mn-color-text-muted, #6b7280); font-size: var(--mn-text-xs, 12px); }
    @media (max-width: 560px) {
      .row { grid-template-columns: minmax(0, 1fr); gap: 0; }
    }
  `

  @property({ attribute: false }) model: MnFileInfoModel | null = null
  @state() private copied = ''

  override connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this.onKey)
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.onKey)
    super.disconnectedCallback()
  }

  /** Esc closes the panel, unless something nearer (a menu, a rename, the canvas) already took the key. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    this.close()
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('mn-file-info-close', { bubbles: true, composed: true }))
  }

  private press(action: string): void {
    this.dispatchEvent(new CustomEvent<MnFileInfoActionDetail>('mn-file-info-action', { bubbles: true, composed: true, detail: { action } }))
  }

  private async copy(row: MnFileInfoRow): Promise<void> {
    try { await navigator.clipboard.writeText(row.copyText ?? row.text) } catch { /* the label still says what was tried */ }
    this.copied = row.label
    setTimeout(() => { if (this.copied === row.label) this.copied = '' }, 1500)
  }

  private rename(input: HTMLInputElement, commit: boolean): void {
    const model = this.model
    if (!model) return
    const name = input.value.trim()
    if (commit && name && name !== model.title) {
      this.dispatchEvent(new CustomEvent<MnFileInfoRenameDetail>('mn-file-info-rename', { bubbles: true, composed: true, detail: { name } }))
    } else input.value = model.title
  }

  private renderRow(row: MnFileInfoRow): TemplateResult {
    if (row.action && !row.label) {
      return html`<li class="row"><button type="button" class="row-action verb" data-action=${row.action} @click=${() => this.press(row.action!)}>${row.text}</button></li>`
    }
    const value = row.action
      ? html`<button type="button" class="row-action" data-action=${row.action} title=${row.title ?? row.text} @click=${() => this.press(row.action!)}>${row.text}</button>`
      : html`<span title=${row.title ?? nothing}>${row.text}</span>`
    return html`<li class="row" data-label=${row.label}>
      <span class="row-label">${row.label}</span>
      <span class=${`row-value${row.mono ? ' mono' : ''}`}>${value}
        ${row.mark ? html`<span class="mark" title=${row.markTitle ?? nothing} aria-label=${row.markTitle ?? row.mark}>${row.mark}</span>` : nothing}
        ${row.copy ? html`<button type="button" class="copy" data-copy=${row.label} aria-label=${`Copy ${row.label}`} @click=${() => { void this.copy(row) }}>${this.copied === row.label ? 'Copied' : t('Copy')}</button>` : nothing}
      </span>
    </li>`
  }

  private renderSection(section: MnFileInfoSection): TemplateResult | typeof nothing {
    if (!section.rows.length && !section.note) return nothing
    return html`<section class="section" data-section=${section.id}>
      <h3 class="section-title">${section.title}${section.count !== undefined ? html`<span class="count">${section.count}</span>` : nothing}</h3>
      ${section.rows.length ? html`<ul class="rows">${section.rows.map(r => this.renderRow(r))}</ul>` : html`<div class="note">${section.note}</div>`}
    </section>`
  }

  override render(): TemplateResult {
    const model = this.model
    return html`
      <header class="header">
        <div class="header-left">${icon('info', { size: 14 })}<span class="header-title">${t('Info')}</span></div>
        <button type="button" class="close-btn" title=${t('Close info (Esc)')} aria-label=${t('Close info')} @click=${() => this.close()}>${icon('x', { size: 14 })}</button>
      </header>
      <div class="body" role="region" aria-label=${t('Info')}>
        ${model ? html`
          <div class="identity">
            <span class="identity-icon">${icon(model.icon ?? 'file-text', { size: 16 })}</span>
            <div class="identity-text">
              ${model.renamable
                ? html`<input class="rename" type="text" aria-label=${t('Name')} .value=${model.title} spellcheck="false"
                    @keydown=${(e: KeyboardEvent) => {
                      const input = e.target as HTMLInputElement
                      if (e.key === 'Enter') { e.preventDefault(); this.rename(input, true); input.blur() }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.rename(input, false); input.blur() }
                    }}
                    @blur=${(e: FocusEvent) => this.rename(e.target as HTMLInputElement, true)} />`
                : html`<div class="title">${model.title}</div>`}
              <div class="type">${model.typeLabel}</div>
            </div>
          </div>
          ${model.sections.map(s => this.renderSection(s))}` : html`<div class="note">${t('Nothing to show.')}</div>`}
      </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-file-info': MnFileInfo
  }
}
