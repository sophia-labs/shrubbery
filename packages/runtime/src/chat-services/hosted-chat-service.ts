/**
 * Cloud-2 hosted ChatService.
 *
 * The pane keeps a local virtual `c2chat-*` conversation descriptor while
 * Choreograph owns the durable `ags-*` Agent Session. The first user turn
 * invokes a workflow through the authenticated gateway; later turns are
 * idempotent resident commands on that same Session. No legacy `/api/sessions`
 * endpoint or direct Choreograph origin exists here.
 *
 * Which workflow: a graph that carries a Domain Agent definition gets its own
 * agent (`domain-agent-activity-loop-v1`). Any other graph gets Choreograph's
 * built-in, read-only workspace assistant (`workspace-chat-v1`). Choreograph
 * says which case applies: a Domain Agent invocation in an unprovisioned graph
 * answers 404 `domain_agent_not_provisioned`, and the service falls back.
 *
 * Failures before a run exists come back with a stable `error.code`. Those are
 * definite: nothing committed, so the conversation is never left "uncertain".
 */

import {
  type ChatEvent,
  type ChatMessage,
  type ChatModelOption,
  type ChatSeam,
  type ChatVoiceMark,
  type MessagePart,
  type SessionSummary,
  type ToolCall,
  modelIdTail,
  uuid,
  voiceMarkFromId,
} from '@shrubbery/chat-kernel'
import {
  type ChatAccess,
  type ChatAccessAdvert,
  type ChatBalance,
  ChatBillingFailure,
  type ChatCapabilities,
  type ChatService,
  ChatServiceFailure,
  type ChatTurnHandle,
  type ChatTurnOutcome,
  type ContinueIntent,
  type ConversationLineage,
  type ConversationSummary,
  type CreateSessionOpts,
  type HydratedSession,
  NO_CAPABILITIES,
  type ChatWorkspaceRole,
} from './chat-service.js'
import {
  ContinuationError,
  DEFAULT_WINDOW_LIMITS,
  type ContinuationChoice,
  type ContinuationPlan,
  type SeedReceipt,
  type SourceVoice,
  type WindowLimits,
  type WindowMessage,
  assertOwnConversation,
  providerNoticeFor,
  readContinuationPlan,
  seamVoiceLabel,
  seedPayloadFor,
  windowToChatMessages,
} from './continuation.js'
import {
  annotateVoices,
  billingFailureMessage,
  billingRefusalOfResponse,
  billingRefusalOfTurnFailure,
  priceFootnote,
} from './chat-billing.js'
import { type ConversationArchive, createConversationArchive } from './conversation-archive.js'
import {
  BALANCE_PATH,
  CANNOT_CONTINUE,
  CHAT_SEEDS_PATH,
  CHAT_SESSIONS_PATH,
  INFERENCE_INPUT,
  SEED_INPUT,
  VOICE_CATALOGUE_PATH,
  type SessionRow,
  advertisedInputs,
  capTitle,
  continuedTitle,
  firstPromptOf,
  inferenceInput,
  parseBalance,
  parseCatalogue,
  parseSeedReceipt,
  parseSessionList,
  seedFailure,
  seedInput,
  windowLimitsFrom,
} from './sobremesa-contract.js'

const WORKFLOW_NAME = 'domain-agent-activity-loop-v1'
const WORKFLOW_URI = `urn:sophia:wf:${WORKFLOW_NAME}`
const WORKSPACE_WORKFLOW_NAME = 'workspace-chat-v1'
const WORKSPACE_WORKFLOW_URI = `urn:sophia:wf:${WORKSPACE_WORKFLOW_NAME}`
const NOT_PROVISIONED = 'domain_agent_not_provisioned'
/** A launch whose response was lost is reconciled against the run list only after this long. */
const LAUNCH_RECONCILE_AFTER_MS = 30_000
/** A turn's stream is followed this long, however often the host closes it, before it is given up on. */
const DEFAULT_STREAM_DEADLINE_MS = 10 * 60_000
/** Rounds of "anything newer?" allowed in one catch-up before the loop moves on. */
const MAX_CATCH_UP_ROUNDS = 8
/** The longest a quiet turn is left between looks at the host: it backs off from 250 ms to this. */
const MAX_IDLE_DELAY_MS = 2_000
/** A graph found to have no Domain Agent is not asked again for this long (a definition may be added). */
const NO_DOMAIN_AGENT_TTL_MS = 10 * 60_000
/**
 * How long a read that only says what the host can do is waited for: the balance (a line of
 * text), the registry, the catalogue of voices, the list of conversations. Sending a message
 * is not one of these and is never cut short.
 */
const READ_TIMEOUT_MS = 15_000
/** How many of the host's chat sessions one list asks for. */
const SESSION_LIST_LIMIT = 100
/** A conversation is titled by what was said in it, cut to about this many characters. */
const TITLE_CHARS = 60
const DEFINITION_DOCUMENT_ID = 'domain-agent-definition'
const DESCRIPTOR_SCHEMA = 'shrubbery.cloud2-chat-descriptor.v1'
const DEFAULT_STORAGE_PREFIX = 'shrubbery:c2chat:v1'
const DIGEST = /^[a-f0-9]{64}$/
const VIRTUAL_ID = /^c2chat-[A-Za-z0-9._:-]+$/
const AGENT_SESSION_ID = /^ags[-_][A-Za-z0-9._:-]+$/
/**
 * The retired single "voice" (`Sophia-1 · profile-managed`) that omitted the model.
 * Descriptors written before voices could be chosen carry it; it means "no choice".
 */
const LEGACY_PROFILE_MODEL_ID = 'sophia-1/profile'
/** The built-in modes a workspace chat's session is bound to (Choreograph `workspace-chat.ts`). */
const WORKSPACE_WRITER_MODE = 'urn:sophia:mode:workspace-writer'
const WORKSPACE_READER_MODE = 'urn:sophia:mode:workspace-reader'
/**
 * A context reference a turn may carry: a document, artifact or folder id, optionally `#` a block id
 * (Choreograph `workspace-chat-contract.ts` CONTEXT_REF). Anything else is dropped, never sent.
 */
const CONTEXT_REF = /^[A-Za-z0-9_-]{1,128}(?:#[A-Za-z0-9_-]{1,128})?$/
/** At most this many references travel with a turn (the host renders eight; it accepts a hundred). */
const MAX_CONTEXT_REFS = 16
/**
 * `workspace-chat-v1` as the reader-only releases served it: a chat that never writes and whose follow-up
 * commands take only `{ text }`. As each release's live registry read recorded it. Any other digest
 * is a release that binds a mode by the person's role (Choreograph cad0507 and after), unless it says
 * otherwise in `host.access`.
 */
const READER_ONLY_WORKSPACE_DIGESTS: ReadonlySet<string> = new Set([
  // 2026-09-29, before the voices (`fixtures/live-20260929.ts`).
  '90aaea4b7a26cbd90a724f033e1460e7972ad2e4974d33109ee637f3b240e654',
  // 2026-10-01, the voices release (Choreograph e9a294898e8e; release queue).
  'e09c31757b98a27b684056e44d76f22d34e33d79b2b17df9be3973240d7a8181',
  // 2026-10-02 to the empowered release (Choreograph ce27144 and efc3d64; FINDINGS 2026-10-05).
  '1855ba904ada0de02fdbd12fe2b69410adbe88316a3d809da9ca7559f294eef0',
])
/** The roster of a chat that cannot offer a voice: one shared, frozen, empty list. */
const NO_MODELS: ChatModelOption[] = Object.freeze([]) as unknown as ChatModelOption[]

export interface HostedChatServiceOptions {
  readonly gatewayBaseUrl?: string
  /** Canonical graph route supplied by ShrubberyContract.runtime. */
  readonly graphBaseUrl: (graphId: string) => string
  readonly graphId: () => string | null | undefined
  readonly userId: () => string
  readonly token?: () => string | undefined
  readonly authHeaders?: () => Readonly<Record<string, string>>
  readonly fetchImpl?: typeof fetch
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  readonly storageKeyPrefix?: string
  readonly resolveAttempts?: number
  readonly resolveDelayMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  /** How long one turn's stream is followed before it is given up on as unconfirmed (default ten minutes). */
  readonly streamDeadlineMs?: number
  /** The imported-conversation archive to read when one is picked up. Default: the gateway's, when there is one. */
  readonly archive?: ConversationArchive
  /** The byte cap a window is built under. Default: {@link DEFAULT_WINDOW_LIMITS}. */
  readonly windowLimits?: WindowLimits
  /**
   * How long the reads that say what the host can do (registry, catalogue of voices, list of
   * conversations, balance) are waited for before they are given up on. Default 15 s. A message
   * being sent is never cut short by it.
   */
  readonly readTimeoutMs?: number
  /**
   * What the person has open, read at each turn: the open document's id first ("this document"), then the
   * focused block as `doc#block`, then anything else open. Sent as `contextRefs` with the first message and
   * as `payload.contextRefs` with every follow-up (the empowered-chat turn-part contract), to the workspace
   * assistant only. Absent or empty: `[]`, as before.
   */
  readonly contextRefs?: () => readonly string[]
  /** The person's role on the bound graph (the gateway's graph list), for what the chat may do here. */
  readonly role?: () => ChatWorkspaceRole | null | undefined
}

interface Cloud2ChatDescriptor {
  readonly schema: typeof DESCRIPTOR_SCHEMA
  readonly virtualId: string
  readonly graphId: string
  title: string | null
  /** The voice the person chose before the first message: '' (or the retired profile id) for no choice. */
  modelId: string
  /** The model the host reported it resolved for this conversation (what actually speaks). */
  resolvedModel?: string
  readonly clientId: string
  readonly createdAt: string
  /** When this record was last written: bookkeeping (every cursor step and every read saves it). */
  updatedAt: string
  /** When something was last really said in the conversation. What the lists are dated by. */
  activityAt?: string
  /** Set when this conversation picked up an earlier, imported one. The window itself is kept apart. */
  continuation?: ContinuationRecord
  invocationId?: string
  invocationPending?: boolean
  /** ISO time the initial invocation was sent (for reconciling a lost response). */
  invocationSubmittedAt?: string
  /** The workflow this conversation launched (or will launch) with. */
  workflowName?: typeof WORKFLOW_NAME | typeof WORKSPACE_WORKFLOW_NAME
  runId?: string
  agentSessionId?: string
  cursor: number
  initialUserText?: string
  initialUserMessageId?: string
  pendingCommand?: PendingCommand
  /**
   * What the host bound this conversation's session to, as its own record says
   * (`agentOntologyBinding.mode.iri`): the workspace Writer or Reader. Absent: not said (yet).
   */
  sessionMode?: 'write' | 'read'
}

interface PendingCommand {
  readonly commandId: string
  readonly name: 'follow_up' | 'abort'
  readonly text?: string
  /** What the person had open when it was sent (a resubmission sends exactly the same). */
  readonly contextRefs?: readonly string[]
  readonly submittedAt: number
}

/**
 * What a conversation that picked up an earlier one remembers about it. The window
 * (the messages themselves) is kept under a key of its own: this record is rewritten
 * at every step of every stream.
 */
interface ContinuationRecord {
  readonly lineage: ConversationLineage
  /** Messages in the archive revision, and how many of them the window left out. */
  readonly total: number
  readonly omitted: number
  readonly sourceVoices: readonly SourceVoice[]
  readonly firstAt: string | null
  readonly lastAt: string | null
  /** When it was picked up: the seam's date. */
  readonly pickedUpAt: string
  /** The voice named at the seam, for a person reading it before the host has answered. */
  readonly voiceLabel: string
  /** Where the window goes, worded for the voice chosen. */
  readonly providerNotice: string
}

/**
 * The turn being sent or streamed right now. While it is, the durable transcript is ahead
 * of, or level with, the stream: whatever the turn has already written there is about to be
 * delivered by the stream itself, so a re-seed of the conversation must not include it. It goes
 * up when the message is sent (before the host has answered) and comes down when the turn has
 * ended, or when the submit failed.
 */
type InFlightTurn =
  /** The first message of a conversation. */
  | { readonly kind: 'initial' }
  /** A follow-up whose command is known. */
  | { readonly kind: 'command'; readonly commandId: string }
  /**
   * A message that has been sent for but not yet accepted: the turn is on its way and nothing of
   * it is durable that the transcript can be trusted to show. It owns the cursor and its command
   * from the moment it is sent, so a read of the conversation in the gap leaves both alone.
   */
  | { readonly kind: 'submitting' }

interface WorkflowSummary {
  readonly name?: unknown
  readonly workflowUri?: unknown
  readonly definitionDigest?: unknown
  readonly inputs?: unknown
  readonly outputs?: unknown
}

interface ChatWorkflow {
  readonly name: typeof WORKFLOW_NAME | typeof WORKSPACE_WORKFLOW_NAME
  readonly workflowUri: string
  readonly definitionDigest: string
  /** The input names the registry entry declares (`inputs.properties`). */
  readonly inputs: ReadonlySet<string>
  /** What a window picked up from an earlier conversation is built under (the entry's `host.limits`, else the live host's). */
  readonly windowLimits: WindowLimits
  /** What each role's chat may do (the entry's `host.access`); null: a reader-only chat. */
  readonly access: ChatAccessAdvert | null
}

interface ChoreographErrorBody {
  readonly code: string
  readonly message: string
  /** Whatever else the envelope's error carries (a refusal for credit names the balance and the need). */
  readonly [key: string]: unknown
}

interface AgentSummary {
  readonly sessionId?: unknown
  readonly label?: unknown
  readonly agentId?: unknown
  /** The model the host resolved for this session. */
  readonly model?: unknown
}

interface ValidatedAgentSessionEvent {
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload: unknown
}

interface AgentSessionResponse {
  readonly session?: Record<string, unknown>
  readonly document?: {
    readonly source?: unknown
    readonly transcript?: {
      readonly order?: unknown
      readonly items?: unknown
    }
  }
  readonly events?: unknown
}

/** Build the production ChatService over graph-scoped gateway routes. */
export function makeHostedChatService(opts: HostedChatServiceOptions): ChatService {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) throw new Error('Hosted ChatService requires fetch.')
  const readTimeoutMs = opts.readTimeoutMs ?? READ_TIMEOUT_MS
  /**
   * A read that says what the host can do is given up on after this long. Safari before 16 has no
   * `AbortSignal.timeout`, and the registry is read on the way to every first message: without a
   * fallback such a browser could not have sent one.
   */
  const readSignal = (): AbortSignal => {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(readTimeoutMs)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), readTimeoutMs)
    return controller.signal
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)))
  let activeSlot: 0 | 1 | 2 = readActiveSlot(opts)
  const slots = readSlots(opts)
  const activeControllers = new Map<string, AbortController>()
  /** The turn each conversation's stream is following (present exactly while it is followed). */
  const inFlightTurns = new Map<string, InFlightTurn>()
  /** Graphs Choreograph reported as having no Domain Agent (this page load). */
  const unprovisionedGraphs = new Set<string>()
  /** Graphs whose host has no chat-session list (an older Choreograph or gateway): not asked again this page load. */
  const absentSessionLists = new Set<string>()
  /** Host sessions the person deleted here: the host keeps them, and its list must not bring them back. */
  const hiddenSessions = new Set(readHiddenSessions(opts))
  /** The windows of the conversations that picked up an earlier one, read from storage once each. */
  const windows = new Map<string, readonly WindowMessage[]>()
  const continuationArchive: ConversationArchive | undefined = opts.archive
    ?? (opts.gatewayBaseUrl ? createConversationArchive({ ...opts, gatewayBaseUrl: opts.gatewayBaseUrl }) : undefined)
  const descriptors = new Map<string, Cloud2ChatDescriptor>()
  for (const id of readDescriptorIndex(opts)) {
    const value = readDescriptor(opts, id)
    if (value) descriptors.set(id, value)
  }
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] != null && !descriptors.has(slots[index]!)) slots[index] = null
  }
  persistSlots(opts, activeSlot, slots)

  // ── what this chat can offer: the registry's word, never the client's hope ──
  const listeners = new Set<() => void>()
  /** What the registry advertised for one graph, once read; null before. */
  let advertised: {
    readonly graphId: string
    readonly capabilities: ChatCapabilities
    /** What a window is built under for this graph's host. */
    readonly windowLimits: WindowLimits
    /**
     * The host's workspace chat binds a mode by the person's role and takes per-turn context (the empowered
     * release): it advertises `host.access`, or its digest is not a reader-only release's. False for a
     * reader-only release, and where the registry offers no workspace chat.
     */
    readonly empowered: boolean
  } | null = null
  /** Graphs where the Domain Agent invocation was refused (403) this page load: a viewer's, most likely. */
  const domainAgentRefused = new Set<string>()
  /** The voices the catalogue offered for that graph; empty until it has answered. */
  let roster: ChatModelOption[] = NO_MODELS
  /** The service fee the catalogue's prices already include, as the catalogue words it. */
  let catalogueFeePercent: number | null = null
  let probing: { readonly graphId: string; readonly promise: Promise<ChatCapabilities> } | null = null

  function notifyListeners(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // A listener's fault is its own; it must not stop the others hearing.
      }
    }
  }

  function boundGraph(): string | null {
    return opts.graphId()?.trim() || null
  }

  function currentCapabilities(): ChatCapabilities {
    return advertised && boundGraph() === advertised.graphId ? advertised.capabilities : NO_CAPABILITIES
  }

  /** What a window is built under: the caller's own (a test's, a shell's), else what this graph's host says, else the live host's. */
  function currentWindowLimits(): WindowLimits {
    return opts.windowLimits ?? (advertised && boundGraph() === advertised.graphId ? advertised.windowLimits : DEFAULT_WINDOW_LIMITS)
  }

  /** The voices on offer right now: the roster, but only while the host says it can take a choice. */
  function offeredVoices(): ChatModelOption[] {
    return currentCapabilities().voice ? roster : NO_MODELS
  }

  function houseModelId(): string | null {
    return offeredVoices().find(model => model.house)?.id ?? null
  }

  /** What the person has open now, as references a turn may carry: id-shaped, each once, at most sixteen. */
  function currentContextRefs(): string[] {
    let raw: readonly unknown[] = []
    try {
      raw = opts.contextRefs?.() ?? []
    } catch {
      raw = []
    }
    const refs: string[] = []
    for (const item of Array.isArray(raw) ? raw : []) {
      const ref = typeof item === 'string' ? item.trim() : ''
      if (ref && CONTEXT_REF.test(ref) && !refs.includes(ref)) refs.push(ref)
      if (refs.length >= MAX_CONTEXT_REFS) break
    }
    return refs
  }

  /**
   * Whether a follow-up may carry `payload.contextRefs`: a workspace chat on a host that takes them. A session
   * bound to the Writer was made by such a host; otherwise the registry says (a reader-only release would hand
   * the unknown key to its worker verbatim, RETURN.md §5.5). Never to a known Domain Agent.
   */
  function takesTurnContext(value: Cloud2ChatDescriptor): boolean {
    if (value.workflowName === WORKFLOW_NAME) return false
    if (value.sessionMode === 'write') return true
    return advertised?.graphId === value.graphId && advertised.empowered
  }

  /** A follow-up command: the words, and what is open where the host takes it. */
  function followUpCommand(value: Cloud2ChatDescriptor, text: string): PendingCommand {
    const refs = takesTurnContext(value) ? currentContextRefs() : []
    return {
      commandId: `c2cmd:${uuid()}`,
      name: 'follow_up',
      text,
      ...(refs.length > 0 ? { contextRefs: refs } : {}),
      submittedAt: Date.now(),
    }
  }

  function currentRole(): ChatWorkspaceRole | null {
    try {
      const role = opts.role?.()
      return role === 'owner' || role === 'editor' || role === 'viewer' ? role : null
    } catch {
      return null
    }
  }

  /**
   * Remember what the host says this conversation's session may do: its document's `source.graphAccess`
   * (RETURN.md §4, the contract), else the built-in mode it was bound to (`agentOntologyBinding.mode.iri`).
   */
  function noteSessionMode(value: Cloud2ChatDescriptor, snapshot: AgentSessionResponse): void {
    const access = asRecord(asRecord(snapshot.document).source).graphAccess
    const iri = string(asRecord(asRecord(asRecord(snapshot.session).agentOntologyBinding).mode).iri)
    const mode = access === 'write' || access === 'read'
      ? access
      : iri === WORKSPACE_WRITER_MODE ? 'write' : iri === WORKSPACE_READER_MODE ? 'read' : undefined
    if (!mode || mode === value.sessionMode) return
    value.sessionMode = mode
    save(value)
    notifyListeners()
  }

  /** What Sophia may do here (see `ChatService.access`). */
  function accessFor(sessionId: string | null): ChatAccess | null {
    const graphId = boundGraph()
    if (!graphId) return null
    const role = currentRole()
    let value: Cloud2ChatDescriptor | undefined
    if (sessionId) {
      value = descriptors.get(sessionId)
      if (value && value.graphId !== graphId) return null
    }
    // A Domain Agent's powers are its own definition's: nothing is said of them here.
    if (value?.workflowName === WORKFLOW_NAME) return null
    // A person who can only view this workspace: the cell refuses every write, whatever the chat was given.
    if (role === 'viewer') return { mode: 'read', basis: 'role', role }
    // A conversation under way keeps the mode it began with (an older chat stays a Reader).
    if (value?.sessionMode) return { mode: value.sessionMode, basis: 'conversation', role }
    if (advertised?.graphId !== graphId) return null
    const advert = advertised.capabilities.access ?? null
    if (!advert && !advertised.empowered) return { mode: 'read', basis: 'backend', role }
    if (!role) return null
    // What the host advertises for the role; without an advert, the empowered release's rule (owners and
    // editors write; viewers, answered above, read: RETURN.md §1.1).
    const mode = advert ? advert[role] ?? 'read' : 'write'
    return { mode, basis: 'role', role }
  }

  /**
   * Take the registry's word for what `workspace-chat-v1` accepts. True when that
   * changed what is advertised (the caller then tells its listeners).
   */
  function absorbRegistry(graphId: string, entry: ChatWorkflow | undefined): boolean {
    const next: ChatCapabilities = Object.freeze({
      voice: entry?.inputs.has(INFERENCE_INPUT) ?? false,
      continuation: entry?.inputs.has(SEED_INPUT) ?? false,
      // Said only where the host said it: an older host's capabilities read exactly as they did.
      ...(entry?.access ? { access: entry.access } : {}),
    })
    const windowLimits = entry?.windowLimits ?? DEFAULT_WINDOW_LIMITS
    const empowered = entry !== undefined
      && (entry.access !== null || !READER_ONLY_WORKSPACE_DIGESTS.has(entry.definitionDigest))
    if (
      advertised?.graphId === graphId
      && advertised.capabilities.voice === next.voice
      && advertised.capabilities.continuation === next.continuation
      && sameAccess(advertised.capabilities.access ?? null, next.access ?? null)
      && advertised.empowered === empowered
    ) {
      advertised = { ...advertised, windowLimits }
      return false
    }
    if (advertised?.graphId !== graphId || !next.voice) roster = NO_MODELS
    advertised = { graphId, capabilities: next, windowLimits, empowered }
    return true
  }

  /**
   * The catalogue of voices: the account's, read at the gateway root with the person's own token
   * (never below a graph, never with cookies). What answers is taken only if it is the
   * catalogue; anything else, an error, a slow answer or a person who has moved to another graph
   * meanwhile leaves the roster as it was (empty on a first read: no picker).
   */
  async function loadCatalogue(graphId: string): Promise<void> {
    const gateway = opts.gatewayBaseUrl
    const token = opts.token?.()?.trim()
    if (!gateway || !token) return
    try {
      const response = await fetchImpl(new URL(VOICE_CATALOGUE_PATH, gateway).href, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        credentials: 'omit',
        signal: readSignal(),
      })
      if (!response.ok) return
      const next = parseCatalogue(await response.json())
      if (!next) return
      // The graph may have moved on while the catalogue was on its way.
      if (advertised?.graphId !== graphId || boundGraph() !== graphId) return
      // The picker is told what each voice costs against House's (and which are premium) once, here.
      roster = next.voices.length > 0 ? annotateVoices(next.voices) : NO_MODELS
      catalogueFeePercent = next.feePercent
    } catch {
      // No catalogue, no chip: the roster stays as it was (empty on a first read).
    }
  }

  /**
   * Read what the host can do for this graph (`GET /workflows`) and, when it takes a
   * voice, the catalogue. Cached per graph; concurrent calls share one read. A registry
   * that cannot be read offers nothing and is not remembered as such: it is asked again
   * next time. A catalogue that would not load is retried the same way.
   */
  function probeCapabilities(): Promise<ChatCapabilities> {
    const graphId = boundGraph()
    if (!graphId) return Promise.resolve(NO_CAPABILITIES)
    const known = advertised?.graphId === graphId
    const catalogueMissing = known && advertised!.capabilities.voice && roster.length === 0
    if (known && !catalogueMissing) return Promise.resolve(advertised!.capabilities)
    if (probing?.graphId === graphId) return probing.promise
    const promise: Promise<ChatCapabilities> = (async () => {
      if (!known) {
        let entry: ChatWorkflow | undefined
        try {
          const body = await json<{ workflows?: WorkflowSummary[] }>('/workflows', { signal: readSignal() }, graphId)
          entry = validatedWorkflow(body.workflows ?? [], WORKSPACE_WORKFLOW_NAME, WORKSPACE_WORKFLOW_URI, ['trigger'])
        } catch {
          return NO_CAPABILITIES
        }
        // The person may have moved to another graph while the registry was on its way: what it
        // said belongs to the graph it was asked about, and must not stand in for the one they are in.
        if (boundGraph() !== graphId) return NO_CAPABILITIES
        absorbRegistry(graphId, entry)
      }
      if (advertised?.graphId === graphId && advertised.capabilities.voice) await loadCatalogue(graphId)
      if (boundGraph() !== graphId) return NO_CAPABILITIES
      notifyListeners()
      return currentCapabilities()
    })().finally(() => {
      if (probing?.promise === promise) probing = null
    })
    probing = { graphId, promise }
    return promise
  }

  /** The mark for what speaks in this conversation: the model the host reported, never the one asked for. */
  function voiceMarkOf(value: Cloud2ChatDescriptor): ChatVoiceMark | null {
    return value.resolvedModel ? voiceMarkFromId(value.resolvedModel, 'live', offeredVoices()) : null
  }

  /** Remember the model the host says it resolved (it can differ from the one asked for). */
  function noteResolvedModel(value: Cloud2ChatDescriptor, raw: unknown): void {
    const model = typeof raw === 'string' ? raw.trim() : ''
    if (!model || model === value.resolvedModel) return
    value.resolvedModel = model
    save(value)
    notifyListeners()
  }

  /** The window of a conversation that picked up an earlier one, as it was shown and as it will be sent. */
  function readWindow(id: string): readonly WindowMessage[] {
    const known = windows.get(id)
    if (known) return known
    let parsed: unknown
    try {
      parsed = JSON.parse(opts.storage?.getItem(windowKey(opts, id, descriptors.get(id)?.graphId)) ?? 'null')
    } catch {
      parsed = null
    }
    const messages: WindowMessage[] = []
    for (const raw of Array.isArray(parsed) ? parsed : []) {
      const item = asRecord(raw)
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : null
      if (!role || typeof item.id !== 'string' || typeof item.text !== 'string') continue
      const voice = asRecord(item.voice)
      messages.push({
        id: item.id,
        role,
        text: item.text,
        at: number(item.at),
        ...(role === 'assistant' && typeof voice.basis === 'string' && typeof voice.label === 'string'
          ? { voice: item.voice as ChatVoiceMark }
          : {}),
      })
    }
    windows.set(id, messages)
    return messages
  }

  /**
   * Keep the window where this browser can find it again. Storage is best-effort: when it is full,
   * room is made from the windows of conversations already under way (the host holds their seed;
   * the browser only their display), oldest first; and when there is still none, the window holds
   * for this page load and no more. It never fails the conversation.
   */
  function writeWindow(id: string, messages: readonly WindowMessage[]): void {
    windows.set(id, messages)
    const storage = opts.storage
    if (!storage) return
    const value = descriptors.get(id)
    const graphId = value?.graphId
    const key = windowKey(opts, id, graphId)
    let payload: string
    try {
      payload = JSON.stringify(messages)
    } catch {
      return
    }
    const attempt = (): boolean => {
      try {
        storage.setItem(key, payload)
        return true
      } catch {
        return false
      }
    }
    if (attempt()) return
    const underWay = [...descriptors.values()]
      .filter(other => other.virtualId !== id && other.continuation && other.agentSessionId)
      .sort((left, right) => activityOf(left).localeCompare(activityOf(right)))
    for (const other of underWay) {
      try {
        storage.removeItem(windowKey(opts, other.virtualId, other.graphId))
      } catch {
        continue
      }
      if (attempt()) return
    }
  }

  function forgetWindow(id: string): void {
    windows.delete(id)
    try {
      opts.storage?.removeItem(windowKey(opts, id, descriptors.get(id)?.graphId))
    } catch {
      // Nothing to undo if storage is unavailable.
    }
  }

  /** The window as the panel renders it, ahead of everything said in the conversation itself. */
  function windowMessagesOf(value: Cloud2ChatDescriptor): ChatMessage[] {
    return value.continuation ? windowToChatMessages(readWindow(value.virtualId)) : []
  }

  function createDescriptor(input: CreateSessionOpts): Cloud2ChatDescriptor {
    const graphId = input.graphId?.trim() || currentGraphId()
    const now = new Date().toISOString()
    const value: Cloud2ChatDescriptor = {
      schema: DESCRIPTOR_SCHEMA,
      virtualId: `c2chat-${uuid()}`,
      graphId,
      title: input.title ?? null,
      modelId: input.modelId?.trim() ?? '',
      clientId: `c2chat-client-${uuid()}`,
      createdAt: now,
      updatedAt: now,
      cursor: 0,
    }
    descriptors.set(value.virtualId, value)
    persistDescriptor(opts, value)
    return value
  }

  /**
   * Put the window in the seed store: exactly what the panel showed (the same messages
   * the same way), and nothing else. The store answers with the content address of what
   * it took; only that travels with the launch. Every way this can fail leaves nothing
   * sent, and says so.
   */
  async function postSeed(value: Cloud2ChatDescriptor): Promise<SeedReceipt> {
    const messages = readWindow(value.virtualId)
    if (messages.length === 0) {
      throw new ChatServiceFailure(
        'The earlier conversation is no longer kept in this browser, so it cannot be carried over. Nothing was sent.',
        { phase: 'submit', recovery: 'none' },
      )
    }
    // `total` and `omitted` are the launch's (`seedInput`): the store's document is the messages alone.
    const payload = seedPayloadFor({ window: { messages, total: messages.length, omitted: 0 } })
    let response: Response
    try {
      response = await request(CHAT_SEEDS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }, value.graphId)
    } catch (error) {
      throw new ChatServiceFailure('The workspace could not be reached. Nothing was sent.', {
        phase: 'submit', recovery: 'resubmit', cause: error,
      })
    }
    const bodyText = await response.text().catch(() => '')
    let body: unknown
    try {
      body = bodyText ? JSON.parse(bodyText) : undefined
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const refusal = seedFailure(response.status, body)
      const transient = response.status === 429 || response.status >= 500
      throw new ChatServiceFailure(refusal.message, {
        phase: 'submit', recovery: transient ? 'resubmit' : 'none', cause: refusal,
      })
    }
    const receipt = parseSeedReceipt(body)
    if (!receipt) {
      throw new ChatServiceFailure('The conversation could not be carried over. Nothing was sent.', {
        phase: 'submit', recovery: 'resubmit',
      })
    }
    return receipt
  }

  /** Something was really said in this conversation. */
  function touchActivity(value: Cloud2ChatDescriptor): void {
    value.activityAt = new Date().toISOString()
    save(value)
  }

  /** A conversation with no title of its own is named by what was said in it, once. */
  function nameFromWhatWasSaid(value: Cloud2ChatDescriptor, text: string): void {
    if (!isGenericTitle(value.title)) return
    const title = titleFromText(value.initialUserText || text)
    if (!title) return
    value.title = title
    save(value)
  }

  function hideSession(sessionId: string): void {
    hiddenSessions.add(sessionId)
    try {
      opts.storage?.setItem(storageKey(opts, 'hidden-sessions'), JSON.stringify([...hiddenSessions]))
    } catch {
      // The in-memory set still holds for this page load.
    }
  }

  /** The host's chat sessions for a graph; [] when it has no list, cannot be read now, or says nothing. */
  async function hostSessionRows(graphId: string): Promise<SessionRow[]> {
    if (absentSessionLists.has(graphId)) return []
    try {
      const response = await request(
        `${CHAT_SESSIONS_PATH}&limit=${SESSION_LIST_LIMIT}`,
        { headers: { accept: 'application/json' }, signal: readSignal() },
        graphId,
      )
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        absentSessionLists.add(graphId)
        return []
      }
      if (!response.ok) return []
      return parseSessionList(await response.json())
    } catch {
      return []
    }
  }

  /**
   * A conversation this browser did not start becomes one it can open: a descriptor
   * bound to the host's session. Local, idempotent by session id, and a launch is never
   * repeated (the session already exists).
   */
  function adoptSession(row: SessionRow, graphId: string): Cloud2ChatDescriptor {
    const now = new Date().toISOString()
    const value: Cloud2ChatDescriptor = {
      schema: DESCRIPTOR_SCHEMA,
      virtualId: `c2chat-${uuid()}`,
      graphId,
      title: row.title,
      modelId: '',
      ...(row.model ? { resolvedModel: row.model } : {}),
      clientId: `c2chat-client-${uuid()}`,
      createdAt: isoOf(row.createdAt) ?? now,
      updatedAt: now,
      activityAt: isoOf(row.updatedAt) ?? isoOf(row.createdAt) ?? now,
      ...(row.runId ? { runId: row.runId } : {}),
      agentSessionId: row.sessionId,
      cursor: 0,
    }
    descriptors.set(value.virtualId, value)
    persistDescriptor(opts, value)
    return value
  }

  function currentGraphId(): string {
    const graphId = opts.graphId()?.trim()
    if (!graphId) throw new ChatServiceFailure('Hosted chat requires a bound graph.', {
      phase: 'conversation-load',
      recovery: 'retry-load',
    })
    return graphId
  }

  function graphBase(graphId = currentGraphId()): string {
    const base = opts.graphBaseUrl(graphId).trim().replace(/\/+$/, '')
    if (!base) throw new Error(`No gateway graph route is available for ${graphId}.`)
    return base
  }

  function requestHeaders(extra?: Readonly<Record<string, string>>): Headers {
    const headers = new Headers(opts.authHeaders?.() ?? {})
    const token = opts.token?.()?.trim()
    if (token) headers.set('authorization', `Bearer ${token}`)
    for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value)
    return headers
  }

  async function request(path: string, init: RequestInit = {}, graphId?: string): Promise<Response> {
    return fetchImpl(`${graphBase(graphId)}${path}`, {
      ...init,
      headers: requestHeaders(init.headers as Readonly<Record<string, string>> | undefined),
    })
  }

  async function json<T>(path: string, init: RequestInit = {}, graphId?: string): Promise<T> {
    const response = await request(path, init, graphId)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}${body ? ` ${body}` : ''}`)
    }
    if (response.status === 204) return undefined as T
    const body = await response.text()
    return (body ? JSON.parse(body) : undefined) as T
  }

  function descriptor(id: string): Cloud2ChatDescriptor {
    if (!VIRTUAL_ID.test(id)) {
      throw new ChatServiceFailure(`Refusing non-Cloud-2 chat id '${id}'.`, {
        phase: 'conversation-load',
        recovery: 'none',
      })
    }
    const value = descriptors.get(id) ?? readDescriptor(opts, id)
    if (!value) {
      throw new ChatServiceFailure(`Cloud-2 chat '${id}' is not available.`, {
        phase: 'conversation-load',
        recovery: 'retry-load',
      })
    }
    if (value.graphId !== currentGraphId()) {
      throw new ChatServiceFailure('Stored chat belongs to a different graph.', {
        phase: 'conversation-load',
        recovery: 'none',
      })
    }
    if (value.agentSessionId && !AGENT_SESSION_ID.test(value.agentSessionId)) {
      throw new ChatServiceFailure('Stored chat has an invalid Agent Session binding.', {
        phase: 'conversation-load',
        recovery: 'none',
      })
    }
    return value
  }

  function save(value: Cloud2ChatDescriptor): void {
    value.updatedAt = new Date().toISOString()
    descriptors.set(value.virtualId, value)
    persistDescriptor(opts, value)
  }

  /**
   * Whether this browser found, within the last few minutes, that the graph has no
   * Domain Agent. Choreograph says so with a 404 the first time a conversation is
   * launched there; without this memory every page load would spend that 404 (and
   * leave a red console line) before falling back to the built-in assistant. The
   * memory is short because a definition can be added to the graph at any time.
   */
  function rememberedNoDomainAgent(graphId: string): boolean {
    try {
      const raw = opts.storage?.getItem(noDomainAgentKey(opts, graphId))
      if (!raw) return false
      const at = Date.parse(raw)
      return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < NO_DOMAIN_AGENT_TTL_MS
    } catch {
      return false
    }
  }

  function rememberNoDomainAgent(graphId: string): void {
    unprovisionedGraphs.add(graphId)
    try {
      opts.storage?.setItem(noDomainAgentKey(opts, graphId), new Date().toISOString())
    } catch {
      // Best effort: the in-memory set above still holds for this page load.
    }
  }

  function forgetNoDomainAgent(graphId: string): void {
    unprovisionedGraphs.delete(graphId)
    try {
      opts.storage?.removeItem(noDomainAgentKey(opts, graphId))
    } catch {
      // Nothing to undo if storage is unavailable.
    }
  }

  async function discoverWorkflows(value: Cloud2ChatDescriptor): Promise<{
    readonly domain?: ChatWorkflow
    readonly workspace?: ChatWorkflow
  }> {
    const body = await json<{ workflows?: WorkflowSummary[] }>('/workflows', { signal: readSignal() }, value.graphId)
    const workflows = body.workflows ?? []
    const domain = validatedWorkflow(workflows, WORKFLOW_NAME, WORKFLOW_URI,
      ['definitionDocumentId', 'trigger', 'contextRefs'])
    const workspace = validatedWorkflow(workflows, WORKSPACE_WORKFLOW_NAME, WORKSPACE_WORKFLOW_URI, ['trigger'])
    // The registry is read at every launch; what it says now is what the host can do now.
    if (value.graphId === boundGraph() && absorbRegistry(value.graphId, workspace)) notifyListeners()
    return { domain, workspace }
  }

  function chooseWorkflow(
    value: Cloud2ChatDescriptor,
    available: { readonly domain?: ChatWorkflow; readonly workspace?: ChatWorkflow },
  ): ChatWorkflow {
    // A conversation that picked up an earlier one belongs to the workspace assistant for good:
    // it is the only workflow that takes the window, and a refused launch (credit, price, a
    // provider down) must not turn the retry into a Domain Agent one that can never carry it.
    const preferWorkspace = value.workflowName === WORKSPACE_WORKFLOW_NAME
      || value.continuation !== undefined
      || unprovisionedGraphs.has(value.graphId)
      || domainAgentRefused.has(value.graphId)
      || rememberedNoDomainAgent(value.graphId)
    const chosen = preferWorkspace
      ? available.workspace ?? available.domain
      : available.domain ?? available.workspace
    if (!chosen) {
      throw new ChatServiceFailure('Chat is not available: the runtime offers no chat workflow for this workspace.', {
        phase: 'submit',
        recovery: 'none',
      })
    }
    return chosen
  }

  /**
   * A launch whose response was lost leaves the descriptor pending with no run.
   * Choreograph keeps no invocation lookup, but its run list is enough: after a
   * grace period, no chat run for this graph since the submission means the
   * invocation never started; exactly one unclaimed run means it did.
   * Returns true when the descriptor was settled either way.
   */
  async function reconcileUnresolvedLaunch(value: Cloud2ChatDescriptor): Promise<boolean> {
    if (!value.invocationPending || value.runId) return false
    const submittedAt = Date.parse(value.invocationSubmittedAt ?? value.updatedAt)
    if (!Number.isFinite(submittedAt) || Date.now() - submittedAt < LAUNCH_RECONCILE_AFTER_MS) return false
    let runs: Record<string, unknown>[]
    try {
      const since = Math.max(0, submittedAt - 60_000)
      const body = await json<{ runs?: Record<string, unknown>[] }>(
        `/workflows/runs?graph_id=${encodeURIComponent(value.graphId)}&since=${since}&limit=100`,
        {},
        value.graphId,
      )
      runs = Array.isArray(body.runs) ? body.runs : []
    } catch {
      return false
    }
    const claimed = new Set([...descriptors.values()].map(other => other.runId).filter(Boolean))
    const candidates = runs.filter(run =>
      (run.workflowName === WORKFLOW_NAME || run.workflowName === WORKSPACE_WORKFLOW_NAME)
      && run.graphId === value.graphId
      && typeof run.runId === 'string'
      && !claimed.has(run.runId)
      && number(run.startedAt) >= submittedAt - 60_000)
    if (candidates.length === 1) {
      value.runId = candidates[0].runId as string
      value.invocationPending = false
      save(value)
      return true
    }
    if (candidates.length === 0) {
      resetUnstartedLaunch(value)
      return true
    }
    return false
  }

  /** The initial invocation definitely did not start: make the conversation sendable again. */
  function resetUnstartedLaunch(value: Cloud2ChatDescriptor): void {
    value.invocationPending = false
    value.invocationId = undefined
    value.invocationSubmittedAt = undefined
    value.initialUserText = undefined
    value.initialUserMessageId = undefined
    save(value)
  }

  async function launch(value: Cloud2ChatDescriptor, text: string): Promise<void> {
    if (value.invocationPending && !value.runId) {
      await reconcileUnresolvedLaunch(value)
      if (value.runId) return
      if (value.invocationPending) {
        throw new ChatServiceFailure(
          'The first message may still be starting and cannot be confirmed yet. Check again shortly, or start a new chat.',
          { phase: 'submit', recovery: 'reconcile' },
        )
      }
    }
    let available: Awaited<ReturnType<typeof discoverWorkflows>>
    try {
      available = await discoverWorkflows(value)
    } catch (error) {
      // A registry that did not answer in time is the workspace not answering: said so, in words, with
      // nothing sent; any other refusal keeps its own account.
      if (isTimeout(error)) {
        throw new ChatServiceFailure('The workspace did not answer in time. Nothing was sent. Try again in a moment.', {
          phase: 'submit', recovery: 'resubmit', cause: error,
        })
      }
      throw error
    }
    let workflow = chooseWorkflow(value, available)
    let seed: SeedReceipt | null = null
    if (value.continuation) {
      // A conversation that picks up an earlier one goes only to the workspace assistant,
      // and only where the registry says it takes a seed: a Domain Agent, or a host that
      // has stopped advertising it, would drop the window and answer a plain chat while
      // the person believed it had been carried over. Refused before anything is sent.
      if (workflow.name !== WORKSPACE_WORKFLOW_NAME || !workflow.inputs.has(SEED_INPUT)) {
        throw new ChatServiceFailure(CANNOT_CONTINUE, { phase: 'submit', recovery: 'none' })
      }
      seed = await postSeed(value)
    }
    let outcome = await postInvocation(value, workflow, text, seed)
    if (outcome.state === 'rejected'
      && (outcome.error?.code === NOT_PROVISIONED || outcome.status === 403)
      && workflow.name === WORKFLOW_NAME
      && available.workspace) {
      if (outcome.status === 403) {
        // The Domain Agent is not this person's to start (a viewer: the gateway or Choreograph's
        // `workflow_role_insufficient`, RETURN.md §4): the built-in assistant is, for this page load.
        domainAgentRefused.add(value.graphId)
      } else {
        // No Domain Agent in this graph: use the built-in workspace assistant, and
        // remember it so the next page load does not spend the same 404.
        rememberNoDomainAgent(value.graphId)
      }
      workflow = available.workspace
      outcome = await postInvocation(value, workflow, text, seed)
    }
    if (outcome.state === 'rejected') throw outcome.failure
    if (workflow.name === WORKFLOW_NAME) forgetNoDomainAgent(value.graphId)
    await bindAgentSession(value)
  }

  /**
   * What a launch carries to pick up an earlier conversation: the seed by reference (the window as counts, where it
   * came from) and the title the conversation was given, never one derived from the seed. `kept` is how many messages
   * the store holds for this seed, which the host checks; the rest of the conversation is what was not carried.
   */
  function continuationInput(
    value: Cloud2ChatDescriptor,
    record: NonNullable<Cloud2ChatDescriptor['continuation']>,
    seed: SeedReceipt,
  ): Record<string, unknown> {
    const kept = readWindow(value.virtualId).length
    if (kept < 1 || record.total < kept) {
      throw new ChatServiceFailure(
        'The earlier conversation is no longer kept in this browser, so it cannot be carried over. Nothing was sent.',
        { phase: 'submit', recovery: 'none' },
      )
    }
    const title = isGenericTitle(value.title) ? null : capTitle(value.title!)
    return {
      ...(title ? { title } : {}),
      seed: seedInput(
        seed,
        { archiveConversationUrn: record.lineage.archiveConversationUrn, revisionId: record.lineage.revisionId },
        { kept, omitted: record.total - kept, total: record.total },
        title,
      ),
    }
  }

  async function postInvocation(
    value: Cloud2ChatDescriptor,
    workflow: ChatWorkflow,
    text: string,
    seed: SeedReceipt | null = null,
  ): Promise<{ readonly state: 'accepted' } | {
    readonly state: 'rejected'
    readonly failure: ChatServiceFailure
    readonly error?: ChoreographErrorBody
    /** The refusal's HTTP status (a 403 from the Domain Agent invocation falls back like a 404). */
    readonly status: number
  }> {
    const suffix = value.virtualId.slice('c2chat-'.length)
    const workspace = workflow.name === WORKSPACE_WORKFLOW_NAME
    // The voice goes only where the registry says it will be read (an older host drops
    // a key it does not know, and the person would believe they had chosen), and not
    // for the House default, which is what the host runs when it is not told.
    const chosen = workspace ? chosenModelOf(value) : null
    // Where the catalogue says the House default would itself be refused, a message that names no
    // voice would be refused by the host in words about the workspace waking up: ask for a choice
    // instead, before anything is sent.
    if (workspace && chosen === null && workflow.inputs.has(INFERENCE_INPUT)
      && offeredVoices().length > 0 && houseModelId() === null) {
      throw new ChatServiceFailure('Choose a voice before you send your first message.', {
        phase: 'submit', recovery: 'none',
      })
    }
    const voice = chosen && workflow.inputs.has(INFERENCE_INPUT) && chosen !== houseModelId()
      ? inferenceInput(chosen)
      : null
    // A fresh invocation id per workflow attempt: a rejected attempt never ran.
    const invocationId = `c2chat.inv.${suffix}${workspace ? '.ws' : ''}`
    const eventId = `c2chat.event.${suffix}`
    // The published sophia-1 definition admits headed chat only inside its
    // graph-scoped source fence (`graph:<graph>:...`).
    const resource = `graph:${value.graphId}:chat:${value.virtualId}`
    const trigger = { kind: 'sophia-cluster.message', eventId, resource, text }
    value.workflowName = workflow.name
    value.invocationId = invocationId
    value.invocationPending = true
    value.invocationSubmittedAt = new Date().toISOString()
    value.initialUserText = text
    value.initialUserMessageId = `${value.virtualId}:initial-user`
    save(value)

    let response: Response
    try {
      response = await request('/invocations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          prefer: 'respond-async',
        },
        body: JSON.stringify({
          schema: 'choreograph.invocation-envelope.v1',
          invocationId,
          target: {
            workflowName: workflow.name,
            workflowUri: workflow.workflowUri,
            definitionDigest: workflow.definitionDigest,
          },
          input: workspace
            ? {
              trigger,
              // What the person has open ("this document" is the first): the turn-part contract.
              contextRefs: currentContextRefs(),
              interactionMode: 'headed',
              ...(voice ? { inference: voice } : {}),
              ...(seed && value.continuation ? continuationInput(value, value.continuation, seed) : {}),
            }
            : {
              definitionDocumentId: DEFINITION_DOCUMENT_ID,
              trigger,
              contextRefs: [],
              interactionMode: 'headed',
            },
          actorRef: canonicalActor(opts.userId()),
          graph: { graphId: value.graphId },
          cause: { kind: 'trigger', ref: resource },
          idempotencyKey: `sophia-cluster:${value.virtualId}${workspace ? ':ws' : ''}`,
        }),
      }, value.graphId)
    } catch (error) {
      throw new ChatServiceFailure(
        'The first message was sent but no answer came back. Check again shortly, or start a new chat.',
        { phase: 'submit', recovery: 'reconcile', cause: error },
      )
    }
    if (response.status !== 202) {
      const bodyText = await response.text().catch(() => '')
      const error = choreographError(bodyText)
      // A 4xx, or any response carrying Choreograph's coded error envelope, is
      // a verdict given before a run existed: nothing committed.
      const definitive = (response.status >= 400 && response.status < 500) || error !== undefined
      if (!definitive) {
        throw new ChatServiceFailure(
          `POST /invocations → ${response.status}${bodyText ? ` ${bodyText}` : ''}`,
          { phase: 'submit', recovery: 'reconcile' },
        )
      }
      resetUnstartedLaunch(value)
      // A picked-up conversation stays pinned to the workspace assistant; any other is chosen afresh.
      value.workflowName = value.continuation ? WORKSPACE_WORKFLOW_NAME : undefined
      save(value)
      // A refusal about credits or pricing has its own kind and its own words: it is the
      // platform's answer about this person's account, not a fault of the workspace.
      const billing = billingRefusalOfResponse(response.status, error)
      const retryable = response.status === 429 || response.status >= 500
        || (error?.code.endsWith('_unavailable') ?? false)
      return {
        state: 'rejected',
        status: response.status,
        ...(error ? { error } : {}),
        failure: billing
          ? new ChatBillingFailure(billingFailureMessage(billing), {
            billing,
            phase: 'submit',
            recovery: billing.kind === 'provider_unavailable' ? 'resubmit' : 'none',
          })
          : new ChatServiceFailure(launchFailureMessage(response.status, error, bodyText), {
            phase: 'submit',
            recovery: retryable ? 'resubmit' : 'none',
          }),
      }
    }
    const body = await response.json() as Record<string, unknown>
    if (body.invocationId !== invocationId || typeof body.runId !== 'string' || !body.runId) {
      throw new ChatServiceFailure('Async invocation response omitted its stable run identity.', {
        phase: 'submit',
        recovery: 'reconcile',
      })
    }
    value.runId = body.runId
    value.invocationPending = false
    save(value)
    return { state: 'accepted' }
  }

  /**
   * Bind the conversation to the Agent Session its run started. Whoever asks first binds it; a
   * second caller that was waiting for the same answer takes it as it finds it, and above all
   * does not send the cursor back to zero under a stream that is already reading.
   */
  async function bindAgentSession(value: Cloud2ChatDescriptor): Promise<void> {
    const sessionId = await resolveAgentSession(value)
    if (value.agentSessionId) return
    value.agentSessionId = sessionId
    value.cursor = 0
    save(value)
  }

  async function resolveAgentSession(value: Cloud2ChatDescriptor): Promise<string> {
    const attempts = Math.max(1, opts.resolveAttempts ?? 120)
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const body = await json<{ agents?: AgentSummary[] }>(
        `/workflows/runs/${encodeURIComponent(value.runId ?? '')}/agents`,
        {},
        value.graphId,
      ).catch(error => {
        if (attempt + 1 === attempts) throw error
        return { agents: [] }
      })
      const intended = (body.agents ?? []).filter(agent =>
        agent.label === 'pilot-headed'
        && typeof agent.sessionId === 'string'
        && AGENT_SESSION_ID.test(agent.sessionId),
      )
      if (intended.length > 1) throw new Error('Workflow exposed multiple headed pilot Sessions.')
      if (intended.length === 1) {
        // The host says which model it resolved the moment the session exists.
        noteResolvedModel(value, intended[0].model)
        return intended[0].sessionId as string
      }
      await sleep(opts.resolveDelayMs ?? 250)
    }
    throw new ChatServiceFailure('Timed out resolving the headed pilot Agent Session.', {
      phase: 'conversation-load',
      recovery: 'reconcile',
    })
  }

  async function claimDriver(value: Cloud2ChatDescriptor): Promise<void> {
    const sessionId = value.agentSessionId
    if (!sessionId) throw new Error('Agent Session has not been resolved.')
    const response = await request(`/agent-sessions/${encodeURIComponent(sessionId)}/driver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'claim', clientId: value.clientId, ts: Date.now() }),
    }, value.graphId)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new ChatServiceFailure(
        `Driver claim failed (${response.status})${body ? `: ${body}` : ''}`,
        { phase: 'submit', recovery: 'none' },
      )
    }
  }

  async function listCommands(value: Cloud2ChatDescriptor): Promise<Record<string, unknown>[]> {
    const body = await json<{ commands?: Record<string, unknown>[] }>(
      `/agent-sessions/${encodeURIComponent(value.agentSessionId ?? '')}/commands`,
      {},
      value.graphId,
    )
    return body.commands ?? []
  }

  async function submitCommand(value: Cloud2ChatDescriptor, command: PendingCommand): Promise<void> {
    const sessionId = value.agentSessionId
    if (!sessionId) throw new Error('Agent Session has not been resolved.')
    await claimDriver(value)
    value.pendingCommand = command
    save(value)
    // A follow-up being sent is now a known command: a read in the gap before the host answers
    // shows the conversation as far as the person's own message, and no further.
    if (command.name === 'follow_up' && inFlightTurns.has(value.virtualId)) {
      inFlightTurns.set(value.virtualId, { kind: 'command', commandId: command.commandId })
    }
    const path = `/agent-sessions/${encodeURIComponent(sessionId)}/commands`
    const body = {
      clientId: value.clientId,
      commandId: command.commandId,
      idempotencyKey: command.commandId,
      name: command.name,
      payload: command.name === 'follow_up'
        ? { text: command.text, ...(command.contextRefs?.length ? { contextRefs: [...command.contextRefs] } : {}) }
        : {},
    }
    let response: Response
    try {
      response = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }, value.graphId)
    } catch (error) {
      const commands = await listCommands(value).catch(() => [])
      if (!commands.some(row => commandRecordId(row) === command.commandId)) {
        throw new ChatServiceFailure('Command response was lost and durable state could not be reconciled.', {
          phase: 'submit', recovery: 'reconcile', cause: error,
        })
      }
      return
    }
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '')
      const billing = billingRefusalOfResponse(response.status, choreographError(responseBody))
      if (billing) {
        // Refused before anything was accepted: nothing to reconcile, and nothing left
        // parked, so the same words can go as a fresh follow-up once the platform allows.
        value.pendingCommand = undefined
        save(value)
        throw new ChatBillingFailure(billingFailureMessage(billing), {
          billing,
          phase: 'submit',
          recovery: billing.kind === 'provider_unavailable' ? 'resubmit' : 'none',
        })
      }
      if (response.status === 409) {
        throw new ChatServiceFailure(
          `Agent Session command was rejected: ${responseBody || 'not_driver'}`,
          { phase: 'submit', recovery: 'none' },
        )
      }
      const coded = choreographError(responseBody)
      if (response.status === 400 && coded?.code === 'context_refs_invalid' && command.contextRefs?.length) {
        // The host would not take what is open (nothing was stored): send the words alone, once.
        const { contextRefs: _dropped, ...plain } = command
        await submitCommand(value, plain)
        return
      }
      if (response.status === 403) {
        // Refused before anything was stored: nothing to reconcile, and nothing left parked.
        if (value.pendingCommand?.commandId === command.commandId) {
          value.pendingCommand = undefined
          save(value)
        }
        throw new ChatServiceFailure(commandRefusalMessage(coded?.code), { phase: 'submit', recovery: 'none' })
      }
      throw new ChatServiceFailure(
        `POST ${path} → ${response.status}${responseBody ? ` ${responseBody}` : ''}`,
        { phase: 'submit', recovery: 'reconcile' },
      )
    }
  }

  async function resumePendingCommand(value: Cloud2ChatDescriptor): Promise<void> {
    const pending = value.pendingCommand
    if (!pending) return
    const commands = await listCommands(value)
    if (commands.some(row => commandRecordId(row) === pending.commandId)) return
    // Unlike initial Invocation, this POST is server-idempotent by commandId.
    await submitCommand(value, pending)
  }

  async function reconcilePendingCommand(value: Cloud2ChatDescriptor): Promise<{
    readonly state: 'none' | 'pending' | 'completed' | 'failed'
    readonly failure?: ChatServiceFailure
  }> {
    const pending = value.pendingCommand
    if (!pending) return { state: 'none' }
    const row = (await listCommands(value)).find(command => commandRecordId(command) === pending.commandId)
    if (!row) return { state: 'pending' }
    const state = commandRecordState(row)
    if (state === 'completed') {
      return { state: 'completed' }
    }
    if (state === 'failed' || state === 'cancelled' || state === 'rejected') {
      // The list was on its way while a newer command may have taken the place: clear only the one it read.
      if (value.pendingCommand?.commandId === pending.commandId) {
        value.pendingCommand = undefined
        save(value)
      }
      const detail = string(row.error) || string(row.reason) || state
      // A call the balance could not pay for is said as the banner, not as a failure string.
      const billing = billingRefusalOfTurnFailure(detail)
      return {
        state: 'failed',
        failure: billing
          ? new ChatBillingFailure(billingFailureMessage(billing), { billing, phase: 'stream', recovery: 'none' })
          : new ChatServiceFailure(`Agent Session command ${state}: ${detail}`, {
            phase: 'stream', recovery: 'none',
          }),
      }
    }
    return { state: 'pending' }
  }

  async function readAgentSession(value: Cloud2ChatDescriptor): Promise<AgentSessionResponse> {
    const snapshot = await json<AgentSessionResponse>(
      `/agent-sessions/${encodeURIComponent(value.agentSessionId ?? '')}`,
      {},
      value.graphId,
    )
    noteResolvedModel(value, snapshot.session?.model ?? asRecord(snapshot.session?.result).model)
    noteSessionMode(value, snapshot)
    return snapshot
  }

  /** Everything durable after the cursor, through the JSON face, oldest first. */
  async function pollEvents(value: Cloud2ChatDescriptor): Promise<ValidatedAgentSessionEvent[]> {
    const body = await json<unknown>(
      `/agent-sessions/${encodeURIComponent(value.agentSessionId ?? '')}/events?since=${value.cursor}`,
      {},
      value.graphId,
    ).catch(() => [])
    const raw = Array.isArray(body)
      ? body
      : (Array.isArray(asRecord(body).events) ? asRecord(body).events as unknown[] : [])
    return raw
      .map(asAgentSessionEvent)
      .filter((event): event is ValidatedAgentSessionEvent => event !== null && event.seq > value.cursor)
      .sort((left, right) => left.seq - right.seq)
  }

  /**
   * Follow one turn to its durable end.
   *
   * THE CURSOR IS OWNED BY THIS STREAM. It advances over an event only when the
   * event has been taken and its projection emitted, and never on the strength of
   * a session snapshot: a snapshot read between two of the host's short-lived SSE
   * connections holds events the stream has not delivered, and skipping the cursor
   * over them silently cut replies short ("Read" for "Read and search workspace").
   * Whatever became durable after the stream closed is read back, in order, through
   * the JSON face before the turn is called complete.
   */
  async function streamTurn(
    value: Cloud2ChatDescriptor,
    controller: AbortController,
    emit: (event: ChatEvent) => void,
  ): Promise<ChatTurnOutcome> {
    let workerFailed: ChatServiceFailure | undefined
    let emittedDone = false
    const startedAt = Date.now()
    const deadlineMs = opts.streamDeadlineMs ?? DEFAULT_STREAM_DEADLINE_MS
    // While nothing moves the host is asked less and less often; whatever moves starts it over.
    const baseDelayMs = opts.resolveDelayMs ?? 250
    const delayCapMs = Math.max(baseDelayMs, MAX_IDLE_DELAY_MS)
    let idleDelayMs = baseDelayMs

    /** Take one durable event. True when the stream should stop reading here. */
    const take = (event: ValidatedAgentSessionEvent): boolean => {
      if (event.seq <= value.cursor) return false
      value.cursor = event.seq
      save(value)
      const projected = projectAgentSessionEvent(event)
      if (projected) {
        emit(projected)
        if (projected.type === 'done') emittedDone = true
      }
      const eventFailure = agentSessionEventFailure(event)
      if (eventFailure) {
        workerFailed = eventFailure
        if (eventFailure instanceof ChatBillingFailure) {
          // A call the balance could not pay for ends this turn for good. The message is in
          // the conversation and the failure is about to be said: the next message is a new
          // one, not the settlement of this command (which would answer it with this failure).
          value.pendingCommand = undefined
          save(value)
        }
        return true
      }
      return isRelevantDurableTerminalEvent(event, value.pendingCommand?.commandId)
    }

    /** Read whatever is durable after the cursor, oldest first, until nothing newer is. */
    const catchUp = async (): Promise<void> => {
      for (let round = 0; round < MAX_CATCH_UP_ROUNDS; round += 1) {
        const events = await pollEvents(value)
        if (events.length === 0) return
        for (const event of events) if (take(event)) return
      }
    }

    const latestAssistant = (snapshot: AgentSessionResponse): ChatMessage | undefined =>
      [...projectAgentSessionMessages(snapshot, value)].reverse().find(message => message.role === 'assistant')

    try {
      while (!controller.signal.aborted && Date.now() - startedAt < deadlineMs) {
        const cursorBefore = value.cursor
        const path = `/agent-sessions/${encodeURIComponent(value.agentSessionId ?? '')}/events?since=${value.cursor}`
        const response = await request(path, {
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        }, value.graphId)
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`GET Agent Session events → ${response.status}${body ? ` ${body}` : ''}`)
        }
        const reader = response.body?.getReader()
        if (reader) {
          try {
            for await (const frame of parseSse(reader)) {
              const event = asAgentSessionEvent(frame.data)
              if (event && take(event)) break
            }
          } finally {
            await reader.cancel().catch(() => undefined)
          }
        }
        if (controller.signal.aborted) return { state: 'aborted' }
        if (workerFailed) return { state: 'failed', failure: workerFailed }

        // Session GET is the canonical transcript authority. For follow-ups the
        // durable command ledger must terminalize too; worker message.completed
        // can precede both and therefore never settles the handle by itself.
        let snapshot = await readAgentSession(value)
        const durableFailure = agentSessionFailure(snapshot)
        if (durableFailure) {
          emit({ type: 'error', message: durableFailure.message })
          return { state: 'failed', failure: durableFailure }
        }
        const pending = value.pendingCommand
        if (pending) {
          const command = await reconcilePendingCommand(value)
          if (command.state === 'failed') {
            // The ledger can say `failed` before this stream has read WHY: the stream closed,
            // and the host's `turn.failed` is durable but past the cursor. Read it first, so a
            // refusal for credit is the banner's and not "Agent Session command failed: failed".
            await catchUp()
            if (workerFailed) return { state: 'failed', failure: workerFailed }
            // A refusal for credit is the banner's to say: no error in the bubble.
            if (!(command.failure instanceof ChatBillingFailure)) {
              emit({ type: 'error', message: command.failure!.message })
            }
            return { state: 'failed', failure: command.failure! }
          }
          if (command.state === 'completed') {
            snapshot = await readAgentSession(value)
            if (transcriptCompletesCommand(snapshot, pending.commandId)) {
              await catchUp()
              if (workerFailed) return { state: 'failed', failure: workerFailed }
              const assistant = latestAssistant(snapshot)
              if (!emittedDone && assistant) emit({ type: 'done', output: assistant.content })
              value.pendingCommand = undefined
              save(value)
              return { state: 'completed' }
            }
          }
        } else {
          const assistant = latestAssistant(snapshot)
          if (assistant && isTerminalSessionStatus(sessionStatus(snapshot))) {
            await catchUp()
            if (workerFailed) return { state: 'failed', failure: workerFailed }
            if (!emittedDone) emit({ type: 'done', output: assistant.content })
            save(value)
            return { state: 'completed' }
          }
        }

        // Not over yet. A restartable/passivated stream may close before the command
        // event is visible on this cursor: read the JSON face, then reopen SSE.
        await catchUp()
        if (workerFailed) return { state: 'failed', failure: workerFailed }
        // Pause a while when nothing moved, a little longer each time; while events are flowing, only yield.
        if (value.cursor === cursorBefore) {
          await sleep(idleDelayMs)
          idleDelayMs = Math.min(delayCapMs, idleDelayMs * 2)
        } else {
          idleDelayMs = baseDelayMs
          await sleep(0)
        }
      }
      if (controller.signal.aborted) return { state: 'aborted' }
      const failure = new ChatServiceFailure(
        'Agent Session stream ended before durable transcript completion.',
        { phase: 'stream', recovery: 'reconcile' },
      )
      emit({ type: 'error', message: failure.message })
      return { state: 'failed', failure }
    } catch (error) {
      if (controller.signal.aborted) return { state: 'aborted' }
      await readAgentSession(value).then(snapshot => {
        value.cursor = Math.max(value.cursor, maxEventCursor(snapshot.events))
        save(value)
      }).catch(() => undefined)
      const failure = error instanceof ChatServiceFailure
        ? error
        : new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
          phase: 'stream', recovery: 'reconcile', cause: error,
        })
      emit({ type: 'error', message: failure.message })
      return { state: 'failed', failure }
    }
  }

  /**
   * Get one message to the host: launch the conversation with it, or send it as a follow-up.
   * Everything that can be refused is refused here, before a stream exists.
   */
  async function submitTurn(value: Cloud2ChatDescriptor, text: string): Promise<void> {
    if (!value.agentSessionId) {
      if (value.runId) {
        await bindAgentSession(value)
      } else {
        if (value.invocationPending) await reconcileUnresolvedLaunch(value)
        if (value.runId) {
          // The lost launch did start: bind its session, then send this text as a follow-up.
          await bindAgentSession(value)
          if (value.initialUserText !== text) {
            await submitCommand(value, followUpCommand(value, text))
          }
        } else {
          if (value.invocationPending && value.initialUserText && value.initialUserText !== text) {
            throw new ChatServiceFailure(
              'The first message may still be starting and cannot be confirmed yet. Check again shortly, or start a new chat.',
              { phase: 'submit', recovery: 'reconcile' },
            )
          }
          await launch(value, text)
        }
      }
    } else if (value.pendingCommand) {
      const reconciliation = await reconcilePendingCommand(value)
      if (reconciliation.state === 'failed') throw reconciliation.failure
      if (reconciliation.state === 'completed') {
        value.pendingCommand = undefined
        save(value)
        await submitCommand(value, followUpCommand(value, text))
      } else if (value.pendingCommand.name !== 'follow_up'
        || value.pendingCommand.text?.trim() !== text) {
        throw new ChatServiceFailure(
          'A previous durable command still requires reconciliation before another message.',
          { phase: 'submit', recovery: 'reconcile' },
        )
      } else {
        await resumePendingCommand(value)
      }
    } else {
      await submitCommand(value, followUpCommand(value, text))
    }
  }

  async function abortSession(value: Cloud2ChatDescriptor): Promise<void> {
    if (!value.agentSessionId) return
    const pending = value.pendingCommand
    if (pending && pending.name !== 'abort') {
      await request(
        `/agent-sessions/${encodeURIComponent(value.agentSessionId)}/commands/${encodeURIComponent(pending.commandId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: value.clientId }),
        },
        value.graphId,
      ).catch(() => undefined)
    }
    const abort: PendingCommand = {
      commandId: `c2abort:${uuid()}`,
      name: 'abort',
      submittedAt: Date.now(),
    }
    await submitCommand(value, abort)
  }

  return {
    get activeSlot() { return activeSlot },
    archive: continuationArchive,

    async createSession(input: CreateSessionOpts = {}): Promise<SessionSummary> {
      return descriptorSummary(createDescriptor(input))
    },

    async listSessions(): Promise<SessionSummary[]> {
      return [...descriptors.values()]
        .sort((left, right) => activityOf(right).localeCompare(activityOf(left)))
        .map(descriptorSummary)
    },

    /**
     * The live half of the one conversation home: what the host lists for this graph
     * (the same on every device) together with what this browser holds, newest first.
     * A host with no list, or one that cannot be read now, leaves this browser's own.
     * Dated by when something was last really said, never by when it was last opened.
     */
    async listConversations(): Promise<ConversationSummary[]> {
      const graphId = boundGraph()
      if (!graphId) return []
      const rows = await hostSessionRows(graphId)
      // A launch whose answer was lost may own one of these rows: settle what can be settled first.
      // While one is still too young to be told from a launch that never started, adopt nothing:
      // adopting its run would take it from the conversation that sent it.
      let unsettled = false
      for (const value of [...descriptors.values()]) {
        if (value.graphId !== graphId || !value.invocationPending || value.runId) continue
        await reconcileUnresolvedLaunch(value).catch(() => false)
        if (value.invocationPending && !value.runId) unsettled = true
      }
      // A conversation is the host's row by its session, or by its run while it has not yet bound one.
      const heldSessions = new Set<string>()
      const heldRuns = new Set<string>()
      for (const value of descriptors.values()) {
        if (value.graphId !== graphId) continue
        if (value.agentSessionId) heldSessions.add(value.agentSessionId)
        if (value.runId) heldRuns.add(value.runId)
      }
      for (const row of rows) {
        if (heldSessions.has(row.sessionId) || (row.runId !== null && heldRuns.has(row.runId))) continue
        if (unsettled || hiddenSessions.has(row.sessionId) || !AGENT_SESSION_ID.test(row.sessionId)) continue
        adoptSession(row, graphId)
      }
      const bySession = new Map(rows.map(row => [row.sessionId, row]))
      const byRun = new Map(rows.filter(row => row.runId !== null).map(row => [row.runId as string, row]))
      const listed: ConversationSummary[] = []
      for (const value of descriptors.values()) {
        if (value.graphId !== graphId || !hasSaidSomething(value)) continue
        if (value.agentSessionId && hiddenSessions.has(value.agentSessionId)) continue
        const row = (value.agentSessionId ? bySession.get(value.agentSessionId) : undefined)
          ?? (value.runId ? byRun.get(value.runId) : undefined)
        listed.push(conversationSummary(value, row))
      }
      return listed.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    },

    async hydrateSession(id: string): Promise<HydratedSession> {
      const value = descriptor(id)
      // Is a turn of this conversation being sent or streamed? Asked again after every wait: a turn
      // that starts while this read is on its way owns the cursor and its command from then on. And
      // one that was on its way when the read began still is, for this read: it ended while the
      // snapshot was being taken, and the snapshot may be older than its end, so its stream is
      // still what delivers the turn.
      const atEntry = inFlightTurns.get(id)
      const inFlight = (): InFlightTurn | undefined => inFlightTurns.get(id) ?? atEntry
      // A conversation left pending by a lost launch response is settled here,
      // on load, whenever the run list can answer.
      if (value.invocationPending && !value.runId) await reconcileUnresolvedLaunch(value)
      if (value.runId && !value.agentSessionId) {
        try {
          await bindAgentSession(value)
        } catch (error) {
          throw error instanceof ChatServiceFailure
            ? error
            : new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
              phase: 'conversation-load', recovery: 'reconcile', cause: error,
            })
        }
      }
      if (!value.agentSessionId) {
        return {
          session: descriptorSummary(value),
          messages: [...windowMessagesOf(value), ...initialUserMessage(value)],
        }
      }
      let snapshot = await readAgentSession(value).catch(error => {
        throw new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
          phase: 'conversation-load', recovery: 'retry-load', cause: error,
        })
      })
      // A turn being streamed owns the cursor and its pending command: a read of the
      // transcript in the middle of it must neither skip the cursor over events the
      // stream has not delivered nor settle a command the stream is still following.
      const pending = value.pendingCommand
      if (pending && !inFlight()) {
        const reconciliation = await reconcilePendingCommand(value).catch(error => {
          throw new ChatServiceFailure(error instanceof Error ? error.message : String(error), {
            phase: 'conversation-load', recovery: 'reconcile', cause: error,
          })
        })
        if (reconciliation.state === 'failed') throw reconciliation.failure
        if (reconciliation.state === 'completed' && !inFlight() && value.pendingCommand?.commandId === pending.commandId) {
          snapshot = await readAgentSession(value)
          if (!inFlight() && value.pendingCommand?.commandId === pending.commandId) {
            value.pendingCommand = undefined
            save(value)
          }
        }
      }
      const flying = inFlight()
      if (!flying) {
        value.cursor = Math.max(value.cursor, maxEventCursor(snapshot.events))
        save(value)
      }
      const projected = projectAgentSessionMessages(snapshot, value, { inFlight: flying, voice: voiceMarkOf(value) })
      const failure = agentSessionFailure(snapshot)
      if (failure && !flying) appendAgentSessionFailure(projected, snapshot, value, failure.message)
      // The window, if there is one, is ahead of everything said in this conversation.
      return { session: descriptorSummary(value), messages: [...windowMessagesOf(value), ...projected] }
    },

    async renameSession(id: string, title: string): Promise<SessionSummary> {
      const value = descriptor(id)
      value.title = title
      save(value)
      return descriptorSummary(value)
    },

    async deleteSession(id: string): Promise<void> {
      const doomed = descriptor(id)
      // The host keeps the session; its list must not bring the conversation back.
      if (doomed.agentSessionId) hideSession(doomed.agentSessionId)
      forgetWindow(id)
      descriptors.delete(id)
      deleteDescriptor(opts, id, doomed.graphId)
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index] === id) slots[index] = null
      }
      persistSlots(opts, activeSlot, slots)
    },

    async startTurn(id: string, userText: string): Promise<ChatTurnHandle> {
      const value = descriptor(id)
      if (!userText.trim()) throw new ChatServiceFailure('Message text is required.', {
        phase: 'submit', recovery: 'none',
      })
      // The turn is in flight from this moment, before the host has answered anything: a read of
      // the conversation in the gap must leave its cursor and its command alone (and, for a first
      // message, hide what the stream is about to deliver). Taken down if the submit fails.
      inFlightTurns.set(
        id,
        !value.agentSessionId && !value.runId && !value.invocationPending ? { kind: 'initial' } : { kind: 'submitting' },
      )
      try {
        await submitTurn(value, userText.trim())
      } catch (error) {
        inFlightTurns.delete(id)
        throw error
      }
      // Something was really said; name the conversation by it if it has no name.
      nameFromWhatWasSaid(value, userText.trim())
      touchActivity(value)
      const controller = new AbortController()
      activeControllers.set(id, controller)
      inFlightTurns.set(
        id,
        value.pendingCommand?.name === 'follow_up'
          ? { kind: 'command', commandId: value.pendingCommand.commandId }
          : { kind: 'initial' },
      )
      const queue: ChatEvent[] = []
      let ended = false
      let wake: (() => void) | undefined
      const emit = (event: ChatEvent): void => {
        queue.push(event)
        wake?.()
        wake = undefined
      }
      const finish = (): void => {
        ended = true
        wake?.()
        wake = undefined
      }
      const done = streamTurn(value, controller, emit).then(outcome => {
        // The reply is in: the conversation was last active now.
        if (outcome.state === 'completed') touchActivity(value)
        return outcome
      }).finally(() => {
        activeControllers.delete(id)
        inFlightTurns.delete(id)
        finish()
      })
      return {
        events: {
          [Symbol.asyncIterator]() {
            return {
              async next(): Promise<IteratorResult<ChatEvent>> {
                while (queue.length === 0 && !ended) {
                  await new Promise<void>(resolve => { wake = resolve })
                }
                const event = queue.shift()
                return event ? { value: event, done: false } : { value: undefined, done: true }
              },
            }
          },
        },
        done,
        abort(): void {
          controller.abort()
          void abortSession(value).catch(() => undefined)
        },
      }
    },

    async abort(id: string): Promise<void> {
      const value = descriptor(id)
      activeControllers.get(id)?.abort()
      await abortSession(value)
    },

    models(): ChatModelOption[] { return offeredVoices() },
    /** How the picker's prices are charged, in the catalogue's own words for the fee. */
    voiceFootnote(): string | null { return priceFootnote(offeredVoices(), catalogueFeePercent) },
    get capabilities(): ChatCapabilities { return currentCapabilities() },
    probeCapabilities,
    access(sessionId: string | null): ChatAccess | null {
      return accessFor(sessionId)
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setSessionModel(id: string, modelId: string): void {
      const value = descriptor(id)
      if (value.continuation) {
        throw new ChatServiceFailure('The voice of a continued conversation is fixed where it was picked up.', {
          phase: 'submit', recovery: 'none',
        })
      }
      if (value.agentSessionId || value.runId || value.invocationPending || value.initialUserText) {
        throw new ChatServiceFailure('The voice is fixed once a conversation has begun.', {
          phase: 'submit', recovery: 'none',
        })
      }
      const voiceOnOffer = offeredVoices().find(model => model.id === modelId)
      if (!voiceOnOffer || voiceOnOffer.disabled) {
        throw new ChatServiceFailure('That voice is not on offer.', { phase: 'submit', recovery: 'none' })
      }
      value.modelId = modelId
      save(value)
      notifyListeners()
    },
    sessionModelId(id: string): string | null {
      try {
        const value = descriptor(id)
        return value.resolvedModel ?? chosenModelOf(value) ?? houseModelId()
      } catch {
        return null
      }
    },
    sessionVoice(id: string): ChatVoiceMark | null {
      try {
        return voiceMarkOf(descriptor(id))
      } catch {
        return null
      }
    },
    sessionSeam(id: string): ChatSeam | null {
      try {
        const value = descriptor(id)
        const record = value.continuation
        if (!record) return null
        // What the host resolved is what picked the conversation up; until it has said,
        // the voice named at the seam.
        const resolved = value.resolvedModel
        const model = resolved
          ? offeredVoices().find(candidate => candidate.id === resolved) ?? { id: resolved, label: modelIdTail(resolved) }
          : null
        return {
          omittedCount: record.omitted,
          originalTitle: record.lineage.title ?? null,
          pickedUpAt: record.pickedUpAt,
          voiceLabel: model ? seamVoiceLabel(model, model.id) : record.voiceLabel,
          providerNotice: model ? providerNoticeFor(model) : record.providerNotice,
        }
      } catch {
        return null
      }
    },
    sessionLineage(id: string): ConversationLineage | null {
      try {
        return descriptor(id).continuation?.lineage ?? null
      } catch {
        return null
      }
    },

    /**
     * Read the imported conversation with the person's own access and build the window
     * that would be sent. Sends nothing anywhere; refused, before the archive is read,
     * wherever the host cannot carry a seed.
     */
    async prepareContinuation(intent: ContinueIntent): Promise<ContinuationPlan> {
      await probeCapabilities()
      if (!currentCapabilities().continuation) throw new ContinuationError('unsupported', CANNOT_CONTINUE)
      if (!continuationArchive) {
        throw new ContinuationError('unsupported', 'Imported chats are not available here. Nothing was sent.')
      }
      // Whose it is is asked before any of it is read.
      await assertOwnConversation(continuationArchive, intent)
      return readContinuationPlan(continuationArchive, intent, { limits: currentWindowLimits(), roster: offeredVoices() })
    },

    /**
     * Open a conversation that picks up the plan's, in the voice chosen. Nothing leaves
     * the browser until the person sends their first message; then exactly this window
     * goes to the seed store. Refused, and nothing made, where the host cannot carry a
     * seed or the voice is not on offer.
     *
     * Where the host takes a voice but there is no catalogue to take it from (stale, or it
     * would not load) there is nothing to choose and nothing to check a name against: the
     * chooser says the workspace's own voice will pick it up and sends no voice, and that is
     * what happens, the House default the host runs when it is not told, as an ordinary first
     * message goes. A voice that was named and cannot be checked is still refused.
     */
    async continueConversation(plan: ContinuationPlan, choice: ContinuationChoice): Promise<SessionSummary> {
      await probeCapabilities()
      const capabilities = currentCapabilities()
      if (!capabilities.continuation) throw new ContinuationError('unsupported', CANNOT_CONTINUE)
      const offered = offeredVoices()
      const model = capabilities.voice
        ? offered.find(candidate => candidate.id === choice.modelId && !candidate.disabled)
        : undefined
      const noCatalogue = capabilities.voice && offered.length === 0
      if (capabilities.voice && !model && !(noCatalogue && !choice.modelId)) {
        throw new ContinuationError('voice-unavailable', 'That voice is not on offer. Nothing was sent.')
      }
      const title = continuedTitle(plan.intent.title)
      const value = createDescriptor({ title, ...(model ? { modelId: model.id } : {}) })
      value.workflowName = WORKSPACE_WORKFLOW_NAME
      value.continuation = {
        lineage: {
          archiveConversationUrn: plan.intent.conversationId,
          revisionId: plan.intent.revisionId,
          title: plan.intent.title,
        },
        total: plan.window.total,
        omitted: plan.window.omitted,
        sourceVoices: plan.sourceVoices,
        firstAt: plan.firstAt,
        lastAt: plan.lastAt,
        pickedUpAt: new Date().toISOString(),
        voiceLabel: model ? seamVoiceLabel(model, model.id) : 'House default',
        providerNotice: providerNoticeFor(model ?? null),
      }
      writeWindow(value.virtualId, plan.window.messages)
      touchActivity(value)
      notifyListeners()
      return descriptorSummary(value)
    },

    /**
     * The account's credit balance, read the way Settings reads it (the gateway's
     * own route, the person's own token, and only for the person the response names).
     * It is a line of text: every way it can fail is "no balance", never an error.
     */
    async balance(): Promise<ChatBalance | null> {
      const gateway = opts.gatewayBaseUrl
      const user = opts.userId()
      const token = opts.token?.()?.trim()
      if (!gateway || !user || !token) return null
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), readTimeoutMs)
      try {
        const response = await fetchImpl(new URL(BALANCE_PATH, gateway).href, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return null
        const read = parseBalance(await response.json(), user)
        // A different person may have signed in while the answer was on its way.
        if (!read || opts.userId() !== user || opts.token?.()?.trim() !== token) return null
        return {
          initialized: read.initialized,
          balanceMicroUsd: read.balanceMicroUsd,
          canMakeRequests: read.canMakeRequests,
          ...(read.facts ? { facts: read.facts } : {}),
        }
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
    slotSessions(): (string | null)[] { return [...slots] },
    setActiveSlot(slot: 0 | 1 | 2): void {
      activeSlot = slot
      persistSlots(opts, activeSlot, slots)
    },
    bindSlotSession(slot: 0 | 1 | 2, id: string | null): void {
      if (id != null && !VIRTUAL_ID.test(id)) {
        throw new Error('Hosted chat slots accept only c2chat-* virtual ids.')
      }
      slots[slot] = id
      persistSlots(opts, activeSlot, slots)
    },
  }
}

/** A read that was given up on: `AbortSignal.timeout` rejects a fetch with a TimeoutError, the fallback controller with an AbortError. */
function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/** The voice the person chose before the first message; null for no choice (or the retired profile id). */
function chosenModelOf(value: Cloud2ChatDescriptor): string | null {
  const id = value.modelId?.trim()
  return id && id !== LEGACY_PROFILE_MODEL_ID ? id : null
}

/** When something was last really said in a conversation (bookkeeping saves do not count). */
function activityOf(value: Cloud2ChatDescriptor): string {
  return value.activityAt ?? value.updatedAt
}

/**
 * The title a conversation shows: its own, or, while it has only the shell's placeholder
 * ("organism-chat", "New chat"), what was said in it; null until something has been. Read at
 * the moment it is shown, so a conversation stored under the placeholder is named too.
 */
function shownTitle(value: Cloud2ChatDescriptor): string | null {
  if (!isGenericTitle(value.title)) return value.title!.trim()
  return titleFromText(value.initialUserText ?? '') || null
}

function descriptorSummary(value: Cloud2ChatDescriptor): SessionSummary {
  return {
    id: value.virtualId,
    title: shownTitle(value),
    created_at: value.createdAt,
    updated_at: activityOf(value),
  }
}

/** A title the shell or the store puts where a person has not: it names nothing. */
function isGenericTitle(title: string | null | undefined): boolean {
  const flat = title?.trim().toLowerCase() ?? ''
  return flat === '' || flat === 'organism-chat' || flat === 'new chat' || flat.startsWith('new session - ')
}

/** What was said, as a title: whitespace collapsed, and cut at a word with an ellipsis when it is long. */
function titleFromText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= TITLE_CHARS) return flat
  const cut = flat.slice(0, TITLE_CHARS)
  const at = cut.lastIndexOf(' ')
  const head = (at >= TITLE_CHARS / 2 ? cut.slice(0, at) : cut).replace(/[\s.,;:!?-]+$/, '')
  return `${head}…`
}

/** Has anything been said in this conversation (or picked up into it)? A blank one is not a conversation yet. */
function hasSaidSomething(value: Cloud2ChatDescriptor): boolean {
  return Boolean(value.initialUserText || value.agentSessionId || value.runId || value.continuation)
}

function isoOf(epochMs: number | null): string | null {
  return epochMs === null ? null : new Date(epochMs).toISOString()
}

function conversationSummary(value: Cloud2ChatDescriptor, row: SessionRow | undefined): ConversationSummary {
  const model = row?.model ?? value.resolvedModel ?? null
  const title = !isGenericTitle(value.title)
    ? value.title!.trim()
    : titleFromText(value.initialUserText ?? '') || (isGenericTitle(row?.title) ? '' : row!.title!) || 'New chat'
  return {
    id: value.virtualId,
    kind: 'live',
    title,
    graphId: value.graphId,
    // The host's own record of activity is the one every device sees.
    updatedAt: isoOf(row?.updatedAt ?? null) ?? activityOf(value),
    createdAt: isoOf(row?.createdAt ?? null) ?? value.createdAt,
    ...(model ? { models: [{ id: model, provider: row?.provider ?? 'openrouter' }] } : {}),
    ...(value.continuation?.lineage || row?.continuesConversation
      ? { continuesConversation: value.continuation?.lineage ?? row!.continuesConversation! }
      : {}),
  }
}

/** A time the record does not carry is 0 ("unknown", shown as no time), never the clock's "now". */
function finiteTime(value: string | undefined): number {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : 0
}

/** When the first message was sent: the launch's own time, else when the chat was made. */
function sentAt(value: Cloud2ChatDescriptor): number {
  return finiteTime(value.invocationSubmittedAt) || finiteTime(value.createdAt)
}

/**
 * The person's first message. The transcript does not hold it (the launch carried
 * it), so it comes from the descriptor. Its time is the host's own record of when
 * the session began when there is one: that is the host's clock, the same one every
 * later message is stamped with, so the conversation reads in order whatever the
 * browser's clock says.
 */
function initialUserMessage(value: Cloud2ChatDescriptor, sessionCreatedAt = 0, hostPrompt = ''): ChatMessage[] {
  // A conversation this browser did not start has no record here of its first message:
  // the host keeps it on the session document.
  const text = value.initialUserText || hostPrompt
  if (!text) return []
  return [{
    id: value.initialUserMessageId ?? `${value.virtualId}:initial-user`,
    role: 'user',
    content: text,
    parts: [{ type: 'text', content: text }],
    isStreaming: false,
    toolCalls: [],
    createdAt: sessionCreatedAt || sentAt(value),
  }]
}

/** One renderable item of the durable transcript. */
interface TranscriptView {
  readonly id: string
  readonly role: 'user' | 'assistant'
  /** The host's own kind: `node-result`, `command-result`, `follow_up`, … */
  readonly kind: string
  readonly text: string
  /** The item's own time when the host records one (today it does not): 0 otherwise. */
  readonly at: number
}

/**
 * The transcript's items that carry words, with a run-level `node-result` that only
 * repeats the `command-result` beside it left out. The host writes both for one
 * follow-up: the command's own result, and, when the session completes, the run's
 * result, which holds the same text. Rendering every item showed the answer twice
 * on reload. The command result is the canonical one (it has a stable id that
 * belongs to the turn); the rule is narrow on purpose: adjacent assistant items,
 * identical text, one of them a `node-result`. Two different turns that answer with
 * the same words have a person's message between them and are never touched.
 */
function transcriptViews(order: readonly string[], items: Record<string, unknown>): TranscriptView[] {
  const views: TranscriptView[] = []
  for (const id of order) {
    const item = asRecord(items[id])
    const text = string(item.text) || string(item.content)
    if (!text) continue
    const view: TranscriptView = {
      id,
      role: string(item.role) === 'user' ? 'user' : 'assistant',
      kind: string(item.kind),
      text,
      at: number(item.ts) || number(item.timestamp),
    }
    const previous = views[views.length - 1]
    if (
      previous
      && previous.role === 'assistant'
      && view.role === 'assistant'
      && previous.text === view.text
      && previous.kind !== view.kind
      && (previous.kind === 'node-result' || view.kind === 'node-result')
    ) {
      if (previous.kind === 'node-result') views[views.length - 1] = view
      continue
    }
    views.push(view)
  }
  return views
}

/** `c2cmd:…` out of `command:c2cmd:…:input` (or `:result`). */
function commandIdOfItem(itemId: string, part: 'input' | 'result'): string | null {
  const prefix = 'command:'
  const suffix = `:${part}`
  if (!itemId.startsWith(prefix) || !itemId.endsWith(suffix)) return null
  return itemId.slice(prefix.length, itemId.length - suffix.length) || null
}

/**
 * When each transcript item happened. The items themselves carry no time; the
 * session's own events do. A follow-up's input is stamped when its command was
 * accepted. A reply is stamped when its turn's last `message.completed` fired, the
 * turn being everything between one follow-up's acceptance and the next; failing
 * that, when its command completed. A time the events cannot give is the previous
 * message's (a conversation never runs backwards), and before any, 0 (unknown).
 */
function transcriptTimes(
  response: AgentSessionResponse,
  views: readonly TranscriptView[],
  start: number,
): number[] {
  const accepted = new Map<string, number>()
  const finished = new Map<string, number>()
  const replyEnds: number[] = []
  for (const raw of Array.isArray(response.events) ? response.events : []) {
    const event = asAgentSessionEvent(raw)
    if (!event || event.ts <= 0) continue
    const commandId = eventCommandId(event)
    if (event.type === 'command.accepted' && commandId) accepted.set(commandId, event.ts)
    else if (event.type === 'command.completed' && commandId) finished.set(commandId, event.ts)
    else if (event.type === 'message.completed') replyEnds.push(event.ts)
  }
  replyEnds.sort((left, right) => left - right)

  // Where each follow-up began; every input must be known for the turns between them to be.
  const begun = views.map(view => {
    const commandId = commandIdOfItem(view.id, 'input')
    return commandId ? accepted.get(commandId) ?? 0 : -1
  })
  const boundaries = begun.every(at => at !== 0)

  const times: number[] = []
  let previous = start
  views.forEach((view, index) => {
    let at = view.at
    if (at > 0) {
      // The host recorded a time on the item itself: nothing to infer.
    } else if (view.role === 'user') {
      at = Math.max(0, begun[index])
    } else {
      if (boundaries) {
        let low = 0
        for (let back = index - 1; back >= 0; back -= 1) {
          if (begun[back] > 0) { low = begun[back]; break }
        }
        let high = Number.POSITIVE_INFINITY
        for (let ahead = index + 1; ahead < views.length; ahead += 1) {
          if (begun[ahead] > 0) { high = begun[ahead]; break }
        }
        for (let end = replyEnds.length - 1; end >= 0; end -= 1) {
          if (replyEnds[end] >= low && replyEnds[end] < high) { at = replyEnds[end]; break }
        }
      }
      if (!at) {
        const commandId = commandIdOfItem(view.id, 'result')
        if (commandId) at = finished.get(commandId) ?? 0
      }
    }
    const time = Math.max(at || previous, previous)
    times.push(time)
    previous = time
  })
  return times
}

/**
 * What each reply cost, from the session's ledger, by message id. A turn's model calls
 * settle between the moment its follow-up was accepted and the moment the next was; the
 * run's own first reply is everything settled before the first follow-up was accepted.
 * Attribution is by each follow-up's own command id, never by counting replies, so a
 * command that is not a follow-up (the runtime quiesces a session between turns) cannot
 * shift a cost onto the wrong reply. A reply the ledger says nothing about has no entry:
 * no chip is better than a wrong one.
 */
function transcriptCosts(response: AgentSessionResponse, views: readonly TranscriptView[]): Map<string, number> {
  const followUps = new Set<string>()
  for (const view of views) {
    const commandId = commandIdOfItem(view.id, 'input')
    if (commandId) followUps.add(commandId)
  }
  const events = (Array.isArray(response.events) ? response.events : [])
    .map(asAgentSessionEvent)
    .filter((event): event is ValidatedAgentSessionEvent => event !== null)
    .sort((left, right) => left.seq - right.seq)
  const settledBy = new Map<string, number>()
  let bucket = 'initial'
  for (const event of events) {
    if (event.type === 'command.accepted') {
      const commandId = eventCommandId(event)
      if (followUps.has(commandId)) bucket = commandId
      continue
    }
    const cost = settledCostOf(event)
    if (cost > 0) settledBy.set(bucket, (settledBy.get(bucket) ?? 0) + cost)
  }
  const costs = new Map<string, number>()
  let firstReplyClaimed = false
  for (const view of views) {
    if (view.role !== 'assistant') continue
    const commandId = commandIdOfItem(view.id, 'result')
    let cost: number | undefined
    if (commandId) {
      cost = settledBy.get(commandId)
    } else if (!firstReplyClaimed) {
      firstReplyClaimed = true
      cost = settledBy.get('initial')
    }
    if (cost) costs.set(view.id, cost)
  }
  return costs
}

interface ProjectOptions {
  /** The turn being streamed right now, whose own output the stream will deliver. */
  readonly inFlight?: InFlightTurn
  /** What speaks in this conversation: every assistant message carries it. */
  readonly voice?: ChatVoiceMark | null
}

function projectAgentSessionMessages(
  response: AgentSessionResponse,
  descriptor: Cloud2ChatDescriptor,
  options: ProjectOptions = {},
): ChatMessage[] {
  const transcript = response.document?.transcript
  let order = Array.isArray(transcript?.order)
    ? transcript.order.filter((id): id is string => typeof id === 'string')
    : []
  const items = asRecord(transcript?.items)
  // A turn being streamed delivers its own output; seed only what came before it.
  const inFlight = options.inFlight
  if (inFlight?.kind === 'initial') {
    order = []
  } else if (inFlight?.kind === 'command') {
    const inputAt = order.indexOf(commandInputMessageId(inFlight.commandId))
    if (inputAt >= 0) order = order.slice(0, inputAt + 1)
  }
  const sessionCreatedAt = number(response.session?.createdAt) || number(response.session?.created_at)
  const localInitial = initialUserMessage(descriptor, sessionCreatedAt, firstPromptOf(response))
  const messages = order.includes(localInitial[0]?.id ?? '') ? [] : localInitial
  const views = transcriptViews(order, items)
  const times = transcriptTimes(response, views, localInitial[0]?.createdAt ?? sessionCreatedAt)
  const costs = transcriptCosts(response, views)
  const tools = transcriptToolCalls(response, views)
  views.forEach((view, index) => {
    const toolCalls = tools.get(view.id) ?? []
    const parts: MessagePart[] = [
      ...toolCalls.map(call => ({ type: 'tool' as const, toolCallId: call.id })),
      { type: 'text', content: view.text },
    ]
    messages.push({
      id: view.id,
      role: view.role,
      content: view.text,
      parts,
      isStreaming: false,
      toolCalls,
      createdAt: times[index],
      ...(view.role === 'assistant' && options.voice ? { voice: options.voice } : {}),
      ...(costs.has(view.id) ? { costMicroUsd: costs.get(view.id) } : {}),
    })
  })
  const pending = descriptor.pendingCommand
  if (pending?.name === 'follow_up' && pending.text) {
    const id = commandInputMessageId(pending.commandId)
    if (!order.includes(id)) {
      messages.push({
        id,
        role: 'user',
        content: pending.text,
        parts: [{ type: 'text', content: pending.text }],
        isStreaming: false,
        toolCalls: [],
        createdAt: pending.submittedAt,
      })
    }
  }
  return messages
}

function asAgentSessionEvent(value: unknown): ValidatedAgentSessionEvent | null {
  const event = asRecord(value)
  const seq = number(event.seq)
  const type = string(event.type)
  if (!Number.isSafeInteger(seq) || seq < 0 || !type) return null
  return { seq, ts: number(event.ts), type, payload: event.payload }
}

function projectAgentSessionEvent(
  event: ValidatedAgentSessionEvent,
): ChatEvent | null {
  const value = asRecord(asRecord(event.payload).value)
  switch (event.type) {
    case 'turn.started': return { type: 'turn_start', turn: number(value.turn) }
    case 'turn.completed': return { type: 'turn_end', turn: number(value.turn) }
    case 'message.delta': return { type: 'text', content: string(value.delta) }
    case 'reasoning.delta': return { type: 'thinking', content: string(value.delta) }
    case 'tool.started': return {
      type: 'tool_call',
      gate: string(value.tool) || 'tool',
      args: asRecord(value.args),
      ...toolReceipt(value),
    }
    case 'tool.completed':
    case 'tool.failed': return {
      type: 'tool_result',
      gate: string(value.tool) || 'tool',
      result: string(value.result),
      is_error: event.type === 'tool.failed' || value.isError === true,
      ...toolReceipt(value),
    }
    case 'message.completed': return { type: 'done', output: string(value.output) }
    case 'budget.exhausted': return {
      type: 'truncated', output: string(value.output), turns: number(value.turns),
    }
    case 'budget.ledger_updated': {
      const cost = settledCostOf(event)
      return cost > 0 ? { type: 'cost', microUsd: cost } : null
    }
    case 'turn.failed': {
      const message = string(value.message) || 'Agent turn failed.'
      // A call the balance could not pay for is the banner's to say, never a raw error in the bubble.
      return billingRefusalOfTurnFailure(message) ? null : { type: 'error', message }
    }
    case 'session.faulted': return { type: 'error', message: sessionFaultMessage(event) }
    case 'session.closed': return { type: 'done', output: '' }
    default: return null
  }
}

/**
 * The host's id-only receipt of what a tool call touched (`targets`), as the fold's `metadata`. The
 * durable record keeps no arguments and no results; this is what it may keep instead. Nothing else on
 * the event is passed on, and a receipt that is not a list is no receipt.
 */
function toolReceipt(value: Record<string, unknown>): { metadata?: Record<string, unknown> } {
  if (!Array.isArray(value.targets)) return {}
  const targets = value.targets.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)).slice(0, 64)
  return targets.length > 0 ? { metadata: { targets } } : {}
}

/**
 * Every reply's tool calls, rebuilt from the session's own events, by message id. A follow-up's calls
 * are the events between its command's acceptance and the next follow-up's; the run's first reply has
 * everything before the first follow-up. Calls pair with their results first-in first-out per tool, as
 * the live fold pairs them; each keeps its name, its outcome and the host's receipt, never more than the
 * record holds. Before, a reload rebuilt text only and the chips vanished (and with them, on the next
 * turn, the "Changed in this turn" strip of every earlier reply).
 */
function transcriptToolCalls(response: AgentSessionResponse, views: readonly TranscriptView[]): Map<string, ToolCall[]> {
  const followUps = new Set<string>()
  for (const view of views) {
    const commandId = commandIdOfItem(view.id, 'input')
    if (commandId) followUps.add(commandId)
  }
  const events = (Array.isArray(response.events) ? response.events : [])
    .map(asAgentSessionEvent)
    .filter((event): event is ValidatedAgentSessionEvent => event !== null)
    .sort((left, right) => left.seq - right.seq)
  const buckets = new Map<string, ValidatedAgentSessionEvent[]>()
  let bucket = 'initial'
  for (const event of events) {
    if (event.type === 'command.accepted') {
      const commandId = eventCommandId(event)
      if (followUps.has(commandId)) bucket = commandId
      continue
    }
    if (event.type !== 'tool.started' && event.type !== 'tool.completed' && event.type !== 'tool.failed') continue
    const list = buckets.get(bucket) ?? []
    list.push(event)
    buckets.set(bucket, list)
  }
  const calls = new Map<string, ToolCall[]>()
  let firstReplyClaimed = false
  for (const view of views) {
    if (view.role !== 'assistant') continue
    const commandId = commandIdOfItem(view.id, 'result')
    let own: ValidatedAgentSessionEvent[] | undefined
    if (commandId) {
      own = buckets.get(commandId)
    } else if (!firstReplyClaimed) {
      firstReplyClaimed = true
      own = buckets.get('initial')
    }
    if (own && own.length > 0) calls.set(view.id, toolCallsOf(view.id, own))
  }
  return calls
}

function toolCallsOf(messageId: string, events: readonly ValidatedAgentSessionEvent[]): ToolCall[] {
  const calls: ToolCall[] = []
  const open = new Map<string, number[]>()
  const counts = new Map<string, number>()
  const mint = (gate: string): string => {
    const n = counts.get(gate) ?? 0
    counts.set(gate, n + 1)
    return `${messageId}/${gate}#${n}`
  }
  for (const event of events) {
    const value = asRecord(asRecord(event.payload).value)
    const gate = string(value.tool) || 'tool'
    const receipt = toolReceipt(value).metadata
    if (event.type === 'tool.started') {
      const queue = open.get(gate) ?? []
      queue.push(calls.length)
      open.set(gate, queue)
      calls.push({
        id: mint(gate), tool: gate, status: 'running', input: asRecord(value.args), output: null, metadata: receipt ?? null,
      })
      continue
    }
    const failed = event.type === 'tool.failed' || value.isError === true
    const index = open.get(gate)?.shift()
    const result = typeof value.result === 'string' ? value.result : null
    if (index === undefined) {
      calls.push({ id: mint(gate), tool: gate, status: failed ? 'error' : 'completed', input: null, output: result, metadata: receipt ?? null })
      continue
    }
    const call = calls[index]
    calls[index] = {
      ...call,
      status: failed ? 'error' : 'completed',
      output: result,
      metadata: receipt ? { ...(call.metadata ?? {}), ...receipt } : call.metadata,
    }
  }
  return calls
}

/**
 * What a model call settled at, in micro-USD, from a `budget.ledger_updated` event. Only
 * the settle is a cost (`inference_settled`): the reservation before it is a worst case,
 * not a price. The live host writes the ledger's fields on the payload itself (F-step-zero);
 * one nested under `value` is read too.
 */
function settledCostOf(event: ValidatedAgentSessionEvent): number {
  if (event.type !== 'budget.ledger_updated') return 0
  const payload = asRecord(event.payload)
  const source = typeof payload.kind === 'string' ? payload : asRecord(payload.value)
  if (source.kind !== 'inference_settled') return 0
  const cost = asRecord(source.spentDelta).costUsdMicros
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : 0
}

function eventCommandId(event: ValidatedAgentSessionEvent): string {
  const payload = asRecord(event.payload)
  return string(payload.commandId) || string(asRecord(payload.value).commandId)
}

function isRelevantDurableTerminalEvent(
  event: ValidatedAgentSessionEvent,
  pendingCommandId?: string,
): boolean {
  if (event.type === 'session.faulted') return true
  if (!pendingCommandId) {
    return event.type === 'turn.failed' || event.type === 'session.closed'
  }
  return eventCommandId(event) === pendingCommandId
    && ['command.completed', 'command.failed', 'command.cancelled', 'command.rejected'].includes(event.type)
}

function maxEventCursor(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((max, raw) => Math.max(max, number(asRecord(raw).seq)), 0)
}

function commandRecordId(row: Record<string, unknown>): string {
  return string(row.command_id) || string(row.commandId)
}

function commandRecordState(row: Record<string, unknown>): string {
  return string(row.state) || string(row.status)
}

function commandInputMessageId(commandId: string): string {
  return `command:${commandId}:input`
}

function transcriptCompletesCommand(response: AgentSessionResponse, commandId: string): boolean {
  const order = response.document?.transcript?.order
  if (!Array.isArray(order)) return false
  const inputIndex = order.indexOf(commandInputMessageId(commandId))
  if (inputIndex < 0) return false
  const items = asRecord(response.document?.transcript?.items)
  return order.slice(inputIndex + 1).some(id => {
    const role = string(asRecord(items[string(id)]).role)
    return role === 'assistant' || role === 'agent'
  })
}

function sessionStatus(response: AgentSessionResponse): string {
  return string(response.session?.status)
}

function sessionLifecycleState(response: AgentSessionResponse): string {
  return string(response.session?.lifecycleState) || string(response.session?.lifecycle_state)
}

function sessionError(response: AgentSessionResponse): string {
  const error = response.session?.error
  return string(error) || string(asRecord(error).message)
}

function agentSessionFailure(response: AgentSessionResponse): ChatServiceFailure | null {
  const status = sessionStatus(response)
  const lifecycleState = sessionLifecycleState(response)
  if (status !== 'failed' && status !== 'cancelled' && lifecycleState !== 'faulted') return null
  const terminal = lifecycleState === 'faulted' ? 'faulted' : status
  return new ChatServiceFailure(sessionError(response) || `Agent Session ${terminal}.`, {
    phase: 'stream', recovery: 'none',
  })
}

function sessionFaultMessage(event: ValidatedAgentSessionEvent): string {
  const payload = asRecord(event.payload)
  const value = asRecord(payload.value)
  return string(payload.error)
    || string(asRecord(payload.error).message)
    || string(value.error)
    || string(asRecord(value.error).message)
    || 'Agent Session faulted.'
}

function agentSessionEventFailure(event: ValidatedAgentSessionEvent): ChatServiceFailure | null {
  if (event.type !== 'turn.failed' && event.type !== 'session.faulted') return null
  const value = asRecord(asRecord(event.payload).value)
  const message = event.type === 'session.faulted'
    ? sessionFaultMessage(event)
    : string(value.message) || 'Agent turn failed.'
  const billing = event.type === 'turn.failed' ? billingRefusalOfTurnFailure(message) : null
  if (billing) {
    return new ChatBillingFailure(billingFailureMessage(billing), { billing, phase: 'stream', recovery: 'none' })
  }
  return new ChatServiceFailure(message, { phase: 'stream', recovery: 'none' })
}

function appendAgentSessionFailure(
  messages: ChatMessage[],
  response: AgentSessionResponse,
  descriptor: Cloud2ChatDescriptor,
  message: string,
): void {
  const id = `${descriptor.virtualId}:agent-session-failure`
  if (messages.some(item => item.id === id)) return
  const session = response.session ?? {}
  messages.push({
    id,
    role: 'assistant',
    content: '',
    // Keep the durable failure out of assistant content: this is an error
    // presentation owned by the adapter, not fabricated transcript speech.
    parts: [{ type: 'text', content: '' }],
    isStreaming: false,
    toolCalls: [],
    createdAt: number(session.completedAt)
      || number(session.completed_at)
      || number(session.updatedAt)
      || Date.parse(descriptor.updatedAt),
    error: message,
  })
}

function isTerminalSessionStatus(status: string): boolean {
  return status === 'completed' || status === 'restartable' || status === 'paused'
}

interface SseFrame { readonly event: string; readonly data: unknown }

export async function* parseSse(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<SseFrame> {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const frame = parseSseBlock(block)
      if (frame) yield frame
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  const frame = parseSseBlock(buffer)
  if (frame) yield frame
}

function parseSseBlock(block: string): SseFrame | null {
  if (!block.trim() || block.trimStart().startsWith(':')) return null
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  const raw = data.join('\n')
  try { return { event, data: JSON.parse(raw) } } catch { return { event, data: raw } }
}

function canonicalActor(userId: string): string {
  const id = userId.trim()
  return id.startsWith('user:') ? id : `user:${id}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }

/**
 * Where one person's chat of one graph keeps its bookkeeping. The graph is the conversation's
 * own where it is known (a write is for the conversation it belongs to, whichever graph the
 * person is in by the time it happens); else the graph they are in.
 */
function keyRoot(opts: HostedChatServiceOptions, graphId?: string | null): string {
  const prefix = opts.storageKeyPrefix ?? DEFAULT_STORAGE_PREFIX
  return `${prefix}:${encodeURIComponent(opts.userId())}:${encodeURIComponent(graphId ?? opts.graphId() ?? 'unbound')}`
}
function storageKey(opts: HostedChatServiceOptions, suffix: string, graphId?: string | null): string {
  return `${keyRoot(opts, graphId)}:${suffix}`
}
function windowKey(opts: HostedChatServiceOptions, id: string, graphId?: string | null): string {
  return storageKey(opts, `window:${encodeURIComponent(id)}`, graphId)
}

/**
 * Take every window this app keeps out of a browser's storage: for every person and every graph.
 * A window is another conversation's text, kept so it can be shown again; it must not outlive the
 * sign-in that read it. Conversations themselves, their titles and the slots stay. Returns how many
 * were removed; never throws (storage that cannot be walked or written to is left as it is).
 */
export function purgeHostedChatWindows(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null | undefined,
  prefix: string = DEFAULT_STORAGE_PREFIX,
): number {
  if (!storage || typeof storage.key !== 'function' || typeof storage.length !== 'number') return 0
  const doomed: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(`${prefix}:`) && key.includes(':window:')) doomed.push(key)
    }
  } catch {
    return 0
  }
  let removed = 0
  for (const key of doomed) {
    try {
      storage.removeItem(key)
      removed += 1
    } catch {
      // Blocked: there is nothing to undo.
    }
  }
  return removed
}
function noDomainAgentKey(opts: HostedChatServiceOptions, graphId: string): string {
  const prefix = opts.storageKeyPrefix ?? DEFAULT_STORAGE_PREFIX
  return `${prefix}:${encodeURIComponent(opts.userId())}:${encodeURIComponent(graphId)}:no-domain-agent`
}
function descriptorKey(opts: HostedChatServiceOptions, id: string, graphId?: string | null): string {
  return storageKey(opts, `descriptor:${encodeURIComponent(id)}`, graphId)
}

function readDescriptorIndex(opts: HostedChatServiceOptions, graphId?: string | null): string[] {
  try {
    const parsed = JSON.parse(opts.storage?.getItem(storageKey(opts, 'descriptor-index', graphId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && VIRTUAL_ID.test(id)) : []
  } catch { return [] }
}

function readHiddenSessions(opts: HostedChatServiceOptions): string[] {
  try {
    const parsed = JSON.parse(opts.storage?.getItem(storageKey(opts, 'hidden-sessions')) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

/**
 * Keep a conversation's bookkeeping where a reload finds it. Best-effort, like every write of
 * this app's own storage: a browser that will not hold any more (a full quota, storage blocked)
 * must not fail a turn that worked. What could not be kept holds for this page load.
 */
function persistDescriptor(opts: HostedChatServiceOptions, value: Cloud2ChatDescriptor): void {
  if (!opts.storage) return
  try {
    const index = readDescriptorIndex(opts, value.graphId).filter(id => id !== value.virtualId)
    index.push(value.virtualId)
    opts.storage.setItem(descriptorKey(opts, value.virtualId, value.graphId), JSON.stringify(value))
    opts.storage.setItem(storageKey(opts, 'descriptor-index', value.graphId), JSON.stringify(index))
  } catch {
    // Full or blocked: the conversation goes on in memory.
  }
}

function readDescriptor(opts: HostedChatServiceOptions, id: string): Cloud2ChatDescriptor | null {
  if (!VIRTUAL_ID.test(id)) return null
  try {
    const parsed = JSON.parse(opts.storage?.getItem(descriptorKey(opts, id)) ?? 'null') as Partial<Cloud2ChatDescriptor> | null
    if (!parsed || parsed.schema !== DESCRIPTOR_SCHEMA || parsed.virtualId !== id
      || typeof parsed.graphId !== 'string' || typeof parsed.clientId !== 'string'
      || typeof parsed.createdAt !== 'string' || typeof parsed.updatedAt !== 'string'
      || typeof parsed.cursor !== 'number') return null
    if (parsed.agentSessionId && !AGENT_SESSION_ID.test(parsed.agentSessionId)) return null
    return parsed as Cloud2ChatDescriptor
  } catch { return null }
}

function deleteDescriptor(opts: HostedChatServiceOptions, id: string, graphId?: string | null): void {
  if (!opts.storage) return
  try {
    opts.storage.removeItem(descriptorKey(opts, id, graphId))
    opts.storage.setItem(
      storageKey(opts, 'descriptor-index', graphId),
      JSON.stringify(readDescriptorIndex(opts, graphId).filter(candidate => candidate !== id)),
    )
  } catch {
    // Blocked: it is gone from this page load either way.
  }
}

function readActiveSlot(opts: HostedChatServiceOptions): 0 | 1 | 2 {
  try {
    const value = Number(opts.storage?.getItem(storageKey(opts, 'active-slot')))
    return value === 1 || value === 2 ? value : 0
  } catch { return 0 }
}

function readSlots(opts: HostedChatServiceOptions): [string | null, string | null, string | null] {
  try {
    const parsed = JSON.parse(opts.storage?.getItem(storageKey(opts, 'slots')) ?? 'null')
    if (!Array.isArray(parsed)) return [null, null, null]
    return [0, 1, 2].map(index => typeof parsed[index] === 'string' && VIRTUAL_ID.test(parsed[index])
      ? parsed[index]
      : null) as [string | null, string | null, string | null]
  } catch { return [null, null, null] }
}

function persistSlots(
  opts: HostedChatServiceOptions,
  activeSlot: 0 | 1 | 2,
  slots: readonly (string | null)[],
): void {
  if (!opts.storage) return
  try {
    opts.storage.setItem(storageKey(opts, 'active-slot'), String(activeSlot))
    opts.storage.setItem(storageKey(opts, 'slots'), JSON.stringify(slots))
  } catch {
    // Full or blocked: the slots hold for this page load.
  }
}

function validatedWorkflow(
  workflows: readonly WorkflowSummary[],
  name: ChatWorkflow['name'],
  uri: string,
  requiredInputs: readonly string[],
): ChatWorkflow | undefined {
  const matches = workflows.filter(workflow => workflow.name === name)
  if (matches.length === 0) return undefined
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name} registry entry; received ${matches.length}.`)
  const workflow = matches[0]
  const required = Array.isArray(asRecord(workflow.inputs).required)
    ? asRecord(workflow.inputs).required as unknown[]
    : []
  if (workflow.workflowUri !== uri
    || typeof workflow.definitionDigest !== 'string'
    || !DIGEST.test(workflow.definitionDigest)
    || requiredInputs.some(field => !required.includes(field))
    || asRecord(workflow.outputs).type !== 'object') {
    throw new Error(`${name} registry entry failed digest/URI/schema validation.`)
  }
  return {
    name,
    workflowUri: uri,
    definitionDigest: workflow.definitionDigest,
    inputs: advertisedInputs(workflow),
    windowLimits: windowLimitsFrom(workflow),
    access: accessAdvertFrom(workflow),
  }
}

/**
 * What the registry entry says each role's chat may do (`host.access`), read strictly: only the three
 * roles, only `write` or `read`. Anything else is not an advert, and the chat is taken to read only.
 */
function accessAdvertFrom(workflow: unknown): ChatAccessAdvert | null {
  const raw = asRecord(asRecord(asRecord(workflow).host).access)
  const advert: Partial<Record<ChatWorkspaceRole, 'write' | 'read'>> = {}
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const said = raw[role]
    if (said === 'write' || said === 'read') advert[role] = said
  }
  return Object.keys(advert).length > 0 ? Object.freeze(advert) : null
}

function sameAccess(left: ChatAccessAdvert | null, right: ChatAccessAdvert | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.owner === right.owner && left.editor === right.editor && left.viewer === right.viewer
}

/** Choreograph's coded error envelope: `{ "error": { "code", "message" } }`. */
function choreographError(bodyText: string): ChoreographErrorBody | undefined {
  try {
    const error = asRecord(asRecord(JSON.parse(bodyText)).error)
    const code = string(error.code)
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(code)) return undefined
    return { ...error, code, message: string(error.message) }
  } catch {
    return undefined
  }
}

/** What a refused follow-up means for the person (Choreograph's viewer guards, RETURN.md §1.3). */
function commandRefusalMessage(code: string | undefined): string {
  if (code === 'workspace_chat_role_changed') {
    return 'You can no longer change this workspace, so this conversation cannot go on. Start a new chat to keep talking with Sophia here.'
  }
  if (code === 'viewer_session_refused') return 'This conversation cannot be continued with your access here. Start a new chat.'
  return 'You do not have access to chat in this workspace.'
}

function launchFailureMessage(status: number, error: ChoreographErrorBody | undefined, bodyText: string): string {
  const code = error?.code
  if (code === NOT_PROVISIONED) return 'This workspace has no chat assistant yet.'
  if (code && (code.endsWith('_denied') || status === 403)) return 'You do not have access to chat in this workspace.'
  if (code && code.endsWith('_unavailable')) return 'The workspace is not ready yet (it may be waking up). Try again in a moment.'
  if (status === 401) return 'Your session has expired. Sign in again to chat.'
  if (error) return `Chat could not start (${code}): ${error.message}`
  return `Chat could not start (${status})${bodyText ? `: ${bodyText.slice(0, 300)}` : '.'}`
}
