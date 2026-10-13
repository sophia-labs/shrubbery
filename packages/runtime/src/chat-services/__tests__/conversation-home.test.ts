/**
 * conversation-home.test.ts — the pure model behind the one conversation home.
 *
 * NO MOCKS. Live conversations come from the REAL local ChatService; imported
 * ones are real ArchivedConversation values shaped like the gateway's catalogue
 * items. Dates are built from local calendar parts, so the expectations hold in
 * any time zone.
 */
import { describe, expect, it } from 'vitest'
import { ArchiveRequestError, type ArchivedConversation } from '../conversation-archive.js'
import {
  IMPORTED_PROVENANCE,
  UNTITLED_IMPORTED,
  UNTITLED_LIVE,
  VOICE_GLYPH,
  buildHomeList,
  describeArchiveFailure,
  displayTitle,
  formatAbsoluteDate,
  formatDateRange,
  formatRelativeDate,
  importedDatesAvailable,
  importedProvenanceText,
  isPlaceholderTitle,
  listLiveConversations,
  mergeConversationRows,
  modelDisplayName,
  modelVoiceLabel,
  nestSubAgents,
  normalizeSearch,
  searchRows,
  sessionToSummary,
  toImportedRow,
  toLiveRow,
  type ConversationSummary,
} from '../conversation-home.js'
import { makeLocalChatService } from '../local-chat-service.js'

const at = (year: number, month: number, day: number, hour = 12, minute = 0): string =>
  new Date(year, month - 1, day, hour, minute).toISOString()
const NOW = new Date(2026, 8, 28, 15, 0).getTime()
const CID = (n: number): string => 'urn:sophia:conversation-archive:conversation:' + n.toString(16).padStart(64, '0')

const live = (id: string, updatedAt: string, extra: Partial<ConversationSummary> = {}): ConversationSummary =>
  ({ id, kind: 'live', title: id, updatedAt, ...extra })
const imported = (n: number, extra: Partial<ArchivedConversation> = {}): ArchivedConversation => ({
  conversationId: CID(n),
  graphId: 'cloud1-opencode-archive',
  revision: { revisionId: n.toString(16).padStart(64, '0'), title: `Imported ${n}`, messageCount: 4, partCount: 6 },
  revisionCount: 1,
  ...extra,
})

describe('dates a person would say', () => {
  it('speaks relative time in words', () => {
    const cases: [string, string][] = [
      [new Date(NOW - 20_000).toISOString(), 'Just now'],
      [new Date(NOW - 60_000).toISOString(), '1 min ago'],
      [new Date(NOW - 5 * 60_000).toISOString(), '5 min ago'],
      [at(2026, 9, 28, 9, 0), '6 hr ago'],
      [at(2026, 9, 27, 8, 0), 'Yesterday'],
      [at(2026, 9, 25, 8, 0), '3 days ago'],
      [at(2026, 9, 21, 8, 0), 'Sep 21'],
      [at(2026, 3, 3, 8, 0), 'Mar 3'],
      [at(2025, 12, 31, 8, 0), 'Dec 31, 2025'],
    ]
    for (const [iso, words] of cases) expect(formatRelativeDate(iso, NOW), iso).toBe(words)
  })

  it('never says "in 3 hours": a time ahead of the clock is shown as a date', () => {
    expect(formatRelativeDate(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe('Sep 28, 2026')
  })

  it('has no words for a time that is not there or cannot be read', () => {
    expect(formatRelativeDate(null, NOW)).toBeNull()
    expect(formatRelativeDate(undefined, NOW)).toBeNull()
    expect(formatRelativeDate('', NOW)).toBeNull()
    expect(formatRelativeDate('soon', NOW)).toBeNull()
  })

  it('writes absolute dates with the twelve-hour clock', () => {
    expect(formatAbsoluteDate(at(2026, 3, 3, 14, 5), true)).toBe('Mar 3, 2026, 2:05 PM')
    expect(formatAbsoluteDate(at(2026, 3, 3, 14, 5))).toBe('Mar 3, 2026')
    expect(formatAbsoluteDate(at(2026, 3, 3, 0, 7), true)).toBe('Mar 3, 2026, 12:07 AM')
    expect(formatAbsoluteDate(at(2026, 3, 3, 12, 0), true)).toBe('Mar 3, 2026, 12:00 PM')
    expect(formatAbsoluteDate('nonsense', true)).toBeNull()
  })

  it('writes a range only from the ends it actually has', () => {
    expect(formatDateRange(at(2026, 3, 3, 9), at(2026, 3, 3, 17))).toBe('Mar 3, 2026')
    expect(formatDateRange(at(2026, 3, 3), at(2026, 3, 9))).toBe('Mar 3, 2026 – Mar 9, 2026')
    expect(formatDateRange(at(2026, 3, 3), null)).toBe('Mar 3, 2026')
    expect(formatDateRange(null, at(2026, 3, 9))).toBe('Mar 9, 2026')
    expect(formatDateRange(null, null)).toBeNull()
  })
})

describe('models and provenance', () => {
  it('turns a model id into a name a person would read', () => {
    expect(modelDisplayName('moonshotai/kimi-k2.5')).toBe('Kimi K2.5')
    expect(modelDisplayName('kimi-k2.5')).toBe('Kimi K2.5')
    expect(modelDisplayName('google/gemini-2.5-flash')).toBe('Gemini 2.5 Flash')
    expect(modelDisplayName('anthropic/claude-sonnet-4-5')).toBe('Claude Sonnet 4.5')
    expect(modelDisplayName('openai/gpt-4o')).toBe('GPT 4o')
    expect(modelDisplayName('z-ai/glm-4.6')).toBe('GLM 4.6')
    expect(modelDisplayName('moonshotai/kimi-k2:free')).toBe('Kimi K2')
    expect(modelDisplayName('  ')).toBe('')
  })

  it('names the first model and counts the rest', () => {
    expect(modelVoiceLabel([{ id: 'moonshotai/kimi-k2.5' }])).toBe('Kimi K2.5')
    expect(modelVoiceLabel([{ id: 'moonshotai/kimi-k2.5' }, { id: 'google/gemini-2.5-flash', provider: 'google' }])).toBe('Kimi K2.5 +1')
    expect(modelVoiceLabel([])).toBeNull()
    expect(modelVoiceLabel(undefined)).toBeNull()
    expect(VOICE_GLYPH).toBe('∿')
  })

  it('says where an imported chat came from, and on what basis when it is known', () => {
    expect(IMPORTED_PROVENANCE).toBe('Imported from the old garden')
    expect(importedProvenanceText(null)).toBe('Imported from the old garden')
    expect(importedProvenanceText('   ')).toBe('Imported from the old garden')
    expect(importedProvenanceText('account header')).toBe('Imported from the old garden · account header')
    expect(importedProvenanceText('legacy-owner-header')).toBe('Imported from the old garden · legacy owner header')
  })

  it('never shows an internal label as a title, and names an untitled chat honestly', () => {
    expect(displayTitle('  Hello  ', 'live')).toBe('Hello')
    expect(displayTitle(null, 'live')).toBe('Untitled chat')
    expect(displayTitle('New session - 2026-01-01T00:00:00Z', 'live')).toBe('Untitled chat')
    expect(displayTitle('New session - 2026-01-01T00:00:00Z', 'imported')).toBe('Untitled conversation')
    expect(displayTitle('', 'imported')).toBe('Untitled conversation')
    // The label the shell gave every first chat before chats were titled.
    for (const label of ['organism-chat', '  Organism-Chat ', 'New chat']) expect(displayTitle(label, 'live'), label).toBe('Untitled chat')
    // Only the whole label is a placeholder; a real name that mentions it is kept.
    expect(displayTitle('my organism-chat notes', 'live')).toBe('my organism-chat notes')
    expect(isPlaceholderTitle('organism-chat')).toBe(true)
    expect(isPlaceholderTitle('Deploy notes')).toBe(false)
    expect(UNTITLED_LIVE).toBe('Untitled chat')
    expect(UNTITLED_IMPORTED).toBe('Untitled conversation')
  })
})

describe('the live source', () => {
  it('adapts today\'s listSessions behind the ConversationSummary interface', async () => {
    const service = makeLocalChatService()
    const alpha = await service.createSession({ title: 'Alpha' })
    await service.createSession({ title: 'Beta' })
    const listed = await listLiveConversations(service)
    expect(listed.map(item => item.title).sort()).toEqual(['Alpha', 'Beta'])
    expect(listed.every(item => item.kind === 'live')).toBe(true)
    expect(listed.find(item => item.id === alpha.id)!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('maps a session summary field by field, falling back from updated to created and never inventing a time', () => {
    expect(sessionToSummary({ id: 'c2chat-1', title: 'T', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' }))
      .toEqual({ id: 'c2chat-1', kind: 'live', title: 'T', updatedAt: '2026-09-02T10:00:00Z', createdAt: '2026-09-01T10:00:00Z' })
    expect(sessionToSummary({ id: 'a', title: null, created_at: '2026-09-01T10:00:00Z', updated_at: null }).updatedAt).toBe('2026-09-01T10:00:00Z')
    expect(sessionToSummary({ id: 'b', title: null, created_at: null, updated_at: null }).updatedAt).toBe('')
  })

  it('prefers the service\'s own listConversations when it has one, and keeps only live entries', async () => {
    const service = makeLocalChatService()
    await service.createSession({ title: 'From listSessions' })
    Object.defineProperty(service, 'listConversations', {
      value: async () => [
        live('x', at(2026, 9, 1), { title: 'Across graphs', graphId: 'g2', models: [{ id: 'google/gemini-2.5-flash', provider: 'google' }] }),
        { ...live('y', at(2026, 9, 2)), kind: 'imported' as const },
      ],
    })
    const listed = await listLiveConversations(service)
    expect(listed.map(item => item.id)).toEqual(['x'])
    expect(listed[0].models).toEqual([{ id: 'google/gemini-2.5-flash', provider: 'google' }])
  })

  it('lets a failing listConversations fail, so the drawer can say so', async () => {
    const service = makeLocalChatService()
    Object.defineProperty(service, 'listConversations', { value: async () => { throw new Error('graph list unavailable') } })
    await expect(listLiveConversations(service)).rejects.toThrow('graph list unavailable')
  })
})

describe('one list, by real date', () => {
  it('reads the real date of each kind of row, and no workspace label from an import', () => {
    const row = toImportedRow(imported(5, {
      firstOccurredAt: at(2026, 9, 1), lastOccurredAt: at(2026, 9, 3), parentConversationId: CID(1),
      models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }], attributionBasis: 'account header',
    }))
    expect(row).toMatchObject({
      key: `imported:${CID(5)}`, kind: 'imported', title: 'Imported 5', dateIso: at(2026, 9, 3),
      graphId: null, parentId: CID(1), messageCount: 4, attributionBasis: 'account header',
    })
    expect(toImportedRow(imported(6, { firstOccurredAt: at(2026, 9, 1) })).dateIso).toBe(at(2026, 9, 1))
    expect(toImportedRow(imported(7)).dateIso).toBeNull()
    const fromRevision = toImportedRow(imported(8, {})).attributionBasis
    expect(fromRevision).toBeNull()
    const basisOnRevision = imported(9)
    basisOnRevision.revision.attributionBasis = 'lineage'
    expect(toImportedRow(basisOnRevision).attributionBasis).toBe('lineage')
    const liveRow = toLiveRow(live('c2chat-9', at(2026, 9, 5), { title: 'Mine', graphId: 'home', createdAt: at(2026, 9, 4) }))
    expect(liveRow).toMatchObject({ key: 'live:c2chat-9', kind: 'live', title: 'Mine', dateIso: at(2026, 9, 5), graphId: 'home', parentId: null, messageCount: null })
    expect(toLiveRow(live('u', '', { createdAt: at(2026, 9, 4) })).dateIso).toBe(at(2026, 9, 4))
    expect(toLiveRow(live('v', '')).dateIso).toBeNull()
  })

  it('merges live and imported, newest first, with undated imports after the dated rows in stored order', () => {
    const rows = mergeConversationRows(
      [live('a', at(2026, 9, 28, 12)), live('b', at(2026, 9, 20, 12))],
      [
        imported(1, { lastOccurredAt: at(2026, 9, 27, 12) }),
        imported(2, { lastOccurredAt: at(2026, 8, 1, 12) }),
        imported(3),
        imported(4),
      ],
    )
    expect(rows.map(row => row.key)).toEqual([
      'live:a', `imported:${CID(1)}`, 'live:b', `imported:${CID(2)}`, `imported:${CID(3)}`, `imported:${CID(4)}`,
    ])
  })

  it('reports whether the gateway gave any imported date at all', () => {
    expect(importedDatesAvailable([imported(1), imported(2)])).toBe(false)
    expect(importedDatesAvailable([imported(1), imported(2, { lastOccurredAt: at(2026, 9, 1) })])).toBe(true)
    expect(importedDatesAvailable([imported(3, { firstOccurredAt: at(2026, 9, 1) })])).toBe(true)
    expect(importedDatesAvailable([])).toBe(false)
  })
})

describe('sub-agent conversations under their parent', () => {
  it('nests children (and grandchildren) under the parent, oldest first, and leaves orphans and cycles as roots', () => {
    const rows = mergeConversationRows([], [
      imported(10, { lastOccurredAt: at(2026, 9, 27, 12) }),
      imported(11, { lastOccurredAt: at(2026, 9, 26, 12), parentConversationId: CID(10) }),
      imported(12, { lastOccurredAt: at(2026, 9, 25, 12), parentConversationId: CID(10) }),
      imported(16, { lastOccurredAt: at(2026, 9, 27, 13), parentConversationId: CID(11) }),
      imported(13, { lastOccurredAt: at(2026, 9, 24, 12), parentConversationId: CID(99) }),
      imported(14, { lastOccurredAt: at(2026, 9, 23, 12), parentConversationId: CID(15) }),
      imported(15, { lastOccurredAt: at(2026, 9, 22, 12), parentConversationId: CID(14) }),
    ])
    const roots = nestSubAgents(rows)
    expect(roots.map(row => row.id)).toEqual([CID(10), CID(13), CID(14), CID(15)])
    expect(roots[0].children.map(child => child.id)).toEqual([CID(12), CID(11), CID(16)])
    expect(roots[1].children).toEqual([])
    // Live rows are never nested, whatever an id looks like.
    const withLive = nestSubAgents(mergeConversationRows([live('l', at(2026, 9, 28))], [imported(20)]))
    expect(withLive.map(row => row.key)).toEqual(['live:l', `imported:${CID(20)}`])
  })
})

describe('search covers titles, across everything loaded', () => {
  const rows = [
    toLiveRow(live('1', at(2026, 9, 1), { title: 'Deploy to Sirin box' })),
    toLiveRow(live('2', at(2026, 9, 2), { title: 'Configuración del jardín' })),
    toImportedRow(imported(3)),
  ]

  it('folds case and accents and ignores extra spaces', () => {
    expect(normalizeSearch('  Configuración  Ñandú ')).toBe('configuracion nandu')
    expect(searchRows(rows, 'configuracion').map(row => row.id)).toEqual(['2'])
    expect(searchRows(rows, 'CONFIGURACIÓN').map(row => row.id)).toEqual(['2'])
  })

  it('needs every word, in any order', () => {
    expect(searchRows(rows, 'sirin deploy').map(row => row.id)).toEqual(['1'])
    expect(searchRows(rows, 'sirin jardin')).toEqual([])
  })

  it('shows everything for an empty query and reaches imported titles too', () => {
    expect(searchRows(rows, '   ')).toHaveLength(3)
    expect(searchRows(rows, 'imported 3').map(row => row.id)).toEqual([CID(3)])
  })
})

describe('the visible list', () => {
  const liveRows = [live('a', at(2026, 9, 28)), live('b', at(2026, 9, 10))]
  const importedRows = [
    imported(1, { lastOccurredAt: at(2026, 9, 27) }),
    imported(2, { lastOccurredAt: at(2026, 9, 26), parentConversationId: CID(1) }),
  ]

  it('nests sub-agents when browsing, flattens them when searching', () => {
    const browsing = buildHomeList({ live: liveRows, imported: importedRows, query: '', filter: 'all' })
    expect(browsing.searching).toBe(false)
    expect(browsing.rows.map(row => row.id)).toEqual(['a', CID(1), 'b'])
    expect(browsing.rows[1].children.map(child => child.id)).toEqual([CID(2)])
    expect(browsing.total).toBe(4)

    const searching = buildHomeList({ live: liveRows, imported: importedRows, query: 'imported', filter: 'all' })
    expect(searching.searching).toBe(true)
    expect(searching.rows.map(row => row.id)).toEqual([CID(1), CID(2)])
    expect(searching.rows.every(row => row.children.length === 0)).toBe(true)
    expect(searching.total).toBe(2)
  })

  it('filters by kind before nesting', () => {
    expect(buildHomeList({ live: liveRows, imported: importedRows, query: '', filter: 'live' }).rows.map(row => row.id)).toEqual(['a', 'b'])
    const onlyImported = buildHomeList({ live: liveRows, imported: importedRows, query: '', filter: 'imported' })
    expect(onlyImported.rows.map(row => row.id)).toEqual([CID(1)])
    expect(onlyImported.total).toBe(2)
  })
})

describe('what the archive said, in words', () => {
  const failure = (status: number, code: string | null = null) =>
    describeArchiveFailure(new ArchiveRequestError(status, code, `status ${status}`))

  it('gives the four refusals four different explanations', () => {
    const cases = [failure(401), failure(403, 'human_user_required'), failure(410, 'conversation_archive_erased'), failure(503, 'conversation_archive_busy')]
    expect(cases.map(item => item.kind)).toEqual(['unauthorized', 'forbidden', 'erased', 'unavailable'])
    expect(new Set(cases.map(item => item.title)).size).toBe(4)
    expect(new Set(cases.map(item => item.detail)).size).toBe(4)
    expect(cases.map(item => item.status)).toEqual([401, 403, 410, 503])
    expect(cases[2].code).toBe('conversation_archive_erased')
  })

  it('always tells the person their live chats are unaffected, and says whether trying again can help', () => {
    for (const item of [failure(401), failure(403), failure(410), failure(503), failure(0, 'unreachable'), failure(500)]) {
      expect(item.detail, item.kind).toContain('live chats')
    }
    expect(failure(410).retryable).toBe(false)
    expect(failure(403).retryable).toBe(false)
    expect(failure(503).retryable).toBe(true)
    expect(failure(401).retryable).toBe(true)
    expect(failure(0, 'unreachable').retryable).toBe(true)
  })

  it('never speaks of bringing anything back, revived or resurrected: an erased archive is gone, and says so plainly', () => {
    // Doctrine (Sobremesa section 4): no copy brings anyone back. The notice for an erased archive said its chats "cannot be
    // brought back"; it is about data, not a voice, but the rule is about the words.
    const forbidden = /\b(is back|are back|welcome back|revive\w*|resurrect\w*|bring(?:s|ing)? (?:\w+ )?back|brought (?:\w+ )?back|reincarnat\w*|lives? again)\b/i
    for (const item of [failure(401), failure(403), failure(404), failure(410), failure(503), failure(0, 'unreachable'), failure(500)]) {
      expect(`${item.title} ${item.detail}`.match(forbidden)?.[0], item.kind).toBeUndefined()
    }
    expect(failure(410).detail).toContain('cannot be recovered')
  })

  it('classifies the rest by what they mean', () => {
    expect(failure(0, 'unreachable').kind).toBe('unreachable')
    expect(failure(502).kind).toBe('unavailable')
    expect(failure(504).kind).toBe('unavailable')
    expect(failure(404, 'conversation_archive_not_found').kind).toBe('missing')
    expect(failure(418).kind).toBe('unknown')
    expect(describeArchiveFailure(new Error('Invalid conversation catalogue.')).kind).toBe('unknown')
    expect(describeArchiveFailure('nonsense').kind).toBe('unknown')
    expect(describeArchiveFailure(new Error('Invalid conversation catalogue.')).status).toBeNull()
  })
})
