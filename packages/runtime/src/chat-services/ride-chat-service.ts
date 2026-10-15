/**
 * ride-chat-service.ts — the chat over Vehicle's ride protocol v2 (`sophia.vehicle-ride.v2`), as a
 * self-hosted gardend serves it: `vehicle-host` supervised at `${origin}/services/vehicle`.
 *
 * The agent core (sophia `plans/2026-10-13-agent-core.md`, V2): a conversation is a ride session (a pi
 * session held by vehicle-host, its graph tools gardend's own MCP). gardend authenticates the page (the
 * self-host key, or the Cloudflare Access cookie), mints who calls and, for the graph-scoped path every URL
 * here takes (`/g/<graph>/sessions...`), the graph. The page never names a graph or a role in a body.
 *
 * The panel's needs, mapped onto the protocol:
 *   new conversation  POST /g/<graph>/sessions (the creating client takes the driver lease)
 *   send              claim once, then POST .../commands {op: "prompt"}
 *   send mid-reply    POST .../commands {op: "steer"} ({@link RideChatService.steer}; the store calls it)
 *   stop              POST .../commands {op: "abort"}
 *   stream            GET .../events with `Accept: text/event-stream` (gardend streams); long-poll
 *                     (`?since=&waitMs=`) when the stream cannot be had, resuming from the last cursor
 *   tool chips        `tool.started` / `tool.result` events
 *   conversation list GET /g/<graph>/sessions (the caller's own, newest first)
 *   reload            GET /g/<graph>/sessions/<id> (pi's transcript, each entry at pi's own time), lease
 *                     re-claimed by this browser
 *   rename            PATCH /g/<graph>/sessions/<id> {title} (kept by vehicle-host, so every browser sees it)
 *   delete            DELETE /g/<graph>/sessions/<id> (vehicle-host moves the record to its trash); the
 *                     conversation's document in the workspace (vehicle-host's mirror, `_sophia/Conversations`)
 *                     goes to the workspace's Trash with the person's own credential ({@link RideChatServiceOptions.trashDocument})
 *   branch            POST .../commands {op: "fork", entryId}: a new conversation with the history before one of
 *                     the person's messages, whose words go back in the composer ({@link RideChatService.branchSession})
 *   duplicate         POST .../commands {op: "clone"} ({@link RideChatService.duplicateSession})
 *   lineage           a branch's summary names its `parent`; the history says what it was branched from
 *   continue here     POST .../claim {takeover: true}: the same person's other browser had it
 *   follow            the open conversation's events while the page is visible: another browser taking it
 *                     over or deleting it, a reply another browser drove ({@link RideChatService.followSession})
 *
 * The lease unit is this browser (`x-vehicle-client-id`, kept in local storage), so a reload or a second tab
 * of the same person drives the same conversation. Another browser of the same person is offered "Continue
 * here", which takes the lease over (the other one then only shows the conversation); someone else's is never
 * taken (`lease_held`).
 */

import {
  type ChatEvent,
  type ChatMessage,
  type ChatModelOption,
  type ChatVoiceMark,
  type MessagePart,
  type SessionSummary,
  type ToolCall,
  uuid,
} from '@shrubbery/chat-kernel'
import {
  type ChatAccess,
  type ChatBranch,
  type ChatCapabilities,
  type ChatDriverState,
  type ChatFollowChange,
  type ChatService,
  ChatServiceFailure,
  type ChatTurnHandle,
  type ChatTurnOutcome,
  type ChatWorkspaceRole,
  type ConversationSummary,
  type CreateSessionOpts,
  type HydratedSession,
} from './chat-service.js'
import { isPlaceholderTitle } from './conversation-home.js'
import { parseSse } from './hosted-chat-service.js'

export const RIDE_PROTOCOL = 'sophia.vehicle-ride.v2'
/** pi names gardend's tools `mcp__<server>__<tool>`; the chips show the tool. */
const TOOL_PREFIX = /^mcp__[A-Za-z0-9_]+?__/
const GRAPH_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/
/** pi-sophia appends the ids the person had open to a turn; the transcript shows what the person wrote. */
const CONTEXT_NOTE = /\n\n\(Open in the person's view, by id: [^\n]*\)$/
const LONG_POLL_MS = 25_000
/** How long a turn waits for its event stream to open before it sends anyway. */
const WATCH_READY_MS = 3_000
const MAX_STREAM_RETRIES = 3
/** A followed conversation whose watch failed is watched again after this long, twice as long each time it fails again (at most a minute). */
const FOLLOW_RETRY_MS = 5_000
const FOLLOW_RETRY_MAX_MS = 60_000

type Fetch = typeof fetch
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RideChatServiceOptions {
  /** `${origin}/services/vehicle`: gardend's mount of vehicle-host, on this page's origin. */
  readonly baseUrl: string
  /** The conversation's graph: the workspace the shell is in. */
  readonly graphId: () => string | null
  /** The self-host key (key mode); undefined under Cloudflare Access, whose cookie travels same-origin. */
  readonly token: () => string | undefined
  /** The person's role here, for what a conversation not yet begun may do. */
  readonly role?: () => ChatWorkspaceRole | null
  /** What the person has open, sent with each turn as ids. */
  readonly contextRefs?: () => readonly string[]
  /** Slots, this browser's lease id and local titles. */
  readonly storage?: Storage | null
  readonly fetch?: Fetch
  /** Long-poll wait (tests shorten it). */
  readonly longPollMs?: number
  /**
   * Put a document in the workspace's Trash with the person's own credential (gardend's
   * `DELETE /navigation/<graph>/documents/<id>`): a deleted conversation's mirror document. Absent: it stays.
   */
  readonly trashDocument?: (graphId: string, documentId: string) => Promise<unknown>
  /**
   * The workspace changed under the shell: vehicle-host wrote a conversation's document (`mirror.written`, after a
   * reply settled), which the tree should show without a reload.
   */
  readonly onWorkspaceChanged?: (graphId: string) => void
  /**
   * Why chat cannot run on this Sophia, when it cannot (gardend's `/self-host.json` `reason` for an
   * `unavailable` service: no Node.js, or an old one). The panel says it where it says what the chat may do.
   */
  readonly unavailable?: () => string | null
}

/** A ride session as `GET /sessions` and `POST /sessions` describe it. */
interface RideSessionSummary {
  readonly sessionId: string
  readonly graphId: string
  readonly access: 'read' | 'write'
  readonly model: string
  readonly createdAt: string
  readonly updatedAt?: string
  readonly title?: string
  readonly preview?: string
  readonly status?: string
  readonly cursor?: number
  readonly lease?: { readonly clientId: string; readonly expiresAt?: string } | null
  /** A branch's source: `fork` (from before one of the person's messages) or `clone` (a duplicate). */
  readonly parent?: { readonly sessionId: string; readonly kind: 'fork' | 'clone'; readonly entryId?: string }
}

/** Who holds a conversation's driver lease, as this page last heard. */
interface Holder {
  readonly clientId: string
  /** ms since the epoch; null when not said. */
  readonly expiresAt: number | null
  /** The same person (another of their browsers): "Continue here" is offered. */
  readonly canTakeOver: boolean
}

interface RideEvent {
  readonly seq: number
  readonly ts?: string
  readonly type: string
  readonly payload: Record<string, unknown>
}

type RideFrame = { readonly kind: 'event'; readonly event: RideEvent } | { readonly kind: 'delta'; readonly text: string }

interface CommandView {
  readonly commandId: string
  readonly status: string
  readonly acceptedSeq: number
  readonly disposition?: string
  readonly error?: string
}

/** A ride error frame, as a typed failure. */
export class RideFailure extends ChatServiceFailure {
  readonly code: string
  readonly status: number
  /** The error frame's `details` (for `lease_held`: the holder, and whether this caller may take it over). */
  readonly details: Record<string, unknown>
  constructor(
    code: string,
    status: number,
    message: string,
    phase: ChatServiceFailure['phase'],
    recovery: ChatServiceFailure['recovery'],
    details: Record<string, unknown> = {},
  ) {
    super(message, { phase, recovery })
    this.name = 'RideFailure'
    this.code = code
    this.status = status
    this.details = details
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function gateOf(toolName: unknown): string {
  return String(toolName ?? 'tool').replace(TOOL_PREFIX, '')
}

/** What the person wrote, without the note pi-sophia adds for the model. */
export function personText(text: string): string {
  return text.replace(CONTEXT_NOTE, '')
}

/** The model a ride session names (`provider/model`), as the mark on its replies. */
export function voiceOfModel(model: string | undefined): ChatVoiceMark | null {
  if (!model) return null
  const slash = model.indexOf('/')
  const id = slash > 0 ? model.slice(slash + 1) : model
  return { id, label: id, provider: slash > 0 ? model.slice(0, slash) : null, basis: 'live' }
}

/**
 * pi's transcript (the active branch, as `GET /sessions/<id>` returns it) as the panel's messages: each user
 * turn, then everything the agent did until the next user turn (its texts, its tool calls with their
 * results) as one reply.
 *
 * Times are pi's own (each item's `timestamp`, when pi recorded the entry), as the hosted chat dates its
 * messages: a person's message when it was taken, a reply when its last step ended. Never earlier than the
 * message before it; `createdAt` (the conversation's start) only for a host that sends no times.
 */
export function transcriptToMessages(transcript: readonly Record<string, unknown>[], createdAt = Date.now()): ChatMessage[] {
  const messages: ChatMessage[] = []
  let reply: ChatMessage | null = null
  let previous = 0
  const open = new Map<string, string[]>()
  const counters = new Map<string, number>()
  const timeOf = (item: Record<string, unknown>): number => {
    const at = typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : Number.NaN
    return Math.max(Number.isFinite(at) ? at : previous || createdAt, previous)
  }
  const closeReply = () => {
    reply = null
    open.clear()
  }
  const ensureReply = (entryId: string): ChatMessage => {
    if (reply) return reply
    reply = { id: `ride-${entryId}`, role: 'assistant', content: '', parts: [], isStreaming: false, toolCalls: [], createdAt: previous || createdAt }
    messages.push(reply)
    return reply
  }
  for (const item of transcript) {
    const role = item.role
    const entryId = String(item.entryId ?? uuid())
    const text = typeof item.text === 'string' ? item.text : ''
    if (role === 'user') {
      closeReply()
      const content = personText(text)
      previous = timeOf(item)
      messages.push({ id: `ride-${entryId}`, role: 'user', content, parts: [{ type: 'text', content }], isStreaming: false, toolCalls: [], createdAt: previous })
      continue
    }
    if (role === 'assistant' || role === 'toolResult') {
      // A reply is dated by its last step.
      const target = ensureReply(entryId)
      previous = timeOf(item)
      target.createdAt = previous
    }
    if (role === 'assistant') {
      const target = ensureReply(entryId)
      if (text) {
        const joined = target.content ? `\n\n${text}` : text
        target.content += joined
        const last = target.parts[target.parts.length - 1]
        if (last && last.type === 'text') target.parts[target.parts.length - 1] = { type: 'text', content: last.content + joined }
        else target.parts.push({ type: 'text', content: text })
      }
      const calls = Array.isArray(item.toolCalls) ? (item.toolCalls as Record<string, unknown>[]) : []
      for (const call of calls) {
        const gate = gateOf(call.name)
        const n = counters.get(gate) ?? 0
        counters.set(gate, n + 1)
        const id = `${gate}#${n}`
        const queue = open.get(gate) ?? []
        queue.push(id)
        open.set(gate, queue)
        const tool: ToolCall = { id, tool: gate, status: 'running', input: asRecord(call.args) }
        target.toolCalls.push(tool)
        target.parts.push({ type: 'tool', toolCallId: id } satisfies MessagePart)
      }
      continue
    }
    if (role === 'toolResult') {
      const target = ensureReply(entryId)
      const gate = gateOf(item.toolName)
      const id = open.get(gate)?.shift()
      const tool = id ? target.toolCalls.find((candidate) => candidate.id === id) : undefined
      if (tool) {
        tool.status = item.isError === true ? 'error' : 'completed'
        tool.output = text
      }
    }
  }
  // A call whose result never came (the run was stopped) is not still running.
  for (const message of messages) for (const tool of message.toolCalls) if (tool.status === 'running') tool.status = 'error'
  return messages
}

/** A queue the producer pushes into and the store iterates. */
function channel<T>(): { push(value: T): void; end(): void; iterable: AsyncIterable<T> } {
  const values: T[] = []
  let ended = false
  let wake: (() => void) | null = null
  return {
    push(value) {
      values.push(value)
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          if (values.length > 0) {
            yield values.shift() as T
            continue
          }
          if (ended) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = null
        }
      },
    },
  }
}

export type RideChatService = ChatService & {
  /** Send a message into the reply under way (pi's steer: delivered before the next model call). */
  steer(sessionId: string, text: string): Promise<void>
  branchSession(sessionId: string, message: { readonly id: string; readonly content: string; readonly userIndex: number }): Promise<ChatBranch>
  duplicateSession(sessionId: string): Promise<SessionSummary>
  /** The conversations, each branch with what it was branched from. */
  listConversations(): Promise<ConversationSummary[]>
  driverState(sessionId: string): ChatDriverState | null
  takeOver(sessionId: string): Promise<void>
  followSession(sessionId: string, onChange: (change: ChatFollowChange) => void): () => void
  /** This browser, as the unit that holds a conversation's driver lease (`x-vehicle-client-id`). */
  readonly clientId: string
}

export function makeRideChatService(opts: RideChatServiceOptions): RideChatService {
  const fetchImpl: Fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const storage = opts.storage ?? null
  const base = opts.baseUrl.replace(/\/+$/, '')
  const longPollMs = opts.longPollMs ?? LONG_POLL_MS
  const summaries = new Map<string, RideSessionSummary>()
  const claimed = new Set<string>()
  let streamUnavailable = false
  // Who holds each conversation's lease, as last heard (null: nobody); conversations deleted; what this
  // page sent and the runs that took it (a run this page drove is not news to it).
  const holders = new Map<string, Holder | null>()
  const gone = new Set<string>()
  const ownCommands = new Set<string>()
  const ownRuns = new Set<string>()
  const followers = new Map<string, Set<(change: ChatFollowChange) => void>>()
  const summaryWaiters = new Map<string, (() => void)[]>()
  const mirrorsHeard = new Map<string, number>()
  // This page's turn under way, per conversation: its reply is the stream's to show, not a read of the record's.
  const inFlight = new Map<string, { readonly commandId: string; readonly text: string }>()

  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null
    } catch {
      return null
    }
  }
  const write = (key: string, value: string | null): void => {
    try {
      if (value === null) storage?.removeItem(key)
      else storage?.setItem(key, value)
    } catch {
      // Best effort: the page works without storage.
    }
  }

  /** This browser, as the unit that holds a conversation's driver lease. */
  const clientId = (() => {
    const key = 'sophia.ride.client-id'
    const known = read(key)
    if (known && /^[A-Za-z0-9_.:-]{8,128}$/.test(known)) return known
    const minted = `browser-${uuid()}`
    write(key, minted)
    return minted
  })()

  const graphOrThrow = (graphId?: string | null): string => {
    const graph = graphId ?? opts.graphId()
    if (!graph || !GRAPH_ID.test(graph)) {
      throw new ChatServiceFailure('Open a workspace to chat in it.', { phase: 'submit', recovery: 'none' })
    }
    return graph
  }
  const graphOf = (sessionId: string): string => graphOrThrow(summaries.get(sessionId)?.graphId)
  const slotKey = (what: string) => `sophia.ride.${opts.graphId() ?? 'none'}.${what}`

  let slots: (string | null)[] = (() => {
    try {
      const parsed = JSON.parse(read(slotKey('slots')) ?? '[]') as unknown
      return [0, 1, 2].map((index) => (Array.isArray(parsed) && typeof parsed[index] === 'string' ? (parsed[index] as string) : null))
    } catch {
      return [null, null, null]
    }
  })()
  let activeSlot: 0 | 1 | 2 = (() => {
    const raw = Number(read(slotKey('active-slot')))
    return raw === 1 || raw === 2 ? raw : 0
  })()
  const persistSlots = () => {
    write(slotKey('slots'), JSON.stringify(slots))
    write(slotKey('active-slot'), String(activeSlot))
  }

  const headers = (json: boolean): Record<string, string> => {
    const out: Record<string, string> = { Accept: 'application/json', 'x-vehicle-client-id': clientId }
    if (json) out['Content-Type'] = 'application/json'
    const token = opts.token()
    if (token) out.Authorization = `Bearer ${token}`
    return out
  }

  /** One ride request; an error frame becomes a typed failure. */
  async function ride(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: Record<string, unknown> | undefined,
    failure: { phase: ChatServiceFailure['phase']; recovery: ChatServiceFailure['recovery'] },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: headers(body !== undefined),
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      throw new ChatServiceFailure(`Sophia could not be reached: ${error instanceof Error ? error.message : String(error)}`, { ...failure, cause: error })
    }
    let frame: Record<string, unknown> = {}
    try {
      frame = asRecord(await response.json())
    } catch {
      // Not a ride frame (a proxy's own answer): described below by its status.
    }
    if (!response.ok || frame.type === 'error') {
      const code = typeof frame.code === 'string' ? frame.code : `http_${response.status}`
      const said = typeof frame.message === 'string' ? frame.message : typeof frame.error === 'string' ? frame.error : ''
      const details = asRecord(frame.details)
      throw new RideFailure(code, response.status, describeFailure(code, response.status, said, details), failure.phase, failure.recovery, details)
    }
    return frame
  }

  function remember(summary: RideSessionSummary): RideSessionSummary {
    summaries.set(summary.sessionId, summary)
    for (const wake of summaryWaiters.get(summary.sessionId)?.splice(0) ?? []) wake()
    return summary
  }

  /** A conversation is named by its own name, else (a name given in this browser before names were kept) by that, else by what was said in it first. */
  function toSessionSummary(summary: RideSessionSummary): SessionSummary {
    const named = isPlaceholderTitle(summary.title) ? null : summary.title
    const title = named ?? read(`sophia.ride.title.${summary.sessionId}`) ?? summary.preview ?? null
    return { id: summary.sessionId, title, created_at: summary.createdAt, updated_at: summary.updatedAt ?? summary.createdAt }
  }

  /** Tell whoever follows the conversation what moved. */
  function changed(sessionId: string, change: ChatFollowChange): void {
    for (const listener of [...(followers.get(sessionId) ?? [])]) {
      try {
        listener(change)
      } catch {
        // A listener's failure is its own.
      }
    }
  }

  /** Who holds the lease now. Returns whether that changed what this page may do. */
  function setHolder(sessionId: string, holder: Holder | null): void {
    const before = JSON.stringify(driverState(sessionId))
    holders.set(sessionId, holder)
    if (holder && holder.clientId !== clientId) claimed.delete(sessionId)
    if (JSON.stringify(driverState(sessionId)) !== before) changed(sessionId, 'driver')
  }

  /** The lease as a summary or a `lease_held` refusal describes it. */
  function holderOf(lease: unknown, canTakeOver = true): Holder | null {
    const record = asRecord(lease)
    if (typeof record.clientId !== 'string' || !record.clientId) return null
    const expiresAt = typeof record.expiresAt === 'number' ? record.expiresAt : typeof record.expiresAt === 'string' ? Date.parse(record.expiresAt) : Number.NaN
    return { clientId: record.clientId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null, canTakeOver }
  }

  function driverState(sessionId: string): ChatDriverState | null {
    if (gone.has(sessionId)) return { kind: 'gone' }
    const holder = holders.get(sessionId)
    if (!holder || holder.clientId === clientId) return null
    if (holder.expiresAt !== null && holder.expiresAt <= Date.now()) return null
    return { kind: 'elsewhere', canTakeOver: holder.canTakeOver }
  }

  /** A refusal because another client drives: what this page now knows of the holder. */
  function heardRefusal(sessionId: string, error: unknown): void {
    if (!(error instanceof RideFailure)) return
    if (error.code === 'lease_held') {
      setHolder(sessionId, holderOf(error.details.holder, error.details.canTakeOver !== false))
    } else if (error.code === 'not_found' && summaries.has(sessionId)) {
      gone.add(sessionId)
      claimed.delete(sessionId)
      changed(sessionId, 'driver')
    }
  }

  /**
   * One durable event of a conversation, from any watch of it: who holds the lease, whether it still exists,
   * its name, and whether a reply this page did not drive moved its record.
   */
  function observe(sessionId: string, event: RideEvent): void {
    const { type, payload } = event
    switch (type) {
      case 'lease.claimed':
      case 'lease.renewed':
        setHolder(sessionId, holderOf(payload))
        break
      case 'lease.released':
      case 'lease.expired':
      case 'lease.revoked':
      case 'session.shutdown':
        // Ours or not, it must be claimed again before the next command (a takeover's claim follows its revoke).
        claimed.delete(sessionId)
        setHolder(sessionId, null)
        break
      case 'session.deleted':
        gone.add(sessionId)
        claimed.delete(sessionId)
        changed(sessionId, 'driver')
        break
      case 'session.renamed': {
        const known = summaries.get(sessionId)
        if (known) remember({ ...known, title: typeof payload.title === 'string' ? payload.title : undefined })
        changed(sessionId, 'record')
        break
      }
      case 'command.delivered': {
        const runId = payload.runId == null ? null : String(payload.runId)
        if (ownCommands.has(String(payload.commandId))) {
          if (runId) ownRuns.add(runId)
        } else if (runId && !ownRuns.has(runId)) {
          // Someone else's message (another browser driving): show it.
          changed(sessionId, 'record')
        }
        break
      }
      case 'run.settled':
        if (payload.runId == null || !ownRuns.has(String(payload.runId))) changed(sessionId, 'record')
        break
      case 'mirror.written': {
        // Each write once, however many watches of the conversation saw it.
        if ((mirrorsHeard.get(sessionId) ?? 0) >= event.seq) break
        mirrorsHeard.set(sessionId, event.seq)
        const graph = summaries.get(sessionId)?.graphId
        if (graph) {
          try {
            opts.onWorkspaceChanged?.(graph)
          } catch {
            // The shell's to handle.
          }
        }
        break
      }
      default:
        break
    }
  }

  async function claim(sessionId: string, phase: ChatServiceFailure['phase']): Promise<void> {
    if (claimed.has(sessionId)) return
    try {
      const frame = await ride('POST', `/g/${graphOf(sessionId)}/sessions/${sessionId}/claim`, { requestId: `claim-${uuid()}` }, { phase, recovery: 'resubmit' })
      claimed.add(sessionId)
      setHolder(sessionId, holderOf(asRecord(frame.value).lease) ?? { clientId, expiresAt: null, canTakeOver: true })
    } catch (error) {
      heardRefusal(sessionId, error)
      throw error
    }
  }

  /** Send a command, claiming the lease first (and again if it lapsed). */
  async function command(sessionId: string, body: Record<string, unknown>, phase: ChatServiceFailure['phase']): Promise<Record<string, unknown>> {
    await claim(sessionId, phase)
    const send = () => {
      const requestId = `cmd-${uuid()}`
      // Known as ours before it is sent: its delivery may be seen before the answer comes.
      ownCommands.add(requestId)
      return ride('POST', `/g/${graphOf(sessionId)}/sessions/${sessionId}/commands`, { requestId, ...body }, { phase, recovery: 'resubmit' })
    }
    try {
      return await send()
    } catch (error) {
      if (error instanceof RideFailure && error.code === 'lease_required') {
        claimed.delete(sessionId)
        await claim(sessionId, phase)
        return send()
      }
      heardRefusal(sessionId, error)
      throw error
    }
  }

  /**
   * Watch the session's events after `since`: the stream when gardend streams it, long-poll otherwise,
   * resuming from the last cursor on either after a drop (a reconnect is marked: text deltas sent while
   * away are lost, so the consumer waits for the step's whole text). `ready` resolves once the first
   * connection is open, so a command sent after it has every delta of its reply on the stream.
   */
  function startWatch(
    sessionId: string,
    since: number,
    signal: AbortSignal,
  ): { ready: Promise<void>; frames: AsyncIterable<RideFrame | { kind: 'reconnected' }>; sent(): void } {
    const frames = channel<RideFrame | { kind: 'reconnected' }>()
    // The command went out before this watch was open: the first stream may join a step midway.
    let commandSent = false
    let markReady: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    let cursor = since
    let connections = 0
    let streamFailures = 0
    const path = () => `/g/${graphOf(sessionId)}/sessions/${sessionId}/events?since=${cursor}`
    const take = (raw: Record<string, unknown>) => {
      const seq = Number(raw.seq)
      if (!Number.isFinite(seq) || seq <= cursor) return
      cursor = seq
      frames.push({ kind: 'event', event: { seq, ts: String(raw.ts ?? ''), type: String(raw.type), payload: asRecord(raw.payload) } })
    }
    const loop = async () => {
      while (!signal.aborted) {
        if (!streamUnavailable && streamFailures < MAX_STREAM_RETRIES) {
          try {
            const response = await fetchImpl(`${base}${path()}`, {
              method: 'GET',
              headers: { ...headers(false), Accept: 'text/event-stream' },
              credentials: 'same-origin',
              cache: 'no-store',
              signal,
            })
            const type = response.headers.get('content-type') ?? ''
            if (!response.ok || !type.includes('text/event-stream') || !response.body) {
              // A gardend that cannot stream (0.1.3 answered 501): long-poll from here on.
              if (response.status === 501 || (response.ok && !type.includes('text/event-stream'))) streamUnavailable = true
              else streamFailures += 1
              await response.body?.cancel().catch(() => undefined)
              continue
            }
            connections += 1
            if (connections > 1 || commandSent) frames.push({ kind: 'reconnected' })
            markReady()
            for await (const frame of parseSse(response.body.getReader())) {
              const data = asRecord(frame.data)
              const event = asRecord(data.event)
              if (data.ephemeral === true) {
                const delta = asRecord(event.payload).delta
                if (event.type === 'message.delta' && typeof delta === 'string' && delta) frames.push({ kind: 'delta', text: delta })
                continue
              }
              streamFailures = 0
              take(event)
            }
            // The stream ended while still wanted: reconnect from the cursor.
            streamFailures += 1
          } catch {
            if (signal.aborted) break
            streamFailures += 1
          }
          continue
        }
        markReady()
        try {
          const frame = await ride('GET', `${path()}&waitMs=${longPollMs}`, undefined, { phase: 'stream', recovery: 'reconcile' }, signal)
          const value = asRecord(frame.value)
          for (const raw of Array.isArray(value.events) ? (value.events as Record<string, unknown>[]) : []) take(raw)
        } catch (error) {
          if (signal.aborted) break
          frames.push({ kind: 'event', event: { seq: cursor, type: 'watch.failed', payload: { message: error instanceof Error ? error.message : String(error) } } })
          break
        }
      }
      markReady()
      frames.end()
    }
    void loop()
    return {
      ready,
      frames: frames.iterable,
      sent() {
        commandSent = true
      },
    }
  }

  /**
   * Translate one turn's ride events into the panel's events, from our command's delivery to the end of the
   * run that delivered it. Text arrives as deltas on the stream, or whole on `message.completed` when
   * long-polling; either way each step's text is said once, steps separated by a blank line.
   */
  function driveTurn(
    sessionId: string,
    accepted: CommandView,
    watching: { frames: AsyncIterable<RideFrame | { kind: 'reconnected' }> },
    stop: AbortController,
  ): ChatTurnHandle {
    const out = channel<ChatEvent>()
    let settle: (outcome: ChatTurnOutcome) => void = () => {}
    const done = new Promise<ChatTurnOutcome>((resolve) => {
      settle = resolve
    })
    const pump = async (): Promise<ChatTurnOutcome> => {
      let delivered = false
      let runId: string | null = null
      let reply = ''
      let step = ''
      let budget: string | null = null
      let lastError: string | null = null
      // After a reconnect the deltas sent while away are lost: say nothing more of this step until it completes.
      let deaf = false
      const say = (text: string) => {
        if (!text) return
        const prefixed = step === '' && reply !== '' ? `\n\n${text}` : text
        step += text
        reply += prefixed
        out.push({ type: 'text', content: prefixed })
      }
      for await (const frame of watching.frames) {
        if (frame.kind === 'reconnected') {
          deaf = true
          continue
        }
        if (frame.kind === 'delta') {
          if (delivered && !deaf) say(frame.text)
          continue
        }
        observe(sessionId, frame.event)
        const { type, payload } = frame.event
        const ours = payload.commandId === accepted.commandId
        if (!delivered) {
          if (type === 'command.delivered' && ours) {
            delivered = true
            runId = payload.runId == null ? null : String(payload.runId)
            out.push({ type: 'turn_start', turn: 0 })
          } else if (ours && (type === 'command.cancelled' || type === 'command.aborted')) {
            return { state: 'aborted' }
          } else if (ours && (type === 'command.failed' || type === 'command.interrupted')) {
            const why = typeof payload.error === 'string' ? payload.error : 'The message could not be delivered.'
            return { state: 'failed', failure: new ChatServiceFailure(why, { phase: 'stream', recovery: type === 'command.failed' ? 'resubmit' : 'reconcile' }) }
          }
          continue
        }
        switch (type) {
          case 'message.completed': {
            if (payload.role !== 'assistant') break
            const full = typeof payload.text === 'string' ? payload.text : ''
            if (full.startsWith(step)) say(full.slice(step.length))
            step = ''
            deaf = false
            const usage = asRecord(payload.usage)
            const costUsd = Number(usage.costUsd)
            if (Number.isFinite(costUsd) && costUsd > 0) out.push({ type: 'cost', microUsd: Math.round(costUsd * 1_000_000) })
            if (payload.stopReason === 'error' && typeof payload.errorMessage === 'string') lastError = payload.errorMessage
            break
          }
          case 'tool.started':
            step = ''
            out.push({ type: 'tool_call', gate: gateOf(payload.toolName), args: asRecord(payload.args) })
            break
          case 'tool.result':
            out.push({ type: 'tool_result', gate: gateOf(payload.toolName), result: typeof payload.text === 'string' ? payload.text : '', is_error: payload.isError === true })
            break
          case 'budget.exceeded':
            budget = typeof payload.reason === 'string' ? payload.reason : 'its budget'
            break
          case 'run.error':
            if (typeof payload.message === 'string') lastError = payload.message
            break
          case 'watch.failed':
            return {
              state: 'failed',
              failure: new ChatServiceFailure(String(payload.message ?? 'The reply stream was lost.'), { phase: 'stream', recovery: 'reconcile' }),
            }
          case 'run.settled': {
            if (runId !== null && payload.runId != null && String(payload.runId) !== runId) break
            if (payload.aborted === true) {
              if (budget) {
                out.push({ type: 'error', message: `Sophia stopped here: this reply reached its limit (${budget}).` })
                return { state: 'completed' }
              }
              return { state: 'aborted' }
            }
            if (payload.stopReason === 'error') {
              out.push({ type: 'error', message: lastError ?? 'The model call failed.' })
              return { state: 'completed' }
            }
            out.push({ type: 'done', output: reply })
            return { state: 'completed' }
          }
          default:
            break
        }
      }
      return stop.signal.aborted
        ? { state: 'aborted' }
        : { state: 'failed', failure: new ChatServiceFailure('The reply stream ended early.', { phase: 'stream', recovery: 'reconcile' }) }
    }
    void pump()
      .finally(() => {
        if (inFlight.get(sessionId)?.commandId === accepted.commandId) inFlight.delete(sessionId)
      })
      .catch((error: unknown): ChatTurnOutcome => ({
        state: 'failed',
        failure: error instanceof ChatServiceFailure ? error : new ChatServiceFailure(error instanceof Error ? error.message : String(error), { phase: 'stream', recovery: 'reconcile' }),
      }))
      .then((outcome) => {
        stop.abort()
        out.end()
        settle(outcome)
      })
    return {
      events: out.iterable,
      done,
      abort() {
        void service.abort(sessionId).catch(() => undefined)
      },
    }
  }

  const capabilities: ChatCapabilities = Object.freeze({
    voice: false,
    continuation: false,
    access: Object.freeze({ owner: 'write', editor: 'write', viewer: 'read' }),
  })

  /** Resolves once this page has a summary of the conversation (with the cursor its record was read at). */
  function summaryOf(sessionId: string): Promise<void> {
    if (summaries.has(sessionId)) return Promise.resolve()
    return new Promise(resolve => {
      const waiting = summaryWaiters.get(sessionId) ?? []
      waiting.push(resolve)
      summaryWaiters.set(sessionId, waiting)
    })
  }

  /**
   * Follow an open conversation: its events from the cursor its record was read at, while the page is
   * visible (a hidden page holds no connection; it catches up from its cursor when it is shown again).
   */
  function followSession(sessionId: string, onChange: (change: ChatFollowChange) => void): () => void {
    const listeners = followers.get(sessionId) ?? new Set()
    listeners.add(onChange)
    followers.set(sessionId, listeners)
    let stopped = false
    let watching: AbortController | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let cursor: number | null = null
    const doc = typeof document === 'undefined' ? null : document
    const visible = () => doc?.visibilityState !== 'hidden'
    const halt = () => {
      watching?.abort()
      watching = null
      if (retry) clearTimeout(retry)
      retry = null
    }
    const run = async () => {
      if (stopped || watching || !visible() || gone.has(sessionId)) return
      const controller = new AbortController()
      watching = controller
      await summaryOf(sessionId)
      if (controller.signal.aborted) return
      cursor ??= summaries.get(sessionId)?.cursor ?? 0
      const watch = startWatch(sessionId, cursor, controller.signal)
      for await (const frame of watch.frames) {
        if (frame.kind !== 'event') continue
        if (frame.event.type === 'watch.failed') break
        cursor = Math.max(cursor ?? 0, frame.event.seq)
        failures = 0
        observe(sessionId, frame.event)
        // A deleted conversation has nothing more to say.
        if (gone.has(sessionId)) break
      }
      const asked = controller.signal.aborted
      controller.abort()
      if (watching === controller) watching = null
      // The watch ended without being asked to (a dropped proxy, a failed poll): look again in a while.
      if (!asked && !stopped && !gone.has(sessionId)) {
        retry = setTimeout(() => void run(), Math.min(FOLLOW_RETRY_MS * 2 ** failures, FOLLOW_RETRY_MAX_MS))
        failures += 1
      }
    }
    const onVisibility = () => {
      if (visible()) void run()
      else halt()
    }
    doc?.addEventListener('visibilitychange', onVisibility)
    void run()
    return () => {
      stopped = true
      halt()
      doc?.removeEventListener('visibilitychange', onVisibility)
      listeners.delete(onChange)
      if (listeners.size === 0) followers.delete(sessionId)
    }
  }

  /**
   * A branch or a duplicate, made by vehicle-host from the conversation's own record (no lease needed: the
   * conversation's owner may branch it from any of their clients). This browser holds the new one's lease.
   */
  async function branchOff(sessionId: string, body: Record<string, unknown>): Promise<{ summary: RideSessionSummary; value: Record<string, unknown> }> {
    let frame: Record<string, unknown>
    try {
      frame = await ride('POST', `/g/${graphOf(sessionId)}/sessions/${sessionId}/commands`, { requestId: `${String(body.op)}-${uuid()}`, ...body }, { phase: 'submit', recovery: 'none' })
    } catch (error) {
      heardRefusal(sessionId, error)
      throw error
    }
    const value = asRecord(frame.value)
    const summary = remember(asRecord(value.session) as unknown as RideSessionSummary)
    claimed.add(summary.sessionId)
    holders.set(summary.sessionId, holderOf(summary.lease) ?? { clientId, expiresAt: null, canTakeOver: true })
    return { summary, value }
  }

  /** The record's entry of one of the person's messages: by the id the record gave it, else by its place and words. */
  async function userEntryOf(sessionId: string, message: { readonly id: string; readonly content: string; readonly userIndex: number }): Promise<string> {
    const frame = await ride('GET', `/g/${graphOf(sessionId)}/sessions/${sessionId}`, undefined, { phase: 'submit', recovery: 'none' })
    const transcript = asRecord(frame.value).transcript
    const users = (Array.isArray(transcript) ? (transcript as Record<string, unknown>[]) : [])
      .filter(item => item.role === 'user' && typeof item.entryId === 'string')
      .map(item => ({ entryId: String(item.entryId), text: personText(String(item.text ?? '')) }))
    const own = message.id.startsWith('ride-') ? users.find(item => `ride-${item.entryId}` === message.id) : undefined
    const placed = users[message.userIndex]
    const found = own ?? (placed && placed.text === message.content ? placed : undefined) ?? users.filter(item => item.text === message.content).at(-1)
    if (!found) {
      throw new ChatServiceFailure('That message is not in the conversation’s record yet. Try again once the reply has finished.', { phase: 'submit', recovery: 'none' })
    }
    return found.entryId
  }

  const service = {
    get activeSlot() {
      return activeSlot
    },
    capabilities,
    clientId,
    driverState,
    followSession,

    async takeOver(sessionId: string): Promise<void> {
      try {
        const frame = await ride(
          'POST',
          `/g/${graphOf(sessionId)}/sessions/${sessionId}/claim`,
          { requestId: `claim-${uuid()}`, takeover: true },
          { phase: 'submit', recovery: 'none' },
        )
        claimed.add(sessionId)
        setHolder(sessionId, holderOf(asRecord(frame.value).lease) ?? { clientId, expiresAt: null, canTakeOver: true })
      } catch (error) {
        heardRefusal(sessionId, error)
        throw error
      }
    },

    async startTurn(sessionId: string, userText: string): Promise<ChatTurnHandle> {
      const refs = opts.contextRefs?.() ?? []
      await claim(sessionId, 'submit')
      // Watch first, then send: every delta of the reply is then on the stream.
      const stop = new AbortController()
      const watching = startWatch(sessionId, summaries.get(sessionId)?.cursor ?? 0, stop.signal)
      await Promise.race([watching.ready, new Promise(resolve => setTimeout(resolve, WATCH_READY_MS))])
      watching.sent()
      let accepted: CommandView
      try {
        const frame = await command(sessionId, { op: 'prompt', text: userText, ...(refs.length > 0 ? { contextRefs: [...refs].slice(0, 100) } : {}) }, 'submit')
        const value = asRecord(frame.value)
        accepted = asRecord(value.command) as unknown as CommandView
        if (value.session) remember(value.session as RideSessionSummary)
        if (accepted.status === 'failed') {
          throw new ChatServiceFailure(accepted.error ?? 'Sophia could not start this reply.', { phase: 'submit', recovery: 'resubmit' })
        }
      } catch (error) {
        stop.abort()
        throw error
      }
      inFlight.set(sessionId, { commandId: accepted.commandId, text: userText })
      return driveTurn(sessionId, accepted, watching, stop)
    },

    async steer(sessionId: string, text: string): Promise<void> {
      const refs = opts.contextRefs?.() ?? []
      const frame = await command(sessionId, { op: 'steer', text, ...(refs.length > 0 ? { contextRefs: [...refs].slice(0, 100) } : {}) }, 'submit')
      const accepted = asRecord(asRecord(frame.value).command)
      if (accepted.status === 'failed') {
        throw new ChatServiceFailure(String(accepted.error ?? 'The message could not be sent.'), { phase: 'submit', recovery: 'resubmit' })
      }
    },

    async abort(sessionId: string): Promise<void> {
      await command(sessionId, { op: 'abort' }, 'stream')
    },

    async branchSession(sessionId: string, message: { readonly id: string; readonly content: string; readonly userIndex: number }): Promise<ChatBranch> {
      const entryId = await userEntryOf(sessionId, message)
      const { summary, value } = await branchOff(sessionId, { op: 'fork', entryId })
      const text = typeof value.selectedText === 'string' ? personText(value.selectedText) : message.content
      return { session: toSessionSummary(summary), text }
    },

    async duplicateSession(sessionId: string): Promise<SessionSummary> {
      return toSessionSummary((await branchOff(sessionId, { op: 'clone' })).summary)
    },

    async createSession(create: CreateSessionOpts = {}): Promise<SessionSummary> {
      const graph = graphOrThrow(create.graphId)
      const frame = await ride(
        'POST',
        `/g/${graph}/sessions`,
        { requestId: `create-${uuid()}`, ...(create.title && !isPlaceholderTitle(create.title) ? { title: create.title.slice(0, 200) } : {}) },
        { phase: 'submit', recovery: 'resubmit' },
      )
      const summary = remember(asRecord(asRecord(frame.value).session) as unknown as RideSessionSummary)
      claimed.add(summary.sessionId)
      holders.set(summary.sessionId, holderOf(summary.lease) ?? { clientId, expiresAt: null, canTakeOver: true })
      return toSessionSummary(summary)
    },

    async listSessions(): Promise<SessionSummary[]> {
      const graph = graphOrThrow()
      const frame = await ride('GET', `/g/${graph}/sessions`, undefined, { phase: 'conversation-load', recovery: 'retry-load' })
      const listed = asRecord(frame.value).sessions
      const rows = (Array.isArray(listed) ? listed : []).map((row) => remember(row as RideSessionSummary))
      // A conversation nothing was said in is listed only while a slot holds it (a fresh chat).
      return rows.filter((row) => row.preview || row.title || slots.includes(row.sessionId)).map(toSessionSummary)
    },

    async listConversations(): Promise<ConversationSummary[]> {
      const sessions = await service.listSessions()
      const listed = new Map(sessions.map((session) => [session.id, session]))
      return sessions.map((session): ConversationSummary => {
        const known = summaries.get(session.id)
        const parent = known?.parent
        return {
          id: session.id,
          kind: 'live',
          // An unnamed conversation is drawn as untitled by the list, as before.
          title: session.title ?? '',
          updatedAt: session.updated_at ?? session.created_at ?? '',
          ...(session.created_at ? { createdAt: session.created_at } : {}),
          ...(known?.graphId ? { graphId: known.graphId } : {}),
          ...(parent ? { branchedFrom: { id: parent.sessionId, kind: parent.kind, title: listed.get(parent.sessionId)?.title ?? null } } : {}),
        }
      })
    },

    async hydrateSession(id: string): Promise<HydratedSession> {
      const graph = summaries.get(id)?.graphId ?? graphOrThrow()
      let frame: Record<string, unknown>
      try {
        frame = await ride('GET', `/g/${graph}/sessions/${id}`, undefined, { phase: 'conversation-load', recovery: 'retry-load' })
      } catch (error) {
        heardRefusal(id, error)
        throw error
      }
      const value = asRecord(frame.value)
      // The record as of this cursor: a follow of it starts here.
      const reported = asRecord(value.session) as unknown as RideSessionSummary
      const summary = remember(typeof value.cursor === 'number' ? { ...reported, cursor: value.cursor } : reported)
      setHolder(id, holderOf(summary.lease, holders.get(id)?.canTakeOver ?? true))
      let transcript = Array.isArray(value.transcript) ? (value.transcript as Record<string, unknown>[]) : []
      const commands = Array.isArray(value.commands) ? (value.commands as Record<string, unknown>[]) : []
      // While this page's turn is under way, its reply is the stream's: the record is read up to the person's
      // message (once pi has taken it), never ahead of what the stream is about to say.
      const pending = inFlight.get(id)
      const taken = pending && commands.some(record => record.commandId === pending.commandId && !['accepted', 'queued'].includes(String(record.status)))
      if (pending && taken) {
        let at = transcript.length - 1
        while (at >= 0 && !(transcript[at]?.role === 'user' && personText(String(transcript[at]?.text ?? '')) === pending.text)) at -= 1
        if (at >= 0) transcript = transcript.slice(0, at + 1)
      }
      const created = Date.parse(summary.createdAt) || Date.now()
      const messages = transcriptToMessages(transcript, created)
      // A message accepted but not yet in pi's transcript (it is about to be): shown as said.
      const said = new Set(messages.filter((message) => message.role === 'user').map((message) => message.content))
      for (const record of commands) {
        if (!['prompt', 'follow_up', 'steer'].includes(String(record.op)) || record.via) continue
        if (!['accepted', 'queued', 'delivered'].includes(String(record.status))) continue
        const text = typeof record.text === 'string' ? record.text : ''
        if (!text || said.has(text)) continue
        const acceptedAt = typeof record.acceptedAt === 'string' ? Date.parse(record.acceptedAt) : Number.NaN
        messages.push({
          id: `ride-cmd-${String(record.commandId)}`,
          role: 'user',
          content: text,
          parts: [{ type: 'text', content: text }],
          isStreaming: false,
          toolCalls: [],
          createdAt: Number.isFinite(acceptedAt) ? acceptedAt : Date.now(),
        })
      }
      return { session: toSessionSummary(summary), messages }
    },

    async renameSession(id: string, title: string): Promise<SessionSummary> {
      // Kept by vehicle-host, so every browser sees it. A placeholder ("New chat", an empty box) clears the name:
      // the conversation is named by what was said in it again.
      const named = isPlaceholderTitle(title) ? null : title.replace(/\s+/g, ' ').trim().slice(0, 200)
      const graph = summaries.get(id)?.graphId ?? graphOrThrow()
      const frame = await ride('PATCH', `/g/${graph}/sessions/${id}`, { requestId: `rename-${uuid()}`, title: named }, { phase: 'submit', recovery: 'resubmit' })
      // A name this browser kept before names were kept by the host is superseded.
      write(`sophia.ride.title.${id}`, null)
      return toSessionSummary(remember(asRecord(asRecord(frame.value).session) as unknown as RideSessionSummary))
    },

    async deleteSession(id: string): Promise<void> {
      // vehicle-host moves the record to its trash (never unlinked); refused while a reply is under way.
      const graph = summaries.get(id)?.graphId ?? graphOrThrow()
      let mirror: Record<string, unknown> = {}
      try {
        const frame = await ride('DELETE', `/g/${graph}/sessions/${id}`, undefined, { phase: 'submit', recovery: 'none' })
        mirror = asRecord(asRecord(frame.value).mirror)
      } catch (error) {
        // Already gone (deleted from another browser): what was asked is so.
        if (!(error instanceof RideFailure && error.code === 'not_found')) throw error
      }
      // The conversation's document in the workspace goes to the Trash with it (restorable there, as the
      // conversation is from the host's). Best effort: a member may not trash documents, and the conversation
      // is deleted either way.
      if (opts.trashDocument && typeof mirror.documentId === 'string' && GRAPH_ID.test(String(mirror.graphId ?? graph))) {
        await opts.trashDocument(String(mirror.graphId ?? graph), mirror.documentId).catch(() => undefined)
      }
      gone.add(id)
      claimed.delete(id)
      holders.delete(id)
      write(`sophia.ride.title.${id}`, null)
      slots = slots.map(current => (current === id ? null : current))
      persistSlots()
      changed(id, 'driver')
    },

    models(): ChatModelOption[] {
      return []
    },

    async probeCapabilities(): Promise<ChatCapabilities> {
      return capabilities
    },

    sessionModelId(sessionId: string): string | null {
      return summaries.get(sessionId)?.model ?? null
    },

    sessionVoice(sessionId: string): ChatVoiceMark | null {
      return voiceOfModel(summaries.get(sessionId)?.model)
    },

    access(sessionId: string | null): ChatAccess | null {
      const role = opts.role?.() ?? null
      const reason = opts.unavailable?.()
      if (reason) return { mode: 'read', basis: 'unavailable', role, reason }
      const known = sessionId ? summaries.get(sessionId) : undefined
      if (known) return { mode: known.access === 'read' ? 'read' : 'write', basis: 'conversation', role }
      if (!role) return null
      return { mode: role === 'viewer' ? 'read' : 'write', basis: 'role', role }
    },

    slotSessions(): (string | null)[] {
      return [...slots]
    },
    setActiveSlot(slot: 0 | 1 | 2): void {
      activeSlot = slot
      persistSlots()
    },
    bindSlotSession(slot: 0 | 1 | 2, id: string | null): void {
      slots = slots.map((current, index) => (index === slot ? id : current))
      persistSlots()
    },
  }
  return service
}

/** A ride or proxy refusal, in words the panel can show. */
function describeFailure(code: string, status: number, said: string, details: Record<string, unknown> = {}): string {
  switch (code) {
    case 'lease_held':
      return details.canTakeOver === false
        ? 'Someone else is driving this conversation.'
        : 'This conversation is open in another tab or browser. Choose Continue here to send from this one.'
    case 'session_running':
      return 'Sophia is still working in this conversation. Stop the reply, then delete it.'
    case 'access_reduced':
      return 'This conversation can change the workspace, and your role now only reads it. Start a new conversation.'
    case 'not_found':
      return 'This conversation is not here any more.'
    case 'model_unavailable':
      return `The model is not available on this Sophia${said ? `: ${said}` : ''}.`
    case 'unauthorized':
    case 'http_401':
      return 'This Sophia did not accept the sign-in. Open the link `gardend url` prints.'
    case 'http_403':
      return 'You do not have access to chat in this workspace.'
    case 'http_503':
      return 'Chat is not running on this Sophia right now (gardend starts it; try again in a moment).'
    default:
      return said || `Chat answered HTTP ${status} (${code}).`
  }
}
