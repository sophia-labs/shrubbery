// @vitest-environment node
/**
 * Companions (files-companions.ts): what belongs to a file rather than sitting beside it. Vera's Datasheets folder showed 40 items for 20
 * sheets: every PDF had its reader's `.text.txt` beside it. The real listing of her library (fixtures/datasheet-page) is the witness.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FilePaneNode, FilePaneSection } from '@shrubbery/nucleus'
import { companionsOf, findCompanions, withoutCompanions } from '../files-companions.js'
import { sidebarSectionsFromDocuments, type SidebarArtifact, type SidebarDocument, type SidebarFolder } from '../sidebar-documents.js'

const listing = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/datasheet-page/datasheet-library-listing.json'), 'utf8')) as {
  folders: { id: string; label: string; parentId: string | null }[]; artifacts: { id: string; label: string; parentId: string; fileType: string; mimeType: string }[] }

function sections(extraDocs: SidebarDocument[] = [], drop: string[] = []): FilePaneSection[] {
  const folders: SidebarFolder[] = listing.folders.map((f, i) => ({ id: f.id, label: f.label, parentId: f.parentId, order: i, section: 'artifacts' }))
  const artifacts: SidebarArtifact[] = listing.artifacts.filter(a => !drop.includes(a.id)).map((a, i) => ({ id: a.id, label: a.label, parentId: a.parentId, order: i,
    mimeType: a.mimeType, status: 'ready', fileType: a.fileType }))
  return sidebarSectionsFromDocuments(extraDocs, null, [], folders, new Set(folders.map(f => f.id)), artifacts) as FilePaneSection[]
}

const count = (secs: readonly FilePaneSection[], folderId: string) => {
  let n = 0
  const walk = (nodes: readonly FilePaneNode[], inside: boolean) => { for (const node of nodes) { if (inside && node.kind !== 'folder') n++; walk(node.children ?? [], node.kind === 'folder' ? node.id === folderId : inside) } }
  for (const s of secs) walk(s.nodes ?? [], false)
  return n
}

describe('companions in Vera\'s datasheet library', () => {
  it('every reader\'s text is its PDF\'s: the Datasheets folder holds 20 sheets, not 40', () => {
    const all = sections()
    const found = findCompanions(all)
    expect(found.size).toBe(28)
    expect([...found.values()].every(c => c.role === 'text' && c.label.endsWith('.text.txt') && c.ownerKey === `artifact:${c.id.replace(/-text$/, '')}`)).toBe(true)
    expect(count(all, 'ds-datasheets')).toBe(40)
    expect(count(withoutCompanions(all, found), 'ds-datasheets')).toBe(20)
  })

  it('a person\'s notes on a file are the file\'s too; a document that only looks like notes is not', () => {
    const docs: SidebarDocument[] = [
      { id: 'notes-ds-ede0a2dfc224c765', label: 'Notes on ti-opa2134_DS.pdf', parentId: null, order: 1, readOnly: false, sourceFile: null },
      { id: 'notes-nobody', label: 'Notes on nothing', parentId: null, order: 2, readOnly: false, sourceFile: null },
    ]
    const found = findCompanions(sections(docs))
    expect(companionsOf(found, 'artifact:ds-ede0a2dfc224c765').map(c => [c.role, c.label]).sort()).toEqual([['notes', 'Notes on ti-opa2134_DS.pdf'], ['text', 'ti-opa2134_DS.text.txt']])
    expect(found.has('document:notes-nobody')).toBe(false)
  })

  it('nothing is hidden whose file is gone: a reader\'s text whose PDF was trashed shows again', () => {
    const found = findCompanions(sections([], ['ds-ede0a2dfc224c765']))
    expect(found.has('artifact:ds-ede0a2dfc224c765-text')).toBe(false)
    expect(found.size).toBe(27)
  })
})
