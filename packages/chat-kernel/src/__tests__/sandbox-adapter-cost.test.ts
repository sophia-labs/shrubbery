/**
 * A settled cost rides the event stream and lands on the reply it paid for (NO MOCKS:
 * the real projector folds real ChatEvent streams).
 *
 * The host reads a model call's settled cost off the session's ledger events and hands
 * it to the fold as a `cost` event; the kernel only adds it up. It never prices, rounds
 * or words anything (the host's formatter does that): a chip beside a reply is the sum of
 * what the host said the calls behind it cost, and nothing else.
 */
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../chat-events.js'
import { finalize, projectEvents } from '../sandbox-adapter.js'
import type { ChatMessage } from '../types.js'

function only(events: ChatEvent[]): ChatMessage {
  const { state } = projectEvents(events)
  expect(state.messages).toHaveLength(1)
  return state.messages[0]
}

describe('a cost event', () => {
  it('lands on the reply it belongs to, and the reply is otherwise unchanged', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Hello there.' },
      { type: 'cost', microUsd: 848 },
      { type: 'turn_end', turn: 0 },
      { type: 'done', output: 'Hello there.' },
    ])
    expect(message.costMicroUsd).toBe(848)
    expect(message.content).toBe('Hello there.')
    expect(message.isStreaming).toBe(false)
  })

  it('adds up the model calls behind one reply (a turn that used a tool paid twice)', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'search_documents', args: {} },
      { type: 'cost', microUsd: 848 },
      { type: 'tool_result', gate: 'search_documents', result: 'ok', is_error: false },
      { type: 'text', content: 'Found it.' },
      { type: 'cost', microUsd: 300 },
      { type: 'done', output: 'Found it.' },
    ])
    expect(message.costMicroUsd).toBe(1_148)
  })

  it('is kept when the settle came before anything else in the reply was said', () => {
    // Defect avoided: a first call that only asked for a tool is settled before any text
    // exists; the cost must not be dropped because the reply had no row to hold it yet.
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'cost', microUsd: 500 },
      { type: 'tool_call', gate: 'read_document', args: {} },
      { type: 'tool_result', gate: 'read_document', result: 'ok', is_error: false },
      { type: 'text', content: 'Read.' },
      { type: 'cost', microUsd: 300 },
      { type: 'done', output: 'Read.' },
    ])
    expect(message.costMicroUsd).toBe(800)
  })

  it('stays on a reply that failed part-way: what was spent was spent', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Half of an ans' },
      { type: 'cost', microUsd: 120 },
      { type: 'error', message: 'stream lost' },
    ])
    expect(message.costMicroUsd).toBe(120)
    expect(message.error).toBe('stream lost')
  })

  it('has no reply to attach to when nothing was said, and says nothing about it', () => {
    const { state } = projectEvents([
      { type: 'turn_start', turn: 0 },
      { type: 'cost', microUsd: 500 },
    ])
    expect(state.messages).toEqual([])
  })

  it('ignores an amount that is not a positive number', () => {
    const message = only([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Ok.' },
      { type: 'cost', microUsd: 0 },
      { type: 'cost', microUsd: -40 },
      { type: 'cost', microUsd: Number.NaN },
      { type: 'cost', microUsd: Number.POSITIVE_INFINITY },
      { type: 'done', output: 'Ok.' },
    ])
    expect(message.costMicroUsd).toBeUndefined()
  })

  it('gives the same answer every time the whole event array is folded again from the same base', () => {
    // The store re-folds the accumulated events on every tick: a sum that grew on each
    // fold would inflate the chip by the number of ticks.
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'One' },
      { type: 'cost', microUsd: 700 },
      { type: 'text', content: ' two.' },
    ]
    const once = projectEvents(events).state.messages[0].costMicroUsd
    const again = projectEvents(events).state.messages[0].costMicroUsd
    expect(once).toBe(700)
    expect(again).toBe(700)
  })

  it('survives finalize, which only closes the message', () => {
    const { state } = projectEvents([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'Done.' },
      { type: 'cost', microUsd: 41 },
    ])
    const closed = finalize(state, state.streamingMessageId, undefined)
    expect(closed.messages[0].costMicroUsd).toBe(41)
    expect(closed.messages[0].isStreaming).toBe(false)
  })

  it('does not touch an earlier message of the conversation', () => {
    const { state: first } = projectEvents([
      { type: 'turn_start', turn: 0 },
      { type: 'text', content: 'First.' },
      { type: 'cost', microUsd: 900 },
      { type: 'done', output: 'First.' },
    ])
    const { state: second } = projectEvents(
      [
        { type: 'turn_start', turn: 0 },
        { type: 'text', content: 'Second.' },
        { type: 'cost', microUsd: 100 },
        { type: 'done', output: 'Second.' },
      ],
      { ...first, streamingMessageId: null },
    )
    expect(second.messages.map(message => message.costMicroUsd)).toEqual([900, 100])
  })
})
