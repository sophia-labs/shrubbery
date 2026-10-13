/**
 * imported-reader.test.ts — one imported conversation, opened for reading.
 *
 * NO MOCKS. The archive is the REAL in-memory implementation of the archive
 * interface (archive-fixtures.ts): it pages messages like the gateway, fails with
 * real ArchiveRequestErrors, and can hold a request so a race is reproduced.
 */
import { describe, expect, it } from 'vitest'
import { ArchiveRequestError, type ArchiveRevision } from '../conversation-archive.js'
import { createImportedReader } from '../imported-reader.js'
import { MemoryArchive, archiveMessage, at, cid, importedItem, rid, sampleConversation } from './archive-fixtures.js'

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => archiveMessage(`x${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`, { occurredAt: at(2026, 3, 3, 9, index % 60) }))

function readerFor(messages = sampleConversation(), extra: Parameters<typeof importedItem>[1] = {}, options: ConstructorParameters<typeof MemoryArchive>[0] = {}) {
  const item = importedItem(7, {
    revision: { revisionId: rid(7), title: 'Kimi chat', messageCount: messages.length, partCount: 9 },
    firstOccurredAt: at(2026, 3, 3, 14, 5),
    lastOccurredAt: at(2026, 3, 3, 14, 7),
    models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
    attributionBasis: 'account header',
    ...extra,
  })
  const archive = new MemoryArchive({ items: [item], messages: { [cid(7)]: messages }, ...options })
  return { archive, item, reader: createImportedReader(archive, item) }
}

describe('opening an imported conversation', () => {
  it('reads the revisions and the first page, and is ready with a transcript in the kernel\'s vocabulary', async () => {
    const { reader, archive } = readerFor()
    expect(reader.getState().status).toBe('loading')
    await reader.open()
    const state = reader.getState()
    expect(state.status).toBe('ready')
    expect(state.messages).toHaveLength(3)
    expect(state.nextCursor).toBeNull()
    expect(state.totalMessages).toBe(3)
    expect(state.revisionId).toBe(rid(7))
    expect(archive.calls).toEqual([`revisions:${cid(7)}`, `messages:${cid(7)}:${rid(7)}:0`])
    const { messages, annotations } = reader.transcript()
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(messages[1].parts.map(part => part.type)).toEqual(['reasoning', 'tool', 'text'])
    expect(messages[1].toolCalls[0].output).toBeNull()
    expect(annotations.get('m2')).toBe('Mar 3, 2026, 2:06 PM · voice: Kimi K2.5 · source-recorded')
    expect(annotations.get('m3')).toBe('Mar 3, 2026, 2:07 PM · voice not recorded')
  })

  it('says what the person needs to read it: a provenance line, a real range, the voices, the count and a plain note', async () => {
    const { reader } = readerFor()
    await reader.open()
    const header = reader.header()
    expect(header.title).toBe('Kimi chat')
    expect(header.provenance).toBe('Imported from the old garden · account header')
    expect(header.range).toBe('Mar 3, 2026')
    expect(header.voices).toBe('Kimi K2.5')
    expect(header.countLine).toBe('3 of 3 messages')
    expect(header.note).toContain('may be missing')
    expect(header.note).not.toMatch(/opencode|sqlite|export\.v1/i)
  })

  it('says "voice not recorded" for the conversation when the gateway gave no model, and derives no range it was not given while unloaded', async () => {
    const { reader } = readerFor(many(120), { models: undefined, firstOccurredAt: undefined, lastOccurredAt: undefined, attributionBasis: undefined })
    await reader.open()
    const header = reader.header()
    expect(header.voices).toBeNull()
    expect(header.provenance).toBe('Imported from the old garden')
    expect(header.countLine).toBe('50 of 120 messages')
    // Only the first page is loaded, so the end of its range would be a guess.
    expect(header.range).toBeNull()
    await reader.loadAll()
    expect(reader.header().range).toBe('Mar 3, 2026')
  })

  it('carries the Continue intent: which conversation, which revision, its title, and how many messages were loaded', async () => {
    const { reader } = readerFor(many(120))
    await reader.open()
    expect(reader.continueIntent()).toEqual({ conversationId: cid(7), revisionId: rid(7), title: 'Kimi chat', messagesLoaded: 50 })
    await reader.loadMore()
    expect(reader.continueIntent().messagesLoaded).toBe(100)
  })

  it('opens a conversation with no title as an untitled conversation', async () => {
    const { reader } = readerFor(sampleConversation(), { revision: { revisionId: rid(7), title: '', messageCount: 3, partCount: 3 } })
    await reader.open()
    expect(reader.header().title).toBe('Untitled conversation')
    expect(reader.continueIntent().title).toBe('Untitled conversation')
  })
})

describe('reading further, and reading another revision', () => {
  it('appends the next page and knows when there is no more', async () => {
    const { reader } = readerFor(many(120))
    await reader.open()
    expect(reader.getState().nextCursor).toBe(50)
    await reader.loadMore()
    expect(reader.getState().messages).toHaveLength(100)
    await reader.loadMore()
    expect(reader.getState().messages).toHaveLength(120)
    expect(reader.getState().nextCursor).toBeNull()
    const before = reader.getState().messages
    await reader.loadMore()
    expect(reader.getState().messages).toBe(before)
  })

  it('projects the same messages to the same objects until something is added', async () => {
    const { reader } = readerFor(many(120))
    await reader.open()
    const first = reader.transcript()
    expect(reader.transcript()).toBe(first)
    await reader.loadMore()
    expect(reader.transcript()).not.toBe(first)
    expect(reader.transcript().messages).toHaveLength(100)
  })

  it('does not ask for the same page twice at once', async () => {
    const { reader, archive } = readerFor(many(120))
    await reader.open()
    const release = archive.hold('messages')
    const one = reader.loadMore()
    const two = reader.loadMore()
    release()
    await Promise.all([one, two])
    expect(reader.getState().messages).toHaveLength(100)
    expect(archive.countOf('messages')).toBe(2)
  })

  it('switches to another revision and reads it from the start', async () => {
    const revisions: ArchiveRevision[] = [
      { revisionId: rid(7), title: 'Kimi chat', messageCount: 3, partCount: 9 },
      { revisionId: rid(8), title: 'Kimi chat', messageCount: 3, partCount: 9 },
    ]
    const { reader, archive } = readerFor(sampleConversation(), {}, { revisions: { [cid(7)]: revisions } })
    await reader.open()
    expect(reader.getState().revisions.map(revision => revision.revisionId)).toEqual([rid(7), rid(8)])
    await reader.switchRevision(rid(8))
    expect(reader.getState().revisionId).toBe(rid(8))
    expect(reader.getState().messages).toHaveLength(3)
    expect(reader.continueIntent().revisionId).toBe(rid(8))
    expect(archive.calls.at(-1)).toBe(`messages:${cid(7)}:${rid(8)}:0`)
  })

  it('lets the newest request win when two are in flight', async () => {
    const revisions: ArchiveRevision[] = [
      { revisionId: rid(7), title: 'Kimi chat', messageCount: 3, partCount: 9 },
      { revisionId: rid(8), title: 'Kimi chat', messageCount: 3, partCount: 9 },
    ]
    const { reader, archive } = readerFor(sampleConversation(), {}, { revisions: { [cid(7)]: revisions } })
    await reader.open()
    const releaseSlow = archive.hold('messages')
    const slow = reader.switchRevision(rid(8))
    const fast = reader.switchRevision(rid(7))
    await fast
    releaseSlow()
    await slow
    expect(reader.getState().revisionId).toBe(rid(7))
  })
})

describe('when the archive refuses or cannot be reached', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [410, 'erased'],
    [404, 'missing'],
    [503, 'unavailable'],
  ] as const)('a %i on opening is an error state with its own words', async (status, kind) => {
    const { reader, archive } = readerFor()
    archive.failNext('messages', new ArchiveRequestError(status, null, `status ${status}`))
    await reader.open()
    expect(reader.getState().status).toBe('error')
    expect(reader.getState().failure?.kind).toBe(kind)
    expect(reader.getState().messages).toEqual([])
  })

  it('opens again after a failure', async () => {
    const { reader, archive } = readerFor()
    archive.failNext('messages')
    await reader.open()
    expect(reader.getState().status).toBe('error')
    await reader.open()
    expect(reader.getState().status).toBe('ready')
    expect(reader.getState().failure).toBeNull()
    expect(reader.getState().messages).toHaveLength(3)
  })

  it('keeps what was read when a later page fails, and says so beside it', async () => {
    const { reader, archive } = readerFor(many(120))
    await reader.open()
    archive.failNext('messages')
    await reader.loadMore()
    const state = reader.getState()
    expect(state.status).toBe('ready')
    expect(state.messages).toHaveLength(50)
    expect(state.moreFailure?.kind).toBe('unavailable')
    await reader.loadMore()
    expect(reader.getState().messages).toHaveLength(100)
    expect(reader.getState().moreFailure).toBeNull()
  })
})

describe('reading everything, for Save and Download', () => {
  it('loads every remaining page in order and reports progress', async () => {
    const { reader } = readerFor(many(120))
    await reader.open()
    const seen: Array<[number, number]> = []
    const all = await reader.loadAll({ onProgress: (loaded, total) => seen.push([loaded, total]) })
    expect(all.complete).toBe(true)
    expect(all.messages).toHaveLength(120)
    expect(all.messages.map(message => message.messageId).slice(0, 3)).toEqual(['x0', 'x1', 'x2'])
    expect(seen.at(-1)).toEqual([120, 120])
    expect(seen.map(entry => entry[0])).toEqual([...seen.map(entry => entry[0])].sort((a, b) => a - b))
  })

  it('stops at a cap and says the copy is not the whole conversation', async () => {
    const { reader } = readerFor(many(230))
    await reader.open()
    const all = await reader.loadAll({ maxMessages: 100 })
    expect(all.complete).toBe(false)
    expect(all.messages).toHaveLength(100)
    expect(reader.getState().nextCursor).toBe(100)
  })

  it('stops when told to, and throws nothing for it', async () => {
    const { reader, archive } = readerFor(many(230))
    await reader.open()
    const controller = new AbortController()
    const release = archive.hold('messages')
    const loading = reader.loadAll({ signal: controller.signal })
    controller.abort()
    release()
    const all = await loading
    expect(all.complete).toBe(false)
    expect(all.messages.length).toBeLessThan(230)
  })

  it('reports a failure while reading everything instead of pretending it finished', async () => {
    const { reader, archive } = readerFor(many(120))
    await reader.open()
    archive.failNext('messages')
    await expect(reader.loadAll()).rejects.toBeInstanceOf(ArchiveRequestError)
    expect(reader.getState().messages).toHaveLength(50)
  })
})

describe('leaving', () => {
  it('ignores an answer that arrives after it was disposed, and tells subscribers about every change until then', async () => {
    const { reader, archive } = readerFor()
    let heard = 0
    reader.subscribe(() => { heard += 1 })
    const release = archive.hold('messages')
    const opening = reader.open()
    const before = heard
    reader.dispose()
    release()
    await opening
    expect(reader.getState().messages).toEqual([])
    expect(heard).toBe(before)
  })
})
