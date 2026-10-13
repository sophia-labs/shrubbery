/** Canonical folder objects over the existing durable source mirror, never Emporium Replace. */
import {
  filePlacementKey, folderViewKey,
  type FilePlacementRecord, type FolderViewPort, type FolderViewRead,
  type FolderViewRecord, type FolderViewScope, type FolderViewWrite, type FolderViewWriteResult,
} from '@shrubbery/nucleus'
import {
  sourceOperationDigest,
  type SourceBundle, type SourceCurrentObject, type SourceOperation, type SourceOutboxRecord,
} from '@shrubbery/source'
import type { SourceMirrorRuntime } from './source-mirror-runtime.js'
import { sha256Digest } from '@shrubbery/nucleus/web-crypto'

export const FOLDER_VIEW_VOCAB = 'garden-file-views'
type DomainRecord = FolderViewRecord | FilePlacementRecord
type ObjectClass = 'FolderView' | 'FilePlacement'
type Runtime = Pick<SourceMirrorRuntime, 'open' | 'bundleFor' | 'backgroundSync'>

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`FolderView: invalid ${field}`)
  return value
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`FolderView: invalid ${field}`)
  return value as T
}
function scopeFields(scope: FolderViewScope): Record<string, unknown> {
  folderViewKey(scope)
  return {
    schemaVersion: 1, ownerId: scope.ownerId, graphId: scope.graphId,
    graphIncarnation: scope.graphIncarnation,
    folderKey: scope.folderId === null ? 'root' : `folder:${scope.folderId}`,
    viewId: scope.viewId, audienceKind: scope.audience.kind,
    ...(scope.audience.kind === 'personal' ? { audienceUserId: scope.audience.userId } : {}),
  }
}
function decodeScope(record: Readonly<Record<string, unknown>>): FolderViewScope {
  if (record.schemaVersion !== 1) throw new Error('FolderView: unsupported schemaVersion')
  const folderKey = text(record.folderKey, 'folderKey')
  if (folderKey !== 'root' && (!folderKey.startsWith('folder:') || !folderKey.slice(7).trim())) {
    throw new Error('FolderView: invalid folderKey')
  }
  const audienceKind = oneOf(record.audienceKind, ['shared', 'personal'], 'audienceKind')
  if (audienceKind === 'shared' && record.audienceUserId !== undefined) {
    throw new Error('FolderView: shared audience cannot carry audienceUserId')
  }
  const scope: FolderViewScope = {
    ownerId: text(record.ownerId, 'ownerId'), graphId: text(record.graphId, 'graphId'),
    graphIncarnation: text(record.graphIncarnation, 'graphIncarnation'),
    folderId: folderKey === 'root' ? null : folderKey.slice(7), viewId: text(record.viewId, 'viewId'),
    audience: audienceKind === 'shared' ? { kind: 'shared' } : {
      kind: 'personal', userId: text(record.audienceUserId, 'audienceUserId'),
    },
  }
  folderViewKey(scope)
  return scope
}

/** SHA256 identity is a wire convention, conditional on collision resistance. */
export async function folderObjectId(record: DomainRecord): Promise<string> {
  const placement = 'file' in record
  const key = placement ? filePlacementKey(record) : folderViewKey(record.scope)
  const digest = new Uint8Array(await sha256Digest(new TextEncoder().encode(key)))
  return `${placement ? 'fp' : 'fv'}-${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function folderObjectWireRecord(record: DomainRecord): Promise<Record<string, unknown>> {
  if (record.schemaVersion !== 1) throw new Error('FolderView: unsupported schemaVersion')
  const common = { ...scopeFields(record.scope), localId: await folderObjectId(record) }
  if ('file' in record) {
    filePlacementKey(record)
    oneOf(record.file.kind, ['folder', 'document', 'artifact'], 'fileKind')
    return { kind: 'FilePlacement', ...common, fileKind: record.file.kind, fileId: record.file.id,
      coordinateSpace: record.coordinateSpace, x: record.x, y: record.y }
  }
  oneOf(record.presentation, ['canvas', 'list'], 'presentation')
  oneOf(record.sort, ['manual', 'name', 'type', 'modified'], 'sort')
  oneOf(record.direction, ['asc', 'desc'], 'direction')
  oneOf(record.iconSize, ['small', 'medium', 'large'], 'iconSize')
  if (typeof record.snapToGrid !== 'boolean') throw new Error('FolderView: invalid snapToGrid')
  return { kind: 'FolderView', ...common, presentation: record.presentation, sort: record.sort,
    direction: record.direction, iconSize: record.iconSize, snapToGrid: record.snapToGrid }
}

/** A source face of the `garden-file-views` pack, decoded and checked for canonical identity (any reader of faces: the mirror or the HTTP read). */
export type FolderViewFace = Pick<SourceCurrentObject, 'record' | 'class' | 'objectId' | 'reconciliationStrategy'>
export async function decodeFolderViewFace(face: FolderViewFace): Promise<FolderViewRecord | FilePlacementRecord> { return decode(face) }

async function decode(face: FolderViewFace): Promise<DomainRecord> {
  const record = face.record
  if (record.kind !== face.class || record.localId !== face.objectId || face.reconciliationStrategy !== 'contested') {
    throw new Error('FolderView: incompatible source face')
  }
  const scope = decodeScope(record)
  let domain: DomainRecord
  if (face.class === 'FolderView') {
    if (typeof record.snapToGrid !== 'boolean') throw new Error('FolderView: invalid snapToGrid')
    domain = { schemaVersion: 1, scope,
      presentation: oneOf(record.presentation, ['canvas', 'list'], 'presentation'),
      sort: oneOf(record.sort, ['manual', 'name', 'type', 'modified'], 'sort'),
      direction: oneOf(record.direction, ['asc', 'desc'], 'direction'),
      iconSize: oneOf(record.iconSize, ['small', 'medium', 'large'], 'iconSize'), snapToGrid: record.snapToGrid }
  } else if (face.class === 'FilePlacement') {
    if (typeof record.x !== 'number' || typeof record.y !== 'number') throw new Error('FolderView: invalid coordinates')
    domain = { schemaVersion: 1, scope, coordinateSpace: oneOf(record.coordinateSpace, ['folder-canvas'], 'coordinateSpace'),
      x: record.x, y: record.y, file: { ownerId: scope.ownerId, graphId: scope.graphId,
        graphIncarnation: scope.graphIncarnation, kind: oneOf(record.fileKind, ['folder', 'document', 'artifact'], 'fileKind'),
        id: text(record.fileId, 'fileId') } }
    filePlacementKey(domain)
  } else throw new Error('FolderView: unknown source class')
  if (await folderObjectId(domain) !== face.objectId) throw new Error('FolderView: noncanonical source identity')
  return domain
}

export class FolderViewSourcePort implements FolderViewPort {
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly runtime: Runtime, private readonly ownerId: string) {}

  private bundle(scope: FolderViewScope): SourceBundle {
    folderViewKey(scope)
    if (scope.ownerId !== this.ownerId) throw new Error('FolderView: owner route changed')
    const bundle = this.runtime.bundleFor(scope.graphId)
    if (!bundle?.complete || !bundle.manifest.complete || bundle.provisional
      || bundle.graphId !== scope.graphId || bundle.graphIncarnation !== scope.graphIncarnation) {
      throw new Error('FolderView: no complete incarnation-matched source mirror')
    }
    for (const objectClass of ['FolderView', 'FilePlacement']) {
      if (!bundle.sourceRegistry.some(entry => entry.vocab === FOLDER_VIEW_VOCAB && entry.class === objectClass
        && entry.sourceKind === 'current-state' && entry.storeTarget === 'projection:file-views'
        && entry.reconciliationStrategy === 'contested')) {
        throw new Error('FolderView: canonical source pack is not installed')
      }
    }
    return bundle
  }

  async readView(scope: FolderViewScope): Promise<FolderViewRead<FolderViewRecord>> {
    await this.runtime.open(scope.graphId)
    const bundle = this.bundle(scope)
    const id = await folderObjectId({ schemaVersion: 1, scope, presentation: 'canvas', sort: 'manual',
      direction: 'asc', iconSize: 'medium', snapToGrid: false })
    const faces = bundle.currentState.filter(face => face.vocab === FOLDER_VIEW_VOCAB && face.class === 'FolderView' && face.objectId === id)
    if (faces.length > 1) throw new Error('FolderView: duplicate source faces')
    if (!faces.length) return { record: null, baseVersion: 'root', conflictId: null }
    const face = faces[0]
    const record = await decode(face) as FolderViewRecord
    if (folderViewKey(record.scope) !== folderViewKey(scope)) throw new Error('FolderView: source scope mismatch')
    return { record, baseVersion: text(face.sourceVersion, 'sourceVersion'), conflictId: face.conflictId ?? null }
  }

  async readPlacements(scope: FolderViewScope): Promise<readonly FolderViewRead<FilePlacementRecord>[]> {
    await this.runtime.open(scope.graphId)
    const bundle = this.bundle(scope)
    const selected: FolderViewRead<FilePlacementRecord>[] = []
    const ids = new Set<string>()
    for (const face of bundle.currentState) {
      if (face.vocab !== FOLDER_VIEW_VOCAB || face.class !== 'FilePlacement') continue
      const record = await decode(face) as FilePlacementRecord
      if (folderViewKey(record.scope) !== folderViewKey(scope)) continue
      if (ids.has(face.objectId)) throw new Error('FolderView: duplicate placement source faces')
      ids.add(face.objectId)
      selected.push({ record, baseVersion: text(face.sourceVersion, 'sourceVersion'), conflictId: face.conflictId ?? null })
    }
    return selected
  }

  writeView(write: FolderViewWrite<FolderViewRecord>): Promise<FolderViewWriteResult> { return this.write('FolderView', write) }
  writePlacement(write: FolderViewWrite<FilePlacementRecord>): Promise<FolderViewWriteResult> { return this.write('FilePlacement', write) }

  private async outcome(row: SourceOutboxRecord, scope: FolderViewScope, objectClass: ObjectClass, objectId: string): Promise<FolderViewWriteResult> {
    const operationId = row.operation.operationId
    if (row.status === 'rejected-stale' || row.status === 'rejected-permanent') {
      return { status: 'rejected', operationId, reason: row.error ?? row.status }
    }
    const receipt = row.receipt
    if (!receipt || receipt.status !== 'applied' || receipt.digest === 'local-unacknowledged') return { status: 'pending', operationId }
    if (receipt.operationId !== operationId || receipt.digest !== await sourceOperationDigest(row.operation)
      || row.graphIncarnation !== scope.graphIncarnation) throw new Error('FolderView: receipt identity/digest mismatch')
    const bundle = this.bundle(scope)
    const face = bundle.currentState.find(face => face.vocab === FOLDER_VIEW_VOCAB && face.class === objectClass && face.objectId === objectId)
    if (face?.conflictId) return { status: 'contested', operationId, conflictId: face.conflictId }
    if (receipt.outcome.outcome === 'conflict' && bundle.revision < receipt.acceptedRevision
      && typeof receipt.outcome.conflictId === 'string' && receipt.outcome.conflictId) {
      return { status: 'contested', operationId, conflictId: receipt.outcome.conflictId }
    }
    if (face?.operationId !== operationId || bundle.revision < receipt.acceptedRevision) return { status: 'pending', operationId }
    if (receipt.outcome.sourceVersion !== face.sourceVersion) throw new Error('FolderView: receipt/readback version mismatch')
    await decode(face)
    return { status: 'applied', operationId, version: text(face.sourceVersion, 'sourceVersion') }
  }

  private write(objectClass: ObjectClass, write: FolderViewWrite<DomainRecord>): Promise<FolderViewWriteResult> {
    const result = this.writes.then(() => this.writeNow(objectClass, write))
    this.writes = result.then(() => undefined, () => undefined)
    return result
  }

  private async writeNow(objectClass: ObjectClass, write: FolderViewWrite<DomainRecord>): Promise<FolderViewWriteResult> {
    const { scope } = write.record
    const manager = await this.runtime.open(scope.graphId)
    if (!write.baseVersion.trim()) return { status: 'rejected', operationId: write.operationId, reason: 'Missing observed base version' }
    const record = await folderObjectWireRecord(write.record)
    // Hashing/storage may yield; recheck the authority after preceding writes.
    const bundle = this.bundle(scope)
    if (record.kind !== objectClass) throw new Error('FolderView: write class mismatch')
    const objectId = record.localId as string
    const operation: SourceOperation = { kind: 'currentState', operationId: write.operationId,
      vocab: FOLDER_VIEW_VOCAB, class: objectClass, objectId, baseVersion: write.baseVersion, record }
    const existing = manager.outboxRecords().find(row => row.operation.operationId === write.operationId)
    // enqueue performs the existing durable equal-payload retry/changed-payload rejection.
    if (existing) {
      const row = await manager.enqueue(operation)
      this.runtime.backgroundSync(scope.graphId)
      return this.outcome(row, scope, objectClass, objectId)
    }
    const face = bundle.currentState.find(face => face.vocab === FOLDER_VIEW_VOCAB && face.class === objectClass && face.objectId === objectId)
    if (face?.conflictId) return { status: 'contested', operationId: write.operationId, conflictId: face.conflictId }
    const unpulledContest = manager.outboxRecords().find(row => row.operation.vocab === FOLDER_VIEW_VOCAB
      && row.operation.objectId === objectId && row.status === 'conflict'
      && row.receipt && row.receipt.acceptedRevision > bundle.revision)
    if (unpulledContest) {
      const result = await this.outcome(unpulledContest, scope, objectClass, objectId)
      if (result.status === 'contested') return { ...result, operationId: write.operationId }
      return { status: 'rejected', operationId: write.operationId, reason: 'Previous object contest needs source readback; retain this draft' }
    }
    if (manager.outboxRecords().some(row => row.operation.vocab === FOLDER_VIEW_VOCAB
      && row.operation.objectId === objectId && (row.status === 'pending' || row.status === 'accepted'))) {
      return { status: 'rejected', operationId: write.operationId, reason: 'Previous object write is still pending; retain this draft' }
    }
    const row = await manager.enqueue(operation)
    this.runtime.backgroundSync(scope.graphId)
    return this.outcome(row, scope, objectClass, objectId)
  }
}
