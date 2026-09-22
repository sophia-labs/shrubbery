/**
 * room-history.ts — one recording undo authority per live collaboration room.
 *
 * A TipTap EditorView is an attachment to a room, not the owner of that room's
 * document history.  Stock @tiptap/extension-collaboration creates one Yjs
 * UndoManager per view.  When two views share a Y.Doc, both managers observe
 * every local ySync transaction; alternating undo/redo then operates two
 * competing stacks over one document and can lose the redo branch.
 *
 * This registry moves the recording authority to the room identity
 * (Y.Doc + fragment field).  EditorViews acquire leases on that authority.  A
 * surviving view keeps the same stack; the final release destroys the manager
 * and removes the listener Y.UndoManager otherwise leaves on the document.
 */

import * as Y from 'yjs'
import {
  defaultDeleteFilter,
  defaultProtectedNodes,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'

type DestroyListener = (doc: Y.Doc) => void

interface RoomHistoryEntry {
  readonly doc: Y.Doc
  readonly field: string
  readonly manager: Y.UndoManager
  readonly docDestroyListeners: readonly DestroyListener[]
  references: number
}

/** Weak outer ownership ensures this registry can never keep a Y.Doc alive. */
const ROOM_HISTORIES = new WeakMap<Y.Doc, Map<string, RoomHistoryEntry>>()

function destroyListeners(doc: Y.Doc): Set<DestroyListener> {
  const listeners = doc._observers.get('destroy') as Set<DestroyListener> | undefined
  return new Set(listeners ?? [])
}

function removeManagerDestroyListeners(entry: {
  readonly doc: Y.Doc
  readonly docDestroyListeners: readonly DestroyListener[]
}): void {
  for (const listener of entry.docDestroyListeners) {
    entry.doc.off('destroy', listener)
  }
}

function createRecordingManager(doc: Y.Doc, field: string): RoomHistoryEntry {
  const listenersBefore = destroyListeners(doc)
  const manager = new Y.UndoManager(doc.getXmlFragment(field), {
    // ySyncPluginKey is the origin used by every ProseMirror attachment bound
    // through ySyncPlugin. Provider/network origins remain outside local undo.
    trackedOrigins: new Set([ySyncPluginKey]),
    // Match y-tiptap's own history policy rather than silently changing which
    // structural deletions and addToHistory:false transactions are captured.
    deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
    captureTransaction: (transaction) => transaction.meta.get('addToHistory') !== false,
  })
  const listenersAfter = destroyListeners(doc)
  const addedListeners = [...listenersAfter].filter((listener) => !listenersBefore.has(listener))
  return {
    doc,
    field,
    manager,
    docDestroyListeners: addedListeners,
    references: 0,
  }
}

export interface RoomHistoryLease {
  /** The sole recording manager for this Y.Doc + field while leases exist. */
  readonly manager: Y.UndoManager
  /** Idempotent attachment release. */
  release(): void
}

/**
 * Acquire one EditorView attachment to room-owned history.
 *
 * The final release is the history lifecycle boundary.  In production this is
 * aligned with the editor-room pool's final attachment/provider release.
 */
export function acquireRoomHistory(doc: Y.Doc, field: string): RoomHistoryLease {
  let byField = ROOM_HISTORIES.get(doc)
  if (!byField) {
    byField = new Map()
    ROOM_HISTORIES.set(doc, byField)
  }

  let entry = byField.get(field)
  if (!entry) {
    entry = createRecordingManager(doc, field)
    byField.set(field, entry)
  }
  entry.references += 1

  let released = false
  return {
    manager: entry.manager,
    release() {
      if (released) return
      released = true
      entry.references -= 1
      if (entry.references > 0) return

      byField.delete(field)
      if (byField.size === 0) ROOM_HISTORIES.delete(doc)
      entry.manager.destroy()
      removeManagerDestroyListeners(entry)
    },
  }
}

export interface ViewUndoAdapter {
  /** Passed only to TipTap's required per-view yUndo plugin. Never records. */
  readonly manager: Y.UndoManager
  /** Removes the document destroy listener Y.UndoManager.destroy() omits. */
  dispose(): void
}

/**
 * TipTap's Collaboration extension requires a yUndo plugin for mapping and
 * lifecycle bookkeeping. Give each view an inert manager so that plugin remains
 * structurally intact without becoming a second history authority.
 */
export function createViewUndoAdapter(doc: Y.Doc, field: string): ViewUndoAdapter {
  const listenersBefore = destroyListeners(doc)
  const manager = new Y.UndoManager(doc.getXmlFragment(field), {
    captureTransaction: () => false,
  })
  const listenersAfter = destroyListeners(doc)
  const addedListeners = [...listenersAfter].filter((listener) => !listenersBefore.has(listener))
  let disposed = false

  return {
    manager,
    dispose() {
      if (disposed) return
      disposed = true
      // TipTap normally destroys this manager with its plugin view. Calling
      // destroy again is harmless and also covers partially constructed Editors.
      manager.destroy()
      removeManagerDestroyListeners({ doc, docDestroyListeners: addedListeners })
    },
  }
}
