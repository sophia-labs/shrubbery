/**
 * A reply that arrives with no stream at all is still shown (NO MOCKS: the real projector folds real ChatEvent
 * streams, from a base seeded the way the chat store seeds it).
 *
 * Defect guarded (D-A, seen live on 2026-10-01 in the voices release's acceptance, recorded outside
 * this repository): a follow-up sent while the Session was still warm was answered by the host in
 * 2.1 s and billed, but the host's event log for it held only `command.accepted`, two ledger settlements and
 * `command.completed`: no `turn.started`, `message.delta` or `message.completed`. The hosted service ended the
 * turn with a reconciling `done` carrying the durable answer, and the fold dropped it because no reply was open.
 * Nothing appeared, no error either, until the person sent another message or reloaded.
 *
 * The rule: `done` (and `truncated`) with a non-empty `output` and no reply open shows that output as the reply,
 * with what its calls cost; unless the reply to the person's last message is already on screen, which it never
 * shows twice.
 */
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../chat-events.js'
import { createProjectorState } from '../message-projector.js'
import { projectEvents } from '../sandbox-adapter.js'
import type { ChatMessage } from '../types.js'

function said(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id, role, content, parts: content ? [{ type: 'text', content }] : [], isStreaming: false, toolCalls: [],
    createdAt: Date.parse('2026-10-01T20:45:00Z'),
  } as ChatMessage
}

// What the store folds from after the person sends a follow-up: the conversation so far, ending with their message.
const afterFollowUp = () =>
  createProjectorState([
    said('u1', 'user', 'What is two times three? One word.'),
    said('a1', 'assistant', 'Six.'),
    said('u2', 'user', 'And again, the same question?'),
  ])

// What the warm follow-up's stream carried, as the service projects it: the two settled calls, then the
// service's reconciling `done` read from the durable transcript.
const warm: ChatEvent[] = [
  { type: 'cost', microUsd: 601 },
  { type: 'cost', microUsd: 91 },
  { type: 'done', output: 'Six.' },
]

describe('a reply that came with no stream', () => {
  it('is shown as the reply to the follow-up, closed, with what its calls cost', () => {
    const { state, terminalType } = projectEvents(warm, afterFollowUp())
    expect(terminalType).toBe('done')
    expect(state.messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'What is two times three? One word.'],
      ['assistant', 'Six.'],
      ['user', 'And again, the same question?'],
      ['assistant', 'Six.'],
    ])
    const reply = state.messages[3]
    expect(reply.isStreaming).toBe(false)
    expect(reply.costMicroUsd).toBe(692)
    expect(reply.parts).toEqual([{ type: 'text', content: 'Six.' }])
    expect(state.streamingMessageId).toBeNull()
  })

  it('is the same however often the store folds the accumulated events again from the same base', () => {
    const base = afterFollowUp()
    const once = projectEvents(warm, base).state
    const twice = projectEvents(warm, base).state
    expect(twice.messages.map(m => [m.role, m.content, m.costMicroUsd])).toEqual(once.messages.map(m => [m.role, m.content, m.costMicroUsd]))
    expect(twice.messages).toHaveLength(4)
  })

  it('is not shown twice when the reply to the last message is already on screen (it was in the seed)', () => {
    const seeded = createProjectorState([...afterFollowUp().messages, said('a2', 'assistant', 'Six.')])
    const { state, terminalType } = projectEvents(warm, seeded)
    expect(terminalType).toBe('done')
    expect(state.messages).toHaveLength(4)
    expect(state.messages[3].id).toBe('a2')
  })

  it('shows a truncated turn the same way', () => {
    const { state, terminalType } = projectEvents([{ type: 'truncated', output: 'Six.', turns: 1 }], afterFollowUp())
    expect(terminalType).toBe('truncated')
    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(state.messages[3].content).toBe('Six.')
    expect(state.messages[3].isStreaming).toBe(false)
  })

  it('opens nothing for an empty output: there is no reply to show', () => {
    const { state, terminalType } = projectEvents([{ type: 'cost', microUsd: 500 }, { type: 'done', output: '' }], afterFollowUp())
    expect(terminalType).toBe('done')
    expect(state.messages).toHaveLength(3)
  })

  it('leaves a streamed reply as it was (the cold path is unchanged)', () => {
    const { state } = projectEvents(
      [
        { type: 'turn_start', turn: 0 },
        { type: 'text', content: 'Eight' },
        { type: 'cost', microUsd: 626 },
        { type: 'text', content: '.' },
        { type: 'turn_end', turn: 0 },
        { type: 'done', output: 'Eight.' },
      ],
      afterFollowUp(),
    )
    expect(state.messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'What is two times three? One word.'],
      ['assistant', 'Six.'],
      ['user', 'And again, the same question?'],
      ['assistant', 'Eight.'],
    ])
    expect(state.messages[3].costMicroUsd).toBe(626)
  })
})
