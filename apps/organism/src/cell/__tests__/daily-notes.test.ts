import { describe, expect, it } from 'vitest'
import {
  dailyNoteDocumentFromRow,
  dailyNoteFolderHierarchy,
  dailyNoteListSparql,
  ensureDailyNote,
  formatDailyNoteTitle,
  loadDailyNotes,
  todayKeyForTimeZone,
  type DailyNoteMcp,
  type DailyNoteRest,
} from '../daily-notes.js'

function recordingMcp(): DailyNoteMcp & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    async toolsCall(name, args) {
      calls.push({ name, args })
      return {}
    },
  }
}

describe('daily-note cell adapter', () => {
  it('derives Garden-compatible deterministic daily-note folders and titles', () => {
    expect(formatDailyNoteTitle('2026-05-15')).toBe('May 15, 2026')
    expect(dailyNoteFolderHierarchy('2026-05-15')).toEqual({
      root: { id: 'folder-daily-notes', name: 'Daily Notes', order: -1_000_000_000 },
      month: {
        id: 'folder-daily-notes-2026-05',
        name: 'May 2026',
        order: -202605,
        parentId: 'folder-daily-notes',
      },
      half: {
        id: 'folder-daily-notes-2026-05-first',
        name: '1-15',
        order: 1,
        parentId: 'folder-daily-notes-2026-05',
      },
      dailyNoteParentId: 'folder-daily-notes-2026-05-first',
      dailyNoteOrder: -15,
    })
    expect(dailyNoteFolderHierarchy('2026-05-16').half).toMatchObject({
      id: 'folder-daily-notes-2026-05-second',
      name: '16-31',
      order: 0,
    })
  })

  it('formats today keys in the requested timezone', () => {
    const instant = new Date('2026-06-23T02:30:00Z')
    expect(todayKeyForTimeZone('UTC', instant)).toBe('2026-06-23')
    expect(todayKeyForTimeZone('America/Los_Angeles', instant)).toBe('2026-06-22')
  })

  it('parses explicit daily-note rows and deterministic-id fallback rows', () => {
    expect(
      dailyNoteDocumentFromRow({
        doc: '<urn:mnemosyne:local:document:daily-note-2026-06-23>',
        label: '"June 23, 2026"',
        kind: '"daily-note"',
        dailyDate: '"2026-06-23"^^<http://www.w3.org/2001/XMLSchema#date>',
        timeZone: '"America/Montevideo"',
        updatedAt: '"2026-06-23T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
      }),
    ).toEqual({
      id: 'daily-note-2026-06-23',
      title: 'June 23, 2026',
      dateKey: '2026-06-23',
      timeZone: 'America/Montevideo',
      updatedAt: Date.parse('2026-06-23T10:00:00Z'),
    })

    expect(
      dailyNoteDocumentFromRow({
        doc: '<urn:mnemosyne:local:document:daily-note-2026-06-24>',
      }),
    ).toMatchObject({
      id: 'daily-note-2026-06-24',
      title: 'June 24, 2026',
      dateKey: '2026-06-24',
    })
    expect(dailyNoteDocumentFromRow({ doc: '<urn:mnemosyne:local:document:doc-a>' })).toBeNull()
  })

  it('loads daily notes through a GRAPH-scoped workspace projection query', async () => {
    const calls: Array<{ graphId: string; sparql: string }> = []
    const rest: DailyNoteRest = {
      async query(graphId, sparql) {
        calls.push({ graphId, sparql })
        return {
          rows: [
            {
              doc: '<urn:mnemosyne:local:document:daily-note-2026-06-24>',
              label: '"June 24, 2026"',
              kind: '"daily-note"',
              dailyDate: '"2026-06-24"',
            },
            {
              doc: '<urn:mnemosyne:local:document:daily-note-2026-06-23>',
              label: '"June 23, 2026"',
              kind: '"daily-note"',
              dailyDate: '"2026-06-23"',
            },
          ],
        }
      },
    }

    const notes = await loadDailyNotes(rest, 'graph-a')
    expect(calls).toEqual([{ graphId: 'graph-a', sparql: dailyNoteListSparql('graph-a') }])
    expect(dailyNoteListSparql('graph-a')).toContain('GRAPH <urn:mnemosyne:local:graph:graph-a:projection:workspace>')
    expect(notes.map(note => note.dateKey)).toEqual(['2026-06-23', '2026-06-24'])
  })

  it('returns existing notes without writing', async () => {
    const mcp = recordingMcp()
    const result = await ensureDailyNote(mcp, {
      graphId: 'graph-a',
      dateKey: '2026-06-23',
      timeZone: 'UTC',
      existing: [{ id: 'daily-note-2026-06-23', title: 'June 23, 2026', dateKey: '2026-06-23' }],
    })

    expect(result).toEqual({ documentId: 'daily-note-2026-06-23', created: false })
    expect(mcp.calls).toEqual([])
  })

  it('creates hierarchy folders and a daily-note document with metadata', async () => {
    const mcp = recordingMcp()
    const result = await ensureDailyNote(mcp, {
      graphId: 'graph-a',
      dateKey: '2026-06-23',
      timeZone: 'America/Montevideo',
      existing: [],
    })

    expect(result).toEqual({ documentId: 'daily-note-2026-06-23', created: true })
    expect(mcp.calls).toEqual([
      {
        name: 'create_folder',
        args: {
          graphId: 'graph-a',
          folderId: 'folder-daily-notes',
          name: 'Daily Notes',
          parentId: null,
          section: 'documents',
          order: -1_000_000_000,
        },
      },
      {
        name: 'create_folder',
        args: {
          graphId: 'graph-a',
          folderId: 'folder-daily-notes-2026-06',
          name: 'June 2026',
          parentId: 'folder-daily-notes',
          section: 'documents',
          order: -202606,
        },
      },
      {
        name: 'create_folder',
        args: {
          graphId: 'graph-a',
          folderId: 'folder-daily-notes-2026-06-second',
          name: '16-31',
          parentId: 'folder-daily-notes-2026-06',
          section: 'documents',
          order: 0,
        },
      },
      {
        name: 'create_document',
        args: {
          graphId: 'graph-a',
          documentId: 'daily-note-2026-06-23',
          title: 'June 23, 2026',
          parentId: 'folder-daily-notes-2026-06-second',
          order: -23,
          documentKind: 'daily-note',
          dailyNoteDate: '2026-06-23',
          dailyNoteTimeZone: 'America/Montevideo',
        },
      },
    ])
  })
})
