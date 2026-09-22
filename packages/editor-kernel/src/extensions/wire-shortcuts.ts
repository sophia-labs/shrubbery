/**
 * Kernel keyboard shortcuts for wire creation.
 *
 * Ports prod's `Cmd+;` and `Cmd+Shift+;` keybindings
 * (`mnemosyne-platform/frontend/src/components/document-editor.ts:7438-7457`).
 *
 * **Mod-;** dispatches `mn-editor-keyboard-wire-request` at the document
 * level with `{ blockId, shiftKey: false }`. The runtime picker glue
 * (`packages/runtime/src/picker/install-glue.ts`) translates that into a
 * `mn-block-wire-request` after filling in graphId / documentId from the
 * active scope — keyboard parity with the bubble-click → wire picker flow.
 *
 * **Mod-Shift-;** dispatches `mn-editor-keyboard-wire-menu-request` at the
 * document level with `{ blockId }`. The organism listens for this event
 * (via `mn-advanced-wire-menu`) and opens the predicate-first advanced menu
 * anchored to the cursor block. After predicate + direction selection, the
 * menu calls `contract.wireMode.enter(source, config, hostId)` to enter
 * visual wire mode — body class `wire-mode-active`, `editor.setEditable
 * (false)`, J/K block navigation, source / target highlight overlays. The
 * kernel does NOT know about wire mode itself; it only fires the request.
 *
 * Both events carry only the kernel-resolvable context (block id at cursor).
 * The runtime fills in graphId / documentId from the active scope; the
 * organism owns the predicate / direction / wire-mode-state. Cross-pane
 * gating lives on `ShrubberyContract.wireMode.activeHostId`.
 *
 * Purity: this extension imports nothing from yjs, stores, fetchers, or UI
 * components — pure `@tiptap/core` only, fits the lockfile tripwire.
 *
 * Tests: `packages/editor-kernel/src/__tests__/wire-shortcuts.test.ts`.
 */

import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { blockIdOf } from '../outliner-tree'
import { topLevelBlockStartPos } from '../outliner-tree'

/** Event the host listens for; carries minimal context the kernel can supply. */
export const EDITOR_KEYBOARD_WIRE_REQUEST_EVENT = 'mn-editor-keyboard-wire-request'

export interface EditorKeyboardWireRequestDetail {
  readonly blockId: string
  readonly shiftKey: boolean
}

/**
 * Event fired by Mod-Shift-;. The organism's advanced-wire-menu listens at
 * the document level, opens the predicate-first menu, and on confirm calls
 * `contract.wireMode.enter(...)` to transition into visual wire mode.
 */
export const EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT = 'mn-editor-keyboard-wire-menu-request'

export interface EditorKeyboardWireMenuRequestDetail {
  readonly blockId: string
}

/**
 * Resolve the source `data-block-id` for the editor's current selection.
 *
 * Tables are special: each cell is its own block (see BASE_BLOCK_TYPES in
 * block-id.ts). The table itself is the outliner container and carries no
 * block-id, so we walk the ancestry from innermost outward and return the
 * first containing tableCell / tableHeader's id. For every other context the
 * source is the top-level outliner block.
 *
 * Returns null if no block-id-bearing ancestor is found (e.g. transient
 * selection state during paste, or a fully empty document).
 */
export function wireSourceBlockIdAtSelection(state: EditorState): string | null {
  const $pos = state.doc.resolve(
    Math.min(Math.max(state.selection.from, 0), state.doc.content.size),
  )
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth)
    const name = node.type.name
    if (name === 'tableCell' || name === 'tableHeader') {
      return blockIdOf(node)
    }
  }
  const pos = topLevelBlockStartPos(state.doc, state.selection.from)
  if (pos === null) return null
  const node = state.doc.nodeAt(pos)
  return node ? blockIdOf(node) : null
}

export const WireShortcuts = Extension.create({
  name: 'wireShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-;': () => {
        const blockId = wireSourceBlockIdAtSelection(this.editor.state)
        if (!blockId) return false
        const target = this.editor.view.dom.ownerDocument
        target.dispatchEvent(
          new CustomEvent<EditorKeyboardWireRequestDetail>(
            EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
            {
              detail: { blockId, shiftKey: false },
              bubbles: true,
              composed: true,
            },
          ),
        )
        return true
      },
      'Mod-Shift-;': () => {
        const blockId = wireSourceBlockIdAtSelection(this.editor.state)
        if (!blockId) return false
        const target = this.editor.view.dom.ownerDocument
        target.dispatchEvent(
          new CustomEvent<EditorKeyboardWireMenuRequestDetail>(
            EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
            {
              detail: { blockId },
              bubbles: true,
              composed: true,
            },
          ),
        )
        return true
      },
    }
  },
})

export default WireShortcuts
