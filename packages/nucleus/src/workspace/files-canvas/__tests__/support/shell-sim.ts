/**
 * A small real shell, in memory: the side of the contract the canvas never sees. It owns the files, the
 * folders they sit in, their placements, the selection, the drafts, the connections and the intent
 * journal, validates what it is asked, and answers the canvas the way the fixture shell does (a failed
 * name keeps its draft and says why). The reducer tests drive the reducer against it, so a law is
 * witnessed as a change in a store and not only as an emitted object. It is a test double of nothing: it
 * is the other half of the contract, written small.
 */
import {
  fileKey, type FileCanvasCapabilities, type FileCanvasConnection, type FileCanvasDraft, type FileCanvasInput, type FileCanvasIntent,
  type FileCanvasNaming, type FileCanvasPlacementState, type FileCanvasSession, type FileCanvasView, type FileKey, type FilePlacementRecord,
  type FolderViewScope, type PlacementContest, type WorkspaceFileRef,
} from '../../../folder-view-contract.js'
import type { SceneSnapshot } from '../../engine-port.js'
import { IntentJournal, invert, isEdit, type ApplyResult, type JournalIntent, type PriorState } from '../../journal.js'
import { ALL_CAPS } from './fixtures.js'

export interface SimFile {
  readonly ref: WorkspaceFileRef
  label: string
  parent: FileKey | null
  removed: boolean
}

type Prior = { -readonly [K in keyof PriorState]: PriorState[K] }

/** Everything an edit can change, as it stood: what a refused batch is put back to. */
interface Checkpoint {
  readonly files: readonly { readonly file: SimFile; readonly key: FileKey; readonly label: string; readonly parent: FileKey | null; readonly removed: boolean }[]
  readonly placements: Map<string, { x: number; y: number }>
  readonly selection: FileKey[]
  readonly naming: FileCanvasNaming | null
  readonly drafts: FileCanvasDraft[]
  readonly connections: FileCanvasConnection[]
  readonly contests: PlacementContest[]
  readonly placementStates: Record<FileKey, FileCanvasPlacementState>
  readonly imported: number
}

export class ShellSim {
  readonly files = new Map<FileKey, SimFile>()
  viewed: FileKey | null = null
  selection: FileKey[] = []
  naming: FileCanvasNaming | null = null
  drafts: FileCanvasDraft[] = []
  cut: WorkspaceFileRef[] = []
  contests: PlacementContest[] = []
  placementStates: Record<FileKey, FileCanvasPlacementState> = {}
  connections: FileCanvasConnection[] = []
  capabilities: FileCanvasCapabilities = ALL_CAPS
  view: FileCanvasView = { iconSize: 'medium', snapToGrid: false }
  readonly journal = new IntentJournal()
  readonly opened: { file: WorkspaceFileRef; beside: boolean }[] = []
  readonly menus: Extract<FileCanvasIntent, { kind: 'menu' }>[] = []
  readonly imported: { name: string; folder: FileKey | null }[] = []
  readonly messages: string[] = []
  readonly ignored: FileCanvasIntent[] = []
  /** The scene the canvas is showing: what the shell reads a file's current position from. */
  scene: SceneSnapshot | null = null
  version = 0
  private placements = new Map<string, { x: number; y: number }>()
  private seq = 0
  /** While a batch is being applied, what the shell would say goes here instead: the batch's refusal is its reason, not an announcement. */
  private muted: string[] | null = null

  addFile(id: string, opts: { label?: string; folder?: boolean; parent?: string | null; x?: number; y?: number } = {}): WorkspaceFileRef {
    const ref: WorkspaceFileRef = { ownerId: 'owner', graphId: 'files', graphIncarnation: 'inc-1', kind: opts.folder ? 'folder' : 'document', id }
    const parent = opts.parent === undefined || opts.parent === null ? null : fileKey({ ...ref, kind: 'folder', id: opts.parent })
    this.files.set(fileKey(ref), { ref, label: opts.label ?? (opts.folder ? id : `${id}.pdf`), parent, removed: false })
    if (opts.x !== undefined && opts.y !== undefined) this.placements.set(`${this.viewKey(parent)}|${fileKey(ref)}`, { x: opts.x, y: opts.y })
    return ref
  }

  refOf(id: string, folder = false): WorkspaceFileRef {
    for (const f of this.files.values()) if (f.ref.id === id && (f.ref.kind === 'folder') === folder) return f.ref
    throw new Error(`no ${folder ? 'folder' : 'file'} ${id}`)
  }
  keyOf(id: string, folder = false): FileKey { return fileKey(this.refOf(id, folder)) }
  labelOf(id: string, folder = false): string { return this.files.get(this.keyOf(id, folder))!.label }
  parentOf(id: string, folder = false): FileKey | null { return this.files.get(this.keyOf(id, folder))!.parent }
  isRemoved(id: string, folder = false): boolean { return this.files.get(this.keyOf(id, folder))!.removed }
  placementOf(id: string, folder = false): { x: number; y: number } | undefined {
    return this.placements.get(`${this.viewKey(this.viewed)}|${this.keyOf(id, folder)}`)
  }
  get selectionIds(): string[] { return this.selection.map((k) => this.files.get(k)!.ref.id) }

  private viewKey(viewed: FileKey | null): string { return viewed ?? 'root' }

  scope(): FolderViewScope {
    return { ownerId: 'owner', graphId: 'files', graphIncarnation: 'inc-1', folderId: this.viewed ? this.files.get(this.viewed)!.ref.id : null,
      viewId: 'files-default', audience: { kind: 'shared' } }
  }

  children(): SimFile[] {
    return [...this.files.values()].filter((f) => !f.removed && f.parent === this.viewed)
  }

  placementRecords(): FilePlacementRecord[] {
    const scope = this.scope()
    return this.children().flatMap((f) => {
      const p = this.placements.get(`${this.viewKey(this.viewed)}|${fileKey(f.ref)}`)
      return p ? [{ schemaVersion: 1 as const, scope, file: f.ref, coordinateSpace: 'folder-canvas' as const, x: p.x, y: p.y }] : []
    })
  }

  input(session: Pick<FileCanvasSession, 'camera' | 'focused'>): FileCanvasInput {
    const nodes = this.children().map((f) => ({ file: f.ref, label: f.label }))
    const visible = new Set(nodes.map((n) => fileKey(n.file)))
    return {
      scope: this.scope(), nodes, placements: this.placementRecords(),
      session: { selected: this.selection.filter((k) => visible.has(k)).map((k) => this.files.get(k)!.ref), camera: session.camera,
        editingName: null, focused: session.focused ?? null, naming: this.naming, cut: this.cut },
      capabilities: this.capabilities, view: this.view, authorityVersion: String(this.version),
      contests: this.contests, placementStates: this.placementStates, drafts: this.drafts, connections: this.connections,
      relations: [{ uri: 'rel:explains', label: 'explains' }, { uri: 'rel:supports', label: 'supports' }],
    }
  }

  private say(message: string): void { if (this.muted) this.muted.push(message); else this.messages.push(message) }

  private labelFor(files: readonly WorkspaceFileRef[]): string {
    return files.length === 1 ? (this.files.get(fileKey(files[0]!))?.label ?? 'file') : `${files.length} files`
  }

  private nameError(name: string, ignore: FileKey | null): string | null {
    if (!name.trim()) return 'A name is required.'
    const clash = this.children().some((f) => f.label === name.trim() && fileKey(f.ref) !== ignore)
    return clash ? `“${name.trim()}” already exists here.` : null
  }

  /** Apply what the canvas asked for. Edits are journaled; the rest only change what the shell shows. */
  apply(intent: FileCanvasIntent): void {
    this.version++
    switch (intent.kind) {
      case 'select': this.selection = intent.files.map(fileKey); return
      case 'open': this.opened.push({ file: intent.file, beside: !!intent.beside }); return
      case 'menu': this.menus.push(intent); return
      case 'name-cancel': this.naming = null; this.drafts = []; return
      case 'new-folder': {
        const draftId = `draft-${++this.seq}`
        this.drafts = [{ draftId, kind: 'folder', label: 'Untitled folder', placement: intent.placement }]
        this.naming = { target: { draftId }, initial: 'Untitled folder', error: null }
        return
      }
      case 'undo': this.runJournal('undo'); return
      case 'redo': this.runJournal('redo'); return
      default:
        if (!isEdit(intent)) { this.ignored.push(intent); return }
    }
    const prior: Prior = {}
    const outcome = this.applyEdit(intent, prior)
    if (outcome === null) return
    const inversion = invert(intent, prior)
    this.journal.record({ label: outcome, forward: intent, inverse: inversion?.inverse ?? null, redo: inversion?.redo })
    this.say(outcome)
  }

  /** Returns the one message for a change that was made, or null when it was refused. */
  private applyEdit(intent: FileCanvasIntent, prior: Prior): string | null {
    switch (intent.kind) {
      case 'place': {
        const records = new Map<FileKey, FilePlacementRecord>()
        for (const p of intent.placements) {
          const card = this.scene?.byKey.get(fileKey(p.file))
          if (!card) { this.say('That file is no longer here.'); return null }
          records.set(fileKey(p.file), { ...p, x: card.rect.x, y: card.rect.y })
        }
        prior.placements = records
        for (const p of intent.placements) this.placements.set(`${this.viewKey(this.viewed)}|${fileKey(p.file)}`, { x: p.x, y: p.y })
        return `Arranged ${this.labelFor(intent.placements.map((p) => p.file))}`
      }
      case 'move': {
        const dest = intent.folder ? fileKey(intent.folder) : null
        const destFile = dest ? this.files.get(dest) : null
        if (dest && (!destFile || destFile.removed || destFile.ref.kind !== 'folder')) { this.say('The folder has gone since.'); return null }
        if (intent.files.some((f) => fileKey(f) === dest)) { this.say('A folder cannot go into itself.'); return null }
        const parents = new Map<FileKey, WorkspaceFileRef | null>()
        for (const f of intent.files) {
          const sim = this.files.get(fileKey(f))
          if (!sim || sim.removed) { this.say(`${sim?.label ?? f.id} has gone since.`); return null }
          parents.set(fileKey(f), sim.parent ? this.files.get(sim.parent)!.ref : null)
        }
        prior.parents = parents
        for (const f of intent.files) this.files.get(fileKey(f))!.parent = dest
        // The view stays and the selection clears (Vera's decision): all of it, not only what moved. A selected companion that
        // stayed behind (a locked card) is not left selected on a canvas whose announcement says "Moved ...".
        this.selection = []
        return `Moved ${this.labelFor(intent.files)} to ${destFile ? destFile.label : 'the top level'}`
      }
      case 'rename': {
        const sim = this.files.get(fileKey(intent.file))
        if (!sim) return null
        const error = this.nameError(intent.name, fileKey(intent.file))
        if (error) { this.naming = { target: intent.file, initial: intent.name, error }; return null }
        prior.names = new Map([[fileKey(intent.file), sim.label]])
        const was = sim.label
        sim.label = intent.name.trim()
        this.naming = null
        return `Renamed ${was} to ${sim.label}`
      }
      case 'create': {
        const draft = this.drafts.find((d) => d.draftId === intent.draftId)
        if (!draft) { this.say('That draft is gone.'); return null }
        const error = this.nameError(intent.name, null)
        if (error) { this.naming = { target: { draftId: draft.draftId }, initial: intent.name, error }; return null }
        const ref = this.addFile(`new-${++this.seq}`, { folder: true, label: intent.name.trim(), parent: this.viewed ? this.files.get(this.viewed)!.ref.id : null })
        this.placements.set(`${this.viewKey(this.viewed)}|${fileKey(ref)}`, { ...intent.placement })
        this.drafts = []; this.naming = null
        this.selection = [fileKey(ref)]
        prior.created = ref
        return `Created folder ${intent.name.trim()}`
      }
      case 'add': {
        const dest = intent.folder ? fileKey(intent.folder) : null
        const added: WorkspaceFileRef[] = []
        const list = Array.from(intent.files)
        for (const f of list) {
          const ref = this.addFile(`import-${++this.seq}`, { label: f.name, parent: dest ? this.files.get(dest)!.ref.id : null })
          this.imported.push({ name: f.name, folder: dest })
          if (intent.placement && dest === this.viewed) this.placements.set(`${this.viewKey(this.viewed)}|${fileKey(ref)}`, { ...intent.placement })
          added.push(ref)
        }
        prior.added = added
        return `${list.length} ${list.length === 1 ? 'PDF' : 'PDFs'} added`
      }
      case 'remove': {
        for (const f of intent.files) if (!this.files.get(fileKey(f)) || this.files.get(fileKey(f))!.removed) { this.say('That file is gone.'); return null }
        for (const f of intent.files) this.files.get(fileKey(f))!.removed = true
        const gone = new Set(intent.files.map(fileKey))
        this.selection = this.selection.filter((k) => !gone.has(k))
        return `Removed ${this.labelFor(intent.files)}`
      }
      case 'connect': {
        const made: FileCanvasConnection = { id: `conn-${++this.seq}`, source: intent.source, target: intent.target, relation: intent.relation,
          label: intent.label ?? intent.relation.replace(/^rel:/, ''), state: 'proposed', attribution: 'you' }
        this.connections = [...this.connections, made]
        prior.connection = made
        return 'Connected'
      }
      case 'disconnect': {
        const c = this.connections.find((x) => x.id === intent.connectionId)
        if (!c) { this.say('That connection is gone.'); return null }
        prior.connection = c
        this.connections = this.connections.filter((x) => x !== c)
        return 'Disconnected'
      }
      case 'choose-placement': {
        const contest = this.contests.find((c) => fileKey(c.file) === fileKey(intent.file))
        const candidate = contest?.candidates.find((c) => c.id === intent.candidateId)
        if (!contest || !candidate) { this.say('That position is gone.'); return null }
        this.placements.set(`${this.viewKey(this.viewed)}|${fileKey(intent.file)}`, { x: candidate.x, y: candidate.y })
        this.contests = this.contests.filter((c) => c !== contest)
        delete this.placementStates[fileKey(intent.file)]
        return 'Position kept'
      }
      default: return null
    }
  }

  private runJournal(which: 'undo' | 'redo'): void {
    const outcome = which === 'undo' ? this.journal.undo((b) => this.applyBatch(b)) : this.journal.redo((b) => this.applyBatch(b))
    if (outcome.status === 'applied') this.say(`${which === 'undo' ? 'Undid' : 'Redid'}: ${outcome.label}`)
    else if (outcome.status === 'irreversible') this.say(`Can't undo: ${outcome.label} settles a contested position.`)
    else if (outcome.status === 'refused') this.say(`Can't ${which}: ${outcome.reason}`)
  }

  /** What a journal batch can ask for besides an edit: put back a removed file, put back a removed connection, whole. */
  private applyJournalIntent(intent: JournalIntent, prior: Prior): string | null {
    switch (intent.kind) {
      case 'restore': {
        for (const f of intent.files) if (!this.files.has(fileKey(f))) { this.say(`${f.id} no longer exists.`); return null }
        for (const f of intent.files) this.files.get(fileKey(f))!.removed = false
        return 'Restored'
      }
      case 'restore-connection': {
        const c = intent.connection
        if (this.connections.some((x) => x.id === c.id)) { this.say('That connection is already there.'); return null }
        for (const end of [c.source, c.target]) {
          const card = this.files.get(fileKey(end))
          if (!card || card.removed) { this.say(`${card?.label ?? end.id} has gone since.`); return null }
        }
        this.connections = [...this.connections, c]
        return 'Connection restored'
      }
      default: return this.applyEdit(intent, prior)
    }
  }

  private checkpoint(): Checkpoint {
    return {
      files: [...this.files].map(([key, file]) => ({ file, key, label: file.label, parent: file.parent, removed: file.removed })),
      placements: new Map(this.placements), selection: [...this.selection], naming: this.naming, drafts: this.drafts, connections: this.connections,
      contests: this.contests, placementStates: { ...this.placementStates }, imported: this.imported.length,
    }
  }

  /** Put everything back in place: tests hold on to the file records, so they are restored, not replaced. */
  private rollback(saved: Checkpoint): void {
    const kept = new Set(saved.files.map((f) => f.key))
    for (const key of [...this.files.keys()]) if (!kept.has(key)) this.files.delete(key)
    for (const f of saved.files) { f.file.label = f.label; f.file.parent = f.parent; f.file.removed = f.removed }
    this.placements = new Map(saved.placements)
    this.selection = [...saved.selection]
    this.naming = saved.naming; this.drafts = saved.drafts; this.connections = saved.connections
    this.contests = saved.contests; this.placementStates = { ...saved.placementStates }
    this.imported.length = saved.imported
  }

  /**
   * Apply a batch of inverse (or redo) intents without journaling them, all or nothing: the first intent that is refused puts back what the
   * ones before it did and is the batch's reason. Refusals are never ignored and never announced one by one; the journal reports the batch.
   */
  applyBatch(batch: readonly JournalIntent[]): ApplyResult {
    const saved = this.checkpoint()
    const refusals: string[] = []
    this.muted = refusals
    try {
      for (const intent of batch) {
        if (this.applyJournalIntent(intent, {}) !== null) continue
        const reason = refusals.at(-1) ?? this.naming?.error ?? 'That change can no longer be made.'
        this.rollback(saved)
        return { ok: false, reason }
      }
    } finally {
      this.muted = null
    }
    this.version++
    return { ok: true }
  }
}
