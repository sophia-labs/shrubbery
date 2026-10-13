/**
 * The reader roster: Hoja rendering information it did not write — a Markdown file, an HTML page, a Word document, a
 * source file, a data file — read-only, through the same ProseMirror engine as every page.
 *
 * The schema IS the safety: HTML from a file is parsed in an inert document (`DOMParser`, no browsing context: no script
 * runs, no image or stylesheet is fetched) and then through ProseMirror's DOMParser into these nodes and marks only.
 * Anything the schema has no rule for (script, style, iframe, object, form, event attributes, inline styles) does not
 * exist in the result. Links keep only absolute http(s) and mailto targets and open in a new tab with `rel=noopener`;
 * images load only when that costs no request (see reader-image.ts).
 */
import { Editor, type Extensions, type JSONContent } from '@tiptap/core'
import { DOMParser as ProseMirrorDOMParser, type Schema } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'
import { Highlight } from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { CopyableCodeBlock, type ClipboardWriter } from './extensions/copyable-code-block'
import { ReaderImage } from './extensions/reader-image'
import { DataTable } from './extensions/data-table'
import { CodeView, type CodeHighlighter } from './extensions/code-view'

export interface ReaderOptions {
  /** Host-supplied syntax colouring for code blocks (none: plain monospace). */
  readonly highlight?: CodeHighlighter | null
  /** A column of line numbers beside each code block. */
  readonly lineNumbers?: boolean
  readonly writeClipboard?: ClipboardWriter
}

/** Only absolute web and mail links survive into a reader document. */
export function readerLinkAllowed(url: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(url.trim())
}

export function readerExtensions(opts: ReaderOptions = {}): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      undoRedo: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        enableClickSelection: false,
        isAllowedUri: url => readerLinkAllowed(url),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
      },
    }),
    CopyableCodeBlock.configure({ writeClipboard: opts.writeClipboard, renderDelayMs: 250 }),
    Highlight,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ReaderImage,
    DataTable.configure({ writeClipboard: opts.writeClipboard }),
    CodeView.configure({ highlight: opts.highlight ?? null, lineNumbers: opts.lineNumbers ?? false }),
  ]
}

/** File-borne HTML → a reader document: inert parse, then the schema's allowlist. */
export function readerDocumentFromHtml(schema: Schema, html: string): JSONContent {
  const parsed = new window.DOMParser().parseFromString(html, 'text/html')
  return ProseMirrorDOMParser.fromSchema(schema).parse(parsed.body).toJSON() as JSONContent
}

/** A read-only TipTap editor over the reader roster, mounted into `element`. */
export function createReaderEditor(element: HTMLElement, content: JSONContent | null, opts: ReaderOptions = {}): Editor {
  return new Editor({
    element,
    editable: false,
    extensions: readerExtensions(opts),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    // A file is shown as it is: never "repaired" into something it did not say.
    enableContentCheck: false,
  })
}
