/**
 * Kernel BASE layer — the standard TipTap/ProseMirror foundation the custom
 * Garden extensions build on. PURE @tiptap/* only.
 *
 * WHY THIS LANDS AT S2 (not later): the custom ListItem (ported at S2) declares
 * content = '(paragraph | heading | codeBlock | blockquote)+'. ProseMirror's
 * `new Schema()` THROWS on any unknown name in a content expression (verified:
 * "No node type or group 'heading' found"). So heading/blockquote (from
 * StarterKit) and a standalone `codeBlock` MUST exist in the roster the moment
 * ListItem is wired, or getSchema(kernelExtensions()) throws. The base is
 * therefore ListItem's structural prerequisite, not optional polish — this is
 * the documented "codeBlock-class" fix.
 *
 * CONFIG NOTES:
 * - codeBlock:false on StarterKit + the pure CopyableCodeBlock extension:
 *   garden disables StarterKit's listItem/lists (the flat Outliner model replaces
 *   nested lists). CopyableCodeBlock retains TipTap's schema/commands and severs
 *   Mermaid rendering behind a host callback, so it remains safe in the kernel.
 * - undoRedo:true (RE-ENABLED): garden set this false ONLY because Collaboration
 *   owned history. The kernel has NO collab, so by DEFAULT history is ours.
 *
 * HISTORY-OWNERSHIP HANDOFF (collab-ready mode): when a HOST composes
 * @tiptap/extension-collaboration over this roster, history MUST be owned by
 * yjs's UndoManager — NOT by StarterKit. If both track edits, undo double-applies
 * and the ProseMirror↔Yjs sync desyncs (this is exactly why garden ran
 * StarterKit `undoRedo: false`). So baseExtensions accepts a `collaborative` flag:
 * when set, it emits `undoRedo: false`, DROPPING the kernel's own history so the
 * host-injected Collaboration owns it. PURITY: this flag only OMITS an extension
 * — it does NOT import yjs / @tiptap/extension-collaboration. The collab plane
 * composes entirely at the host boundary (packages/runtime). The kernel stays
 * @tiptap/* only. Default is `false` ⇒ history stays ours (standalone path).
 */

import type { Extensions } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontFamily } from '@tiptap/extension-font-family'
import { FontSize } from '@tiptap/extension-font-size'
import { Highlight } from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Placeholder } from '@tiptap/extension-placeholder'
import {
  CopyableCodeBlock,
  type ClipboardWriter,
  type MermaidRenderHost,
} from './extensions/copyable-code-block'

/** The schema/interaction posture selected by a kernel host. */
export type KernelProfile = 'document' | 'composer'

/** Options for the base roster. */
export interface BaseExtensionsOptions {
  /**
   * `document` keeps the complete authoring foundation. `composer` keeps only
   * paragraph/text/hard-break and the inline marks needed by a chat surface.
   */
  readonly profile?: KernelProfile
  /**
   * When true, DROP StarterKit's own undo/redo (`undoRedo: false`) so a
   * host-injected @tiptap/extension-collaboration owns history via yjs's
   * UndoManager. The kernel STAYS pure — this only OMITS the history extension;
   * it does NOT import yjs/Collaboration. Default false (history is the kernel's).
   */
  readonly collaborative?: boolean
  /** Host-owned Mermaid renderer/theme lifecycle for CopyableCodeBlock. */
  readonly mermaid?: MermaidRenderHost
  /** Optional clipboard seam (browser clipboard is the default). */
  readonly writeClipboard?: ClipboardWriter
  /** Debounce applied while Mermaid source is edited. */
  readonly mermaidRenderDelayMs?: number
}

/**
 * The ordered base roster. Spread FIRST in kernelExtensions(), before the
 * ported custom extensions.
 *
 * `opts.collaborative` selects the history owner: false (default) ⇒ undoRedo is
 * the kernel's (`{}` = ON); true ⇒ undoRedo is dropped (`false`) so a host's
 * Collaboration extension owns it. See the HISTORY-OWNERSHIP HANDOFF note above.
 */
export function baseExtensions(opts: BaseExtensionsOptions = {}): Extensions {
  if (opts.profile === 'composer') {
    return [
      StarterKit.configure({
        // A composer is deliberately not a page editor. Keep only the
        // paragraph/text/hard-break foundation and its inline marks.
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
        link: { openOnClick: false },
        undoRedo: opts.collaborative ? false : {},
      }),
      Placeholder,
    ]
  }

  return [
    StarterKit.configure({
      // Flat Outliner model owns list structure — disable StarterKit lists.
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
      // History ownership: by default it is ours (no Collaboration to own it).
      // The enable signal is a (possibly empty) options object `{}` — `true` is
      // NOT a valid value in the v3 typings (`Partial<UndoRedoOptions> | false`).
      // Under collaborative mode we DROP it (`false`) so the host's Collaboration
      // extension's yjs UndoManager is the SOLE history owner — leaving StarterKit
      // undoRedo ON while collab is active double-applies undo / desyncs Yjs.
      undoRedo: opts.collaborative ? false : {},
    }),
    // CopyableCodeBlock keeps the same `codeBlock` schema + commands and
    // satisfies ListItem's content expr referent. Mermaid itself stays host-side.
    CopyableCodeBlock.configure({
      mermaid: opts.mermaid,
      writeClipboard: opts.writeClipboard,
      renderDelayMs: opts.mermaidRenderDelayMs ?? 250,
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    FontFamily,
    FontSize,
    Highlight,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder,
  ]
}
