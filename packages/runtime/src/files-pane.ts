/**
 * The Files pane (design §12.1): one center route with a header (where you are, the face switch, the view, New folder,
 * Upload), the center (the folder canvas, the list, or the opened file) and one status line at the foot. The shell's own
 * left panel is the file tree and its right panel the inspector; this pane never draws either.
 *
 * Controlled and stateless: every value comes from the shell (`WorkspaceFilesOptions`) and every action goes back to it.
 * A verb the shell cannot honour is absent, not disabled (Law 6). Persistent conditions (read-only, preferences that
 * cannot be saved) are one note above the center; transient messages are the status line's, one polite live region.
 */
import { html, nothing, type TemplateResult } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { ref } from 'lit/directives/ref.js'
import { rovingToolbar } from '@shrubbery/nucleus/roving-toolbar'
import { evidenceBadge, evidenceTone, quietMark, CORROBORATION_WORDS, type FileEvidence } from '@shrubbery/nucleus'
import './files-canvas/files-canvas-host.js'
import { renderFilesEmpty } from './files-canvas/files-empty.js'
import type { FilesCanvasHostInput } from './files-canvas/files-canvas-host.js'
import { FILES_PAGE_STYLE, renderFilesPage, type FilesPanePage } from './files-page.js'

export type FilesFace = 'canvas' | 'list'
export type FilesIconSize = 'small' | 'medium' | 'large'

export interface FilesPaneCrumb {
  readonly id: string | null
  readonly label: string
}

export interface FilesPaneRow {
  /** The shell's key for the entry (`folder:{id}`, `artifact:{id}`). */
  readonly key: string
  readonly label: string
  readonly kind: 'folder' | 'file' | 'document'
  /** 'Folder', 'PDF', 'PNG', … */
  readonly type: string
  readonly selected: boolean
  readonly size?: string
  readonly state?: string
  /** What the reader found in a datasheet: the list gains Part, Maker, key value and Status when any row has it. */
  readonly evidence?: FileEvidence
  /** Set while this row's name is being edited in place (the list face's F2 or Rename). */
  readonly naming?: { readonly initial: string; readonly error: string | null } | null
}

/** The reader's assertion (organism `PdfAssertion`) and header (`PdfReadingInfo`): the pane hands them on and reads none of it. */
export type FilesPaneAssertion = object

/** What `<hoja-reader>` is given: a document in its schema (`doc`) or file-borne HTML it parses through the schema (`html`). */
export interface FilesPaneReaderView {
  readonly variant: 'prose' | 'code' | 'table'
  readonly doc?: unknown
  readonly html?: string | null
  readonly lineNumbers?: boolean
  /** The host's syntax colouring (a CodeHighlighter), or null. */
  readonly highlight?: unknown
}

export type FilesPanePreview =
  /** A PDF in the reader (`<mn-pdf-reader>`, pdf.js's viewer layer): the bytes once downloaded, and the download's progress before that. */
  | { readonly kind: 'pdf'; readonly name: string; readonly status: 'loading' | 'ready' | 'error'; readonly error: string
      readonly data?: Uint8Array | null; readonly loaded?: number; readonly total?: number; readonly fileKey?: string
      readonly pageCount?: number; readonly pageNumber?: number
      /** What the file's kind read from it (a datasheet's claims): the reader gains its overlay and list. Absent: a plain PDF. */
      readonly assertions?: readonly FilesPaneAssertion[]; readonly assertionsInfo?: FilesPaneAssertion | null
      readonly overlay?: boolean; readonly selected?: string | null
      /** Ask the reader to go to an assertion (a deep link); a new nonce asks again. */
      readonly reveal?: { readonly id: string; readonly nonce: number } | null
      /** Ask the reader to show one assertion's box on its page, the overlay staying as it is (a page link of the file's page). */
      readonly spotlight?: { readonly id: string; readonly nonce: number } | null }
  | { readonly kind: 'image'; readonly name: string; readonly status: 'loading' | 'ready' | 'error'; readonly error: string; readonly url?: string | null }
  /** A file Hoja renders: text, Markdown, code, JSON, a table, HTML, a Word document. `label` says what kind ('Markdown'). */
  | { readonly kind: 'reader'; readonly name: string; readonly status: 'loading' | 'ready' | 'error'; readonly error: string
      readonly label: string; readonly view: FilesPaneReaderView | null
      /** Only the start of a long text is shown: "2 MB" of "7.3 MB", with Show all. */
      readonly truncated?: { readonly shown: string; readonly total: string } | null
      /** HTML's Source switch: null when the kind has none, else whether the source is showing. */
      readonly source?: boolean | null
      /** A sentence about how it was read ("Not valid JSON: …"), shown above the page. */
      readonly note?: string | null }
  /** Played or drawn by the browser from a blob: URL — an SVG only ever as an <img>, never inlined. */
  | { readonly kind: 'media'; readonly name: string; readonly status: 'loading' | 'ready' | 'error'; readonly error: string
      readonly media: 'audio' | 'video' | 'svg'; readonly url: string | null; readonly mimeType: string
      /** The glyph's short type caption ('WAV'). */
      readonly caption?: string }
  /** No viewer for this kind: the file's page, with an explicit Download. Opening a file never downloads it. */
  | { readonly kind: 'file'; readonly name: string; readonly status: 'loading' | 'ready' | 'error'; readonly error: string
      readonly typeLabel: string; readonly caption: string; readonly size: string | null; readonly modified: string | null }

/** One thing in the Trash: a document or a file, restorable, or deletable forever (after a confirm that says what is lost). */
export interface FilesPaneTrashItem {
  /** The shell's key (`document:{id}`, `artifact:{id}`). */
  readonly key: string
  readonly kind: 'document' | 'file'
  readonly label: string
  /** 'Document', 'PDF', … */
  readonly type: string
  /** Said in words: "Trashed 2 min ago". */
  readonly when: string
  /** This item is asking "are you sure": the sentence it asks, else null. */
  readonly confirm: string | null
}

/** The one Trash view: replaces the center until Back. */
export interface FilesPaneTrash {
  readonly status: 'loading' | 'ready' | 'error'
  readonly error: string
  readonly items: readonly FilesPaneTrashItem[]
  /** Delete forever is offered only when the cell can do it; otherwise the view says so in `note`. */
  readonly canPurge: boolean
  readonly note: string | null
  readonly onBack: () => void
  readonly onRestore: (key: string) => void
  /** Asks first for anything; `onConfirmPurge` does it. */
  readonly onPurge: (key: string) => void
  readonly onConfirmPurge: (key: string) => void
  readonly onCancelPurge: () => void
}

export interface FilesPaneStatus {
  /** The steady part: "6 items · 2 selected". */
  readonly text: string
  /** The last change, said once; empty when there is none. */
  readonly message: string
  /** The Undo the message carries, or null. */
  readonly undoLabel: string | null
  readonly tone?: 'info' | 'error'
  /** Something is being read or saved: the line says so to assistive technology and draws a quiet pulse. */
  readonly busy?: boolean
  /** One verb the message offers ('Open' after a read, 'Retry' after a failure). */
  readonly action?: { readonly label: string; readonly onAction: () => void } | null
}

/** The Disputed filter: shown (in the list face) only when a file of the place has a value its readers disagreed on. */
export interface FilesPaneNeedsLook {
  readonly on: boolean
  /** How many files in the place have a disputed value. */
  readonly count: number
  readonly onToggle: (on: boolean) => void
}

/** Files occupies the ordinary center route; the shell supplies the projection, the canvas input and the callbacks. */
export interface WorkspaceFilesOptions {
  readonly graphId: string
  readonly breadcrumbs: readonly FilesPaneCrumb[]
  readonly face: FilesFace
  readonly iconSize: FilesIconSize
  readonly snapToGrid: boolean
  /** The canvas face's input (contract v2 plus the two callbacks); null shows the list. */
  readonly canvas: FilesCanvasHostInput | null
  /** The list face's rows, in display order. */
  readonly rows: readonly FilesPaneRow[]
  /** The opened file's viewer: the whole center, or, with `page`, the body of the page's source section. */
  readonly preview: FilesPanePreview | null
  /** The opened file's page (its default face): replaces the face until Back; its source section draws `preview`. */
  readonly page?: FilesPanePage | null
  readonly onPageSection?: (id: string, open: boolean) => void
  /** A page link: open the source at that value (an evidence id, or `page:N`). */
  readonly onPageGoto?: (evidenceId: string, page: number | null) => void
  readonly onPageAction?: (action: string) => void
  readonly onPageFilter?: (text: string) => void
  readonly onNotesChange?: (detail: { readonly json: unknown; readonly value: string; readonly isEmpty: boolean }) => void
  /** The list face's filter over datasheets with values the readers disagreed on. */
  readonly needsLook?: FilesPaneNeedsLook | null
  /** The Trash, which replaces the face until Back. */
  readonly trash?: FilesPaneTrash | null
  /** Show the Trash button in the header (the shell can list a trash). */
  readonly onOpenTrash?: () => void
  readonly canUpload: boolean
  readonly canCreate: boolean
  /** Saving the face, icon size and grid needs an editor and a cell that stores preferences. */
  readonly canChangeView: boolean
  /** "50 MB": said on the Upload button. */
  readonly maxUploadLabel: string
  readonly status: FilesPaneStatus
  /** A persistent condition (read-only, preferences unavailable): one note above the center, not live. */
  readonly banner?: string | null
  readonly onNavigate: (folderKey: string | null) => void
  readonly onUpload: (files: File[]) => void
  readonly onNewFolder: () => void
  readonly onFace: (face: FilesFace) => void
  readonly onIconSize: (size: FilesIconSize) => void
  readonly onSnapToGrid: (on: boolean) => void
  readonly onUndo: () => void
  readonly onClosePreview: () => void
  /** The PDF reader says which page it is on; an assertion was selected (id null: cleared); the overlay was turned on or off. */
  readonly onPdfPage?: (page: number, pageCount: number) => void
  readonly onAssertionSelect?: (id: string | null, page: number | null) => void
  readonly onOverlay?: (on: boolean) => void
  readonly onDownload?: () => void
  /** Open the opened file again (the viewer's Reload). */
  readonly onReloadPreview?: () => void
  /** HTML's Source switch. */
  readonly onPreviewSource?: (on: boolean) => void
  /** Show the whole of a long text (only its start is shown at first). */
  readonly onPreviewShowAll?: () => void
  /** The list face: a click selects (`replace`, `toggle` with ⌘/Ctrl, `range` with Shift). */
  readonly onRowSelect?: (keys: readonly string[], mode: 'replace' | 'toggle' | 'range') => void
  readonly onRowOpen?: (key: string) => void
  readonly onRowMenu?: (keys: readonly string[], x: number, y: number) => void
  /** The list face's keyboard: Delete and F2 on the selection, when the shell can. */
  readonly onRowKey?: (key: 'Delete' | 'F2', keys: readonly string[]) => void
  /** The list face's naming in place: Enter commits the typed name, Escape cancels. */
  readonly onRowRename?: (key: string, name: string) => void
  readonly onRowRenameCancel?: () => void
}

const STYLE = html`<style>
  .mn-files-pane {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--mn-color-surface-base);
    color: var(--mn-color-text-primary);
    font-family: var(--mn-font-chrome);
    container-type: inline-size;
  }
  .mn-files-pane > header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--mn-space-2, 8px);
    padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
    border-bottom: 1px solid var(--mn-color-border-subtle);
  }
  .mn-files-pane nav[aria-label='Folder path'] { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 12rem; overflow: hidden; }
  .mn-files-pane nav button, .mn-files-pane .tool, .mn-files-pane .seg button {
    font: inherit;
    font-size: var(--mn-text-sm, 12px);
    color: var(--mn-color-text-primary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--mn-radius-control, 6px);
    padding: 2px var(--mn-space-2, 8px);
    min-height: var(--mn-control-height, 28px);
    cursor: pointer;
    white-space: nowrap;
  }
  .mn-files-pane nav button { overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }
  .mn-files-pane nav .crumb { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
  .mn-files-pane nav button[aria-current='location'] { font-weight: 600; }
  .mn-files-pane nav .sep { color: var(--mn-color-text-secondary); }
  .mn-files-pane .tool { border-color: var(--mn-color-border-default); background: var(--mn-color-surface-raised); }
  .mn-files-pane .tool:hover, .mn-files-pane nav button:hover, .mn-files-pane .seg button:hover { background: var(--mn-color-interactive-hover); }
  .mn-files-pane button:focus-visible, .mn-files-pane select:focus-visible, .mn-files-pane input:focus-visible { outline: none; box-shadow: var(--mn-focus-ring); }
  .mn-files-pane .actions { display: inline-flex; align-items: center; flex-wrap: wrap; gap: var(--mn-space-2, 8px); }
  .mn-files-pane .seg { display: inline-flex; border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); overflow: hidden; }
  .mn-files-pane .seg button { border-radius: 0; }
  .mn-files-pane .seg button[aria-checked='true'] { background: var(--mn-color-interactive-selected); }
  .mn-files-pane .view { display: inline-flex; align-items: center; gap: var(--mn-space-2, 8px); font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane select { font: inherit; font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-primary); background: var(--mn-color-surface-raised);
    border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); min-height: var(--mn-control-height, 28px); }
  .mn-files-pane .note { margin: 0; padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px); font-size: var(--mn-text-sm, 12px);
    background: var(--mn-color-surface-subtle); border-bottom: 1px solid var(--mn-color-border-subtle); color: var(--mn-color-text-secondary); }
  .mn-files-pane .center { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .mn-files-pane mn-files-canvas { flex: 1 1 auto; min-height: 200px; }
  .mn-files-pane .list { flex: 1 1 auto; overflow: auto; outline: none; }
  .mn-files-pane .list [role='row'] { display: grid; grid-template-columns: minmax(0, 1fr) 7rem 6rem; gap: var(--mn-space-2, 8px);
    padding: 0 var(--mn-space-3, 12px); min-height: var(--mn-row-height, 30px); align-items: center; font-size: var(--mn-text-sm, 12px);
    border-bottom: 1px solid var(--mn-color-border-subtle); cursor: default; user-select: none; }
  .mn-files-pane .list.has-evidence [role='row'] { grid-template-columns: var(--mn-evidence-tracks, minmax(10rem, 1fr) 3.5rem 8rem 4.5rem); }
  .mn-files-pane .list .strong .v { font-weight: 600; }
  .mn-files-pane .list .ev { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane .list .ev .k { color: var(--mn-color-text-secondary); margin-inline-end: var(--mn-space-1, 4px); }
  .mn-files-pane .list .mark { margin-inline-start: var(--mn-space-1, 4px); letter-spacing: -0.5px; color: var(--mn-color-text-secondary); }
  .mn-files-pane .list [data-mark='contested'] .mark, .mn-files-pane .list [data-mark='checked'] .mark { font-weight: 700; }
  .mn-files-pane .list .badge { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane .list .badge[data-tone='attention'] { color: var(--mn-color-text-primary); font-weight: 600; }
  .mn-files-pane .list .badge[data-tone='danger'] { color: var(--mn-color-text-danger); font-weight: 600; }
  .mn-files-pane .tool[aria-pressed='true'] { background: var(--mn-color-interactive-selected); border-color: var(--mn-color-border-accent); }
  .mn-files-pane .list [role='row'][aria-selected='true'] { background: var(--mn-color-interactive-selected); }
  .mn-files-pane .list [role='row'][data-key]:hover { background-color: var(--mn-color-interactive-hover); }
  .mn-files-pane .list [role='row'][data-key]:focus-visible { outline: none; box-shadow: inset var(--mn-focus-ring); }
  .mn-files-pane .list .head { font-weight: 600; color: var(--mn-color-text-secondary); position: sticky; top: 0; background: var(--mn-color-surface-base); }
  .mn-files-pane .list .name { display: flex; align-items: center; gap: var(--mn-space-2, 8px); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane .list input.rename { font: inherit; min-width: 0; flex: 1 1 auto; color: var(--mn-color-text-primary);
    background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px);
    padding: 1px var(--mn-space-1, 4px); }
  .mn-files-pane .list input.rename[aria-invalid='true'] { border-color: var(--mn-color-text-danger); }
  .mn-files-pane .list .rename-wrap { display: inline-flex; align-items: center; gap: var(--mn-space-1, 4px); min-width: 0; flex: 1 1 auto; }
  .mn-files-pane .list .rename-after:empty { display: none; }
  .mn-files-pane .list .rename-error { color: var(--mn-color-text-danger); white-space: nowrap; }
  .mn-files-pane .list .files-empty { padding: var(--mn-space-4, 16px); }
  .mn-files-pane .files-empty { display: grid; justify-items: center; gap: var(--mn-space-2, 8px); text-align: center; color: var(--mn-color-text-secondary);
    font-size: var(--mn-text-sm, 12px); padding: var(--mn-space-4, 16px); }
  .mn-files-pane .files-empty p { margin: 0; }
  .mn-files-pane .files-empty button { font: inherit; font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-primary); background: var(--mn-color-surface-raised);
    border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); min-height: var(--mn-control-height, 28px);
    padding: 2px var(--mn-space-2, 8px); cursor: pointer; pointer-events: auto; }
  .mn-files-pane .files-empty button:focus-visible { outline: none; box-shadow: var(--mn-focus-ring); }
  .mn-files-pane .files-empty input[type='file'] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .mn-files-pane .trash { flex: 1 1 auto; overflow: auto; }
  .mn-files-pane .trash [role='row'] { display: grid; grid-template-columns: minmax(0, 1fr) 7rem 9rem auto; gap: var(--mn-space-2, 8px);
    padding: 0 var(--mn-space-3, 12px); min-height: var(--mn-row-height, 30px); align-items: center; font-size: var(--mn-text-sm, 12px);
    border-bottom: 1px solid var(--mn-color-border-subtle); }
  .mn-files-pane .trash [role='row'] .name { display: flex; align-items: center; gap: var(--mn-space-2, 8px); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane .trash [role='row'] .acts { display: inline-flex; gap: var(--mn-space-1, 4px); }
  .mn-files-pane .trash .confirm { grid-column: 1 / -1; padding: var(--mn-space-1, 4px) 0 var(--mn-space-2, 8px); color: var(--mn-color-text-danger); display: flex; flex-wrap: wrap; gap: var(--mn-space-2, 8px); align-items: center; }
  .mn-files-pane .trash .danger { color: var(--mn-color-text-danger); }
  .mn-files-pane .trash .empty { padding: var(--mn-space-4, 16px); color: var(--mn-color-text-secondary); font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .opened { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .mn-files-pane > header.reader-row { flex-wrap: nowrap; }
  .mn-files-pane .reader-row .title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .reader-row .pages { display: inline-flex; align-items: center; gap: var(--mn-space-1, 4px); font-size: var(--mn-text-sm, 12px); flex: 0 0 auto; }
  .mn-files-pane .reader-row .pages input { width: 3.5em; font: inherit; color: inherit; background: var(--mn-color-surface-raised);
    border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-control, 6px); min-height: var(--mn-control-height, 28px); }
  .mn-files-pane .reader-row .of { display: none; }
  .mn-files-pane .reader-row .tool { flex: 0 0 auto; }
  .mn-files-pane .reader-row button:disabled { opacity: 0.48; cursor: default; }
  .mn-files-pane .opened mn-original-viewer, .mn-files-pane .opened mn-pdf-reader { flex: 1 1 auto; min-height: 0; }
  .mn-files-pane .opened .picture { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; place-items: center; padding: var(--mn-space-4, 16px);
    background: var(--mn-color-surface-canvas); }
  .mn-files-pane .opened .picture img { max-width: 100%; max-height: 100%; object-fit: contain; background: var(--mn-color-surface-raised); }
  .mn-files-pane .opened .card { margin: auto; padding: var(--mn-space-4, 16px); text-align: center; display: grid; gap: var(--mn-space-2, 8px);
    font-size: var(--mn-text-sm, 12px); }
  .mn-files-pane .opened .error { color: var(--mn-color-text-danger); }
  .mn-files-pane .opened hoja-reader { flex: 1 1 auto; min-height: 0; }
  .mn-files-pane .opened .note { display: flex; align-items: center; gap: var(--mn-space-2, 8px); flex-wrap: wrap; }
  .mn-files-pane .opened .note button { font: inherit; color: var(--mn-color-text-accent); background: transparent; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
  .mn-files-pane .opened .media { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; align-content: center; gap: var(--mn-space-3, 12px);
    padding: var(--mn-space-4, 16px); background: var(--mn-color-surface-canvas); }
  .mn-files-pane .opened .media video { max-width: 100%; max-height: 100%; background: var(--mn-color-surface-sunken); }
  .mn-files-pane .opened .media audio { width: min(36rem, 100%); }
  .mn-files-pane .opened .file-page { margin: auto; padding: var(--mn-space-5, 24px) var(--mn-space-4, 16px); display: grid; justify-items: center;
    gap: var(--mn-space-2, 8px); text-align: center; max-width: 32rem; }
  .mn-files-pane .opened .file-page h2 { margin: var(--mn-space-2, 8px) 0 0; font-size: var(--mn-text-lg, 16px); font-weight: 600; overflow-wrap: anywhere; }
  .mn-files-pane .opened .file-page dl { margin: 0; display: grid; grid-template-columns: auto auto; gap: 2px var(--mn-space-3, 12px);
    font-size: var(--mn-text-sm, 12px); color: var(--mn-color-text-secondary); text-align: left; }
  .mn-files-pane .opened .file-page dt { text-align: right; }
  .mn-files-pane .opened .file-page dd { margin: 0; color: var(--mn-color-text-primary); }
  .mn-files-pane .opened .file-page .tool { margin-top: var(--mn-space-2, 8px); }
  .mn-files-pane .reader-row .kind { flex: 0 0 auto; font-size: var(--mn-text-xs, 11px); color: var(--mn-color-text-secondary);
    border: 1px solid var(--mn-color-border-subtle); border-radius: var(--mn-radius-control, 6px); padding: 1px var(--mn-space-1, 4px); white-space: nowrap; }
  .mn-files-pane .reader-row .tool[aria-pressed='true'] { background: var(--mn-color-interactive-selected); }
  .mn-files-pane > footer { display: flex; align-items: center; gap: var(--mn-space-2, 8px); padding: 2px var(--mn-space-3, 12px);
    min-height: var(--mn-row-height, 28px); border-top: 1px solid var(--mn-color-border-subtle); font-size: var(--mn-text-sm, 12px);
    color: var(--mn-color-text-secondary); }
  .mn-files-pane > footer [role='status'] { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-files-pane > footer .pulse { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--mn-color-border-accent); animation: mn-files-pulse 1.4s ease-in-out infinite; }
  @keyframes mn-files-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .mn-files-pane > footer .pulse { animation: none; opacity: 0.7; } }
  .mn-files-pane > footer [data-tone='error'] .message { color: var(--mn-color-text-danger); }
  .mn-files-pane > footer button { font: inherit; color: var(--mn-color-text-accent); background: transparent; border: 0; cursor: pointer;
    text-decoration: underline; padding: 0 var(--mn-space-1, 4px); }
  .mn-files-pane .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  /* One row at every width: below 520px the buttons keep their glyph and lose their word, and the name gives way. */
  @container (max-width: 520px) {
    .mn-files-pane .reader-row .label, .mn-files-pane .reader-row .kind { display: none; }
    .mn-files-pane .reader-row .of { display: inline; }
    .mn-files-pane .reader-row .title { display: none; }
    .mn-files-pane .reader-row .pages { margin-inline-end: auto; }
  }
  @container (max-width: 560px) { .mn-files-pane .list [role='row'] { grid-template-columns: minmax(0, 1fr) 5rem; } .mn-files-pane .list .size { display: none; }
    .mn-files-pane .list.has-evidence [role='row'] { grid-template-columns: minmax(0, 1fr) 6rem 7rem !important; }
    .mn-files-pane .list.has-evidence .type, .mn-files-pane .list.has-evidence .ev:not(.strong) { display: none; } }
</style>`

function chooseFiles(event: Event, value: WorkspaceFilesOptions): void {
  const input = event.currentTarget as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length) value.onUpload(files)
  try { input.value = '' } catch { /* a read-only test double */ }
}

/**
 * The opened file's one row (design §12.2): Back, the name, the page controls of a PDF, Reload and Download. It replaces the
 * breadcrumb while a file is open, so the reader is three regions: this row, the page, the status line.
 */
function renderReaderRow(value: WorkspaceFilesOptions, preview: FilesPanePreview | null, name: string): TemplateResult {
  const pdf = preview?.kind === 'pdf' ? preview : null
  return html`<header class="reader-row" role="toolbar" aria-label="Opened file" ${ref(roving)}>
    <button type="button" class="tool" data-action="back" aria-label="Back to files" @click=${() => value.onClosePreview()}>← <span class="label">Back</span></button>
    <span class="title" title=${name}>${name}</span>
    ${preview?.kind === 'reader' && preview.label ? html`<span class="kind" data-kind-label>${preview.label}</span>` : nothing}
    ${preview?.kind === 'reader' && typeof preview.source === 'boolean' && value.onPreviewSource ? html`<button type="button" class="tool"
      data-action="source" aria-pressed=${preview.source ? 'true' : 'false'} aria-label="Show the source"
      @click=${() => value.onPreviewSource?.(!preview.source)}>&lt;/&gt;<span class="label"> Source</span></button>` : nothing}
    ${pdf && value.onReloadPreview ? html`<button type="button" class="tool" data-action="reload" aria-label="Reload original file"
      @click=${() => value.onReloadPreview?.()}>↻<span class="label"> Reload</span></button>` : nothing}
    ${value.onDownload && preview?.kind !== 'file' ? html`<button type="button" class="tool" data-action="download" aria-label="Download ${name}"
      @click=${() => value.onDownload?.()}>↓<span class="label"> Download</span></button>` : nothing}
  </header>`
}
/** The header is one Tab stop; the arrows move inside it. */
function roving(el: Element | undefined): void { if (el) rovingToolbar(el) }

function renderTrashRow(trash: FilesPaneTrash): TemplateResult {
  return html`<header class="reader-row" role="toolbar" aria-label="Trash" ${ref(roving)}>
    <button type="button" class="tool" data-action="back" aria-label="Back to files" @click=${() => trash.onBack()}>← <span class="label">Back</span></button>
    <span class="title">Trash</span>
  </header>`
}

function renderTrash(trash: FilesPaneTrash): TemplateResult {
  return html`<section class="trash" aria-label="Trash" data-trash>
    ${trash.note ? html`<p class="note" role="note">${trash.note}</p>` : nothing}
    ${trash.status === 'loading' ? html`<p class="empty">Reading the trash…</p>`
      : trash.status === 'error' ? html`<p class="empty error" role="alert">${trash.error}</p>`
      : trash.items.length === 0 ? html`<p class="empty" data-empty>The trash is empty.</p>`
      : html`<div role="list" aria-label=${`Trash, ${trash.items.length} ${trash.items.length === 1 ? 'item' : 'items'}`}>
        ${repeat(trash.items, item => item.key, item => html`<div role="row" data-key=${item.key} data-kind=${item.kind}>
          <span class="name"><mn-file-glyph kind=${item.kind === 'document' ? 'document' : 'file'} size="16"></mn-file-glyph>${item.label}</span>
          <span>${item.type}</span>
          <span>${item.when}</span>
          <span class="acts">
            <button type="button" class="tool" data-action="restore" aria-label=${`Restore ${item.label}`} @click=${() => trash.onRestore(item.key)}>Restore</button>
            ${trash.canPurge ? html`<button type="button" class="tool danger" data-action="purge" aria-label=${`Delete ${item.label} forever`}
              @click=${() => trash.onPurge(item.key)}>Delete forever</button>` : nothing}
          </span>
          ${item.confirm ? html`<div class="confirm" role="alertdialog" aria-label=${`Delete ${item.label} forever?`}><span>${item.confirm}</span>
            <button type="button" class="tool danger" data-action="confirm-purge" @click=${() => trash.onConfirmPurge(item.key)}>Delete forever</button>
            <button type="button" class="tool" data-action="cancel-purge" @click=${() => trash.onCancelPurge()}>Cancel</button></div>` : nothing}
        </div>`)}
      </div>`}
  </section>`
}

function renderHeader(value: WorkspaceFilesOptions): TemplateResult {
  if (value.trash) return renderTrashRow(value.trash)
  if (value.page) return renderReaderRow(value, value.preview, value.page.name)
  if (value.preview) return renderReaderRow(value, value.preview, value.preview.name)
  const crumbs = value.breadcrumbs
  return html`<header role="toolbar" aria-label="Files" ${ref(roving)}>
    <nav aria-label="Folder path">
      ${crumbs.map((crumb, index) => html`<span class="crumb">${index ? html`<span class="sep" aria-hidden="true">›</span>` : nothing}<button
        type="button" aria-current=${index === crumbs.length - 1 ? 'location' : nothing}
        @click=${() => value.onNavigate(crumb.id)}>${crumb.label}</button></span>`)}
    </nav>
    <div class="actions">
      <div class="seg" role="radiogroup" aria-label="View as">
        ${(['canvas', 'list'] as const).map(face => html`<button type="button" role="radio" data-face=${face}
          aria-checked=${value.face === face ? 'true' : 'false'}
          @click=${() => { if (value.face !== face) value.onFace(face) }}>${face === 'canvas' ? 'Canvas' : 'List'}</button>`)}
      </div>
      ${value.canChangeView && value.face === 'canvas' ? html`<span class="view">
        <select aria-label="Icon size" .value=${value.iconSize}
          @change=${(e: Event) => value.onIconSize((e.currentTarget as HTMLSelectElement).value as FilesIconSize)}>
          <option value="small" ?selected=${value.iconSize === 'small'}>Small icons</option>
          <option value="medium" ?selected=${value.iconSize === 'medium'}>Medium icons</option>
          <option value="large" ?selected=${value.iconSize === 'large'}>Large icons</option>
        </select>
        <label><input type="checkbox" aria-label="Snap to grid" .checked=${value.snapToGrid}
          @change=${(e: Event) => value.onSnapToGrid((e.currentTarget as HTMLInputElement).checked)} /> Grid</label>
      </span>` : nothing}
      ${value.needsLook && value.face === 'list' ? html`<button type="button" class="tool" data-action="needs-look" aria-pressed=${value.needsLook.on ? 'true' : 'false'}
        title="Only the files with a value the readers disagreed on"
        @click=${() => value.needsLook?.onToggle(!value.needsLook.on)}>Disputed · ${value.needsLook.count}</button>` : nothing}
      ${value.onOpenTrash ? html`<button type="button" class="tool" data-action="trash" title="Trash" @click=${() => value.onOpenTrash?.()}>Trash</button>` : nothing}
      ${value.canCreate ? html`<button type="button" class="tool" data-action="new-folder" title="New folder (⌘⇧N)"
        @click=${() => value.onNewFolder()}>New folder</button>` : nothing}
      ${value.canUpload ? html`<button type="button" class="tool" data-action="upload" title=${`Upload files (up to ${value.maxUploadLabel} each)`}
        @click=${(e: Event) => ((e.currentTarget as HTMLElement).nextElementSibling as HTMLInputElement | null)?.click()}>Upload</button><input
        class="visually-hidden" type="file" multiple tabindex="-1" aria-hidden="true" @change=${(e: Event) => chooseFiles(e, value)} />` : nothing}
    </div>
  </header>`
}

function rowKeys(value: WorkspaceFilesOptions): string[] {
  return value.rows.filter(row => row.selected).map(row => row.key)
}

function renderList(value: WorkspaceFilesOptions): TemplateResult {
  const select = (e: MouseEvent, key: string) => {
    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace'
    value.onRowSelect?.([key], mode)
  }
  const keydown = (e: KeyboardEvent) => {
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="row"][data-key]')]
    const at = rows.findIndex(row => row === (e.target as HTMLElement).closest('[role="row"]'))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) { next.focus(); value.onRowSelect?.([next.dataset.key!], e.shiftKey ? 'range' : 'replace') }
    } else if (e.key === 'Enter' && at >= 0) {
      e.preventDefault(); value.onRowOpen?.(rows[at]!.dataset.key!)
    } else if ((e.key === 'Delete' || e.key === 'Backspace' || e.key === 'F2') && value.onRowKey && rowKeys(value).length) {
      e.preventDefault(); value.onRowKey(e.key === 'F2' ? 'F2' : 'Delete', rowKeys(value))
    }
  }
  const drop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length || !value.canUpload) return
    e.preventDefault()
    value.onUpload(files)
  }
  // The kind's columns: the first row that has them names the headers; the tracks are the kind's, then Status and Size.
  const lead = value.rows.find(row => row.evidence)?.evidence
  const sheets = !!lead
  const tracks = lead ? `minmax(10rem, 1fr) 3.5rem ${lead.cells.map(c => c.width ?? 'minmax(5rem, 1fr)').join(' ')} 8rem 4.5rem` : ''
  return html`<div class=${sheets ? 'list has-evidence' : 'list'} style=${tracks ? `--mn-evidence-tracks: ${tracks}` : nothing} role="grid" aria-label=${`Folder list, ${value.rows.length} ${value.rows.length === 1 ? 'item' : 'items'}`}
    aria-multiselectable="true" @keydown=${keydown}
    @dragover=${(e: DragEvent) => { if (value.canUpload && Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault() }}
    @drop=${drop}>
    <div role="row" class="head"><span role="columnheader">Name</span><span role="columnheader" class="type">Type</span>${lead ? [...lead.cells.map((c, i) => html`<span role="columnheader" class=${i ? 'ev' : 'ev strong'}>${c.header}</span>`),
      html`<span role="columnheader">Status</span>`] : nothing}<span role="columnheader" class="size">Size</span></div>
    ${value.rows.length === 0 ? (value.needsLook?.on
      ? html`<div class="files-empty" data-empty-filter><p>Nothing here is disputed.</p></div>` : renderFilesEmpty(value.canUpload)) : nothing}
    ${repeat(value.rows, row => row.key, (row, index) => html`<div role="row" data-key=${row.key} aria-selected=${row.selected ? 'true' : 'false'}
      tabindex=${row.selected || (index === 0 && !value.rows.some(r => r.selected)) ? '0' : '-1'}
      @click=${(e: MouseEvent) => select(e, row.key)}
      @dblclick=${() => value.onRowOpen?.(row.key)}
      @contextmenu=${(e: MouseEvent) => { e.preventDefault(); if (!row.selected) value.onRowSelect?.([row.key], 'replace')
        value.onRowMenu?.(row.selected ? rowKeys(value) : [row.key], e.clientX, e.clientY) }}>
      <span role="gridcell" class="name"><mn-file-glyph kind=${row.kind} size="16"></mn-file-glyph>${row.naming
        ? renderRowNaming(value, row.key, row.naming)
        : row.label}</span>
      <span role="gridcell" class="type">${row.type}</span>
      ${lead ? renderEvidenceCells(row.evidence, lead.cells.length) : nothing}
      <span role="gridcell" class="size">${row.state ?? row.size ?? ''}</span>
    </div>`)}
  </div>`
}

/** The kind's cells, then Status: empty cells for a row no kind read, so the grid keeps its columns. */
function renderEvidenceCells(e: FileEvidence | undefined, columns: number): TemplateResult[] {
  const badge = e ? html`<span role="gridcell" class="badge" data-tone=${evidenceTone(e) ?? nothing}>${evidenceBadge(e)}</span>` : html`<span role="gridcell" class="badge"></span>`
  if (!e) return [...Array.from({ length: columns }, (_, i) => html`<span role="gridcell" class=${i ? 'ev' : 'ev strong'}></span>`), badge]
  return [...e.cells.map((c, i) => html`<span role="gridcell" class=${i ? 'ev' : 'ev strong'} title=${c.text} data-mark=${c.mark ?? nothing}>${c.label
    ? html`<span class="k">${c.label}</span>` : nothing}<span class="v">${c.text}</span>${quietMark(c.mark) ? html`<span class="mark" role="img"
    aria-label=${CORROBORATION_WORDS[c.mark!]}>${quietMark(c.mark)}</span>` : nothing}</span>`), badge]
}

/** The name input of a row named in place. Its keys stay its own (Backspace edits, it does not delete the file). */
function renderRowNaming(value: WorkspaceFilesOptions, key: string, naming: NonNullable<FilesPaneRow['naming']>): TemplateResult {
  const keydown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); value.onRowRename?.(key, (e.currentTarget as HTMLInputElement).value) }
    else if (e.key === 'Escape') { e.preventDefault(); value.onRowRenameCancel?.() }
  }
  const focusOnce = (el: Element | undefined) => {
    const input = el as HTMLInputElement | undefined
    if (!input || input.dataset.focused) return
    input.dataset.focused = '1'
    queueMicrotask(() => {
      input.focus()
      const dot = input.value.lastIndexOf('.')
      try { input.setSelectionRange(0, dot > 0 ? dot : input.value.length) } catch { /* not selectable */ }
    })
  }
  // The refusal is bound inside its own element: a binding that directly follows a void element is mis-parsed by some
  // DOM implementations (happy-dom), and the pane must not depend on the parser's mercy.
  const refusal = naming.error ? html`<span class="rename-error" role="alert">${naming.error}</span>` : nothing
  return html`<span class="rename-wrap"><input class="rename" type="text" aria-label="Name"
    value=${naming.initial} aria-invalid=${naming.error ? 'true' : 'false'} ${ref(focusOnce)} @keydown=${keydown}
    @click=${(e: Event) => e.stopPropagation()} @dblclick=${(e: Event) => e.stopPropagation()}><span class="rename-after">${refusal}</span></span>`
}

const EMPTY: readonly object[] = Object.freeze([])

function renderPreview(value: WorkspaceFilesOptions, preview: FilesPanePreview): TemplateResult {
  if (preview.kind === 'pdf') {
    return html`<section class="opened pdf" aria-label=${`Original of ${preview.name}`}><mn-pdf-reader
      .data=${preview.data ?? null} .fileKey=${preview.fileKey ?? ''} .name=${preview.name}
      .loading=${preview.status === 'loading' ? { loaded: preview.loaded ?? 0, total: preview.total ?? 0 } : null}
      .error=${preview.status === 'error' ? preview.error : ''}
      .assertions=${preview.assertions ?? EMPTY} .info=${preview.assertionsInfo ?? null}
      .overlay=${preview.overlay ?? false} .selected=${preview.selected ?? null} .reveal=${preview.reveal ?? null} .spotlight=${preview.spotlight ?? null}
      @pdf-page-change=${(e: CustomEvent<{ page: number; pageCount: number }>) => value.onPdfPage?.(e.detail.page, e.detail.pageCount)}
      @assertion-select=${(e: CustomEvent<{ id: string | null; page: number | null }>) => value.onAssertionSelect?.(e.detail.id, e.detail.page)}
      @assertion-overlay-change=${(e: CustomEvent<{ on: boolean }>) => value.onOverlay?.(e.detail.on)}
      @pdf-retry=${() => value.onReloadPreview?.()}
    ></mn-pdf-reader></section>`
  }
  if (preview.kind === 'image') {
    return html`<section class="opened" aria-label=${`Preview of ${preview.name}`}><div class="picture">
      ${preview.status === 'error' ? html`<p class="error">${preview.error}</p>`
        : preview.url ? html`<img src=${preview.url} alt=${preview.name} />` : html`<p>Loading ${preview.name}…</p>`}
    </div></section>`
  }
  if (preview.kind === 'reader') return renderReader(value, preview)
  if (preview.kind === 'media') return renderMedia(preview)
  return renderFilePage(value, preview)
}

type ReaderPreview = Extract<FilesPanePreview, { kind: 'reader' }>
type MediaPreview = Extract<FilesPanePreview, { kind: 'media' }>
type FilePagePreview = Extract<FilesPanePreview, { kind: 'file' }>

/** Hoja renders it (text, Markdown, code, JSON, a table, HTML, a Word document): read-only, through the editor kernel. */
function renderReader(value: WorkspaceFilesOptions, preview: ReaderPreview): TemplateResult {
  const view = preview.view
  const note = preview.truncated
    ? html`<p class="note" role="note" data-truncated>Showing the first ${preview.truncated.shown} of ${preview.truncated.total}.${value.onPreviewShowAll
      ? html` <button type="button" data-action="show-all" @click=${() => value.onPreviewShowAll?.()}>Show all</button>` : nothing}</p>`
    : preview.note ? html`<p class="note" role="note">${preview.note}</p>` : nothing
  return html`<section class="opened" aria-label=${`${preview.label} ${preview.name}`} data-viewer=${preview.label}>
    ${note}
    ${preview.status === 'error' ? html`<div class="card"><p class="error" role="alert">${preview.error}</p></div>`
      : !view ? html`<div class="card"><p>Reading ${preview.name}…</p></div>`
      : html`<hoja-reader variant=${view.variant} aria-label=${preview.name} ?line-numbers=${view.lineNumbers === true}
        .doc=${view.doc ?? null} .html=${view.html ?? null} .highlight=${view.highlight ?? null}></hoja-reader>`}
  </section>`
}

/** Audio and video play natively; an SVG is drawn as an image from its blob: URL (never inlined as DOM). */
function renderMedia(preview: MediaPreview): TemplateResult {
  const body = preview.status === 'error' ? html`<p class="error" role="alert">${preview.error}</p>`
    : !preview.url ? html`<p>Loading ${preview.name}…</p>`
    : preview.media === 'svg' ? html`<img src=${preview.url} alt=${preview.name} />`
    : preview.media === 'audio' ? html`<mn-file-glyph kind="file" type=${preview.caption ?? ''} size="64"></mn-file-glyph><p>${preview.name}</p>
      <audio controls preload="metadata" src=${preview.url} aria-label=${preview.name}></audio>`
    : html`<video controls playsinline preload="metadata" src=${preview.url} aria-label=${preview.name}></video>`
  return html`<section class="opened" aria-label=${`Preview of ${preview.name}`} data-viewer=${preview.media}>
    <div class=${preview.media === 'svg' ? 'picture' : 'media'}>${body}</div>
  </section>`
}

/** A kind with no viewer: what the file is, and an explicit Download. */
function renderFilePage(value: WorkspaceFilesOptions, preview: FilePagePreview): TemplateResult {
  return html`<section class="opened" aria-label=${`About ${preview.name}`} data-viewer="file">
    <div class="file-page">
      <mn-file-glyph kind="file" type=${preview.caption} size="96"></mn-file-glyph>
      <h2>${preview.name}</h2>
      <dl>
        <dt>Kind</dt><dd data-field="kind">${preview.typeLabel}</dd>
        ${preview.size ? html`<dt>Size</dt><dd data-field="size">${preview.size}</dd>` : nothing}
        ${preview.modified ? html`<dt>Modified</dt><dd data-field="modified">${preview.modified}</dd>` : nothing}
      </dl>
      ${preview.status === 'loading' ? html`<p>Reading ${preview.name}…</p>` : nothing}
      ${value.onDownload ? html`<button type="button" class="tool" data-action="download" aria-label="Download ${preview.name}"
        @click=${() => value.onDownload?.()}>↓ Download</button>` : nothing}
      ${preview.status === 'error' ? html`<p class="error" role="alert">${preview.error}</p>` : nothing}
    </div>
  </section>`
}

/** The page's source section: the viewer in a frame (a picture or a page flows; a reader keeps its own scroll). */
function renderSource(value: WorkspaceFilesOptions): TemplateResult {
  const preview = value.preview
  if (!preview) return html`<p class="fp-snote">Opening…</p>`
  const flows = preview.kind === 'file' || preview.kind === 'image' || (preview.kind === 'media' && preview.media === 'audio')
  return html`<div class="fp-source" ?data-flow=${flows}>${renderPreview(value, preview)}</div>`
}

export function renderFilesPane(value: WorkspaceFilesOptions): TemplateResult {
  const status = value.status
  const page = value.page
  const center = value.trash ? renderTrash(value.trash)
    : page ? renderFilesPage(page, {
      onSection: (id, open) => value.onPageSection?.(id, open),
      onGoto: (id, n) => value.onPageGoto?.(id, n),
      onAction: action => value.onPageAction?.(action),
      onFilter: text => value.onPageFilter?.(text),
      onNotes: detail => value.onNotesChange?.(detail),
      source: () => renderSource(value),
    })
    : value.preview ? renderPreview(value, value.preview)
    : value.face === 'canvas' && value.canvas ? html`<mn-files-canvas .input=${value.canvas}></mn-files-canvas>`
    : renderList(value)
  // The style sits inside the section: a template that begins with a binding is parsed as a processing instruction by
  // some DOM implementations (happy-dom), and the pane must not depend on the parser's mercy.
  return html`<section class="mn-files-pane" aria-label="Files" data-graph-id=${value.graphId}>${STYLE}${page ? FILES_PAGE_STYLE : nothing}
    ${renderHeader(value)}
    ${value.banner ? html`<p class="note" role="note">${value.banner}</p>` : nothing}
    <div class="center">${center}</div>
    <footer>
      ${status.busy ? html`<span class="pulse" aria-hidden="true" data-busy></span>` : nothing}
      <span role="status" aria-live="polite" aria-busy=${status.busy ? 'true' : 'false'} data-tone=${status.tone ?? 'info'}><span class="steady">${status.text}</span>${status.message
        ? html` · <span class="message">${status.message}</span>` : nothing}</span>
      ${status.action ? html`<button type="button" data-action="status-action" @click=${() => status.action?.onAction()}>${status.action.label}</button>` : nothing}
      ${status.undoLabel ? html`<button type="button" data-action="undo" @click=${() => value.onUndo()}>${status.undoLabel}</button>` : nothing}
    </footer>
  </section>`
}
