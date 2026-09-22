import { describe, expect, it } from 'vitest'
import type {
  ChatEvent,
  ChatMessage,
  ChatModelOption,
  SessionSummary,
} from '@shrubbery/chat-kernel'
import {
  ChatServiceFailure,
  type ChatService,
  type ChatTurnHandle,
} from '../../chat-services/chat-service.js'
import { createChatServiceStore } from '../chat-service-store.js'

const SESSION: SessionSummary = {
  id: 'session-1',
  title: 'Continuity',
  created_at: null,
  updated_at: null,
}

const RETAINED_MESSAGE: ChatMessage = {
  id: 'message-1',
  role: 'user',
  content: 'Retained transcript',
  parts: [{ type: 'text', content: 'Retained transcript' }],
  isStreaming: false,
  toolCalls: [],
  createdAt: 1,
}

const CONFIRMED_MESSAGE: ChatMessage = {
  ...RETAINED_MESSAGE,
  id: 'message-2',
  content: 'Could already be durable',
  parts: [{ type: 'text', content: 'Could already be durable' }],
  createdAt: 2,
}

async function* noEvents(): AsyncIterable<ChatEvent> {}

function settledHandle(): ChatTurnHandle {
  return {
    events: noEvents(),
    done: Promise.resolve({ state: 'completed' }),
    abort() {},
  }
}

function ambiguousHandle(): ChatTurnHandle {
  return {
    events: noEvents(),
    done: Promise.resolve({
      state: 'failed',
      failure: new ChatServiceFailure('Stream ended before confirmation', {
        phase: 'stream',
        recovery: 'reconcile',
      }),
    }),
    abort() {},
  }
}

function service(overrides: Partial<ChatService> = {}): ChatService {
  const models: ChatModelOption[] = [{ id: 'local', label: 'Local' }]
  return {
    startTurn: async () => settledHandle(),
    abort: async () => {},
    createSession: async () => SESSION,
    listSessions: async () => [SESSION],
    hydrateSession: async () => ({ session: SESSION, messages: [RETAINED_MESSAGE] }),
    renameSession: async () => SESSION,
    deleteSession: async () => {},
    models: () => models,
    activeSlot: 0,
    slotSessions: () => [SESSION.id, null, null],
    setActiveSlot() {},
    bindSlotSession() {},
    ...overrides,
  }
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('continuity test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

describe('chat service store continuity', () => {
  it('retains a rejected outbound payload and retries it only on explicit intent', async () => {
    const attempts: string[] = []
    let fail = true
    const store = createChatServiceStore(service({
      startTurn: async (_sessionId, text) => {
        attempts.push(text)
        if (fail) throw new Error('Message was not accepted')
        return settledHandle()
      },
    }))
    store.setSession(SESSION.id)
    await until(() => store.getState().conversationState === 'ready')

    store.send('Try this once')
    await until(() => store.getState().sendState === 'error')
    expect(store.getState().sendError).toBe('Message was not accepted')
    expect(store.getState().sendRecovery).toBe('resubmit')
    expect(store.getState().retainedDraft).toBe('Try this once')
    expect(attempts).toEqual(['Try this once'])

    fail = false
    store.continuityAction?.({ type: 'retry-send' })
    await until(() => store.getState().sendState === 'ready' && !store.getState().streaming)
    expect(attempts).toEqual(['Try this once', 'Try this once'])
    expect(store.getState().sendError).toBeNull()
  })

  it('keeps the last useful transcript while conversation loading fails and retries', async () => {
    let hydrateAttempt = 0
    const store = createChatServiceStore(service({
      hydrateSession: async () => {
        hydrateAttempt += 1
        if (hydrateAttempt === 2) throw new Error('Refresh failed')
        return { session: SESSION, messages: [RETAINED_MESSAGE] }
      },
    }))
    store.setSession(SESSION.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1'])

    store.continuityAction?.({ type: 'retry-load' })
    expect(store.getState().conversationState).toBe('loading')
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1'])
    await until(() => store.getState().conversationState === 'error')
    expect(store.getState().error).toBe('Refresh failed')
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1'])

    store.continuityAction?.({ type: 'retry-load' })
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().error).toBeNull()
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1'])
  })

  it('reconciles an ambiguous hosted submit by rehydrating, retaining the payload, and never resubmitting', async () => {
    const attempts: string[] = []
    let hydrateAttempts = 0
    const store = createChatServiceStore(service({
      startTurn: async (_sessionId, text) => {
        attempts.push(text)
        throw new ChatServiceFailure('Response lost after submit', {
          phase: 'submit',
          recovery: 'reconcile',
        })
      },
      hydrateSession: async () => {
        hydrateAttempts += 1
        return { session: SESSION, messages: [RETAINED_MESSAGE] }
      },
    }))
    store.setSession(SESSION.id)
    await until(() => store.getState().conversationState === 'ready')

    store.send('Could already be durable')
    await until(() => store.getState().sendState === 'uncertain')
    expect(store.getState()).toMatchObject({
      sendRecovery: 'reconcile',
      retainedDraft: 'Could already be durable',
      sendError: 'Response lost after submit',
    })
    expect(attempts).toEqual(['Could already be durable'])

    store.continuityAction?.({ type: 'reconcile-turn' })
    expect(store.getState().conversationState).toBe('loading')
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1'])
    expect(store.getState().retainedDraft).toBe('Could already be durable')
    await until(() => store.getState().conversationState === 'ready')

    expect(hydrateAttempts).toBe(2)
    expect(attempts).toEqual(['Could already be durable'])
    expect(store.getState()).toMatchObject({
      sendState: 'uncertain',
      sendRecovery: 'reconcile',
      retainedDraft: 'Could already be durable',
    })
    expect(store.getState().sendError).toContain('status is still uncertain')
  })

  it('resolves ambiguity when reconciliation finds the newly persisted user message', async () => {
    let hydrateAttempts = 0
    let attempts = 0
    const store = createChatServiceStore(service({
      startTurn: async () => {
        attempts += 1
        throw new ChatServiceFailure('Response lost after submit', {
          phase: 'submit',
          recovery: 'reconcile',
        })
      },
      hydrateSession: async () => {
        hydrateAttempts += 1
        return {
          session: SESSION,
          messages: hydrateAttempts === 1
            ? [RETAINED_MESSAGE]
            : [RETAINED_MESSAGE, CONFIRMED_MESSAGE],
        }
      },
    }))
    store.setSession(SESSION.id)
    await until(() => store.getState().conversationState === 'ready')

    store.send('Could already be durable')
    await until(() => store.getState().sendState === 'uncertain')
    store.continuityAction?.({ type: 'reconcile-turn' })
    await until(() => store.getState().conversationState === 'ready')

    expect(attempts).toBe(1)
    expect(store.getState()).toMatchObject({
      sendState: 'ready',
      sendRecovery: 'none',
      retainedDraft: null,
      sendError: null,
    })
    expect(store.getState().messages.map(message => message.id)).toEqual(['message-1', 'message-2'])
  })

  it('projects an accepted turn with an ambiguous stream outcome as Check status, not Retry send', async () => {
    let attempts = 0
    const store = createChatServiceStore(service({
      startTurn: async () => {
        attempts += 1
        return ambiguousHandle()
      },
    }))
    store.setSession(SESSION.id)
    await until(() => store.getState().conversationState === 'ready')

    store.send('Accepted before the stream disappeared')
    await until(() => store.getState().sendState === 'uncertain')
    expect(store.getState()).toMatchObject({
      streaming: false,
      sendRecovery: 'reconcile',
      retainedDraft: 'Accepted before the stream disappeared',
      sendError: 'Stream ended before confirmation',
    })

    store.continuityAction?.({ type: 'retry-send' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(attempts).toBe(1)
  })
})
