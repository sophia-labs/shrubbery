import type { WbBacklinkTarget } from '@shrubbery/runtime'
import { describe, expect, it } from 'vitest'
import { makeBacklinksReader, parseBacklinksResult } from '../backlinks-reader.js'
import type { McpToolPort } from '../typed-object-reader.js'

// `get_backlinks`'s documented answer (INTERFACES §3): absent options are omitted, rows sorted and unique.
const ANSWER = {
  graphId: 'wb-graph',
  target: { documentId: 'doc-traumdeutung' },
  backlinks: [
    { kind: 'board-link', sourceDocumentId: 'wb-board', sourceBlockId: 'lnk0000000000000000001', sourceTitle: 'Dream-work board', sourceKind: 'whiteboard' },
    { kind: 'wire', sourceDocumentId: 'doc-notes', sourceTitle: 'Notes', sourceKind: 'document', predicate: 'supports', wireId: 'wire-wb-0001' },
  ],
  count: 2,
}

const OBJECT_ANSWER = {
  graphId: 'wb-graph',
  target: { iri: 'urn:mnemosyne:local:graph:wb-graph:dream:wolf-man' },
  backlinks: [
    { kind: 'board-card', sourceDocumentId: 'wb-board', sourceBlockId: 'crd0000000000000000001', sourceKind: 'whiteboard', viaConnection: 'arw0000000000000000002' },
  ],
  count: 1,
}

/** A port that answers from literal JSON in the documented shape and keeps what it was asked. */
function portAnswering(answers: (args: Record<string, unknown>) => unknown): McpToolPort & { readonly calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args })
      return answers(args)
    },
  }
}

describe('backlinks reader', () => {
  it('parses_a_bare_result_and_the_text_content_wrapper', () => {
    const bare = parseBacklinksResult(ANSWER)
    expect(bare.graphId).toBe('wb-graph')
    expect(bare.target).toEqual({ documentId: 'doc-traumdeutung' })
    expect(bare.count).toBe(2)
    expect(bare.backlinks.map((row) => row.kind)).toEqual(['board-link', 'wire'])
    // Absent options stay absent (never null, never empty).
    expect(bare.backlinks[0]).toEqual(ANSWER.backlinks[0])
    expect('predicate' in bare.backlinks[0]!).toBe(false)

    const wrapped = parseBacklinksResult({ content: [{ type: 'text', text: JSON.stringify(ANSWER) }] })
    expect(wrapped).toEqual(bare)
    const structured = parseBacklinksResult({ structuredContent: ANSWER })
    expect(structured).toEqual(bare)

    // A row of a kind the shell does not know, or without a source, is not a backlink.
    const rough = parseBacklinksResult({
      ...ANSWER,
      backlinks: [...ANSWER.backlinks, { kind: 'telepathy', sourceDocumentId: 'doc-x' }, { kind: 'link' }, null],
    })
    expect(rough.backlinks).toHaveLength(2)
    // An empty answer and an answer that is not backlinks at all read as nobody linking.
    expect(parseBacklinksResult({ graphId: 'g', target: {}, backlinks: [], count: 0 }).backlinks).toEqual([])
    expect(parseBacklinksResult('not json').backlinks).toEqual([])
    // A refusal keeps the cell's words.
    expect(() => parseBacklinksResult({ isError: true, content: [{ type: 'text', text: 'graph is tombstoned' }] })).toThrow('graph is tombstoned')
  })

  it('reads_rows_for_a_document_and_for_an_iri', async () => {
    const port = portAnswering((args) => (args.iri ? OBJECT_ANSWER : { content: [{ type: 'text', text: JSON.stringify(ANSWER) }] }))
    const reader = makeBacklinksReader(port)

    const forDocument = await reader.read({ graphId: 'wb-graph', documentId: 'doc-traumdeutung' })
    expect(forDocument.map((row) => [row.kind, row.sourceDocumentId])).toEqual([['board-link', 'wb-board'], ['wire', 'doc-notes']])

    const forObject = await reader.read({ graphId: 'wb-graph', iri: OBJECT_ANSWER.target.iri })
    expect(forObject).toEqual(OBJECT_ANSWER.backlinks)

    const forBlock = await reader.read({ graphId: 'wb-graph', documentId: 'doc-traumdeutung', blockId: 'blk-1' })
    expect(forBlock).toHaveLength(2)
    expect(port.calls.map((call) => call.name)).toEqual(['get_backlinks', 'get_backlinks', 'get_backlinks'])
    expect(port.calls[2]!.args).toEqual({ graphId: 'wb-graph', documentId: 'doc-traumdeutung', blockId: 'blk-1' })

    // A target gardend does not know is nobody linking to it; any other failure is the caller's to see.
    const unknown = makeBacklinksReader({ callTool: async () => { throw new Error('graph not found: nope') } })
    expect(await unknown.read({ graphId: 'nope', documentId: 'd' })).toEqual([])
    const broken = makeBacklinksReader({ callTool: async () => { throw new Error('connection reset') } })
    await expect(broken.read({ graphId: 'g', documentId: 'd' })).rejects.toThrow('connection reset')
  })

  it('sends_exactly_one_target', async () => {
    const port = portAnswering(() => ANSWER)
    const reader = makeBacklinksReader(port)
    await reader.read({ graphId: 'g', documentId: 'doc-a' })
    await reader.read({ graphId: 'g', iri: 'urn:x:y' })
    // Both given: the document wins, the iri is not sent.
    await reader.read({ graphId: 'g', documentId: 'doc-b', iri: 'urn:x:z' })
    // A block only means something inside a document.
    await reader.read({ graphId: 'g', iri: 'urn:x:w', blockId: 'blk-9' })
    for (const call of port.calls) {
      const sent = ['documentId', 'iri'].filter((key) => key in call.args)
      expect(sent).toHaveLength(1)
    }
    expect(port.calls.map((call) => call.args)).toEqual([
      { graphId: 'g', documentId: 'doc-a' },
      { graphId: 'g', iri: 'urn:x:y' },
      { graphId: 'g', documentId: 'doc-b' },
      { graphId: 'g', iri: 'urn:x:w' },
    ])
    // Neither given: nothing is asked.
    await expect(reader.read({ graphId: 'g' } as WbBacklinkTarget)).rejects.toThrow()
    expect(port.calls).toHaveLength(4)
  })

  it('caches_within_the_ttl_and_forgets', async () => {
    let clock = 1_000
    const port = portAnswering(() => ANSWER)
    const reader = makeBacklinksReader(port, { now: () => clock, ttlMs: 5000 })
    const target = { graphId: 'g', documentId: 'doc-a' }

    await reader.read(target)
    clock += 4_999
    await reader.read(target)
    expect(port.calls).toHaveLength(1)

    // Past the ttl the cell is asked again.
    clock += 2
    await reader.read(target)
    expect(port.calls).toHaveLength(2)

    // Another target is another read; forgetting a graph drops only that graph's.
    await reader.read({ graphId: 'h', documentId: 'doc-a' })
    expect(port.calls).toHaveLength(3)
    reader.forget('g')
    await reader.read(target)
    await reader.read({ graphId: 'h', documentId: 'doc-a' })
    expect(port.calls).toHaveLength(4)
    reader.forget()
    await reader.read({ graphId: 'h', documentId: 'doc-a' })
    expect(port.calls).toHaveLength(5)

    // Reads in flight are shared, and a failed read is never kept.
    let fail = true
    const flaky = makeBacklinksReader({
      async callTool() {
        if (fail) throw new Error('connection reset')
        return ANSWER
      },
    }, { now: () => clock })
    await expect(flaky.read(target)).rejects.toThrow('connection reset')
    fail = false
    expect(await flaky.read(target)).toHaveLength(2)
  })
})
