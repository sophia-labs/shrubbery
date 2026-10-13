/**
 * Folder-view preferences and file placements of the Files pane, over the cell's own paths (CONTRACT-files §7): read with
 * `GET /navigation/{g}/file-views`, write with the `source_push` tool. Never through the offline mirror's `source_pull`,
 * which one 50 MB file puts out of reach (§7.1).
 *
 * Records, identity and validation are the prototype's (`folder-view-contract.ts`, `folderObjectWireRecord`): one
 * FolderView per folder and view (face, sort, icon size, grid), one FilePlacement per placed file, each a contested
 * current-state object with an opaque source version. A drag of several cards is one `source_push`; a write from a stale
 * base comes back contested and locks that card only; a viewer reads and never writes.
 */
import {
  fileKey, filePlacementKey, folderViewKey,
  type FileCanvasPlacementState, type FileKey, type FilePlacementRecord, type PlacementContest, type WorkspaceFileRef, type FolderViewPort, type FolderViewRead,
  type FolderViewRecord, type FolderViewScope, type FolderViewWrite, type FolderViewWriteResult,
} from '@shrubbery/nucleus'
import { FilesContractError, type FilesClient } from './files-contract.js'
import { FOLDER_VIEW_VOCAB, decodeFolderViewFace, folderObjectId, folderObjectWireRecord, type FolderViewFace } from './folder-view-source-port.js'
import { randomUUID } from '@shrubbery/nucleus/web-crypto'

type DomainRecord = FolderViewRecord | FilePlacementRecord

export function defaultFolderView(scope: FolderViewScope): FolderViewRecord {
  return { schemaVersion: 1, scope, presentation: 'canvas', sort: 'manual', direction: 'asc', iconSize: 'medium', snapToGrid: false }
}

export interface FolderLayoutRead {
  /** False when the cell cannot store preferences for this graph (`source_bundle_too_large`): show defaults, never write. */
  readonly available: boolean
  readonly view: FolderViewRead<FolderViewRecord>
  readonly placements: readonly FolderViewRead<FilePlacementRecord>[]
}

/** `FolderViewPort` over the contract's HTTP read and `source_push` write. */
export class FolderViewHttpPort implements FolderViewPort {
  constructor(private readonly client: FilesClient, private readonly ownerId: string) {}

  async readFolder(scope: FolderViewScope): Promise<FolderLayoutRead> {
    if (scope.ownerId !== this.ownerId) throw new Error('FolderView: owner route changed')
    const empty: FolderViewRead<FolderViewRecord> = { record: null, baseVersion: 'root', conflictId: null }
    // No incarnation was learned (the discovery's file-views read failed): records cannot be addressed, so none are
    // written; the defaults are shown (CONTRACT-files §7.1: "show defaults and do not write").
    if (!scope.graphIncarnation) return { available: false, view: empty, placements: [] }
    const scopeKey = folderViewKey(scope)
    const read = await this.client.readFileViews(scope.graphId, { folderKey: scope.folderId === null ? 'root' : `folder:${scope.folderId}` })
    if (read.graphIncarnation && read.graphIncarnation !== scope.graphIncarnation) {
      throw new Error('This workspace was replaced since it was opened. Reload to see its files.')
    }
    if (!read.available) return { available: false, view: empty, placements: [] }
    const viewId = await folderObjectId(defaultFolderView(scope))
    let view = empty
    const placements: FolderViewRead<FilePlacementRecord>[] = []
    for (const face of read.currentState) {
      if (face.vocab !== FOLDER_VIEW_VOCAB) continue
      let record: DomainRecord
      try { record = await decodeFolderViewFace(face as unknown as FolderViewFace) } catch { continue }   // a face this shell cannot read is left alone
      if (folderViewKey(record.scope) !== scopeKey) continue
      const at = { baseVersion: face.sourceVersion, conflictId: face.conflictId ?? null }
      if ('file' in record) placements.push({ record, ...at })
      else if (face.objectId === viewId) view = { record, ...at }
    }
    return { available: true, view, placements }
  }

  async readView(scope: FolderViewScope): Promise<FolderViewRead<FolderViewRecord>> { return (await this.readFolder(scope)).view }
  async readPlacements(scope: FolderViewScope): Promise<readonly FolderViewRead<FilePlacementRecord>[]> { return (await this.readFolder(scope)).placements }
  async writeView(write: FolderViewWrite<FolderViewRecord>): Promise<FolderViewWriteResult> { return (await this.writeBatch([write]))[0]! }
  async writePlacement(write: FolderViewWrite<FilePlacementRecord>): Promise<FolderViewWriteResult> { return (await this.writeBatch([write]))[0]! }

  /** One `source_push` for the whole batch; results in the order of `writes`. */
  async writeBatch(writes: readonly FolderViewWrite<DomainRecord>[]): Promise<FolderViewWriteResult[]> {
    if (!writes.length) return []
    const scope = writes[0]!.record.scope
    if (writes.some(w => w.record.scope.graphId !== scope.graphId || w.record.scope.graphIncarnation !== scope.graphIncarnation)) {
      throw new Error('FolderView: one batch, one workspace incarnation')
    }
    const operations = await Promise.all(writes.map(async write => {
      const record = await folderObjectWireRecord(write.record)
      return { kind: 'currentState' as const, operationId: write.operationId, vocab: FOLDER_VIEW_VOCAB, class: String(record.kind),
        objectId: String(record.localId), baseVersion: write.baseVersion, record }
    }))
    let result
    try { result = await this.client.pushFileViews(scope.graphId, scope.graphIncarnation, operations) } catch (error) {
      // A classified refusal travels as its code (the controller branches on it), anything else as its sentence.
      const reason = error instanceof FilesContractError && error.code ? error.code : error instanceof Error ? error.message : String(error)
      return writes.map(write => ({ status: 'rejected' as const, operationId: write.operationId, reason }))
    }
    return writes.map(write => {
      const receipt = result.receipts.find(r => r.operationId === write.operationId)
      if (!receipt) return { status: 'pending' as const, operationId: write.operationId }
      const outcome = receipt.outcome
      if (outcome.outcome === 'conflict' || receipt.status === 'conflict') {
        return { status: 'contested' as const, operationId: write.operationId, conflictId: outcome.conflictId ?? 'conflict' }
      }
      if (receipt.status.startsWith('rejected')) return { status: 'rejected' as const, operationId: write.operationId, reason: receipt.status }
      if (outcome.outcome === 'applied' && outcome.sourceVersion) {
        return { status: 'applied' as const, operationId: write.operationId, version: outcome.sourceVersion }
      }
      return { status: 'pending' as const, operationId: write.operationId }
    })
  }
}

export interface FilesLayoutSnapshot {
  readonly ready: boolean
  readonly available: boolean
  readonly view: FolderViewRecord
  readonly placements: readonly FilePlacementRecord[]
  /** Keyed by `fileKey`: pending while a write is in flight, contested while a contest stands. Nothing else is locked. */
  readonly placementStates: Readonly<Record<FileKey, FileCanvasPlacementState>>
  readonly message: string | null
  /** Contested placements: where this tab put the card, where the cell holds it now. Ghosts on the canvas. */
  readonly contests: readonly PlacementContest[]
}

function clock(at: number): string {
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

type ViewPatch = Partial<Pick<FolderViewRecord, 'presentation' | 'sort' | 'direction' | 'iconSize' | 'snapToGrid'>>

/** CONTRACT §7.1: the per-graph preferences record is at its bound. */
const RECORD_FULL = 'source_bundle_too_large'
const RECORD_FULL_MESSAGE = 'This workspace\'s saved layout is full, so new positions and view choices are not saved. Files work as usual.'

/** The layout of the folder the pane shows: what the canvas draws, and the two writes it may ask for. */
export class FilesLayoutController {
  private scope: FolderViewScope | null = null
  private token = ''
  private generation = 0
  private writable = false
  private ready = false
  private available = true
  private message: string | null = null
  private view: FolderViewRead<FolderViewRecord> = { record: null, baseVersion: 'root', conflictId: null }
  private placements = new Map<string, FolderViewRead<FilePlacementRecord>>()
  private pending = new Map<FileKey, number>()
  /** The position this tab tried to write and lost, by placement key: the other candidate of a contest. */
  private lost = new Map<string, { record: FilePlacementRecord; at: number }>()
  /** When this tab first saw a placement contested (the time of the cell's side, as far as this tab can say). */
  private seen = new Map<string, number>()
  /** Versions of placements this tab wrote and the cell applied: a contested face at one of them holds this tab's own position. */
  private written = new Set<string>()
  /** Set by a `source_bundle_too_large` refusal: no preference write for the rest of the session (§7.1). */
  private full = false

  constructor(
    private readonly port: FolderViewHttpPort,
    private readonly onChange: () => void,
    private readonly operationId: () => string = () => `file-layout:${randomUUID()}`,
  ) {}

  bind(scope: FolderViewScope, epoch: string, writable: boolean): FilesLayoutSnapshot {
    this.writable = writable
    const token = `${folderViewKey(scope)}|${epoch}`
    if (token !== this.token) {
      const sameFolder = this.scope !== null && folderViewKey(this.scope) === folderViewKey(scope)
      this.scope = scope
      this.token = token
      if (!sameFolder) {
        this.ready = false
        this.message = null
        this.view = { record: null, baseVersion: 'root', conflictId: null }
        this.placements = new Map()
        this.pending = new Map()
        this.lost = new Map()
        this.seen = new Map()
      }
      void this.reload()
    }
    return this.snapshot()
  }

  private readBackTimer: ReturnType<typeof setTimeout> | null = null

  private readBackSoon(delayMs = 1500): void {
    if (this.readBackTimer) clearTimeout(this.readBackTimer)
    this.readBackTimer = setTimeout(() => { this.readBackTimer = null; void this.reload() }, delayMs)
  }

  /** Re-read the folder's layout from the cell. */
  async reload(): Promise<void> {
    const scope = this.scope
    if (!scope) return
    const generation = ++this.generation
    try {
      const read = await this.port.readFolder(scope)
      if (generation !== this.generation) return
      this.available = read.available
      this.view = read.view
      this.placements = new Map(read.placements.filter(row => row.record).map(row => [filePlacementKey(row.record!), row]))
      for (const [key, row] of this.placements) {
        if (row.conflictId) { if (!this.seen.has(key)) this.seen.set(key, Date.now()) } else { this.seen.delete(key); this.lost.delete(key) }
      }
      this.ready = true
      if (this.full) { this.available = false; this.message = RECORD_FULL_MESSAGE }
      else if (!read.available) this.message = RECORD_FULL_MESSAGE
    } catch (error) {
      if (generation !== this.generation) return
      this.ready = true
      this.available = false
      this.message = error instanceof Error ? error.message : String(error)
    }
    this.onChange()
  }

  snapshot(): FilesLayoutSnapshot {
    const scope = this.scope
    const states: Record<FileKey, FileCanvasPlacementState> = {}
    for (const row of this.placements.values()) if (row.conflictId && row.record) states[fileKey(row.record.file)] = 'contested'
    for (const key of this.pending.keys()) states[key] = 'pending'
    const contests: PlacementContest[] = []
    for (const [key, row] of this.placements) {
      if (!row.conflictId || !row.record) continue
      const own = this.written.has(row.baseVersion)
      const at = this.seen.get(key) ?? Date.now()
      const theirs = { id: 'theirs', x: row.record.x, y: row.record.y, origin: own ? 'this-tab' as const : 'other' as const, at,
        label: `${own ? 'this tab' : 'other tab'} · ${clock(at)}` }
      const mine = this.lost.get(key)
      contests.push({ file: row.record.file, candidates: mine && (mine.record.x !== theirs.x || mine.record.y !== theirs.y)
        ? [{ id: 'mine', x: mine.record.x, y: mine.record.y, origin: 'this-tab' as const, at: mine.at, label: `this tab · ${clock(mine.at)}` }, theirs]
        : [theirs] })
    }
    return {
      contests,
      ready: this.ready,
      available: this.available,
      view: this.view.record ?? (scope ? defaultFolderView(scope) : (null as unknown as FolderViewRecord)),
      placements: [...this.placements.values()].flatMap(row => row.record ? [row.record] : []),
      placementStates: states,
      message: this.message,
    }
  }

  private canWrite(): boolean {
    return this.scope !== null && this.writable && this.ready && this.available && !this.full
  }

  private recordIsFull(): void {
    this.full = true
    this.available = false
    this.message = RECORD_FULL_MESSAGE
  }

  /** Save a view preference (face, icon size, grid, sort) for this folder. */
  async setView(patch: ViewPatch): Promise<void> {
    if (!this.canWrite()) return
    const scope = this.scope!
    const before = this.view
    const record: FolderViewRecord = { ...(before.record ?? defaultFolderView(scope)), ...patch, scope }
    this.message = null
    // The face changes now; the cell's answer settles it.
    this.view = { ...before, record }
    this.onChange()
    const [result] = await this.port.writeBatch([{ operationId: this.operationId(), baseVersion: before.baseVersion, record }])
    if (this.scope !== scope) return
    if (result?.status === 'applied') this.view = { record, baseVersion: result.version, conflictId: null }
    else if (result?.status === 'pending') {
      // Accepted, outcome not said yet: keep the choice and read the version the cell holds.
      this.readBackSoon()
    } else if (result?.status === 'rejected' && result.reason === RECORD_FULL) {
      this.view = before
      this.recordIsFull()
    } else {
      this.view = before
      this.message = result?.status === 'contested' ? 'Someone else changed this folder\'s view at the same time; theirs is shown.'
        : 'This view choice could not be saved.'
      if (result?.status === 'contested') await this.reload()
    }
    this.onChange()
  }

  /** Settle a contested placement: write the candidate chosen (from the version the cell holds now), which ends the contest. */
  async choose(file: WorkspaceFileRef, candidateId: string): Promise<void> {
    const scope = this.scope
    if (!scope || !this.canWrite()) return
    const contest = this.snapshot().contests.find(c => fileKey(c.file) === fileKey(file))
    const candidate = contest?.candidates.find(c => c.id === candidateId)
    const row = [...this.placements.values()].find(r => r.record && fileKey(r.record.file) === fileKey(file))
    if (!contest || !candidate || !row?.record) return
    this.lost.delete(filePlacementKey(row.record))
    await this.place([{ ...row.record, x: candidate.x, y: candidate.y }])
    // The write is from the cell's own version, so it ends the contest; read back to see it end.
    await this.reload()
  }

  /** Save the positions of one gesture's cards: one write for all of them. */
  async place(records: readonly FilePlacementRecord[]): Promise<void> {
    if (!this.canWrite() || !records.length) return
    const scope = this.scope!
    const generation = this.generation
    this.message = null
    const writes = records.map(record => {
      if (folderViewKey(record.scope) !== folderViewKey(scope)) throw new Error('This file is no longer in the visible folder.')
      const key = filePlacementKey(record)
      const observed = this.placements.get(key)
      return { key, file: fileKey(record.file), previous: observed ?? null,
        write: { operationId: this.operationId(), baseVersion: observed?.baseVersion ?? 'root', record: structuredClone(record) } }
    })
    for (const w of writes) {
      // The cards stay where they were dropped while the write is in flight, and are locked until it lands.
      this.placements.set(w.key, { record: w.write.record, baseVersion: w.previous?.baseVersion ?? 'root', conflictId: null })
      this.pending.set(w.file, (this.pending.get(w.file) ?? 0) + 1)
    }
    this.onChange()
    const results = await this.port.writeBatch(writes.map(w => w.write))
    let contested = false
    let refused = false
    writes.forEach((w, index) => {
      const left = (this.pending.get(w.file) ?? 1) - 1
      if (left > 0) this.pending.set(w.file, left)
      else this.pending.delete(w.file)
      const result = results[index]
      if (this.scope !== scope || generation !== this.generation) return
      if (result?.status === 'applied') { this.written.add(result.version); this.placements.set(w.key, { record: w.write.record, baseVersion: result.version, conflictId: null }) }
      else if (result?.status === 'contested') { contested = true; this.lost.set(w.key, { record: w.write.record, at: Date.now() }) }
      else if (result?.status === 'rejected') {
        refused = true
        if (w.previous) this.placements.set(w.key, w.previous)
        else this.placements.delete(w.key)
      }
    })
    if (contested) {
      this.message = 'Someone else moved the same file at the same time. Click the position you want to keep.'
      await this.reload()
      return
    }
    // Accepted without an outcome: read back now and once more shortly, so the next drag writes from the version the
    // cell holds instead of contesting itself.
    if (results.some(result => result?.status === 'pending') && this.scope === scope) {
      await this.reload()
      this.readBackSoon()
      return
    }
    if (results.some(result => result?.status === 'rejected' && result.reason === RECORD_FULL)) this.recordIsFull()
    else if (refused) this.message = 'A new position could not be saved; the card is back where it was.'
    this.onChange()
  }
}
