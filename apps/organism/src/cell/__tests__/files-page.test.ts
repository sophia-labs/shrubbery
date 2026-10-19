// @vitest-environment node
/**
 * Opening a file opens its page (Vera, 2026-10-13: "the raw PDF should be a collapsed section on a sophia-standard info display with the
 * stuff we extracted, your notes on it, etc."). The shell, its client and the cell's contract over real HTTP to the CONTRACT-files server,
 * fed the real OPA2134 `datasheet_facts` answer and the real editions of Vera's library.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilePaneSection } from '@shrubbery/nucleus'
import type { FilesPageSection, WorkspaceFilesOptions } from '@shrubbery/runtime'
import { FilesClient, readFilesAdvert, type FilesAdvert } from '../files-contract.js'
import { FilesShell, type FilesShellBinding } from '../files-shell.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarDocument, type SidebarFolder } from '../sidebar-documents.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (path: string) => JSON.parse(readFileSync(join(here, 'fixtures', path), 'utf8')) as Record<string, unknown>
const OPA = 'ds-ede0a2dfc224c765'

let server: FilesContractServer
let client: FilesClient
let sections: FilePaneSection[]
let shell: FilesShell
let advert: FilesAdvert | null
let writable = true

async function refresh(): Promise<void> {
  const response = await fetch(`${server.base}/navigation/${server.graphId}`, { headers: { Authorization: `Bearer ${server.token}` } })
  const listing = await response.json() as { folders: Record<string, unknown>[]; artifacts: Record<string, unknown>[]; documents?: Record<string, unknown>[] }
  const folders: SidebarFolder[] = listing.folders.map(f => ({ id: String(f.id), label: String(f.label ?? f.name), parentId: (f.parentId as string | null) ?? null,
    order: Number(f.order), section: f.section === 'artifacts' ? 'artifacts' : 'documents' }))
  const artifacts: SidebarArtifact[] = listing.artifacts.map(a => ({ id: String(a.id), label: String(a.label), parentId: (a.parentId as string | null) ?? null,
    order: Number(a.order), mimeType: String(a.mimeType), status: String(a.status), fileType: String(a.fileType) }))
  const docs: SidebarDocument[] = [...server.documents.values()].map(d => ({ id: d.id, label: d.title, parentId: d.parentId, order: d.order, readOnly: false, sourceFile: null }))
  sections = sidebarSectionsFromDocuments(docs, null, [], folders, new Set(folders.map(f => f.id)), artifacts) as FilePaneSection[]
  shell.bind(binding())
}
const binding = (): FilesShellBinding => ({ graphId: server.graphId, ownerId: 'owner-1', graphIncarnation: server.graphIncarnation, writable, advert, sections })
const settle = async (ms = 120) => { await new Promise(r => setTimeout(r, ms)) }
const page = () => shell.options()!.page!
const section = (id: string): FilesPageSection | undefined => page().sections.find(s => s.id === id)
const downloads = (id: string) => server.requests.filter(r => r.path.startsWith(`/artifacts/${server.graphId}/${id}/download`)).length

async function upload(name: string, id: string, type: string, parentId: string | null = 'fld-sheets'): Promise<void> {
  await client.upload(server.graphId, new File([type === 'application/pdf' ? '%PDF-1.4' : 'page 1 text'], name, { type }), { parentId, artifactId: id })
}

beforeEach(async () => {
  writable = true
  server = await startFilesContractServer({ anyFolder: true })
  client = new FilesClient(contractFor(server), mcpFor(server))
  advert = readFilesAdvert({ files: { version: 1, maxUploadBytes: 52_428_800, anyFolder: true } })
  sections = []
  shell = new FilesShell({ client, refresh, onChange: () => {}, menu: () => {}, notesDebounceMs: 20, evidenceTiming: { activeMs: 25, idleMs: 60_000 } })
  server.folders.set('fld-sheets', { id: 'fld-sheets', name: 'Datasheets', parentId: null, section: 'artifacts', order: 1 })
  await upload('ti-opa2134_DS.pdf', OPA, 'application/pdf')
  await upload('ti-opa2134_DS.text.txt', `${OPA}-text`, 'text/plain')
  await upload('field notes.txt', 'file-notes-txt', 'text/plain')
  server.datasheets.set(OPA, { part: 'OPA134', maker: '', productType: 'unknown', rowCount: 82, fileName: 'ti-opa2134_DS.pdf', families: ['OPA2134', 'OPA134', 'OPA4134'],
    reader: { tool: 'datasheet-parser', commit: 'ee680a6', docling: '2.135.0' }, params: [{ pred: 'gainBandwidth', typ: 8, unit: 'MHz', conf: 'medium' }] })
  server.datasheetFacts.set(OPA, fixture('datasheet-facts/ti-opa2134_DS.pdf.json'))
  server.pageRows.set('editions', fixture('datasheet-page/datasheet-library-editions.json').rows as Record<string, string>[])
  await refresh()
})
afterEach(async () => { shell.dispose(); await server.close() })

describe('a datasheet opens as its page', () => {
  beforeEach(async () => {
    shell.openFile(OPA)
    shell.options(); await settle(200)
  })

  it('the place holds the sheet, not its reader\'s text beside it; the page names the part and its family', () => {
    shell.options()!.onClosePreview()
    expect(shell.options()!.rows.map(r => r.label).sort()).toEqual(['field notes.txt', 'ti-opa2134_DS.pdf'])
    expect(shell.options()!.status.text).toBe('2 items · 1 selected')
  })

  it('its sections in order: what was read open, the PDF folded and not downloaded', () => {
    expect(page()).toMatchObject({ title: 'OPA2134', name: 'ti-opa2134_DS.pdf', chips: [{ text: 'OPA134' }, { text: 'OPA2134', current: true }, { text: 'OPA4134' }] })
    expect(page().lines.map(l => l.text)).toEqual(['Texas Instruments', 'Datasheet', '35 pages'])
    // Related is not drawn: nothing else in this graph names the part.
    expect(page().sections.map(s => `${s.id}${s.open ? '' : ' (folded)'}`)).toEqual(['key-values', 'notes', 'extracted', 'source (folded)', 'reading (folded)',
      'about (folded)', 'connections (folded)'])
    expect(shell.options()!.preview).toBeNull()
    expect(downloads(OPA)).toBe(0)
    expect(section('extracted')).toMatchObject({ count: '54' })
  })

  it('a page link unfolds the source, opens the PDF, and asks the reader for that one value (the overlay stays off)', async () => {
    const options = shell.options()!
    const gbw = section('key-values')!.body
    if (gbw?.face !== 'values') throw new Error('no key values')
    options.onPageGoto!(gbw.values[0]!.id, gbw.values[0]!.page)
    await settle(200)
    const after = shell.options()!
    expect(after.page!.sections.find(s => s.id === 'source')!.open).toBe(true)
    expect(after.preview).toMatchObject({ kind: 'pdf', status: 'ready', spotlight: { id: `${OPA}-key-gainBandwidth`, nonce: 1 }, overlay: false })
    expect(downloads(OPA)).toBe(1)
    expect((after.preview as { assertions?: unknown[] }).assertions!.length).toBe(56)
  })

  it('the table\'s filter keeps every word typed; folding a section is remembered for the file', () => {
    shell.options()!.onPageFilter!('noise density')
    const table = section('extracted')!.body
    if (table?.face !== 'table') throw new Error('no table')
    expect(table.shown).toBe(2)
    shell.options()!.onPageSection!('key-values', false)
    expect(section('key-values')!.open).toBe(false)
  })

  it('the reader\'s text is reached from About this reading, as its own page (its contents open); Back returns to the sheet, then to the place', async () => {
    const reading = section('reading')!.body
    if (reading?.face !== 'facts') throw new Error('no reading')
    const link = reading.rows.find(r => r.label === 'Text the reader read')!
    expect(link).toMatchObject({ text: 'ti-opa2134_DS.text.txt', action: `open:artifact:${OPA}-text` })
    shell.options()!.onPageAction!(link.action!)
    await settle(200)
    expect(page()).toMatchObject({ title: 'ti-opa2134_DS.text.txt' })
    expect(page().sections.map(s => s.id)).toEqual(['source', 'notes', 'about', 'connections'])
    expect(shell.options()!.preview).toMatchObject({ kind: 'reader', status: 'ready' })
    shell.options()!.onClosePreview()
    expect(page()).toMatchObject({ title: 'OPA2134' })
    shell.options()!.onClosePreview()
    expect(shell.options()!.page).toBeNull()
  })
})

describe('your notes', () => {
  const typed = (text: string) => ({ json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, value: text, isEmpty: false })

  it('nothing is made until the first keystroke; then one notes document beside the file, wired to it, saved as you type', async () => {
    shell.openFile(OPA); shell.options(); await settle(200)
    expect(section('notes')!.body).toMatchObject({ face: 'notes', notes: { status: 'empty', readOnly: false } })
    expect(server.documents.has(`notes-${OPA}`)).toBe(false)
    shell.options()!.onNotesChange!({ json: { type: 'doc' }, value: '', isEmpty: true })
    await settle(80)
    expect(server.documents.has(`notes-${OPA}`)).toBe(false)
    shell.options()!.onNotesChange!(typed('Used it in the headphone amp'))
    await settle(200)
    expect(server.documents.get(`notes-${OPA}`)).toMatchObject({ title: 'Notes on ti-opa2134_DS.pdf', parentId: 'fld-sheets' })
    expect(server.documentBodies.get(`notes-${OPA}`)).toMatchObject({ revision: 1, tiptapJson: typed('Used it in the headphone amp').json })
    expect([...server.wires.values()]).toEqual([expect.objectContaining({ sourceDocumentId: `notes-${OPA}`, targetDocumentId: OPA, predicate: 'annotates' })])
    shell.options()!.onNotesChange!(typed('Used it in the headphone amp; runs warm at ±18 V'))
    await settle(200)
    expect(server.documentBodies.get(`notes-${OPA}`)!.revision).toBe(2)
    // write_document files what it writes at the top; the notes are put back beside their file.
    expect(server.documents.get(`notes-${OPA}`)!.parentId).toBe('fld-sheets')
    expect(section('notes')).toMatchObject({ verb: { label: 'Open as a document', action: `open:document:notes-${OPA}` } })
    expect((section('notes')!.body as { notes: { message?: string } }).notes.message).toBe('Saved')
  })

  it('come back with the file: read again, and not a peer of the file in its place', async () => {
    server.documents.set(`notes-${OPA}`, { id: `notes-${OPA}`, title: 'Notes on ti-opa2134_DS.pdf', parentId: 'fld-sheets', order: 9 })
    server.documentBodies.set(`notes-${OPA}`, { revision: 3, tiptapJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'warm' }] }] } })
    await refresh()
    shell.openFolder('fld-sheets')
    expect(shell.options()!.rows.map(r => r.label).sort()).toEqual(['field notes.txt', 'ti-opa2134_DS.pdf'])
    shell.openFile(OPA); shell.options(); await settle(200)
    expect(section('notes')!.body).toMatchObject({ notes: { status: 'ready', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'warm' }] }] } } })
  })

  it('a file whose name is over 96 characters: its notes are titled with the name cut in its middle, the extension kept', async () => {
    // The cell refuses a new document's title over 96 characters (garden a901a16); the contract server does too.
    const name = 'Thermal validation report for the OPA2134 headphone amplifier board, revision C, batch 7 – final review.txt'
    await upload(name, 'file-long-name', 'text/plain')
    await refresh()
    shell.openFile('file-long-name'); shell.options(); await settle(200)
    shell.options()!.onNotesChange!(typed('Runs warm at ±18 V'))
    await settle(200)
    expect((section('notes')!.body as { notes: { message?: string } }).notes.message).toBe('Saved')
    const title = server.documents.get('notes-file-long-name')!.title
    expect(Array.from(title).length).toBeLessThanOrEqual(96)
    expect(title).toMatch(/^Notes on Thermal validation report for the OPA2134 .*…review\.txt$/u)
  })

  it('a plain PDF opens whole in the Reader: no page around it, its viewer is the center', async () => {
    await upload('Plain paper.pdf', 'file-plain-pdf', 'application/pdf')
    await refresh()
    shell.openFile('file-plain-pdf'); shell.options(); await settle(400)
    const options = shell.options()!
    expect(options.page ?? null).toBeNull()
    expect(options.preview).toMatchObject({ kind: 'pdf', name: 'Plain paper.pdf' })
  })

  it('a viewer reads them and cannot write: the editor is read-only and a keystroke makes nothing', async () => {
    writable = false
    await refresh()
    shell.openFile(OPA); shell.options(); await settle(200)
    expect(section('notes')!.body).toMatchObject({ notes: { readOnly: true } })
    shell.options()!.onNotesChange!(typed('x'))
    await settle(100)
    expect(server.documents.has(`notes-${OPA}`)).toBe(false)
  })
})

describe('any other file', () => {
  it('opens as its page with its contents first and open (the viewer starts at once)', async () => {
    shell.openFile('file-notes-txt')
    await settle(200)
    const options: WorkspaceFilesOptions = shell.options()!
    expect(options.page!.sections.map(s => `${s.id}${s.open ? '' : ' (folded)'}`)).toEqual(['source', 'notes', 'about (folded)', 'connections (folded)'])
    expect(options.page!.lines[0]!.text).toBe('TXT file')
    expect(options.preview).toMatchObject({ kind: 'reader', status: 'ready', name: 'field notes.txt' })
  })
})
