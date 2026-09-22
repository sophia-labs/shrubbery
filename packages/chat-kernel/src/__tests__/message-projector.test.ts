import { describe, it, expect } from 'vitest'
import {
  adoptMessageId,
  appendDelta,
  appendReasoningDelta,
  createProjectorState,
  mergeMessage,
  parseTokens,
  updateToolCall,
  type ProjectorState,
} from '../message-projector.js'

const streaming = (id: string | null, messages = []): ProjectorState => ({
  ...createProjectorState(messages),
  streamingMessageId: id,
})

describe('parseTokens', () => {
  it('accepts the nested cache shape', () => {
    expect(parseTokens({ input: 10, output: 20, cache: { read: 3, write: 1 } })).toEqual({
      input: 10,
      output: 20,
      cacheRead: 3,
      cacheWrite: 1,
    })
  })

  it('accepts the snake_case shape and clamps negatives', () => {
    expect(parseTokens({ input_tokens: 5, output_tokens: -2, cache_read: 4, cache_write: 0 })).toEqual({
      input: 5,
      output: 0,
      cacheRead: 4,
      cacheWrite: 0,
    })
  })

  it('defaults missing fields to zero', () => {
    expect(parseTokens(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('appendDelta', () => {
  it('creates an assistant message then accumulates text into one part', () => {
    let s = createProjectorState()
    s = appendDelta(s, 'm1', 'Hel')
    s = appendDelta(s, 'm1', 'lo')
    expect(s.messages).toHaveLength(1)
    const msg = s.messages[0]
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('Hello')
    expect(msg.parts).toEqual([{ type: 'text', content: 'Hello' }])
    expect(msg.isStreaming).toBe(true)
  })

  it('starts a new text part after a non-text part', () => {
    let s = createProjectorState()
    s = appendDelta(s, 'm1', 'A')
    s = updateToolCall(s, 'm1', 'c1', { tool: 't', status: 'running' })
    s = appendDelta(s, 'm1', 'B')
    const parts = s.messages[0].parts
    expect(parts.map((p) => p.type)).toEqual(['text', 'tool', 'text'])
    expect(s.messages[0].content).toBe('AB')
  })

  it('ignores empty deltas', () => {
    const s0 = createProjectorState()
    expect(appendDelta(s0, 'm1', '')).toBe(s0)
  })
})

describe('appendReasoningDelta', () => {
  it('accumulates reasoning separately from content', () => {
    let s = createProjectorState()
    s = appendReasoningDelta(s, 'm1', 'think ')
    s = appendReasoningDelta(s, 'm1', 'more')
    const msg = s.messages[0]
    expect(msg.content).toBe('')
    expect(msg.parts).toEqual([{ type: 'reasoning', content: 'think more' }])
  })
})

describe('updateToolCall', () => {
  it('drives a tool call pending -> running -> completed without duplicating the part', () => {
    let s = createProjectorState()
    s = appendDelta(s, 'm1', 'calling')
    s = updateToolCall(s, 'm1', 'c1', { tool: 'search', status: 'pending', input: { q: 'x' } })
    s = updateToolCall(s, 'm1', 'c1', { status: 'running' })
    s = updateToolCall(s, 'm1', 'c1', { status: 'completed', output: 'done' })
    const msg = s.messages[0]
    expect(msg.toolCalls).toHaveLength(1)
    expect(msg.toolCalls[0]).toMatchObject({
      id: 'c1',
      tool: 'search',
      status: 'completed',
      output: 'done',
      input: { q: 'x' },
    })
    expect(msg.parts.filter((p) => p.type === 'tool')).toHaveLength(1)
  })
})

describe('adoptMessageId', () => {
  it('discards late events once streaming has ended', () => {
    const s = createProjectorState()
    expect(adoptMessageId(s, 'x', false).messageId).toBeNull()
  })

  it('suppresses an echo of the pending user message', () => {
    const s: ProjectorState = { ...streaming('s1'), pendingUserMessageId: 'u1' }
    expect(adoptMessageId(s, 'u1', true).messageId).toBeNull()
  })

  it('falls back to the streaming id when no incoming id is given', () => {
    const s = streaming('s1')
    const { messageId } = adoptMessageId(s, null, true)
    expect(messageId).toBe('s1')
  })

  it('remaps the streaming placeholder to a new incoming id', () => {
    let s = streaming(null)
    s = appendDelta(s, 'placeholder', 'hi')
    s = { ...s, streamingMessageId: 'placeholder' }
    const { state, messageId } = adoptMessageId(s, 'real-id', true)
    expect(messageId).toBe('real-id')
    expect(state.streamingMessageId).toBe('real-id')
    expect(state.messages[0].id).toBe('real-id')
    expect(state.messages[0].content).toBe('hi') // content preserved across remap
  })
})

describe('mergeMessage (finalize)', () => {
  it('clears isStreaming and attaches tokens', () => {
    let s = createProjectorState()
    s = appendDelta(s, 'm1', 'answer')
    s = mergeMessage(s, 'm1', { isStreaming: false, tokens: parseTokens({ input: 1, output: 2 }) })
    expect(s.messages[0].isStreaming).toBe(false)
    expect(s.messages[0].tokens).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('full streamed turn (parity shape)', () => {
  it('produces a message with interleaved text, a completed tool call, and tokens', () => {
    let s = streaming('a1')
    s = appendDelta(s, 'a1', 'Let me search. ')
    s = updateToolCall(s, 'a1', 'c1', { tool: 'search', status: 'running', input: { q: 'cats' } })
    s = updateToolCall(s, 'a1', 'c1', { status: 'completed', output: '3 hits' })
    s = appendDelta(s, 'a1', 'Found 3.')
    s = mergeMessage(s, 'a1', { isStreaming: false, tokens: parseTokens({ input: 12, output: 8 }) })

    expect(s.messages).toHaveLength(1)
    const msg = s.messages[0]
    expect(msg.content).toBe('Let me search. Found 3.')
    expect(msg.parts.map((p) => p.type)).toEqual(['text', 'tool', 'text'])
    expect(msg.toolCalls[0].status).toBe('completed')
    expect(msg.isStreaming).toBe(false)
    expect(msg.tokens?.input).toBe(12)
  })
})
