// @vitest-environment node
/**
 * Datasheets in the Files surfaces (plans/2026-10-08-datasheets-in-sophia.md §3): the shell asks the cell once per place, in one
 * batched query over the light records, and hands the cards, the list rows and the status line what the reader found. Over real HTTP
 * to the CONTRACT-files server, which serves fixture records of the query's shape for the artifacts given to it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilePaneSection } from '@shrubbery/nucleus'
import { FilesClient, readFilesAdvert, type FilesAdvert } from '../files-contract.js'
import { FilesShell, type FilesShellBinding } from '../files-shell.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarFolder } from '../sidebar-documents.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer, type ServedDatasheet } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
let sections: FilePaneSection[]
let shell: FilesShell
let advert: FilesAdvert | null

async function refresh(): Promise<void> {
  const response = await fetch(`${server.base}/navigation/${server.graphId}`, { headers: { Authorization: `Bearer ${server.token}` } })
  const listing = await response.json() as { folders: Record<string, unknown>[]; artifacts: Record<string, unknown>[] }
  const folders: SidebarFolder[] = listing.folders.map(f => ({ id: String(f.id), label: String(f.label), parentId: (f.parentId as string | null) ?? null,
    order: Number(f.order), section: f.section === 'artifacts' ? 'artifacts' : 'documents' }))
  const artifacts: SidebarArtifact[] = listing.artifacts.map(a => ({ id: String(a.id), label: String(a.label), parentId: (a.parentId as string | null) ?? null,
    order: Number(a.order), mimeType: String(a.mimeType), status: String(a.status), fileType: String(a.fileType) }))
  sections = sidebarSectionsFromDocuments([], null, [], folders, new Set(), artifacts) as FilePaneSection[]
  shell.bind(binding())
}
const binding = (): FilesShellBinding => ({ graphId: server.graphId, ownerId: 'owner-1', graphIncarnation: server.graphIncarnation, writable: true, advert, sections })
const settle = async (ms = 120) => { await new Promise(r => setTimeout(r, ms)) }
const queries = () => server.requests.filter(r => r.tool === 'sparql_query')

const converter: ServedDatasheet = {
  part: 'TPS62840', maker: 'Texas Instruments', rev: 'B', productType: 'DC/DC converter', rowCount: 212, toCheck: 0,
  params: [
    { pred: 'inputVoltage', lo: 1.8, hi: 6.5, unit: 'V', conf: 'high' },
    { pred: 'outputCurrent', hi: 750, unit: 'mA', conf: 'medium' },
    { pred: 'switchingFrequency', typ: 1.8, unit: 'MHz', conf: 'medium' },
    { pred: 'quiescentCurrent', typ: 60, unit: 'nA', conf: 'high' },
  ],
}
const opamp: ServedDatasheet = {
  part: 'OPA2192', maker: 'Texas Instruments', productType: 'op-amp', rowCount: 140, toCheck: 2,
  params: [
    { pred: 'gainBandwidth', typ: 10, unit: 'MHz', conf: 'contested', diag: 'readers_disagree' },
    { pred: 'inputOffsetVoltage', hi: 0.025, unit: 'mV', checked: true },
    { pred: 'supplyVoltage', lo: 4.5, hi: 36, unit: 'V', conf: 'high' },
  ],
}

async function upload(name: string, id: string, type = 'application/pdf'): Promise<void> {
  await client.upload(server.graphId, new File(['%PDF'], name, { type }), { parentId: null, artifactId: id })
}

beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
  advert = readFilesAdvert({ files: { version: 1, maxUploadBytes: 52_428_800 } })
  sections = []
  shell = new FilesShell({ client, refresh, onChange: () => {}, menu: () => {}, newId: (() => { let n = 0; return (kind: string) => `${kind}-${++n}` })(),
    evidenceTiming: { activeMs: 25, idleMs: 60_000 } })
  await refresh()
})
afterEach(async () => { shell.dispose(); await server.close() })

describe('a place with datasheets', () => {
  beforeEach(async () => {
    await upload('TPS62840.pdf', 'file-tps')
    await upload('OPA2192.pdf', 'file-opa')
    await upload('Plain.pdf', 'file-plain')
    await upload('notes.txt', 'file-txt', 'text/plain')
    server.datasheets.set('file-tps', converter)
    server.datasheets.set('file-opa', opamp)
    await refresh()
    shell.openFolder(null)
    shell.options()
    await settle()
  })

  it('asks once for the place, for its PDFs only', () => {
    expect(queries()).toHaveLength(1)
    const asked = server.requests.length
    shell.options(); shell.options()
    expect(server.requests.length).toBe(asked)
  })

  it('gives rich cards to the datasheets and today\'s card to a plain PDF', () => {
    const nodes = shell.options()!.canvas!.nodes
    const byLabel = (label: string) => nodes.find(n => n.label === label)!
    expect(byLabel('TPS62840.pdf').evidence).toMatchObject({
      title: 'TPS62840', subtitle: [{ text: 'Texas Instruments' }, { text: '· Rev B', fixed: true }], state: 'read', summary: '4 key values, 212 rows',
      values: [{ label: 'VIN', text: '1.8–6.5 V', mark: 'high' }, { label: 'IOUT', text: '≤ 750 mA', mark: 'medium' }, { label: 'fSW', text: '1.8 MHz', mark: 'medium' }],
    })
    expect(byLabel('OPA2192.pdf').evidence!.values.map(v => [v.label, v.mark])).toEqual([['GBW', 'contested'], ['VOS', 'checked'], ['Supply', 'high']])
    expect('evidence' in byLabel('Plain.pdf')).toBe(false)
    expect('evidence' in byLabel('notes.txt')).toBe(false)
  })

  it('adds the list columns\' data and the Needs a look filter, which keeps only what asks for a look', () => {
    const options = shell.options()!
    expect(options.rows.filter(r => r.evidence).map(r => r.evidence!.title).sort()).toEqual(['OPA2192', 'TPS62840'])
    expect(options.needsLook).toMatchObject({ on: false, count: 1 })
    options.needsLook!.onToggle(true)
    const filtered = shell.options()!
    expect(filtered.needsLook!.on).toBe(true)
    expect(filtered.rows.map(r => r.label)).toEqual(['OPA2192.pdf'])
    filtered.needsLook!.onToggle(false)
    expect(shell.options()!.rows).toHaveLength(4)
  })

  it('steady status is the count of items, nothing reading', () => {
    expect(shell.options()!.status).toMatchObject({ text: '4 items', busy: false, message: '', action: null })
  })
})

describe('a place with no datasheets', () => {
  it('keeps every card, row and the status line as before, and offers no filter', async () => {
    await upload('Plain.pdf', 'file-plain')
    await upload('cat.png', 'file-png', 'image/png')
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    const options = shell.options()!
    expect(options.canvas!.nodes.every(n => !('evidence' in n))).toBe(true)
    expect(options.rows.every(r => !('evidence' in r))).toBe(true)
    expect(options.needsLook).toBeNull()
    expect(options.status).toMatchObject({ text: '2 items', busy: false })
    expect(queries()).toHaveLength(1)
  })

  it('a place of images and text asks nothing', async () => {
    await upload('cat.png', 'file-png', 'image/png')
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    expect(queries()).toHaveLength(0)
  })

  it('a cell that cannot answer the query leaves everything as it was', async () => {
    await upload('Plain.pdf', 'file-plain')
    server.datasheets.set('file-plain', converter)
    const broken = new FilesClient(contractFor(server), { toolsCall: async () => { throw new Error('no such tool') } } as never)
    shell.dispose()
    shell = new FilesShell({ client: broken, refresh, onChange: () => {}, menu: () => {} })
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    expect(shell.options()!.canvas!.nodes.every(n => !('evidence' in n))).toBe(true)
  })
})

describe('the status line while reading', () => {
  it('says how many are reading, the page, and offers Open when the read completes', async () => {
    await upload('TPS62840.pdf', 'file-tps')
    await upload('Other.pdf', 'file-other')
    server.datasheets.set('file-tps', { ...converter, toCheck: 2, state: 'reading', page: 20, pages: 38, rowCount: 0, params: [] })
    server.datasheets.set('file-other', { ...opamp, state: 'queued', params: [] })
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    const reading = shell.options()!
    expect(reading.status).toMatchObject({ text: '2 items · 1 reading · 1 queued', busy: true, message: 'Reading TPS62840.pdf, page 20 of 38', action: null })
    expect(reading.canvas!.nodes.find(n => n.label === 'TPS62840.pdf')!.evidence!.progress).toEqual({ page: 20, pages: 38 })

    server.datasheets.set('file-tps', { ...converter, toCheck: 2 })
    server.datasheets.delete('file-other')
    await settle(200)
    const done = shell.options()!
    expect(done.status).toMatchObject({ busy: false, message: 'Read TPS62840.pdf: 4 key values, 212 rows, 2 to check', action: { label: 'Open' } })
    expect(done.canvas!.nodes.find(n => n.label === 'TPS62840.pdf')!.evidence).toMatchObject({ state: 'read', doneBadge: '2 to check' })
  })

  it('says the cause when a read fails, and offers Retry when the cell can retry', async () => {
    const retried: string[] = []
    shell.dispose()
    shell = new FilesShell({ client, refresh, onChange: () => {}, menu: () => {}, evidenceTiming: { activeMs: 25, idleMs: 60_000 },
      retryRead: async id => { retried.push(id) } })
    await upload('Bad.pdf', 'file-bad')
    server.datasheets.set('file-bad', { ...converter, state: 'reading', page: 1, pages: 3, params: [] })
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    server.datasheets.set('file-bad', { ...converter, state: 'failed', error: 'No text layer and OCR found nothing', params: [] })
    await settle(200)
    const failed = shell.options()!
    expect(failed.status).toMatchObject({ tone: 'error', message: 'Couldn’t read Bad.pdf: No text layer and OCR found nothing', action: { label: 'Retry' } })
    failed.status.action!.onAction()
    await settle()
    expect(retried).toEqual(['file-bad'])
  })
})

describe('a second kind in the same place (test-only paper kind)', () => {
  it('shows a paper beside a datasheet with no change to the shell: its own columns, its own card, the one query', async () => {
    const { FILE_KINDS } = await import('../files-kinds/index.js')
    const { paperKind } = await import('./support/paper-kind.js')
    shell.dispose()
    shell = new FilesShell({ client, refresh, onChange: () => {}, menu: () => {}, kinds: [...FILE_KINDS, paperKind], evidenceTiming: { activeMs: 25, idleMs: 60_000 } })
    await upload('Attention.pdf', 'file-paper')
    await upload('TPS62840.pdf', 'file-tps')
    server.datasheets.set('file-tps', converter)
    server.evidenceRows.set('file-paper', [{ artifact: '"file-paper"', kind: '"paper"', paper_title: '"Attention Is All You Need"', paper_authors: '"Vaswani et al."',
      paper_year: '"2017"', paper_venue: '"NeurIPS"' }])
    await refresh()
    shell.openFolder(null)
    shell.options(); await settle()
    const nodes = shell.options()!.canvas!.nodes
    expect(nodes.find(n => n.label === 'Attention.pdf')!.evidence).toMatchObject({ kind: 'paper', title: 'Attention Is All You Need', doneBadge: 'Read' })
    expect(nodes.find(n => n.label === 'TPS62840.pdf')!.evidence).toMatchObject({ kind: 'datasheet', title: 'TPS62840' })
    expect(queries()).toHaveLength(1)
  })
})
