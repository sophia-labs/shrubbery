import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'

/**
 * `<sh-flow-app-frame>` — the Flow app's region in the organism workspace.
 *
 * A same-origin frame of the `/flow/` Shrubbery app (apps/flow) on the active
 * graph. Same origin means the same `/cell` proxy and the same cell: the board
 * the frame edits is the `flow-board` room of the graph Garden has open. The
 * frame is retained across workspace re-renders by the Flow shell feature, so
 * switching back to Flow never reloads the board.
 */
@customElement('sh-flow-app-frame')
export class ShFlowAppFrame extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static override styles = css`
    :host { display: block; width: 100%; height: 100%; min-height: 0; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: var(--mn-color-bg, #fff); }
    .empty { padding: 24px; font: inherit; color: var(--mn-color-text-muted, #666); }
  `

  /** The graph whose `flow-board` the frame opens. Empty ⇒ an honest empty state, never a guessed graph. */
  @property({ attribute: 'graph-id' }) graphId = ''
  /** The Flow app's absolute base (its build's `FLOW_BASE_PATH`). */
  @property({ attribute: 'flow-base' }) flowBase = '/flow/'

  /** The frame URL for the current graph, or '' when there is no graph. */
  get frameSrc(): string {
    const graph = this.graphId.trim()
    if (!graph) return ''
    const base = this.flowBase.endsWith('/') ? this.flowBase : `${this.flowBase}/`
    return `${base}?graph=${encodeURIComponent(graph)}`
  }

  override render() {
    const src = this.frameSrc
    if (!src) return html`<p class="empty">${t('Open a workspace to see its Flow board.')}</p>`
    return html`<iframe title="Mithras Flow" src=${src} data-flow-graph=${this.graphId}></iframe>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-flow-app-frame': ShFlowAppFrame
  }
}
