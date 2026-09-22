/**
 * assemble.test.ts — REAL test of the ChatService factory + boundary adapter.
 *
 * No mocks: a minimal real EditorScope + a contract object typed to the interface
 * (only the slices the local impl might touch are accessed — none, for the
 * in-memory store, so the contract is never dereferenced on the local path).
 *
 * Asserts:
 *   1. assembleChatServices(..., 'local') returns a WORKING ChatService — drive a
 *      real turn through it.
 *   2. hosted mode requires an explicit Choreograph connection and then returns
 *      the real remote ChatService.
 *   3. buildChatKernelOptions returns a Pick of PURE ChatKernelOptions (render
 *      data + intents); onSend drives the host source's send.
 */

import { describe, it, expect } from 'vitest'
import {
  createProjectorState,
  finalize,
  projectEvents,
  uuid,
  type ChatEvent,
  type ChatMessage,
} from '@shrubbery/chat-kernel'
import type { EditorScope, ShrubberyContract } from '@shrubbery/nucleus'
import {
  minimalTextPanelConfig,
  serializeConfigToTriples,
  parseTriplesToConfig,
  triplesToNT,
  parseNT,
  type WorkspaceConfig,
  type Triple,
} from '@shrubbery/nucleus'
import {
  assembleChatServices,
  buildChatKernelOptions,
  type ChatProjection,
} from '../assemble.js'
import { makeGrowTurnDriver } from '../grow-turn-driver.js'
import type { GrowCell } from '../../grow/grow.js'

// A minimal real scope (the local impl reads it lazily; the in-memory store
// never dereferences it, but we pass a real one anyway).
const scope: EditorScope = {
  centerMode: 'document',
  graphId: 'assemble-test',
  documentId: null,
}

// The contract is typed to the interface; the local path never dereferences it.
// We pass an empty object cast to the type — honest because the local in-memory
// service genuinely does not touch any contract slice (proven by the turn below).
const contract = {
  auth: {
    token: () => 'token-a',
    userId: () => 'user-a',
  },
} as ShrubberyContract

describe('assembleChatServices — local and hosted are real', () => {
  it("'local' returns a working ChatService (real turn round-trips)", async () => {
    const svc = assembleChatServices(contract, () => scope, 'local')
    const s = await svc.createSession()

    // Fold the turn the host way (user bubble in base, accumulated re-fold).
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: 'ping',
      parts: [{ type: 'text', content: 'ping' }],
      isStreaming: false,
      toolCalls: [],
      createdAt: Date.now(),
    }
    const base = createProjectorState([userMsg])
    const h = await svc.startTurn(s.id, 'ping')
    const events: ChatEvent[] = []
    let state = base
    for await (const e of h.events) {
      events.push(e)
      state = projectEvents(events, base).state
    }
    await h.done
    state = finalize(state, state.streamingMessageId, undefined)

    const assistant = state.messages.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('You said: ping')
  })

  it("'local' threads an injected turnDriver — the GROW-DRIVER grows a real cell via the assembled service", async () => {
    // A REAL in-memory GrowCell (no mock): serialize→NT→parse round-trip + additive
    // union, the same production nucleus functions grow() uses on the real cell.
    const lineOf = (t: Triple): string => triplesToNT([t])
    let lines = new Set<string>(serializeConfigToTriples(minimalTextPanelConfig()).map(lineOf))
    const port: GrowCell = {
      readConfig: async (): Promise<WorkspaceConfig> =>
        parseTriplesToConfig(parseNT([...lines].join('\n'))),
      loadDelta: async (_g, nt): Promise<void> => {
        const next = new Set(lines)
        for (const t of parseNT(nt)) next.add(lineOf(t))
        lines = next
      },
    }
    const current = (): WorkspaceConfig => parseTriplesToConfig(parseNT([...lines].join('\n')))
    expect(current().rootRegions).not.toContain('region-top-bar')

    // Assemble WITH the injected grow-driver (the 4th param, the N0a seam).
    const svc = assembleChatServices(
      contract,
      () => scope,
      'local',
      makeGrowTurnDriver(port, scope.graphId ?? 'assemble-test'),
    )
    const s = await svc.createSession()

    // Drive a real turn — the phrase grows the real cell through the assembled svc.
    const h = await svc.startTurn(s.id, 'give me a top bar')
    const events: ChatEvent[] = []
    for await (const e of h.events) events.push(e)
    await h.done

    // The REAL side effect: the cell GREW (the assembled service used OUR driver).
    expect(current().rootRegions).toContain('region-top-bar')
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'tool_call',
      'tool_result',
      'text',
      'done',
    ])
  })

  it("'hosted' requires an explicit Choreograph connection", () => {
    expect(() => assembleChatServices(contract, () => scope, 'hosted')).toThrow(
      /requires hosted connection options/,
    )
  })

  it("'hosted' returns the real Choreograph-backed service", async () => {
    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      requests.push(`${init.method ?? 'GET'} ${String(input)}`)
      return new Response(
        JSON.stringify({ session: { session_id: 'hosted-1', title: null } }),
        { status: 201 },
      )
    }
    const svc = assembleChatServices(contract, () => scope, 'hosted', {
      hosted: { baseUrl: 'https://choreograph.example.test', fetchImpl },
    })
    const session = await svc.createSession()
    expect(session.id).toBe('hosted-1')
    expect(requests).toEqual(['POST https://choreograph.example.test/api/sessions'])
  })
})

describe('buildChatKernelOptions — pure kernel props from the host store', () => {
  it('projects render data + wires onSend to the host source', () => {
    const sent: string[] = []
    const proj: ChatProjection = {
      messages: [],
      streaming: false,
      conversationState: 'loading',
      sendState: 'error',
      sendRecovery: 'resubmit',
      sendError: 'Message not accepted',
      error: null,
      readOnly: false,
      models: [{ id: 'm1', label: 'Model One' }],
      currentModel: 'm1',
      sessionTitle: 'Assemble session',
      activeSlot: 1,
      slotSessions: [null, 'session-b', null],
    }
    const continuity: string[] = []
    const opts = buildChatKernelOptions(
      {
        send: (t) => sent.push(t),
        continuityAction: action => continuity.push(action.type),
      },
      () => proj,
    )
    expect(opts.messages).toBe(proj.messages)
    expect(opts.streaming).toBe(false)
    expect(opts.conversationState).toBe('loading')
    expect(opts.sendState).toBe('error')
    expect(opts.sendRecovery).toBe('resubmit')
    expect(opts.sendError).toBe('Message not accepted')
    expect(opts.error).toBeNull()
    expect(opts.readOnly).toBe(false)
    expect(opts.models).toBe(proj.models)
    expect(opts.currentModel).toBe('m1')
    expect(opts.sessionTitle).toBe('Assemble session')
    expect(opts.activeSlot).toBe(1)
    expect(opts.slotSessions).toBe(proj.slotSessions)

    opts.onSend?.('hello')
    opts.onContinuityAction?.({ type: 'retry-send' })
    expect(sent).toEqual(['hello'])
    expect(continuity).toEqual(['retry-send'])

    // onModelChange / onMessageAction are present + safe when the source omits them.
    expect(() => opts.onModelChange?.('m1')).not.toThrow()
    expect(() => opts.onMessageAction?.('id', 'copy')).not.toThrow()
  })

  it('collapses fictional legacy reconnecting/offline projections to gen-2 readiness', () => {
    const projection: ChatProjection = {
      messages: [],
      streaming: false,
      connectionState: 'reconnecting',
      error: null,
      readOnly: false,
      models: [],
      currentModel: '',
      sessionTitle: null,
      activeSlot: 0,
      slotSessions: [null, null, null],
    }
    const opts = buildChatKernelOptions({ send() {} }, () => projection)
    expect(opts.conversationState).toBe('ready')
    expect('connectionState' in opts).toBe(false)
  })
})
