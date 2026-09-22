import type { PollableStore, StoreState, StoreStatus } from '@shrubbery/nucleus'

import {
  type GreenhouseAgentControlResponse,
  type GreenhouseAgentIncident,
  type GreenhouseAgentPromptBinding,
  type GreenhouseAgentRecord,
  type GreenhouseAgentSessionEvent,
  type GreenhouseAgentSessionRecord,
  type GreenhouseAgentWorldResponse,
  type GreenhouseConfig,
  type GreenhouseService,
  type JsonRecord,
} from './greenhouse-service.js'

/**
 * The Constitution stance's off-world matter for one agent — the incident list (K3)
 * and the prompt-binding chain (K2), fetched together on stance entry and cached per
 * agent. It never rides the poll: the world/events poll drives the room, this is a
 * one-shot read the card consumes when a stance holds it.
 */
export interface GreenhouseAgentConstitution {
  readonly incidents: readonly GreenhouseAgentIncident[]
  readonly bindings: readonly GreenhouseAgentPromptBinding[]
}

const EMPTY_CONSTITUTION: GreenhouseAgentConstitution = { incidents: [], bindings: [] }

export type GreenhouseScreenState = 'loading' | 'ready' | 'dark' | 'empty'

export interface GreenhouseLiveRead {
  readonly screen: GreenhouseScreenState
  readonly agents: readonly GreenhouseAgentRecord[]
  readonly selectedAgentId: string
  readonly world: GreenhouseAgentWorldResponse | null
  readonly events: readonly GreenhouseAgentSessionEvent[]
  readonly cursor: number
  readonly attestedMessages: readonly JsonRecord[]
}

export interface GreenhouseStoreState extends StoreState<GreenhouseLiveRead> {
  readonly capturedAt: number | null
}

export interface GreenhouseStore extends PollableStore<GreenhouseLiveRead> {
  get(): GreenhouseStoreState
  subscribe(cb: (state: GreenhouseStoreState) => void): () => void
  getState(): GreenhouseStoreState
  openAgent(agentId: string): Promise<void>
  refreshRoster(): Promise<void>
  loadAgentSessions(agentId: string): Promise<readonly GreenhouseAgentSessionRecord[]>
  loadSessionMessages(sessionId: string): Promise<readonly JsonRecord[]>
  /** Fetch (once per agent) the Constitution matter — incidents + binding chain. */
  loadAgentConstitution(agentId: string): Promise<GreenhouseAgentConstitution>
  /** The cached Constitution matter for an agent, or null until it is fetched. */
  constitutionFor(agentId: string): GreenhouseAgentConstitution | null
  pollWorld(): Promise<void>
  setAgentModel(modelId: string, provider: string): Promise<void>
  claimFloor(): Promise<void>
  releaseFloor(): Promise<void>
  steerFloor(text: string): Promise<void>
  sendMessage(request: {
    readonly text: string
    readonly authorId: string
    readonly role: string
    readonly visibility: string
    readonly autoTurn?: boolean
  }): Promise<boolean>
}

const INITIAL_READ: GreenhouseLiveRead = {
  screen: 'loading',
  agents: [],
  selectedAgentId: '',
  world: null,
  events: [],
  cursor: -1,
  attestedMessages: [],
}

function agentSelector(agent: GreenhouseAgentRecord): string {
  return agent.agentId || agent.handle
}

function preferredStartupAgent(agents: readonly GreenhouseAgentRecord[], agentId: string): GreenhouseAgentRecord {
  const preferred = agentId.trim()
  return (
    (preferred
      ? agents.find((agent) => [agent.handle, agent.agentId, String(agent.label ?? '')].some((value) => value === preferred))
      : undefined) ??
    agents[0]
  )
}

type AgentContinuity = Pick<GreenhouseLiveRead, 'events' | 'cursor' | 'attestedMessages'>

const EMPTY_CONTINUITY: AgentContinuity = {
  events: [],
  cursor: -1,
  attestedMessages: [],
}

function mergeEvents(
  existing: readonly GreenhouseAgentSessionEvent[],
  incoming: readonly GreenhouseAgentSessionEvent[],
): readonly GreenhouseAgentSessionEvent[] {
  if (!incoming.length) return existing
  const seen = new Set(existing.map((event) => event.seq))
  return [...existing, ...incoming.filter((event) => !seen.has(event.seq))].sort((left, right) => left.seq - right.seq)
}

export function normalizeGreenhousePollMs(config: Pick<GreenhouseConfig, 'pollMs'>): number {
  return Math.max(1000, config.pollMs)
}

export function createGreenhouseStore(config: GreenhouseConfig, service: GreenhouseService): GreenhouseStore {
  let state: GreenhouseStoreState = { status: 'idle', read: null, error: null, capturedAt: null }
  let pollTimer: ReturnType<typeof setInterval> | null = null
  const subscribers = new Set<(state: GreenhouseStoreState) => void>()
  const continuityByAgent = new Map<string, AgentContinuity>()
  const constitutionByAgent = new Map<string, GreenhouseAgentConstitution>()
  const constitutionInflight = new Map<string, Promise<GreenhouseAgentConstitution>>()

  const currentRead = (): GreenhouseLiveRead => state.read ?? INITIAL_READ

  const rememberContinuity = (read: GreenhouseLiveRead | null = state.read): void => {
    if (!read?.selectedAgentId) return
    continuityByAgent.set(read.selectedAgentId, {
      events: read.events,
      cursor: read.cursor,
      attestedMessages: read.attestedMessages,
    })
  }

  const continuityFor = (agentId: string): AgentContinuity => continuityByAgent.get(agentId) ?? EMPTY_CONTINUITY

  const emit = (next: GreenhouseStoreState): void => {
    state = next
    for (const subscriber of subscribers) subscriber(state)
  }

  const commit = (
    status: StoreStatus,
    read: GreenhouseLiveRead | null,
    error: string | null = null,
    capturedAt: number | null = state.capturedAt,
    previous: GreenhouseStoreState['previous'] = state.previous,
  ): void => {
    emit(previous ? { status, read, error, capturedAt, previous } : { status, read, error, capturedAt })
  }

  const commitCapture = (read: GreenhouseLiveRead): void => {
    const previous =
      state.read !== null && state.capturedAt !== null
        ? { read: state.read, capturedAt: state.capturedAt }
        : undefined
    commit('ready', read, null, Date.now(), previous)
    rememberContinuity(read)
  }

  const applyControlResponse = (response: GreenhouseAgentControlResponse): void => {
    const read = currentRead()
    const world = response.document && read.world ? { ...read.world, worldDoc: response.document } : read.world
    const events = mergeEvents(read.events, response.events)
    const cursor = response.events.length ? Math.max(read.cursor, ...response.events.map((event) => event.seq)) : read.cursor
    commitCapture({ ...read, world, events, cursor })
  }

  const store: GreenhouseStore = {
    get: () => state,
    getState: () => state,
    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    async refresh() {
      const previous = currentRead()
      commit('loading', state.read, null)
      try {
        const roster = await service.listAgents(100)
        if (!roster.agents.length) {
          commitCapture({ ...INITIAL_READ, screen: 'empty', agents: roster.agents })
          return
        }
        rememberContinuity(previous)
        const preferred = preferredStartupAgent(roster.agents, config.agentId)
        const selectedAgentId = agentSelector(preferred)
        const world = await service.readAgentWorld(selectedAgentId)
        const continuity = continuityFor(selectedAgentId)
        commitCapture({
          ...previous,
          screen: 'ready',
          agents: roster.agents,
          selectedAgentId,
          world,
          ...continuity,
        })
        await store.pollWorld()
      } catch (error) {
        commit('error', { ...previous, screen: 'dark' }, error instanceof Error ? error.message : String(error), Date.now())
      }
    },
    async openAgent(agentId: string) {
      if (!agentId) return
      const previous = currentRead()
      try {
        rememberContinuity(previous)
        const world = await service.readAgentWorld(agentId)
        const continuity = continuityFor(agentId)
        commitCapture({
          ...previous,
          screen: 'ready',
          selectedAgentId: agentId,
          world,
          ...continuity,
        })
        await store.pollWorld()
      } catch (error) {
        commit('error', { ...previous, screen: 'dark' }, error instanceof Error ? error.message : String(error), Date.now())
      }
    },
    async refreshRoster() {
      const read = currentRead()
      try {
        const roster = await service.listAgents(100)
        const screen: GreenhouseScreenState = roster.agents.length ? (read.screen === 'empty' ? 'ready' : read.screen) : 'empty'
        commitCapture({ ...read, agents: roster.agents, screen })
      } catch {
        // Keep the prior roster on a transient failure; the ground-line pill carries
        // connection health via the world poll. A dark stack surfaces through refresh().
      }
    },
    async loadAgentSessions(agentId: string) {
      if (!agentId) return []
      return (await service.listAgentSessions(agentId)).sessions
    },
    async loadSessionMessages(sessionId: string) {
      if (!sessionId) return []
      return (await service.readAgentSessionMessages(sessionId)).messages
    },
    constitutionFor(agentId: string) {
      return constitutionByAgent.get(agentId) ?? null
    },
    async loadAgentConstitution(agentId: string) {
      if (!agentId) return EMPTY_CONSTITUTION
      // Cached per agent: a re-entry into the stance reuses the read rather than
      // re-fetching (constitution is slow-moving; drift arrives via the event stream).
      const cached = constitutionByAgent.get(agentId)
      if (cached) return cached
      const inflight = constitutionInflight.get(agentId)
      if (inflight) return inflight
      const promise = (async () => {
        const [incidents, bindings] = await Promise.all([
          service.listAgentIncidents(agentId),
          service.listAgentPromptBindings(agentId),
        ])
        const constitution: GreenhouseAgentConstitution = {
          incidents: incidents.incidents,
          bindings: bindings.bindings,
        }
        constitutionByAgent.set(agentId, constitution)
        // Nudge subscribers so the card re-renders with the now-served matter; the read
        // is unchanged (this is not a new world capture), only its reference is fresh.
        emit({ ...state })
        return constitution
      })()
      constitutionInflight.set(agentId, promise)
      try {
        return await promise
      } finally {
        constitutionInflight.delete(agentId)
      }
    },
    async pollWorld() {
      const read = currentRead()
      if (!read.selectedAgentId || read.screen === 'loading' || read.screen === 'empty') return
      try {
        const fresh = await service.pollAgentWorld(read.selectedAgentId, read.cursor)
        const events = mergeEvents(read.events, fresh.events)
        const cursor = fresh.events.length
          ? Math.max(fresh.nextCursor, ...fresh.events.map((event) => event.seq))
          : Math.max(read.cursor, fresh.nextCursor)
        commitCapture({ ...read, screen: 'ready', world: fresh, events, cursor })
      } catch (error) {
        if (!read.world) {
          commit('error', { ...read, screen: 'dark' }, error instanceof Error ? error.message : String(error), Date.now())
        }
      }
    },
    async setAgentModel(modelId: string, provider: string) {
      const read = currentRead()
      if (!read.selectedAgentId || !modelId) return
      try {
        const world = await service.setAgentModel(read.selectedAgentId, {
          authorId: config.authorId,
          model: modelId,
          provider,
        })
        const agents = read.agents.map((agent) =>
          agentSelector(agent) === read.selectedAgentId ? { ...agent, model: modelId, provider, updatedAt: Date.now() } : agent,
        )
        commitCapture({ ...read, world, agents, screen: 'ready' })
        await store.pollWorld()
      } catch (error) {
        commit('error', { ...read, screen: 'dark' }, error instanceof Error ? error.message : String(error), Date.now())
        throw error
      }
    },
    async claimFloor() {
      const read = currentRead()
      if (!read.selectedAgentId) return
      const response = await service.claimAgentDriver(read.selectedAgentId, { clientId: config.clientId })
      applyControlResponse(response)
      if (!response.document) await store.pollWorld()
    },
    async releaseFloor() {
      const read = currentRead()
      if (!read.selectedAgentId) return
      const response = await service.releaseAgentDriver(read.selectedAgentId, { clientId: config.clientId })
      applyControlResponse(response)
      if (!response.document) await store.pollWorld()
    },
    async steerFloor(text: string) {
      const read = currentRead()
      if (!read.selectedAgentId) return
      const response = await service.steerAgent(read.selectedAgentId, { clientId: config.clientId, text })
      applyControlResponse(response)
      if (!response.document) await store.pollWorld()
    },
    async sendMessage(request) {
      const read = currentRead()
      if (!read.selectedAgentId) return false
      const response = await service.sendAgentWorldMessage(read.selectedAgentId, request)
      commitCapture({
        ...read,
        world: response,
        attestedMessages: response.message ? [...read.attestedMessages, response.message] : read.attestedMessages,
        screen: 'ready',
      })
      await store.pollWorld()
      return true
    },
    startPoll(intervalMs: number) {
      store.stopPoll()
      pollTimer = setInterval(() => {
        void store.pollWorld()
      }, intervalMs)
      return () => store.stopPoll()
    },
    stopPoll() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    },
  }

  return store
}
