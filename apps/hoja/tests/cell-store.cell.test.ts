/**
 * CellStore against a real gardend cell (QA 2026-09-23, P0-1, P0-2, P1-6).
 * These fail on c3cbe7f: empty documents throw "no TipTap structure", every
 * list date parses to 0, and a stale save silently replaces a concurrent edit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CellStore, HOJA_FOLDER_ID } from '../src/cell-store.js'
import { SeedConflictError } from '../src/seed-store.js'
import { gardendBinary, LocalCell, paragraphs } from './support/local-cell.js'

const binary = gardendBinary()
if (!binary) {
  console.warn('[hoja] cell suite SKIPPED: set GARDEND_BIN to a gardend binary to run it against a real cell')
}

describe.skipIf(!binary)('CellStore on a real gardend cell', { timeout: 60_000 }, () => {
  let cell: LocalCell
  let store: CellStore
  const graphId = 'hoja-cell-test'

  beforeAll(async () => {
    cell = await LocalCell.start(binary!)
    const graph = await cell.createGraph(graphId, 'Hoja cell test')
    store = new CellStore({ gateway: cell.gateway([graph]), graphId, storage: null, location: new URL('https://hoja.test/') })
  }, 120_000)

  afterAll(async () => { await cell?.stop() }, 30_000)

  it('opens a freshly created, empty leaf as an empty document', async () => {
    const { id } = await store.create()
    const doc = await store.read(id)
    expect(doc.id).toBe(id)
    expect(doc.markdown).toBe('')
    expect(doc.json).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(doc.revision).toBe(0)
  })

  it('lists the cell’s epoch-millisecond timestamps as real dates, newest first', async () => {
    const before = Date.now()
    await cell.call('write_document', { graphId, documentId: 'dated-old', title: 'Old', tiptapJson: paragraphs('Old'), awaitDurable: true })
    await new Promise(resolve => setTimeout(resolve, 20))
    await cell.call('write_document', { graphId, documentId: 'dated-new', title: 'New', tiptapJson: paragraphs('New'), awaitDurable: true })
    const rows = await store.list()
    const old = rows.find(row => row.id === 'dated-old')!
    const fresh = rows.find(row => row.id === 'dated-new')!
    expect(old.modified_ms).toBeGreaterThanOrEqual(before - 1000)
    expect(fresh.modified_ms).toBeGreaterThanOrEqual(old.modified_ms)
    expect(rows.findIndex(row => row.id === 'dated-new')).toBeLessThan(rows.findIndex(row => row.id === 'dated-old'))
  })

  it('refuses a stale save instead of overwriting a concurrent edit', async () => {
    const documentId = 'concurrent-target'
    await cell.call('write_document', {
      graphId, documentId, title: 'Concurrent', tiptapJson: paragraphs('Concurrent', 'Line two from seed.'), awaitDurable: true,
    })
    const open = await store.read(documentId)
    await cell.call('write_document', {
      graphId, documentId, title: 'Concurrent',
      tiptapJson: paragraphs('Concurrent', 'Line two from seed.', 'Line three FROM MCP.'), awaitDurable: true,
    })
    const save = store.save(documentId, {
      markdown: 'Concurrent\n\nLine two from seed. +browser',
      json: paragraphs('Concurrent', 'Line two from seed. +browser'),
    })
    await expect(save).rejects.toBeInstanceOf(SeedConflictError)
    expect(await cell.markdown(graphId, documentId)).toContain('Line three FROM MCP.')
    expect(open.revision).toBeTypeOf('number')
  })

  it('keeps saving after its own writes and reports the server revision', async () => {
    const documentId = 'sequential'
    await cell.call('write_document', { graphId, documentId, title: 'Seq', tiptapJson: paragraphs('Seq'), awaitDurable: true })
    await store.read(documentId)
    await store.save(documentId, { markdown: 'Seq\n\none', json: paragraphs('Seq', 'one') })
    await store.save(documentId, { markdown: 'Seq\n\ntwo', json: paragraphs('Seq', 'two') })
    const mine = await store.revisionOf(documentId)
    expect(await cell.markdown(graphId, documentId)).toContain('two')
    await cell.call('write_document', { graphId, documentId, title: 'Seq', tiptapJson: paragraphs('Seq', 'agent'), awaitDurable: true })
    expect(await store.revisionOf(documentId)).toBe((mine ?? 0) + 1)
  })

  it('overwrites deliberately when told which revision the user saw', async () => {
    const documentId = 'overwrite'
    await cell.call('write_document', { graphId, documentId, title: 'Ow', tiptapJson: paragraphs('Ow'), awaitDurable: true })
    await store.read(documentId)
    await cell.call('write_document', { graphId, documentId, title: 'Ow', tiptapJson: paragraphs('Ow', 'remote'), awaitDurable: true })
    const latest = await store.revisionOf(documentId)
    await store.save(documentId, { markdown: 'Ow\n\nmine', json: paragraphs('Ow', 'mine'), expectedRevision: latest })
    expect(await cell.markdown(graphId, documentId)).toContain('mine')
  })

  it('finds leaves by words in their body, not only their title', async () => {
    await cell.call('write_document', {
      graphId, documentId: 'zoo', title: 'Animals', tiptapJson: paragraphs('Animals', 'A quiet zebra grazes.'), awaitDurable: true,
    })
    const hits = await store.search('zebra')
    expect(hits.map(hit => hit.id)).toContain('zoo')
    expect(hits.find(hit => hit.id === 'zoo')?.snippet).toContain('zebra')
  })
})

/**
 * Hoja's scope (Vera, 2026-09-23): a leaf shows in Hoja when it is a daily
 * note, sits at the graph root, or lives under the "Hoja" folder. Everything
 * else in the graph stays Garden's. These fail on f8a1ad6, which listed and
 * searched every document and created new leaves at the root.
 */
describe.skipIf(!binary)('Hoja scope on a real gardend cell', { timeout: 60_000 }, () => {
  let cell: LocalCell
  const graphId = 'hoja-scope-test'
  const bareGraphId = 'hoja-scope-bare'
  let graphs: Awaited<ReturnType<LocalCell['createGraph']>>[]
  const word = 'kumquat'
  const store = (id = graphId, role: 'editor' | 'viewer' = 'editor', workspacePageSize?: number) => new CellStore({
    gateway: cell.gateway(graphs.map(graph => ({ ...graph, role }))),
    graphId: id,
    storage: null,
    location: new URL('https://hoja.test/'),
    ...(workspacePageSize ? { workspacePageSize } : {}),
  })
  // write_document re-files what it writes at the root (gardend
  // write_workspace_document), so a seeded body is moved back into its folder.
  const seed = async (documentId: string, title: string, parentId?: string) => {
    await cell.call('write_document', {
      graphId, documentId, title, tiptapJson: paragraphs(title, `A ${word} in ${title}.`), awaitDurable: true,
    })
    if (parentId) await cell.call('move_documents', { graphId, documentIds: [documentId], parentId })
  }
  const placement = async (id: string, documentId: string) => {
    const all = await cell.call<{ documents: Array<{ id: string, parentId: string | null, order: number }> }>(
      'get_workspace', { graphId: id, depth: 5, limit: 200 })
    return all.documents.find(row => row.id === documentId)
  }
  const folder = (folderId: string, name: string, parentId?: string) =>
    cell.call('create_folder', { graphId, folderId, name, ...(parentId ? { parentId } : {}) })
  const rootFolders = async (id: string) =>
    (await cell.call<{ folders: Array<{ id: string, title: string }> }>('get_workspace', { graphId: id, depth: 1 })).folders

  beforeAll(async () => {
    cell = await LocalCell.start(binary!)
    graphs = [await cell.createGraph(graphId, 'Hoja scope'), await cell.createGraph(bareGraphId, 'Hoja scope, no folder')]
    // A Hoja folder the user made in Garden: found by its title, whatever its id.
    await folder('user-made-hoja', 'Hoja')
    await folder('user-made-hoja-sub', 'Drafts', 'user-made-hoja')
    // Garden's own daily-note hierarchy (frontend/src/lib/daily-note-folders.ts).
    await folder('folder-daily-notes', 'Daily Notes')
    await folder('folder-daily-notes-2026-09', 'September 2026', 'folder-daily-notes')
    await folder('folder-daily-notes-2026-09-second', '16-31', 'folder-daily-notes-2026-09')
    await folder('projects', 'Projects')
    await seed('scope-root', 'At the root')
    await seed('scope-hoja', 'In Hoja', 'user-made-hoja')
    await seed('scope-hoja-sub', 'In Hoja drafts', 'user-made-hoja-sub')
    await seed('daily-note-2026-09-23', 'September 23, 2026', 'folder-daily-notes-2026-09-second')
    await seed('scope-other', 'In Projects', 'projects')
  }, 120_000)

  afterAll(async () => { await cell?.stop() }, 30_000)

  it('lists daily notes, root leaves and the Hoja folder (nested too), and nothing else', async () => {
    const ids = (await store().list()).map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining(['scope-root', 'scope-hoja', 'scope-hoja-sub', 'daily-note-2026-09-23']))
    expect(ids).not.toContain('scope-other')
  })

  it('follows get_workspace paging to the end', async () => {
    const paged = (await store(graphId, 'editor', 1).list()).map(row => row.id).sort()
    const whole = (await store().list()).map(row => row.id).sort()
    expect(paged).toEqual(whole)
    expect(paged.length).toBeGreaterThan(3)
  })

  it('switches workspaces and scopes the next list to the new graph', async () => {
    await cell.call('write_document', { graphId: bareGraphId, documentId: 'bare-switch', title: 'Switch', tiptapJson: paragraphs('Switch'), awaitDurable: true })
    const hoja = store()
    expect((await hoja.list()).map(row => row.id)).toContain('scope-root')
    await hoja.switchGraph(bareGraphId)
    const ids = (await hoja.list()).map(row => row.id)
    expect(ids).toContain('bare-switch')
    expect(ids).not.toContain('scope-root')
    await expect(hoja.switchGraph('elsewhere')).rejects.toThrow(/not available/i)
  })

  it('keeps list rows dated and titled from the cell', async () => {
    const row = (await store().list()).find(item => item.id === 'scope-hoja-sub')!
    expect(row.title).toBe('In Hoja drafts')
    expect(row.modified_ms).toBeGreaterThan(Date.parse('2026-01-01'))
  })

  it('searches only inside that scope', async () => {
    const ids = (await store().search(word)).map(hit => hit.id)
    expect(ids).toEqual(expect.arrayContaining(['scope-root', 'scope-hoja', 'scope-hoja-sub', 'daily-note-2026-09-23']))
    expect(ids).not.toContain('scope-other')
  })

  it('still opens an out-of-scope leaf by id', async () => {
    const doc = await store().read('scope-other')
    expect(doc.markdown).toContain(word)
  })

  it('creates new leaves inside the existing Hoja folder', async () => {
    const hoja = store()
    const { id } = await hoja.create()
    const inHoja = await cell.call<{ documents: Array<{ id: string }> }>('get_workspace', { graphId, folderId: 'user-made-hoja', depth: 1 })
    expect(inHoja.documents.map(row => row.id)).toContain(id)
    expect((await hoja.list()).map(row => row.id)).toContain(id)
    expect((await rootFolders(graphId)).filter(item => item.title === 'Hoja')).toHaveLength(1)
  })

  it('makes the Hoja folder on the first new leaf in a graph that has none', async () => {
    await cell.call('write_document', { graphId: bareGraphId, documentId: 'bare-root', title: 'Bare', tiptapJson: paragraphs('Bare'), awaitDurable: true })
    expect((await rootFolders(bareGraphId)).map(item => item.id)).not.toContain(HOJA_FOLDER_ID)
    const hoja = store(bareGraphId)
    const { id } = await hoja.create()
    const folders = await rootFolders(bareGraphId)
    expect(folders).toEqual(expect.arrayContaining([expect.objectContaining({ id: HOJA_FOLDER_ID, title: 'Hoja' })]))
    const inHoja = await cell.call<{ documents: Array<{ id: string }> }>('get_workspace', { graphId: bareGraphId, folderId: HOJA_FOLDER_ID, depth: 1 })
    expect(inHoja.documents.map(row => row.id)).toEqual([id])
    // A second leaf reuses the folder rather than minting another.
    await store(bareGraphId).create()
    expect((await rootFolders(bareGraphId)).filter(item => item.title === 'Hoja')).toHaveLength(1)
  })

  it('keeps a leaf in its folder, in place, when Hoja saves it', async () => {
    const hoja = store()
    await hoja.list()
    const before = await placement(graphId, 'scope-hoja-sub')
    await hoja.read('scope-hoja-sub')
    await hoja.save('scope-hoja-sub', { markdown: 'In Hoja drafts\n\nedited', json: paragraphs('In Hoja drafts', 'edited') })
    await hoja.save('scope-hoja-sub', { markdown: 'In Hoja drafts\n\nedited twice', json: paragraphs('In Hoja drafts', 'edited twice') })
    const after = await placement(graphId, 'scope-hoja-sub')
    expect({ parentId: after?.parentId, order: after?.order }).toEqual({ parentId: before?.parentId, order: before?.order })
    expect(before?.parentId).toBe('user-made-hoja-sub')
    expect(await cell.markdown(graphId, 'scope-hoja-sub')).toContain('edited twice')
  })

  it('keeps a new leaf in the Hoja folder after its first save', async () => {
    const hoja = store()
    const { id } = await hoja.create()
    await hoja.save(id, { markdown: 'Typed\n\nfirst words', json: paragraphs('Typed', 'first words') })
    expect((await placement(graphId, id))?.parentId).toBe('user-made-hoja')
  })

  it('leaves an out-of-scope leaf where it lives when saved by id', async () => {
    const hoja = store()
    await hoja.read('scope-other')
    await hoja.save('scope-other', { markdown: 'In Projects\n\nfrom hoja', json: paragraphs('In Projects', 'from hoja') })
    expect((await placement(graphId, 'scope-other'))?.parentId).toBe('projects')
  })

  it('creates nothing for a viewer', async () => {
    const before = await rootFolders(bareGraphId)
    await expect(store(bareGraphId, 'viewer').create()).rejects.toThrow(/read-only/i)
    expect(await rootFolders(bareGraphId)).toEqual(before)
  })
})
