/**
 * R4 sandbox-adapter — no-mock test.
 *
 * Drives canned-real `ChatEvent[]` streams through the REAL relocated projector
 * (no vi.fn, no stubs). Three load-bearing properties:
 *
 *  (a) CONCURRENT same-gate calls get DISTINCT synthesized ids resolved FIFO —
 *      the whole reason call-id synthesis lives in the adapter (the union has no
 *      call_id). Two tool_call events for the same gate BEFORE either result must
 *      open `gate#0` and `gate#1`; the two results then close them in FIFO order.
 *  (b) reasoning/text INTERLEAVE segments into parts[] (the projector opens a new
 *      part whenever the type flips).
 *  (c) finalize TokenUsage rides a SEPARATE channel — the fold sees NO usage on
 *      any event; finalize stamps out-of-band ProxyUsage onto the terminal msg.
 */
import { describe, it, expect } from 'vitest'
import type { ChatEvent } from '../chat-events.js'
import { projectEvents, finalize } from '../sandbox-adapter.js'

describe('projectEvents — concurrent same-gate FIFO call-id synthesis', () => {
  it('opens distinct gate#n ids for concurrent same-gate calls and resolves them FIFO', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'search_documents', args: { q: 'first' } },
      { type: 'tool_call', gate: 'search_documents', args: { q: 'second' } },
      { type: 'tool_result', gate: 'search_documents', result: 'R0', is_error: false },
      { type: 'tool_result', gate: 'search_documents', result: 'R1', is_error: false },
      { type: 'done', output: '' },
    ]

    const { state, terminalType } = projectEvents(events)
    expect(terminalType).toBe('done')
    expect(state.messages).toHaveLength(1)

    const tcs = state.messages[0].toolCalls
    expect(tcs).toHaveLength(2)

    // DISTINCT ids, minted in call order.
    expect(tcs.map((t) => t.id)).toEqual(['search_documents#0', 'search_documents#1'])
    expect(tcs.every((t) => t.tool === 'search_documents')).toBe(true)

    // FIFO resolution: first result -> #0, second result -> #1.
    const byId = Object.fromEntries(tcs.map((t) => [t.id, t]))
    expect(byId['search_documents#0'].input).toEqual({ q: 'first' })
    expect(byId['search_documents#0'].output).toBe('R0')
    expect(byId['search_documents#0'].status).toBe('completed')
    expect(byId['search_documents#1'].input).toEqual({ q: 'second' })
    expect(byId['search_documents#1'].output).toBe('R1')
    expect(byId['search_documents#1'].status).toBe('completed')
  })

  it('marks is_error results as error status', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'g', args: {} },
      { type: 'tool_result', gate: 'g', result: 'boom', is_error: true },
      { type: 'done', output: '' },
    ]
    const { state } = projectEvents(events)
    const tc = state.messages[0].toolCalls[0]
    expect(tc.id).toBe('g#0')
    expect(tc.status).toBe('error')
    expect(tc.output).toBe('boom')
  })

  it('mints a fresh id for an orphan result so the fold stays total', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_result', gate: 'g', result: 'late', is_error: false },
      { type: 'done', output: '' },
    ]
    const { state } = projectEvents(events)
    const tcs = state.messages[0].toolCalls
    expect(tcs).toHaveLength(1)
    expect(tcs[0].id).toBe('g#0')
    expect(tcs[0].status).toBe('completed')
  })

  it('PERSISTS gate counters across turns (second-turn same-gate call does not clobber the first)', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'g', args: { t: 1 } },
      { type: 'tool_result', gate: 'g', result: 'first', is_error: false },
      { type: 'turn_end', turn: 0 },
      { type: 'turn_start', turn: 1 },
      { type: 'tool_call', gate: 'g', args: { t: 2 } },
      { type: 'tool_result', gate: 'g', result: 'second', is_error: false },
      { type: 'done', output: '' },
    ]
    const { state } = projectEvents(events)
    const tcs = state.messages[0].toolCalls
    // Distinct ids across turns — no collision on g#0.
    expect(tcs.map((t) => t.id)).toEqual(['g#0', 'g#1'])
    const byId = Object.fromEntries(tcs.map((t) => [t.id, t]))
    expect(byId['g#0'].output).toBe('first')
    expect(byId['g#1'].output).toBe('second')
  })
})

describe('projectEvents — reasoning/text interleave segments parts[]', () => {
  it('opens a new part whenever the delta type flips', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'thinking', content: 'think-a ' },
      { type: 'thinking', content: 'think-b' },
      { type: 'text', content: 'say-a ' },
      { type: 'text', content: 'say-b' },
      { type: 'thinking', content: 'think-c' },
      { type: 'done', output: 'say-a say-b' },
    ]
    const { state } = projectEvents(events)
    const parts = state.messages[0].parts
    // reasoning / text / reasoning — 3 parts, runs concatenated within type.
    expect(parts.map((p) => p.type)).toEqual(['reasoning', 'text', 'reasoning'])
    expect((parts[0] as { content: string }).content).toBe('think-a think-b')
    expect((parts[1] as { content: string }).content).toBe('say-a say-b')
    expect((parts[2] as { content: string }).content).toBe('think-c')
    // content is the text-only concatenation (reasoning does not enter content).
    expect(state.messages[0].content).toBe('say-a say-b')
  })
})

describe('finalize — TokenUsage rides a SEPARATE channel', () => {
  it('the fold reads NO usage off events; finalize stamps out-of-band ProxyUsage', () => {
    // NB: not a single event below carries a usage field — usage is out-of-band.
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'answer' },
      { type: 'done', output: 'answer' },
    ]
    const { state, terminalType } = projectEvents(events)
    expect(terminalType).toBe('done')

    const msgId = state.messages[0].id
    // No tokens yet — the fold never invented them.
    expect(state.messages[0].tokens).toBeUndefined()
    expect(state.messages[0].isStreaming).toBe(false)

    // Out-of-band ProxyUsage (camelCase cache fields) arrives on the 2nd channel.
    const proxyUsage = {
      input: 120,
      output: 45,
      cacheRead: 30,
      cacheWrite: 7,
      totalTokens: 202,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
    const finalState = finalize(state, msgId, proxyUsage)
    const msg = finalState.messages.find((m) => m.id === msgId)!
    expect(msg.isStreaming).toBe(false)
    // ProxyUsage's camelCase cache fields normalized into TokenUsage.
    expect(msg.tokens).toEqual({ input: 120, output: 45, cacheRead: 30, cacheWrite: 7 })
  })

  it('finalize with no usage leaves tokens unset (usage truly optional)', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'hi' },
      { type: 'done', output: 'hi' },
    ]
    const { state } = projectEvents(events)
    const msgId = state.messages[0].id
    const finalState = finalize(state, msgId)
    expect(finalState.messages[0].tokens).toBeUndefined()
    expect(finalState.messages[0].isStreaming).toBe(false)
  })

  it('finalize tolerates the nested-cache TokenUsage shape too', () => {
    const events: ChatEvent[] = [{ type: 'turn_start', turn: 0 }, { type: 'text', content: 'x' }, { type: 'done', output: 'x' }]
    const { state } = projectEvents(events)
    const finalState = finalize(state, state.messages[0].id, { input: 1, output: 2, cache: { read: 3, write: 4 } })
    expect(finalState.messages[0].tokens).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 })
  })
})

describe('projectEvents — terminal variants', () => {
  it('truncated is terminal and closes streaming', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'g', args: {} },
      { type: 'truncated', output: 'partial', turns: 8 },
    ]
    const { state, terminalType } = projectEvents(events)
    expect(terminalType).toBe('truncated')
    expect(state.streamingMessageId).toBeNull()
    expect(state.messages[0].isStreaming).toBe(false)
    // tool-only turn: empty content reconciled from `output`.
    expect(state.messages[0].content).toBe('partial')
  })

  it('error is terminal and stamps the message error', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'half' },
      { type: 'error', message: 'sandbox died' },
    ]
    const { state, terminalType } = projectEvents(events)
    expect(terminalType).toBe('error')
    expect(state.streamingMessageId).toBeNull()
    expect(state.messages[0].error).toBe('sandbox died')
    expect(state.messages[0].isStreaming).toBe(false)
    expect(state.messages[0].content).toBe('half')
  })
})
