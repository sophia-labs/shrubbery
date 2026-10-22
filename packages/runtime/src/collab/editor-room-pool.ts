/**
 * editor-room-pool.ts — CANONICAL home of `EditorRoomPool` (hoisted from
 * apps/organism/src/cell/editor-room-pool.ts @ c034154, verbatim, to make it
 * reachable from packages/runtime/src/layout/faces/hoja-document-face.ts).
 *
 * WHY HOISTED: the layout-as-data design doc (plans/shrubbery-layout-as-data-
 * design-20260716.md §4.1, §9.2 Phase 2) requires `hoja.document`'s
 * DurableResourceAdapter to WRAP this exact pool ("do not duplicate its
 * key/refcount logic"). It previously lived only in apps/organism — an app
 * cannot be imported by a package — so a P2 face module had no legal way to
 * reuse it without either reimplementing it (forbidden) or reaching across
 * app/package boundaries (wrong layering). This file is the single source of
 * truth now; `apps/organism/src/cell/editor-room-pool.ts` is a thin re-export
 * shim so organism's existing import path and tests are untouched.
 *
 * Lives in `collab/` (not top-level `src/`) because it is CRDT-plane code:
 * top-level `packages/runtime/src/*.ts` is scanned by the ISLAND guard
 * (render-workspace-island.test.ts, non-recursive `readdirSync`) and forbids
 * the literal token `CrdtBackend`, which this file's `ProviderFactory` alias
 * necessarily names. `collab/` is the existing, established quarantine
 * subdir for exactly this kind of code (see `collab/live-editor.ts`).
 *
 * Logic is UNCHANGED from the organism original — see its own history for
 * provenance. Only this header comment and the module's new address differ.
 */
import type { CrdtBackend, CrdtRoom, ProviderHandle } from '@shrubbery/nucleus'

/** Canonical, content-free identity for a live CRDT workload. */
export type EditorRoomKey = string

export interface EditorRoomLease {
  /**
   * One CALLER-DEFINED claim's lifetime. Unique while the lease is live.
   * Historically ("pane-to-location") this was one attachment per visible
   * pane, acquired directly by organism's `main.ts`. A caller with its OWN
   * independent ref-counting layer on top MAY instead take a single, stable
   * attachment representing its WHOLE claim on this room and share it across
   * many of its own logical consumers — this is exactly what the
   * layout-as-data `LayoutResourceBroker` does for `hoja.document`
   * (`hoja-document-face.ts`'s resource adapter): it acquires ONE pool
   * attachment per resourceKey (on first layout-lease acquire) and shares
   * `EditorRoomLease.provider` across every layout leaf that references the
   * same document, while the BROKER's own `durableRefCounts` — not this
   * pool's `attachmentIds`/`refCount` — is the accurate "how many panes have
   * this document open" count for THOSE callers. `hoja-document-face.test.ts`
   * ("two leaves on the same document share ONE exact provider") pins this
   * exact composed relationship: pool refCount stays 1 across N layout
   * leaves; broker refCount tracks the real N. Read whichever layer answers
   * the question you're actually asking.
   */
  readonly attachmentId: string
  readonly roomKey: EditorRoomKey
  readonly provider: ProviderHandle
  readonly released: boolean
  /**
   * Idempotent. The last release destroys the room provider exactly once: at once if it has synced,
   * else after its first sync or `UNSYNCED_ROOM_LINGER_MS`, so edits made before the handshake still reach the cell.
   */
  release(): void
}

export interface EditorRoomDiagnostic {
  readonly roomKey: EditorRoomKey
  readonly kind: CrdtRoom['kind']
  readonly graphId: string
  readonly documentId: string | null
  readonly refCount: number
  readonly attachmentIds: readonly string[]
}

export interface EditorRoomPoolSnapshot {
  readonly roomCount: number
  readonly attachmentCount: number
  readonly rooms: readonly EditorRoomDiagnostic[]
}

interface RoomEntry {
  readonly room: CrdtRoom
  readonly provider: ProviderHandle
  readonly attachmentIds: Set<string>
  /** Set while a released, never-synced room waits for its first sync; calling it cancels the wait. */
  lingering: (() => void) | null
}

/**
 * How long a released room that never synced keeps its socket, waiting to send what was done in it.
 * The cell answers a room only once it holds the graph's persistence lease, which a long write can hold
 * for minutes (WB-DROP, 2026-10-22); past this the room is let go and its unsent edits with it.
 */
export const UNSYNCED_ROOM_LINGER_MS = 15 * 60_000

interface LeaseState {
  readonly attachmentId: string
  readonly roomKey: EditorRoomKey
  readonly provider: ProviderHandle
  released: boolean
}

type ProviderFactory = Pick<CrdtBackend, 'open'>

function normalizeRoom(room: CrdtRoom): CrdtRoom {
  if (!room.graphId) throw new Error('EditorRoomPool: graphId must not be empty')
  if (room.kind === 'doc') {
    if (!room.docId) throw new Error('EditorRoomPool: doc room requires a docId')
    return { kind: 'doc', graphId: room.graphId, docId: room.docId }
  }
  return { kind: 'workspace', graphId: room.graphId }
}

export function editorRoomKey(room: CrdtRoom): EditorRoomKey {
  const normalized = normalizeRoom(room)
  return JSON.stringify([
    normalized.kind,
    normalized.graphId,
    normalized.kind === 'doc' ? normalized.docId : null,
  ])
}

/**
 * Browser-session room ownership for the editor multiplexer.
 *
 * A pane owns an attachment lease, never a socket. All attachments resolving to
 * the same room receive the exact same ProviderHandle/Y.Doc/awareness instance.
 * This prevents duplicate local presence identities while allowing multiple
 * pane-local TipTap EditorViews over one document.
 */
export class EditorRoomPool {
  private readonly rooms = new Map<EditorRoomKey, RoomEntry>()
  private readonly leases = new Map<string, LeaseState>()

  constructor(private readonly backend: ProviderFactory) {}

  acquire(room: CrdtRoom, attachmentId: string): EditorRoomLease {
    if (!attachmentId) throw new Error('EditorRoomPool: attachmentId must not be empty')
    if (this.leases.has(attachmentId)) {
      throw new Error(`EditorRoomPool: attachment "${attachmentId}" is already live`)
    }

    const normalized = normalizeRoom(room)
    const roomKey = editorRoomKey(normalized)
    let entry = this.rooms.get(roomKey)
    if (!entry) {
      // Insert only after open succeeds so a failed backend attempt cannot leave
      // a phantom room or reference count behind.
      const provider = this.backend.open(normalized, undefined)
      entry = { room: normalized, provider, attachmentIds: new Set(), lingering: null }
      this.rooms.set(roomKey, entry)
    }
    // Coming back to a room still waiting to sync takes it up again, edits and all.
    entry.lingering?.()
    entry.lingering = null

    const state: LeaseState = {
      attachmentId,
      roomKey,
      provider: entry.provider,
      released: false,
    }
    entry.attachmentIds.add(attachmentId)
    this.leases.set(attachmentId, state)

    const pool = this
    return {
      attachmentId,
      roomKey,
      provider: entry.provider,
      get released() { return state.released },
      release() { pool.release(state) },
    }
  }

  snapshot(): EditorRoomPoolSnapshot {
    const rooms = [...this.rooms.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([roomKey, entry]): EditorRoomDiagnostic => ({
        roomKey,
        kind: entry.room.kind,
        graphId: entry.room.graphId,
        documentId: entry.room.kind === 'doc' ? entry.room.docId ?? null : null,
        refCount: entry.attachmentIds.size,
        attachmentIds: [...entry.attachmentIds].sort(),
      }))
    return {
      roomCount: rooms.length,
      attachmentCount: this.leases.size,
      rooms,
    }
  }

  /** Contract replacement / shell shutdown escape hatch. */
  destroyAll(): void {
    for (const lease of this.leases.values()) lease.released = true
    this.leases.clear()
    const entries = [...this.rooms.values()]
    this.rooms.clear()

    let firstError: unknown = null
    for (const entry of entries) {
      entry.lingering?.()
      entry.lingering = null
      try {
        entry.provider.destroy()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  private release(state: LeaseState): void {
    if (state.released) return
    state.released = true
    if (this.leases.get(state.attachmentId) === state) {
      this.leases.delete(state.attachmentId)
    }

    const entry = this.rooms.get(state.roomKey)
    if (!entry) return
    entry.attachmentIds.delete(state.attachmentId)
    if (entry.attachmentIds.size > 0) return

    // A room that never synced still holds everything done in it: y-websocket sends local edits
    // only in the handshake. Keep it until that handshake, or the linger bound, has passed.
    if (!entry.provider.lifecycle.get().synchronized) {
      this.linger(state.roomKey, entry)
      return
    }
    this.retire(state.roomKey, entry)
  }

  private linger(roomKey: EditorRoomKey, entry: RoomEntry): void {
    let unsubscribe: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let waiting = true
    const cancel = (): void => {
      waiting = false
      unsubscribe()
      clearTimeout(timer)
    }
    const done = (): void => {
      if (!waiting) return
      cancel()
      if (entry.lingering === cancel) entry.lingering = null
      if (this.rooms.get(roomKey) === entry && entry.attachmentIds.size === 0) this.retire(roomKey, entry)
    }
    entry.lingering = cancel
    unsubscribe = entry.provider.lifecycle.subscribe((lifecycle) => { if (lifecycle.synchronized) done() })
    if (!waiting) unsubscribe()
    timer = waiting ? setTimeout(done, UNSYNCED_ROOM_LINGER_MS) : undefined
    // The handshake may have finished between the check and the subscription.
    if (entry.provider.lifecycle.get().synchronized) done()
  }

  private retire(roomKey: EditorRoomKey, entry: RoomEntry): void {
    entry.lingering?.()
    entry.lingering = null
    // Remove before invoking foreign teardown code. Even if destroy throws, the
    // pool cannot double-destroy this provider on a later cleanup pass.
    this.rooms.delete(roomKey)
    entry.provider.destroy()
  }
}
