// @vitest-environment node
/**
 * One tree (plans/2026-10-08-one-tree.md), the shell half, over real HTTP to the suites' CONTRACT-files server: a place shows every
 * resource in it, opens each by its kind, renames and moves documents through the cell's existing document tools, and the verbs that
 * need the cell's one-tree support (a file in a documents-born folder, a document to the Trash, Delete forever) are asked of the
 * cell's advert and refused in a sentence when it has not said it can. A cell that has said so is believed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FilePaneSection, FileCanvasIntent, WorkspaceFileRef } from '@shrubbery/nucleus'
import { FilesClient, readFilesAdvert } from '../files-contract.js'
import { FilesShell } from '../files-shell.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarDocument, type SidebarFolder } from '../sidebar-documents.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer, type FilesContractServerOptions } from './support/files-contract-server.js'

interface Rig {
  readonly server: FilesContractServer
  readonly shell: FilesShell
  readonly client: FilesClient
  readonly opened: { id: string; place: { folderId: string | null; label: string } }[]
  refresh(): Promise<void>
  canvas(): NonNullable<ReturnType<FilesShell['options']>>['canvas'] & object
  intent(value: FileCanvasIntent): void
  ref(label: string): WorkspaceFileRef
  settle(): Promise<void>
}
let rigs: Rig[] = []
afterEach(async () => { for (const r of rigs) { r.shell.dispose(); await r.server.close() } rigs = [] })

async function rig(options: FilesContractServerOptions = {}): Promise<Rig> {
  const server = await startFilesContractServer(options)
  const client = new FilesClient(contractFor(server), mcpFor(server))
  let sections: FilePaneSection[] = []
  const opened: Rig['opened'] = []
  // The advert as the shell reads it: from the cell's own /api/capabilities.
  const caps = await fetch(`${server.base}/api/capabilities`, { headers: { Authorization: `Bearer ${server.token}` } }).then(r => r.json())
  const advert = readFilesAdvert(caps)
  const binding = () => ({ graphId: server.graphId, ownerId: 'owner-1', graphIncarnation: server.graphIncarnation, writable: true, advert, sections })
  const out: Rig = {
    server, client, opened,
    shell: undefined as never,
    async refresh() {
      const listing = await fetch(`${server.base}/navigation/${server.graphId}`, { headers: { Authorization: `Bearer ${server.token}` } })
        .then(r => r.json()) as { folders: Record<string, unknown>[]; artifacts: Record<string, unknown>[]; documents: Record<string, unknown>[] }
      const folders: SidebarFolder[] = listing.folders.map(f => ({ id: String(f.id), label: String(f.label), parentId: (f.parentId as string | null) ?? null,
        order: Number(f.order), section: f.section === 'artifacts' ? 'artifacts' : 'documents' }))
      const artifacts: SidebarArtifact[] = listing.artifacts.map(a => ({ id: String(a.id), label: String(a.label), parentId: (a.parentId as string | null) ?? null,
        order: Number(a.order), mimeType: String(a.mimeType), status: String(a.status), fileType: String(a.fileType) }))
      const docs: SidebarDocument[] = listing.documents.map(d => ({ id: String(d.id), label: String(d.label), parentId: (d.parentId as string | null) ?? null,
        order: Number(d.order), readOnly: false, sourceFile: null }))
      sections = sidebarSectionsFromDocuments(docs, null, [], folders, new Set(), artifacts) as FilePaneSection[]
      out.shell.bind(binding())
    },
    canvas: () => out.shell.options()!.canvas as never,
    intent: value => out.canvas().onIntent(value),
    ref: label => out.canvas().nodes.find(n => n.label === label)!.file,
    settle: async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5)) },
  }
  ;(out as { shell: FilesShell }).shell = new FilesShell({
    client, refresh: () => out.refresh(), onChange: () => {}, menu: () => {},
    openDocument: (id, place) => { opened.push({ id, place }) },
    preview: { url: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }, save: async () => {} },
    newId: (() => { let n = 0; return (kind: string) => `${kind}-${++n}` })(),
  })
  rigs.push(out)
  return out
}

/** A native (documents-born) folder holding two documents, one file at the top. */
async function seed(r: Rig): Promise<void> {
  r.server.folders.set('fld-native', { id: 'fld-native', name: 'Kitchen', parentId: null, section: 'documents', order: 1 })
  r.server.documents.set('doc-plan', { id: 'doc-plan', title: 'Plan', parentId: 'fld-native', order: 1 })
  r.server.documents.set('doc-list', { id: 'doc-list', title: 'Shopping list', parentId: 'fld-native', order: 2 })
  await r.client.upload(r.server.graphId, new File(['%PDF'], 'Quote.pdf', { type: 'application/pdf' }), { parentId: null, artifactId: 'file-quote' })
  await r.refresh()
}

describe('a place shows everything in it', () => {
  it('Open Folder on a native folder shows its documents, as documents', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder('fld-native')
    expect(r.canvas().nodes.map(n => [n.label, n.file.kind])).toEqual([['Plan', 'document'], ['Shopping list', 'document']])
    expect(r.shell.options()!.rows.map(row => [row.label, row.kind, row.type])).toEqual([['Plan', 'document', 'Document'], ['Shopping list', 'document', 'Document']])
    expect(r.shell.options()!.breadcrumbs.map(c => c.label)).toEqual(['Files', 'Kitchen'])
  })

  it('the top of the place holds the folder, and the file, side by side', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder(null)
    expect(r.canvas().nodes.map(n => [n.label, n.file.kind])).toEqual([['Kitchen', 'folder'], ['Quote.pdf', 'artifact']])
  })
})

describe('open by kind', () => {
  it('a document opens in the editor from the place, naming the place to come back to; the place keeps its selection', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'select', files: [r.ref('Shopping list')] })
    r.intent({ kind: 'open', file: r.ref('Plan') })
    expect(r.opened).toEqual([{ id: 'doc-plan', place: { folderId: 'fld-native', label: 'Kitchen' } }])
    r.shell.leave()           // the editor took the center
    r.shell.openFolder('fld-native')   // back to the place
    expect(r.shell.options()!.rows.filter(row => row.selected).map(row => row.label)).toEqual(['Shopping list'])
  })

  it('a file opens in the reader page, and Back returns to the place with the selection', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder(null)
    r.intent({ kind: 'select', files: [r.ref('Kitchen')] })
    r.intent({ kind: 'open', file: r.ref('Quote.pdf') })
    await r.settle()
    expect(r.shell.options()!.preview?.kind).toBe('pdf')
    r.shell.options()!.onClosePreview()
    expect(r.shell.options()!.preview).toBeNull()
    expect(r.shell.options()!.rows.filter(row => row.selected).map(row => row.label)).toEqual(['Kitchen'])
  })
})

describe('rename and move for documents, through the existing document tools', () => {
  it('renames a document', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'rename', file: r.ref('Plan'), name: 'Kitchen plan' })
    await r.settle()
    expect(r.server.documents.get('doc-plan')!.title).toBe('Kitchen plan')
    expect(r.shell.options()!.status.message).toBe('Renamed “Plan” to “Kitchen plan”.')
  })

  it('moves a document into another native folder, and Undo puts it back', async () => {
    const r = await rig(); await seed(r)
    r.server.folders.set('fld-other', { id: 'fld-other', name: 'Garage', parentId: null, section: 'documents', order: 3 })
    await r.refresh()
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'move', files: [r.ref('Plan')], folder: { ...r.ref('Plan'), kind: 'folder', id: 'fld-other' } })
    await r.settle()
    expect(r.server.documents.get('doc-plan')!.parentId).toBe('fld-other')
    r.shell.options()!.onUndo()
    await r.settle()
    expect(r.server.documents.get('doc-plan')!.parentId).toBe('fld-native')
  })
})

describe('what waits on the cell is asked of the cell, and degrades in a sentence', () => {
  it('a cell that has not lifted the fence: a file does not go into a native folder, said before anything is sent', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder(null)
    const before = r.server.requests.length
    r.intent({ kind: 'move', files: [r.ref('Quote.pdf')], folder: r.ref('Kitchen') })
    await r.settle()
    expect(r.server.artifacts.get('file-quote')!.value.parentId).toBeNull()
    expect(r.shell.options()!.status).toMatchObject({ tone: 'error' })
    expect(r.shell.options()!.status.message).toMatch(/“Quote\.pdf” can't go into “Kitchen” yet: this workspace's cell still keeps files and documents in separate folders\./)
    expect(r.server.requests.slice(before).filter(q => q.method !== 'GET' && q.path.includes('artifacts'))).toEqual([])
  })

  it('a cell that says anyFolder is believed: the file goes into the native folder', async () => {
    const r = await rig({ anyFolder: true }); await seed(r)
    r.shell.openFolder(null)
    r.intent({ kind: 'move', files: [r.ref('Quote.pdf')], folder: r.ref('Kitchen') })
    await r.settle()
    expect(r.server.artifacts.get('file-quote')!.value.parentId).toBe('fld-native')
    r.shell.openFolder('fld-native')
    expect(r.canvas().nodes.map(n => n.label).sort()).toEqual(['Plan', 'Quote.pdf', 'Shopping list'])
  })

  it('a document does not go to the trash on a cell without document trash, and nothing is removed', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'remove', files: [r.ref('Plan')] })
    await r.settle()
    expect(r.server.documents.has('doc-plan')).toBe(true)
    expect(r.shell.options()!.status.message).toBe('“Plan” can\'t go to the trash yet: this workspace\'s cell deletes documents for good, so nothing was removed. It will work once the cell is updated.')
  })

  it('a folder holding a document is not half-emptied on such a cell', async () => {
    const r = await rig(); await seed(r)
    r.shell.openFolder(null)
    r.intent({ kind: 'remove', files: [r.ref('Kitchen')] })
    await r.settle()
    expect(r.server.folders.has('fld-native')).toBe(true)
    expect(r.server.documents.size).toBe(2)
    expect(r.shell.options()!.status.tone).toBe('error')
  })
})

describe('the one Trash', () => {
  it('lists documents and files together; Restore brings each back', async () => {
    const r = await rig({ documentTrash: true }); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'remove', files: [r.ref('Plan')] })
    await r.settle()
    expect(r.server.documents.has('doc-plan')).toBe(false)
    r.shell.openFolder(null)
    r.intent({ kind: 'remove', files: [r.ref('Quote.pdf')] })
    await r.settle()
    await r.shell.openTrash()
    const trash = r.shell.options()!.trash!
    expect(trash.items.map(i => [i.label, i.kind, i.type]).sort()).toEqual([['Plan', 'document', 'Document'], ['Quote.pdf', 'file', 'PDF']])
    trash.onRestore('document:doc-plan')
    await r.settle()
    expect(r.server.documents.get('doc-plan')!.parentId).toBe('fld-native')
    r.shell.options()!.trash!.onRestore('artifact:file-quote')
    await r.settle()
    expect(r.server.artifacts.has('file-quote')).toBe(true)
    expect(r.shell.options()!.trash!.items).toEqual([])
  })

  it('Delete forever asks first, says what is lost for a document, and then it is gone', async () => {
    const r = await rig({ documentTrash: true }); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'remove', files: [r.ref('Plan')] })
    await r.settle()
    await r.shell.openTrash()
    r.shell.options()!.trash!.onPurge('document:doc-plan')
    const asked = r.shell.options()!.trash!.items[0]!
    expect(asked.confirm).toBe('Deleted with its history: it cannot be brought back.')
    expect(r.server.documentTrash.has('doc-plan')).toBe(true)          // asked, not done
    r.shell.options()!.trash!.onCancelPurge()
    expect(r.shell.options()!.trash!.items[0]!.confirm).toBeNull()
    r.shell.options()!.trash!.onPurge('document:doc-plan')
    r.shell.options()!.trash!.onConfirmPurge('document:doc-plan')
    await r.settle()
    expect(r.server.documentTrash.has('doc-plan')).toBe(false)
    expect(r.shell.options()!.status.message).toBe('Deleted “Plan” forever.')
  })

  it('Delete forever on something no longer in the trash (the cell says 404) is a refusal in words, not a crash', async () => {
    const r = await rig({ documentTrash: true }); await seed(r)
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'remove', files: [r.ref('Plan')] })
    await r.settle()
    await r.shell.openTrash()
    r.shell.options()!.trash!.onPurge('document:doc-plan')
    r.server.documentTrash.delete('doc-plan')       // someone else restored or deleted it meanwhile
    r.shell.options()!.trash!.onConfirmPurge('document:doc-plan')
    await r.settle()
    expect(r.shell.options()!.status).toMatchObject({ tone: 'error' })
    expect(r.shell.options()!.status.message).toMatch(/^Couldn't delete “Plan”: /)
    expect(r.shell.options()!.trash!.items).toEqual([])
  })

  it('on a cell that lists no purge route, Delete forever is absent and the view says why; Restore still works', async () => {
    const r = await rig({ withoutPurge: true }); await seed(r)
    r.shell.openFolder(null)
    r.intent({ kind: 'remove', files: [r.ref('Quote.pdf')] })
    await r.settle()
    await r.shell.openTrash()
    const trash = r.shell.options()!.trash!
    expect(trash.canPurge).toBe(false)
    expect(trash.note).toBe('Deleting forever needs a newer cell. Restoring works.')
    trash.onRestore('artifact:file-quote')
    await r.settle()
    expect(r.server.artifacts.has('file-quote')).toBe(true)
  })
})

describe('connections reach documents', () => {
  it('a wire between a document and a file is made from the canvas and drawn in the place', async () => {
    const r = await rig({ anyFolder: true }); await seed(r)
    await r.client.upload(r.server.graphId, new File(['x'], 'Receipt.txt'), { parentId: 'fld-native', artifactId: 'file-receipt' })
    await r.refresh()
    r.shell.openFolder('fld-native')
    r.intent({ kind: 'connect', source: r.ref('Plan'), target: r.ref('Receipt.txt'), relation: 'supports' })
    await r.settle()
    expect([...r.server.wires.values()].map(w => [w.sourceDocumentId, w.targetDocumentId, w.predicate])).toEqual([['doc-plan', 'file-receipt', 'supports']])
    r.shell.options()   // reads the wires
    await r.settle()
    expect(r.canvas().connections?.map(c => [c.source.id, c.target.id])).toEqual([['doc-plan', 'file-receipt']])
  })
})
