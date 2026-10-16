/**
 * The editor's keyboard shortcuts, for the Keyboard Shortcuts page.
 *
 * The keymaps live in editor-kernel's extensions (and TipTap's own); this
 * table only describes them, here in nucleus so every layer can read it. Each entry names the exact key string its
 * `source` binds, and shortcut-catalog.test.ts fails when that string leaves
 * the source, so the page cannot drift from the editor unnoticed. TipTap's
 * own bindings have no source file here and are listed from its defaults
 * (v3), limited to what base.ts installs.
 *
 * `shortcut` is the display form the shortcuts dialog formats: `Mod`, `Shift`,
 * `Alt`, `Ctrl` and a key, joined by `+`. A typed trigger (`[[`) is a plain
 * string.
 */

export interface EditorShortcut {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly shortcut: string
  /** The key exactly as the source binds it, e.g. `Mod-Shift-k`. */
  readonly binding?: string
  /** The file under packages/ that binds it; absent for TipTap's defaults. */
  readonly source?: string
}

const OUTLINER = 'editor-kernel/src/extensions/outliner.ts'
const ZOOM = 'editor-kernel/src/extensions/outliner-zoom.ts'
const WIRES = 'editor-kernel/src/extensions/wire-shortcuts.ts'
const WIKILINK = 'editor-kernel/src/extensions/wikilink.ts'
const CITATION = 'editor-kernel/src/extensions/citation.ts'
const BLOCK_SELECTION = 'editor-kernel/src/extensions/block-selection.ts'
const HOST = 'runtime/src/editor-host.ts'

export const EDITOR_SHORTCUTS: readonly EditorShortcut[] = [
  // Text (TipTap defaults)
  { id: 'editor.bold', label: 'Bold', category: 'Text', shortcut: 'Mod+B' },
  { id: 'editor.italic', label: 'Italic', category: 'Text', shortcut: 'Mod+I' },
  { id: 'editor.underline', label: 'Underline', category: 'Text', shortcut: 'Mod+U' },
  { id: 'editor.strike', label: 'Strikethrough', category: 'Text', shortcut: 'Mod+Shift+S' },
  { id: 'editor.code', label: 'Inline code', category: 'Text', shortcut: 'Mod+E' },
  { id: 'editor.highlight', label: 'Highlight', category: 'Text', shortcut: 'Mod+Shift+H' },
  { id: 'editor.hard-break', label: 'Line break inside a block', category: 'Text', shortcut: 'Shift+Enter' },
  { id: 'editor.undo', label: 'Undo', category: 'Text', shortcut: 'Mod+Z' },
  { id: 'editor.redo', label: 'Redo', category: 'Text', shortcut: 'Mod+Shift+Z' },

  // Blocks (TipTap defaults, plus typed starts)
  { id: 'editor.paragraph', label: 'Paragraph', category: 'Blocks', shortcut: 'Mod+Alt+0' },
  { id: 'editor.heading-1', label: 'Heading 1', category: 'Blocks', shortcut: 'Mod+Alt+1' },
  { id: 'editor.heading-2', label: 'Heading 2', category: 'Blocks', shortcut: 'Mod+Alt+2' },
  { id: 'editor.heading-3', label: 'Heading 3', category: 'Blocks', shortcut: 'Mod+Alt+3' },
  { id: 'editor.quote', label: 'Quote', category: 'Blocks', shortcut: 'Mod+Shift+B' },
  { id: 'editor.code-block', label: 'Code block', category: 'Blocks', shortcut: 'Mod+Alt+C' },
  { id: 'editor.bullet', label: 'Bulleted item (type at the start)', category: 'Blocks', shortcut: '- ' },
  { id: 'editor.numbered', label: 'Numbered item (type at the start)', category: 'Blocks', shortcut: '1. ' },
  { id: 'editor.task', label: 'Task (type at the start)', category: 'Blocks', shortcut: '[ ] ' },
  { id: 'editor.slash', label: 'Insert menu (type at the start or after a space)', category: 'Blocks', shortcut: '/' },
  { id: 'editor.align-center', label: 'Align center', category: 'Blocks', shortcut: 'Mod+Shift+E' },
  { id: 'editor.align-right', label: 'Align right', category: 'Blocks', shortcut: 'Mod+Shift+R' },
  { id: 'editor.align-justify', label: 'Justify', category: 'Blocks', shortcut: 'Mod+Shift+J' },

  // Outline
  { id: 'editor.indent', label: 'Indent', category: 'Outline', shortcut: 'Tab', binding: 'Tab', source: OUTLINER },
  { id: 'editor.outdent', label: 'Outdent', category: 'Outline', shortcut: 'Shift+Tab', binding: 'Shift-Tab', source: OUTLINER },
  { id: 'editor.fold', label: 'Fold or unfold children', category: 'Outline', shortcut: 'Mod+.', binding: 'Mod-.', source: OUTLINER },
  { id: 'editor.collapse', label: 'Collapse block', category: 'Outline', shortcut: 'Mod+ArrowUp', binding: 'Mod-ArrowUp', source: OUTLINER },
  { id: 'editor.expand', label: 'Expand block', category: 'Outline', shortcut: 'Mod+ArrowDown', binding: 'Mod-ArrowDown', source: OUTLINER },
  { id: 'editor.move-up', label: 'Move block up', category: 'Outline', shortcut: 'Alt+Shift+ArrowUp', binding: 'Alt-Shift-ArrowUp', source: OUTLINER },
  { id: 'editor.move-down', label: 'Move block down', category: 'Outline', shortcut: 'Alt+Shift+ArrowDown', binding: 'Alt-Shift-ArrowDown', source: OUTLINER },
  { id: 'editor.zoom-in', label: 'Zoom into block', category: 'Outline', shortcut: 'Mod+Shift+ArrowRight', binding: 'Mod-Shift-ArrowRight', source: ZOOM },
  { id: 'editor.zoom-out', label: 'Zoom out', category: 'Outline', shortcut: 'Mod+Shift+ArrowLeft', binding: 'Mod-Shift-ArrowLeft', source: ZOOM },
  { id: 'editor.select-block', label: 'Select the block (then Shift+↑/↓ to extend)', category: 'Outline', shortcut: 'Escape', binding: 'Escape', source: BLOCK_SELECTION },

  // Wires and links
  { id: 'editor.quick-wire', label: 'Wire from this block', category: 'Wires and links', shortcut: 'Mod+;', binding: 'Mod-;', source: WIRES },
  { id: 'editor.wire-menu', label: 'Advanced wire menu', category: 'Wires and links', shortcut: 'Mod+Shift+;', binding: 'Mod-Shift-;', source: WIRES },
  { id: 'editor.wikilink', label: 'Link to a document or block', category: 'Wires and links', shortcut: 'Mod+Shift+K', binding: 'Mod-Shift-k', source: WIKILINK },
  { id: 'editor.wikilink-typed', label: 'Link to a document or block (typed)', category: 'Wires and links', shortcut: '[[' },
  { id: 'editor.citation', label: 'Cite a source', category: 'Wires and links', shortcut: 'Mod+Shift+C', binding: 'Mod-Shift-c', source: CITATION },
  { id: 'editor.tag', label: 'Tag (type at the start or after a space)', category: 'Wires and links', shortcut: '#' },

  // Find and annotate (editor-host's own key handler)
  { id: 'editor.find', label: 'Find in document', category: 'Find and annotate', shortcut: 'Mod+F', binding: "key === 'f'", source: HOST },
  { id: 'editor.footnote', label: 'Insert footnote', category: 'Find and annotate', shortcut: 'Mod+Shift+F', binding: "key === 'f'", source: HOST },
]
