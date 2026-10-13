// @vitest-environment node
/**
 * The shell's client for CONTRACT-files v1, over real HTTP to a server that speaks the contract
 * (support/files-contract-server.ts). Capability gating, upload, download, rename/move, the trash, file views.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesClient, FilesContractError, readFilesAdvert } from '../files-contract.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
})
afterEach(async () => { await server.close() })

describe('capability: does this cell serve Files?', () => {
  it('reads the advert only when files.version is 1', () => {
    expect(readFilesAdvert({})).toBeNull()
    expect(readFilesAdvert({ files: null })).toBeNull()
    expect(readFilesAdvert({ files: { maxUploadBytes: 52_428_800 } })).toBeNull()
    expect(readFilesAdvert({ files: { version: 2, maxUploadBytes: 52_428_800 } })).toBeNull()
    expect(readFilesAdvert({ files: { version: 1, maxUploadBytes: 52_428_800, parsing: false } }))
      .toMatchObject({ version: 1, maxUploadBytes: 52_428_800, parsing: false })
  })

  it('falls back to the contract cap when the advert has no usable number, and never raises it past what is advertised', () => {
    expect(readFilesAdvert({ files: { version: 1 } })?.maxUploadBytes).toBe(52_428_800)
    expect(readFilesAdvert({ files: { version: 1, maxUploadBytes: 1024 } })?.maxUploadBytes).toBe(1024)
    expect(readFilesAdvert({ files: { version: 1, maxUploadBytes: -5 } })?.maxUploadBytes).toBe(52_428_800)
  })

  it('asks the cell once, with the bearer, and hides Files for a cell older than the contract', async () => {
    expect(await client.capabilities(server.graphId)).toMatchObject({ version: 1, maxUploadBytes: 52_428_800 })
    const old = await startFilesContractServer({ advertise: false })
    try {
      expect(await new FilesClient(contractFor(old), mcpFor(old)).capabilities(old.graphId)).toBeNull()
      expect(old.requests.map(r => `${r.method} ${r.path}`)).toEqual(['GET /api/capabilities'])
    } finally { await old.close() }
  })
})

describe('upload: any type, no parsing', () => {
  it('posts one multipart file into a Files folder and returns the stored artifact', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-a', name: 'Datasheets', parentId: null })
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'blob.bin', { type: 'application/x-thing' })
    const stored = await client.upload(server.graphId, file, { parentId: 'folder-a', artifactId: 'file-one' })
    expect(stored).toMatchObject({ id: 'file-one', label: 'blob.bin', parentId: 'folder-a', mimeType: 'application/x-thing',
      sizeBytes: 4, fileType: 'bin', replayed: false })
    expect(server.folders.get('folder-a')?.section).toBe('artifacts')
    expect(server.requests.find(r => r.path.endsWith('/files'))).toMatchObject({ method: 'POST', path: `/artifacts/${server.graphId}/files`, bytes: 4 })
  })

  it('a retry with the same id and bytes is a replay, never a second file', async () => {
    const file = new File(['same'], 'same.txt', { type: 'text/plain' })
    await client.upload(server.graphId, file, { parentId: null, artifactId: 'file-retry' })
    const again = await client.upload(server.graphId, file, { parentId: null, artifactId: 'file-retry' })
    expect(again.replayed).toBe(true)
    expect(server.artifacts.size).toBe(1)
  })

  it('reports the cell\'s refusals by code: too large, empty, unknown folder', async () => {
    const small = await startFilesContractServer({ maxUploadBytes: 8 })
    try {
      const smallClient = new FilesClient(contractFor(small), mcpFor(small))
      await expect(smallClient.upload(small.graphId, new File(['0123456789'], 'big.bin'), { parentId: null, artifactId: 'file-big' }))
        .rejects.toMatchObject({ name: 'FilesContractError', status: 413, code: 'file_too_large' })
    } finally { await small.close() }
    await expect(client.upload(server.graphId, new File([], 'empty.txt'), { parentId: null, artifactId: 'file-empty' }))
      .rejects.toMatchObject({ status: 400, code: 'empty_file' })
    await expect(client.upload(server.graphId, new File(['x'], 'x.txt'), { parentId: 'no-such-folder', artifactId: 'file-x' }))
      .rejects.toBeInstanceOf(FilesContractError)
  })
})

describe('download, rename and move, the trash', () => {
  it('downloads the exact bytes with the bearer', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
    await client.upload(server.graphId, new File([bytes], 'tiny.pdf', { type: 'application/pdf' }), { parentId: null, artifactId: 'file-pdf' })
    const blob = await client.download(server.graphId, 'file-pdf', { inline: true })
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
    expect(blob.type).toBe('application/pdf')
    expect(server.requests.at(-1)?.path).toBe(`/artifacts/${server.graphId}/file-pdf/download?inline=1`)
  })

  it('renames and moves with PATCH, leaving the other fields as they were', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-b', name: 'Archive', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'draft.txt', { type: 'text/plain' }), { parentId: null, artifactId: 'file-d' })
    expect(await client.update(server.graphId, 'file-d', { label: 'final.txt' })).toMatchObject({ label: 'final.txt', parentId: null, mimeType: 'text/plain' })
    expect(await client.update(server.graphId, 'file-d', { parentId: 'folder-b' })).toMatchObject({ label: 'final.txt', parentId: 'folder-b' })
    expect(server.requests.filter(r => r.method === 'PATCH')).toHaveLength(2)
    expect(server.requests.some(r => r.method === 'PUT')).toBe(false)
  })

  it('trashes and restores a file; restored to its folder if it is still there, else to the root', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-c', name: 'Keep', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'one.txt'), { parentId: 'folder-c', artifactId: 'file-1' })
    await client.upload(server.graphId, new File(['y'], 'two.txt'), { parentId: 'folder-c', artifactId: 'file-2' })
    expect(await client.trash(server.graphId, 'file-1')).toMatchObject({ alreadyTrashed: false })
    expect(await client.trash(server.graphId, 'file-1')).toMatchObject({ alreadyTrashed: true })
    expect((await client.listTrash(server.graphId)).map(item => item.artifactId)).toEqual(['file-1'])
    expect(await client.restore(server.graphId, 'file-1')).toMatchObject({ id: 'file-1', restoredToParentId: 'folder-c' })
    await client.trash(server.graphId, 'file-2')
    await client.update(server.graphId, 'file-1', { parentId: null })
    await client.deleteFolder(server.graphId, 'folder-c')
    expect(await client.restore(server.graphId, 'file-2')).toMatchObject({ restoredToParentId: null })
    await expect(client.restore(server.graphId, 'file-2')).rejects.toMatchObject({ status: 404, code: 'not_in_trash' })
  })

  it('creates, renames, moves and deletes Files folders through the MCP tools, in the artifacts section', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-p', name: 'Parent', parentId: null })
    await client.createFolder(server.graphId, { folderId: 'folder-q', name: 'Child', parentId: null })
    await client.renameFolder(server.graphId, 'folder-q', 'Renamed')
    await client.moveFolder(server.graphId, 'folder-q', 'folder-p')
    expect(server.folders.get('folder-q')).toMatchObject({ name: 'Renamed', parentId: 'folder-p', section: 'artifacts' })
    await expect(client.deleteFolder(server.graphId, 'folder-p')).rejects.toThrow('not empty')
    await client.deleteFolder(server.graphId, 'folder-q')
    expect(server.folders.has('folder-q')).toBe(false)
    expect(server.requests.filter(r => r.tool).map(r => r.tool)).toEqual(['create_folder', 'create_folder', 'rename', 'move_folder', 'delete', 'delete'])
  })
})

describe('file views: read over HTTP, write through source_push', () => {
  it('reads an empty ledger as defaults and writes one batch for many records', async () => {
    const empty = await client.readFileViews(server.graphId, { folderKey: 'root' })
    expect(empty).toMatchObject({ graphIncarnation: server.graphIncarnation, available: true, currentState: [] })
    const result = await client.pushFileViews(server.graphId, server.graphIncarnation, [
      { kind: 'currentState', operationId: 'op-1', vocab: 'garden-file-views', class: 'FilePlacement', objectId: 'fp-1', baseVersion: 'root',
        record: { kind: 'FilePlacement', localId: 'fp-1', folderKey: 'root' } },
      { kind: 'currentState', operationId: 'op-2', vocab: 'garden-file-views', class: 'FilePlacement', objectId: 'fp-2', baseVersion: 'root',
        record: { kind: 'FilePlacement', localId: 'fp-2', folderKey: 'root' } },
    ])
    expect(result.receipts.map(r => [r.operationId, r.outcome.outcome])).toEqual([['op-1', 'applied'], ['op-2', 'applied']])
    expect(server.requests.filter(r => r.tool === 'source_push')).toHaveLength(1)
    expect((await client.readFileViews(server.graphId, { folderKey: 'root' })).currentState.map(face => face.objectId).sort()).toEqual(['fp-1', 'fp-2'])
  })
})
