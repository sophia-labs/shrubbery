/**
 * `<hoja-reader>` — Hoja's rendering posture: information it did not write, shown read-only through the same editor
 * kernel as every page (TipTap/ProseMirror, the reader roster).
 *
 * Give it either `doc` (a document already in the schema: a code block, a data table) or `html` (file-borne HTML — a
 * Markdown file's rendering, a page, a Word document). HTML goes through `readerDocumentFromHtml`: an inert parse and then
 * the schema's allowlist, so nothing from a file executes and nothing is fetched (see editor-kernel/src/reader.ts).
 *
 *   <hoja-reader variant="prose" .html=${html}></hoja-reader>
 *   <hoja-reader variant="code" line-numbers .doc=${codeDoc} .highlight=${highlighter}></hoja-reader>
 *   <hoja-reader variant="table" .doc=${{ type: 'doc', content: [{ type: 'dataTable', attrs: { ref } }] }}></hoja-reader>
 *
 * House tokens only, so every skin dresses it.
 */
import {
  adoptEditorStylesWhenConnected,
  createReaderEditor,
  readerDocumentFromHtml,
  type CodeHighlighter,
  type Editor,
} from '@shrubbery/editor-kernel'
import type { HojaJSONContent } from './types.js'

export type HojaReaderVariant = 'prose' | 'code' | 'table'

export const HOJA_READER_CSS = `
hoja-reader {
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  color: var(--mn-color-text-primary, #222a25);
  background: var(--mn-color-surface-editor, var(--mn-color-surface-base, #fff));
}
hoja-reader .ProseMirror {
  box-sizing: border-box;
  max-width: 46rem;
  margin: 0 auto;
  padding: var(--mn-space-5, 24px) var(--mn-space-4, 16px) var(--mn-space-6, 32px);
  outline: none;
  font: var(--mn-text-base, 1rem) / var(--mn-leading-prose, 1.6) var(--mn-font-prose, ui-serif, Georgia, serif);
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}
hoja-reader .ProseMirror > :first-child { margin-top: 0; }
hoja-reader .ProseMirror h1, hoja-reader .ProseMirror h2, hoja-reader .ProseMirror h3,
hoja-reader .ProseMirror h4, hoja-reader .ProseMirror h5, hoja-reader .ProseMirror h6 {
  font-family: var(--mn-font-title, var(--mn-font-ui, system-ui, sans-serif));
  color: var(--mn-color-text-title, var(--mn-color-text-primary, #222a25));
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
}
hoja-reader .ProseMirror h1 { font-size: 1.75em; }
hoja-reader .ProseMirror h2 { font-size: 1.4em; }
hoja-reader .ProseMirror h3 { font-size: 1.2em; }
hoja-reader .ProseMirror h4, hoja-reader .ProseMirror h5, hoja-reader .ProseMirror h6 { font-size: 1em; }
hoja-reader .ProseMirror p { margin: 0 0 0.8em; }
hoja-reader .ProseMirror ul, hoja-reader .ProseMirror ol { margin: 0 0 0.8em; padding-left: 1.6em; }
hoja-reader .ProseMirror li > p { margin: 0.15em 0; }
hoja-reader .ProseMirror blockquote { margin: 0 0 0.8em; padding: 0.1em 0 0.1em 1em; color: var(--mn-color-text-secondary, #4d5952);
  border-left: 3px solid var(--mn-color-border-default, #c9d2cc); }
hoja-reader .ProseMirror hr { border: 0; border-top: 1px solid var(--mn-color-border-default, #c9d2cc); margin: 1.5em 0; }
hoja-reader .ProseMirror a { color: var(--mn-color-text-link, var(--mn-color-text-accent, #2e6a4f)); text-decoration: underline; text-underline-offset: 0.15em; cursor: pointer; }
hoja-reader .ProseMirror mark { background: var(--mn-color-highlight, var(--mn-color-surface-warning, #fff3c4)); color: inherit; }
hoja-reader .ProseMirror :not(pre) > code {
  font-family: var(--mn-font-mono, ui-monospace, monospace);
  font-size: 0.88em;
  padding: 0.08em 0.3em;
  border-radius: var(--mn-radius-xs, 4px);
  background: var(--mn-color-surface-sunken, #f1f3f1);
  border: 1px solid var(--mn-color-border-subtle, #e1e7e3);
}
hoja-reader .ProseMirror table { border-collapse: collapse; margin: 0 0 1em; font: var(--mn-text-sm, 13px) / 1.4 var(--mn-font-ui, system-ui, sans-serif);
  display: block; overflow-x: auto; max-width: 100%; }
hoja-reader .ProseMirror th, hoja-reader .ProseMirror td { border: 1px solid var(--mn-color-border-default, #c9d2cc); padding: 4px 8px; vertical-align: top; text-align: left; min-width: 3em; }
hoja-reader .ProseMirror th { background: var(--mn-color-surface-subtle, #f4f6f4); font-weight: 600; }
hoja-reader .ProseMirror td > p, hoja-reader .ProseMirror th > p { margin: 0; }
hoja-reader .ProseMirror img { max-width: 100%; height: auto; }
hoja-reader .hoja-reader-image-load, hoja-reader .hoja-reader-image[data-source='absent'] {
  font: var(--mn-text-sm, 13px) / 1.3 var(--mn-font-ui, system-ui, sans-serif);
  color: var(--mn-color-text-secondary, #4d5952);
}
hoja-reader .hoja-reader-image-load { cursor: pointer; background: var(--mn-color-surface-raised, #fff); border: 1px dashed var(--mn-color-border-default, #c9d2cc);
  border-radius: var(--mn-radius-control, 6px); padding: 6px 10px; }
hoja-reader .hoja-reader-image-load:focus-visible { outline: none; box-shadow: var(--mn-focus-ring, 0 0 0 2px #39765a); }
hoja-reader .code-block-wrapper { position: relative; margin: 0 0 1em; }
hoja-reader .ProseMirror pre {
  position: relative;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  white-space: pre;
  overflow-wrap: normal;
  tab-size: 4;
  font: var(--mn-text-sm, 13px) / 1.55 var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  color: var(--mn-color-text-primary, #222a25);
  background: var(--mn-color-surface-sunken, #f1f3f1);
  border: 1px solid var(--mn-color-border-subtle, #e1e7e3);
  border-radius: var(--mn-radius-control, 6px);
}
hoja-reader .ProseMirror pre code { font: inherit; background: none; border: 0; padding: 0; }
hoja-reader .code-copy-btn { position: absolute; top: 6px; right: 6px; z-index: 1; font: var(--mn-text-xs, 11px) / 1 var(--mn-font-chrome, var(--mn-font-ui, system-ui, sans-serif));
  color: var(--mn-color-text-secondary, #4d5952); background: var(--mn-color-surface-raised, #fff); border: 1px solid var(--mn-color-border-default, #c9d2cc);
  border-radius: var(--mn-radius-control, 6px); padding: 4px 8px; cursor: pointer; opacity: 0; transition: opacity 120ms ease; }
hoja-reader .code-block-wrapper:hover .code-copy-btn, hoja-reader .code-copy-btn:focus-visible { opacity: 1; }
hoja-reader .code-block-wrapper[data-language]::after {
  content: attr(data-language);
  position: absolute; top: 8px; right: 64px;
  font: var(--mn-text-xs, 11px) / 1 var(--mn-font-chrome, var(--mn-font-ui, system-ui, sans-serif));
  color: var(--mn-color-text-muted, #768079);
  letter-spacing: 0.04em; text-transform: uppercase; pointer-events: none;
}
hoja-reader .code-block-wrapper[data-language='plaintext']::after { content: none; }
hoja-reader[line-numbers] .ProseMirror pre { padding-left: calc(var(--hoja-ln-width, 4.5em) + 14px); }
hoja-reader .ProseMirror .hoja-line-numbers {
  position: absolute; left: 0; box-sizing: border-box; width: var(--hoja-ln-width, 4.5em); padding-right: 0.9em;
  text-align: right; white-space: pre; color: var(--mn-color-text-muted, #768079);
  border-right: 1px solid var(--mn-color-border-subtle, #e1e7e3);
  user-select: none; -webkit-user-select: none; pointer-events: none;
}
hoja-reader[variant='code'] { display: flex; flex-direction: column; }
hoja-reader[variant='code'] .hoja-reader__mount { flex: 1 0 auto; display: flex; flex-direction: column; }
hoja-reader[variant='code'] .ProseMirror { flex: 1 0 auto; max-width: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
hoja-reader[variant='code'] .code-block-wrapper { margin: 0; flex: 1 1 auto; display: flex; flex-direction: column; }
hoja-reader[variant='code'] .ProseMirror pre { flex: 1 1 auto; border: 0; border-radius: 0; padding-top: 16px; padding-bottom: 24px; overflow: visible; }
hoja-reader[variant='code'] .code-block-wrapper[data-language]::after { content: none; }
hoja-reader[variant='table'] { overflow: hidden; display: flex; flex-direction: column; }
hoja-reader[variant='table'] .hoja-reader__mount { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
hoja-reader[variant='table'] .ProseMirror { flex: 1 1 auto; min-height: 0; max-width: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
hoja-reader[variant='table'] .hoja-data-table { --hoja-data-table-height: auto; flex: 1 1 auto; border: 0; border-radius: 0; }
hoja-reader .hljs-keyword, hoja-reader .hljs-selector-tag, hoja-reader .hljs-meta .hljs-keyword, hoja-reader .hljs-doctag { color: var(--mn-color-text-accent, #2e6a4f); font-weight: 600; }
hoja-reader .hljs-string, hoja-reader .hljs-regexp, hoja-reader .hljs-addition, hoja-reader .hljs-attribute .hljs-string, hoja-reader .hljs-template-tag { color: var(--mn-color-text-success, var(--mn-color-success, #2f7a45)); }
hoja-reader .hljs-number, hoja-reader .hljs-literal, hoja-reader .hljs-symbol, hoja-reader .hljs-bullet { color: var(--mn-color-text-warning, var(--mn-color-warning, #9a6400)); }
hoja-reader .hljs-comment, hoja-reader .hljs-quote { color: var(--mn-color-text-muted, #768079); font-style: italic; }
hoja-reader .hljs-title, hoja-reader .hljs-section, hoja-reader .hljs-title.function_, hoja-reader .hljs-selector-id { color: var(--mn-color-text-link, var(--mn-color-accent, #39765a)); }
hoja-reader .hljs-type, hoja-reader .hljs-built_in, hoja-reader .hljs-class .hljs-title, hoja-reader .hljs-title.class_ { color: var(--mn-color-text-accent-strong, var(--mn-color-text-accent, #2e6a4f)); }
hoja-reader .hljs-attr, hoja-reader .hljs-attribute, hoja-reader .hljs-variable, hoja-reader .hljs-template-variable, hoja-reader .hljs-name, hoja-reader .hljs-tag,
hoja-reader .hljs-selector-class, hoja-reader .hljs-property, hoja-reader .hljs-params { color: var(--mn-color-text-secondary, #4d5952); }
hoja-reader .hljs-deletion, hoja-reader .hljs-meta { color: var(--mn-color-text-danger, var(--mn-color-danger, #b3261e)); }
hoja-reader .hljs-emphasis { font-style: italic; }
hoja-reader .hljs-strong { font-weight: 700; }
`

// Importable where there is no DOM (a node test that only builds documents): the element exists only in a browser.
const ElementBase = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement

/** The reader element. Plain custom element: ProseMirror owns the mount, nothing re-renders over it. */
export class HojaReader extends ElementBase {
  private _doc: HojaJSONContent | null = null
  private _html: string | null = null
  private _highlight: CodeHighlighter | null = null
  private editor: Editor | null = null
  private mount: HTMLElement | null = null
  private scheduled = false

  get doc(): HojaJSONContent | null { return this._doc }
  set doc(value: HojaJSONContent | null) { if (value !== this._doc) { this._doc = value; this.schedule() } }
  get html(): string | null { return this._html }
  set html(value: string | null) { if (value !== this._html) { this._html = value; this.schedule() } }
  get highlight(): CodeHighlighter | null { return this._highlight }
  set highlight(value: CodeHighlighter | null) { if (value !== this._highlight) { this._highlight = value; this.schedule() } }
  get lineNumbers(): boolean { return this.hasAttribute('line-numbers') }
  set lineNumbers(on: boolean) { if (on !== this.lineNumbers) { this.toggleAttribute('line-numbers', on); this.schedule() } }
  get variant(): HojaReaderVariant { return (this.getAttribute('variant') as HojaReaderVariant | null) ?? 'prose' }
  set variant(value: HojaReaderVariant) { if (value !== this.getAttribute('variant')) this.setAttribute('variant', value) }

  /** The rendered document as ProseMirror holds it (tests and hosts read what was shown). */
  get document(): HojaJSONContent | null { return (this.editor?.getJSON() as HojaJSONContent | undefined) ?? null }

  connectedCallback(): void {
    adoptEditorStylesWhenConnected(this, 'hoja-reader', HOJA_READER_CSS)
    if (!this.mount) {
      this.mount = document.createElement('div')
      this.mount.className = 'hoja-reader__mount'
      this.appendChild(this.mount)
    }
    if (!this.editor) this.build()
  }

  disconnectedCallback(): void {
    // A Lit re-render can move the element; let it settle before letting go of the editor.
    queueMicrotask(() => { if (!this.isConnected) this.teardown() })
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; if (this.isConnected) this.build() })
  }

  private teardown(): void {
    this.editor?.destroy()
    this.editor = null
    this.mount?.replaceChildren()
  }

  private build(): void {
    if (!this.mount) return
    this.teardown()
    const editor = createReaderEditor(this.mount, null, { highlight: this._highlight, lineNumbers: this.lineNumbers })
    const content = this._html !== null ? readerDocumentFromHtml(editor.schema, this._html) : this._doc
    if (content) editor.commands.setContent(content as Parameters<typeof editor.commands.setContent>[0], { emitUpdate: false })
    const dom = editor.view.dom as HTMLElement
    dom.setAttribute('aria-readonly', 'true')
    dom.setAttribute('role', 'document')
    if (this.getAttribute('aria-label')) dom.setAttribute('aria-label', this.getAttribute('aria-label')!)
    this.editor = editor
    this.dispatchEvent(new CustomEvent('hoja-reader-ready', { bubbles: true, composed: true }))
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('hoja-reader')) customElements.define('hoja-reader', HojaReader)

declare global {
  interface HTMLElementTagNameMap { 'hoja-reader': HojaReader }
}

export {
  dataTableModel,
  registerDataTable,
  releaseDataTable,
  type CodeHighlighter,
  type CodeHighlightRange,
  type DataTableModel,
  type DataTableSheet,
} from '@shrubbery/editor-kernel'
