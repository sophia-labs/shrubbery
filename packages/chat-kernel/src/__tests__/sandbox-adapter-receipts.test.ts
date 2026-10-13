/**
 * A tool event may carry the host's id-only receipt (`metadata`), and the fold keeps it on the
 * tool call (NO MOCKS: the real projector folds real ChatEvent streams).
 *
 * A durable Agent Session record keeps no tool arguments and no results. What it may keep is an
 * id-only receipt of what a write touched (`targets`). The fold puts it on `ToolCall.metadata`
 * beside whatever the call already carried, so the "Changed in this turn" strip can name what a
 * reply changed, live and after a reload alike.
 */
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../chat-events.js'
import { projectEvents } from '../sandbox-adapter.js'

describe('a tool event\'s receipt', () => {
  it('lands on the call it belongs to, from the call and from its result, merged', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'write_document', args: {}, metadata: { targets: [{ kind: 'document', id: 'plan' }] } },
      { type: 'tool_result', gate: 'write_document', result: '', is_error: false, metadata: { revision: 4 } },
      { type: 'done', output: 'Done.' },
    ]
    const { state } = projectEvents(events)
    const [call] = state.messages[0].toolCalls
    expect(call.metadata).toEqual({ targets: [{ kind: 'document', id: 'plan' }], revision: 4 })
    expect(call.status).toBe('completed')
  })

  it('leaves a call without a receipt exactly as it was (no metadata key appears)', () => {
    const { state } = projectEvents([
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'read_document', args: { documentId: 'a' } },
      { type: 'tool_result', gate: 'read_document', result: 'text', is_error: false },
    ])
    const [call] = state.messages[0].toolCalls
    expect(call.metadata).toBeNull()
    expect(call.input).toEqual({ documentId: 'a' })
    expect(call.output).toBe('text')
  })

  it('pairs receipts with the right call when the same tool runs twice', () => {
    const { state } = projectEvents([
      { type: 'turn_start', turn: 0 },
      { type: 'tool_call', gate: 'write_document', args: {}, metadata: { targets: [{ kind: 'document', id: 'one' }] } },
      { type: 'tool_call', gate: 'write_document', args: {}, metadata: { targets: [{ kind: 'document', id: 'two' }] } },
      { type: 'tool_result', gate: 'write_document', result: '', is_error: false },
      { type: 'tool_result', gate: 'write_document', result: 'refused', is_error: true },
    ])
    const calls = state.messages[0].toolCalls
    expect(calls.map(call => [call.status, (call.metadata!.targets as { id: string }[])[0].id])).toEqual([
      ['completed', 'one'],
      ['error', 'two'],
    ])
  })
})
