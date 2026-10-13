// @vitest-environment node
/**
 * The Files pane's mediated shell commands: every edit goes through the cell's contract (PATCH, the trash, the MCP folder
 * tools), is announced once, and can be undone from the announcement. Driven over real HTTP against a server that speaks
 * CONTRACT-files v1; the listing the commands see is re-read from the server after each change, as the shell re-reads it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesClient } from '../files-contract.js'
import { FilesCommands, filesTreeFromListing, type FilesTreeView } from '../files-commands.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
let tree: FilesTreeView
let commands: FilesCommands
let ids = 0

async function refresh(): Promise<void> {
  const response = await fetch(`${server.base}/navigation/${server.graphId}`, { headers: { Authorization: `Bearer ${server.token}` } })
  const listing = await response.json() as { folders: unknown[]; artifacts: unknown[] }
  tree = filesTreeFromListing(listing.folders, listing.artifacts)
}
function sized(name: string, size: number): File {
  const file = new File([new Uint8Array(Math.min(size, 16))], name)
  if (size > 16) Object.defineProperty(file, 'size', { value: size })
  return file
}
const posts = () => server.requests.filter(r => r.method === 'POST' && r.path.endsWith('/files'))

beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
  await refresh()
  commands = new FilesCommands({ client, graphId: server.graphId, tree: () => tree, refresh, maxUploadBytes: 52_428_800,
    newId: kind => `${kind}-${++ids}` })
})
afterEach(async () => { await server.close() })

describe('upload', () => {
  it('refuses a file over 50 MB before sending it, uploads the rest, and says both in one message', async () => {
    const result = await commands.upload([sized('notes.txt', 5), sized('Field recording.mov', 63_000_000)], null)
    expect(posts().map(r => r.bytes)).toEqual([5])
    expect(result).toMatchObject({ ok: true,
      message: 'Uploaded “notes.txt”. “Field recording.mov” is 60.1 MB, over the 50 MB limit for one file. It was not uploaded.' })
    expect(tree.children(null).map(e => e.label)).toEqual(['notes.txt'])
  })

  it('a refusal alone is not a success, and nothing is sent', async () => {
    const result = await commands.upload([sized('huge.iso', 52_428_801)], null)
    expect(result.ok).toBe(false)
    expect(result.undo).toBeNull()
    expect(posts()).toEqual([])
  })

  it('uploads into the viewed folder; Undo puts the uploads in the trash, Redo brings them back', async () => {
    await commands.createFolder('Datasheets', null)
    const folder = tree.children(null).find(e => e.kind === 'folder')!
    const result = await commands.upload([sized('a.pdf', 3), sized('b.png', 4)], folder.id)
    expect(result.message).toBe('Uploaded 2 files.')
    expect(tree.children(folder.id).map(e => e.label).sort()).toEqual(['a.pdf', 'b.png'])
    expect((await commands.undo()).message).toBe('Undid: Uploaded 2 files.')
    expect(tree.children(folder.id)).toEqual([])
    expect(server.trash.size).toBe(2)
    expect((await commands.redo()).message).toBe('Redid: Uploaded 2 files.')
    expect(tree.children(folder.id).map(e => e.label).sort()).toEqual(['a.pdf', 'b.png'])
  })
})

describe('rename', () => {
  it('renames a file with PATCH and a folder with the MCP tool; Undo restores the old name', async () => {
    await commands.upload([sized('draft.txt', 2)], null)
    await commands.createFolder('Untitled folder', null)
    const file = tree.children(null).find(e => e.kind === 'artifact')!
    const folder = tree.children(null).find(e => e.kind === 'folder')!
    expect((await commands.rename(file, 'final.txt')).message).toBe('Renamed “draft.txt” to “final.txt”.')
    expect((await commands.rename(folder, 'Invoices')).message).toBe('Renamed “Untitled folder” to “Invoices”.')
    expect(server.requests.filter(r => r.method === 'PATCH')).toHaveLength(1)
    expect(server.requests.filter(r => r.tool === 'rename')).toHaveLength(1)
    await commands.undo()
    expect(tree.get('folder', folder.id)?.label).toBe('Untitled folder')
    await commands.undo()
    expect(tree.get('artifact', file.id)?.label).toBe('draft.txt')
  })

  it('refuses an empty name without asking the cell', async () => {
    await commands.upload([sized('a.txt', 2)], null)
    const file = tree.children(null)[0]!
    const before = server.requests.length
    expect(await commands.rename(file, '   ')).toMatchObject({ ok: false, message: 'A name cannot be empty.' })
    expect(server.requests.length).toBe(before)
  })
})

describe('move', () => {
  it('moves files and folders into a folder, one message; Undo puts each back where it was', async () => {
    await commands.createFolder('Archive', null)
    await commands.createFolder('Old', null)
    await commands.upload([sized('a.txt', 2)], null)
    const archive = tree.children(null).find(e => e.label === 'Archive')!
    const old = tree.children(null).find(e => e.label === 'Old')!
    const file = tree.children(null).find(e => e.label === 'a.txt')!
    expect((await commands.move([file, old], archive.id)).message).toBe('Moved 2 items to “Archive”.')
    expect(tree.children(archive.id).map(e => e.label).sort()).toEqual(['Old', 'a.txt'])
    expect((await commands.undo()).message).toBe('Undid: Moved 2 items to “Archive”.')
    expect(tree.children(null).map(e => e.label).sort()).toEqual(['Archive', 'Old', 'a.txt'])
    await commands.move([file], archive.id)
    expect((await commands.move([tree.get('artifact', file.id)!], null)).message).toBe('Moved “a.txt” to Files.')
  })

  it('refuses a folder moved inside itself, without asking the cell', async () => {
    await commands.createFolder('Outer', null)
    const outer = tree.children(null)[0]!
    await commands.createFolder('Inner', outer.id)
    const inner = tree.children(outer.id)[0]!
    const before = server.requests.length
    expect(await commands.move([outer], inner.id)).toMatchObject({ ok: false, message: 'A folder cannot be moved inside itself.' })
    expect(server.requests.length).toBe(before)
  })
})

describe('remove: recoverable', () => {
  it('puts a file in the trash; Undo restores it where it was', async () => {
    await commands.upload([sized('a.txt', 2)], null)
    const file = tree.children(null)[0]!
    expect((await commands.remove([file])).message).toBe('Moved “a.txt” to the trash.')
    expect(tree.children(null)).toEqual([])
    expect(server.trash.has(file.id)).toBe(true)
    expect(server.requests.some(r => r.method === 'DELETE' && r.path === `/navigation/${server.graphId}/artifacts/${file.id}`)).toBe(true)
    await commands.undo()
    expect(tree.children(null).map(e => e.label)).toEqual(['a.txt'])
  })

  it('removes a folder by trashing every file in it and deleting the emptied folders, never a cascade; Undo rebuilds it', async () => {
    await commands.createFolder('Project', null)
    const project = tree.children(null)[0]!
    await commands.createFolder('Drafts', project.id)
    const drafts = tree.children(project.id)[0]!
    await commands.upload([sized('plan.pdf', 3)], project.id)
    await commands.upload([sized('v1.txt', 2), sized('v2.txt', 2)], drafts.id)
    expect((await commands.remove([project])).message).toBe('Moved “Project” and the 3 files in it to the trash.')
    expect(tree.children(null)).toEqual([])
    expect(server.trash.size).toBe(3)
    const deletes = server.requests.filter(r => r.tool === 'delete')
    expect(deletes).toHaveLength(2)
    await commands.undo()
    expect(tree.get('folder', project.id)?.label).toBe('Project')
    expect(tree.get('folder', drafts.id)?.parentId).toBe(project.id)
    expect(tree.children(drafts.id).map(e => e.label).sort()).toEqual(['v1.txt', 'v2.txt'])
    expect(tree.children(project.id).map(e => e.label).sort()).toEqual(['Drafts', 'plan.pdf'])
    expect(server.trash.size).toBe(0)
  })

  it('when the cell refuses to delete a folder, what already went to the trash is said and can be undone', async () => {
    await commands.createFolder('Box', null)
    const box = tree.children(null)[0]!
    await commands.upload([sized('a.txt', 2)], box.id)
    // Something the Files tree does not show keeps the folder occupied (a documents-section folder inside it).
    server.folders.set('folder-notes', { id: 'folder-notes', name: 'Notes', parentId: box.id, section: 'documents', order: 99 })
    await refresh()
    const result = await commands.remove([box])
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/^Couldn't move everything to the trash: .*folder is not empty.*\. “a\.txt” was moved to the trash; Undo brings it back\.$/)
    expect(result.undo).toBe('Undo')
    expect(server.trash.size).toBe(1)
    expect(server.folders.has(box.id)).toBe(true)
    expect((await commands.undo()).ok).toBe(true)
    expect(tree.children(box.id).map(e => e.label)).toEqual(['a.txt'])
    expect(server.trash.size).toBe(0)
  })

  it('Undo of a removal does not fail on a file someone already brought back, and rebuilds the folder', async () => {
    await commands.createFolder('Shelf', null)
    const shelf = tree.children(null)[0]!
    await commands.upload([sized('b.txt', 2)], shelf.id)
    const file = tree.children(shelf.id)[0]!
    await commands.remove([shelf])
    await client.restore(server.graphId, file.id)          // another client restored it (to the root: its folder was gone)
    await refresh()
    const undone = await commands.undo()
    expect(undone).toMatchObject({ ok: true })
    expect(tree.get('folder', shelf.id)?.label).toBe('Shelf')
    expect(tree.get('artifact', file.id)).not.toBeNull()
  })
})

describe('create folder, and an Undo that would be wrong', () => {
  it('creates a Files folder; Undo deletes it while it is empty', async () => {
    const result = await commands.createFolder('Receipts', null)
    expect(result.message).toBe('Created “Receipts”.')
    expect(server.folders.get(result.folderId!)).toMatchObject({ name: 'Receipts', section: 'artifacts' })
    await commands.undo()
    expect(server.folders.has(result.folderId!)).toBe(false)
  })

  it('refuses to undo a create once someone has put a file in the folder, and keeps the entry', async () => {
    const result = await commands.createFolder('Shared', null)
    await client.upload(server.graphId, new File(['x'], 'theirs.txt'), { parentId: result.folderId!, artifactId: 'file-theirs' })
    await refresh()
    expect(await commands.undo()).toMatchObject({ ok: false, message: 'Can\'t undo: “Shared” is no longer empty.' })
    expect(commands.canUndo).toBe(true)
  })

  it('refuses to undo a rename of a file that is no longer here', async () => {
    await commands.upload([sized('draft.txt', 2)], null)
    const file = tree.children(null)[0]!
    await commands.rename(file, 'final.txt')
    await client.trash(server.graphId, file.id)
    await refresh()
    expect(await commands.undo()).toMatchObject({ ok: false, message: 'Can\'t undo: “final.txt” is no longer here.' })
  })
})
