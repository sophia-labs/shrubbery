/**
 * The terminal `done` completes a reply the stream left short (NO MOCKS: the real
 * projector folds real ChatEvent streams).
 *
 * Defect guarded (F-step-zero D2, seen live): a follow-up's bubble read "Read" while
 * the durable transcript said "Read and search workspace." The hosted service ends
 * a turn with a reconciling `done` whose `output` is the durable answer, but the
 * projector used `output` only to fill an EMPTY message, so a reply cut short by a
 * lost stream stayed cut short.
 *
 * The rule under test is deliberately narrow: `output` may only EXTEND what was
 * streamed (the streamed text is a strict prefix of it). It never rewrites text the
 * person has already read, and never replaces a multi-step reply with its last step.
 */
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../chat-events.js'
import { projectEvents } from '../sandbox-adapter.js'
import type { ChatMessage } from '../types.js'

function only(events: ChatEvent[]): ChatMessage {
  const { state } = projectEvents(events)
  expect(state.messages).toHaveLength(1)
  return state.messages[0]
}

const textParts = (message: ChatMessage): string[] =>
  message.parts.flatMap(part => (part.type === 'text' ? [part.content] : []))

describe('done reconciles a reply the stream left short', () => {
  it('completes a streamed prefix with the durable answer', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Read' },
      { type: 'done', output: 'Read and search workspace.' },
    ])
    expect(message.content).toBe('Read and search workspace.')
    expect(textParts(message)).toEqual(['Read and search workspace.'])
    expect(message.isStreaming).toBe(false)
  })

  it('appends the missing tail after a tool call, in its own text part', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Checking. ' },
      { type: 'tool_call', gate: 'search_documents', args: {} },
      { type: 'tool_result', gate: 'search_documents', result: 'ok', is_error: false },
      { type: 'done', output: 'Checking. Found it.' },
    ])
    expect(message.content).toBe('Checking. Found it.')
    expect(message.parts.map(part => part.type)).toEqual(['text', 'tool', 'text'])
    expect(textParts(message)).toEqual(['Checking. ', 'Found it.'])
    expect(message.toolCalls).toHaveLength(1)
  })

  it('leaves a complete reply alone', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'All of it.' },
      { type: 'done', output: 'All of it.' },
    ])
    expect(message.content).toBe('All of it.')
    expect(textParts(message)).toEqual(['All of it.'])
  })

  it('never rewrites text that was already streamed when the output differs', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Let me check that for you. ' },
      { type: 'tool_call', gate: 'search_documents', args: {} },
      { type: 'tool_result', gate: 'search_documents', result: 'ok', is_error: false },
      { type: 'text', content: 'It is on page two.' },
      // A multi-step reply: the final step alone is not the whole message.
      { type: 'done', output: 'It is on page two.' },
    ])
    expect(message.content).toBe('Let me check that for you. It is on page two.')
  })

  it('never shortens: an output shorter than what was streamed changes nothing', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'A long streamed reply.' },
      { type: 'done', output: 'A long' },
    ])
    expect(message.content).toBe('A long streamed reply.')
  })

  it('does not treat a different reply as a longer one', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Yes.' },
      { type: 'done', output: 'No, and here is why.' },
    ])
    expect(message.content).toBe('Yes.')
  })

  it('still fills an empty message from the output (a turn that produced only tool calls)', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'search_documents', args: {} },
      { type: 'tool_result', gate: 'search_documents', result: 'ok', is_error: false },
      { type: 'done', output: 'Here is what I found.' },
    ])
    expect(message.content).toBe('Here is what I found.')
  })

  it('completes a truncated turn the same way', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Partial' },
      { type: 'truncated', output: 'Partial, then the rest.', turns: 3 },
    ])
    expect(message.content).toBe('Partial, then the rest.')
    expect(message.isStreaming).toBe(false)
  })

  it('reads a completed reply the same however the stream was cut', () => {
    const whole = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Read and search workspace.' },
      { type: 'done', output: 'Read and search workspace.' },
    ])
    for (const cut of ['R', 'Read', 'Read and', 'Read and search workspace']) {
      const message = only([
        { type: 'turn_start', turn: 0 },
        { type: 'text', content: cut },
        { type: 'done', output: 'Read and search workspace.' },
      ])
      expect(message.content).toBe(whole.content)
    }
  })
})
