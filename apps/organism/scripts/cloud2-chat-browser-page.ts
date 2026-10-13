import type { ChatEvent } from '@shrubbery/chat-kernel'
import { makeHostedChatService } from '../../../packages/runtime/src/chat-services/hosted-chat-service.js'
import { ensureActiveChatSession } from '../src/cell/active-chat-session.js'

declare global {
  interface Window {
    __cloud2ChatHarness?: Record<string, unknown>
  }
}

const GRAPH_ID = 'sophia-cluster'
const USER_ID = 'browser-proof-user'
const OWNER = `user:${USER_ID}`

async function collect(handle: Awaited<ReturnType<ReturnType<typeof makeHostedChatService>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const event of handle.events) events.push(event)
  return { events, outcome: await handle.done }
}

const service = makeHostedChatService({
  graphBaseUrl: graphId => `https://api.canary.sophia-labs.com/o/${encodeURIComponent(OWNER)}/g/${encodeURIComponent(graphId)}`,
  graphId: () => GRAPH_ID,
  userId: () => USER_ID,
  token: () => 'browser-proof-jwt',
  storage: window.localStorage,
  resolveAttempts: 2,
  // Gives the harness time to reload after worker completion but before the
  // adapter reopens SSE looking for durable command completion.
  resolveDelayMs: 5_000,
  // The adapter used to pause resolveDelayMs after every read; it now only yields while events are
  // flowing (F-step-zero D2). This harness needs its window between worker completion and the
  // durable command, so every pause of the adapter's is held at least that long.
  sleep: ms => new Promise(resolve => setTimeout(resolve, Math.max(ms, 5_000))),
})

function descriptorBinding(sessionId: string): Record<string, unknown> {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.includes('shrubbery:c2chat:v1') || !key.includes(':descriptor:')) continue
    try {
      const value = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null
      if (value?.virtualId === sessionId) {
        return {
          virtualId: value.virtualId,
          runId: value.runId,
          agentSessionId: value.agentSessionId,
        }
      }
    } catch {
      // Ignore unrelated or corrupt browser storage; the service owns validation.
    }
  }
  return { virtualId: sessionId }
}

function messagePairs(messages: readonly { role: string; content: string }[]): string[][] {
  return messages.map(message => [message.role, message.content])
}

async function commonState(sessionId: string): Promise<Record<string, unknown>> {
  const sessions = await service.listSessions()
  return {
    sessionId,
    sessionCount: sessions.length,
    activeSlot: service.activeSlot,
    slotSessionId: service.slotSessions()[service.activeSlot],
    binding: descriptorBinding(sessionId),
    models: service.models(),
  }
}

async function run(): Promise<void> {
  const stage = new URL(location.href).searchParams.get('stage') ?? 'first'
  const sessionId = await ensureActiveChatSession(service, {
    title: 'Browser proof',
    graphId: GRAPH_ID,
  })

  if (stage === 'first') {
    const turn = await collect(await service.startTurn(sessionId, 'Hello Sophia'))
    window.__cloud2ChatHarness = {
      ready: true,
      stage,
      ...await commonState(sessionId),
      turn,
    }
    return
  }

  if (stage === 'pending') {
    const before = await service.hydrateSession(sessionId)
    const handle = await service.startTurn(sessionId, 'And now?')
    const events: ChatEvent[] = []
    for await (const event of handle.events) {
      events.push(event)
      if (event.type !== 'done') continue
      const during = await service.hydrateSession(sessionId)
      window.__cloud2ChatHarness = {
        ready: true,
        stage,
        ...await commonState(sessionId),
        before: messagePairs(before.messages),
        during: messagePairs(during.messages),
        events,
      }
      return
    }
    throw new Error('follow-up stream ended before worker message.completed')
  }

  if (stage === 'resume') {
    const pending = await service.hydrateSession(sessionId)
    const turn = await collect(await service.startTurn(sessionId, 'And now?'))
    const after = await service.hydrateSession(sessionId)
    window.__cloud2ChatHarness = {
      ready: true,
      stage,
      ...await commonState(sessionId),
      pending: messagePairs(pending.messages),
      turn,
      after: messagePairs(after.messages),
    }
    return
  }

  throw new Error(`unknown harness stage '${stage}'`)
}

run().catch(error => {
  window.__cloud2ChatHarness = {
    ready: true,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }
})
