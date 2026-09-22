// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  agentMark,
  buildAgentCard,
  buildAgentFloor,
  buildAgentPresence,
  buildBayStrip,
  buildConstitutionStrip,
  buildConversationRow,
  buildTurnoverBrief,
} from '@shrubbery/nucleus'
import type { GreenhouseStore } from '../greenhouse-store.js'

const NOW = 1783285300000

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

let render: (typeof import('lit'))['render']
let greenhouseApp: typeof import('../greenhouse-app.js')

beforeAll(async () => {
  ;({ render } = await import('lit'))
  greenhouseApp = await import('../greenhouse-app.js')
})

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

// Settle the element after an interaction that awaits live-store promises (session
// loads, room entry): flush microtasks and re-render a few times.
async function flushApp(app: { updateComplete: Promise<unknown> }): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await app.updateComplete
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('renderPresenceStrip', () => {
  it('renders presence from a real view model object', () => {
    const presence = buildAgentPresence({
      name: 'learner-1',
      kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
      lifecycle: 'resident',
      model: 'gpt-5',
      driver: 'vera',
      graph: 'sophia-code-lab',
      runId: 'run-greenhouse',
      sessionId: 'session-learner-1',
      // The view model carries EPOCH MS; the label comes from the shared formatter (R4c).
      updatedAt: greenhouseApp.presenceUpdatedLabel(1783166400000),
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    expect(host.querySelector('.presence-name')?.textContent).toBe('learner-1')
    expect(host.querySelector('.presence-dot')?.classList.contains('presence-dot-live')).toBe(true)
    expect(host.querySelector('.presence-kindline')?.textContent).toBe(
      'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    )
    expect(host.querySelector('.presence-meta')?.textContent).toContain('run-greenhouse')
    expect(host.querySelector('.presence-meta')?.textContent).toContain('session-learner-1')
    // formatter-produced, deterministic UTC — never a locale string
    expect(host.querySelector('.presence-meta')?.textContent).toContain('updated 2026-07-04 12:00 UTC')
  })

  it('presenceUpdatedLabel is the ONE updated-chip formatter: epoch-ms in, deterministic UTC out', () => {
    // epoch-ms number (what GreenhouseAgentRecord.updatedAt carries — Date.now())
    expect(greenhouseApp.presenceUpdatedLabel(1783166400000)).toBe('2026-07-04 12:00 UTC')
    // the service wire may hand ISO strings — same label
    expect(greenhouseApp.presenceUpdatedLabel('2026-07-04T12:00:00Z')).toBe('2026-07-04 12:00 UTC')
    // garbage yields NO chip — honest absence, never a passthrough locale string
    expect(greenhouseApp.presenceUpdatedLabel('7/4/2026, 12:00:00 PM')).toBe('')
    expect(greenhouseApp.presenceUpdatedLabel(undefined)).toBe('')
    expect(greenhouseApp.presenceUpdatedLabel(null)).toBe('')
  })

  it('renders no kindline node when no kind is attested', () => {
    const presence = buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5' })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    expect(host.querySelector('.presence-kindline')).toBeNull()
  })

  it('renders quiet capture age from a Recency carrier in the meta line', () => {
    const presence = buildAgentPresence({
      name: 'learner-1',
      lifecycle: 'resident',
      model: 'gpt-5',
      runId: 'run-greenhouse',
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence, {
      recency: {
        current: {} as never,
        capturedAt: 1783177200000,
        previous: { value: {} as never, capturedAt: 1783173600000 },
      },
    }), host)

    expect(host.querySelector('.presence-meta')?.textContent).toContain('as of')
    expect(host.querySelector('.presence-meta')?.getAttribute('title')).toContain('as of')
  })

  it('carries floor state as a token hook on the presence strip', () => {
    const presence = buildAgentPresence({
      name: 'learner',
      lifecycle: 'resident',
      model: 'gpt-5',
    })
    const floor = buildAgentFloor({
      world: { worldDoc: { control: { driverLease: null, steeringQueue: [] } } },
      clientId: 'greenhouse',
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence, { floor }), host)

    expect(host.querySelector('.presence-strip')?.getAttribute('data-floor-state')).toBe('open')
  })

  it('stamps floor state onto the host token hook once the active conversation opens the room', async () => {
    const app = document.createElement('greenhouse-app') as InstanceType<typeof greenhouseApp.GreenhouseApp>
    const read = {
      screen: 'ready' as const,
      agents: [{ agentId: 'agent-a', handle: 'alpha', graphId: 'lab', lifecycle: 'resident' }],
      selectedAgentId: 'agent-a',
      world: {
        agent: {},
        worldDoc: {
          agent: { handle: 'alpha' },
          status: { activeSessionId: 'session-a' },
          prompts: {},
          toolbelt: {},
          schemas: {},
          world: {},
          memory: {},
          conversation: {},
          runtime: {},
          control: {
            driverLease: { holder: 'vehicle-web', clientId: 'vehicle-web', claimTs: 1783177200000 },
            steeringQueue: [],
          },
          collaborators: {},
          codex: {},
          ontology: {},
        },
        agentVisiblePacket: null,
        session: null,
        run: null,
      },
      events: [],
      cursor: -1,
      attestedMessages: [],
    }
    app.store = {
      get: () => ({ status: 'ready', read, error: null, capturedAt: 1783177200000 }),
      getState: () => ({ status: 'ready', read, error: null, capturedAt: 1783177200000 }),
      subscribe: () => () => {},
      refresh: async () => {},
      openAgent: async () => {},
      refreshRoster: async () => {},
      loadAgentSessions: async () => [
        { sessionId: 'session-a', objective: 'the smoke turn', messageCount: 1, lastMessageAt: 1783177200000 },
      ],
      loadSessionMessages: async () => [],
      loadAgentConstitution: async () => ({ incidents: [], bindings: [] }),
      constitutionFor: () => null,
      pollWorld: async () => {},
      setAgentModel: async () => {},
      claimFloor: async () => {},
      releaseFloor: async () => {},
      steerFloor: async () => {},
      sendMessage: async () => true,
      startPoll: () => () => {},
      stopPoll: () => {},
    } as GreenhouseStore
    document.body.append(app)
    await app.updateComplete

    // The bay is the root; the floor belongs to the room, entered through the active conversation.
    expect(app.getAttribute('data-floor-state')).toBeNull()
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-strip-hook')?.click()
    await flushApp(app)
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-conv')?.click()
    await flushApp(app)

    expect(app.getAttribute('data-floor-state')).toBe('held')
  })

  it('renders served model attribution as testimony and title', () => {
    const presence = buildAgentPresence({
      name: 'learner-1',
      lifecycle: 'resident',
      model: 'gpt-5',
      driver: 'vera',
      graph: 'sophia-code-lab',
      runId: 'run-greenhouse',
      sessionId: 'session-learner-1',
      updatedAt: '-',
      attribution: { value: 'gpt-5', actorId: 'vehicle-web', at: 1783177200000 },
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    const attribution = host.querySelector('.presence-model-attribution')
    expect(attribution?.textContent?.trim()).toBe('set by vehicle-web')
    expect(attribution?.getAttribute('title')).toContain('vehicle-web')
    expect(attribution?.getAttribute('title')).toContain(new Date(1783177200000).toLocaleString())
  })

  it('renders no model attribution when the projection served none', () => {
    const presence = buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5' })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    expect(host.querySelector('.presence-model-attribution')).toBeNull()
  })

  it('confesses simulated model values quietly in the presence strip', () => {
    const presence = buildAgentPresence({
      name: 'learner-1',
      lifecycle: 'resident',
      model: 'mock:done',
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    expect(host.querySelector('.presence-model-simulated')?.textContent).toBe('(simulated)')
  })

  it('applies held, dormant, and unknown tone classes from the view model', () => {
    const base = {
      name: 'learner-1',
      model: 'gpt-5',
      driver: 'vera',
      graph: 'sophia-code-lab',
      runId: 'run-greenhouse',
      sessionId: 'session-learner-1',
      updatedAt: '-',
    }
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(buildAgentPresence({ ...base, lifecycle: 'paused' })), host)
    expect(host.querySelector('.presence-dot')?.classList.contains('presence-dot-held')).toBe(true)

    render(greenhouseApp.renderPresenceStrip(buildAgentPresence({ ...base, lifecycle: 'completed' })), host)
    expect(host.querySelector('.presence-dot')?.classList.contains('presence-dot-dormant')).toBe(true)

    // Absent lifecycle is drawn as unknown (dashed), never collapsed into dormant.
    render(greenhouseApp.renderPresenceStrip(buildAgentPresence({ ...base, lifecycle: '-' })), host)
    expect(host.querySelector('.presence-dot')?.classList.contains('presence-dot-unknown')).toBe(true)
  })

  it('phosphor honesty: a seeded model chip gains the amber degraded treatment + an explanatory title', () => {
    const presence = buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5', seeded: true })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    const trigger = host.querySelector('.agent-model-trigger')
    expect(trigger?.classList.contains('agent-model-trigger-seeded')).toBe(true)
    expect(trigger?.getAttribute('title')).toContain('fallback identity — graph unread')
    expect(trigger?.getAttribute('title')).not.toBe('gpt-5')
  })

  it('a non-seeded model chip is unchanged: no seeded class, and the title is still just the model value', () => {
    const presence = buildAgentPresence({ name: 'learner-1', lifecycle: 'resident', model: 'gpt-5' })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence), host)

    const trigger = host.querySelector('.agent-model-trigger')
    expect(trigger?.className).toBe('agent-model-trigger')
    expect(trigger?.getAttribute('title')).toBe('gpt-5')
  })

  it('renders the open floor affordance without placeholder dashes', () => {
    const presence = buildAgentPresence({
      name: 'learner',
      lifecycle: 'resident',
      model: 'gpt5',
      graph: 'lab',
    })
    const floor = buildAgentFloor({
      world: { worldDoc: { control: { driverLease: null, steeringQueue: [] } } },
      clientId: 'greenhouse',
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence, { floor }), host)

    expect(host.textContent).toContain('the floor is open')
    expect(host.querySelector<HTMLButtonElement>('.text-affordance')?.textContent?.trim()).toBe('take the controls')
    expect(host.textContent).not.toContain('-')
    expect(host.textContent).not.toContain('driven by')
  })

  it('renders the release affordance when this client holds the floor', () => {
    const presence = buildAgentPresence({
      name: 'learner',
      lifecycle: 'resident',
      model: 'gpt5',
      graph: 'lab',
    })
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: { holder: 'greenhouse', clientId: 'greenhouse', claimTs: 1783177200000, epoch: 2 },
            steeringQueue: [],
          },
        },
      },
      clientId: 'greenhouse',
    })
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderPresenceStrip(presence, { floor }), host)

    expect(host.textContent).toContain('you have the controls')
    expect(host.querySelector<HTMLButtonElement>('.text-affordance')?.textContent?.trim()).toBe('release')
  })

  it('opens the inline steer input from a real held-by-other view model', async () => {
    const presence = buildAgentPresence({
      name: 'learner',
      lifecycle: 'resident',
      model: 'gpt5',
      graph: 'lab',
    })
    const floor = buildAgentFloor({
      world: {
        worldDoc: {
          control: {
            driverLease: { holder: 'vehicle', clientId: 'vehicle', claimTs: 1783177200000, epoch: 3 },
            steeringQueue: [{ id: 'steer:1', clientId: 'vera', text: 'continue', ts: 1783177210000 }],
          },
        },
      },
      clientId: 'greenhouse',
    })
    const host = document.createElement('div')
    document.body.append(host)
    let steeringOpen = false

    render(
      greenhouseApp.renderPresenceStrip(presence, {
        floor,
        steeringOpen,
        onFloorAffordance: (affordance) => {
          if (affordance.intent === 'steer') steeringOpen = true
        },
      }),
      host,
    )
    host.querySelector<HTMLButtonElement>('.text-affordance')?.click()
    render(greenhouseApp.renderPresenceStrip(presence, { floor, steeringOpen }), host)

    expect(host.textContent).toContain('vehicle has the controls')
    expect(host.textContent).toContain('steering queued: 1')
    expect(host.textContent).toContain('continue')
    expect(host.querySelector<HTMLInputElement>('.steer-input')).not.toBeNull()
  })

  it('renders no transcript nodes for an empty transcript', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(greenhouseApp.renderSpeechSurface({ messages: [], turnActivity: { state: 'idle' } }), host)

    expect(host.querySelector('.speech-surface')).toBeNull()
    expect(host.querySelector('.transcript')).toBeNull()
    expect(host.querySelector('.message-line')).toBeNull()
    expect(host.textContent).not.toContain('no messages')
  })

  it('renders a message line with backend author label and text', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderSpeechSurface({
        messages: [
          {
            id: 'm1',
            author: { id: 'vera', role: 'user', isSelf: true },
            text: 'hello room',
            at: 1783177200000,
          },
        ],
        turnActivity: { state: 'idle' },
      }),
      host,
    )

    expect(host.querySelector('.message-attribution')?.textContent).toContain('vera')
    expect(host.querySelector('.message-attribution')?.textContent).toContain('·')
    expect(host.querySelector('.message-text')?.textContent).toBe('hello room')
  })

  it('renders agent message text verbatim as plain text', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const text = 'thinking...\n<tool_call>{"name":"search"}</tool_call>\n**not markdown**'

    render(
      greenhouseApp.renderSpeechSurface({
        messages: [
          {
            id: 'm1',
            author: { id: 'learner-1', role: 'agent', isSelf: false },
            text,
            at: 1783177200000,
          },
        ],
        turnActivity: { state: 'idle' },
      }),
      host,
    )

    const messageText = host.querySelector<HTMLElement>('.message-text')
    expect(messageText?.textContent).toBe(text)
    expect(messageText?.querySelector('*')).toBeNull()
    expect(host.querySelector('.message-line-agent')).not.toBeNull()
    expect(host.querySelector('.conduct-disclosure')).toBeNull()
  })

  it('renders an agent turn account collapsed by default', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const text = `[stream text #1]
{"count":1,"memories":[]}

[done output #2]
Stored a durable memory.`

    render(
      greenhouseApp.renderSpeechSurface({
        messages: [
          {
            id: 'm1',
            author: { id: 'learner-1', role: 'agent', isSelf: false },
            text,
            at: 1783177200000,
            turnAccount: {
              reply: 'Stored a durable memory.',
              conduct: [{ verb: 'stream text', detail: '{"count":1,"memories":[]}' }],
            },
          },
        ],
        turnActivity: { state: 'idle' },
      }),
      host,
    )

    expect(host.querySelector('.message-text')?.textContent).toBe('Stored a durable memory.')
    expect(host.querySelector<HTMLButtonElement>('.conduct-disclosure')?.textContent?.trim()).toBe('conduct: 1 step')
    expect(host.querySelector('.conduct-lines')).toBeNull()
    expect(host.textContent).not.toContain('[stream text #1]')
  })

  it('unfolds conduct evidence lines without placeholder dashes', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const open = new Set(['m1'])

    render(
      greenhouseApp.renderSpeechSurface(
        {
          messages: [
            {
              id: 'm1',
              author: { id: 'learner-1', role: 'agent', isSelf: false },
              text: 'Stored a durable memory.',
              at: 1783177200000,
              turnAccount: {
                reply: 'Stored a durable memory.',
                conduct: [
                  {
                    verb: 'tool completed',
                    detail: 'toolName: remember; toolCallId: tool1',
                    outcome: '{"ok":true}',
                    observer: 'learner1',
                    observedAt: 1783177201000,
                  },
                ],
              },
            },
          ],
          turnActivity: { state: 'idle' },
        },
        null,
        { openConductIds: open },
      ),
      host,
    )

    expect(host.querySelector('.conduct-lines')).not.toBeNull()
    expect(host.querySelector('.conduct-line')?.textContent).toContain('tool completed')
    expect(host.querySelector('.conduct-line')?.textContent).toContain('toolName: remember')
    expect(host.querySelector('.conduct-line')?.textContent).toContain('{"ok":true}')
    expect(host.querySelector('.conduct-line')?.textContent).toContain('learner1')
    expect(host.querySelector('.conduct-line')?.textContent).not.toContain('-')
  })

  it('renders metric whisper only when usage exists', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderSpeechSurface({
        messages: [
          {
            id: 'm1',
            author: { id: 'learner-1', role: 'agent', isSelf: false },
            text: 'Done.',
            at: 1783177200000,
            turnAccount: {
              reply: 'Done.',
              conduct: [{ verb: 'turn completed', detail: 'state: completed' }],
              usage: { tokens: 1204, toolCalls: 2 },
            },
          },
        ],
        turnActivity: { state: 'idle' },
      }),
      host,
    )

    expect(host.querySelector('.conduct-disclosure')?.textContent).toContain('conduct: 1 step')
    expect(host.querySelector('.conduct-disclosure')?.textContent).toContain('1,204 tokens')
    expect(host.querySelector('.conduct-disclosure')?.textContent).toContain('2 tool calls')

    render(
      greenhouseApp.renderSpeechSurface({
        messages: [
          {
            id: 'm2',
            author: { id: 'learner-1', role: 'agent', isSelf: false },
            text: 'Done.',
            at: 1783177200000,
            turnAccount: {
              reply: 'Done.',
              conduct: [{ verb: 'turn completed', detail: 'state: completed' }],
            },
          },
        ],
        turnActivity: { state: 'idle' },
      }),
      host,
    )

    expect(host.querySelector('.conduct-disclosure')?.textContent?.trim()).toBe('conduct: 1 step')
  })

  it('keeps an unfolded conduct account open across a poll refresh', async () => {
    const app = document.createElement('greenhouse-app') as InstanceType<typeof greenhouseApp.GreenhouseApp>
    const subscribers = new Set<(state: GreenhouseStore['getState'] extends () => infer State ? State : never) => void>()
    const message = {
      id: 'm1',
      authorId: 'learner1',
      role: 'agent',
      text: `[stream text #1]\n{"count":1}\n\n[done output #2]\nStored a durable memory.`,
      createdAt: 1783177200000,
    }
    const read = {
      screen: 'ready' as const,
      agents: [{ agentId: 'agent-a', handle: 'learner1', graphId: 'lab', lifecycle: 'resident' }],
      selectedAgentId: 'agent-a',
      world: {
        agent: {},
        worldDoc: {
          agent: { handle: 'learner1' },
          status: { activeSessionId: 'session1' },
          prompts: {},
          toolbelt: {},
          schemas: {},
          world: {},
          memory: {},
          conversation: { messages: [message] },
          runtime: {},
          control: { driverLease: null, steeringQueue: [] },
          collaborators: {},
          codex: {},
          ontology: {},
        },
        agentVisiblePacket: null,
        session: null,
        run: null,
      },
      events: [],
      cursor: -1,
      attestedMessages: [],
    }
    let state = { status: 'ready' as const, read, error: null, capturedAt: 1783177200000 }
    app.store = {
      get: () => state,
      getState: () => state,
      subscribe: (cb) => {
        subscribers.add(cb)
        return () => subscribers.delete(cb)
      },
      refresh: async () => {},
      openAgent: async () => {},
      refreshRoster: async () => {},
      loadAgentSessions: async () => [
        { sessionId: 'session1', objective: 'the durable-memory turn', messageCount: 1, lastMessageAt: 1783177200000 },
      ],
      loadSessionMessages: async () => [],
      loadAgentConstitution: async () => ({ incidents: [], bindings: [] }),
      constitutionFor: () => null,
      pollWorld: async () => {},
      setAgentModel: async () => {},
      claimFloor: async () => {},
      releaseFloor: async () => {},
      steerFloor: async () => {},
      sendMessage: async () => true,
      startPoll: () => () => {},
      stopPoll: () => {},
    } as GreenhouseStore
    document.body.append(app)
    await app.updateComplete

    // Enter the room through the active conversation, then open the conduct account.
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-strip-hook')?.click()
    await flushApp(app)
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-conv')?.click()
    await flushApp(app)

    app.renderRoot.querySelector<HTMLButtonElement>('.conduct-disclosure')?.click()
    await app.updateComplete
    expect(app.renderRoot.querySelector('.conduct-lines')).not.toBeNull()

    state = {
      ...state,
      read: { ...read, world: { ...read.world, worldDoc: { ...read.world.worldDoc, runtime: { heartbeat: 1 } } } },
      capturedAt: 1783177201000,
    }
    for (const subscriber of subscribers) subscriber(state)
    await app.updateComplete

    expect(app.renderRoot.querySelector('.conduct-lines')).not.toBeNull()
  })

  it('renders the turn-in-flight line only while activity is in flight', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderSpeechSurface({ messages: [], turnActivity: { state: 'running', since: 1783177200000 } }, null),
      host,
    )
    expect(host.querySelector('.turn-activity')?.textContent).toContain('agent is taking a turn')

    render(greenhouseApp.renderSpeechSurface({ messages: [], turnActivity: { state: 'idle' } }, null), host)
    expect(host.querySelector('.turn-activity')).toBeNull()
  })

  it('renders the composer disabled reason from the real gate', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderSpeechSurface(
        { messages: [], turnActivity: { state: 'idle' } },
        {
          agentHandle: 'learner-1',
          value: '',
          disabledReason: 'no active session is open',
        },
      ),
      host,
    )

    expect(host.querySelector<HTMLInputElement>('.composer-input')?.disabled).toBe(true)
    expect(host.querySelector('.composer-disabled-reason')?.textContent).toBe('no active session is open')
  })
})

describe('renderBayStrip', () => {
  it('renders identity, state, model testimony, as-of, and the count metric with their kinds', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderBayStrip(
        buildBayStrip({
          id: 'agent-1',
          name: 'learner-1',
          lifecycle: 'resident',
          model: 'deepseek-v4-pro',
          asOf: NOW - 9_000,
          sessionCount: 23,
          now: NOW,
        }),
        { now: NOW },
      ),
      host,
    )

    expect(host.querySelector('[data-kind="identity"]')?.textContent).toBe('learner-1')
    expect(host.querySelector('[data-kind="state"]')?.textContent).toBe('resident')
    expect(host.querySelector('[data-kind="testimony"]')?.textContent).toContain('deepseek-v4-pro')
    expect(host.querySelector('.gh-asof')?.textContent).toContain('9s ago')
    expect(host.querySelector('[data-kind="metric"] .mn-kind-value')?.textContent).toBe('23')
    expect(host.querySelector('[data-kind="metric"] .mn-kind-unit')?.textContent).toBe('conversations')
    expect(host.querySelector('.gh-dot')?.classList.contains('gh-dot-live')).toBe(true)
  })

  it('draws an unattested lifecycle as a dashed, pulsing, named unknown — never a zero metric', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderBayStrip(
        buildBayStrip({ id: 'a', name: 'shrubbery-2', lifecycle: null, sessionCount: 0, asOf: NOW, now: NOW }),
        { now: NOW },
      ),
      host,
    )

    const dot = host.querySelector('.gh-dot')
    expect(dot?.classList.contains('gh-dot-unknown')).toBe(true)
    expect(dot?.classList.contains('gh-dot-pulse')).toBe(true)
    expect(host.querySelector('[data-kind="state"]')?.textContent).toBe('unknown — no lifecycle attested')
    // No sessions → no metric node at all (the ink clause on badges).
    expect(host.querySelector('[data-kind="metric"]')).toBeNull()
  })

  it('hooks by name through its callback', () => {
    const host = document.createElement('div')
    document.body.append(host)
    let hooked: string | null = null

    render(
      greenhouseApp.renderBayStrip(buildBayStrip({ id: 'agent-1', name: 'learner-1', lifecycle: 'resident', now: NOW }), {
        now: NOW,
        onHook: (id) => (hooked = id),
      }),
      host,
    )
    host.querySelector<HTMLButtonElement>('.gh-strip-hook')?.click()

    expect(hooked).toBe('agent-1')
  })
})

describe('renderConversationRow', () => {
  it('titles a row from its objective and carries its message count and last-seen', () => {
    const host = document.createElement('div')
    document.body.append(host)

    render(
      greenhouseApp.renderConversationRow(
        buildConversationRow({
          sessionId: 'ags_1',
          objective: 'greenhouse smoke turn 1783285239',
          messageCount: 2,
          lastMessageAt: NOW - 60_000,
          activeSessionId: 'ags_1',
        }),
        { now: NOW },
      ),
      host,
    )

    expect(host.querySelector('[data-kind="reference"] .mn-kind-link')?.textContent).toBe('greenhouse smoke turn 1783285239')
    expect(host.querySelector('.gh-conv-live')?.textContent).toBe('active')
    expect(host.querySelector('.gh-conv-meta')?.textContent).toContain('2 messages')
    expect(host.querySelector('.gh-conv-meta')?.textContent).toContain('last 1m ago')
    expect(host.querySelector('.gh-conv-untitled')).toBeNull()
  })

  it('falls back to the session id in mono for a null objective, in silence — no dash, no "0 messages"', () => {
    const host = document.createElement('div')
    document.body.append(host)
    let entered: string | null = null

    render(
      greenhouseApp.renderConversationRow(
        buildConversationRow({ sessionId: 'ags_86df518eca8b145e7eb5', objective: null, messageCount: 0, lastMessageAt: null }),
        { now: NOW, onEnter: (conversation) => (entered = conversation.sessionId) },
      ),
      host,
    )

    expect(host.querySelector('.gh-conv-untitled')?.textContent).toBe('ags_86df518eca8b145e7eb5')
    expect(host.querySelector('[data-kind="reference"]')).toBeNull()
    expect(host.querySelector('.gh-conv-live')).toBeNull()
    expect(host.querySelector('.gh-conv-meta')?.textContent?.trim()).toBe('')
    expect(host.textContent).not.toContain('0 message')

    host.querySelector<HTMLButtonElement>('.gh-conv')?.click()
    expect(entered).toBe('ags_86df518eca8b145e7eb5')
  })
})

describe('the watermark and the brief', () => {
  const LEFT = NOW - 23 * 60_000
  const turn = (seq: number, over: Record<string, unknown> = {}) => ({
    seq,
    ts: LEFT + seq * 1000,
    type: 'conversation.turn.completed',
    payload: { turnId: `awt_${seq}`, state: 'done', responseMessageId: `msg-${seq}`, tokens: 700, ...over },
  })

  it('THE STRICT TEST — an uneventful absence produces ZERO brief DOM (absence, not emptiness)', () => {
    const brief = buildTurnoverBrief({ events: [], selfClientId: 'vehicle-web', leftAt: LEFT, now: NOW })
    expect(brief.eventful).toBe(false)

    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderTurnoverBrief(brief), host)

    // No brief block exists at all — the DOM is empty, not an empty container.
    expect(host.querySelector('.gh-brief')).toBeNull()
    expect(host.querySelector('.gh-brief-line')).toBeNull()
    expect(host.querySelector('.gh-brief-head')).toBeNull()
    expect(host.textContent?.trim()).toBe('')
  })

  it('the watermark rule renders in EVERY return — "quiet since" when uneventful', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderWatermarkRule(LEFT, false), host)
    expect(host.querySelector('.gh-watermark')).not.toBeNull()
    expect(host.querySelector('.gh-watermark span')?.textContent).toContain('you left here')
    expect(host.querySelector('.gh-watermark span')?.textContent).toContain('quiet since')

    const host2 = document.createElement('div')
    document.body.append(host2)
    render(greenhouseApp.renderWatermarkRule(LEFT, true), host2)
    expect(host2.querySelector('.gh-watermark span')?.textContent).toContain('you left here')
    expect(host2.querySelector('.gh-watermark span')?.textContent).not.toContain('quiet since')
  })

  it('an eventful brief draws the block, tiers in order, and the reply hand-off affordance', () => {
    const brief = buildTurnoverBrief({
      events: [
        turn(1),
        turn(2),
        turn(3),
        { seq: 4, ts: LEFT + 4000, type: 'conversation.turn.completed', payload: { turnId: 'x', state: 'error', reason: 'recall timed out after 30s' } },
      ],
      selfClientId: 'vehicle-web',
      leftAt: LEFT,
      now: NOW,
      previousWatchTokens: 1200,
    })
    const host = document.createElement('div')
    document.body.append(host)
    let read: string | null = null
    render(greenhouseApp.renderTurnoverBrief(brief, { onReadReply: (id) => (read = id) }), host)

    expect(host.querySelector('.gh-brief')).not.toBeNull()
    // Anomaly holds the top and is the only danger ink.
    const lines = [...host.querySelectorAll('.gh-brief-line')]
    expect(lines[0]?.getAttribute('data-tier')).toBe('anomaly')
    expect(lines[0]?.querySelector('.gh-lead')?.textContent).toContain('1 turn failed')
    // Activity turns line hands off below and carries "read it".
    const turns = lines.find((line) => line.textContent?.includes('turns'))
    expect(turns?.getAttribute('data-tier')).toBe('activity')
    expect(turns?.textContent).toContain('latest reply waits below')
    // The whisper carries the Vincennes trend — never a naked past.
    const whisper = lines.find((line) => line.getAttribute('data-tier') === 'whisper')
    expect(whisper?.textContent).toContain('tokens this absence')
    expect(whisper?.querySelector('.up')).not.toBeNull()

    host.querySelector<HTMLButtonElement>('.gh-aff')?.click()
    expect(read).toBe('msg-3')
  })

  it('the bay strip earns a danger anomaly chip and a quiet count chip', () => {
    const strip = buildBayStrip({ id: 'a', name: 'learner-1', lifecycle: 'paused', sessionCount: 5, now: NOW })
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderBayStrip(strip, { now: NOW, newSince: 2, anomaly: 1 }), host)
    expect(host.querySelector('.gh-chip.alarm')?.textContent).toContain('1 unanswered permission')
    expect(host.querySelector('.gh-chip.quiet')?.textContent).toContain('2 new')

    // No chips when nothing changed — a badge zone with nothing to say shows nothing.
    const host2 = document.createElement('div')
    document.body.append(host2)
    render(greenhouseApp.renderBayStrip(strip, { now: NOW, newSince: null, anomaly: null }), host2)
    expect(host2.querySelector('.gh-chip')).toBeNull()
  })
})

describe('buildPaletteRows — the palette owns no state but its query', () => {
  const agents = [
    { agentId: 'agent-learner', handle: 'learner-1', lifecycle: 'resident' },
    { agentId: 'agent-harm', handle: 'harmonizer-1', lifecycle: 'paused' },
  ] as unknown as Parameters<typeof greenhouseApp.buildPaletteRows>[0]['agents']
  const sessions = new Map<string, readonly { sessionId: string; objective?: string | null }[]>([
    [
      'agent-learner',
      [
        { sessionId: 's-1', objective: 'greenhouse smoke turn 1783215419' },
        { sessionId: 's-2', objective: 'the long smoke ledger' },
      ],
    ],
    ['agent-harm', [{ sessionId: 's-3', objective: 'harmonizer trace review' }]],
  ]) as unknown as Parameters<typeof greenhouseApp.buildPaletteRows>[0]['sessionsByAgent']

  it('a name match surfaces the agent and ALL its conversations (folio 05·A)', () => {
    const rows = greenhouseApp.buildPaletteRows({ agents, sessionsByAgent: sessions, query: 'lear' })
    expect(rows.map((row) => row.kind)).toEqual(['agent', 'conversation', 'conversation'])
    expect(rows[0]).toMatchObject({ kind: 'agent', agentId: 'agent-learner' })
    // The second conversation never contains "lear" — a name match brings all of them.
    expect(rows[2]).toMatchObject({ kind: 'conversation' })
    expect(rows.some((row) => row.agentId === 'agent-harm')).toBe(false)
  })

  it('a conversation-title match surfaces the agent with only the matching conversation', () => {
    const rows = greenhouseApp.buildPaletteRows({ agents, sessionsByAgent: sessions, query: 'ledger' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'agent', agentId: 'agent-learner' })
    expect(rows[1]).toMatchObject({ kind: 'conversation', agentId: 'agent-learner' })
  })

  it('an empty query lists every resident with its conversations, in roster order (recents)', () => {
    const rows = greenhouseApp.buildPaletteRows({ agents, sessionsByAgent: sessions, query: '' })
    expect(rows.map((row) => row.kind)).toEqual(['agent', 'conversation', 'conversation', 'agent', 'conversation'])
    expect(rows[0]).toMatchObject({ agentId: 'agent-learner' })
    expect(rows[3]).toMatchObject({ agentId: 'agent-harm' })
  })

  it('a query that matches nothing yields an empty list', () => {
    expect(greenhouseApp.buildPaletteRows({ agents, sessionsByAgent: sessions, query: 'zzz' })).toEqual([])
  })
})

describe('palette selection wash — selection is one idea everywhere', () => {
  it('a selected strip and a selected conversation both wear gh-row-selected', () => {
    const strip = buildBayStrip({ id: 'a', name: 'learner-1', lifecycle: 'resident', sessionCount: 2, now: NOW })
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderBayStrip(strip, { now: NOW, selected: true }), host)
    expect(host.querySelector('.gh-strip')?.classList.contains('gh-row-selected')).toBe(true)

    const conversation = buildConversationRow({ sessionId: 's-1', objective: 'a titled conversation', activeSessionId: null })
    const host2 = document.createElement('div')
    document.body.append(host2)
    render(greenhouseApp.renderConversationRow(conversation, { now: NOW, selected: true }), host2)
    expect(host2.querySelector('.gh-conv')?.classList.contains('gh-row-selected')).toBe(true)
    // Unselected wears nothing.
    const host3 = document.createElement('div')
    document.body.append(host3)
    render(greenhouseApp.renderConversationRow(conversation, { now: NOW }), host3)
    expect(host3.querySelector('.gh-conv')?.classList.contains('gh-row-selected')).toBe(false)
  })
})

// The CONSTITUTION stance — the recognition card and the re-sentenced bay (folio 02).

const LEARNER_WORLD = {
  agent: {
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    agentType: 'learner-1',
    kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    graphId: 'vehicle-local',
  },
  status: { lifecycle: 'completed', model: 'deepseek-v4-pro' },
  prompts: {
    system: {
      title: 'Learner 1 System Prompt',
      text: 'You are learner-1, a Sophia-standard learning agent.\n\nTreat memory as witnessed testimony.',
      digest: '420f2c09dcc06a83b24720f6ae59a0a42a9c5d2d4e75a01e330060d6ebb21f3a',
      source: { externalId: 'agent-prompt-learner-1-system' },
      document: { documentId: 'agent-prompt-learner-1-system', snapshotId: 'aps_45b3dbcfcd9990bb', dirty: false },
      binding: { documentId: 'agent-prompt-learner-1-system', activeFrom: NOW - 2 * 86_400_000 },
    },
  },
  toolbelt: {
    tools: [
      { name: 'recall', available: true, required: true },
      { name: 'remember', available: true, required: true },
      { name: 'search_documents', available: true, required: true },
    ],
  },
}

function learnerCard() {
  return buildAgentCard({
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    agentType: 'learner-1',
    graphId: 'vehicle-local',
    kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    lifecycle: 'completed',
    sessionCount: 32,
    worldDoc: LEARNER_WORLD,
  })
}

/**
 * The same live learner-1 world, but with `document.compatibilitySeeded: true` — the
 * exact field choreograph serves (`agent-world.ts:1327`) when this agent's model/
 * charter fell back to hardcoded in-code constants because the graph read failed.
 */
function learnerCardSeeded() {
  return buildAgentCard({
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    agentType: 'learner-1',
    graphId: 'vehicle-local',
    kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    lifecycle: 'completed',
    sessionCount: 32,
    worldDoc: {
      ...LEARNER_WORLD,
      prompts: {
        system: {
          ...LEARNER_WORLD.prompts.system,
          document: { ...LEARNER_WORLD.prompts.system.document, compatibilitySeeded: true },
        },
      },
    },
  })
}

describe('renderAgentMark — the deterministic botanical portrait', () => {
  it('paints the team color and carries the VRM awaits-chip (the atelier ground)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const mark = agentMark('agent-132c2f7244ec645b')
    render(greenhouseApp.renderAgentMark(mark), host)
    const zone = host.querySelector('.c2-mark') as HTMLElement
    expect(zone).not.toBeNull()
    expect(zone.getAttribute('style')).toContain(mark.color)
    expect(host.querySelector('svg')).not.toBeNull()
    const chip = host.querySelector('.vrm-chip')
    expect(chip?.textContent).toContain('awaits the atelier')
  })
})

describe('renderAgentCard — the recognition card, fixed zones', () => {
  it('renders the mark, plate, kindline, and the same section order every time', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    expect(host.querySelector('.c2-mark')).not.toBeNull()
    expect(host.querySelector('.gh-card-head .gh-name')?.textContent).toContain('learner-1')
    expect(host.querySelector('.gh-card-sub')?.textContent).toContain('agent-132c2f…45b')
    expect(host.querySelector('.gh-kindline')?.textContent).toContain('Sophia-standard learner')
    const eyebrows = [...host.querySelectorAll('.gh-card-eyebrow')].map((n) => n.textContent?.trim())
    expect(eyebrows[0]).toBe('lineage')
    expect(eyebrows[1]).toBe('envelope')
    expect(eyebrows[2]).toBe('loadout')
    expect(eyebrows[3]).toBe('service record')
    expect(eyebrows[4]).toContain('charter')
  })

  it('states the loadout from testimony (3 of 3) and the clean charter binding', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    expect(host.textContent).toContain('recall · remember · search_documents')
    expect(host.querySelector('.gh-card-metric .mn-kind-value')?.textContent).toBe('3')
    expect(host.textContent).toContain('agent-prompt-learner-1-system')
    expect(host.textContent).toContain('clean')
  })

  it('renders the real charter text READ-ONLY with the hoja foot (no bare input)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    const doc = host.querySelector('.gh-charter-doc')
    expect(doc?.textContent).toContain('Sophia-standard learning agent')
    // Read-only: no input/textarea anywhere in the charter pane.
    expect(host.querySelector('.gh-card-charter input, .gh-card-charter textarea')).toBeNull()
    expect(host.querySelector('.gh-charter-hoja')?.textContent).toContain('editing arrives with hoja')
    expect(host.textContent).toContain('digest 420f2c…')
  })

  it('marks every unbuilt rollup with its ° awaits chip — never a fabricated number', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    const chips = [...host.querySelectorAll('.chip-await')].map((n) => n.textContent).join(' ')
    expect(chips).toContain('K4') // envelope surface
    expect(chips).toContain('K1') // career rollup
    expect(chips).toContain('K3') // incidents
    // conversations is served, so it appears as a real metric, not a chip.
    expect(host.textContent).toContain('conversations')
  })

  it('renders model attribution only when witnessed (learner-1 has none served)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    expect(host.textContent).toContain('deepseek-v4-pro')
    expect(host.textContent).not.toContain('set by')
  })
})

describe('renderAgentCardDesk — the desktop composition (folio 02, #desk-card)', () => {
  it('lays the same recognition object as the desk grid: identity column, stat matrix, instruments, charter pane', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCardDesk(learnerCard(), { now: NOW }), host)
    expect(host.querySelector('.desk-cardgrid')).not.toBeNull()
    // identity column: the enlarged mark, the plate, the kind line
    expect(host.querySelector('.c2-mark-desk')).not.toBeNull()
    expect(host.querySelector('.c2-plate .nm')?.textContent).toContain('learner-1')
    expect(host.querySelector('.c2-plate .sub')?.textContent).toContain('agent-132c2f…45b')
    expect(host.querySelector('.c2-kind')?.textContent).toContain('Sophia-standard learner')
    // the six-cell stat matrix
    expect(host.querySelectorAll('.desk-stats .c2-stat')).toHaveLength(6)
    // the charter as an embedded read-only document pane
    expect(host.querySelector('.hoja-embed')).not.toBeNull()
    expect(host.querySelector('.hoja-doc')?.textContent).toContain('Sophia-standard learning agent')
  })

  it('draws only instruments with served data — the loadout stations and the lineage node', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCardDesk(learnerCard(), { now: NOW }), host)
    // loadout stations: the real toolbelt instrument draws (its dynamic dots are proven
    // by the pure layout test + the live browser; happy-dom cannot render dynamic SVG).
    expect(host.querySelector('svg.stations')).not.toBeNull()
    expect(host.querySelector('.desk-insts')?.textContent).toContain('loadout · 3 of 3 mounted')
    // lineage: the current binding's promotion is served; the chain draws one now-node
    expect(host.querySelector('svg.chain circle.now')).not.toBeNull()
    // no fabricated activity/burn sparklines exist — the only sparks would be fake data
    expect(host.querySelector('.spark')).toBeNull()
  })

  it('loadoutStationLayout — a lit dot per served tool, on/off from real availability', () => {
    const dots = greenhouseApp.loadoutStationLayout(learnerCard().loadout)
    expect(dots.map((dot) => dot.name)).toEqual(['recall', 'remember', 'search_documents'])
    expect(dots.every((dot) => dot.on)).toBe(true)
    // evenly spaced across the rail, in manifest order
    expect(dots[0].x).toBeLessThan(dots[1].x)
    expect(dots[1].x).toBeLessThan(dots[2].x)
    // a required-but-missing tool reads as a hollow (off) station — a hung store
    const hung = greenhouseApp.loadoutStationLayout(
      buildAgentCard({ agentId: 'a', worldDoc: { toolbelt: { tools: [{ name: 'graph_write', available: false, required: true }] } } }).loadout,
    )
    expect(hung[0].on).toBe(false)
  })

  it('marks awaited K-data with ° and never invents a number (stat matrix + envelope ward)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCardDesk(learnerCard(), { now: NOW }), host)
    // conversations is served → a real metric, not a chip
    expect(host.querySelector('.desk-stats .mn-kind-value')?.textContent).toBe('32')
    // career turns / tokens / incidents are unbuilt rollups → ° awaits marks, no numbers
    const awaits = [...host.querySelectorAll('.desk-stats .await')].map((n) => n.textContent)
    expect(awaits.length).toBeGreaterThanOrEqual(3)
    // the ward is not attested in the world doc → the K4 chip, not an invented V-n bar
    expect(host.querySelector('.desk-insts .chip-await')?.textContent).toContain('K4')
    // there is no fabricated career number anywhere in the matrix
    expect(host.querySelector('.desk-stats')?.textContent).not.toContain('185')
  })

  it('renders the charter READ-ONLY with the drift head and the hoja foot (no bare input)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCardDesk(learnerCard(), { now: NOW }), host)
    expect(host.querySelector('.hoja-embed input, .hoja-embed textarea')).toBeNull()
    expect(host.querySelector('.hoja-drift')?.textContent).toContain('clean')
    expect(host.querySelector('.hoja-foot-note')?.textContent).toContain('editing arrives with hoja')
    expect(host.querySelector('.hoja-foot')?.textContent).toContain('digest 420f2c…')
    expect(host.querySelector('.hoja-foot')?.textContent).toContain('snapshot aps_45b3dbcfcd9990bb')
  })
})

describe('renderAgentCard / renderAgentCardDesk — phosphor honesty for a compatibility-seeded charter', () => {
  it('renderAgentCard names the degraded state in the amber drift register, not danger red, not "clean"', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCardSeeded(), { now: NOW }), host)
    const word = host.querySelector('.drift-word')
    expect(word?.textContent).toBe('fallback identity — graph unread')
    expect(word?.getAttribute('title')).toContain('graph read failed')
    expect(host.querySelector('.alarm-word')).toBeNull() // never danger red for a degraded (not error) state
    expect(host.textContent).not.toContain('edited, not promoted')
    // the row still reads "clean" nowhere — seeded overrides both the clean and dirty words
    const promptStateRow = [...host.querySelectorAll('.gh-card-row')].find(
      (row) => row.querySelector('.k')?.textContent === 'prompt state',
    )
    expect(promptStateRow?.textContent).not.toContain('clean')
  })

  it('renderAgentCardDesk names the same degraded state in the charter pane head (hoja-drift)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCardDesk(learnerCardSeeded(), { now: NOW }), host)
    const word = host.querySelector('.hoja-drift .drift-word')
    expect(word?.textContent).toBe('fallback identity — graph unread')
  })

  it('a non-seeded card is byte-identical to before: no degraded word, the "clean" node is unchanged', () => {
    const host = document.createElement('div')
    document.body.append(host)
    render(greenhouseApp.renderAgentCard(learnerCard(), { now: NOW }), host)
    expect(host.textContent).not.toContain('fallback identity')
    expect(host.textContent).not.toContain('graph unread')
    expect(host.querySelectorAll('.drift-word')).toHaveLength(0)
    expect(host.querySelector('.gh-card-row .mn-kind[data-kind="state"]')?.textContent?.trim()).toBe('clean')

    const deskHost = document.createElement('div')
    document.body.append(deskHost)
    render(greenhouseApp.renderAgentCardDesk(learnerCard(), { now: NOW }), deskHost)
    expect(deskHost.textContent).not.toContain('fallback identity')
    expect(deskHost.querySelector('.hoja-drift')?.textContent).toContain('clean')
    expect(deskHost.querySelectorAll('.drift-word')).toHaveLength(0)
  })
})

describe('renderConstitutionStrip — the bay re-sentenced (sheet 10)', () => {
  it('a clean strip carries no drift chip and speaks binding · prompt · loadout', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const strip = buildConstitutionStrip({ id: 'agent-132c2f7244ec645b', identity: 'learner-1', card: learnerCard(), now: NOW })
    render(greenhouseApp.renderConstitutionStrip(strip), host)
    expect(host.querySelector('.gh-statewords')?.textContent).toBe('binding stable 2d · prompt clean · loadout 3/3')
    expect(host.querySelector('.gh-chip.drift')).toBeNull()
  })

  it('an edited-not-promoted, hung-store strip raises Constitution amber drift', () => {
    const driftedCard = buildAgentCard({
      agentId: 'harmonizer-1',
      lifecycle: 'paused',
      worldDoc: {
        prompts: { system: { document: { dirty: true } } },
        toolbelt: {
          tools: [
            { name: 'recall', available: true, required: true },
            { name: 'surface', available: true, required: true },
            { name: 'graph_write', available: false, required: true },
          ],
        },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const strip = buildConstitutionStrip({ id: 'harmonizer-1', identity: 'harmonizer-1', card: driftedCard, now: NOW })
    render(greenhouseApp.renderConstitutionStrip(strip), host)
    const chip = host.querySelector('.gh-chip.drift')
    expect(chip?.textContent).toContain('drift ×2')
    expect(host.querySelector('.gh-statewords')?.textContent).toContain('graph_write hung')
  })

  it('a strip with no held world speaks the honest reduced sentence, not invented facts', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const strip = buildConstitutionStrip({ id: 'shrubbery-2', identity: 'shrubbery-2', card: null, lifecycle: 'dormant', now: NOW })
    render(greenhouseApp.renderConstitutionStrip(strip), host)
    expect(host.querySelector('.gh-statewords')?.textContent).toContain('constitution unread')
    expect(host.querySelector('.gh-chip.drift')).toBeNull()
    expect(host.querySelector('.gh-strip')?.classList.contains('gh-strip-unattested')).toBe(true)
  })
})

describe('the master switch — the stance re-weights the same cockpit (mounted)', () => {
  function stanceStore() {
    const read = {
      screen: 'ready' as const,
      agents: [
        { agentId: 'agent-132c2f7244ec645b', handle: 'learner-1', agentType: 'learner-1', graphId: 'vehicle-local', lifecycle: 'completed', sessionCount: 32 },
      ],
      selectedAgentId: 'agent-132c2f7244ec645b',
      world: { agent: {}, worldDoc: LEARNER_WORLD, agentVisiblePacket: null, session: null, run: null },
      events: [],
      cursor: -1,
      attestedMessages: [],
    }
    const state = { status: 'ready' as const, read, error: null, capturedAt: NOW }
    return {
      get: () => state,
      getState: () => state,
      subscribe: () => () => {},
      refresh: async () => {},
      openAgent: async () => {},
      refreshRoster: async () => {},
      loadAgentSessions: async () => [],
      loadSessionMessages: async () => [],
      loadAgentConstitution: async () => ({ incidents: [], bindings: [] }),
      constitutionFor: () => null,
      pollWorld: async () => {},
      setAgentModel: async () => {},
      claimFloor: async () => {},
      releaseFloor: async () => {},
      steerFloor: async () => {},
      sendMessage: async () => true,
      startPoll: () => () => {},
      stopPoll: () => {},
    } as unknown as GreenhouseStore
  }

  it('lights the annunciator and ⌘3 flips the bay to constitutional weather; ⌘1 flips back', async () => {
    const app = document.createElement('greenhouse-app') as InstanceType<typeof greenhouseApp.GreenhouseApp>
    app.store = stanceStore()
    document.body.append(app)
    await app.updateComplete

    // The annunciator is lit (a second stance ships) and reads ROOM.
    const annunciator = app.renderRoot.querySelector('.gh-annunciator')
    expect(annunciator?.textContent?.trim()).toBe('ROOM')
    // Room bay: a count-chip strip, not a constitution sentence.
    expect(app.renderRoot.querySelector('.gh-strip .mn-kind[data-kind="metric"]')).not.toBeNull()

    // ⌘3 — flip to CONSTITUTION. Nothing navigated; the bay re-sentenced.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true, bubbles: true }))
    await app.updateComplete
    expect(app.getAttribute('data-stance')).toBe('constitution')
    expect(app.renderRoot.querySelector('.gh-annunciator')?.textContent?.trim()).toBe('CONSTITUTION')
    expect(app.renderRoot.querySelector('.gh-annunciator')?.getAttribute('data-stance')).toBe('constitution')
    // The re-sentenced strip speaks identity (prompt clean), and Room's count chip is gone.
    expect(app.renderRoot.querySelector('.gh-strip .gh-statewords')?.textContent).toContain('prompt clean')
    expect(app.renderRoot.querySelector('.gh-strip .mn-kind[data-kind="metric"]')).toBeNull()

    // ⌘1 — back to ROOM. The count-chip strip returns.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true }))
    await app.updateComplete
    expect(app.getAttribute('data-stance')).toBe('room')
    expect(app.renderRoot.querySelector('.gh-strip .mn-kind[data-kind="metric"]')).not.toBeNull()
  })

  it('the annunciator is itself the switch — clicking it cycles the stance', async () => {
    const app = document.createElement('greenhouse-app') as InstanceType<typeof greenhouseApp.GreenhouseApp>
    app.store = stanceStore()
    document.body.append(app)
    await app.updateComplete

    app.renderRoot.querySelector<HTMLButtonElement>('.gh-annunciator')?.click()
    await app.updateComplete
    expect(app.getAttribute('data-stance')).toBe('constitution')
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-annunciator')?.click()
    await app.updateComplete
    expect(app.getAttribute('data-stance')).toBe('room')
  })

  it('entering a room under CONSTITUTION lands on the card, not the conversation (hook inherits stance)', async () => {
    const app = document.createElement('greenhouse-app') as InstanceType<typeof greenhouseApp.GreenhouseApp>
    app.store = stanceStore()
    document.body.append(app)
    await app.updateComplete

    // Flip to constitution, then hook the strip.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true, bubbles: true }))
    await app.updateComplete
    app.renderRoot.querySelector<HTMLButtonElement>('.gh-strip-hook')?.click()
    await flushApp(app)

    // We arrive at the card (its zones), not the composer.
    expect(app.renderRoot.querySelector('.gh-card')).not.toBeNull()
    expect(app.renderRoot.querySelector('.gh-charter-hoja')?.textContent).toContain('editing arrives with hoja')
    expect(app.renderRoot.querySelector('.gh-composer')).toBeNull()
  })
})
