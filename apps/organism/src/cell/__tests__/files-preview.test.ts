// @vitest-environment node
/**
 * Opening a file from the Files pane: a PDF in the original-page viewer, an image as a preview, what Hoja renders as a
 * reader document, anything else as its file page. Opening never saves anything. The bytes come over real HTTP from a
 * contract server with the bearer; the page renderer, the object-URL table and the save dialog are the browser's, so they
 * are given here as the small seams the controller takes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesClient } from '../files-contract.js'
import { FilesPreviewController } from '../files-preview.js'
import { contractFor, mcpFor, startFilesContractServer, type FilesContractServer } from './support/files-contract-server.js'

let server: FilesContractServer
let client: FilesClient
let urls: Map<string, Blob>
let saved: { name: string; bytes: number[] }[]
let preview: FilesPreviewController
let counter = 0

beforeEach(async () => {
  server = await startFilesContractServer()
  client = new FilesClient(contractFor(server), mcpFor(server))
  urls = new Map(); saved = []; 
  preview = new FilesPreviewController({
    client,
    onChange: () => {},
    url: { createObjectURL: blob => { const u = `blob:test/${++counter}`; urls.set(u, blob); return u }, revokeObjectURL: u => { urls.delete(u) } },
    save: async (blob, name) => { saved.push({ name, bytes: [...new Uint8Array(await blob.arrayBuffer())] }) },
  })
})
afterEach(async () => { preview.close(); await server.close() })

async function put(name: string, type: string, bytes: number[]) {
  const stored = await client.upload(server.graphId, new File([new Uint8Array(bytes)], name, { type }), { parentId: null, artifactId: `file-${name.replace(/\W/g, '')}` })
  return { id: stored.id, label: stored.label, mimeType: stored.mimeType, fileType: stored.fileType, originalFilename: stored.originalFilename }
}

describe('opening a file', () => {
  it('a PDF: its exact bytes arrive for the reader, with the download progress counted, and the page is the reader\'s to report', async () => {
    const file = await put('Spec.pdf', 'application/pdf', [37, 80, 68, 70, 1, 2])
    await preview.open(server.graphId, file)
    const state = preview.snapshot()
    expect(state).toMatchObject({ kind: 'pdf', name: 'Spec.pdf', status: 'ready', pageNumber: 1, loaded: 6, total: 6 })
    expect(state.kind === 'pdf' ? [...(state.data ?? [])] : []).toEqual([37, 80, 68, 70, 1, 2])
    preview.reportPage(3, 9)
    expect(preview.snapshot()).toMatchObject({ kind: 'pdf', pageNumber: 3, pageCount: 9 })
    expect(server.requests.find(r => r.path.includes('/download'))?.path).toBe(`/artifacts/${server.graphId}/${file.id}/download?inline=1`)
  })

  it('an image: previewed from an object URL of its exact bytes', async () => {
    const file = await put('photo.png', 'image/png', [137, 80, 78, 71])
    await preview.open(server.graphId, file)
    const state = preview.snapshot()
    expect(state).toMatchObject({ kind: 'image', name: 'photo.png', status: 'ready' })
    const url = state.kind === 'image' ? state.url : ''
    expect([...new Uint8Array(await urls.get(url!)!.arrayBuffer())]).toEqual([137, 80, 78, 71])
  })

  it('anything else: its file page (kind, size, modified), its bytes not even fetched, nothing saved until Download', async () => {
    const file = await put('archive.zip', 'application/zip', [80, 75, 3, 4])
    await preview.open(server.graphId, file)
    expect(saved).toEqual([])
    const state = preview.snapshot()
    expect(state).toMatchObject({ kind: 'file', name: 'archive.zip', status: 'ready', typeLabel: 'ZIP archive', caption: 'ZIP', sizeBytes: 4 })
    expect(state.kind === 'file' && typeof state.modified === 'string' && state.modified.length > 0).toBe(true)
    expect(server.requests.some(r => r.path.includes('/download'))).toBe(false)
    await preview.download(server.graphId)
    expect(saved).toEqual([{ name: 'archive.zip', bytes: [80, 75, 3, 4] }])
    expect(server.requests.find(r => r.path.includes('/download'))?.path).toBe(`/artifacts/${server.graphId}/${file.id}/download`)
  })

  it('code: one code block in its language, with line numbers, line ends normalized', async () => {
    const file = await put('main.ts', 'video/mp2t', [...new TextEncoder().encode('const a = 1\r\nexport { a }\n')])
    await preview.open(server.graphId, file)
    const state = preview.snapshot()
    expect(state).toMatchObject({ kind: 'reader', label: 'TypeScript', viewer: 'code', status: 'ready', source: null, truncated: null })
    const view = state.kind === 'reader' ? state.view : null
    expect(view).toMatchObject({ variant: 'code', lineNumbers: true })
    expect(view?.doc).toEqual({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const a = 1\nexport { a }\n' }] }] })
    expect(saved).toEqual([])
  })

  it('JSON is pretty-printed; invalid JSON is shown as written, with a note', async () => {
    await preview.open(server.graphId, await put('data.json', 'application/json', [...new TextEncoder().encode('{"a":[1,2],"b":"x"}')]))
    const ok = preview.snapshot()
    expect(ok.kind === 'reader' && (ok.view?.doc as { content: { content: { text: string }[] }[] }).content[0]!.content[0]!.text).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x"\n}')
    await preview.open(server.graphId, await put('bad.json', 'application/json', [...new TextEncoder().encode('{"a":')]))
    const bad = preview.snapshot()
    expect(bad).toMatchObject({ kind: 'reader', status: 'ready' })
    expect(bad.kind === 'reader' && bad.note?.startsWith('Not valid JSON')).toBe(true)
  })

  it('CSV: a data table over the side store, quoted fields and line breaks inside quotes parsed; released on close', async () => {
    const released: string[] = []
    const p = new FilesPreviewController({ client, onChange: () => {}, releaseTable: ref => released.push(ref) })
    const csv = '﻿name,note\r\n"Borges, J.","line one\nline two"\r\nLucy,"say ""hi"""\r\n'
    await p.open(server.graphId, await put('people.csv', 'text/csv', [...new TextEncoder().encode(csv)]))
    const state = p.snapshot()
    expect(state).toMatchObject({ kind: 'reader', viewer: 'csv', label: 'CSV', status: 'ready' })
    const node = state.kind === 'reader' ? (state.view?.doc as { content: { type: string; attrs: { ref: string } }[] }).content[0]! : null
    expect(node?.type).toBe('dataTable')
    const { dataTableModel } = await import('@shrubbery/hoja/reader')
    expect(dataTableModel(node!.attrs.ref)?.sheets[0]).toEqual({ name: 'people.csv', columns: ['name', 'note'],
      rows: [['Borges, J.', 'line one\nline two'], ['Lucy', 'say "hi"']] })
    p.close()
    expect(released).toEqual([node!.attrs.ref])
  })

  it('a binary misnamed .txt opens its file page; an unknown file that is text opens as text', async () => {
    await preview.open(server.graphId, await put('notes.txt', 'text/plain', [0, 1, 2, 0, 255, 254, 0, 7]))
    expect(preview.snapshot()).toMatchObject({ kind: 'file', name: 'notes.txt', status: 'ready', sizeBytes: 8 })
    await preview.open(server.graphId, await put('NOTES', 'application/octet-stream', [...new TextEncoder().encode('just words\n')]))
    expect(preview.snapshot()).toMatchObject({ kind: 'reader', viewer: 'text', status: 'ready' })
    expect(saved).toEqual([])
  })

  it('a long text shows its first part (cut at a line) with Show all; Windows-1252 bytes still read', async () => {
    const p = new FilesPreviewController({ client, onChange: () => {}, textCapBytes: 16 })
    await p.open(server.graphId, await put('log.txt', 'text/plain', [...new TextEncoder().encode('line 1\nline 2\nline 3\nline 4\n')]))
    const first = p.snapshot()
    expect(first).toMatchObject({ kind: 'reader', truncated: { shown: '14 bytes', total: '28 bytes' } })
    expect(first.kind === 'reader' && JSON.stringify(first.view?.doc)).toContain('"line 1\\nline 2\\n"')
    await p.showAll()
    const all = p.snapshot()
    expect(all).toMatchObject({ kind: 'reader', truncated: null })
    expect(all.kind === 'reader' && JSON.stringify(all.view?.doc)).toContain('line 4')
    await p.open(server.graphId, await put('latin.txt', 'text/plain', [99, 97, 102, 0xe9]))
    const latin = p.snapshot()
    expect(latin.kind === 'reader' && JSON.stringify(latin.view?.doc)).toContain('café')
    p.close()
  })

  it('HTML: rendered through the reader schema by default, its source as code on the switch', async () => {
    await preview.open(server.graphId, await put('page.html', 'text/html', [...new TextEncoder().encode('<h1>Hi</h1><script>window.x=1</script>')]))
    const page = preview.snapshot()
    expect(page).toMatchObject({ kind: 'reader', label: 'HTML', source: false, view: { variant: 'prose', html: '<h1>Hi</h1><script>window.x=1</script>' } })
    await preview.setSource(true)
    const source = preview.snapshot()
    expect(source).toMatchObject({ kind: 'reader', source: true, view: { variant: 'code' } })
    expect(source.kind === 'reader' && (source.view?.doc as { content: { attrs: { language: string } }[] }).content[0]!.attrs.language).toBe('xml')
  })

  it('Markdown becomes HTML for the reader schema', async () => {
    await preview.open(server.graphId, await put('read.md', 'text/markdown', [...new TextEncoder().encode('# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')]))
    const state = preview.snapshot()
    expect(state).toMatchObject({ kind: 'reader', label: 'Markdown', view: { variant: 'prose' } })
    const html = state.kind === 'reader' ? String(state.view?.html) : ''
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<table>')
  })

  it('a file that has gone says so, and closing lets go of every object URL', async () => {
    await preview.open(server.graphId, { id: 'file-gone', label: 'gone.png', mimeType: 'image/png', fileType: 'png', originalFilename: 'gone.png' })
    expect(preview.snapshot()).toMatchObject({ kind: 'image', status: 'error', error: 'This file is no longer available.' })
    const file = await put('ok.png', 'image/png', [1])
    await preview.open(server.graphId, file)
    expect(urls.size).toBe(1)
    preview.close()
    expect(urls.size).toBe(0)
    expect(preview.snapshot()).toEqual({ kind: 'none' })
  })
})
