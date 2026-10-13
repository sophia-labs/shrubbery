// @vitest-environment node
/**
 * Folder-view preferences and placements over the contract's own paths: read with GET file-views, write with source_push
 * (never the offline mirror's source_pull, which one 50 MB file puts out of reach). Over real HTTP to a contract server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileKey, type FilePlacementRecord, type FolderViewScope, type WorkspaceFileRef } from '@shrubbery/nucleus'
import { FilesClient } from '../files-contract.js'
import { FilesLayoutController, FolderViewHttpPort } from '../files-layout.js'
import { folderObjectWireRecord } from '../folder-view-source-port.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
let scope: FolderViewScope
let changes = 0
let ops = 0
const ref = (id: string): WorkspaceFileRef => ({ ownerId: 'owner-1', graphId: server.graphId, graphIncarnation: server.graphIncarnation, kind: 'artifact', id })
const placement = (id: string, x: number, y: number): FilePlacementRecord =>
  ({ schemaVersion: 1, scope, file: ref(id), coordinateSpace: 'folder-canvas', x, y })
const settle = async (controller: FilesLayoutController) => {
  for (let i = 0; i < 50 && !controller.snapshot().ready; i++) await new Promise(r => setTimeout(r, 5))
}
function controller(writable = true): FilesLayoutController {
  const c = new FilesLayoutController(new FolderViewHttpPort(client, 'owner-1'), () => { changes++ }, () => `op-${++ops}`)
  c.bind(scope, 'epoch-1', writable)
  return c
}

beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
  scope = { ownerId: 'owner-1', graphId: server.graphId, graphIncarnation: server.graphIncarnation, folderId: null,
    viewId: 'files-default', audience: { kind: 'shared' } }
})
afterEach(async () => { await server.close() })

describe('folder-view preferences', () => {
  it('a folder never arranged reads as the defaults: canvas, medium icons, no grid', async () => {
    const c = controller(); await settle(c)
    expect(c.snapshot()).toMatchObject({ ready: true, available: true, placements: [], placementStates: {},
      view: { presentation: 'canvas', iconSize: 'medium', snapToGrid: false, sort: 'manual', direction: 'asc' } })
    expect(server.requests.map(r => r.path)).toEqual([`/navigation/${server.graphId}/file-views?folderKey=root`])
    expect(server.requests.some(r => r.tool === 'source_pull')).toBe(false)
  })

  it('saves a preference and reads it back: the face, the icon size, the grid', async () => {
    const c = controller(); await settle(c)
    await c.setView({ presentation: 'list' })
    await c.setView({ iconSize: 'large', snapToGrid: true })
    expect(c.snapshot().view).toMatchObject({ presentation: 'list', iconSize: 'large', snapToGrid: true })
    const fresh = controller(); await settle(fresh)
    expect(fresh.snapshot().view).toMatchObject({ presentation: 'list', iconSize: 'large', snapToGrid: true })
    expect(server.requests.filter(r => r.tool === 'source_push')).toHaveLength(2)
  })

  it('a viewer reads the preferences and never writes them', async () => {
    const c = controller(false); await settle(c)
    await c.setView({ presentation: 'list' })
    await c.place([placement('a', 10, 10)])
    expect(server.requests.some(r => r.tool === 'source_push')).toBe(false)
    expect(c.snapshot().view.presentation).toBe('canvas')
  })
})

describe('placements', () => {
  it('writes a drag of several cards as one source_push, locks those cards while it is in flight, and applies them', async () => {
    const c = controller(); await settle(c)
    const records = [placement('a', 40, 48), placement('b', 200, 48)]
    const writing = c.place(records)
    expect(c.snapshot().placementStates).toEqual({ [fileKey(ref('a'))]: 'pending', [fileKey(ref('b'))]: 'pending' })
    await writing
    expect(server.requests.filter(r => r.tool === 'source_push')).toHaveLength(1)
    expect(c.snapshot().placementStates).toEqual({})
    expect(c.snapshot().placements.map(p => [p.file.id, p.x, p.y]).sort()).toEqual([['a', 40, 48], ['b', 200, 48]])
    const fresh = controller(); await settle(fresh)
    expect(fresh.snapshot().placements.map(p => p.file.id).sort()).toEqual(['a', 'b'])
  })

  it('a write from a stale base comes back contested and locks that card, keeping the others free', async () => {
    const c = controller(); await settle(c)
    // Someone else places `a` after this controller read the folder.
    const theirs = await folderObjectWireRecord(placement('a', 999, 999))
    await client.pushFileViews(server.graphId, server.graphIncarnation, [{ kind: 'currentState', operationId: 'theirs', vocab: 'garden-file-views',
      class: 'FilePlacement', objectId: theirs.localId as string, baseVersion: 'root', record: theirs }])
    await c.place([placement('a', 10, 10), placement('b', 300, 10)])
    expect(c.snapshot().placementStates).toEqual({ [fileKey(ref('a'))]: 'contested' })
    expect(c.snapshot().message).toBe('Someone else moved the same file at the same time. Click the position you want to keep.')
    expect(changes).toBeGreaterThan(0)
  })
})

describe('a contested placement: two candidates, one choice', () => {
  async function contest(c: FilesLayoutController): Promise<void> {
    const theirs = await folderObjectWireRecord(placement('a', 999, 700))
    await client.pushFileViews(server.graphId, server.graphIncarnation, [{ kind: 'currentState', operationId: 'theirs', vocab: 'garden-file-views',
      class: 'FilePlacement', objectId: theirs.localId as string, baseVersion: 'root', record: theirs }])
    await c.place([placement('a', 10, 10)])
  }

  it('offers this tab\'s position and the cell\'s as labelled candidates, and nothing else is locked', async () => {
    const c = controller(); await settle(c)
    await contest(c)
    const [one] = c.snapshot().contests
    expect(c.snapshot().contests).toHaveLength(1)
    expect(one!.file.id).toBe('a')
    expect(one!.candidates.map(k => [k.id, k.origin, k.x, k.y])).toEqual([['mine', 'this-tab', 10, 10], ['theirs', 'other', 999, 700]])
    expect(one!.candidates.every(k => /^(this|other) tab · /.test(k.label))).toBe(true)
  })

  it('choosing a candidate writes it from the cell\'s version and ends the contest, for a fresh reader too', async () => {
    const c = controller(); await settle(c)
    await contest(c)
    await c.choose(ref('a'), 'mine')
    expect(c.snapshot().contests).toEqual([])
    expect(c.snapshot().placementStates).toEqual({})
    expect(c.snapshot().placements.map(p => [p.x, p.y])).toEqual([[10, 10]])
    const fresh = controller(); await settle(fresh)
    expect(fresh.snapshot().placements.map(p => [p.x, p.y])).toEqual([[10, 10]])
    expect(fresh.snapshot().contests).toEqual([])
  })

  it('a viewer cannot choose', async () => {
    const c = controller(false); await settle(c)
    await c.choose(ref('a'), 'mine')
    expect(server.requests.some(r => r.tool === 'source_push')).toBe(false)
  })
})

describe('a write whose outcome is not said yet', () => {
  it('is read back, so the next drag of the same card writes from the version the cell holds (no false contest)', async () => {
    server.deferWrites = true
    const c = controller(); await settle(c)
    await c.place([placement('a', 10, 10)])
    for (let i = 0; i < 60 && !c.snapshot().placements.some(p => p.x === 10); i++) await new Promise(r => setTimeout(r, 5))
    await new Promise(r => setTimeout(r, 300))
    server.deferWrites = false
    await c.place([placement('a', 50, 60)])
    expect(c.snapshot().placementStates).toEqual({})
    expect(c.snapshot().message ?? null).toBeNull()
    expect(c.snapshot().placements.map(p => [p.file.id, p.x, p.y])).toEqual([['a', 50, 60]])
  })
})

describe('a full preferences record (CONTRACT §7.1)', () => {
  it('a source_bundle_too_large refusal makes the layout unavailable for the session: the card goes back, nothing more is written', async () => {
    const c = controller(); await settle(c)
    await c.place([placement('a', 10, 10)])
    server.recordFull = true
    await c.place([placement('a', 90, 90)])
    expect(c.snapshot()).toMatchObject({ available: false,
      message: 'This workspace\'s saved layout is full, so new positions and view choices are not saved. Files work as usual.' })
    expect(c.snapshot().placements.map(p => [p.x, p.y])).toEqual([[10, 10]])
    const pushes = server.requests.filter(r => r.tool === 'source_push').length
    await c.setView({ presentation: 'list' })
    await c.place([placement('b', 5, 5)])
    await c.reload()
    expect(c.snapshot().available).toBe(false)
    expect(server.requests.filter(r => r.tool === 'source_push').length).toBe(pushes)
  })
})

