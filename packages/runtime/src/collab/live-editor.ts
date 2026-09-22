/**
 * collab/live-editor.ts — the CRDT plane. Composes the pure @shrubbery/editor-
 * kernel roster with @tiptap/extension-collaboration bound to a Y.Doc, so a live
 * collaborative TipTap Editor mounts into the host's element.
 *
 * WHY THIS FILE LIVES IN A SUBDIR (collab/), NOT top-level src/:
 * the island guard (render-workspace-island.test.ts) scans ONLY the TOP-LEVEL
 * runtime/src/*.ts files (non-recursive readdirSync) and forbids yjs / Collaboration
 * / non-(lit|nucleus) imports there. The host element (editor-host.ts, top-level,
 * scanned) STAYS an island; the collab plane is quarantined to this subdir, which
 * IS allowed the collab deps. The host reaches it via a sibling relative import —
 * which the guard permits — so the island invariant holds while the live body is
 * real. The kernel-scoped purity tripwire is a SEPARATE guard over
 * packages/editor-kernel/src; that package never sees yjs at all.
 *
 * THE HISTORY-OWNERSHIP HANDOFF (the load-bearing concern):
 *   - the kernel is asked for its COLLABORATIVE roster (kernelExtensions({
 *     collaborative: true })) → StarterKit's undoRedo is DROPPED (false), so the
 *     kernel contributes NO history extension;
 *   - this module appends @tiptap/extension-collaboration bound to the Y.Doc, but
 *     gives its required per-view undo plugin an INERT adapter;
 *   - one recording UndoManager is leased from room-history.ts by Y.Doc + field,
 *     and commands in every view route to that room-owned authority.
 * History is therefore recorded EXACTLY ONCE PER ROOM. Leaving the kernel's
 * undoRedo ON while Collaboration is active double-applies undo and desyncs
 * ProseMirror↔Yjs — this is precisely why garden ran StarterKit
 * `undoRedo: false`. We re-derive that handoff through the pure kernel flag.
 *
 * FIELD NAME: Collaboration binds to the Y.XmlFragment named 'content' — the SAME
 * field garden uses (yDoc.getXmlFragment('content')). Two editors converge only
 * if they share both the Y.Doc AND the field name.
 *
 * OPAQUE-HANDLE CAST: the contract's ProviderHandle.doc is `CrdtDoc = unknown`
 * (nucleus stays yjs-free). The concrete `as Y.Doc` cast lives HERE — in the
 * host's collab plane — never in nucleus or the kernel.
 *
 * The network provider remains the shell's CrdtBackend concern. The cursor
 * plane is live here through @tiptap/y-tiptap's yCursorPlugin over the exact
 * ProviderHandle.awareness instance supplied by that backend.
 */

import * as Y from 'yjs'
import { css, unsafeCSS } from 'lit'
import { Editor, Extension, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { yCursorPlugin } from '@tiptap/y-tiptap'
import { Awareness } from 'y-protocols/awareness'
import { acquireRoomHistory, createViewUndoAdapter } from './room-history.js'
import {
  blockIndexById,
  getAncestorsByBlockId,
  getHeadingOutline,
  getOutlinerBlocks,
  getZoomedBlockId,
  kernelExtensions,
  tagChipStyles,
  wikilinkStyles,
  type CitationAttrs,
  type KernelOptions,
  type SlashCommandId,
  type TagChipAttrs,
  type WikiLinkAttrs,
} from '@shrubbery/editor-kernel'

/**
 * The kernel-options slot the host forwards into the live editor — exactly the
 * shape buildKernelOptions(services, scope) produces (the editor navigation callbacks),
 * with `collaborative` structurally EXCLUDED (collab is forced ON only here, so
 * the room-level Yjs manager stays the sole recording authority; a leaked
 * `collaborative` would double-own undo).
 *
 * WHY RE-EXPORTED HERE: the top-level island-scanned host (editor-host.ts) may NOT
 * import KernelOptions from @shrubbery/editor-kernel (that specifier is neither lit
 * nor @shrubbery/nucleus nor a sibling .js, so the island guard rejects it). But the
 * host ALREADY imports this sibling collab module (./collab/live-editor.js, an
 * allowed relative .js). By aliasing the type here and importing it from the sibling,
 * the host can carry the callbacks as OPAQUE function values — type-checked, but with
 * no forbidden import. The concrete @shrubbery/editor-kernel assembly stays in the
 * editor-services/ subdir + the shell, mirroring how the opaque CrdtDoc `as Y.Doc`
 * cast is confined to this same collab plane.
 */
export type EditorKernelOptions = Omit<KernelOptions, 'collaborative'>

/**
 * The wikilink insert-command argument shape — re-exported (aliased) from the kernel
 * through this sibling collab module SO THE ISLAND-SCANNED HOST (editor-host.ts, a
 * top-level src/*.ts file) can carry it WITHOUT a forbidden `@shrubbery/editor-kernel`
 * import. The host already imports this sibling .js (an island-legal relative import),
 * exactly the same trick EditorKernelOptions uses above. The host's widened
 * LiveEditorHandle.insertWikiLink(attrs: LiveWikiLinkAttrs) is typed off this alias and
 * passes straight through to the real editor's `commands.insertWikiLink`.
 */
export type LiveWikiLinkAttrs = WikiLinkAttrs
export type LiveTagChipAttrs = TagChipAttrs
export type LiveCitationAttrs = CitationAttrs
export type LiveSlashCommandId = SlashCommandId

/**
 * TipTap's own document-JSON shape, aliased through this sibling collab module
 * for the SAME island reason as `LiveWikiLinkAttrs` above: the host may not
 * import `@tiptap/core`, but it may import this module.
 *
 * `LiveEditorHandle.getJSON()` and `ShEditorHost.getDocumentJSON()` are typed
 * off this alias and return exactly what the real `Editor.getJSON()` produces —
 * the LOSSLESS document. The pre-existing `getText()` is not a substitute: it
 * flattens marks, node attributes, code-fence structure and every wikilink's
 * target away.
 *
 * Structurally the same thing as `@shrubbery/hoja`'s `HojaJSONContent` (both are
 * ProseMirror node JSON); the alias exists so neither package must depend on the
 * other to name it.
 */
export type LiveDocumentJSON = JSONContent

export interface LiveZoomCrumb {
  readonly blockId: string | null
  readonly text: string
}

export interface LiveZoomSnapshot {
  readonly blockId: string | null
  readonly breadcrumb: readonly LiveZoomCrumb[]
}

const EMPTY_ZOOM_SNAPSHOT: LiveZoomSnapshot = { blockId: null, breadcrumb: [] }

function zoomLabel(node: { textContent: string }): string {
  const text = node.textContent.trim()
  if (text.length > 40) return `${text.slice(0, 40)}...`
  return text || 'Untitled'
}

/**
 * Read-only projection of the kernel zoom plugin into host-facing UI state.
 * The plugin remains the source of truth; this helper just gives the island host
 * an opaque, serializable snapshot without importing the kernel there.
 */
export function liveZoomSnapshot(editor: Pick<Editor, 'state'>): LiveZoomSnapshot {
  const blockId = getZoomedBlockId(editor.state)
  if (!blockId) return EMPTY_ZOOM_SNAPSHOT

  const blocks = getOutlinerBlocks(editor.state.doc)
  const index = blockIndexById(blocks, blockId)
  if (index === -1) return { blockId, breadcrumb: [] }

  const breadcrumb: LiveZoomCrumb[] = [{ blockId: null, text: 'Home' }]
  for (const ancestor of getAncestorsByBlockId(blocks, blockId)) {
    breadcrumb.push({ blockId: ancestor.blockId, text: zoomLabel(ancestor.node) })
  }
  breadcrumb.push({ blockId, text: zoomLabel(blocks[index].node) })
  return { blockId, breadcrumb }
}

export interface LiveHeadingOutlineEntry {
  readonly id: string
  readonly level: number
  readonly text: string
}

/**
 * Read-only projection of the document's headings into host-facing UI state —
 * the same opaque-handle trick as liveZoomSnapshot, so the island host can
 * offer a live table-of-contents without importing the kernel directly.
 */
export function liveHeadingOutline(editor: Pick<Editor, 'state'>): LiveHeadingOutlineEntry[] {
  const zoomBlockId = getZoomedBlockId(editor.state)
  if (!zoomBlockId) return getHeadingOutline(editor.state.doc)
  const zoomRootIndex = blockIndexById(getOutlinerBlocks(editor.state.doc), zoomBlockId)
  return getHeadingOutline(editor.state.doc, zoomRootIndex === -1 ? undefined : zoomRootIndex)
}

/** The Y.XmlFragment field name Collaboration binds to (matches garden). */
export const COLLAB_FIELD = 'content'

/**
 * @tiptap/y-tiptap 3.0.5 asks ProseMirror's `_root` for both getSelection()
 * and createRange(). A real ShadowRoot supplies the former in Chromium but not
 * the latter (createRange belongs to Document), so a selection-bearing Yjs
 * update otherwise throws after the editor has mounted successfully.
 *
 * Install the missing DocumentOrShadowRoot-compatible factory on this host's
 * own shadow root only. A document-created Range can address nodes in that
 * document's shadow trees, and leaving the shim on the root makes subsequent
 * provider/editor swaps safe without global prototype mutation.
 */
export function ensureCollaborationRangeFactory(element: HTMLElement): void {
  const root = element.getRootNode()
  if (!(root instanceof ShadowRoot)) return
  const rangeRoot = root as ShadowRoot & { createRange?: () => Range }
  if (typeof rangeRoot.createRange === 'function') return
  Object.defineProperty(rangeRoot, 'createRange', {
    configurable: true,
    value: () => root.ownerDocument.createRange(),
  })
}

/** Shell/story helper for a genuine in-process presence channel over a Y.Doc. */
export function createLiveAwareness(doc: unknown): Awareness {
  return new Awareness(doc as Y.Doc)
}

/**
 * Cursor decoration styles live beside the collaboration implementation so the
 * island-scanned host stays backend-token free while still styling decorations
 * inside its shadow root.
 */
export const collaborationCursorStyles = css`
  .editor-mount .ProseMirror > .ProseMirror-yjs-cursor:first-child {
    margin-top: 1rem;
  }
  .editor-mount .ProseMirror-yjs-cursor {
    position: relative;
    margin-left: -1px;
    margin-right: -1px;
    border-left: 2px solid currentColor;
    border-right: 1px solid currentColor;
    word-break: normal;
    pointer-events: none;
  }
  .editor-mount .ProseMirror-yjs-cursor > div {
    position: absolute;
    top: -1.35rem;
    left: -2px;
    z-index: 3;
    max-width: 14rem;
    overflow: hidden;
    padding: 2px 5px;
    border-radius: 3px 3px 3px 0;
    color: #fff;
    font: 600 11px/1.25 var(--mn-font-chrome, system-ui, sans-serif);
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }
  .editor-mount .ProseMirror-yjs-cursor[data-presence-followed='true'] {
    filter: drop-shadow(0 0 4px currentColor);
  }
  .editor-mount .ProseMirror-yjs-cursor[data-presence-followed='true'] > div {
    outline: 2px solid color-mix(in srgb, currentColor 45%, white);
    outline-offset: 1px;
  }
`

/**
 * Kernel extensions render inside the host's Shadow DOM, so their material
 * cannot rely on document-global CSS. Keep the extension-authored selectors
 * attached to the same collab-plane bridge as the live EditorView.
 *
 * Comment and citation material is intentionally richer in editor-host.ts;
 * these are the extension styles that otherwise had no in-shadow owner.
 */
export const editorSemanticStyles = css`
  ${unsafeCSS(wikilinkStyles)}
  ${unsafeCSS(tagChipStyles)}
`

/** What the live-editor factory needs to compose the CRDT plane. */
export interface LiveCollabEditorOptions {
  /** The element the live ProseMirror body mounts into (host-owned). */
  readonly element: HTMLElement
  /**
   * The shared CRDT doc — the contract's opaque `ProviderHandle.doc` (CrdtDoc =
   * unknown). The host passes it through UNTOUCHED; the concrete `as Y.Doc` cast
   * (the one place nucleus's opacity is resolved) lives HERE, inside the collab
   * plane — never in the top-level island-scanned host element.
   */
  readonly doc: unknown
  /** ProviderHandle.awareness; absent only in narrow direct-editor tests. */
  readonly awareness?: unknown
  /** Kernel seams (wikilink callbacks, enabledNodeTypes) — collaborative is forced ON here. */
  readonly kernel?: EditorKernelOptions
  /** Initial editing gate. Cached documents mount false until first live sync. */
  readonly editable?: boolean
}

/**
 * ProviderHandle keeps awareness opaque so nucleus stays independent from Yjs,
 * but the cursor plugin consumes a real event protocol. Validate the complete
 * operational surface before installing it: a merely truthy adapter must never
 * turn an otherwise healthy collaborative editor into an async mount failure.
 */
function isAwarenessProtocol(value: unknown): value is Awareness {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.on === 'function'
    && typeof candidate.off === 'function'
    && typeof candidate.getStates === 'function'
    && typeof candidate.getLocalState === 'function'
    && typeof candidate.setLocalStateField === 'function'
}

interface CollaborationCursorUser {
  readonly name?: unknown
  readonly color?: unknown
  readonly userId?: unknown
  readonly clientId?: unknown
  readonly deviceId?: unknown
  readonly type?: unknown
}

function cursorString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Preserve y-prosemirror's cursor presentation while carrying stable presence
 * identity into DOM. The shell can now follow an exact logical tab rather than
 * guessing from a duplicate display name or color.
 */
export function collaborationCursorBuilder(raw: unknown): HTMLElement {
  const user = raw && typeof raw === 'object' ? raw as CollaborationCursorUser : {}
  const name = cursorString(user.name) ?? 'Anonymous'
  const color = cursorString(user.color) ?? '#64748b'
  const cursor = document.createElement('span')
  cursor.classList.add('ProseMirror-yjs-cursor')
  // Keep remote decorations opaque to mobile IME word-boundary logic. Without
  // this, Gecko can treat the cursor label as editable text and double words
  // when autocorrect commits beside a collaborator cursor (OG 3c7d0662).
  cursor.setAttribute('contenteditable', 'false')
  cursor.style.borderColor = color
  const clientId = cursorString(user.clientId)
  const humanId = cursorString(user.userId)
  const deviceId = cursorString(user.deviceId)
  if (clientId) cursor.dataset.presenceClientId = clientId
  if (humanId) cursor.dataset.presenceHumanId = humanId
  if (deviceId) cursor.dataset.presenceDeviceId = deviceId
  cursor.dataset.presenceType = user.type === 'agent' ? 'agent' : 'human'

  const label = document.createElement('div')
  label.setAttribute('contenteditable', 'false')
  label.style.backgroundColor = color
  label.textContent = name
  cursor.append(label)
  return cursor
}

/**
 * Build a REAL collaborative TipTap Editor: the pure kernel roster (history
 * DROPPED via collaborative:true) + Collaboration bound to the doc's 'content'
 * fragment. One room-owned Yjs UndoManager records shared history; the stock
 * per-view yUndo plugin receives an inert lifecycle adapter.
 *
 * The caller (the host) owns the lifecycle — call `editor.destroy()` on teardown.
 */
export function createLiveCollabEditor(opts: LiveCollabEditorOptions): Editor {
  // THE opaque→concrete cast. ProviderHandle.doc is CrdtDoc (unknown); the shell
  // bound it to a real Y.Doc when it called CrdtBackend.open(). This is the one
  // sanctioned place to name that concretely (the collab plane), per the contract.
  const yDoc = opts.doc as Y.Doc
  ensureCollaborationRangeFactory(opts.element)
  const roomHistory = acquireRoomHistory(yDoc, COLLAB_FIELD)
  const viewUndo = createViewUndoAdapter(yDoc, COLLAB_FIELD)
  const awareness = isAwarenessProtocol(opts.awareness) ? opts.awareness : null
  const cursorExtension = awareness
    ? Extension.create({
        name: 'shrubberyCollaborationCursor',
        addProseMirrorPlugins() {
          return [yCursorPlugin(awareness, { cursorBuilder: collaborationCursorBuilder })]
        },
      })
    : null
  // Collaboration has priority 1000. Priority 900 deliberately sorts this
  // extension immediately after it, so TipTap's command reduction replaces the
  // stock view-local undo/redo commands with the room authority below. The
  // Collaboration keymap still calls editor.commands.undo/redo, so keyboard and
  // toolbar paths converge on the same commands.
  const roomHistoryExtension = Extension.create({
    name: 'shrubberyRoomHistory',
    priority: 900,
    addCommands() {
      return {
        undo:
          () =>
          ({ tr, dispatch }) => {
            tr.setMeta('preventDispatch', true)
            if (!roomHistory.manager.canUndo()) return false
            if (!dispatch) return true
            roomHistory.manager.undo()
            return true
          },
        redo:
          () =>
          ({ tr, dispatch }) => {
            tr.setMeta('preventDispatch', true)
            if (!roomHistory.manager.canRedo()) return false
            if (!dispatch) return true
            roomHistory.manager.redo()
            return true
          },
      }
    },
  })

  let editor: Editor
  try {
    editor = new Editor({
      element: opts.element,
      editable: opts.editable ?? true,
      extensions: [
        // History DROPPED here (collaborative:true ⇒ StarterKit undoRedo:false).
        ...kernelExtensions({ ...opts.kernel, collaborative: true }),
        // Keep Collaboration's sync/mapping machinery, but its view-local
        // UndoManager is inert: roomHistoryExtension is the recording authority.
        Collaboration.configure({
          document: yDoc,
          field: COLLAB_FIELD,
          yUndoOptions: { undoManager: viewUndo.manager },
        }),
        roomHistoryExtension,
        ...(cursorExtension ? [cursorExtension] : []),
      ],
    })
  } catch (error) {
    viewUndo.dispose()
    roomHistory.release()
    throw error
  }

  const destroyEditor = editor.destroy.bind(editor)
  let destroyed = false
  editor.destroy = () => {
    if (destroyed) return
    destroyed = true
    try {
      destroyEditor()
    } finally {
      viewUndo.dispose()
      roomHistory.release()
    }
  }
  return editor
}
