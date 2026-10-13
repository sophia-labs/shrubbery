// @vitest-environment node
/**
 * The Files pane as the shell composes it: hidden unless the cell advertises Files, the artifacts section as the tree,
 * canvas intents turned into mediated commands, preferences saved, opening routed by type. Over real HTTP to a server
 * that speaks CONTRACT-files v1, with the sidebar sections built by the shell's own tree builder.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilePaneSection, FileCanvasIntent, WorkspaceFileRef } from '@shrubbery/nucleus'
import { FilesClient, readFilesAdvert, type FilesAdvert } from '../files-contract.js'
import { FilesShell, type FilesShellBinding } from '../files-shell.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarFolder } from '../sidebar-documents.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
let sections: FilePaneSection[]
let shell: FilesShell
let advert: FilesAdvert | null
let menus: { labels: string[]; x: number; y: number; choose(label: string): void }[]

async function refresh(): Promise<void> {
  const response = await fetch(`${server.base}/navigation/${server.graphId}`, { headers: { Authorization: `Bearer ${server.token}` } })
  const listing = await response.json() as { folders: Record<string, unknown>[]; artifacts: Record<string, unknown>[] }
  const folders: SidebarFolder[] = listing.folders.map(f => ({ id: String(f.id), label: String(f.label), parentId: (f.parentId as string | null) ?? null,
    order: Number(f.order), section: f.section === 'artifacts' ? 'artifacts' : 'documents' }))
  const artifacts: SidebarArtifact[] = listing.artifacts.map(a => ({ id: String(a.id), label: String(a.label), parentId: (a.parentId as string | null) ?? null,
    order: Number(a.order), mimeType: String(a.mimeType), status: String(a.status), fileType: String(a.fileType) }))
  sections = sidebarSectionsFromDocuments([{ id: 'doc-1', label: 'A document', parentId: null, order: 1, readOnly: false } as never], null, [],
    folders, new Set(), artifacts) as FilePaneSection[]
  shell.bind(binding())
}
function binding(partial: Partial<FilesShellBinding> = {}): FilesShellBinding {
  return { graphId: server.graphId, ownerId: 'owner-1', graphIncarnation: server.graphIncarnation, writable: true, advert, sections, ...partial }
}
const canvas = () => shell.options()!.canvas!
const intent = (value: FileCanvasIntent) => canvas().onIntent(value)
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5)) }
const refOf = (label: string): WorkspaceFileRef => canvas().nodes.find(n => n.label === label)!.file

beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
  advert = readFilesAdvert({ files: { version: 1, maxUploadBytes: 52_428_800 } })
  menus = []
  sections = []
  shell = new FilesShell({
    client, refresh, onChange: () => {},
    menu: ({ items, x, y, onSelect }) => { menus.push({ labels: items.map(i => i.label), x, y, choose: label => onSelect(items.find(i => i.label === label)!.id) }) },
    preview: { url: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }, save: async () => {} },
    newId: (() => { let n = 0; return (kind: string) => `${kind}-${++n}` })(),
  })
  await refresh()
})
afterEach(async () => { shell.dispose(); await server.close() })

describe('capability gating', () => {
  it('stays hidden when the cell does not advertise Files, even when asked to open', async () => {
    advert = null
    shell.bind(binding())
    shell.openFolder(null)
    expect(shell.visible()).toBe(false)
    expect(shell.options()).toBeNull()
  })

  it('shows the pane for a cell that advertises Files', async () => {
    shell.openFolder(null)
    expect(shell.visible()).toBe(true)
    expect(shell.options()).toMatchObject({ face: 'canvas', maxUploadLabel: '50 MB', breadcrumbs: [{ id: null, label: 'Files' }] })
  })

  it('takes the cap the cell advertises', async () => {
    advert = readFilesAdvert({ files: { version: 1, maxUploadBytes: 10 * 1024 * 1024 } })
    shell.bind(binding())
    shell.openFolder(null)
    expect(shell.options()!.maxUploadLabel).toBe('10 MB')
  })
})

describe('one tree: a place shows everything in it', () => {
  it('shows folders, documents and files, each in its kind, with type captions', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-x', name: 'Datasheets', parentId: null })
    await client.upload(server.graphId, new File(['%PDF'], 'Spec.pdf', { type: 'application/pdf' }), { parentId: null, artifactId: 'file-spec' })
    await refresh()
    shell.openFolder(null)
    expect(canvas().nodes.map(n => [n.label, n.file.kind, n.type ?? ''])).toEqual([['Datasheets', 'folder', ''], ['A document', 'document', ''], ['Spec.pdf', 'artifact', 'PDF']])
    expect(shell.options()!.rows.map(r => [r.label, r.kind, r.type])).toEqual([['Datasheets', 'folder', 'Folder'], ['A document', 'document', 'Document'], ['Spec.pdf', 'file', 'PDF']])
  })

  it('a reader sees the files but no verb that changes them', async () => {
    shell.bind(binding({ writable: false }))
    shell.openFolder(null)
    expect(canvas().capabilities).toEqual({ place: false, move: false, rename: false, create: false, add: false, remove: false, connect: false, openBeside: false })
    expect(shell.options()).toMatchObject({ canUpload: false, canCreate: false, banner: 'You can view these files. Only editors can change them.' })
  })
})

describe('canvas intents become mediated commands', () => {
  it('a rename from the canvas is a PATCH, announced once, with Undo', async () => {
    await client.upload(server.graphId, new File(['x'], 'draft.txt'), { parentId: null, artifactId: 'file-d' })
    await refresh()
    shell.openFolder(null)
    intent({ kind: 'rename', file: refOf('draft.txt'), name: 'final.txt' })
    await settle()
    expect(server.artifacts.get('file-d')?.value.label).toBe('final.txt')
    expect(shell.options()!.status).toMatchObject({ message: 'Renamed “draft.txt” to “final.txt”.', undoLabel: 'Undo' })
    shell.options()!.onUndo()
    await settle()
    expect(server.artifacts.get('file-d')?.value.label).toBe('draft.txt')
  })

  it('New folder: a draft named in place, then created where it was asked for', async () => {
    shell.openFolder(null)
    intent({ kind: 'new-folder', placement: { x: 176, y: 16 } })
    const draft = canvas().drafts?.[0]
    expect(draft).toMatchObject({ kind: 'folder', label: 'Untitled folder', placement: { x: 176, y: 16 } })
    expect(canvas().session.naming).toMatchObject({ target: { draftId: draft!.draftId }, initial: 'Untitled folder' })
    intent({ kind: 'create', objectKind: 'folder', parent: null, name: 'Receipts', placement: { x: 176, y: 16 }, draftId: draft!.draftId })
    await settle()
    expect([...server.folders.values()].map(f => [f.name, f.section])).toEqual([['Receipts', 'artifacts']])
    expect(canvas().drafts ?? []).toEqual([])
    expect(canvas().session.naming ?? null).toBeNull()
    expect(canvas().placements.map(p => [p.file.kind, p.x, p.y])).toEqual([['folder', 176, 16]])
  })

  it('a drop of files uploads them into the folder under the pointer; Delete puts them in the trash', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-in', name: 'Inbox', parentId: null })
    await refresh()
    shell.openFolder(null)
    intent({ kind: 'add', files: [new File(['a'], 'a.bin'), new File(['b'], 'b.bin')], folder: refOf('Inbox') })
    await settle()
    expect([...server.artifacts.values()].map(a => [a.value.label, a.value.parentId]).sort()).toEqual([['a.bin', 'folder-in'], ['b.bin', 'folder-in']])
    shell.options()!.onNavigate('folder:folder-in')
    intent({ kind: 'remove', files: canvas().nodes.map(n => n.file) })
    await settle()
    expect(server.trash.size).toBe(2)
    expect(shell.options()!.status.message).toBe('Moved 2 items to the trash.')
  })

  it('the item menu offers what the shell can do, Connect… included on the canvas', async () => {
    await client.upload(server.graphId, new File(['x'], 'a.txt'), { parentId: null, artifactId: 'file-a' })
    await refresh()
    shell.openFolder(null)
    await settle()                 // the folder's layout is read before anything may be placed (Tidy up)
    intent({ kind: 'menu', files: [refOf('a.txt')], clientX: 10, clientY: 10 })
    expect(menus.at(-1)?.labels).toEqual(['Open', 'Download', 'Show info', 'Rename', 'Move to…', 'Connect…', 'Move to trash'])
    intent({ kind: 'menu', files: [], clientX: 10, clientY: 10, at: { x: 0, y: 0 } })
    expect(menus.at(-1)?.labels).toEqual(['Upload files…', 'New folder', 'Tidy up', 'View as list'])
  })
})

describe('preferences and opening', () => {
  it('saves the face for the folder and shows the list', async () => {
    shell.openFolder(null)
    await settle()
    shell.options()!.onFace('list')
    await settle()
    expect(shell.options()!.face).toBe('list')
    expect(server.requests.filter(r => r.tool === 'source_push')).toHaveLength(1)
  })

  it('opening a folder navigates; opening a zip opens its file page (no download); Back returns to the folder', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-z', name: 'Zips', parentId: null })
    await client.upload(server.graphId, new File(['PK'], 'a.zip', { type: 'application/zip' }), { parentId: 'folder-z', artifactId: 'file-zip' })
    await refresh()
    shell.openFolder(null)
    intent({ kind: 'open', file: refOf('Zips') })
    expect(shell.options()!.breadcrumbs.map(c => c.label)).toEqual(['Files', 'Zips'])
    intent({ kind: 'open', file: refOf('a.zip') })
    await settle()
    expect(shell.options()!.preview).toMatchObject({ kind: 'file', name: 'a.zip', status: 'ready', typeLabel: 'ZIP archive', size: '2 bytes' })
    shell.options()!.onClosePreview()
    expect(shell.options()!.preview).toBeNull()
  })
})

describe('the ways into the pane from the real shell', () => {
  it('opening a file from the tree goes to its folder, selects it, and opens it by its type', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-p', name: 'Pictures', parentId: null })
    await client.upload(server.graphId, new File([new Uint8Array([137, 80, 78, 71])], 'cat.png', { type: 'image/png' }),
      { parentId: 'folder-p', artifactId: 'file-cat' })
    await refresh()
    expect(shell.isOpen).toBe(false)
    shell.openFile('file-cat')
    expect(shell.isOpen).toBe(true)
    expect(shell.options()!.breadcrumbs.map(c => c.label)).toEqual(['Files', 'Pictures'])
    expect(shell.options()!.rows.filter(r => r.selected).map(r => r.label)).toEqual(['cat.png'])
    await settle()
    expect(shell.options()!.preview).toMatchObject({ kind: 'image', name: 'cat.png', status: 'ready', url: 'blob:x' })
  })

  it('opening a file the tree no longer has opens the top of Files and says so', async () => {
    shell.openFile('file-gone')
    expect(shell.isOpen).toBe(true)
    expect(shell.options()!.breadcrumbs.map(c => c.label)).toEqual(['Files'])
    expect(shell.options()!.status.message).toBe('That file is no longer here.')
  })

  it('Move to… opens where the first menu was asked for', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-m', name: 'Archive', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'm.txt'), { parentId: null, artifactId: 'file-m' })
    await refresh()
    shell.openFolder(null)
    await settle()
    intent({ kind: 'menu', files: [refOf('m.txt')], clientX: 40, clientY: 52 })
    menus.at(-1)!.choose('Move to…')
    expect(menus.at(-1)).toMatchObject({ labels: ['Archive'], x: 40, y: 52 })
    menus.at(-1)!.choose('Archive')
    await settle()
    expect(server.artifacts.get('file-m')?.value.parentId).toBe('folder-m')
  })

  it('leave() closes the pane; a cell that stops advertising Files closes it too', async () => {
    shell.openFolder(null)
    shell.leave()
    expect(shell.isOpen).toBe(false)
    shell.openFolder(null)
    advert = null
    shell.bind(binding())
    expect(shell.isOpen).toBe(false)
    expect(shell.options()).toBeNull()
  })
})

describe('the inspector tells the truth about counts', () => {
  it('"1 item", "2 files", "1 folder": nouns agree with their numbers', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-n', name: 'Nouns', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'one.txt'), { parentId: 'folder-n', artifactId: 'file-n1' })
    await client.upload(server.graphId, new File(['x'], 'two.txt'), { parentId: null, artifactId: 'file-n2' })
    await client.upload(server.graphId, new File(['x'], 'three.txt'), { parentId: null, artifactId: 'file-n3' })
    await refresh()
    shell.openFolder(null)
    await settle()
    shell.options()!.onRowSelect!(['folder:folder-n'], 'replace')
    expect(shell.inspector()!.identity.chips).toContainEqual({ label: 'Contains', value: '1 item' })
    shell.options()!.onRowSelect!(['artifact:file-n2', 'artifact:file-n3'], 'replace')
    expect(shell.inspector()!.identity.title).toBe('2 files selected')
    shell.options()!.onRowSelect!(['folder:folder-n', 'artifact:file-n2'], 'replace')
    expect(shell.inspector()!.identity.title).toBe('2 items selected')
    expect(shell.options()!.status.text).toBe('4 items · 2 selected')
  })
})

describe('naming in the list face', () => {
  it('F2 in the list names the row in place; Enter renames through PATCH, announced with Undo', async () => {
    await client.upload(server.graphId, new File(['x'], 'list.txt'), { parentId: null, artifactId: 'file-l' })
    await refresh()
    shell.openFolder(null)
    await settle()
    shell.options()!.onFace('list')
    await settle()
    shell.options()!.onRowSelect!(['artifact:file-l'], 'replace')
    shell.options()!.onRowKey!('F2', ['artifact:file-l'])
    expect(shell.options()!.rows.find(r => r.key === 'artifact:file-l')!.naming).toEqual({ initial: 'list.txt', error: null })
    shell.options()!.onRowRename!('artifact:file-l', 'renamed.txt')
    await settle()
    expect(server.artifacts.get('file-l')?.value.label).toBe('renamed.txt')
    expect(shell.options()!.rows.find(r => r.key === 'artifact:file-l')!.naming ?? null).toBeNull()
    expect(shell.options()!.status).toMatchObject({ message: 'Renamed “list.txt” to “renamed.txt”.', undoLabel: 'Undo' })
  })

  it('the menu Rename in the list names in place too, and Escape leaves the name as it was', async () => {
    await client.upload(server.graphId, new File(['x'], 'keep.txt'), { parentId: null, artifactId: 'file-k' })
    await refresh()
    shell.openFolder(null)
    await settle()
    shell.options()!.onFace('list')
    await settle()
    shell.options()!.onRowMenu!(['artifact:file-k'], 12, 14)
    menus.at(-1)!.choose('Rename')
    expect(shell.options()!.rows.find(r => r.key === 'artifact:file-k')!.naming).toEqual({ initial: 'keep.txt', error: null })
    shell.options()!.onRowRenameCancel!()
    expect(shell.options()!.rows.find(r => r.key === 'artifact:file-k')!.naming ?? null).toBeNull()
    expect(server.artifacts.get('file-k')?.value.label).toBe('keep.txt')
  })
})

describe('an incarnation learned late', () => {
  it('does not reset the open pane: the folder and selection stay, and the layout becomes writable', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-late', name: 'Late', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'late.txt'), { parentId: 'folder-late', artifactId: 'file-late' })
    await refresh()
    shell.bind(binding({ graphIncarnation: '' }))
    shell.openFile('file-late')
    await settle()
    expect(shell.options()!.banner).toBe('The folder layout could not be read yet; it is asked again shortly.')
    shell.bind(binding())
    await settle()
    expect(shell.options()!.breadcrumbs.map(c => c.label)).toEqual(['Files', 'Late'])
    expect(shell.options()!.rows.filter(r => r.selected).map(r => r.label)).toEqual(['late.txt'])
    expect(shell.options()!.banner ?? null).toBeNull()
    expect(shell.options()!.canChangeView).toBe(true)
  })
})

describe('reloading an opened file', () => {
  it('opens the same file again: its bytes are fetched once more', async () => {
    await client.upload(server.graphId, new File(['%PDF-1.4'], 'again.pdf', { type: 'application/pdf' }), { parentId: null, artifactId: 'file-again' })
    await refresh()
    shell.openFile('file-again')
    await settle()
    const downloads = () => server.requests.filter(r => r.path.startsWith(`/artifacts/${server.graphId}/file-again/download`)).length
    expect(shell.options()!.preview).toMatchObject({ kind: 'pdf', status: 'ready' })
    const before = downloads()
    shell.options()!.onReloadPreview!()
    await settle()
    expect(downloads()).toBe(before + 1)
    expect(shell.options()!.preview).toMatchObject({ kind: 'pdf', name: 'again.pdf' })
  })
})

describe('phones (Vera, 2026-10-06 12:15: Files hidden on phones in this release)', () => {
  it('at phone width there is no Files: not visible, no pane, and no way in opens it', async () => {
    await client.createFolder(server.graphId, { folderId: 'folder-ph', name: 'Phone', parentId: null })
    await client.upload(server.graphId, new File(['x'], 'ph.txt'), { parentId: 'folder-ph', artifactId: 'file-ph' })
    await refresh()
    shell.bind(binding({ phone: true }))
    expect(shell.visible()).toBe(false)
    shell.openFolder('folder-ph')
    shell.openFile('file-ph')
    expect(shell.isOpen).toBe(false)
    expect(shell.options()).toBeNull()
    expect(shell.inspector()).toBeNull()
  })

  it('an open pane closes when the viewport narrows to a phone, and does not come back by itself when it widens', async () => {
    shell.openFolder(null)
    expect(shell.isOpen).toBe(true)
    shell.bind(binding({ phone: true }))
    expect(shell.isOpen).toBe(false)
    expect(shell.options()).toBeNull()
    shell.bind(binding({ phone: false }))
    expect(shell.visible()).toBe(true)
    expect(shell.isOpen).toBe(false)
  })
})

