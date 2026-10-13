/**
 * save-conversation.test.ts — "Save to Garden": a conversation copied into a
 * workspace the person can write to, as one Markdown document (or, when it is too
 * large for one, a few numbered ones).
 *
 * NO MOCKS. The MCP is a REAL in-memory implementation of the two-line interface
 * the shell writes through; it records every call and can fail the next one.
 */
import { describe, expect, it } from 'vitest'
import {
  SaveConversationError,
  callToolFromToolsCall,
  saveConversationToGarden,
  saveTargetsOf,
  splitMarkdownIntoParts,
  type SaveConversationMcp,
} from '../save-conversation.js'

class RecordingMcp implements SaveConversationMcp {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = []
  /** What the next calls do, in order. When the script is empty a call is acknowledged. */
  private readonly script: Array<{ error: Error } | { reply: unknown }> = []
  failNext(error: Error): void { this.script.push({ error }) }
  replyNext(reply: unknown): void { this.script.push({ reply }) }
  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push({ name, args: { ...args } })
    const step = this.script.shift()
    if (step && 'error' in step) throw step.error
    if (step) return step.reply
    return { success: true, graphId: args.graphId, documentId: args.documentId, revision: 1, durabilityChecked: true, durability: 'published' }
  }
}

let counter = 0
const ids = (_entity: string, label: string): string => `doc-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++counter}`

describe('saving one conversation as one document', () => {
  it('writes a new Markdown document into the chosen workspace, once, and refuses to overwrite one that exists', async () => {
    const mcp = new RecordingMcp()
    const result = await saveConversationToGarden(mcp, { workspaceId: 'field-notes', title: 'Deploy notes', markdown: '# Deploy notes\n\n## You\n\nHello\n' }, { idFactory: ids })
    expect(mcp.calls).toHaveLength(1)
    const call = mcp.calls[0]
    expect(call.name).toBe('write_document')
    expect(call.args).toMatchObject({
      graphId: 'field-notes',
      title: 'Deploy notes',
      content: '# Deploy notes\n\n## You\n\nHello\n',
      format: 'markdown',
      // Revision 0 means "create": it fails rather than replace something already there.
      expectedRevision: 0,
      awaitDurable: true,
    })
    expect(typeof call.args.documentId).toBe('string')
    expect(result).toEqual({ documentIds: [call.args.documentId] })
  })

  it('names nothing after the workspace it did not choose, and never touches another graph', async () => {
    const mcp = new RecordingMcp()
    await saveConversationToGarden(mcp, { workspaceId: 'home', title: 'A', markdown: '# A\n' }, { idFactory: ids })
    expect(mcp.calls.every(call => call.args.graphId === 'home')).toBe(true)
  })

  it('refuses to save an empty title or an empty conversation', async () => {
    const mcp = new RecordingMcp()
    await expect(saveConversationToGarden(mcp, { workspaceId: 'home', title: '  ', markdown: '# x\n' })).rejects.toThrow('title')
    await expect(saveConversationToGarden(mcp, { workspaceId: '', title: 'T', markdown: '# x\n' })).rejects.toThrow('workspace')
    await expect(saveConversationToGarden(mcp, { workspaceId: 'home', title: 'T', markdown: '   \n' })).rejects.toThrow('empty')
    expect(mcp.calls).toEqual([])
  })
})

describe('a conversation too large for one document', () => {
  const turn = (n: number, size: number): string => `\n## Assistant\n\n*Turn ${n}*\n\n${'word '.repeat(size).trim()}\n`
  const big = `# Big chat\n\n*3 messages*\n${turn(1, 40)}${turn(2, 40)}${turn(3, 40)}`

  it('splits at turn boundaries, so no turn is cut in half, and loses nothing', () => {
    const parts = splitMarkdownIntoParts(big, 400)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(big)
    for (const part of parts.slice(1)) expect(part.startsWith('\n## ')).toBe(true)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(400)
  })

  it('keeps a single part when it fits, and cuts an oversize turn by lines rather than mid-word', () => {
    expect(splitMarkdownIntoParts('# T\n', 400)).toEqual(['# T\n'])
    const lines = Array.from({ length: 30 }, (_, index) => `line number ${index}`).join('\n')
    const parts = splitMarkdownIntoParts(`# T\n\n## You\n\n${lines}\n`, 120)
    expect(parts.join('')).toBe(`# T\n\n## You\n\n${lines}\n`)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(120)
    for (const part of parts) expect(part).not.toMatch(/line numb$/)
  })

  it('writes each part as its own numbered document, each starting with a heading', async () => {
    const mcp = new RecordingMcp()
    const result = await saveConversationToGarden(mcp, { workspaceId: 'field-notes', title: 'Big chat', markdown: big }, { maxChars: 400, idFactory: ids })
    expect(mcp.calls.length).toBeGreaterThan(1)
    const titles = mcp.calls.map(call => call.args.title)
    expect(titles[0]).toBe(`Big chat · part 1 of ${mcp.calls.length}`)
    expect(titles.at(-1)).toBe(`Big chat · part ${mcp.calls.length} of ${mcp.calls.length}`)
    for (const call of mcp.calls) expect(String(call.args.content).trimStart().startsWith('# ')).toBe(true)
    expect(result.documentIds).toHaveLength(mcp.calls.length)
    expect(new Set(result.documentIds).size).toBe(result.documentIds.length)
  })

  it('stops at the first part that fails and says which parts were already written', async () => {
    const mcp = new RecordingMcp()
    mcp.replyNext({ success: true, graphId: 'home', revision: 1 })
    mcp.failNext(new Error('Gateway MCP error for write_document: forbidden'))
    const error = await saveConversationToGarden(mcp, { workspaceId: 'home', title: 'Big chat', markdown: big }, { maxChars: 400, idFactory: ids }).catch(caught => caught)
    expect(error).toBeInstanceOf(SaveConversationError)
    expect(error.message).toContain('forbidden')
    expect(error.writtenDocumentIds).toHaveLength(1)
    expect(mcp.calls).toHaveLength(2)
  })
})

describe('what counts as Garden having saved it', () => {
  it.each([
    ['a refusal', { success: false }],
    ['an error flag', { isError: true, success: true, revision: 1 }],
    ['a receipt for another document', { success: true, graphId: 'home', documentId: 'someone-else', revision: 1 }],
    ['a receipt for another graph', { success: true, graphId: 'elsewhere', revision: 1 }],
    ['no revision', { success: true, graphId: 'home' }],
    ['nothing at all', undefined],
  ])('does not treat %s as saved', async (_label, reply) => {
    const mcp = new RecordingMcp()
    mcp.replyNext(reply)
    await expect(saveConversationToGarden(mcp, { workspaceId: 'home', title: 'T', markdown: '# T\n' }, { idFactory: () => 'doc-t-1' })).rejects.toBeInstanceOf(SaveConversationError)
  })

  it('accepts the receipt shapes the two transports use (camelCase and snake_case identity)', async () => {
    const mcp = new RecordingMcp()
    mcp.replyNext({ success: true, graph_id: 'home', document_id: 'doc-t-1', revision: 2 })
    await expect(saveConversationToGarden(mcp, { workspaceId: 'home', title: 'T', markdown: '# T\n' }, { idFactory: () => 'doc-t-1' })).resolves.toEqual({ documentIds: ['doc-t-1'] })
  })
})

describe('reading a tool result the way the local cell returns it', () => {
  const adapt = (result: unknown) => callToolFromToolsCall({ toolsCall: async () => result }).callTool('write_document', {})

  it('uses structured content when there is some, and the JSON text when there is only text', async () => {
    expect(await adapt({ structuredContent: { success: true, revision: 1 } })).toEqual({ success: true, revision: 1 })
    expect(await adapt({ content: [{ type: 'text', text: '{"success":true,"revision":3}' }] })).toEqual({ success: true, revision: 3 })
    expect(await adapt({ value: { success: true, revision: 4 } })).toEqual({ success: true, revision: 4 })
  })

  it('throws, in the tool\'s own words, when the tool reports an error', async () => {
    await expect(adapt({ isError: true, content: [{ type: 'text', text: 'document already exists' }] })).rejects.toThrow('document already exists')
  })
})

describe('where a copy may go', () => {
  it('offers workspaces the person can write to, once each, in the order the directory gave them', () => {
    const targets = saveTargetsOf([
      { graphId: 'home', title: 'Home', role: 'owner' },
      { graphId: 'shared', title: 'Shared notes', role: 'editor' },
      { graphId: 'read-only', title: 'Read only', role: 'viewer' },
      { graphId: 'off', title: 'Disabled', role: 'owner', disabled: true },
      { graphId: 'pending', title: 'Not yet synced', role: 'owner', localCreation: { operationId: 'x' } },
      { graphId: 'home', title: 'Home again', role: 'owner' },
      { graphId: 'untitled', title: '   ', role: 'owner' },
    ])
    expect(targets).toEqual([
      { graphId: 'home', title: 'Home' },
      { graphId: 'shared', title: 'Shared notes' },
      { graphId: 'untitled', title: 'untitled' },
    ])
  })
})
