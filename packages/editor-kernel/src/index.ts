/**
 * @shrubbery/editor-kernel — the pure TipTap/ProseMirror editor kernel.
 *
 * `kernelExtensions()` returns the ordered roster: the BASE layer (StarterKit +
 * standalone CodeBlock + TextAlign/TextStyle/FontFamily/FontSize/Highlight/
 * Table-set/Placeholder) spread FIRST, then the custom Garden extensions ported
 * VERBATIM. `createKernelEditor` is the host-facing factory that mounts a REAL
 * TipTap Editor into a provided element using exactly that roster.
 *
 * PURITY INVARIANT (enforced by the lockfile tripwire): NO yjs / collab / y-* /
 * stores / fetchers / UI pickers ever enter this package's dependency closure.
 * Host-specific behavior (e.g. the WikiLink picker, click navigation) is wired
 * through KernelOptions callbacks — NEVER a backend import.
 */
import { Editor, type Extensions } from '@tiptap/core'
import { baseExtensions, type KernelProfile } from './base'
import { CommentMark } from './extensions/comment-mark'
import { ListItem } from './extensions/list-item'
import { Outliner } from './extensions/outliner'
import { BlockSelection, type BlockSelectionOverlayGate } from './extensions/block-selection'
import { BlockDnd } from './extensions/block-dnd'
import { OutlinerZoom, getZoomedBlockId } from './extensions/outliner-zoom'
import { Search } from './extensions/search'
import { Footnote } from './extensions/footnote'
import { ImageBlock } from './extensions/image-block'
import { CalendarEvent } from './extensions/calendar-event'
import { QueryBlock, type QueryBlockRenderer } from './extensions/query-block'
import { BlockMath, InlineMath, type MathRenderer } from './extensions/math'
import { MarginGloss, type MarginGlossOpenTarget } from './extensions/margin-gloss'
import { WikiLink, wikilinkStyles, type WikiLinkAttrs } from './extensions/wikilink'
import {
  WikiLinkAutocomplete,
  type OpenWikiLinkPickerDetail,
} from './extensions/wikilink-autocomplete'
import { SlashCommand } from './extensions/slash-command'
import { Citation, type CitationAttrs } from './extensions/citation'
import { SourceMetadata } from './extensions/source-metadata'
import { TagChip, type TagChipClickHandler } from './extensions/tag-chip'
import { TagRecognition, type ScheduledTagHandler } from './extensions/tag-recognition'
import { TagAutocomplete } from './extensions/tag-autocomplete'
import { BlockTags } from './extensions/block-tags'
import { BlockId } from './extensions/block-id'
import { WireShortcuts } from './extensions/wire-shortcuts'
import type { ClipboardWriter, MermaidRenderHost } from './extensions/copyable-code-block'

export type {
  MarginGlossOpenTarget,
  MarginGlossWireSummary,
} from './extensions/margin-gloss'
export type { CalendarEventAttrs } from './extensions/calendar-event'

/**
 * Host-supplied options. PURE seams only — callbacks the host wires, never a
 * backend import.
 *
 * WikiLink: the node itself stays pure. Hosts may receive typed-trigger and
 * explicit-picker intents through callbacks. The default document profile
 * retains the historical DOM CustomEvents when callbacks are absent; the
 * composer profile never emits those document-global intents.
 *
 * BlockId: garden gated 'queryBlock' in its data-block-id target list behind
 * `featureFlags.queryBlocksEnabled`. That coupling is SEVERED — the host opts
 * deferred node types (e.g. 'queryBlock', 'mathBlock') into the block-id target
 * list via `enabledNodeTypes` (default []). Naming an absent node is a harmless
 * no-op at schema build (global-attr type filter), but this keeps it host-driven.
 */
export interface KernelOptions {
  /** `document` (default) is the full editor; `composer` is the safe chat roster. */
  profile?: KernelProfile
  /** Called for the explicit Mod/Ctrl-Shift-K picker intent. */
  onWikiLinkPickerOpen?: () => void
  /** Called as a typed `[[query` trigger opens or changes. */
  onWikiLinkAutocompleteOpen?: (detail: OpenWikiLinkPickerDetail) => void
  /** Called when the active typed wikilink trigger closes. */
  onWikiLinkAutocompleteClose?: () => void
  /** Called when a wikilink node is clicked (host handles navigation). */
  onWikiLinkClick?: (attrs: WikiLinkAttrs) => void
  /** Called when a wikilink node is deleted (host handles wire cleanup). */
  onWikiLinkDelete?: (attrs: WikiLinkAttrs) => void
  /** Called when a citation chip is clicked (host opens the source workbench). */
  onCitationClick?: (attrs: CitationAttrs) => void
  /** Called when a tag chip is clicked (host handles tag page / daily-note navigation). */
  onTagClick?: TagChipClickHandler
  /** Called when typed #event/#todo materializes a scheduled date. */
  onScheduledTag?: ScheduledTagHandler
  /** Called when a predicate-margin gloss target is clicked. */
  onMarginGlossOpen?: (target: MarginGlossOpenTarget) => void
  /** Deterministic seam for scheduled-tag defaults. Defaults to the user's local day. */
  getToday?: () => string
  /** Optional host renderer for math nodes. Defaults to raw LaTeX text. */
  renderMath?: MathRenderer
  /** Optional host renderer/executor for the pure QueryBlock document node. */
  renderQueryBlock?: QueryBlockRenderer
  /** Host-owned Mermaid renderer/cache/theme lifecycle for code blocks. */
  mermaid?: MermaidRenderHost
  /** Optional clipboard seam. Defaults to navigator.clipboard.writeText. */
  writeClipboard?: ClipboardWriter
  /** Mermaid edit debounce. Defaults to Garden's 250ms. */
  mermaidRenderDelayMs?: number
  /** Active graph read at QueryBlock render/update time. */
  getGraphId?: () => string | null | undefined
  /**
   * Deferred/opt-in node names appended to BlockId's data-block-id target list
   * (the severed featureFlags seam). Default []. E.g. ['queryBlock'].
   */
  enabledNodeTypes?: readonly string[]
  /**
   * Host-local transient-overlay gate for Escape handling. Suggestion menus and
   * dialogs live outside the pure kernel; the kernel receives only this predicate.
   */
  isOverlayOpen?: BlockSelectionOverlayGate
  /**
   * Collab-ready mode: when true, DROP the kernel's own undo/redo (StarterKit
   * `undoRedo: false`) so a HOST-injected @tiptap/extension-collaboration owns
   * history via yjs's UndoManager. THE HISTORY-OWNERSHIP HANDOFF: a collab editor
   * that still has StarterKit history ON double-applies undo / desyncs Yjs (this
   * is exactly why garden ran `undoRedo: false`). The kernel STAYS pure — this
   * flag only OMITS the history extension; it does NOT import yjs/Collaboration.
   * The host appends Collaboration AFTER this roster, bound to the Y.Doc. Default
   * false (standalone keeps history — the existing undo round-trip).
   */
  collaborative?: boolean
}

/**
 * The ordered extension roster for a kernel Editor.
 *
 * Invariant for EVERY rung: `getSchema(kernelExtensions())` must NOT throw.
 *
 * Ordering: BASE first (it provides doc/paragraph/text/heading/blockquote/
 * codeBlock/table-set + the standard marks), then the custom extensions.
 *
 * STRUCTURAL NOTE: ListItem's content expr '(paragraph | heading | codeBlock |
 * blockquote)+' references heading/blockquote (StarterKit) and codeBlock (the
 * standalone bare CodeBlock in baseExtensions). new Schema() THROWS on an
 * unknown content-expr referent — so the base is ListItem's prerequisite, which
 * is why it lands here alongside the customs.
 */
export function kernelExtensions(opts: KernelOptions = {}): Extensions {
  const profile = opts.profile ?? 'document'
  const wikiLink = WikiLink.configure({
    onOpenPicker: opts.onWikiLinkPickerOpen,
    emitLegacyPickerEvents: profile === 'document',
    onWikiLinkClick: opts.onWikiLinkClick,
    onWikiLinkDelete: opts.onWikiLinkDelete,
  })
  const wikiLinkAutocomplete = WikiLinkAutocomplete.configure({
    onOpen: opts.onWikiLinkAutocompleteOpen,
    onClose: opts.onWikiLinkAutocompleteClose,
    emitLegacyPickerEvents: profile === 'document',
  })

  if (profile === 'composer') {
    return [
      ...baseExtensions({
        profile,
        collaborative: opts.collaborative,
      }),
      wikiLink,
      wikiLinkAutocomplete,
    ]
  }

  return [
    // Thread the history-ownership decision down to the base roster. Under
    // collaborative mode the base drops StarterKit's undoRedo (false) so a
    // host-composed Collaboration extension is the SOLE history owner.
    ...baseExtensions({
      profile,
      collaborative: opts.collaborative,
      mermaid: opts.mermaid,
      writeClipboard: opts.writeClipboard,
      mermaidRenderDelayMs: opts.mermaidRenderDelayMs,
    }),
    CommentMark,
    ListItem,
    Outliner,
    BlockSelection.configure({
      getZoomedBlockId,
      isOverlayOpen: opts.isOverlayOpen,
    }),
    BlockDnd,
    OutlinerZoom,
    Search,
    Footnote,
    ImageBlock,
    CalendarEvent,
    QueryBlock.configure({
      renderQueryBlock: opts.renderQueryBlock,
      getGraphId: opts.getGraphId,
    }),
    InlineMath.configure({
      renderMath: opts.renderMath,
    }),
    BlockMath.configure({
      renderMath: opts.renderMath,
    }),
    MarginGloss.configure({
      onOpenTarget: opts.onMarginGlossOpen,
    }),
    wikiLink,
    wikiLinkAutocomplete,
    SlashCommand,
    Citation.configure({
      onCitationClick: opts.onCitationClick,
    }),
    SourceMetadata,
    TagChip.configure({
      onTagClick: opts.onTagClick,
    }),
    TagRecognition.configure({
      getToday: opts.getToday,
      onScheduledTag: opts.onScheduledTag,
    }),
    TagAutocomplete,
    BlockTags,
    BlockId.configure({
      enabledNodeTypes: ['queryBlock', ...(opts.enabledNodeTypes ?? [])],
    }),
    WireShortcuts,
  ]
}

/**
 * Mount a REAL TipTap Editor into `element` using the kernel roster.
 */
export function createKernelEditor(element: HTMLElement, opts: KernelOptions = {}): Editor {
  return new Editor({
    element,
    extensions: kernelExtensions(opts),
  })
}

export type { WikiLinkAttrs }
export type { KernelProfile }
export { wikilinkStyles }
export * from './outliner-tree'
export * from './extensions/block-selection'
export * from './extensions/block-dnd'
export * from './extensions/outliner-zoom'
export * from './extensions/citation'
export * from './extensions/math'
export * from './extensions/query-block'
export * from './extensions/copyable-code-block'
export * from './extensions/wikilink-autocomplete'
export * from './extensions/slash-command'
export * from './extensions/tag-chip'
export * from './extensions/tag-recognition'
export * from './extensions/tag-autocomplete'
export * from './extensions/wire-shortcuts'
export * from './tag-suggestions'
// Re-export the TipTap Editor type — it is already the public return type of
// createKernelEditor, so hosts can name it without importing @tiptap/core
// directly (keeps @tiptap out of host dependency surfaces).
export type { Editor } from '@tiptap/core'
