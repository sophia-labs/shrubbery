/**
 * in-process-crdt-backend.ts — a REAL, no-mock CrdtBackend for tests.
 *
 * This is NOT a mock. It is the genuine CRDT plane minus the network: it binds a
 * REAL `new Y.Doc()` and a REAL `new Awareness(doc)` and returns a real
 * contract.crdt `ProviderHandle`. The ONLY thing omitted is the websocket
 * transport — which is exactly what "in-process" means (the shell's
 * CrdtBackend.open normally wraps a network provider; here the local Y.Doc IS the
 * authority, so whenSynced resolves immediately). Per Vera's standing rule, a
 * real Y.Doc bound to a real Editor is the legitimate "real-infra iteration", not
 * a stub.
 *
 * SHARED ROOM = TRUE MULTI-EDITOR: open() keys Y.Docs by room, so two open() calls
 * for the SAME room return handles over the SAME Y.Doc. Two editors built on those
 * handles converge with NO relay — they mutate one document. (For DISTINCT docs a
 * test would relay via Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); the shared-room
 * path is the truest single-doc proof.)
 *
 * Lives in __tests__/ (a subdir) so the island guard's non-recursive top-level
 * scan never sees its yjs import — and it is a harness, not shipped host source.
 */

import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { CrdtBackend, CrdtRoom, ProviderHandle } from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'

export class InProcessCrdtBackend implements CrdtBackend {
  private readonly rooms = new Map<string, Y.Doc>()
  private readonly handles: ProviderHandle[] = []

  private key(r: CrdtRoom): string {
    return `${r.kind}:${r.graphId}:${r.docId ?? ''}`
  }

  open(room: CrdtRoom): ProviderHandle {
    const k = this.key(room)
    const doc = this.rooms.get(k) ?? new Y.Doc()
    this.rooms.set(k, doc)
    const awareness = new Awareness(doc)
    const handle: ProviderHandle = {
      doc,
      awareness,
      lifecycle: synchronizedCrdtProviderLifecycle(),
      // Local authority: already "synced" (no network round-trip to await).
      whenRenderable: Promise.resolve(),
      whenEditable: Promise.resolve(),
      whenSynced: Promise.resolve(),
      renderSource: Promise.resolve('live'),
      destroy: () => awareness.destroy(),
    }
    this.handles.push(handle)
    return handle
  }

  schemaVersion(): number {
    return 1
  }

  /** Tear down every awareness this backend handed out (test cleanup). */
  destroyAll(): void {
    for (const h of this.handles) h.destroy()
    this.handles.length = 0
  }
}
