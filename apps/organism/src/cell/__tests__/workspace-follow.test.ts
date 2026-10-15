/**
 * What counts as a change the tree shows, decided on real Y.Docs: a "cell" document is edited the way gardend's
 * executor edits its workspace (`documents`/`folders`/`artifacts` maps of entry maps), and its updates reach a
 * "page" document as a provider applies them (a remote origin). No mocks; the follower over a real gardend room is
 * `tests/workspace-follow.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { touchedEntries, treeChangeIn, treeExpectations, treeShows, WORKSPACE_TREE_MAPS } from '../workspace-follow.js'

const REMOTE = { provider: 'the room' }

function file(cell: Y.Doc, map: string, id: string, fields: Record<string, unknown>): void {
  cell.transact(() => {
    const entries = cell.getMap<Y.Map<unknown>>(map)
    let entry = entries.get(id)
    if (!entry) {
      entry = new Y.Map<unknown>()
      entries.set(id, entry)
    }
    for (const [key, value] of Object.entries(fields)) entry.set(key, value)
  })
}

/** A page following a cell: every cell update is applied to the page with `origin`, and each observed change judged. */
function follow(origin: unknown = REMOTE) {
  const cell = new Y.Doc()
  const page = new Y.Doc()
  const verdicts: boolean[] = []
  for (const name of WORKSPACE_TREE_MAPS) {
    page.getMap(name).observeDeep((events, transaction) => {
      verdicts.push(treeChangeIn(events, transaction))
    })
  }
  cell.on('update', (update: Uint8Array) => Y.applyUpdate(page, update, origin))
  /** The verdicts of what `act` did to the cell (one per observed transaction on a tree map). */
  const judge = (act: () => void): boolean[] => {
    verdicts.length = 0
    act()
    return [...verdicts]
  }
  return { cell, page, judge }
}

const filed = {
  title: 'Battery Charger',
  parentId: null,
  section: 'documents',
  order: 1,
  createdAt: 1000,
  updatedAt: 1000,
  readOnly: false,
}

describe('treeChangeIn', () => {
  it('a document arriving, renamed, moved, trashed, restored and removed is a tree change', () => {
    const { cell, judge } = follow()
    expect(judge(() => file(cell, 'documents', 'doc-a', filed))).toEqual([true])
    expect(judge(() => file(cell, 'documents', 'doc-a', { title: 'Charger (TI BQ25185)', updatedAt: 2000 }))).toEqual([true])
    expect(judge(() => file(cell, 'documents', 'doc-a', { parentId: 'folder-parts', order: 7, updatedAt: 3000 }))).toEqual([true])
    expect(judge(() => file(cell, 'documents', 'doc-a', { trashed: true, updatedAt: 4000 }))).toEqual([true])
    expect(judge(() => cell.transact(() => cell.getMap<Y.Map<unknown>>('documents').get('doc-a')!.delete('trashed')))).toEqual([true])
    expect(judge(() => cell.transact(() => cell.getMap('documents').delete('doc-a')))).toEqual([true])
  })

  it('a folder or a file arriving or renamed is a tree change', () => {
    const { cell, judge } = follow()
    expect(judge(() => file(cell, 'folders', 'folder-parts', { name: 'Parts', parentId: null, section: 'documents', order: 1 }))).toEqual([true])
    expect(judge(() => file(cell, 'folders', 'folder-parts', { name: 'Components' }))).toEqual([true])
    expect(judge(() => file(cell, 'artifacts', 'artifact-pdf', { name: 'datasheet.pdf', mimeType: 'application/pdf', status: 'ready' }))).toEqual([true])
    expect(judge(() => file(cell, 'artifacts', 'artifact-pdf', { status: 'ingested' }))).toEqual([true])
  })

  it('a body write, which files the document again unchanged but for updatedAt, is not', () => {
    const { cell, judge } = follow()
    file(cell, 'documents', 'doc-a', filed)
    // gardend's write_document → workspace.createDocument with preserveParent/preserveOrder: every field set again.
    expect(judge(() => file(cell, 'documents', 'doc-a', { ...filed, updatedAt: 5000 }))).toEqual([false])
    expect(judge(() => file(cell, 'documents', 'doc-a', { description: 'A charger.', describedAt: 5100 }))).toEqual([false])
    expect(judge(() => file(cell, 'artifacts', 'artifact-scene', { sceneProjection: '{"nodes":[]}', sceneProjectedAt: 5200, contentOperationId: 'op-1' }))).toEqual([true])
    expect(judge(() => file(cell, 'artifacts', 'artifact-scene', { sceneProjection: '{"nodes":[1]}', sceneProjectedAt: 5300, contentOperationId: 'op-2' }))).toEqual([false])
  })

  it('a change to a map the tree is not made of is not observed at all', () => {
    const { cell, judge } = follow()
    expect(judge(() => cell.transact(() => cell.getMap('wires').set('wire-1', 'x')))).toEqual([])
    expect(judge(() => cell.transact(() => cell.getMap('ui').set('customCss', 'body {}')))).toEqual([])
  })

  it('the page\'s own edits and the snapshot it opened with are not a change from elsewhere', () => {
    const preflight = follow('workspace-snapshot-preflight')
    expect(preflight.judge(() => file(preflight.cell, 'documents', 'doc-a', filed))).toEqual([false])
    const { page } = follow()
    const verdicts: boolean[] = []
    page.getMap('documents').observeDeep((events, transaction) => verdicts.push(treeChangeIn(events, transaction)))
    page.transact(() => page.getMap('documents').set('doc-local', new Y.Map()))
    expect(verdicts).toEqual([false])
  })
})

describe('what the room says the tree should show', () => {
  it('names the entries a change touched: an arrival, a removal, a field', () => {
    const { cell, page } = follow()
    const touched: string[][] = []
    page.getMap('documents').observeDeep(events => touched.push(touchedEntries(events)))
    file(cell, 'documents', 'doc-a', filed)
    file(cell, 'documents', 'doc-a', { title: 'Renamed' })
    cell.transact(() => cell.getMap('documents').delete('doc-a'))
    expect(touched).toEqual([['doc-a'], ['doc-a'], ['doc-a']])
  })

  it('reads each touched document and folder out of the room: label, place, trash, absence', () => {
    const { cell, page } = follow()
    file(cell, 'folders', 'folder-parts', { name: 'Parts', parentId: null, section: 'documents', order: 1 })
    file(cell, 'documents', 'doc-a', { ...filed, parentId: 'folder-parts' })
    file(cell, 'documents', 'doc-b', { ...filed, title: 'Gone soon', trashed: true })
    const expected = treeExpectations(page, new Map([
      ['documents', new Set(['doc-a', 'doc-b', 'doc-never'])],
      ['folders', new Set(['folder-parts'])],
    ] as const))
    expect(expected).toEqual([
      { id: 'doc-a', kind: 'document', present: true, label: 'Battery Charger', parentId: 'folder-parts' },
      { id: 'doc-b', kind: 'document', present: false, label: 'Gone soon', parentId: null },
      { id: 'doc-never', kind: 'document', present: false },
      { id: 'folder-parts', kind: 'folder', present: true, label: 'Parts', parentId: null },
    ])
  })

  it('a tree shows a change only when every touched entry agrees with the room', () => {
    const tree = new Map<string, { label: string; parentId?: string | null }>([
      ['doc-a', { label: 'Battery Charger', parentId: 'folder-parts' }],
      ['folder-parts', { label: 'Parts' }],
    ])
    const node = (id: string) => tree.get(id) ?? null
    expect(treeShows([{ id: 'doc-a', kind: 'document', present: true, label: 'Battery Charger', parentId: 'folder-parts' }], node)).toBe(true)
    expect(treeShows([{ id: 'doc-a', kind: 'document', present: true, label: 'Renamed', parentId: 'folder-parts' }], node)).toBe(false)
    expect(treeShows([{ id: 'doc-a', kind: 'document', present: true, label: 'Battery Charger', parentId: null }], node)).toBe(false)
    expect(treeShows([{ id: 'doc-a', kind: 'document', present: false }], node)).toBe(false)
    expect(treeShows([{ id: 'doc-new', kind: 'document', present: true, label: 'New', parentId: null }], node)).toBe(false)
    expect(treeShows([{ id: 'doc-gone', kind: 'document', present: false }], node)).toBe(true)
    expect(treeShows([{ id: 'folder-parts', kind: 'folder', present: true, label: 'Parts', parentId: null }], node)).toBe(true)
    expect(treeShows([], node)).toBe(true)
  })
})
