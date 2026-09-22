/**
 * local-chat-service.test.ts — REAL no-mock test of the local ChatService.
 *
 * Drives the REAL makeLocalChatService (real InProcessChatStore, real ECHO
 * turnDriver emitting real ChatEvent[]) and folds the turn through the REAL
 * projectEvents/finalize — the SAME streaming path the panel/store uses (folding
 * the ACCUMULATED ChatEvent[] each tick, NOT per-event). No vi.fn anywhere.
 *
 * Asserts:
 *   1. createSession mints a session; listSessions returns it.
 *   2. startTurn appends the user message; folding .events yields the user bubble
 *      + the assistant echo bubble + the tool_call→tool_result demo pair RESOLVED
 *      to a single completed ToolCall (the per-gate FIFO call-id reconciliation
 *      survives the streaming fold).
 *   3. The store PERSISTED the assistant turn after .done (durable post-turn).
 *   4. renameSession patches the title; hydrateSession reflects it.
 *   5. A custom turnDriver with a CONCURRENT same-gate tool_call pair reconciles
 *      to TWO distinct completed ToolCalls (the bug the per-event fold would mask).
 */

import { describe, it, expect } from 'vitest'
import {
  createProjectorState,
  finalize,
  projectEvents,
  uuid,
  type ChatEvent,
  type ChatMessage,
  type ProjectorState,
} from '@shrubbery/chat-kernel'
import { makeLocalChatService, type TurnDriver } from '../local-chat-service.js'
import type { ChatService } from '../chat-service.js'

/** Fold a live turn the SAME way the host store does: the host appends the user
 * bubble to its OWN projector base (the service persists the user message
 * store-side; the host renders it from its own state), THEN re-folds the
 * ACCUMULATED event array each tick (NOT projectEvents([e], state) — that resets
 * the per-gate ctx and breaks call-id reconciliation). */
async function foldTurn(
  svc: ChatService,
  sessionId: string,
  text: string,
): Promise<ProjectorState> {
  const userMsg: ChatMessage = {
    id: uuid(),
    role: 'user',
    content: text,
    parts: [{ type: 'text', content: text }],
    isStreaming: false,
    toolCalls: [],
    createdAt: Date.now(),
  }
  const base = createProjectorState([userMsg])
  const h = await svc.startTurn(sessionId, text)
  const events: ChatEvent[] = []
  let state = base
  for await (const e of h.events) {
    events.push(e)
    state = projectEvents(events, base).state
  }
  expect(await h.done).toEqual({ state: 'completed' })
  state = finalize(state, state.streamingMessageId ?? lastAssistantId(state), undefined)
  return state
}

function lastAssistantId(state: ProjectorState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant') return state.messages[i].id
  }
  return null
}

describe('makeLocalChatService — sessions + the REAL turn round-trip', () => {
  it('creates + lists sessions', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: 'first' })
    expect(s.id).toBeTruthy()
    const list = await svc.listSessions()
    expect(list.map((x) => x.id)).toContain(s.id)
    expect(list.find((x) => x.id === s.id)?.title).toBe('first')
  })

  it('startTurn → fold yields user + assistant echo bubbles + a resolved tool call, and persists', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession()

    const state = await foldTurn(svc, s.id, 'hi there')

    // Two bubbles: the user message + the assistant echo.
    const user = state.messages.find((m) => m.role === 'user')
    const assistant = state.messages.find((m) => m.role === 'assistant')
    expect(user?.content).toBe('hi there')
    expect(assistant?.content).toBe('You said: hi there')
    expect(assistant?.isStreaming).toBe(false)

    // The tool_call→tool_result demo pair reconciled to ONE completed ToolCall.
    expect(assistant?.toolCalls.length).toBe(1)
    expect(assistant?.toolCalls[0].status).toBe('completed')
    expect(assistant?.toolCalls[0].tool).toBe('echo.inspect')
    expect(assistant?.toolCalls[0].output).toBe('len=8')

    // The store PERSISTED the turn (durable after .done): hydrate sees both.
    const hydrated = await svc.hydrateSession(s.id)
    expect(hydrated.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(hydrated.messages[1].content).toBe('You said: hi there')
    expect(hydrated.messages[1].toolCalls[0].status).toBe('completed')
  })

  it('renameSession patches the title; hydrate reflects it', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession({ title: null })
    const renamed = await svc.renameSession(s.id, 'Renamed')
    expect(renamed.title).toBe('Renamed')
    const hydrated = await svc.hydrateSession(s.id)
    expect(hydrated.session.title).toBe('Renamed')
  })

  it('deleteSession removes it from the list', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession()
    await svc.deleteSession(s.id)
    const list = await svc.listSessions()
    expect(list.map((x) => x.id)).not.toContain(s.id)
  })

  it('CONCURRENT same-gate tool calls reconcile to TWO distinct completed calls (FIFO survives the streaming fold)', async () => {
    // Two tool_calls on the SAME gate BEFORE any result, then two results — the
    // per-gate FIFO must give them DISTINCT ids (g#0, g#1). A per-event fold
    // would reset the ctx each tick and clobber them into one; the accumulated
    // re-fold (what foldTurn does) keeps them distinct.
    const concurrentDriver: TurnDriver = async function* () {
      yield { type: 'turn_start', turn: 0 }
      yield { type: 'tool_call', gate: 'g', args: { n: 1 } }
      yield { type: 'tool_call', gate: 'g', args: { n: 2 } }
      yield { type: 'tool_result', gate: 'g', result: 'r1', is_error: false }
      yield { type: 'tool_result', gate: 'g', result: 'r2', is_error: false }
      yield { type: 'done', output: '' }
    }
    const svc = makeLocalChatService({ turnDriver: concurrentDriver })
    const s = await svc.createSession()

    const state = await foldTurn(svc, s.id, 'go')
    const assistant = state.messages.find((m) => m.role === 'assistant')
    expect(assistant?.toolCalls.length).toBe(2)
    expect(assistant?.toolCalls.map((t) => t.status)).toEqual(['completed', 'completed'])
    expect(assistant?.toolCalls.map((t) => t.output)).toEqual(['r1', 'r2'])

    // And it persisted with both tool calls.
    const hydrated = await svc.hydrateSession(s.id)
    expect(hydrated.messages[1].toolCalls.length).toBe(2)
  })

  it('turns a driver EOF without a terminal event into an explicit failed outcome', async () => {
    const incompleteDriver: TurnDriver = async function* () {
      yield { type: 'turn_start', turn: 0 }
      yield { type: 'text', content: 'partial' }
    }
    const svc = makeLocalChatService({ turnDriver: incompleteDriver })
    const session = await svc.createSession()
    const handle = await svc.startTurn(session.id, 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)

    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'Local turn ended before a terminal event.',
    })
    const outcome = await handle.done
    expect(outcome.state).toBe('failed')
    if (outcome.state !== 'failed') throw new Error('expected failed outcome')
    expect(outcome.failure).toMatchObject({ phase: 'stream', recovery: 'reconcile' })
  })

  it('turns a driver exception into a visible failed outcome', async () => {
    const failedDriver: TurnDriver = async function* () {
      yield { type: 'turn_start', turn: 0 }
      throw new Error('driver vanished')
    }
    const svc = makeLocalChatService({ turnDriver: failedDriver })
    const session = await svc.createSession()
    const handle = await svc.startTurn(session.id, 'go')
    const events: ChatEvent[] = []
    for await (const event of handle.events) events.push(event)

    expect(events.at(-1)).toEqual({ type: 'error', message: 'driver vanished' })
    const outcome = await handle.done
    expect(outcome.state).toBe('failed')
    if (outcome.state !== 'failed') throw new Error('expected failed outcome')
    expect(outcome.failure).toMatchObject({ phase: 'stream', recovery: 'reconcile' })
  })

  it('leaves a synchronous driver-construction failure pre-accept and safe to retry', async () => {
    const failedBeforeAccept: TurnDriver = () => {
      throw new Error('driver could not start')
    }
    const svc = makeLocalChatService({ turnDriver: failedBeforeAccept })
    const session = await svc.createSession()

    await expect(svc.startTurn(session.id, 'not persisted')).rejects.toThrow('driver could not start')
    expect((await svc.hydrateSession(session.id)).messages).toEqual([])
  })

  it('models() returns the configured options', () => {
    const svc = makeLocalChatService({ models: [{ id: 'm1', label: 'Model One' }] })
    expect(svc.models()).toEqual([{ id: 'm1', label: 'Model One' }])
  })

  it('slots: a 3-slot multiplexer over session ids', async () => {
    const svc = makeLocalChatService()
    const s = await svc.createSession()
    expect(svc.activeSlot).toBe(0)
    svc.bindSlotSession(1, s.id)
    svc.setActiveSlot(1)
    expect(svc.activeSlot).toBe(1)
    expect(svc.slotSessions()).toEqual([null, s.id, null])
  })
})
