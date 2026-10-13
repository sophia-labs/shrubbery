/**
 * The pure core of the shell's intent journal ("every change is announced once and can be undone from
 * the announcement"). The organism-cell wrapper (`files-intent-journal.ts`, wave 2) adds the status
 * message and the shell handler; this is the part that can be tested in node: the inverse of each
 * intent, and the undo/redo discipline.
 *
 * Undo is intent-level. After each successful apply the shell records the intent it applied and the
 * intents that undo it; `undo()` hands those inverses back to the shell's handler as one atomic batch,
 * and the entry moves to the redo side. It is session-local and never a Yjs `UndoManager`, which would
 * undo other people's work.
 *
 * Inverses:
 *   place    <-> place (the previous records; a card that was auto-slotted is restored at its old slot)
 *   move     <-> move (one batch per previous parent folder)
 *   rename   <-> rename (the previous name)
 *   create   <-> remove (the folder it made); redo of a create is a restore, not a second create
 *   add      <-> remove (the files it imported); redo is a restore
 *   remove   <-> restore (the shell's Removed area)
 *   connect  <-> disconnect (the connection it made, by id); redo is a `restore-connection` of that very connection
 *   disconnect <-> restore-connection (the connection it removed, whole)
 *
 * A connection is put back, never made twice. Redoing a connect would otherwise mint a new connection
 * with a new id, and the inverse recorded for the first one (disconnect that id) would be stale from
 * then on: undo, redo, undo would leave the second connection standing while announcing that it was
 * undone. So the shell reports the whole record it made (or removed), and redo of a connect and the
 * inverse of a disconnect are `restore-connection`: the connection comes back with the same id, the
 * same state (proposed, endorsed...) and the same attribution, and every inverse recorded for it stays
 * true however often it is undone and redone.
 *
 * `choose-placement` is the one deliberate exception to "every change has an inverse" (DESIGN section
 * 5, the intent journal: "not undoable, it settles a contest; say so in the message"): it settles a
 * contest between positions that were each somebody's decision, and what lost is not kept. The journal
 * holds it as a barrier, so Undo does not reach past it to an older change, and the shell says so in
 * its message. Every other edit has an inverse, given what the shell knew before it applied the change
 * (`PriorState`). A refused inverse (the file moved elsewhere since) is reported, honestly, and changes
 * nothing.
 */
import type {
  FileCanvasConnection, FileCanvasIntent, FileKey, FilePlacementRecord, WorkspaceFileRef,
} from '../folder-view-contract.js'
import { fileKey } from '../folder-view-contract.js'

/** What the journal hands back to the shell: a canvas intent, or a restore of something the shell holds (a removed file, a removed connection). */
export type JournalIntent =
  | FileCanvasIntent
  | { readonly kind: 'restore'; readonly files: readonly WorkspaceFileRef[] }
  /** Put a connection back exactly as it was: the same id, state and attribution. The shell refuses it if the id is taken or a card of it has gone. */
  | { readonly kind: 'restore-connection'; readonly connection: FileCanvasConnection }

/** What the shell knew before it applied a forward intent: just enough to write its inverse. */
export interface PriorState {
  /** Previous placement of each moved file, as a record; an auto-slotted card's record sits at its old slot. */
  readonly placements?: ReadonlyMap<FileKey, FilePlacementRecord>
  /** Previous parent folder of each moved file (null: the root). */
  readonly parents?: ReadonlyMap<FileKey, WorkspaceFileRef | null>
  readonly names?: ReadonlyMap<FileKey, string>
  /** The folder a `create` made, and the files an `add` imported (known only after the apply). */
  readonly created?: WorkspaceFileRef
  readonly added?: readonly WorkspaceFileRef[]
  /**
   * The whole connection record: the one a `connect` made (known only after the apply) or the one a `disconnect` removed (known before it).
   * Whole, because undo and redo put it back as it was, not as a new connection with the same ends.
   */
  readonly connection?: FileCanvasConnection
}

export interface Inversion {
  readonly inverse: readonly JournalIntent[]
  /** What redo applies: the forward intent, except where replaying it would not mean the same thing. */
  readonly redo: readonly JournalIntent[]
}

/** The intents that change a folder; everything else (select, open, menu, undo...) is not journaled. */
export function isEdit(intent: FileCanvasIntent): boolean {
  return ['place', 'move', 'rename', 'create', 'add', 'remove', 'connect', 'disconnect', 'choose-placement'].includes(intent.kind)
}

/** The inversion of an applied edit, or null when it cannot be undone (or the prior state is incomplete). */
export function invert(forward: FileCanvasIntent, prior: PriorState): Inversion | null {
  switch (forward.kind) {
    case 'place': {
      const records: FilePlacementRecord[] = []
      for (const p of forward.placements) {
        const before = prior.placements?.get(fileKey(p.file))
        if (!before) return null
        records.push(before)
      }
      return { inverse: [{ kind: 'place', placements: records }], redo: [forward] }
    }
    case 'move': {
      const byParent = new Map<string, { folder: WorkspaceFileRef | null; files: WorkspaceFileRef[] }>()
      for (const file of forward.files) {
        const key = fileKey(file)
        if (!prior.parents?.has(key)) return null
        const parent = prior.parents.get(key) ?? null
        const group = byParent.get(parent ? fileKey(parent) : 'root')
        if (group) group.files.push(file); else byParent.set(parent ? fileKey(parent) : 'root', { folder: parent, files: [file] })
      }
      return { inverse: [...byParent.values()].map((g) => ({ kind: 'move' as const, files: g.files, folder: g.folder })), redo: [forward] }
    }
    case 'rename': {
      const name = prior.names?.get(fileKey(forward.file))
      return name === undefined ? null : { inverse: [{ kind: 'rename', file: forward.file, name }], redo: [forward] }
    }
    case 'create':
      return prior.created ? { inverse: [{ kind: 'remove', files: [prior.created] }], redo: [{ kind: 'restore', files: [prior.created] }] } : null
    case 'add':
      return prior.added?.length ? { inverse: [{ kind: 'remove', files: prior.added }], redo: [{ kind: 'restore', files: prior.added }] } : null
    case 'remove':
      return { inverse: [{ kind: 'restore', files: forward.files }], redo: [forward] }
    case 'connect': {
      const made = prior.connection
      return made ? { inverse: [{ kind: 'disconnect', connectionId: made.id }], redo: [{ kind: 'restore-connection', connection: made }] } : null
    }
    case 'disconnect': {
      const removed = prior.connection
      // The record must be the one the intent names: redo (the same disconnect) and the restore both rest on that id.
      return removed && removed.id === forward.connectionId
        ? { inverse: [{ kind: 'restore-connection', connection: removed }], redo: [forward] }
        : null
    }
    default:
      return null
  }
}

export interface JournalEntry {
  readonly id: number
  /** The one message the shell announces for this change. */
  readonly label: string
  readonly forward: JournalIntent
  /** Null: not undoable. The entry is kept as a barrier, so Undo does not skip over it. */
  readonly inverse: readonly JournalIntent[] | null
  readonly redo: readonly JournalIntent[]
}

export type ApplyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }
/** The shell's handler. A batch is applied whole or not at all. */
export type Applier = (intents: readonly JournalIntent[]) => ApplyResult

export type JournalOutcome =
  | { readonly status: 'applied'; readonly label: string }
  | { readonly status: 'nothing' }
  | { readonly status: 'irreversible'; readonly label: string }
  | { readonly status: 'refused'; readonly label: string; readonly reason: string }

export class IntentJournal {
  private undoStack: JournalEntry[] = []
  private redoStack: JournalEntry[] = []
  private seq = 0

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  peekUndo(): JournalEntry | null { return this.undoStack.at(-1) ?? null }
  peekRedo(): JournalEntry | null { return this.redoStack.at(-1) ?? null }
  get size(): number { return this.undoStack.length }

  /** Record an applied change. A new change ends the redo side. */
  record(entry: { label: string; forward: JournalIntent; inverse: readonly JournalIntent[] | null; redo?: readonly JournalIntent[] }): JournalEntry {
    const recorded: JournalEntry = { id: ++this.seq, label: entry.label, forward: entry.forward, inverse: entry.inverse, redo: entry.redo ?? [entry.forward] }
    this.undoStack.push(recorded)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
    return recorded
  }

  undo(apply: Applier): JournalOutcome {
    const entry = this.undoStack.at(-1)
    if (!entry) return { status: 'nothing' }
    if (!entry.inverse) return { status: 'irreversible', label: entry.label }
    const result = apply(entry.inverse)
    if (!result.ok) return { status: 'refused', label: entry.label, reason: result.reason }
    this.undoStack.pop()
    this.redoStack.push(entry)
    return { status: 'applied', label: entry.label }
  }

  redo(apply: Applier): JournalOutcome {
    const entry = this.redoStack.at(-1)
    if (!entry) return { status: 'nothing' }
    const result = apply(entry.redo)
    if (!result.ok) return { status: 'refused', label: entry.label, reason: result.reason }
    this.redoStack.pop()
    this.undoStack.push(entry)
    return { status: 'applied', label: entry.label }
  }
}
