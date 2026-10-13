/**
 * The hosted chat in the empowered-chat release, against a scripted Choreograph over a real socket
 * (NO MOCKS). Design: `private-notes/2026-10-05-empowered-chat/DESIGN-empowered-chat.md` §10.
 *
 *  1. What a turn changed survives a reload. The durable session record keeps each tool call's name
 *     and outcome (and, from this release, an id-only receipt of what a write touched); the hydrated
 *     conversation rebuilds every reply's tool calls from it. Before, it rebuilt text only and the
 *     chips vanished on reload and on the next turn (the store re-seeds from `hydrateSession`).
 *  2. What the person has open travels with every turn as `contextRefs` (the open document, and the
 *     focused block as `doc#block`); the SPA used to send `[]`.
 *  3. What the chat may do here: by the person's role and what the host advertises, and for a
 *     conversation already under way by the mode its own record says it was bound to.
 */
import type { ChatEvent, ChatMessage } from '@shrubbery/chat-kernel'
import { turnChangesOf } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatWorkspaceRole } from '../chat-service.js'
import { makeHostedChatService } from '../hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  delta,
  durableToolCompleted,
  durableToolStarted,
  plainTurn,
  started,
  turnDone,
  workspaceWorkflow,
  type TurnScript,
} from './fixtures/choreograph-sim.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'writes-qa-20261006'
/** `workspace-chat-v1` as the reader-only release served it (Choreograph efc3d64, live 10-05; FINDINGS). */
const READER_ONLY_DIGEST = '1855ba904ada0de02fdbd12fe2b69410adbe88316a3d809da9ca7559f294eef0'
/** `workspace-chat-v1` as the empowered release serves it (Choreograph cad0507, RETURN.md). */
const EMPOWERED_DIGEST = '5a9e54bc641a8754db4aeb822454670e6aec9865564763f71b4b68d68fb540c4'
const WRITER = 'urn:sophia:mode:workspace-writer'
const READER = 'urn:sophia:mode:workspace-reader'
const ACCESS = { owner: 'write', editor: 'write', viewer: 'read' }

interface Options {
  readonly contextRefs?: () => readonly string[]
  readonly role?: () => ChatWorkspaceRole | null
}

function chatOver(sim: ChoreographSim, storage: MemoryStorage, options: Options = {}) {
  return makeHostedChatService({
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => GRAPH,
    userId: () => 'probe',
    token: () => 'jwt',
    storage,
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
    ...options,
  })
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof chatOver>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

function writingTurn(answer: string, calls: readonly [string, readonly Record<string, unknown>[] | undefined, boolean?][]): TurnScript {
  return {
    answer,
    stages: [[
      started(),
      ...calls.flatMap(([tool, targets, refused]) => [durableToolStarted(tool, targets), durableToolCompleted(tool, targets, refused === true)]),
      delta(answer),
      turnDone(),
      completed(answer),
    ]],
  }
}

const replies = (messages: readonly ChatMessage[]) => messages.filter(message => message.role === 'assistant')

describe('what a turn changed survives a reload', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('carries the host\'s id-only receipt onto the live tool calls', async () => {
    sim.queueTurn(writingTurn('Edited the plan.', [['write_document', [{ kind: 'document', id: 'plan' }]]]))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    const turn = await collect(await chat.startTurn(created.id, 'Tighten the plan.'))
    const call = turn.events.find(event => event.type === 'tool_call')
    const result = turn.events.find(event => event.type === 'tool_result')
    expect(call).toMatchObject({ type: 'tool_call', gate: 'write_document', metadata: { targets: [{ kind: 'document', id: 'plan' }] } })
    expect(result).toMatchObject({ type: 'tool_result', gate: 'write_document', is_error: false, metadata: { targets: [{ kind: 'document', id: 'plan' }] } })
  })

  it('rebuilds every reply\'s tool calls from the record: the first turn\'s and a follow-up\'s, on a fresh load too', async () => {
    sim.queueTurn(writingTurn('Edited the plan.', [
      ['read_document', undefined],
      ['write_document', [{ kind: 'document', id: 'plan' }]],
    ]))
    sim.queueTurn(writingTurn('Deleted it, and its history with it.', [
      ['delete_document', [{ kind: 'document', id: 'old-notes' }]],
      ['insert_blocks', [{ kind: 'document', id: 'locked' }], true],
    ]))
    const storage = new MemoryStorage()
    const chat = chatOver(sim, storage)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Tighten the plan.'))
    await collect(await chat.startTurn(created.id, 'Delete the old notes.'))

    for (const service of [chat, chatOver(sim, storage)]) {
      const [first, second] = replies((await service.hydrateSession(created.id)).messages)
      expect(first.content).toBe('Edited the plan.')
      expect(first.toolCalls.map(call => [call.tool, call.status])).toEqual([
        ['read_document', 'completed'],
        ['write_document', 'completed'],
      ])
      expect(first.parts.filter(part => part.type === 'tool')).toHaveLength(2)
      expect(turnChangesOf(first.toolCalls).changes.map(change => [change.id, change.verbs])).toEqual([['plan', ['edited']]])

      expect(second.toolCalls.map(call => [call.tool, call.status])).toEqual([
        ['delete_document', 'completed'],
        ['insert_blocks', 'error'],
      ])
      const changes = turnChangesOf(second.toolCalls)
      expect(changes.changes.map(change => [change.id, change.removal])).toEqual([['old-notes', 'document']])
      expect(changes.refused).toBe(1)
    }
  })

  it('shows a call the record kept no receipt for by its name and outcome, and invents no target', async () => {
    sim.queueTurn(writingTurn('Done.', [['write_document', undefined]]))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Write something.'))
    const [reply] = replies((await chat.hydrateSession(created.id)).messages)
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0]).toMatchObject({ tool: 'write_document', status: 'completed', input: {} })
    expect(turnChangesOf(reply.toolCalls).changes.map(change => change.id)).toEqual([null])
  })

  it('leaves a reply that called no tool exactly as it was', async () => {
    sim.queueTurn(plainTurn('Nothing to change.'))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Hello.'))
    const [reply] = replies((await chat.hydrateSession(created.id)).messages)
    expect(reply.toolCalls).toEqual([])
    expect(reply.parts).toEqual([{ type: 'text', content: 'Nothing to change.' }])
  })
})

describe('what the person has open travels with every turn', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('sends the open document and the focused block on the first message, id-shaped only', async () => {
    const chat = chatOver(sim, new MemoryStorage(), { contextRefs: () => ['plan', 'plan#b7', 'not an id!', 'plan', ''] })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Summarize this document.'))
    const workspace = sim.invocations().find(call => call.body.target.workflowName === 'workspace-chat-v1')!
    expect(workspace.body.input.contextRefs).toEqual(['plan', 'plan#b7'])
  })

  it('sends what is open at each follow-up as the command\'s payload.contextRefs (the turn-part contract)', async () => {
    let open: string[] = ['plan']
    const chat = chatOver(sim, new MemoryStorage(), { contextRefs: () => open })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'First.'))
    open = ['notes', 'notes#intro']
    await collect(await chat.startTurn(created.id, 'And this one?'))
    const followUp = sim.calls('/commands', 'POST').find(call => call.body.name === 'follow_up')!
    expect(followUp.body.payload).toEqual({ text: 'And this one?', contextRefs: ['notes', 'notes#intro'] })
  })

  it('sends none when nothing is open, exactly as before', async () => {
    const chat = chatOver(sim, new MemoryStorage(), { contextRefs: () => [] })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'First.'))
    await collect(await chat.startTurn(created.id, 'Second.'))
    expect(sim.invocations().at(-1)!.body.input.contextRefs).toEqual([])
    expect(sim.calls('/commands', 'POST').find(call => call.body.name === 'follow_up')!.body.payload).toEqual({ text: 'Second.' })
  })

  it('sends nothing to a Domain Agent, whose definition fences its context (as before)', async () => {
    sim.provisioned.add(GRAPH)
    const chat = chatOver(sim, new MemoryStorage(), { contextRefs: () => ['plan'] })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'First.'))
    await collect(await chat.startTurn(created.id, 'Second.'))
    const launch = sim.invocations()[0]
    expect(launch.body.target.workflowName).toBe(DOMAIN_WORKFLOW.name)
    expect(launch.body.input.contextRefs).toEqual([])
    expect(sim.calls('/commands', 'POST').find(call => call.body.name === 'follow_up')!.body.payload).toEqual({ text: 'Second.' })
  })
})

describe('what the chat may do here', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('is not said until the host has been asked', () => {
    const chat = chatOver(sim, new MemoryStorage(), { role: () => 'editor' })
    expect(chat.access?.(null)).toBeNull()
  })

  it('a reader-only host: Sophia reads, whatever the role (an older backend renders as it is)', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, host: {}, definitionDigest: READER_ONLY_DIGEST })]
    const chat = chatOver(sim, new MemoryStorage(), { role: () => 'owner' })
    await chat.probeCapabilities?.()
    expect(chat.capabilities?.access ?? null).toBeNull()
    expect(chat.access?.(null)).toEqual({ mode: 'read', basis: 'backend', role: 'owner' })
  })

  it('a host that writes for owners and editors: by the person\'s role', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ host: { access: ACCESS } })]
    let role: ChatWorkspaceRole | null = 'editor'
    const chat = chatOver(sim, new MemoryStorage(), { role: () => role })
    await chat.probeCapabilities?.()
    expect(chat.capabilities?.access).toEqual(ACCESS)
    expect(chat.access?.(null)).toEqual({ mode: 'write', basis: 'role', role: 'editor' })
    role = 'owner'
    expect(chat.access?.(null)).toEqual({ mode: 'write', basis: 'role', role: 'owner' })
    role = 'viewer'
    expect(chat.access?.(null)).toEqual({ mode: 'read', basis: 'role', role: 'viewer' })
    role = null
    expect(chat.access?.(null)).toBeNull()
  })

  it('a conversation keeps the powers it began with: its own record says which', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ host: { access: ACCESS } })]
    let role: ChatWorkspaceRole | null = 'editor'
    const chat = chatOver(sim, new MemoryStorage(), { role: () => role })

    sim.sessionMode = READER
    const older = await chat.createSession()
    await collect(await chat.startTurn(older.id, 'Hello.'))
    expect(chat.access?.(older.id)).toEqual({ mode: 'read', basis: 'conversation', role: 'editor' })

    sim.sessionMode = WRITER
    const newer = await chat.createSession()
    await collect(await chat.startTurn(newer.id, 'Hello.'))
    expect(chat.access?.(newer.id)).toEqual({ mode: 'write', basis: 'conversation', role: 'editor' })

    // Demoted since: the person's role now says read (the cell refuses the writes either way).
    role = 'viewer'
    expect(chat.access?.(newer.id)).toEqual({ mode: 'read', basis: 'role', role: 'viewer' })
  })

  it('says nothing of a Domain Agent\'s conversation (its own definition decides)', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ host: { access: ACCESS } })]
    sim.provisioned.add(GRAPH)
    const chat = chatOver(sim, new MemoryStorage(), { role: () => 'editor' })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Hello.'))
    expect(chat.access?.(created.id)).toBeNull()
  })
})

describe('the empowered release as Choreograph cad0507 serves it (RETURN.md §4)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('before a chat: the person\'s role decides, on a host that is not the reader-only release', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, host: {}, definitionDigest: EMPOWERED_DIGEST })]
    let role: ChatWorkspaceRole | null = 'editor'
    const chat = chatOver(sim, new MemoryStorage(), { role: () => role })
    await chat.probeCapabilities?.()
    expect(chat.access?.(null)).toEqual({ mode: 'write', basis: 'role', role: 'editor' })
    role = 'viewer'
    expect(chat.access?.(null)).toEqual({ mode: 'read', basis: 'role', role: 'viewer' })
  })

  it('in a chat: the session document\'s own `source.graphAccess` decides', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ definitionDigest: EMPOWERED_DIGEST })]
    const chat = chatOver(sim, new MemoryStorage(), { role: () => 'owner' })
    sim.sessionGraphAccess = 'read'
    const reader = await chat.createSession()
    await collect(await chat.startTurn(reader.id, 'Hello.'))
    expect(chat.access?.(reader.id)).toEqual({ mode: 'read', basis: 'conversation', role: 'owner' })
    sim.sessionGraphAccess = 'write'
    const writer = await chat.createSession()
    await collect(await chat.startTurn(writer.id, 'Hello.'))
    expect(chat.access?.(writer.id)).toEqual({ mode: 'write', basis: 'conversation', role: 'owner' })
  })

  it('sends a follow-up\'s contextRefs only to a host that takes them; the first message\'s always', async () => {
    // The reader-only release would hand an unknown payload key to its worker verbatim (RETURN.md §5.5, unverified).
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ definitionDigest: READER_ONLY_DIGEST })]
    sim.sessionGraphAccess = 'read'
    const chat = chatOver(sim, new MemoryStorage(), { contextRefs: () => ['plan'] })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'First.'))
    await collect(await chat.startTurn(created.id, 'Second.'))
    expect(sim.invocations().at(-1)!.body.input.contextRefs).toEqual(['plan'])
    expect(sim.calls('/commands', 'POST').find(call => call.body.name === 'follow_up')!.body.payload).toEqual({ text: 'Second.' })
  })

  it('falls back to the workspace assistant on a 403 from the Domain Agent invocation, as on the 404 (a viewer\'s first try)', async () => {
    for (const refusal of [
      { status: 403, body: { error: { code: 'workflow_role_insufficient', message: 'viewers may start only workspace-chat-v1' } } },
      { status: 403, body: { error: 'Forbidden' } },
    ]) {
      sim.provisioned.add(GRAPH)
      sim.invocation = request => (request.body.target.workflowName === DOMAIN_WORKFLOW.name ? refusal : undefined)
      const chat = chatOver(sim, new MemoryStorage())
      const created = await chat.createSession()
      const turn = await collect(await chat.startTurn(created.id, 'Hello.'))
      expect(turn.outcome).toEqual({ state: 'completed' })
      const tried = sim.invocations().slice(-2).map(call => call.body.target.workflowName)
      expect(tried).toEqual([DOMAIN_WORKFLOW.name, 'workspace-chat-v1'])
    }
  })

  it('says a refused follow-up plainly when the person may no longer write here, and leaves nothing pending', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ definitionDigest: EMPOWERED_DIGEST })]
    sim.extraRoutes.push(request => (request.method === 'POST' && request.route.endsWith('/commands') && request.body?.name === 'follow_up'
      ? { status: 403, body: { error: { code: 'workspace_chat_role_changed', message: 'start a new chat to go on' } } }
      : undefined))
    const chat = chatOver(sim, new MemoryStorage(), { role: () => 'viewer' })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'First.'))
    const refused = await chat.startTurn(created.id, 'Second.').then(() => null, (error: unknown) => error)
    expect(refused).toMatchObject({ recovery: 'none' })
    expect(String((refused as Error).message)).toContain('Start a new chat')
    // Nothing is left half-sent: the next message is a fresh attempt, refused the same way, not "reconcile first".
    const again = await chat.startTurn(created.id, 'Third.').then(() => null, (error: unknown) => error)
    expect(String((again as Error).message)).toContain('Start a new chat')
  })
})
