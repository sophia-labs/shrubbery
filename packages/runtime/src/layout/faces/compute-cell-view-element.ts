/** Read-only notebook cell body for the graph-native `compute.cell` Face. */
import { sanitizeHtml } from '@shrubbery/chat-kernel'
import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'

export interface ComputeCellOutputView {
  readonly kind: 'stream' | 'display' | 'result' | 'error'
  readonly name?: string
  readonly text?: string
  readonly data?: unknown
  readonly metadata?: unknown
  readonly error?: { readonly ename: string; readonly evalue: string; readonly traceback: readonly string[] }
}

export interface ComputeCellViewModel {
  readonly cellIri: string
  readonly cellRef: string
  readonly ordinal: number
  readonly generation: number
  readonly source: string
  readonly status: 'ok' | 'error' | 'aborted'
  readonly executionCount?: number
  readonly outputs: readonly ComputeCellOutputView[]
  readonly startedAt: number
  readonly completedAt: number
  readonly durationMs: number
  readonly cellDigest: string
}

export type ComputeCellViewStatus = 'loading' | 'ready' | 'error'

const MAX_INLINE_IMAGE_CHARS = 8 * 1024 * 1024
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function validBase64(value: string): boolean {
  return value.length > 0 && value.length <= MAX_INLINE_IMAGE_CHARS && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

/** Select the richest safe representation from a Jupyter MIME bundle. */
export function preferredComputeMime(data: unknown): { readonly mediaType: string; readonly value: unknown } | null {
  if (!isRecord(data)) return data === undefined ? null : { mediaType: 'text/plain', value: data }
  for (const mediaType of ['text/html', ...IMAGE_MEDIA_TYPES, 'application/json', 'text/plain']) {
    if (Object.hasOwn(data, mediaType)) return { mediaType, value: data[mediaType] }
  }
  const first = Object.entries(data)[0]
  return first ? { mediaType: first[0], value: first[1] } : null
}

@customElement('sh-compute-cell-view')
export class ShComputeCellView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      min-height: 180px;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      color: var(--mn-color-text-primary);
      background: var(--mn-color-surface-base);
      font: var(--mn-text-sm, 13px) / 1.55 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .cell {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card);
    }
    .header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    .prompt {
      color: var(--mn-color-accent);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-weight: 650;
    }
    .status {
      padding: 1px var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-full, 999px);
      font-weight: 650;
    }
    .status[data-status='ok'] {
      color: var(--mn-color-success-strong);
      background: var(--mn-color-success-surface);
    }
    .status[data-status='error'], .status[data-status='aborted'] {
      color: var(--mn-color-danger-strong);
      background: var(--mn-color-danger-surface);
    }
    .meta-end { margin-left: auto; }
    .source, .output {
      display: grid;
      grid-template-columns: minmax(54px, auto) minmax(0, 1fr);
      border-bottom: 1px solid var(--mn-color-border-subtle);
    }
    .output:last-child { border-bottom: 0; }
    .gutter {
      padding: var(--mn-space-3, 12px) var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary);
      background: var(--mn-color-surface-sunken);
      border-right: 1px solid var(--mn-color-border-subtle);
      font: var(--mn-text-xs, 12px) / 1.5 var(--mn-font-mono, ui-monospace, monospace);
      text-align: right;
      user-select: none;
    }
    .content {
      min-width: 0;
      overflow: auto;
      padding: var(--mn-space-3, 12px);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: var(--mn-text-sm, 13px) / 1.55 var(--mn-font-mono, ui-monospace, monospace);
    }
    .stream[data-name='stderr'], .traceback { color: var(--mn-color-danger-strong); }
    .error-name { font-weight: 700; color: var(--mn-color-danger-strong); }
    .html-output { overflow: auto; }
    img {
      display: block;
      max-width: 100%;
      height: auto;
    }
    details {
      margin-top: var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    summary { cursor: pointer; }
    .state {
      display: grid;
      flex: 1 1 auto;
      min-height: 160px;
      place-content: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary);
      text-align: center;
    }
    .state[data-tone='danger'] { color: var(--mn-color-danger-strong); }
  `

  @property({ type: String }) status: ComputeCellViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ attribute: false }) cell: ComputeCellViewModel | null = null

  private state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private renderMime(data: unknown): TemplateResult {
    const selected = preferredComputeMime(data)
    if (!selected) return html`<span>No display data.</span>`
    const { mediaType, value } = selected
    let rendered: TemplateResult
    if (mediaType === 'text/html') {
      rendered = html`<div class="html-output">${unsafeHTML(sanitizeHtml(printable(value)))}</div>`
    } else if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      const encoded = typeof value === 'string' ? value.replace(/\s+/g, '') : ''
      rendered = validBase64(encoded)
        ? html`<img src=${`data:${mediaType};base64,${encoded}`} alt="Jupyter cell output" />`
        : html`<pre>Invalid or oversized ${mediaType} payload.</pre>`
    } else if (mediaType === 'application/json') {
      rendered = html`<pre>${printable(value)}</pre>`
    } else {
      rendered = html`<pre>${printable(value)}</pre>`
    }
    const bundle = isRecord(data) ? data : { [mediaType]: value }
    return html`${rendered}<details><summary>Representations (${Object.keys(bundle).join(', ')})</summary><pre>${printable(bundle)}</pre></details>`
  }

  private renderOutput(output: ComputeCellOutputView, index: number): TemplateResult {
    const label = output.kind === 'stream' ? output.name ?? 'stream' : output.kind
    let body: TemplateResult
    if (output.kind === 'error') {
      const error = output.error
      body = html`
        <div class="error-name">${error ? `${error.ename}: ${error.evalue}` : 'Execution error'}</div>
        ${error?.traceback?.length ? html`<pre class="traceback">${error.traceback.join('\n')}</pre>` : nothing}
      `
    } else if (output.kind === 'stream') {
      body = html`<pre class="stream" data-name=${output.name ?? 'stream'}>${output.text ?? ''}</pre>`
    } else {
      body = this.renderMime(output.data ?? output.text)
    }
    return html`
      <section class="output" data-output-index=${index} data-output-kind=${output.kind}>
        <div class="gutter">${label}</div>
        <div class="content">
          ${body}
          ${output.metadata === undefined ? nothing : html`<details><summary>Metadata</summary><pre>${printable(output.metadata)}</pre></details>`}
        </div>
      </section>
    `
  }

  render(): TemplateResult {
    if (this.status === 'loading') return html`<article class="cell">${this.state('Loading notebook cell…')}</article>`
    if (this.status === 'error' || !this.cell) {
      return html`<article class="cell">${this.state(this.error || 'This notebook cell could not be loaded.', 'danger')}</article>`
    }
    const cell = this.cell
    const prompt = cell.executionCount ?? cell.ordinal + 1
    return html`
      <article class="cell" aria-label=${`Notebook cell ${cell.ordinal + 1}`}>
        <header class="header">
          <span class="prompt">In [${prompt}]</span>
          <span class="status" data-status=${cell.status}>${cell.status}</span>
          <span>generation ${cell.generation}</span>
          <span class="meta-end">${cell.durationMs} ms</span>
        </header>
        <section class="source">
          <div class="gutter">code</div>
          <div class="content"><pre><code>${cell.source}</code></pre></div>
        </section>
        ${cell.outputs.length === 0
          ? html`<section class="output"><div class="gutter">out</div><div class="content">No output.</div></section>`
          : cell.outputs.map((output, index) => this.renderOutput(output, index))}
      </article>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-compute-cell-view': ShComputeCellView
  }
}
