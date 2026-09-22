import { describe, expect, it } from 'vitest'
import { isReady } from '@shrubbery/nucleus'

import { createGreenhouseStore, normalizeGreenhousePollMs } from '../greenhouse-store.js'
import type { GreenhouseConfig, GreenhouseService } from '../greenhouse-service.js'

const config: GreenhouseConfig = {
  baseUrl: 'http://127.0.0.1:3456',
  agentId: 'learner-1',
  clientId: 'vehicle-web',
  authorId: 'vera',
  role: 'user',
  pollMs: 5000,
  auth: {},
}

function service(): GreenhouseService {
  return {
    listAgents: async () => ({ agents: [], count: 0 }),
    readAgentWorld: async () => {
      throw new Error('unused')
    },
    pollAgentWorld: async () => {
      throw new Error('unused')
    },
    setAgentModel: async () => {
      throw new Error('unused')
    },
    claimAgentDriver: async () => {
      throw new Error('unused')
    },
    releaseAgentDriver: async () => {
      throw new Error('unused')
    },
    steerAgent: async () => {
      throw new Error('unused')
    },
    sendAgentWorldMessage: async () => {
      throw new Error('unused')
    },
  } as unknown as GreenhouseService
}

describe('GreenhouseStore — nucleus store conformance', () => {
  it('uses get() as the canonical read and getState() as compatibility alias', () => {
    const store = createGreenhouseStore(config, service())
    expect(store.get()).toEqual({ status: 'idle', read: null, error: null, capturedAt: null })
    expect(store.getState()).toBe(store.get())
    expect(isReady(store.get())).toBe(false)
  })

  it('settles refresh through the StoreState envelope and records capture time', async () => {
    const store = createGreenhouseStore(config, service())
    await store.refresh()
    expect(store.get().status).toBe('ready')
    expect(store.get().read?.screen).toBe('empty')
    expect(store.get().capturedAt).toEqual(expect.any(Number))
  })

  it('carries the retained previous read seam across successive captures', async () => {
    const store = createGreenhouseStore(config, service())
    await store.refresh()
    const first = store.get()
    await store.refresh()

    expect(store.get().previous).toEqual({
      read: first.read,
      capturedAt: first.capturedAt,
    })
  })

  it('normalizes poll cadence from config before polling starts', () => {
    expect(normalizeGreenhousePollMs({ pollMs: 5000 })).toBe(5000)
    expect(normalizeGreenhousePollMs({ pollMs: 25 })).toBe(1000)
  })

  it('selects the configured startup agent by handle or id before falling back to the first agent', async () => {
    const readWorldCalls: string[] = []
    const store = createGreenhouseStore(
      { ...config, agentId: 'agent-b' },
      {
        ...service(),
        listAgents: async () => ({
          count: 2,
          agents: [
            { agentId: 'agent-a', handle: 'alpha', graphId: 'lab', lifecycle: 'resident' },
            { agentId: 'agent-b', handle: 'beta', graphId: 'lab', lifecycle: 'resident' },
          ],
        }),
        readAgentWorld: async (agentId: string) => {
          readWorldCalls.push(agentId)
          return {
            agent: {},
            worldDoc: {} as never,
            agentVisiblePacket: null,
            session: null,
            run: null,
          }
        },
        pollAgentWorld: async (agentId: string, cursor: number) => ({
          agent: {},
          worldDoc: {} as never,
          agentVisiblePacket: null,
          session: null,
          run: null,
          events: [],
          nextCursor: cursor,
        }),
      } as unknown as GreenhouseService,
    )

    await store.refresh()

    expect(store.get().read?.selectedAgentId).toBe('agent-b')
    expect(readWorldCalls).toEqual(['agent-b'])
  })

  it('fetches the constitution matter once per agent and caches it for synchronous reads', async () => {
    const incidentCalls: string[] = []
    const bindingCalls: string[] = []
    const store = createGreenhouseStore(config, {
      ...service(),
      listAgentIncidents: async (agentId: string) => {
        incidentCalls.push(agentId)
        return { incidents: [{ ts: 1783296630045, kind: 'conversation.turn.tool.failed', sessionId: 'ags_x' }], count: 1 }
      },
      listAgentPromptBindings: async (agentId: string) => {
        bindingCalls.push(agentId)
        return { bindings: [{ bindingId: 'apb_a', status: 'active', activeFrom: 100, activeUntil: null }], count: 1 }
      },
    } as unknown as GreenhouseService)

    // Nothing cached before the fetch — the card degrades to its ° chips.
    expect(store.constitutionFor('agent-a')).toBeNull()

    // Concurrent entries for the same agent dedup to a single fetch pair.
    const [first, second] = await Promise.all([store.loadAgentConstitution('agent-a'), store.loadAgentConstitution('agent-a')])
    expect(first).toBe(second)
    expect(first.incidents).toHaveLength(1)
    expect(first.bindings).toHaveLength(1)

    // A later entry reuses the cache — still one fetch pair for agent-a.
    await store.loadAgentConstitution('agent-a')
    expect(incidentCalls).toEqual(['agent-a'])
    expect(bindingCalls).toEqual(['agent-a'])

    // The cached matter is available to the synchronous render read.
    expect(store.constitutionFor('agent-a')).toBe(first)

    // A different agent is a separate cache entry — its own single fetch.
    await store.loadAgentConstitution('agent-b')
    expect(incidentCalls).toEqual(['agent-a', 'agent-b'])
    expect(bindingCalls).toEqual(['agent-a', 'agent-b'])
    expect(store.constitutionFor('agent-b')).not.toBe(first)
  })

  it('retains per-agent testimony when switching away and back', async () => {
    const pollCursorByAgent: Array<readonly [string, number]> = []
    const store = createGreenhouseStore(
      { ...config, agentId: 'agent-a' },
      {
        ...service(),
        listAgents: async () => ({
          count: 2,
          agents: [
            { agentId: 'agent-a', handle: 'alpha', graphId: 'lab', lifecycle: 'resident' },
            { agentId: 'agent-b', handle: 'beta', graphId: 'lab', lifecycle: 'resident' },
          ],
        }),
        readAgentWorld: async (agentId: string) => ({
          agent: { agentId },
          worldDoc: {} as never,
          agentVisiblePacket: null,
          session: null,
          run: null,
        }),
        pollAgentWorld: async (agentId: string, cursor: number) => {
          pollCursorByAgent.push([agentId, cursor])
          return {
            agent: { agentId },
            worldDoc: {} as never,
            agentVisiblePacket: null,
            session: null,
            run: null,
            events:
              cursor < 0
                ? [
                    {
                      sessionId: `session-${agentId}`,
                      seq: agentId === 'agent-a' ? 10 : 20,
                      ts: 1783177200000,
                      type: 'conversation.message.created',
                      payload: { message: { id: `event-${agentId}`, authorId: agentId, role: 'agent', text: 'hi' } },
                    },
                  ]
                : [],
            nextCursor: cursor < 0 ? (agentId === 'agent-a' ? 10 : 20) : cursor,
          }
        },
        sendAgentWorldMessage: async (agentId: string) => ({
          agent: { agentId },
          worldDoc: {} as never,
          agentVisiblePacket: null,
          session: null,
          run: null,
          message: { id: `attested-${agentId}`, authorId: 'vera', role: 'user', text: 'hello' },
        }),
      } as unknown as GreenhouseService,
    )

    await store.refresh()
    await store.sendMessage({ authorId: 'vera', role: 'user', visibility: 'agent-visible', text: 'hello' })
    await store.openAgent('agent-b')
    await store.openAgent('agent-a')

    expect(store.get().read?.selectedAgentId).toBe('agent-a')
    expect(store.get().read?.events.map((event) => event.seq)).toEqual([10])
    expect(store.get().read?.cursor).toBe(10)
    expect(store.get().read?.attestedMessages.map((message) => message.id)).toEqual(['attested-agent-a'])
    expect(pollCursorByAgent).toContainEqual(['agent-a', 10])
  })
})
