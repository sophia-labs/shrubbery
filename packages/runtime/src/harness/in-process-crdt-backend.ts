/**
 * Browser-safe, transport-free CRDT backend for app harnesses.
 *
 * This is the production contract shape with only the network hop removed: every
 * room is backed by a real Y.Doc, every opened handle owns a real Awareness
 * instance, and local authority is synchronously considered synced. Keeping this
 * outside __tests__ lets an app-level Playwright harness exercise the exact
 * ProviderHandle consumed by <sh-editor-host> without importing test modules.
 */

import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type {
  CrdtBackend,
  CrdtDoc,
  CrdtRoom,
  ProviderHandle,
} from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'

export interface InProcessCrdtBackendOptions {
  readonly userId?: string
  readonly presenceColor?: string
}

function roomKey(room: CrdtRoom): string {
  if (room.kind === 'doc' && !room.docId) {
    throw new Error('InProcessCrdtBackend: doc room requires a docId')
  }
  return `${room.kind}:${room.graphId}:${room.docId ?? ''}`
}

export class InProcessCrdtBackend implements CrdtBackend {
  private readonly rooms = new Map<string, Y.Doc>()
  private readonly handles = new Set<ProviderHandle>()

  constructor(private readonly options: InProcessCrdtBackendOptions = {}) {}

  open(room: CrdtRoom, suppliedDoc?: CrdtDoc): ProviderHandle {
    const key = roomKey(room)
    const supplied = suppliedDoc instanceof Y.Doc ? suppliedDoc : null
    const doc = this.rooms.get(key) ?? supplied ?? new Y.Doc()
    this.rooms.set(key, doc)

    const awareness = new Awareness(doc)
    awareness.setLocalStateField('user', {
      name: this.options.userId?.trim() || 'browser-harness',
      color: this.options.presenceColor ?? '#2563eb',
    })

    let destroyed = false
    const handle: ProviderHandle = {
      doc,
      awareness,
      lifecycle: synchronizedCrdtProviderLifecycle(),
      whenRenderable: Promise.resolve(),
      whenEditable: Promise.resolve(),
      whenSynced: Promise.resolve(),
      renderSource: Promise.resolve('live'),
      destroy: () => {
        if (destroyed) return
        destroyed = true
        awareness.destroy()
        this.handles.delete(handle)
      },
    }
    this.handles.add(handle)
    return handle
  }

  schemaVersion(): number {
    return 1
  }

  /** Read-only test/harness inspection; callers cannot replace room authority. */
  roomDocument(room: CrdtRoom): Y.Doc | undefined {
    return this.rooms.get(roomKey(room))
  }

  roomCount(): number {
    return this.rooms.size
  }

  destroyAll(): void {
    for (const handle of [...this.handles]) handle.destroy()
    for (const doc of this.rooms.values()) doc.destroy()
    this.rooms.clear()
  }
}
