/**
 * workspace-follow.ts — the tree follows the workspace.
 *
 * The shell's tree is a SPARQL projection read from its local copy of the workspace (SourceMirrorRuntime's
 * complete pull). A write made anywhere else (Sophia's chat writing a document, vehicle-host's conversation
 * mirror, another tab or person, an MCP client) reached that copy only at the next activation, one of this
 * page's own writes, an `online` event, or a reload.
 *
 * The cell already says when its workspace changes: every workspace write, the executor's (MCP tools, REST)
 * and every client's, is broadcast on the graph's workspace room (`/hocuspocus/workspace/{graph}`, gardend's
 * `update_doc`: "collaborators see API writes live"). Garden's own sidebar is built on that room, and this
 * shell already holds it open (custom CSS, artifact previews) through the shared EditorRoomPool, so watching
 * it costs no new connection. This module watches the room's `documents`, `folders` and `artifacts` maps for
 * a change the tree shows (an entry arriving or leaving; its name, place, order, kind or trash state), not a
 * body write (which moves only `updatedAt`), coalesces a burst into one call, and holds it while the page is
 * hidden. The shell then brings its copy up to date and reads the tree again.
 */

import type { EditorRoomPool } from '@shrubbery/runtime'
import type { AuthProvider } from '@shrubbery/nucleus'
import type { Doc, Map as YMap, Transaction, YEvent } from 'yjs'

/** The workspace maps the tree is made of. */
export const WORKSPACE_TREE_MAPS: readonly string[] = Object.freeze(['documents', 'folders', 'artifacts'])

/**
 * Entry fields the tree never shows: a body write moves `updatedAt`, a description and a canvas's projection
 * are read when the thing is opened.
 */
export const WORKSPACE_FIELDS_NOT_IN_TREE: ReadonlySet<string> = new Set([
  'updatedAt',
  'description',
  'describedAt',
  'snapshotAt',
  'contentOperationId',
  'sceneProjection',
  'sceneProjectionText',
  'sceneProjectedAt',
])

/** The origin LoopbackCrdtBackend and GatewayCrdtBackend give the snapshot applied before the room connects. */
const SNAPSHOT_PREFLIGHT_ORIGIN = 'workspace-snapshot-preflight'

function sameValue(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null) return false
  try {
    return JSON.stringify(before) === JSON.stringify(after)
  } catch {
    return false
  }
}

/**
 * Does one observed change to a tree map change what the tree shows? Values are compared, not only keys:
 * gardend files a written document again with its unchanged title, section and place (`write_document` →
 * `workspace.createDocument`), so a body write sets those keys to the values they had.
 */
// biome-ignore lint/suspicious/noExplicitAny: Y.Map#observeDeep hands YEvent<any>.
export function treeChangeIn(events: readonly YEvent<any>[], transaction: Pick<Transaction, 'local' | 'origin'>): boolean {
  // This page's own direct edits, and the snapshot it opened with, are already read.
  if (transaction.local || transaction.origin === SNAPSHOT_PREFLIGHT_ORIGIN) return false
  for (const event of events) {
    const path = event.path
    // The map itself: an entry arrived, left or was replaced.
    if (path.length === 0) return true
    if (path.length === 1) {
      // The fields of one entry.
      const entry = event.target as unknown as Partial<Pick<YMap<unknown>, 'get'>>
      if (typeof entry.get !== 'function') return true
      for (const [key, change] of event.changes.keys) {
        if (WORKSPACE_FIELDS_NOT_IN_TREE.has(key)) continue
        if (change.action !== 'update' || !sameValue(change.oldValue, entry.get(key))) return true
      }
      continue
    }
    // Deeper (a nested value inside one field): only a hidden field's own content is skipped.
    const field = path[1]
    if (typeof field !== 'string' || !WORKSPACE_FIELDS_NOT_IN_TREE.has(field)) return true
  }
  return false
}

/** The entries (ids) an observed change touched: the keys of the map itself, or the entry a field belongs to. */
// biome-ignore lint/suspicious/noExplicitAny: Y.Map#observeDeep hands YEvent<any>.
export function touchedEntries(events: readonly YEvent<any>[]): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.path.length === 0) {
      for (const key of event.changes.keys.keys()) ids.add(key)
    } else if (typeof event.path[0] === 'string') {
      ids.add(event.path[0])
    }
  }
  return [...ids]
}

/** What the room says now about one document or folder a change touched: what the tree should show. */
export interface TreeExpectation {
  readonly id: string
  readonly kind: 'document' | 'folder'
  /** In the tree; false when removed or in the Trash. */
  readonly present: boolean
  readonly label?: string
  readonly parentId?: string | null
}

/** One followed change: the documents and folders it touched, as the room has them at the moment of asking. */
export interface TreeChange {
  expectations(): readonly TreeExpectation[]
}

/** Read a touched entry out of the room (a workspace entry is a Y.Map of fields). */
export function treeExpectations(doc: Doc, touched: ReadonlyMap<'documents' | 'folders', ReadonlySet<string>>): TreeExpectation[] {
  const out: TreeExpectation[] = []
  for (const [map, ids] of touched) {
    const entries = doc.getMap<unknown>(map)
    const kind = map === 'documents' ? 'document' : 'folder'
    for (const id of ids) {
      const entry = entries.get(id) as Partial<Pick<YMap<unknown>, 'get'>> | undefined
      if (!entry || typeof entry.get !== 'function') {
        out.push({ id, kind, present: false })
        continue
      }
      const label = entry.get(kind === 'document' ? 'title' : 'name')
      const parentId = entry.get('parentId')
      out.push({
        id,
        kind,
        present: entry.get('trashed') !== true,
        ...(typeof label === 'string' ? { label } : {}),
        parentId: typeof parentId === 'string' && parentId ? parentId : null,
      })
    }
  }
  return out
}

/** Does a tree show each expectation? `node(id)` finds the tree's node of that id (a document or a folder). */
export function treeShows(
  expectations: readonly TreeExpectation[],
  node: (id: string) => { readonly label: string; readonly parentId?: string | null } | null,
): boolean {
  for (const expected of expectations) {
    const found = node(expected.id)
    if (!expected.present) {
      if (found) return false
      continue
    }
    if (!found) return false
    if (expected.label !== undefined && found.label !== expected.label) return false
    if (expected.parentId !== undefined && (found.parentId ?? null) !== expected.parentId) return false
  }
  return true
}

/** The page's visibility, as `document` gives it (absent in Node: always visible). */
export interface FollowVisibility {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface WorkspaceFollowOptions {
  readonly pool: Pick<EditorRoomPool, 'acquire'>
  readonly auth: Pick<AuthProvider, 'whenReady'>
  readonly graphId: string
  /**
   * The tree changed in the workspace room (one call per burst). Resolve true once the tree shows it, false
   * when it does not yet: the call is made again after each of `confirmDelaysMs` until it does.
   */
  readonly onChange: (change: TreeChange) => boolean | Promise<boolean>
  /** Quiet time a burst is given to finish (default 250 ms). */
  readonly settleMs?: number
  /** The longest a steady stream of changes waits (default 1500 ms). */
  readonly maxWaitMs?: number
  /**
   * Waits before asking again when the tree does not show the change yet (default 1, 2 and 4 s). gardend
   * broadcasts a workspace write once its Y.Doc is durable and writes the tree's projection just after, so a
   * pull in between brings the new workspace with the old tree.
   */
  readonly confirmDelaysMs?: readonly number[]
  /** Default: `document` when there is one. */
  readonly visibility?: FollowVisibility | null
  /** Told when the room cannot be watched (the tree then follows only this page's own writes, as before). */
  readonly unavailable?: (error: unknown) => void
}

let nextFollowLease = 0

/**
 * Watch the graph's workspace room and call `onChange` when the tree changes there. Returns the stop
 * function (idempotent): it releases the room lease and clears any pending call.
 */
export function followWorkspaceTree(opts: WorkspaceFollowOptions): () => void {
  const settleMs = Math.max(0, opts.settleMs ?? 250)
  const maxWaitMs = Math.max(settleMs, opts.maxWaitMs ?? 1500)
  const confirmDelaysMs = opts.confirmDelaysMs ?? [1000, 2000, 4000]
  const visibility = opts.visibility === undefined
    ? (typeof document === 'undefined' ? null : document)
    : opts.visibility
  let closed = false
  let release: (() => void) | null = null
  let room: Doc | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstHintAt: number | null = null
  let heldWhileHidden = false
  /** The documents and folders touched since the tree last showed every change (kept until it does). */
  let touched = new Map<'documents' | 'folders', Set<string>>()
  /** Bumped by every change: an answer about an older one is not the last word. */
  let generation = 0

  const hidden = (): boolean => visibility?.visibilityState === 'hidden'

  const ask = async (attempt: number): Promise<void> => {
    timer = null
    firstHintAt = null
    if (closed) return
    if (hidden()) {
      heldWhileHidden = true
      return
    }
    const asked = generation
    const pending = touched
    const doc = room
    let shown = true
    try {
      shown = await opts.onChange({ expectations: () => (doc ? treeExpectations(doc, pending) : []) })
    } catch {
      // The shell's to handle; the watch goes on.
    }
    if (closed || asked !== generation) return
    if (shown) {
      touched = new Map()
      return
    }
    const delay = confirmDelaysMs[attempt]
    if (delay === undefined) {
      // Asked enough: the next change asks again, with these entries still in the question.
      return
    }
    timer = setTimeout(() => void ask(attempt + 1), delay)
  }

  const hint = (map: string, ids: readonly string[]): void => {
    if (closed) return
    generation += 1
    if (map === 'documents' || map === 'folders') {
      const set = touched.get(map) ?? new Set<string>()
      touched.set(map, set)
      for (const id of ids) set.add(id)
    }
    const now = Date.now()
    firstHintAt ??= now
    if (timer) clearTimeout(timer)
    const wait = Math.min(settleMs, Math.max(0, firstHintAt + maxWaitMs - now))
    timer = setTimeout(() => void ask(0), wait)
  }

  const onVisibility = (): void => {
    if (closed || hidden() || !heldWhileHidden) return
    heldWhileHidden = false
    void ask(0)
  }
  visibility?.addEventListener('visibilitychange', onVisibility)

  void opts.auth.whenReady().then(() => {
    if (closed) return
    const lease = opts.pool.acquire({ kind: 'workspace', graphId: opts.graphId }, `workspace-follow-${++nextFollowLease}`)
    const doc = lease.provider.doc as Doc
    room = doc
    const observers = WORKSPACE_TREE_MAPS.map(name => {
      const map = doc.getMap(name)
      // biome-ignore lint/suspicious/noExplicitAny: Y.Map#observeDeep hands YEvent<any>.
      const observer = (events: YEvent<any>[], transaction: Transaction): void => {
        if (treeChangeIn(events, transaction)) hint(name, touchedEntries(events))
      }
      map.observeDeep(observer)
      return () => map.unobserveDeep(observer)
    })
    release = () => {
      for (const unobserve of observers) unobserve()
      lease.release()
    }
  }).catch(error => {
    if (!closed) opts.unavailable?.(error)
  })

  return () => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    timer = null
    visibility?.removeEventListener('visibilitychange', onVisibility)
    release?.()
    release = null
    room = null
  }
}
