// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createProvisionalSourceBundle, MemorySourceMirrorStorage, SourceMirrorManager, sourceOperationDigest,
  type SourceBundle, type SourceCurrentObject, type SourceOperation,
} from '@shrubbery/source'
import type { FilePlacementRecord, FolderViewRecord, FolderViewScope } from '@shrubbery/nucleus'
import { FOLDER_VIEW_VOCAB, FolderViewSourcePort, folderObjectId, folderObjectWireRecord } from './folder-view-source-port.js'

const scope: FolderViewScope = { ownerId: 'owner', graphId: 'fixture',
  graphIncarnation: '2ebc60de-ff17-402e-9fc9-e0c7f0c843eb', folderId: null, viewId: 'files-default', audience: { kind: 'shared' } }
const view: FolderViewRecord = { schemaVersion: 1, scope, presentation: 'canvas', sort: 'manual',
  direction: 'asc', iconSize: 'medium', snapToGrid: false }
const placement: FilePlacementRecord = { schemaVersion: 1, scope, coordinateSpace: 'folder-canvas', x: 12, y: 30,
  file: { ownerId: scope.ownerId, graphId: scope.graphId, graphIncarnation: scope.graphIncarnation, kind: 'artifact', id: 'same:id' } }

async function fixture(conflict = false) {
  // Synthetic transport fixture, not a native Garden qualification. Manager still performs durable digest/retry validation.
  const initial = await createProvisionalSourceBundle({ graphId: scope.graphId, graphIncarnation: scope.graphIncarnation, workspaceUpdateBase64: '', now: 1 })
  let readback: SourceBundle = { ...initial, provisional: false, sourceRegistry: ['FolderView', 'FilePlacement'].map(objectClass => ({
    vocab: FOLDER_VIEW_VOCAB, class: objectClass, sourceKind: 'current-state',
    storeTarget: 'projection:file-views', reconciliationStrategy: 'contested',
  })) }
  const pushed: SourceOperation[] = []
  const manager = new SourceMirrorManager({ identity: { userId: 'caller', graphId: scope.graphId },
    storage: new MemorySourceMirrorStorage(), transport: {
      pull: async () => readback,
      push: async (graphId, graphIncarnation, operations) => {
        pushed.push(...operations)
        return { ok: true, graphId, graphIncarnation, revision: 1, receipts: await Promise.all(operations.map(async operation => ({
          operationId: operation.operationId, digest: await sourceOperationDigest(operation), acceptedRevision: 1,
          status: 'applied' as const, duplicate: false, outcome: { outcome: conflict ? 'conflict' : 'applied',
            ...(conflict ? { conflictId: 'contest:unpulled' } : {}), sourceVersion: `version:${operation.operationId}` },
        }))) }
      },
    } })
  await manager.bootstrap(readback)
  let wakes = 0
  const port = new FolderViewSourcePort({ open: async () => manager, bundleFor: () => readback,
    backgroundSync: () => { wakes++ } }, scope.ownerId)
  return { port, manager, pushed, wakes: () => wakes,
    replace: (next: SourceBundle) => { readback = next }, bundle: () => readback,
    face: async (record: FolderViewRecord | FilePlacementRecord, operationId: string): Promise<SourceCurrentObject> => {
      const wire = await folderObjectWireRecord(record)
      return { objectKey: `${FOLDER_VIEW_VOCAB}/${wire.kind}/${wire.localId}`, vocab: FOLDER_VIEW_VOCAB,
        class: wire.kind as string, objectId: wire.localId as string, record: wire,
        sourceVersion: `version:${operationId}`, reconciliationStrategy: 'contested', operationId }
    },
  }
}

describe('canonical folder source port / synthetic transport', () => {
  it('requires installed complete matched authority before reporting root absence', async () => {
    const f = await fixture()
    expect(await f.port.readView(scope)).toEqual({ record: null, baseVersion: 'root', conflictId: null })
    f.replace({ ...f.bundle(), sourceRegistry: [] })
    await expect(f.port.readView(scope)).rejects.toThrow('not installed')
    f.replace({ ...f.bundle(), sourceRegistry: [], complete: false })
    await expect(f.port.readView(scope)).rejects.toThrow('complete')
  })
  it('preserves exact observed base, queues durable pending, and never fabricates clocks', async () => {
    const f = await fixture()
    const write = { operationId: 'drag:one', baseVersion: 'observed-old-base', record: placement }
    expect(await f.port.writePlacement(write)).toEqual({ status: 'pending', operationId: write.operationId })
    await f.manager.flush()
    expect(f.pushed[0]).toMatchObject({ kind: 'currentState', baseVersion: 'observed-old-base', vocab: FOLDER_VIEW_VOCAB })
    expect(f.pushed[0]).not.toHaveProperty('causalOrder')
    expect(f.pushed[0]).not.toHaveProperty('clientId')
    // Even an applied receipt cannot invent absent readback.
    expect(await f.port.writePlacement(write)).toEqual({ status: 'pending', operationId: write.operationId })
    f.replace({ ...f.bundle(), revision: 1, currentState: [await f.face(placement, write.operationId)] })
    expect(await f.port.writePlacement(write)).toEqual({ status: 'applied', operationId: write.operationId, version: `version:${write.operationId}` })
    expect(f.pushed).toHaveLength(1)
  })
  it('rejects altered operation retry through the real source mirror digest path', async () => {
    const f = await fixture()
    await f.port.writeView({ operationId: 'prefs:one', baseVersion: 'root', record: view })
    await expect(f.port.writeView({ operationId: 'prefs:one', baseVersion: 'root', record: { ...view, iconSize: 'large' } })).rejects.toThrow('reused')
    expect(f.manager.outboxRecords()).toHaveLength(1)
  })
  it('fences another same-object draft while pending but admits a disjoint placement', async () => {
    const f = await fixture()
    await f.port.writePlacement({ operationId: 'drag:one', baseVersion: 'root', record: placement })
    expect(await f.port.writePlacement({ operationId: 'drag:two', baseVersion: 'root', record: { ...placement, x: 50 } })).toMatchObject({ status: 'rejected' })
    expect(await f.port.writePlacement({ operationId: 'drag:other', baseVersion: 'root', record: { ...placement, file: { ...placement.file, id: 'other' } } })).toMatchObject({ status: 'pending' })
    expect(f.manager.outboxRecords()).toHaveLength(2)
  })
  it('serializes concurrent same-object gestures through durable enqueue', async () => {
    const f = await fixture()
    const results = await Promise.all([
      f.port.writePlacement({ operationId: 'drag:concurrent-a', baseVersion: 'root', record: placement }),
      f.port.writePlacement({ operationId: 'drag:concurrent-b', baseVersion: 'root', record: { ...placement, x: 100 } }),
      f.port.writePlacement({ operationId: 'drag:concurrent-other', baseVersion: 'root', record: { ...placement, file: { ...placement.file, id: 'other' } } }),
    ])
    expect(results.map(result => result.status)).toEqual(['pending', 'rejected', 'pending'])
    expect(f.manager.outboxRecords().map(row => row.operation.operationId)).toEqual(['drag:concurrent-a', 'drag:concurrent-other'])
  })
  it('preserves a contest and does not auto-rebase it', async () => {
    const f = await fixture()
    f.replace({ ...f.bundle(), currentState: [{ ...await f.face(placement, 'old'), conflictId: 'contest:one' }] })
    expect((await f.port.readPlacements(scope))[0].conflictId).toBe('contest:one')
    expect(await f.port.writePlacement({ operationId: 'drag:new', baseVersion: 'version:old', record: placement })).toEqual({ status: 'contested', operationId: 'drag:new', conflictId: 'contest:one' })
    expect(f.manager.outboxRecords()).toHaveLength(0)
  })
  it('fences a confirmed contest during the gap before its source pull completes', async () => {
    const f = await fixture(true)
    const write = { operationId: 'drag:conflicted', baseVersion: 'root', record: placement }
    await f.port.writePlacement(write)
    await f.manager.flush()
    expect(await f.port.writePlacement(write)).toEqual({ status: 'contested', operationId: write.operationId, conflictId: 'contest:unpulled' })
    expect(await f.port.writePlacement({ ...write, operationId: 'drag:another' }))
      .toEqual({ status: 'contested', operationId: 'drag:another', conflictId: 'contest:unpulled' })
    expect(f.manager.outboxRecords()).toHaveLength(1)
  })
  it('rejects owner/lifetime mismatch and malformed flat records on read', async () => {
    const f = await fixture()
    await expect(f.port.readView({ ...scope, ownerId: 'foreign' })).rejects.toThrow('owner route')
    await expect(f.port.readView({ ...scope, graphIncarnation: 'changed' })).rejects.toThrow('incarnation')
    const face = await f.face(placement, 'old')
    f.replace({ ...f.bundle(), currentState: [{ ...face, record: { ...face.record, x: '12' } }] })
    await expect(f.port.readPlacements(scope)).rejects.toThrow('coordinates')
  })
  it('separates full scope, percent/slash/Unicode and file kind identities', async () => {
    const keys = await Promise.all([placement,
      { ...placement, scope: { ...scope, folderId: 'root' } },
      { ...placement, file: { ...placement.file, kind: 'document' as const } },
      { ...placement, scope: { ...scope, folderId: 'résumé/%/資料' } },
    ].map(folderObjectId))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every(key => /^fp-[a-f0-9]{64}$/.test(key))).toBe(true)
  })
  it('matches exact shared Rust/TS identity vectors', async () => {
    expect(await folderObjectId({ ...view, scope: { ...scope, ownerId: 'owner', graphId: 'graph', graphIncarnation: 'inc' } }))
      .toBe('fv-6af78db18c6b455722e9193457bec0ca46dfdb5afed6e8d6905109defb342673')
    const personal: FolderViewScope = { ownerId: 'Owner/Team', graphId: 'graph%2Fone', graphIncarnation: 'inc✓',
      folderId: 'power/supply %', viewId: 'files/default', audience: { kind: 'personal', userId: 'Ada / 李' } }
    const record: FilePlacementRecord = { ...placement, scope: personal, file: { ownerId: personal.ownerId,
      graphId: personal.graphId, graphIncarnation: personal.graphIncarnation, kind: 'document', id: 'manual/100% 🧾' } }
    expect(await folderObjectId(record)).toBe('fp-04526a84ce21b47f194d4dbe453361f6b5f784e889f8e8f379bee27b03c963f4')
    expect(await folderObjectId({ ...record, file: { ...record.file, kind: 'artifact' } }))
      .toBe('fp-191b17854a4dd413ccfa2a3d9f69fb57fda636aa67b0b485acc28dd49e495732')
  })
})
