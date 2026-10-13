/**
 * conversation-export.test.ts — a conversation, live or imported, leaving the app
 * as one Markdown file (Download) or one Garden document (Save).
 *
 * NO MOCKS. Live messages are real kernel ChatMessages; imported ones are read
 * through the real reader over the real in-memory archive (archive-fixtures.ts).
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shrubbery/chat-kernel'
import { buildMarkdownFile, importedExportSource, liveExportSource } from '../conversation-export.js'
import { createImportedReader } from '../imported-reader.js'
import { MemoryArchive, archiveMessage, at, cid, importedItem, rid, sampleConversation } from './archive-fixtures.js'

const NOW = new Date(2026, 8, 28, 15, 0).getTime()
const context = () => ({ signal: new AbortController().signal, onProgress: () => undefined })

const liveMessage = (id: string, role: 'user' | 'assistant', content: string, createdAt: number): ChatMessage =>
  ({ id, role, content, parts: [{ type: 'text', content }], isStreaming: false, toolCalls: [], createdAt })

async function importedReader(messages = sampleConversation(), extra: Parameters<typeof importedItem>[1] = {}) {
  const item = importedItem(7, {
    revision: { revisionId: rid(7), title: 'Kimi chat', messageCount: messages.length, partCount: 9 },
    firstOccurredAt: at(2026, 3, 3, 14, 5),
    lastOccurredAt: at(2026, 3, 3, 14, 7),
    models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
    attributionBasis: 'account header',
    ...extra,
  })
  const archive = new MemoryArchive({ items: [item], messages: { [cid(7)]: messages }, messagePageSize: 2 })
  const reader = createImportedReader(archive, item)
  await reader.open()
  return reader
}

describe('a live conversation as Markdown', () => {
  it('writes every turn in order with its time, and claims no provenance and no voice', async () => {
    const source = liveExportSource({
      title: 'Deploy notes',
      messages: [
        liveMessage('a', 'user', 'How do I roll the gateway?', new Date(2026, 8, 28, 9, 30).getTime()),
        liveMessage('b', 'assistant', 'Patch the image, then watch the rollout.', new Date(2026, 8, 28, 9, 31).getTime()),
      ],
    })
    const collected = await source.collect(context())
    expect(collected).toMatchObject({ kind: 'live', title: 'Deploy notes', provenance: null, note: null, complete: true, range: 'Sep 28, 2026' })
    const file = buildMarkdownFile(collected, NOW)
    expect(file.filename).toBe('deploy-notes-2026-09-28.md')
    expect(file.mimeType).toBe('text/markdown;charset=utf-8')
    expect(file.text.split('\n').slice(0, 3)).toEqual(['# Deploy notes', '', '*2 messages · Sep 28, 2026 · exported Sep 28, 2026*'])
    expect(file.text).toContain('## You\n\n*Sep 28, 2026, 9:30 AM*\n\nHow do I roll the gateway?')
    expect(file.text).toContain('## Assistant\n\n*Sep 28, 2026, 9:31 AM*\n\nPatch the image, then watch the rollout.')
    expect(file.text).not.toContain('voice')
    expect(file.text).not.toContain('Imported')
  })

  it('names an untitled chat honestly, and never by the label the shell once minted', async () => {
    for (const title of [null, '', 'organism-chat']) {
      const collected = await liveExportSource({ title, messages: [liveMessage('a', 'user', 'hi', NOW)] }).collect(context())
      expect(collected.title).toBe('Untitled chat')
    }
    expect(buildMarkdownFile(await liveExportSource({ title: 'organism-chat', messages: [] }).collect(context()), NOW).filename).toBe('untitled-chat-2026-09-28.md')
  })

  it('leaves out a range it cannot state, because no message has a time', async () => {
    const collected = await liveExportSource({ title: 'T', messages: [liveMessage('a', 'user', 'hi', 0)] }).collect(context())
    expect(collected.range).toBeNull()
    expect(buildMarkdownFile(collected, NOW).text).toContain('Time not recorded')
  })
})

describe('a continued conversation as Markdown', () => {
  const window = (id: string, role: 'user' | 'assistant', content: string, createdAt: number): ChatMessage =>
    ({ ...liveMessage(id, role, content, createdAt), origin: 'window' as const })

  it('holds what was said in it, not the window it was given, and says what that window was', async () => {
    // The earlier conversation is an import the person owns; this one is theirs to put where they choose. Copying the
    // window into a workspace document would widen the audience of the OLD conversation without their saying so, and would
    // pass its turns off as this conversation's (no seam, no "Earlier assistant"). It stays where it is: saved on its own.
    const source = liveExportSource({
      title: 'Monads, again · continued',
      continues: 'Monads, again',
      messages: [
        window('w1', 'user', 'PRIVATE-OLD-QUESTION', new Date(2026, 7, 2, 8, 0).getTime()),
        window('w2', 'assistant', 'PRIVATE-OLD-ANSWER', new Date(2026, 7, 2, 8, 1).getTime()),
        liveMessage('a', 'user', 'So where were we?', new Date(2026, 8, 28, 9, 30).getTime()),
        liveMessage('b', 'assistant', 'We were on functors.', new Date(2026, 8, 28, 9, 31).getTime()),
      ],
    })
    const collected = await source.collect(context())
    expect(collected.turns).toHaveLength(2)
    expect(collected.note).toBe('This conversation continued “Monads, again”, imported from the old garden. The 2 earlier messages it was given are not copied here; save the original on its own.')
    const file = buildMarkdownFile(collected, NOW)
    expect(file.text).not.toContain('PRIVATE-OLD')
    expect(file.text).toContain('So where were we?')
    expect(file.text).toContain('We were on functors.')
    expect(file.text).toContain('> This conversation continued “Monads, again”')
    expect(file.text).toContain('*2 messages ·')
    // Its range is its own days, not the old conversation's.
    expect(collected.range).toBe('Sep 28, 2026')
  })

  it('says nothing of a window when there was none, and counts the window it was given when there is one but nothing else was said yet', async () => {
    const plain = await liveExportSource({ title: 'T', messages: [liveMessage('a', 'user', 'hi', NOW)] }).collect(context())
    expect(plain.note).toBeNull()
    const untouched = await liveExportSource({
      title: 'Monads, again · continued',
      continues: 'Monads, again',
      messages: [window('w1', 'user', 'PRIVATE-OLD-QUESTION', NOW)],
    }).collect(context())
    expect(untouched.turns).toEqual([])
    expect(untouched.note).toContain('The 1 earlier message it was given is not copied here')
  })
})

describe('an imported conversation as Markdown', () => {
  it('reads every page first, reports progress, and carries the provenance, the plain note and the voice of each turn', async () => {
    const reader = await importedReader()
    expect(reader.getState().messages).toHaveLength(2)
    const seen: Array<[number, number]> = []
    const collected = await importedExportSource(reader).collect({ signal: new AbortController().signal, onProgress: (loaded, total) => seen.push([loaded, total]) })
    expect(collected).toMatchObject({ kind: 'imported', title: 'Kimi chat', provenance: 'Imported from the old garden · account header', range: 'Mar 3, 2026', complete: true })
    expect(collected.turns).toHaveLength(3)
    expect(seen.at(-1)).toEqual([3, 3])
    const file = buildMarkdownFile(collected, NOW)
    expect(file.filename).toBe('kimi-chat-2026-09-28.md')
    expect(file.text).toContain('*Imported from the old garden · account header · 3 messages · Mar 3, 2026 · exported Sep 28, 2026*')
    expect(file.text).toContain('may be missing')
    expect(file.text).toContain('*Mar 3, 2026, 2:06 PM · voice: Kimi K2.5 · source-recorded*')
    expect(file.text).toContain('*Mar 3, 2026, 2:07 PM · voice not recorded*')
    expect(file.text).toContain('_Output not retained._')
    expect(file.text).toContain('> **Thinking**')
  })

  it('says so, in the file itself, when the copy stops short of the whole conversation', async () => {
    const many = Array.from({ length: 9 }, (_, index) => archiveMessage(`x${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`, { occurredAt: at(2026, 3, 3, 9, index) }))
    const reader = await importedReader(many)
    const collected = await importedExportSource(reader, { maxMessages: 4 }).collect(context())
    expect(collected.complete).toBe(false)
    expect(collected.turns.length).toBeLessThan(9)
    expect(collected.note).toContain(`Only the first ${collected.turns.length} of 9 messages are included.`)
    expect(buildMarkdownFile(collected, NOW).text).toContain(`Only the first ${collected.turns.length} of 9 messages are included.`)
  })

  it('gives an untitled import an honest name in the file and its name', async () => {
    const reader = await importedReader(sampleConversation(), { revision: { revisionId: rid(7), title: '', messageCount: 3, partCount: 9 } })
    const collected = await importedExportSource(reader).collect(context())
    expect(collected.title).toBe('Untitled conversation')
    expect(buildMarkdownFile(collected, NOW).filename).toBe('untitled-conversation-2026-09-28.md')
  })
})
