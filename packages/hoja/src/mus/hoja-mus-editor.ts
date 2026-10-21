/**
 * `<hoja-mus-editor>` — Hoja's MUS mode: a page whose one ```mus fence is the score.
 *
 * It is `<hoja-editor posture="page">` with two host seams filled: the MUS grammar as its code highlighter
 * (`musHighlighter`), and the checker's verdict drawn into the fence (`FenceDiagnostics`: the wrong token underlined,
 * a note at the end of its line). Prose around the fence is the piece's notes. It checks nothing itself: the host
 * (`@shrubbery/runtime/mus`'s controller, or anything that speaks `MusCheckReport`) hands it verdicts with `setVerdict`
 * and it draws the ones that match the text on screen.
 *
 *   <hoja-mus-editor .document=${musPageDocument(score)} @mus-source-change=${e => check(e.detail.source)}></hoja-mus-editor>
 *
 * Events (bubbling, composed):
 *   `mus-source-change` {source, error, document}: the score as projected after an edit (`source` null and `error` set
 *   when the page holds no ```mus fence, or two).
 */
import { LitElement, html, type CSSResult, type PropertyValues } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { createFenceDiagnostics, type FenceDiagnostic, type FenceDiagnosticsPort } from '@shrubbery/editor-kernel'

import '../hoja-editor.js'
import type { HojaEditor } from '../hoja-editor.js'
import type { HojaComposerDetail, HojaJSONContent } from '../types.js'
import { musHighlighter } from './mus-grammar.js'
import { projectMusSource } from './source-projection.js'
import { musEditorStyles } from './styles.js'
import type { MusCheckReport, MusDiagnostic } from './types.js'

export interface MusSourceChangeDetail {
  readonly source: string | null
  readonly error: string | null
  readonly document: HojaJSONContent
}

let sheet: CSSStyleSheet | null = null

/** The diagnostics a fence can draw: the ones with a span. */
export function fenceDiagnosticsOf(report: MusCheckReport): FenceDiagnostic[] {
  return report.diagnostics
    .filter((d): d is MusDiagnostic & { span: NonNullable<MusDiagnostic['span']> } => Boolean(d.span))
    .map(d => ({ from: d.span.from, to: d.span.to, severity: d.severity, message: d.message, code: d.code }))
}

@customElement('hoja-mus-editor')
export class HojaMusEditor extends LitElement {
  /** The page (prose + one ```mus fence). Read when it changes; edits after that are the editor's. */
  @property({ attribute: false }) document: HojaJSONContent | null = null
  @property({ type: String }) label = 'Score'
  @property({ type: String }) placeholder = 'Write a score in a ```mus fence'
  @property({ type: Boolean, reflect: true, attribute: 'readonly' }) readOnly = false
  /** Identity of the piece; changing it remounts the editor on the new `document`. */
  @property({ type: String, attribute: 'value-key' }) valueKey = 'mus'

  @query('hoja-editor') private hoja!: HojaEditor

  private readonly diagnostics: { readonly extension: ReturnType<typeof createFenceDiagnostics>['extension']; readonly port: FenceDiagnosticsPort } =
    createFenceDiagnostics({ language: 'mus' })
  private lastSource: string | null = null
  private current: HojaJSONContent | null = null

  createRenderRoot(): this {
    return this
  }

  override connectedCallback(): void {
    super.connectedCallback()
    if (typeof CSSStyleSheet === 'undefined' || typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync !== 'function') return
    if (!sheet) {
      sheet = new CSSStyleSheet()
      sheet.replaceSync((musEditorStyles as CSSResult).cssText)
    }
    const root = this.getRootNode() as Document | ShadowRoot
    if (root.adoptedStyleSheets && !root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('document')) {
      this.current = this.document
      this.lastSource = null
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('document') && this.document) this.emit(this.document)
  }

  /** The score as it stands (null when the page holds no single ```mus fence). */
  get source(): string | null {
    try {
      return projectMusSource(this.current ?? this.hoja?.getJSON() ?? { type: 'doc' }).source
    } catch {
      return null
    }
  }

  /** The page as it stands. */
  getJSON(): HojaJSONContent {
    return this.hoja?.getJSON() ?? this.current ?? { type: 'doc' }
  }

  /** Draw a verdict for `source` (drawn only while the fence still holds exactly that text); `null` clears. */
  setVerdict(source: string, report: MusCheckReport | null): void {
    this.diagnostics.port.set(report ? { source, diagnostics: fenceDiagnosticsOf(report) } : null)
  }

  /** The drawn diagnostics as document ranges (tests, "go to"). */
  diagnosticRanges(): { from: number; to: number; className: string }[] {
    return this.diagnostics.port.ranges()
  }

  /** True while the drawn verdict is about text the fence no longer holds. */
  get verdictStale(): boolean {
    return this.diagnostics.port.stale()
  }

  /** Put the caret on a diagnostic's span and bring it into view. */
  reveal(diagnostic: MusDiagnostic): boolean {
    return diagnostic.span ? this.diagnostics.port.reveal(diagnostic.span.from, diagnostic.span.to) : false
  }

  private emit(document: HojaJSONContent): void {
    let source: string | null = null
    let error: string | null = null
    try {
      source = projectMusSource(document).source
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    if (source !== null && source === this.lastSource) return
    this.lastSource = source
    this.dispatchEvent(new CustomEvent<MusSourceChangeDetail>('mus-source-change', {
      detail: { source, error, document },
      bubbles: true,
      composed: true,
    }))
  }

  private readonly onChange = (detail: HojaComposerDetail): void => {
    this.current = detail.json
    this.emit(detail.json)
  }

  protected override render() {
    return html`<hoja-editor
      posture="page"
      value-key=${this.valueKey}
      .pageDocument=${this.document}
      .highlight=${musHighlighter}
      .extensions=${[this.diagnostics.extension]}
      .onChange=${this.onChange}
      label=${this.label}
      placeholder=${this.placeholder}
      ?readonly=${this.readOnly}
    ></hoja-editor>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hoja-mus-editor': HojaMusEditor
  }
}
