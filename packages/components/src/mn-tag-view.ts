/**
 * mn-tag-view — controlled, read-only tag lens.
 *
 * Garden's original tag page mixes rendering with document/API lookups. This
 * component keeps only the visual shell and user intents: callers provide the
 * tag status + blocks and receive refresh/open events. It never fetches,
 * subscribes, persists, or interprets a workspace contract.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-empty-state.js'
import './mn-loading.js'

export type MnTagViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MnTagViewBlock {
  readonly id: string
  readonly documentId: string
  readonly documentTitle?: string | null
  readonly blockId?: string | null
  readonly text: string
  readonly type?: string | null
  readonly updatedAt?: string | null
}

export interface MnTagViewRefreshDetail {
  readonly tagName: string
}

export interface MnTagViewOpenBlockDetail {
  readonly tagName: string
  readonly documentId: string
  readonly blockId?: string | null
  readonly block: MnTagViewBlock
}

interface BlockGroup {
  readonly id: string
  readonly title: string
  readonly blocks: readonly MnTagViewBlock[]
}

function displayTagName(value: string): string {
  const name = value.trim().replace(/^#/, '')
  return name || 'tag'
}

function groupBlocks(blocks: readonly MnTagViewBlock[]): BlockGroup[] {
  const groups = new Map<string, { title: string; blocks: MnTagViewBlock[] }>()
  for (const block of blocks) {
    const key = block.documentId || 'unknown'
    const existing = groups.get(key)
    if (existing) {
      existing.blocks.push(block)
      continue
    }
    groups.set(key, {
      title: block.documentTitle?.trim() || block.documentId || 'Untitled',
      blocks: [block],
    })
  }
  return Array.from(groups, ([id, group]) => ({ id, title: group.title, blocks: group.blocks }))
}

@customElement('mn-tag-view')
export class MnTagView extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background:
        linear-gradient(180deg, rgba(37, 99, 235, 0.05), transparent 220px),
        var(--mn-color-surface-base, #fff);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .tag-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      min-height: 56px;
      padding: var(--mn-space-3, 12px) var(--mn-space-5, 20px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-panel-bg, rgba(255, 255, 255, 0.92));
      box-sizing: border-box;
      flex: 0 0 auto;
    }

    .glyph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: var(--mn-radius-control, 6px);
      color: var(--mn-color-text-accent, #1d4ed8);
      background: var(--mn-color-surface-accent, #eef2ff);
      flex: 0 0 auto;
    }

    .title-wrap {
      flex: 1 1 auto;
      min-width: 0;
    }

    .title {
      margin: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-2xl, 24px);
      font-weight: var(--mn-font-weight-semibold, 600);
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin-top: 4px;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
    }

    .scope {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: var(--mn-font-weight-semibold, 600);
      text-transform: uppercase;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      flex: 0 0 auto;
    }

    .icon-button:hover {
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
    }

    .state {
      display: grid;
      min-height: 240px;
      place-items: center;
    }

    .groups {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
      max-width: 880px;
    }

    .group {
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-panel-bg, #fff);
      overflow: hidden;
    }

    .group-header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: 34px;
      padding: 0 var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-secondary, #4b5563);
      background: var(--mn-color-surface-sunken, #f9fafb);
      font-size: var(--mn-text-xs, 12px);
      font-weight: var(--mn-font-weight-semibold, 600);
      box-sizing: border-box;
    }

    .group-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .group-count {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-weight: var(--mn-font-weight-medium, 500);
    }

    .block-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-3, 12px);
      width: 100%;
      min-height: 48px;
      padding: var(--mn-space-3, 12px);
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .block-row:last-child {
      border-bottom: 0;
    }

    .block-row:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .block-text {
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-serif, Georgia, serif);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .block-meta {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin-top: 6px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .type {
      text-transform: capitalize;
    }

    .open-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    :host([data-skin='emporium']) .glyph,
    :host([data-skin='emporium']) .icon-button,
    :host([data-skin='emporium']) .group {
      border-radius: var(--mn-radius-control, 4px);
    }
  `

  @property({ type: String }) tag = ''
  @property({ type: String }) status: MnTagViewStatus = 'idle'
  @property({ attribute: false }) blocks: readonly MnTagViewBlock[] = []
  @property({ type: String }) error = ''

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _refresh(): void {
    this._emit<MnTagViewRefreshDetail>('mn-tag-view-refresh', { tagName: displayTagName(this.tag) })
  }

  private _openBlock(block: MnTagViewBlock): void {
    this._emit<MnTagViewOpenBlockDetail>('mn-tag-view-open-block', {
      tagName: displayTagName(this.tag),
      documentId: block.documentId,
      blockId: block.blockId ?? block.id,
      block,
    })
  }

  private _renderContent(tagName: string): TemplateResult {
    if (this.status === 'loading' || this.status === 'idle') {
      return html`<div class="state"><mn-loading size="sm" text=${`Loading #${tagName}`}></mn-loading></div>`
    }
    if (this.status === 'error') {
      return html`
        <div class="state">
          <mn-empty-state
            icon="alert-circle"
            title=${`Could not load #${tagName}`}
            description=${this.error || 'The tag lens read failed.'}
            mood="danger"
          ></mn-empty-state>
        </div>
      `
    }
    const groups = groupBlocks(this.blocks)
    if (groups.length === 0) {
      return html`
        <div class="state">
          <mn-empty-state
            icon="hash"
            title=${`No blocks tagged #${tagName}`}
            description="Tagged blocks will appear here when the workspace projection contains matches."
          ></mn-empty-state>
        </div>
      `
    }
    return html`
      <div class="groups">
        ${repeat(
          groups,
          (group) => group.id,
          (group) => html`
            <section class="group" data-document-id=${group.id}>
              <header class="group-header">
                ${icon('file-text', { size: 14 })}
                <span class="group-title">${group.title}</span>
                <span class="group-count">${group.blocks.length}</span>
              </header>
              ${repeat(
                group.blocks,
                (block) => block.id,
                (block) => html`
                  <button
                    type="button"
                    class="block-row"
                    data-block-id=${block.blockId ?? block.id}
                    @click=${() => this._openBlock(block)}
                  >
                    <span>
                      <span class="block-text">${block.text || '(empty block)'}</span>
                      <span class="block-meta">
                        ${block.type ? html`<span class="type">${block.type}</span>` : nothing}
                        ${block.updatedAt ? html`<span>${block.updatedAt}</span>` : nothing}
                      </span>
                    </span>
                    <span class="open-icon" aria-hidden="true">${icon('external-link', { size: 15 })}</span>
                  </button>
                `,
              )}
            </section>
          `,
        )}
      </div>
    `
  }

  render(): TemplateResult {
    const tagName = displayTagName(this.tag)
    const count = this.status === 'ready' ? this.blocks.length : 0
    return html`
      <section class="tag-view" aria-label=${`Tag lens for #${tagName}`}>
        <header class="header">
          <span class="glyph" aria-hidden="true">${icon('hash', { size: 19 })}</span>
          <span class="title-wrap">
            <h2 class="title">#${tagName}</h2>
            <span class="meta">
              <span class="scope">Global</span>
              ${this.status === 'ready' ? html`<span>${count} block${count === 1 ? '' : 's'}</span>` : nothing}
            </span>
          </span>
          <button
            type="button"
            class="icon-button"
            title="Refresh tag"
            aria-label="Refresh tag"
            @click=${this._refresh}
          >
            ${icon('refresh', { size: 16 })}
          </button>
        </header>
        <div class="content">${this._renderContent(tagName)}</div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-tag-view': MnTagView
  }
}
