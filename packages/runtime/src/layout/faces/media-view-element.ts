/**
 * media-view-element.ts — `<sh-media-view>`, the genuinely-different pane
 * (Builder-2 task brief guard rail 2; design §7.4/§9.1's "durable, byte-shaped
 * blob resource").
 *
 * Builds on the file-pane precedent (`mn-original-viewer`'s kind-inference +
 * image/pdf/text rendering strategy — packages/components/src/mn-original-
 * viewer.ts) WITHOUT importing it: `packages/runtime` cannot depend on
 * `@shrubbery/components` (that package holds `@shrubbery/runtime` as a
 * DEV-only dependency for its own tests — a real dependency the other way
 * would be circular), and editor-host.ts's own precedent is to reference such
 * tags by name only, never import them, leaving registration to the shell.
 * Rather than reach for that pattern here, this is a small SELF-CONTAINED
 * element scoped exactly to what guard rail 2 asks for.
 *
 * NO CRDT, NO provider, NO editor machinery, NO toolbar — this element reads
 * only `src`/`mimeType`/`filename`/`status`/`error` plain properties and
 * renders content. It is not a block inside a document; it is a top-level
 * pane over a durable blob resource, full stop.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type MediaViewKind = 'image' | 'pdf' | 'text' | 'file'
export type MediaViewStatus = 'idle' | 'loading' | 'ready' | 'error'

function extensionOf(filename: string): string {
  const clean = filename.split(/[?#]/, 1)[0] ?? ''
  const idx = clean.lastIndexOf('.')
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : ''
}

/** Pure — mirrors `mn-original-viewer`'s `inferKind`, trimmed to the kinds this pane renders. */
export function inferMediaViewKind(mimeType: string, filename: string): MediaViewKind {
  const mime = mimeType.toLowerCase()
  const ext = extensionOf(filename)
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf'
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml', 'log'].includes(ext)) return 'text'
  return 'file'
}

@customElement('sh-media-view')
export class ShMediaView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #1f2933);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: auto;
    }
    .image-wrap {
      display: grid;
      flex: 1 1 auto;
      place-items: center;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
    }
    .image-wrap img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    iframe {
      flex: 1 1 auto;
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--mn-color-surface-base, #fff);
    }
    .text-view {
      flex: 1 1 auto;
      overflow: auto;
      margin: 0;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .state {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-tertiary, #6b7280);
      text-align: center;
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-danger-strong, #b91c1c);
    }
  `

  @property({ type: String }) src = ''
  @property({ type: String }) mimeType = ''
  @property({ type: String }) filename = ''
  @property({ type: String }) text = ''
  @property({ type: String }) status: MediaViewStatus = 'idle'
  @property({ type: String }) error = ''

  private _kind(): MediaViewKind {
    return inferMediaViewKind(this.mimeType, this.filename)
  }

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _body(): TemplateResult | typeof nothing {
    if (this.status === 'idle' || this.status === 'loading') return this._state('Loading…')
    if (this.status === 'error') return this._state(this.error || 'This file could not be loaded.', 'danger')
    if (!this.src) return this._state('No file available.')

    const kind = this._kind()
    if (kind === 'image') {
      return html`<div class="image-wrap"><img src=${this.src} alt=${this.filename || 'artifact image'} /></div>`
    }
    if (kind === 'pdf') {
      return html`<iframe title=${this.filename || 'PDF'} src=${this.src}></iframe>`
    }
    if (kind === 'text') {
      return html`<pre class="text-view">${this.text}</pre>`
    }
    return this._state(`${this.filename || 'This file'} cannot be previewed inline.`)
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" aria-label="Media viewer">${this._body()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-media-view': ShMediaView
  }
}
