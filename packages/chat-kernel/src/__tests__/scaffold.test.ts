/**
 * S0 SCAFFOLD — the package as a real, importable organism.
 *
 * NO mocks. Drives the REAL relocated artifacts:
 *   - the ChatEvent union (= choreograph SandboxEvent, copied) — a real 9-variant
 *     value assigns to ChatEvent[] and every variant discriminates by `type`.
 *   - the render-data vocabulary (ChatMessage/ToolCall/MessagePart/TokenUsage) —
 *     a real captured ChatMessage[] (a streamed assistant turn with a completed
 *     tool call + interleaved text/reasoning parts + tokens) is constructed and
 *     its structure asserted.
 *
 * This is the chat analog of editor-kernel's scaffold.test.ts S0 organism proof:
 * the real types import and a real value round-trips through them.
 */
import { describe, it, expect } from 'vitest'
import type { ChatEvent, ChatMessage, ToolCall } from '../index'

describe('S0 scaffold — ChatEvent union (the copied SandboxEvent taxonomy)', () => {
  it('a real 9-variant ChatEvent[] assigns and every variant discriminates by type', () => {
    // A real captured stream shape: every one of the 9 SandboxEvent variants.
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'thinking', content: 'Let me search the graph. ' },
      { type: 'text', content: 'Searching' },
      { type: 'tool_call', gate: 'search_documents', args: { query: 'Funes' } },
      { type: 'tool_result', gate: 'search_documents', result: '3 hits', is_error: false },
      { type: 'turn_end', turn: 0 },
      { type: 'done', output: 'Found 3 documents.' },
      { type: 'truncated', output: 'partial', turns: 8 },
      { type: 'error', message: 'rate limited' },
    ]

    expect(events).toHaveLength(9)
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'thinking',
      'text',
      'tool_call',
      'tool_result',
      'turn_end',
      'done',
      'truncated',
      'error',
    ])

    // The discriminated union narrows on `type` — exercise the load-bearing
    // tool_call/tool_result pairing fields the (later) adapter folds.
    for (const ev of events) {
      switch (ev.type) {
        case 'tool_call':
          expect(ev.gate).toBe('search_documents')
          expect(ev.args).toEqual({ query: 'Funes' })
          break
        case 'tool_result':
          expect(ev.gate).toBe('search_documents')
          expect(ev.is_error).toBe(false)
          expect(ev.result).toBe('3 hits')
          break
        case 'text':
        case 'thinking':
          expect(typeof ev.content).toBe('string')
          break
        case 'done':
        case 'truncated':
          expect(typeof ev.output).toBe('string')
          break
        case 'error':
          expect(ev.message).toBe('rate limited')
          break
        case 'turn_start':
        case 'turn_end':
          expect(typeof ev.turn).toBe('number')
          break
      }
    }
  })
})

describe('S0 scaffold — render-data vocabulary (a real captured ChatMessage[])', () => {
  it('a real streamed assistant turn constructs and its structure holds', () => {
    const completedCall: ToolCall = {
      id: 'search_documents#0',
      tool: 'search_documents',
      status: 'completed',
      input: { query: 'Funes' },
      output: '3 hits',
      metadata: null,
    }

    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Who is Funes?',
        parts: [{ type: 'text', content: 'Who is Funes?' }],
        isStreaming: false,
        toolCalls: [],
        createdAt: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Let me search. Found 3.',
        parts: [
          { type: 'reasoning', content: 'I should search the graph.' },
          { type: 'text', content: 'Let me search. ' },
          { type: 'tool', toolCallId: 'search_documents#0' },
          { type: 'text', content: 'Found 3.' },
        ],
        isStreaming: false,
        toolCalls: [completedCall],
        tokens: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0 },
        createdAt: 2,
      },
    ]

    expect(messages).toHaveLength(2)
    const [user, assistant] = messages

    expect(user.role).toBe('user')
    expect(assistant.role).toBe('assistant')
    expect(assistant.parts.map((p) => p.type)).toEqual(['reasoning', 'text', 'tool', 'text'])
    expect(assistant.toolCalls).toHaveLength(1)
    expect(assistant.toolCalls[0].status).toBe('completed')
    expect(assistant.tokens?.input).toBe(12)
    // The tool part references the tool call by id (the projector's invariant).
    const toolPart = assistant.parts.find((p) => p.type === 'tool')
    expect(toolPart && toolPart.type === 'tool' && toolPart.toolCallId).toBe('search_documents#0')
  })
})
