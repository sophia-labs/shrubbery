import { LitElement, css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'

import {
  asRecord,
  buildAgentCard,
  type AgentCardViewModel,
  type AgentCardLoadout,
  type AgentCardIncidents,
  compactDuration,
  type AgentMark,
  buildConstitutionStrip,
  type ConstitutionStrip,
  buildAgentFloor,
  type AgentAffordance,
  type AgentFloorViewModel,
  buildAgentPresence,
  type AgentPresenceModel,
  type AgentPresenceReference,
  type AgentPresenceViewModel,
  buildBayStrip,
  type BayStrip,
  type BayStripModel,
  buildConversationRow,
  type ConversationRow,
  buildRoomSpeech,
  firstNonBlankString,
  MODEL_LABELS,
  formatTimestamp,
  numberAt,
  recencyFromStoreState,
  toEpochMs,
  buildTurnAccount,
  type ConductStep,
  type Recency,
  type RoomMessage,
  type RoomSpeechViewModel,
  type TurnAccount,
  stringAt,
  arrayAt,
  type TurnActivity,
  valueAt,
  advanceWatermark,
  buildTurnoverBrief,
  watermarkStorageKey,
  type AgentWatermark,
  type TurnoverBrief,
  type TurnoverLine,
  type TurnoverMemoryEntry,
} from '@shrubbery/nucleus'
import {
  createGreenhouseService,
  modelFromRecord,
  readGreenhouseConfig,
  type GreenhouseAgentRecord,
  type GreenhouseAgentSessionRecord,
  type GreenhouseConfig,
  type GreenhouseService,
} from './greenhouse-service.js'
import {
  createGreenhouseStore,
  normalizeGreenhousePollMs,
  type GreenhouseLiveRead,
  type GreenhouseScreenState,
  type GreenhouseStore,
  type GreenhouseStoreState,
} from './greenhouse-store.js'

const MODEL_PROVIDER_ORDER = ['DeepSeek', 'OpenAI', 'Anthropic', 'Google', 'Moonshot', 'Other'] as const

const STACK_COMMAND = 'pnpm --dir apps/greenhouse stack:start'

/** Which of the two places the shell is holding. There is no deeper level than a room and no wider level than the bay. */
type GreenhouseView = 'bay' | 'room' | 'log'

/** The live-fetch state of one agent's conversation list, unfolded under its strip. */
type SessionLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly sessions: readonly GreenhouseAgentSessionRecord[] }
  | { readonly status: 'error' }

/** The log of a closed conversation: transcript only, no floor, no composer. */
interface LogLoad {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly sessionId: string | null
  readonly title: string | null
  readonly messages: readonly RoomMessage[]
}

const IDLE_LOG: LogLoad = { status: 'idle', sessionId: null, title: null, messages: [] }

interface AgentModelOption {
  readonly id: string
  readonly label: string
  readonly provider: string
}

interface AgentModelGroup {
  readonly provider: string
  readonly models: readonly AgentModelOption[]
}

export interface PresenceStripOptions {
  readonly floor?: AgentFloorViewModel | null
  readonly speech?: RoomSpeechViewModel | null
  readonly composer?: SpeechComposerOptions | null
  readonly modelGroups?: readonly AgentModelGroup[]
  readonly activeProvider?: string | null
  readonly pickerOpen?: boolean
  readonly changingModel?: boolean
  readonly asOf?: number | null
  readonly recency?: Recency<GreenhouseLiveRead> | null
  readonly floorActivity?: 'idle' | 'claiming' | 'releasing' | 'steering'
  readonly steeringOpen?: boolean
  readonly steeringText?: string
  readonly onToggleModelPicker?: () => void
  readonly onChooseProvider?: (provider: string) => void
  readonly onChangeModel?: (modelId: string) => void
  readonly onFloorAffordance?: (affordance: AgentAffordance) => void
  readonly onSteeringText?: (text: string) => void
  readonly onSubmitSteering?: () => void
  readonly onCancelSteering?: () => void
  readonly openConductIds?: ReadonlySet<string>
  readonly onToggleConduct?: (messageId: string) => void
  /** The turnover brief for this return; when non-eventful, no brief block renders. */
  readonly brief?: TurnoverBrief | null
  /** "you left here · HH:MM" — the watermark rule renders in every return when set. */
  readonly leftAt?: number | null
  readonly onReadReply?: (messageId: string) => void
}

export interface SpeechComposerOptions {
  readonly agentHandle: string
  readonly value: string
  readonly sending?: boolean
  readonly disabledReason?: string | null
  readonly sendError?: string | null
  readonly onInput?: (text: string) => void
  readonly onSubmit?: () => void
}

export interface SpeechSurfaceOptions {
  readonly openConductIds?: ReadonlySet<string>
  readonly onToggleConduct?: (messageId: string) => void
}

function modelLabel(modelId: string | null | undefined): string {
  if (!modelId) return 'Select model'
  return MODEL_LABELS[modelId] ?? modelId
}

function modelProvider(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (/^gpt-|^o[13]-/.test(lower)) return 'OpenAI'
  if (/^claude-/.test(lower)) return 'Anthropic'
  if (/^gemini-/.test(lower)) return 'Google'
  if (/^kimi-/.test(lower)) return 'Moonshot'
  return 'Other'
}

function providerRank(provider: string): number {
  const index = MODEL_PROVIDER_ORDER.indexOf(provider as (typeof MODEL_PROVIDER_ORDER)[number])
  return index < 0 ? MODEL_PROVIDER_ORDER.length : index
}

function agentSelector(agent: GreenhouseAgentRecord): string {
  return agent.agentId || agent.handle
}

/**
 * The presence "updated" chip label (R4c): the view model carries EPOCH MS
 * (`GreenhouseAgentRecord.updatedAt`); the display string comes ONLY from the
 * shared deterministic-UTC formatter — never a preformatted locale string.
 * Unparseable testimony yields '' (no chip), never a guess.
 */
export function presenceUpdatedLabel(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') return ''
  const epochMs = toEpochMs(value)
  return epochMs === null ? '' : formatTimestamp(epochMs)
}

function formatMessageTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Token counts as a whisper, not a ledger figure: 1,904 → "1.9k". */
function formatTokens(value: number): string {
  if (value < 1000) return `${value}`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1000)}k`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

/**
 * An incident kind read at reading level: the dotted event name kept whole in the
 * title (the real testimony) but shown as its two most-specific segments —
 * `conversation.turn.tool.failed` → `tool.failed`. Never invented; only elided.
 */
function formatIncidentKind(kind: string): string {
  const parts = kind.split('.').filter((part) => part.length)
  if (parts.length <= 2) return kind
  return parts.slice(-2).join('.')
}

function formatDuration(value: number): string {
  if (value < 1000) return `${formatCount(value)}ms`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1000)}s`
}

function formatConductSource(step: ConductStep): string {
  const parts: string[] = []
  if (step.observer) parts.push(step.observer)
  if (step.observedAt) parts.push(new Date(step.observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  return parts.join(' · ')
}

function modelOptions(currentModel: string): readonly { readonly id: string; readonly label: string }[] {
  const ids = [currentModel, 'deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-5', 'claude-sonnet']
  return Array.from(new Set(ids.filter(Boolean))).map((id) => ({
    id,
    label: modelLabel(id),
  }))
}

function agentModelGroups(currentModel: string): readonly AgentModelGroup[] {
  const grouped = new Map<string, AgentModelOption[]>()
  for (const option of modelOptions(currentModel)) {
    const provider = modelProvider(option.id)
    const list = grouped.get(provider) ?? []
    list.push({ ...option, provider })
    grouped.set(provider, list)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => providerRank(left) - providerRank(right) || left.localeCompare(right))
    .map(([provider, models]) => ({ provider, models }))
}

function activeAgentModelProvider(
  currentModel: string,
  groups: readonly AgentModelGroup[],
  requestedProvider?: string | null,
): string | null {
  if (requestedProvider && groups.some((group) => group.provider === requestedProvider)) return requestedProvider
  return groups.find((group) => group.models.some((model) => model.id === currentModel))?.provider ?? groups[0]?.provider ?? null
}

/**
 * One row of the palette's flat, keyboard-navigable list. A palette row is never a
 * third vocabulary: an `agent` row renders the bay's strip, a `conversation` row the
 * bay's conversation row (sheet 05 — palette rows ARE bay components).
 */
export type PaletteRow =
  | { readonly kind: 'agent'; readonly agentId: string; readonly agent: GreenhouseAgentRecord }
  | { readonly kind: 'conversation'; readonly agentId: string; readonly session: GreenhouseAgentSessionRecord }

/** The strip name resolver the bay and the palette share, so they never diverge. */
export function paletteAgentName(agent: GreenhouseAgentRecord): string {
  return firstNonBlankString(agent.handle, stringAt(agent, ['label']), agent.agentId) ?? agentSelector(agent)
}

/**
 * The palette's only computation: fold the roster + the already-read conversation
 * lists into an ordered, flat list the arrow keys walk. The palette owns no state but
 * its query (sheet 05) — the agents and sessions here are exactly what the bay reads.
 *
 * Matching: a name match surfaces the agent and ALL its conversations (folio 05·A —
 * "lear" surfaces learner-1 and conversations that never contain "lear"); an agent
 * that only has matching conversations surfaces with just those; an empty query lists
 * every resident with its conversations (recents, in roster order).
 */
export function buildPaletteRows(input: {
  readonly agents: readonly GreenhouseAgentRecord[]
  readonly sessionsByAgent: ReadonlyMap<string, readonly GreenhouseAgentSessionRecord[]>
  readonly query: string
}): readonly PaletteRow[] {
  const q = input.query.trim().toLowerCase()
  const rows: PaletteRow[] = []
  for (const agent of input.agents) {
    const agentId = agentSelector(agent)
    const nameMatch = q === '' || paletteAgentName(agent).toLowerCase().includes(q)
    const sessions = input.sessionsByAgent.get(agentId) ?? []
    const conversations = nameMatch
      ? sessions
      : sessions.filter((session) => (session.objective ?? '').toLowerCase().includes(q))
    if (!nameMatch && conversations.length === 0) continue
    rows.push({ kind: 'agent', agentId, agent })
    for (const session of conversations) rows.push({ kind: 'conversation', agentId, session })
  }
  return rows
}

export function renderPresenceStrip(presence: AgentPresenceViewModel, options: PresenceStripOptions = {}): TemplateResult {
  const graph = presence.references.find((reference) => reference.label === 'graph')
  const floorState = options.floor?.floor.state ?? null
  return html`
    <div
      class="presence-strip"
      data-floor-state=${floorState ?? nothing}
      aria-label=${presence.identity.kindLine || 'Agent identity'}
    >
      <div class="presence-sentence">
        ${renderPresenceDot(presence.state)}
        <span class="presence-name mn-kind" data-kind="identity">${presence.identity.name}</span>
        <span class="presence-predicate mn-kind" data-kind="state">${presence.state.lifecycle} on</span>
        ${renderAgentModelPicker(presence.model, options)}
        ${graph ? renderPresenceSentenceReference('in', graph) : nothing}
      </div>
      ${presence.identity.kindLine
        ? html`<div class="presence-kindline mn-kind" data-kind="state">${presence.identity.kindLine}</div>`
        : nothing}
      ${options.brief ? renderTurnoverBrief(options.brief, { onReadReply: options.onReadReply }) : nothing}
      ${options.leftAt != null ? renderWatermarkRule(options.leftAt, options.brief?.eventful ?? false) : nothing}
      ${options.floor ? renderFloorLine(options.floor, options) : nothing}
      ${options.speech
        ? renderSpeechSurface(options.speech, options.composer ?? null, {
            openConductIds: options.openConductIds,
            onToggleConduct: options.onToggleConduct,
          })
        : nothing}
      ${renderPresenceMetaLine(presence.meta, options.recency ?? (options.asOf == null ? null : { capturedAt: options.asOf }))}
    </div>
  `
}

function renderPresenceDot(state: AgentPresenceViewModel['state']): TemplateResult {
  return html`
    <span
      class=${classMap({
        'presence-dot': true,
        [`presence-dot-${state.tone}`]: true,
      })}
      aria-label=${state.lifecycle}
      title=${state.lifecycle}
    ></span>
  `
}

function renderPresenceSentenceReference(prefix: string, reference: AgentPresenceReference): TemplateResult {
  return html`
    <span class="presence-separator">· ${prefix}</span>
    <span class="presence-ref" title=${reference.label}>${reference.value}</span>
  `
}

function renderPresenceMetaLine(
  meta: readonly AgentPresenceReference[],
  recency: Pick<Recency<unknown>, 'capturedAt'> | null = null,
): TemplateResult {
  if (!meta.length && recency === null) return html``
  const parts = meta.map((item) => (item.label === 'updated' ? `updated ${item.value}` : item.value))
  if (recency !== null) parts.push(`as of ${new Date(recency.capturedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
  const line = parts.join(' · ')
  return html`<div class="presence-meta" title=${line}>${line}</div>`
}

function renderFloorLine(floor: AgentFloorViewModel, options: PresenceStripOptions): TemplateResult | typeof nothing {
  const activity = options.floorActivity ?? 'idle'
  const affordance = floor.affordances[0] ?? null
  const busyText =
    activity === 'claiming'
      ? 'taking the controls...'
      : activity === 'releasing'
        ? 'releasing the controls...'
        : activity === 'steering'
          ? 'sending steer...'
          : null

  if (busyText) {
    return html`
      <div class="floor-stack" aria-live="polite">
        <div class="floor-line"><span class="floor-transition">${busyText}</span></div>
        ${renderSteeringQueueLine(floor)}
      </div>
    `
  }

  if (floor.floor.state === 'open') {
    return html`
      <div class="floor-stack" aria-live="polite">
        <div class="floor-line">
          <span>the floor is open</span>
          ${affordance ? html`<span class="floor-separator">—</span>` : nothing}
          ${affordance ? renderFloorAffordance(affordance, options) : nothing}
        </div>
        ${renderSteeringQueueLine(floor)}
      </div>
    `
  }

  const holder = floor.floor.holder
  if (!holder) {
    return renderSteeringQueueLine(floor)
  }
  const sinceValue = floor.floor.testimony?.since
  const since =
    sinceValue !== undefined ? new Date(sinceValue).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  const title = sinceValue !== undefined ? `since ${new Date(sinceValue).toLocaleString()}` : ''
  const label = holder.isSelf ? 'you have the controls' : `${holder.id} has the controls`
  return html`
    <div class="floor-stack" aria-live="polite">
      <div
        class=${classMap({
          'floor-line': true,
          'floor-line-steering': affordance?.intent === 'steer' && Boolean(options.steeringOpen),
        })}
      >
        <span class="floor-holder-label" title=${title}
          >${label}${since ? html` <span class="floor-testimony">since ${since}</span>` : nothing}</span
        >
        ${affordance ? html`<span class="floor-separator">·</span>` : nothing}
        ${affordance ? renderFloorAffordance(affordance, options) : nothing}
      </div>
      ${renderSteeringQueueLine(floor)}
    </div>
  `
}

function renderSteeringQueueLine(floor: AgentFloorViewModel): TemplateResult | typeof nothing {
  if (floor.steeringQueue.count <= 0) return nothing
  return html`
    <div class="floor-queue">
      steering queued: ${floor.steeringQueue.count}${floor.steeringQueue.latestText
        ? html` <span class="floor-separator">—</span> <span>${floor.steeringQueue.latestText}</span>`
        : nothing}
    </div>
  `
}

function renderFloorAffordance(affordance: AgentAffordance, options: PresenceStripOptions): TemplateResult {
  if (affordance.intent === 'steer' && options.steeringOpen) {
    return html`
      <form
        class="steer-form"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault()
          options.onSubmitSteering?.()
        }}
      >
        <input
          class="steer-input"
          aria-label="Steering command"
          .value=${options.steeringText ?? ''}
          @input=${(event: InputEvent) => options.onSteeringText?.((event.target as HTMLInputElement).value)}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Escape') options.onCancelSteering?.()
          }}
        />
      </form>
    `
  }
  return html`
    <button class="text-affordance" type="button" @click=${() => options.onFloorAffordance?.(affordance)}>
      ${affordance.label}
    </button>
  `
}

export function renderSpeechSurface(
  speech: RoomSpeechViewModel,
  composer: SpeechComposerOptions | null = null,
  options: SpeechSurfaceOptions = {},
): TemplateResult | typeof nothing {
  if (!speech.messages.length && speech.turnActivity.state === 'idle' && !composer) return nothing

  return html`
    <div class="speech-surface">
      ${renderTranscript(speech.messages, options)}
      ${renderTurnActivityLine(speech.turnActivity, composer?.agentHandle ?? 'agent')}
      ${composer ? renderComposer(composer) : nothing}
    </div>
  `
}

export function renderTranscript(
  messages: readonly RoomMessage[],
  options: SpeechSurfaceOptions = {},
): TemplateResult | typeof nothing {
  if (!messages.length) return nothing
  return html`
    <div class="transcript" aria-label="Room transcript">
      ${messages.map((message) => renderMessageLine(message, options))}
    </div>
  `
}

function briefTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export interface TurnoverBriefOptions {
  readonly onReadReply?: (messageId: string) => void
}

/**
 * The brief — what changed while you were away, in the fixed grammar (sheet 03).
 * THE UNCHANGED IS UNWRITTEN: a non-eventful brief renders nothing at all (assert
 * absence, not emptiness). The block recedes into transcript history above the
 * watermark rule; it is never dismissed.
 */
export function renderTurnoverBrief(brief: TurnoverBrief, options: TurnoverBriefOptions = {}): TemplateResult | typeof nothing {
  if (!brief.eventful) return nothing
  return html`
    <div class="gh-brief" aria-label="what changed while you were away">
      <p class="gh-brief-head">since you left · ${briefTime(brief.leftAt)} → ${briefTime(brief.until)}</p>
      ${brief.lines.map((line) => renderBriefLine(line, options))}
    </div>
  `
}

function renderBriefLine(line: TurnoverLine, options: TurnoverBriefOptions): TemplateResult {
  switch (line.variant) {
    case 'permission':
    case 'failedTurn':
      // Anomalies: named one by one, danger ink, top of the brief. The procedure
      // (answer / open the trace) lands with the surface that owns it — a later
      // stance — so no dead button renders here (the ink clause on chrome).
      return html`
        <div class="gh-brief-line" data-tier="anomaly">
          <span class="gh-lead">${line.lead}</span>
          <span class="mn-kind" data-kind="prose">${line.detail}</span>
          <span class="gh-when">${briefTime(line.at)}</span>
        </div>
      `
    case 'modelChain':
      return html`
        <div class="gh-brief-line" data-tier="constitution">
          <span>model</span>
          <span class="gh-chain"
            >${line.chain.map((node, index) =>
              index === 0 ? html`${node}` : html`<span class="gh-arrow" aria-hidden="true"> → </span>${node}`,
            )}</span
          >
          ${line.attribution
            ? html`<span class="mn-kind" data-kind="testimony"><span class="mn-kind-attribution">${line.attribution}</span></span>`
            : nothing}
          <span class="gh-when">${briefTime(line.at)}</span>
        </div>
      `
    case 'newConversation':
      return html`
        <div class="gh-brief-line" data-tier="activity">
          <span class="mn-kind" data-kind="state">${line.text}</span>
          <span class="gh-when">${briefTime(line.at)}</span>
        </div>
      `
    case 'turns':
      return html`
        <div class="gh-brief-line" data-tier="activity">
          <span class="mn-kind" data-kind="metric"
            ><span class="mn-kind-value">${formatCount(line.count)}</span
            ><span class="mn-kind-unit">${line.count === 1 ? 'turn' : 'turns'}</span></span
          >
          <span class="mn-kind" data-kind="state">${line.handoff}</span>
          ${line.affordance
            ? html`<button class="gh-aff" type="button" @click=${() => options.onReadReply?.(line.affordance!.ref ?? '')}>
                ${line.affordance.label}
              </button>`
            : nothing}
          <span class="gh-when">${briefTime(line.at)}</span>
        </div>
      `
    case 'floor':
      return html`
        <div class="gh-brief-line" data-tier="activity">
          <span class="mn-kind" data-kind="state">${line.text}</span>
          <span class="gh-when">${briefTime(line.at)}</span>
        </div>
      `
    case 'memory':
      // The count + latest snippet ARE the referent (real memories); the ledger it
      // opens onto is a later surface, so no button renders yet.
      return html`
        <div class="gh-brief-line" data-tier="activity">
          <span class="mn-kind" data-kind="metric"
            ><span class="mn-kind-value">${formatCount(line.count)}</span
            ><span class="mn-kind-unit">${line.count === 1 ? 'memory written' : 'memories written'}</span></span
          >
          ${line.latestSnippet
            ? html`<span class="mn-kind gh-brief-snippet" data-kind="prose">, latest: “${line.latestSnippet}”</span>`
            : nothing}
        </div>
      `
    case 'tokens':
      return html`
        <div class="gh-brief-line" data-tier="whisper">
          <span class="gh-trend"
            >${formatTokens(line.tokens)} tokens this absence${line.trend && line.previous !== null
              ? html` ·
                  <span class=${line.trend}
                    >${line.trend === 'up' ? '↑' : line.trend === 'down' ? '↓' : '—'}</span
                  >
                  ${line.trend === 'flat' ? 'steady' : `vs your last watch (${formatTokens(line.previous)})`}`
              : nothing}</span
          >
        </div>
      `
  }
}

/**
 * The watermark rule — the instrument's self-test. It renders in EVERY return,
 * eventful or not: the dashed line that proves the mark moved with you. When the
 * absence was quiet it is the ENTIRE ink an uneventful return earned (sheet 03·D).
 */
export function renderWatermarkRule(leftAt: number, eventful: boolean): TemplateResult {
  return html`
    <div class="gh-watermark" role="separator" aria-label="you left here">
      <span>you left here · ${briefTime(leftAt)}${eventful ? nothing : ' · quiet since'}</span>
    </div>
  `
}

function renderMessageLine(message: RoomMessage, options: SpeechSurfaceOptions): TemplateResult {
  const time = formatMessageTime(message.at)
  const title = new Date(message.at).toLocaleString()
  const human = message.author.role === 'user' || message.author.isSelf
  const account = message.author.role === 'agent' ? (message.turnAccount ?? buildTurnAccount(message.text)) : null
  const text = account ? account.reply : message.text
  return html`
    <article
      data-message-id=${message.id}
      class=${classMap({
        'message-line': true,
        'message-line-human': human,
        'message-line-agent': message.author.role === 'agent',
      })}
    >
      <div class="message-attribution" title=${title}>${message.author.id} · ${time}</div>
      <div class="message-text">${text}</div>
      ${account && account.conduct.length ? renderConductDisclosure(message.id, account, options) : nothing}
    </article>
  `
}

function renderConductDisclosure(
  messageId: string,
  account: TurnAccount,
  options: SpeechSurfaceOptions,
): TemplateResult {
  const open = options.openConductIds?.has(messageId) ?? false
  return html`
    <div class=${classMap({ 'conduct-account': true, open })}>
      <button
        class="conduct-disclosure"
        type="button"
        aria-expanded=${open ? 'true' : 'false'}
        @click=${() => options.onToggleConduct?.(messageId)}
      >
        <span>conduct: ${account.conduct.length} ${account.conduct.length === 1 ? 'step' : 'steps'}</span>${renderUsageWhisper(
          account,
        )}
      </button>
      ${open
        ? html`<ol class="conduct-lines">
            ${account.conduct.map((step) => renderConductLine(step))}
          </ol>`
        : nothing}
    </div>
  `
}

function renderUsageWhisper(account: TurnAccount): TemplateResult | typeof nothing {
  const parts: string[] = []
  if (typeof account.usage?.tokens === 'number') parts.push(`${formatCount(account.usage.tokens)} tokens`)
  if (typeof account.usage?.toolCalls === 'number') {
    parts.push(`${formatCount(account.usage.toolCalls)} ${account.usage.toolCalls === 1 ? 'tool call' : 'tool calls'}`)
  }
  if (typeof account.usage?.durationMs === 'number') parts.push(`${formatDuration(account.usage.durationMs)}`)
  return parts.length ? html`<span class="conduct-metric">${parts.map((part) => `· ${part}`).join(' ')}</span>` : nothing
}

function renderConductLine(step: ConductStep): TemplateResult {
  return html`
    <li class="conduct-line">
      <span class="conduct-verb">${step.verb}</span>
      ${step.detail ? html`<span class="conduct-detail">${step.detail}</span>` : nothing}
      ${step.outcome ? html`<span class="conduct-outcome">${step.outcome}</span>` : nothing}
      ${step.observer || step.observedAt ? html`<span class="conduct-source">${formatConductSource(step)}</span>` : nothing}
    </li>
  `
}

export function renderTurnActivityLine(activity: TurnActivity, agentHandle: string): TemplateResult | typeof nothing {
  if (activity.state === 'idle') return nothing
  const title = activity.since ? `since ${new Date(activity.since).toLocaleString()}` : ''
  return html`
    <div class="turn-activity" title=${title} aria-live="polite">
      <span>${agentHandle} is taking a turn</span><span class="turn-ellipsis" aria-hidden="true">...</span>
    </div>
  `
}

export function renderComposer(options: SpeechComposerOptions): TemplateResult {
  const disabled = Boolean(options.sending || options.disabledReason)
  const reason = options.disabledReason || options.sendError || null
  return html`
    <form
      class=${classMap({ composer: true, 'composer-sending': !!options.sending })}
      @submit=${(event: SubmitEvent) => {
        event.preventDefault()
        options.onSubmit?.()
      }}
    >
      <input
        class="composer-input"
        aria-label=${`Say something to ${options.agentHandle}`}
        placeholder=${`say something to ${options.agentHandle}...`}
        .value=${options.value}
        ?disabled=${disabled}
        @input=${(event: InputEvent) => options.onInput?.((event.target as HTMLInputElement).value)}
      />
      ${options.sending ? html`<span class="composer-beat" aria-live="polite">sending...</span>` : nothing}
      ${reason && !options.sending ? html`<span class="composer-disabled-reason">${reason}</span>` : nothing}
    </form>
  `
}

export interface BayStripOptions {
  readonly now?: number
  readonly unfolded?: boolean
  readonly onHook?: (agentId: string) => void
  readonly conversations?: TemplateResult | typeof nothing
  /** New turns since the reader's watermark for this agent — the quiet count chip (null → no chip). */
  readonly newSince?: number | null
  /** Unanswered permissions waiting on this agent — the only danger ink in the bay (null/0 → no chip). */
  readonly anomaly?: number | null
  /** Keyboard-selected in the palette — wears the same wash the bay's hover uses. */
  readonly selected?: boolean
}

export interface ConversationRowOptions {
  readonly now?: number
  readonly onEnter?: (conversation: ConversationRow) => void
  /** Keyboard-selected in the palette — wears the same wash the bay's hover uses. */
  readonly selected?: boolean
}

/** Relative under two weeks, tabular-nums in the skin; a real date beyond. Never bare. */
function formatRelativeTime(at: number, now = Date.now()): string {
  const delta = now - at
  if (!Number.isFinite(delta) || delta < 0) return 'just now'
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return new Date(at).toLocaleDateString()
}

function renderStripModelTestimony(model: BayStripModel): TemplateResult {
  const observedAt = model.observedAt ? new Date(model.observedAt) : null
  const title = model.observer
    ? observedAt
      ? `set by ${model.observer} at ${observedAt.toLocaleString()}`
      : `set by ${model.observer}`
    : model.value
  return html`<span class="mn-kind gh-model" data-kind="testimony" title=${title}
    >${model.value}${model.observer ? html`<span class="mn-kind-attribution">set by ${model.observer}</span>` : nothing}</span
  >`
}

export function renderBayStrip(strip: BayStrip, options: BayStripOptions = {}): TemplateResult {
  const now = options.now ?? Date.now()
  const unfolded = options.unfolded ?? false
  return html`
    <div
      class=${classMap({ 'gh-strip': true, hooked: unfolded, 'gh-row-selected': !!options.selected })}
      data-age=${strip.age}
      data-agent=${strip.id}
    >
      <button
        class="gh-strip-hook"
        type="button"
        aria-expanded=${unfolded ? 'true' : 'false'}
        aria-label=${`${strip.identity} — ${strip.stateSentence}`}
        @click=${() => options.onHook?.(strip.id)}
      >
        <span
          class=${classMap({ 'gh-dot': true, [`gh-dot-${strip.tone}`]: true, 'gh-dot-pulse': strip.age === 'stale' })}
          title=${strip.lifecycle}
          aria-hidden="true"
        ></span>
        <span class="gh-strip-lines">
          <span class="gh-strip-line1">
            <span class="mn-kind gh-name" data-kind="identity">${strip.identity}</span>
            <span class="mn-kind gh-statewords" data-kind="state">${strip.stateSentence}</span>
          </span>
          <span class="gh-strip-line2 gh-decays">
            ${strip.model ? renderStripModelTestimony(strip.model) : nothing}
            ${strip.asOf !== null ? html`<span class="gh-asof">as of ${formatRelativeTime(strip.asOf, now)}</span>` : nothing}
          </span>
        </span>
        <span class="gh-strip-right">
          ${options.anomaly && options.anomaly > 0
            ? html`<span class="gh-chip alarm"
                >${formatCount(options.anomaly)} unanswered permission${options.anomaly === 1 ? '' : 's'}</span
              >`
            : nothing}
          ${options.newSince && options.newSince > 0
            ? html`<span class="gh-chip quiet">${formatCount(options.newSince)} new</span>`
            : nothing}
          ${strip.sessionCount !== null
            ? html`<span class="mn-kind gh-decays" data-kind="metric"
                ><span class="mn-kind-value">${formatCount(strip.sessionCount)}</span
                ><span class="mn-kind-unit">${strip.sessionCount === 1 ? 'conversation' : 'conversations'}</span></span
              >`
            : nothing}
        </span>
      </button>
      ${unfolded ? (options.conversations ?? nothing) : nothing}
    </div>
  `
}

export function renderConversationRow(conversation: ConversationRow, options: ConversationRowOptions = {}): TemplateResult {
  const now = options.now ?? Date.now()
  return html`
    <button
      class=${classMap({ 'gh-conv': true, 'gh-conv-hot': conversation.isActive, 'gh-row-selected': !!options.selected })}
      type="button"
      aria-label=${conversation.title ?? conversation.sessionId}
      @click=${() => options.onEnter?.(conversation)}
    >
      ${conversation.title
        ? html`<span class="mn-kind gh-conv-title" data-kind="reference"
            ><span class="mn-kind-link">${conversation.title}</span></span
          >`
        : html`<span class="gh-conv-untitled" title="no objective was recorded for this conversation"
            >${conversation.sessionId}</span
          >`}
      <span class="gh-conv-meta">
        ${conversation.isActive ? html`<span class="gh-conv-live">active</span>` : nothing}
        ${conversation.messageCount !== null
          ? html`<span>${formatCount(conversation.messageCount)} ${conversation.messageCount === 1 ? 'message' : 'messages'}</span>`
          : nothing}
        ${conversation.lastMessageAt !== null ? html`<span>last ${formatRelativeTime(conversation.lastMessageAt, now)}</span>` : nothing}
      </span>
    </button>
  `
}

// ——— the recognition mark: the agent's deterministic botanical portrait ———

/**
 * The mark zone (folio 02, sheet 08). A deterministic botanical arrangement painted
 * in the agent's team color — recognition + affection, the one licensed flourish. It
 * carries the VRM awaits-chip: the mark stands down the day the agent designs its own
 * portrait (the atelier's licensed ground). The color is identity, never status.
 */
export function renderAgentMark(mark: AgentMark, options: { readonly desk?: boolean } = {}): TemplateResult {
  return html`
    <div
      class=${classMap({ 'c2-mark': true, 'c2-mark-desk': options.desk === true })}
      style=${`--agent-color:${mark.color}`}
      aria-hidden="true"
    >
      ${renderMarkArrangement(mark)}
      <span class="vrm-chip chip-await">VRM portrait — awaits the atelier</span>
    </div>
  `
}

function renderMarkArrangement(mark: AgentMark): TemplateResult {
  const c = mark.color
  if (mark.arrangement === 'cluster') {
    return html`<svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true">
      <line x1="24" y1="72" x2="72" y2="72" stroke=${c} stroke-width="2" />
      <circle cx="33" cy="52" r="9" fill=${c} opacity=".7" />
      <circle cx="63" cy="52" r="9" fill=${c} opacity=".7" />
      <circle cx="48" cy="30" r="12" fill=${c} />
      <line x1="33" y1="52" x2="48" y2="34" stroke=${c} stroke-width="1.5" opacity=".6" />
      <line x1="63" y1="52" x2="48" y2="34" stroke=${c} stroke-width="1.5" opacity=".6" />
    </svg>`
  }
  if (mark.arrangement === 'sprig') {
    return html`<svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true">
      <line x1="30" y1="82" x2="62" y2="30" stroke=${c} stroke-width="2" />
      <circle cx="64" cy="26" r="11" fill=${c} />
      <circle cx="44" cy="52" r="7" fill=${c} opacity=".65" />
      <circle cx="53" cy="40" r="5" fill=${c} opacity=".5" />
      <circle cx="36" cy="66" r="5" fill=${c} opacity=".4" />
    </svg>`
  }
  // spray — the default
  return html`<svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true">
    <line x1="48" y1="84" x2="48" y2="34" stroke=${c} stroke-width="2" />
    <circle cx="48" cy="26" r="12" fill=${c} />
    <circle cx="30" cy="46" r="8" fill=${c} opacity=".7" />
    <circle cx="66" cy="46" r="8" fill=${c} opacity=".7" />
    <circle cx="38" cy="66" r="5" fill=${c} opacity=".45" />
    <circle cx="58" cy="66" r="5" fill=${c} opacity=".45" />
  </svg>`
}

export interface AgentCardOptions {
  readonly now?: number
  /** Reveal the read-only charter body (the "read it" affordance scrolls/opens it). */
  readonly onReadCharter?: () => void
}

/** A card date: relative under two weeks, a plain ISO date beyond. Never bare. */
function cardDate(at: number, now: number): string {
  const days = (now - at) / 86_400_000
  if (days < 14 && days >= 0) return formatRelativeTime(at, now)
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * The recognition card at reading scale — the CONSTITUTION room's matter (folio 02,
 * sheet 09·B, carrying the mark of sheet 08 per the build charter). Fixed zones read
 * the same way every time: mark + plate, lineage, envelope, loadout, service record,
 * and the charter — the agent's real system prompt, READ-ONLY (editing is hoja, which
 * waits on R0). °chips mark every zone with no served source; a number never lies.
 */
export function renderAgentCard(card: AgentCardViewModel, options: AgentCardOptions = {}): TemplateResult {
  const now = options.now ?? Date.now()
  return html`
    <div class="gh-card" style=${`--agent-color:${card.mark.color}`}>
      ${renderAgentMark(card.mark)}
      <div class="gh-card-plate">
        <div class="gh-card-head">
          <span class=${classMap({ 'gh-dot': true, [`gh-dot-${card.tone}`]: true })} title=${card.lifecycleWord} aria-hidden="true"></span>
          <span class="gh-name mn-kind" data-kind="identity">${card.identity}</span>
        </div>
        <div class="gh-card-sub">${card.sub}</div>
        ${card.kindLine ? html`<p class="gh-kindline mn-kind" data-kind="state">${card.kindLine}</p>` : nothing}
      </div>

      <div class="gh-card-section">
        <p class="gh-card-eyebrow">lineage</p>
        <div class="gh-card-row">
          <span class="k">charter binding</span>
          ${card.charter.bindingName
            ? html`<span class="mono">${card.charter.bindingName}</span>`
            : html`<span class="gh-void-line">no binding attested</span>`}
          ${card.charter.promotedAt !== null
            ? html`<span class="mn-kind" data-kind="testimony"><span class="mn-kind-attribution">promoted ${cardDate(card.charter.promotedAt, now)}</span></span>`
            : card.awaits.bindingHistory
              ? html`<span class="chip-await" title="binding history is unlisted — K2">history unlisted °K2</span>`
              : nothing}
        </div>
        <div class="gh-card-row">
          <span class="k">prompt state</span>
          ${card.charter.seeded
            ? html`<span class="drift-word" title="the graph read failed — this charter is a hardcoded fallback, not testimony">fallback identity — graph unread</span>`
            : card.charter.dirty
              ? html`<span class="drift-word">edited, not promoted</span>`
              : html`<span class="mn-kind" data-kind="state">clean</span>`}
        </div>
        ${card.lineage.hasPrior && card.lineage.formerlyId
          ? html`<div class="gh-card-row">
              <span class="k">formerly</span>
              <span class="mono">${card.lineage.formerlyId}</span>
              ${card.lineage.retiredAt !== null
                ? html`<span class="mn-kind" data-kind="testimony"><span class="mn-kind-attribution">retired ${cardDate(card.lineage.retiredAt, now)}</span></span>`
                : nothing}
            </div>`
          : nothing}
      </div>

      <div class="gh-card-section">
        <p class="gh-card-eyebrow">envelope</p>
        <div class="gh-card-row">
          <span class="k">model</span>
          ${card.model
            ? html`<span class="mn-kind" data-kind="testimony"
                >${card.model.value}${card.model.observer
                  ? html`<span class="mn-kind-attribution">set by ${card.model.observer}${card.model.eventSeq !== null ? ` · seq ${card.model.eventSeq}` : ''}</span>`
                  : nothing}</span
              >`
            : html`<span class="gh-void-line">no model set</span>`}
        </div>
        <div class="gh-card-row">
          <span class="k">ward</span>
          ${card.ward.maxTurns !== null
            ? html`<span class="mn-kind" data-kind="testimony">${card.ward.maxTurns} turns per run</span>`
            : html`<span class="chip-await" title="the ward turn budget is not attested in the world doc — K4">envelope awaits °K4</span>`}
        </div>
        ${card.ward.gatedTools.length
          ? html`<div class="gh-card-row"><span class="k">gates</span><span class="mn-kind" data-kind="state">${card.ward.gatedTools.join(' · ')}</span></div>`
          : nothing}
      </div>

      <div class="gh-card-section">
        <p class="gh-card-eyebrow">loadout</p>
        <div class="gh-card-row">
          <span class="k">mounted</span>
          ${card.loadout.mounted.length
            ? html`<span>${card.loadout.mounted.join(' · ')}</span>`
            : html`<span class="gh-void-line">no tools mounted</span>`}
          <span class="mn-kind gh-card-metric" data-kind="metric"
            ><span class="mn-kind-value">${card.loadout.available}</span><span class="mn-kind-unit">of ${card.loadout.total}</span></span
          >
        </div>
        ${card.loadout.hung.length
          ? html`<div class="gh-card-row"><span class="k">hung</span><span class="alarm-word">${card.loadout.hung.join(', ')}</span></div>`
          : nothing}
      </div>

      <div class="gh-card-section">
        <p class="gh-card-eyebrow">service record</p>
        <div class="gh-card-row">
          <span class="k">conversations</span>
          ${card.conversations !== null
            ? html`<span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.conversations)}</span></span>`
            : html`<span class="gh-void-line">unattested</span>`}
          <span class="k" style="min-width:0">· career turns</span>
          ${card.careerTurns !== null
            ? html`<span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.careerTurns)}</span></span>`
            : html`<span class="chip-await" title="career rollup is unbuilt — K1">°K1</span>`}
          <span class="k" style="min-width:0">· memories</span>
          ${card.careerMemories !== null
            ? html`<span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.careerMemories)}</span></span>`
            : html`<span class="chip-await" title="lifetime memory count has no served source yet">°</span>`}
        </div>
        <div class="gh-card-row">
          <span class="k">incidents</span>
          ${card.incidents !== null
            ? card.incidents.count > 0
              ? html`<span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value alarm-word">${formatCount(card.incidents.count)}</span></span>
                  ${card.incidents.latest
                    ? html`<span class="mn-kind" data-kind="state">latest ${formatIncidentKind(card.incidents.latest.kind)} · ${formatRelativeTime(card.incidents.latest.ts, now)}</span>`
                    : nothing}`
              : html`<span class="gh-void-line">none witnessed this epoch</span>`
            : html`<span class="chip-await" title="incident list is unbuilt — K3">°K3</span>`}
        </div>
      </div>

      <div class="gh-card-section gh-card-charter">
        <p class="gh-card-eyebrow">charter${card.charter.title ? html` · ${card.charter.title}` : nothing}</p>
        ${card.charter.text
          ? html`<div class="gh-charter-doc" data-kind="prose">
              ${card.charter.text
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter((para) => para.length)
                .map((para) => html`<p>${para}</p>`)}
            </div>`
          : html`<p class="gh-void-line">no charter text served</p>`}
        <div class="gh-charter-foot">
          ${card.charter.snapshotId ? html`<span>snapshot ${card.charter.snapshotId}</span>` : nothing}
          ${card.charter.digest ? html`<span>digest ${card.charter.digest.slice(0, 6)}…</span>` : nothing}
          <span class="gh-charter-hoja">editing arrives with hoja</span>
        </div>
        <div class="gh-card-row">
          <span class="mn-kind" data-kind="reference"><span class="mn-kind-link">${card.identity} system prompt</span></span>
          <span class="gh-void-line" style="margin-left:auto">${card.charter.hasStandingOrders ? nothing : 'no standing orders'}</span>
        </div>
      </div>
    </div>
  `
}

// ——— the recognition card at DESKTOP scale: the CONSTITUTION room's wide composition ———

/**
 * The loadout as stations on a rail (folio 02, #desk-card). This is the one instrument
 * that always draws from fully served data — the real toolbelt. Each mounted tool is a
 * lit station in the agent's team color; a required-but-missing tool is a hollow
 * warning ring (a hung store). No tools mounted → the honest void line, never an empty
 * rail dressed up as health.
 */
/** One station on the loadout rail — its tool name, its rail x, and whether it is lit. */
export interface StationDot {
  readonly name: string
  /** The rail x for this station, evenly spaced across the loadout. */
  readonly x: number
  /** Lit in team color when the tool is available; a hollow warning ring when hung. */
  readonly on: boolean
}

const STATION_RAIL_X1 = 12
const STATION_RAIL_X2 = 328
const STATION_RAIL_Y = 13

/** The pure layout of the loadout stations — a lit dot per served tool, evenly spaced. */
export function loadoutStationLayout(loadout: AgentCardLoadout): readonly StationDot[] {
  const span = STATION_RAIL_X2 - STATION_RAIL_X1
  return loadout.tools.map((tool, index) => ({
    name: tool.name,
    x: STATION_RAIL_X1 + span * ((index + 0.5) / loadout.tools.length),
    on: tool.available,
  }))
}

export function renderLoadoutStations(loadout: AgentCardLoadout): TemplateResult {
  const dots = loadoutStationLayout(loadout)
  if (!dots.length) return html`<p class="gh-void-line">no tools mounted</p>`
  const y = STATION_RAIL_Y
  return html`
    <svg class="stations" viewBox="0 0 340 40" height="40" role="img" aria-label=${`loadout ${loadout.available} of ${loadout.total} mounted`}>
      <line class="rail" x1=${STATION_RAIL_X1} y1=${y} x2=${STATION_RAIL_X2} y2=${y}></line>
      ${dots.map((dot) => svg`<circle class=${dot.on ? 'on' : 'off'} cx=${dot.x} cy=${y} r="5"></circle>`)}
      ${dots.map((dot) => svg`<text x=${dot.x} y="33" text-anchor="middle">${dot.name}</text>`)}
    </svg>
  `
}

/**
 * The lineage as a chain (folio 02, #desk-card). The current binding's promotion is
 * served testimony, so the "now" node draws with its promoted date. When the served
 * binding chain (K2) holds a superseded predecessor, the rail gains its real second
 * (past) dot and the retired binding's short id; a single-binding served history draws
 * only the now node (no chip); an unfetched history keeps the °K2 legend.
 */
export function renderLineageChain(card: AgentCardViewModel, now: number): TemplateResult {
  const { charter, lineage, awaits } = card
  const leftText =
    lineage.hasPrior && lineage.formerlyId
      ? `${lineage.formerlyId} · retired`
      : awaits.bindingHistory
        ? 'history unlisted °K2'
        : 'origin binding'
  return html`
    <svg class="chain" viewBox="0 0 340 30" height="30" role="img" aria-label="lineage">
      <line class="rail" x1="12" y1="11" x2="328" y2="11"></line>
      ${lineage.hasPrior ? svg`<circle class="past" cx="60" cy="11" r="4"></circle>` : nothing}
      <circle class="now" cx="295" cy="11" r="5"></circle>
      <text x="12" y="28">${leftText}</text>
      ${charter.promotedAt !== null ? svg`<text x="328" y="28" text-anchor="end">promoted ${cardDate(charter.promotedAt, now)}</text>` : nothing}
    </svg>
  `
}

/**
 * The incidents instrument (folio 02, #desk-card) — a bounded, newest-first list, each
 * with its ts. Drawn only when the incident list is served (K3): a served-but-empty
 * summary renders "none witnessed this epoch"; an unfetched one is not drawn here (the
 * stat cell carries its ° chip). The kind is real testimony, elided for reading.
 */
export function renderIncidentsInstrument(incidents: AgentCardIncidents, now: number): TemplateResult {
  if (incidents.count === 0) return html`<p class="gh-void-line">none witnessed this epoch</p>`
  return html`
    <ul class="gh-incidents" aria-label=${`${incidents.count} incidents`}>
      ${incidents.recent.map(
        (incident) => html`<li class="gh-incident">
          <span class="gh-incident-kind alarm-word" title=${incident.kind}>${formatIncidentKind(incident.kind)}</span>
          <span class="gh-incident-when">${formatRelativeTime(incident.ts, now)}</span>
        </li>`,
      )}
      ${incidents.count > incidents.recent.length
        ? html`<li class="gh-incident-more">+${formatCount(incidents.count - incidents.recent.length)} earlier</li>`
        : nothing}
    </ul>
  `
}

/**
 * The recognition card at DESKTOP scale — the CONSTITUTION room's wide-viewport form
 * (folio 02, #desk-card). It is the SAME recognition object as the compact card (the
 * same `AgentCardViewModel`, the same mark, plate, charter, loadout) re-laid as one
 * composed data surface: an identity column, the six-cell stat matrix, an instruments
 * column, and the charter as an embedded read-only document pane. Not a different card
 * — a responsive posture; narrow viewports keep the compact card.
 *
 * The ink clause governs the instruments absolutely: an instrument with no served datum
 * renders NOTHING (never a fake chart). Through the card model, only the loadout (real
 * toolbelt), the envelope's model testimony, and the lineage's promotion date carry
 * served data today, so only those three instruments draw. Activity / burn sparklines
 * need a served per-turn time series that does not exist yet, so they are absent, not
 * faked; the ward's V-n region waits on K4 and shows its chip, not an invented bar.
 *
 * WEFT — the three distinguishing features — comes from observed conduct. The world
 * doc serves no conduct surface today (the memory section is empty for a completed
 * agent), so the WEFT zone is silent: nothing is invented, and it fills the day
 * conduct is served (the deferral is noted, not papered over).
 */
export function renderAgentCardDesk(card: AgentCardViewModel, options: AgentCardOptions = {}): TemplateResult {
  const now = options.now ?? Date.now()
  return html`
    <div class="gh-card-desk desk-cardgrid" style=${`--agent-color:${card.mark.color}`}>
      <div class="desk-left">
        <p class="c2-face-label">the card · desktop composition</p>
        ${renderAgentMark(card.mark, { desk: true })}
        <div class="c2-plate">
          <div class="nm mn-kind" data-kind="identity">${card.identity}</div>
          <div class="sub">${card.sub}</div>
        </div>
        ${card.kindLine ? html`<p class="c2-kind mn-kind" data-kind="state">${card.kindLine}</p>` : nothing}
        <!--
          WEFT zone (distinguishing conduct) is deliberately silent: no served conduct
          surface exists in the world doc, so nothing is drawn (ink clause). It is a
          zone that fills, not a list that lies.
        -->
        <div class="desk-divrow">
          <span class="mn-kind" data-kind="state">${card.lifecycleWord}</span>
          <span class="desk-colors">colors: ${card.mark.colorName}</span>
        </div>
        <div class="desk-divrow">
          <span class="gh-void-line">${card.charter.hasStandingOrders ? nothing : 'no standing orders — night orders are a horizon'}</span>
        </div>
      </div>

      <div class="desk-stats" role="group" aria-label="service record">
        <div class="c2-stat">
          ${card.conversations !== null
            ? html`<div class="v"><span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.conversations)}</span></span></div>`
            : html`<div class="v void">—<sup class="await" title="the roster did not serve sessionCount">°</sup></div>`}
          <div class="l">conversations</div>
        </div>
        <div class="c2-stat">
          ${card.careerTurns !== null
            ? html`<div class="v"><span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.careerTurns)}</span></span></div>`
            : html`<div class="v void">—<sup class="await" title="career rollup unserved — K1">°</sup></div>`}
          <div class="l">career turns</div>
        </div>
        <div class="c2-stat">
          ${card.careerTokens !== null
            ? html`<div class="v"><span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatTokens(card.careerTokens)}</span></span></div>`
            : html`<div class="v void">—<sup class="await" title="career rollup unserved — K1">°</sup></div>`}
          <div class="l">career tokens</div>
        </div>
        <div class="c2-stat">
          ${card.careerMemories !== null
            ? html`<div class="v"><span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${formatCount(card.careerMemories)}</span></span></div>`
            : html`<div class="v void">—<sup class="await" title="lifetime memory count has no served source yet">°</sup></div>`}
          <div class="l">memories</div>
        </div>
        <div class="c2-stat">
          ${card.incidents !== null
            ? html`<div class=${classMap({ v: true, 'alarm-word': card.incidents.count > 0 })}>${formatCount(card.incidents.count)}</div>`
            : html`<div class="v void">—<sup class="await" title="incident list is unfetched — K3">°</sup></div>`}
          <div class="l">incidents</div>
        </div>
        <div class="c2-stat">
          ${card.firstSessionAt !== null
            ? html`<div class="v"><span class="mn-kind gh-card-metric" data-kind="metric"><span class="mn-kind-value">${compactDuration(now - card.firstSessionAt)}</span></span></div>`
            : html`<div class="v void">—<sup class="await" title="first-session date has no served source yet">°</sup></div>`}
          <div class="l">age</div>
        </div>
      </div>

      <div class="desk-insts">
        <div class="inst">
          <p class="dl">loadout · ${card.loadout.available} of ${card.loadout.total} mounted</p>
          ${renderLoadoutStations(card.loadout)}
          ${card.loadout.hung.length
            ? html`<div class="inst-row"><span class="k">hung</span><span class="alarm-word">${card.loadout.hung.join(', ')}</span></div>`
            : nothing}
        </div>
        <div class="inst">
          <p class="dl">envelope</p>
          <div class="inst-row">
            <span class="k">model</span>
            ${card.model
              ? html`<span class="mn-kind" data-kind="testimony"
                  >${card.model.value}${card.model.observer
                    ? html`<span class="mn-kind-attribution">set by ${card.model.observer}</span>`
                    : nothing}</span
                >`
              : html`<span class="gh-void-line">no model set</span>`}
          </div>
          <div class="inst-row">
            <span class="k">ward</span>
            ${card.ward.maxTurns !== null
              ? html`<span class="mn-kind" data-kind="testimony">${card.ward.maxTurns} turns per run</span>`
              : html`<span class="chip-await" title="the ward turn budget is not attested in the world doc — K4">envelope awaits °K4</span>`}
          </div>
          ${card.ward.gatedTools.length
            ? html`<div class="inst-row"><span class="k">gates</span><span class="mn-kind" data-kind="state">${card.ward.gatedTools.join(' · ')}</span></div>`
            : nothing}
        </div>
        <div class="inst">
          <p class="dl">lineage</p>
          ${renderLineageChain(card, now)}
        </div>
        ${card.incidents !== null
          ? html`<div class="inst">
              <p class="dl">incidents</p>
              ${renderIncidentsInstrument(card.incidents, now)}
            </div>`
          : nothing}
      </div>

      <div class="hoja-embed" aria-label="the charter — read-only">
        <div class="hoja-head">
          <span class="ht mn-kind" data-kind="identity">the charter — ${card.identity} system prompt</span>
          <span class="hoja-drift mn-kind" data-kind="state"
            >${card.charter.seeded
              ? html`<span class="drift-word" title="the graph read failed — this charter is a hardcoded fallback, not testimony">fallback identity — graph unread</span>`
              : card.charter.dirty
                ? html`<span class="drift-word">edited, not promoted</span>`
                : 'clean'}${card.charter.promotedAt !== null ? html` · promoted ${cardDate(card.charter.promotedAt, now)}` : nothing}</span
          >
          <span class="gh-hoja">hoja</span>
        </div>
        <div class="hoja-doc" data-kind="prose">
          ${card.charter.text
            ? card.charter.text
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter((para) => para.length)
                .map((para) => html`<p>${para}</p>`)
            : html`<p class="gh-void-line">no charter text served</p>`}
        </div>
        <div class="hoja-foot">
          ${card.charter.snapshotId ? html`<span>snapshot ${card.charter.snapshotId}</span>` : nothing}
          ${card.charter.digest ? html`<span>digest ${card.charter.digest.slice(0, 6)}…</span>` : nothing}
          <span class="hoja-foot-note">editing arrives with hoja</span>
        </div>
      </div>
    </div>
  `
}

// ——— the bay, re-sentenced: a strip under CONSTITUTION weather (folio 02, sheet 10) ———

export interface ConstitutionStripOptions {
  readonly onHook?: (agentId: string) => void
}

/**
 * The rack is invariant across stances — same strip, same order, same dot. Only the
 * sentence and chips change register: from what it's DOING to what it IS. Room's count
 * chips do not appear here; drift is Constitution's amber. Hooking inherits the stance
 * (the app lands you on the card, not the conversation).
 */
export function renderConstitutionStrip(strip: ConstitutionStrip, options: ConstitutionStripOptions = {}): TemplateResult {
  return html`
    <div class=${classMap({ 'gh-strip': true, 'gh-strip-unattested': !strip.attested })} data-agent=${strip.id}>
      <button
        class="gh-strip-hook"
        type="button"
        aria-label=${`${strip.identity} — ${strip.stateSentence}`}
        @click=${() => options.onHook?.(strip.id)}
      >
        <span class=${classMap({ 'gh-dot': true, [`gh-dot-${strip.tone}`]: true })} aria-hidden="true"></span>
        <span class="gh-strip-lines">
          <span class="gh-strip-line1">
            <span class="mn-kind gh-name" data-kind="identity">${strip.identity}</span>
            <span class="mn-kind gh-statewords" data-kind="state">${strip.stateSentence}</span>
          </span>
          <span class="gh-strip-line2">
            ${strip.testimony
              ? html`<span class="mn-kind" data-kind="testimony"
                  >${strip.testimony.text}${strip.testimony.attribution
                    ? html`<span class="mn-kind-attribution">${strip.testimony.attribution}</span>`
                    : nothing}</span
                >`
              : nothing}
          </span>
        </span>
        <span class="gh-strip-right">
          ${strip.drift.map((label) => html`<span class="gh-chip drift">${label}</span>`)}
        </span>
      </button>
    </div>
  `
}

function renderAgentModelPicker(model: AgentPresenceModel, options: PresenceStripOptions): TemplateResult {
  const groups = options.modelGroups ?? agentModelGroups(model.value)
  const activeProvider = activeAgentModelProvider(model.value, groups, options.activeProvider)
  const activeModels = groups.find((group) => group.provider === activeProvider)?.models ?? []
  const observedAt = model.observedAt ? new Date(model.observedAt) : null
  const attributionTitle = model.observer
    ? observedAt
      ? `set by ${model.observer} at ${observedAt.toLocaleString()}`
      : `set by ${model.observer}`
    : ''
  const simulated = model.value.startsWith('mock:')
  // Phosphor honesty: a seeded model value is a hardcoded fallback (the graph read
  // failed), not testimony — the same amber register as the charter's drift-word,
  // never danger red (degraded-but-live, not error). Ink is sparing: no new chip,
  // just the existing chip's color + an explanatory title.
  const seededTitle = 'fallback identity — graph unread: the graph could not be read, so this model is a hardcoded default, not testimony'
  return html`
    <div
      class=${classMap({ 'presence-model': true, 'model-stat': true, open: !!options.pickerOpen })}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Escape') options.onToggleModelPicker?.()
      }}
    >
      <button
        class=${model.seeded ? 'agent-model-trigger agent-model-trigger-seeded' : 'agent-model-trigger'}
        type="button"
        aria-haspopup="listbox"
        aria-expanded=${options.pickerOpen ? 'true' : 'false'}
        ?disabled=${!!options.changingModel}
        title=${model.seeded ? seededTitle : model.value}
        @click=${() => options.onToggleModelPicker?.()}
      >
        <span class="agent-model-name">${model.value ? modelLabel(model.value) : 'set a model…'}</span>
        <span class="agent-model-caret" aria-hidden="true">v</span>
      </button>
      ${simulated ? html`<span class="presence-model-simulated">(simulated)</span>` : nothing}
      ${model.observer
        ? html`<span class="presence-model-attribution mn-kind" data-kind="testimony" title=${attributionTitle}
            ><span class="mn-kind-attribution">set by ${model.observer}</span></span
          >`
        : nothing}
      ${options.pickerOpen
        ? html`
            <div class="agent-model-picker" role="listbox" aria-label="Agent model picker">
              <div class="agent-model-providers" role="group" aria-label="Model providers">
                ${groups.map((group) => {
                  const active = group.provider === activeProvider
                  const selected = group.models.some((item) => item.id === model.value)
                  return html`
                    <button
                      class=${classMap({
                        'agent-model-provider': true,
                        active,
                        selected,
                      })}
                      type="button"
                      aria-pressed=${active ? 'true' : 'false'}
                      @mouseenter=${() => options.onChooseProvider?.(group.provider)}
                      @focus=${() => options.onChooseProvider?.(group.provider)}
                      @click=${() => options.onChooseProvider?.(group.provider)}
                    >
                      ${group.provider}
                    </button>
                  `
                })}
              </div>
              <div class="agent-model-models">
                ${activeModels.map(
                  (item) => html`
                    <button
                      class=${classMap({
                        'agent-model-option': true,
                        selected: item.id === model.value,
                      })}
                      type="button"
                      role="option"
                      aria-selected=${item.id === model.value ? 'true' : 'false'}
                      @click=${() => options.onChangeModel?.(item.id)}
                    >
                      <span class="agent-model-option-name">${item.label}</span>
                    </button>
                  `,
                )}
              </div>
            </div>
          `
        : nothing}
    </div>
  `
}

@customElement('greenhouse-app')
export class GreenhouseApp extends LitElement {
  config: GreenhouseConfig = readGreenhouseConfig()
  service: GreenhouseService = createGreenhouseService(this.config)
  store: GreenhouseStore = createGreenhouseStore(this.config, this.service)

  @state()
  private liveState: GreenhouseStoreState = this.store.get()

  @state()
  private agentModelPickerOpen = false

  @state()
  private agentModelProvider: string | null = null

  @state()
  private changingModel = false

  @state()
  private floorActivity: 'idle' | 'claiming' | 'releasing' | 'steering' = 'idle'

  @state()
  private steeringOpen = false

  @state()
  private steeringText = ''

  @state()
  private composerText = ''

  @state()
  private sendingMessage = false

  @state()
  private sendError = ''

  @state()
  private openConductMessageIds = new Set<string>()

  @state()
  private view: GreenhouseView = 'bay'

  @state()
  private unfoldedAgentId: string | null = null

  @state()
  private sessionsByAgent = new Map<string, SessionLoad>()

  @state()
  private enteredAgentId: string | null = null

  @state()
  private logLoad: LogLoad = IDLE_LOG

  // ——— the palette (⌘O): reflex navigation, zero standing pixels ———

  @state()
  private paletteOpen = false

  @state()
  private paletteQuery = ''

  @state()
  private paletteSelectedIndex = 0

  // ——— the master switch: the app-global cockpit posture (folio 02, sheet 00) ———
  // Exactly two stances ship today. The switch re-weights the same instruments; it
  // never navigates and NEVER flips itself — the flip is always a deliberate hand.
  @state()
  private stance: 'room' | 'constitution' = 'room'

  // ——— responsive posture: the CONSTITUTION card composes wide (folio 02, #desk-card) ———
  // Not a different card — the same recognition object, re-laid for the desk. Below the
  // breakpoint the compact card holds; at/above it the desktop composition draws. Pure
  // viewport listening (matchMedia), no layout thrash. 1080px clears the 3-column grid
  // and sits above the test env's default width, so tests deterministically read narrow.
  private static readonly DESK_QUERY = '(min-width: 1080px)'
  @state()
  private deskWide = false
  private deskMedia: MediaQueryList | null = null

  private booted = false
  private unsubscribeStore: (() => void) | null = null
  private stopPolling: (() => void) | null = null

  /**
   * The watermark the CURRENT room visit reads against, captured at entry and held
   * fixed for the visit so the brief recedes but never changes under the reader.
   * The persisted mark (in the browser store) advances on leave.
   */
  private roomWatermark: AgentWatermark | null = null
  private roomEnteredAt = 0
  /** In-memory mirror of the persisted marks, keyed by the storage key. */
  private watermarkCache = new Map<string, AgentWatermark | null>()

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('data-skin', 'greenhouse')
    this.setAttribute('data-stance', 'room')
    this.liveState = this.store.get()
    this.unsubscribeStore = this.store.subscribe((state) => {
      this.liveState = state
    })
    window.addEventListener('keydown', this.onGlobalKeydown)
    this.watchDeskWidth()
    this.start()
  }

  disconnectedCallback(): void {
    if (this.view === 'room') this.leaveRoom()
    window.removeEventListener('keydown', this.onGlobalKeydown)
    this.deskMedia?.removeEventListener?.('change', this.onDeskWidthChange)
    this.deskMedia = null
    this.stopPolling?.()
    this.stopPolling = null
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
    super.disconnectedCallback()
  }

  /**
   * Listen for the desk-width breakpoint so the CONSTITUTION card can compose wide.
   * Guarded so a matchMedia-less environment simply stays narrow (the compact card) —
   * the composition is an enhancement, never a requirement.
   */
  private watchDeskWidth(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    this.deskMedia = window.matchMedia(GreenhouseApp.DESK_QUERY)
    this.deskWide = this.deskMedia.matches
    this.deskMedia.addEventListener?.('change', this.onDeskWidthChange)
  }

  private onDeskWidthChange = (event: MediaQueryListEvent): void => {
    this.deskWide = event.matches
  }

  /**
   * Esc is the keyboard twin of the mast's ancestor rung: it climbs from a room or
   * a log back to the bay. It defers to the transient overlays that own Esc first —
   * the model picker and the steering input — so the same key never means two things
   * at once.
   */
  private onGlobalKeydown = (event: KeyboardEvent): void => {
    // ⌘1 / ⌘3 flip the app-global stance (sheet 00: the master switch, ⌘1–4). Only
    // Room and Constitution ship, so only ⌘1 and ⌘3 are live. A deliberate act — the
    // switch re-weights the cockpit, it never navigates and nothing auto-flips it.
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      if (event.key === '1') {
        event.preventDefault()
        this.setStance('room')
        return
      }
      if (event.key === '3') {
        event.preventDefault()
        this.setStance('constitution')
        return
      }
    }
    // ⌘O / Ctrl+O raises the palette over a dimmed surface — the one sideways jump,
    // available from the bay and from a room alike (sheet 00: ⌘O the sideways jump).
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      this.togglePalette()
      return
    }
    if (event.key !== 'Escape') return
    // The palette owns Esc first while it is open — it closes without climbing the mast.
    if (this.paletteOpen) {
      event.preventDefault()
      this.closePalette()
      return
    }
    if (this.agentModelPickerOpen) {
      this.agentModelPickerOpen = false
      return
    }
    if (this.steeringOpen) {
      this.closeSteering()
      return
    }
    if (this.view === 'room' || this.view === 'log') {
      event.preventDefault()
      this.climbToBay()
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    if ((changed as Map<string, unknown>).has('steeringOpen') && this.steeringOpen) {
      this.renderRoot.querySelector<HTMLInputElement>('.steer-input')?.focus()
    }
    // The palette query owns the focus the instant it is raised.
    if ((changed as Map<string, unknown>).has('paletteOpen') && this.paletteOpen) {
      this.renderRoot.querySelector<HTMLInputElement>('.gh-query-input')?.focus()
    }
    // Keep the keyboard-selected row in view as the arrows walk the list.
    if (this.paletteOpen) {
      this.renderRoot
        .querySelector(`.gh-palette-row[data-palette-index="${this.paletteSelectedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
    this.syncFloorStateAttribute()
  }

  protected render(): TemplateResult {
    const shell = this.renderShellForScreen()
    // Zero standing pixels: the palette exists only while held open (sheet 05). The
    // display:contents root keeps the shell a layout child of :host while giving the
    // template a real root element (a bare ${a}${b} top level mis-parses under happy-dom).
    return html`<div class="gh-root">${shell}${this.paletteOpen ? this.renderPalette() : nothing}</div>`
  }

  private renderShellForScreen(): TemplateResult {
    const screen = this.screen()
    if (screen === 'loading') return this.renderShell(this.renderBayMast(), this.renderLoadingBody())
    if (screen === 'dark') return this.renderShell(this.renderBayMast(), this.renderDarkBody())
    if (screen === 'empty') return this.renderShell(this.renderBayMast(), this.renderEmptyBody())
    if (this.view === 'room') return this.renderShell(this.renderRoomMast(), this.renderRoomBody())
    if (this.view === 'log') return this.renderShell(this.renderLogMast(), this.renderLogBody())
    return this.renderShell(this.renderBayMast(), this.renderBayBody())
  }

  /** The five zones: mast (Ⓐ), surface (Ⓓ), ground line (Ⓔ). Annunciator (Ⓑ) stays unlit until a second stance ships. */
  private renderShell(mast: TemplateResult, body: TemplateResult): TemplateResult {
    return html`
      <div class=${classMap({ shell: true, dimmed: this.paletteOpen })} aria-hidden=${this.paletteOpen ? 'true' : nothing}>
        <header class="gh-topbar">${mast}</header>
        <main class="shell-body">${body}</main>
        ${this.renderGroundLine()}
      </div>
    `
  }

  // ——— Ⓐ the mast: a breadcrumb of at most two rungs; the ancestor rung is always clickable ———

  private renderBayMast(): TemplateResult {
    const graph = this.placeGraph()
    const residents = this.read()?.agents.length ?? 0
    return html`
      <span class="gh-mast">Greenhouse</span>
      ${this.renderAnnunciator()}
      <div class="gh-topmeta">
        ${graph ? html`<span>${graph}</span>` : nothing}
        ${residents ? html`<span>${residents} ${residents === 1 ? 'resident' : 'residents'}</span>` : nothing}
        <span class="gh-hook-hint"><kbd>⌘O</kbd> hook</span>
      </div>
    `
  }

  // ——— Ⓑ the annunciator: which stance the cockpit is in; now lit (a second stance
  // ships). A small mono chip in the accent for Room, its quiet violet for Constitution
  // — and itself the switch's click target.
  private renderAnnunciator(): TemplateResult {
    const label = this.stance === 'constitution' ? 'CONSTITUTION' : 'ROOM'
    const other = this.stance === 'constitution' ? 'room' : 'constitution'
    const otherKey = this.stance === 'constitution' ? '⌘1' : '⌘3'
    return html`
      <button
        class="gh-annunciator"
        type="button"
        data-stance=${this.stance}
        title=${`stance: ${label.toLowerCase()} — click or ${otherKey} for ${other}`}
        aria-label=${`stance ${label.toLowerCase()}; switch to ${other}`}
        @click=${() => this.cycleStance()}
      >
        ${label}
      </button>
    `
  }

  private renderRoomMast(): TemplateResult {
    return this.renderCrumbMast(this.enteredHandle(), this.enteredConversationLabel())
  }

  private renderLogMast(): TemplateResult {
    return this.renderCrumbMast(this.enteredHandle(), this.logLoad.title ?? this.logLoad.sessionId)
  }

  private renderCrumbMast(here: string, place: string | null): TemplateResult {
    const flipKey = this.stance === 'constitution' ? '⌘1' : '⌘3'
    const flipTo = this.stance === 'constitution' ? 'room' : 'constitution'
    return html`
      <span class="gh-mast">
        <button class="gh-crumb" type="button" @click=${() => this.climbToBay()}>Greenhouse</button>
        <span class="gh-crumb-sep" aria-hidden="true">›</span>
        <span class="gh-crumb-here">${here}</span>
      </span>
      ${this.renderAnnunciator()}
      <div class="gh-topmeta">
        ${place ? html`<span class="gh-place">${place}</span>` : nothing}
        <span class="gh-stancehint"><kbd>${flipKey}</kbd> ${flipTo}</span>
        <span><kbd>esc</kbd> bay</span>
      </div>
    `
  }

  // ——— Ⓔ the ground line: one connection pill, world freshness, nothing more ———

  private renderGroundLine(): TemplateResult {
    const status = this.liveState.status
    const pill: 'live' | 'reconnecting' | 'dark' = status === 'error' ? 'dark' : status === 'ready' ? 'live' : 'reconnecting'
    const capturedAt = this.liveState.capturedAt
    const graph = this.placeGraph()
    const word = pill === 'dark' ? 'stack dark — nothing is verified' : pill === 'reconnecting' ? 'reconnecting' : 'stack live'
    return html`
      <footer class="gh-groundline" data-state=${pill} aria-live="polite">
        <span class="gh-pill" data-state=${pill}>${word}</span>
        ${pill === 'dark'
          ? html`<code class="gh-ground-cmd">${STACK_COMMAND}</code>`
          : capturedAt !== null
            ? html`<span>world as of ${formatRelativeTime(capturedAt, Date.now())}</span>`
            : nothing}
        ${graph ? html`<span class="gh-ground-right">${graph} · gardend cell</span>` : nothing}
      </footer>
    `
  }

  // ——— Ⓓ the surface: the bay, the room, or the log ———

  private renderBayBody(): TemplateResult {
    if (this.stance === 'constitution') return this.renderConstitutionBayBody()
    const read = this.read()
    const agents = read?.agents ?? []
    const now = Date.now()
    return html`
      <div class="gh-bay" aria-label="the bay">
        ${agents.map((agent) => {
          const id = agentSelector(agent)
          const strip = this.buildStripFor(agent, now)
          const unfolded = this.unfoldedAgentId === id
          const chips = this.bayChipsFor(id)
          return renderBayStrip(strip, {
            now,
            unfolded,
            newSince: chips.newSince,
            anomaly: chips.anomaly,
            onHook: (agentId) => void this.hookStrip(agentId),
            conversations: unfolded ? this.renderConversations(id) : nothing,
          })
        })}
      </div>
    `
  }

  /**
   * The bay under CONSTITUTION weather (sheet 10): the same rack, re-sentenced toward
   * identity. Hooking here lands you on the agent's CARD — the stance colors the hook's
   * destination (the stance is app-global, so enterRoom under Constitution renders the
   * card, not the conversation). The card's constitution (binding, prompt, loadout) is
   * held only for the selected agent's live world today; other strips speak the honest
   * reduced sentence — a bay-wide constitution poll is the same later slice as the
   * count-chip poll (the bay holds one live world by design).
   */
  private renderConstitutionBayBody(): TemplateResult {
    const read = this.read()
    const agents = read?.agents ?? []
    const now = Date.now()
    const selectedCard = this.selectedAgentCard()
    return html`
      <div class="gh-bay" aria-label="the bay — constitutional weather">
        ${agents.map((agent) => {
          const id = agentSelector(agent)
          const card = read?.selectedAgentId === id ? selectedCard : null
          const strip = buildConstitutionStrip({
            id,
            identity: paletteAgentName(agent),
            card,
            lifecycle: agent.lifecycle,
            now,
          })
          return renderConstitutionStrip(strip, { onHook: (agentId) => void this.enterRoom(agentId) })
        })}
      </div>
    `
  }

  /** The one strip builder the bay and the palette share (sheet 05 — no divergence). */
  private buildStripFor(agent: GreenhouseAgentRecord, now: number): BayStrip {
    const id = agentSelector(agent)
    return buildBayStrip({
      id,
      name: paletteAgentName(agent),
      lifecycle: agent.lifecycle,
      model: modelFromRecord(asRecord(agent)) ?? agent.model ?? null,
      asOf: numberAt(agent, ['updatedAt']),
      sessionCount: agent.sessionCount ?? null,
      now,
    })
  }

  /**
   * The bay's count chips are earned, not fabricated: they render only for the agent
   * whose live world+events the bay holds (the selected agent), where a precise count
   * exists. Other strips show no chip rather than a made-up number (the ink clause).
   * A bay-wide multi-agent poll would extend the chips to every strip — a later slice.
   */
  private bayChipsFor(agentId: string): { readonly newSince: number | null; readonly anomaly: number | null } {
    const read = this.read()
    if (!read?.world || read.selectedAgentId !== agentId) return { newSince: null, anomaly: null }
    const mark = this.watermarkFor(agentId)
    const newSince = mark ? this.newTurnsSince(mark.cursor) : 0
    const anomaly = this.pendingApprovals()
    return { newSince: newSince > 0 ? newSince : null, anomaly: anomaly > 0 ? anomaly : null }
  }

  private renderConversations(agentId: string): TemplateResult {
    const load = this.sessionsByAgent.get(agentId)
    if (!load || load.status === 'loading') {
      return html`<div class="gh-convs"><p class="gh-convs-note">reading the logbook…</p></div>`
    }
    if (load.status === 'error') {
      return html`<div class="gh-convs"><p class="gh-convs-note">the logbook did not answer.</p></div>`
    }
    if (!load.sessions.length) {
      return html`<div class="gh-convs"><p class="gh-convs-note">No conversations recorded for this agent yet.</p></div>`
    }
    const now = Date.now()
    const activeSessionId = this.activeSessionIdFor(agentId)
    return html`
      <div class="gh-convs">
        ${load.sessions.map((session) =>
          renderConversationRow(
            buildConversationRow({
              sessionId: session.sessionId,
              objective: session.objective,
              messageCount: session.messageCount,
              lastMessageAt: session.lastMessageAt,
              activeSessionId,
            }),
            { now, onEnter: (conversation) => void this.enterConversation(agentId, conversation) },
          ),
        )}
      </div>
    `
  }

  private renderRoomBody(): TemplateResult {
    // CONSTITUTION re-weights zone D from the conversation to the card. The conversation
    // is one keystroke away, exactly where it was left (its state is untouched @state).
    if (this.stance === 'constitution') return this.renderRoomCardBody()
    const presence = this.presence()
    if (!presence) return this.renderLoadingBody()
    const floor = this.floor()
    return html`
      <div class="room" aria-label="the room — one agent, present">
        ${renderPresenceStrip(presence, {
          floor,
          modelGroups: agentModelGroups(presence.model.value),
          activeProvider: this.agentModelProvider,
          pickerOpen: this.agentModelPickerOpen,
          changingModel: this.changingModel,
          recency: recencyFromStoreState(this.liveState),
          floorActivity: this.floorActivity,
          steeringOpen: this.steeringOpen,
          steeringText: this.steeringText,
          brief: this.turnoverBrief(),
          // The rule proves the instrument marked your place — on a first visit no
          // prior mark exists, so no rule renders; the mark is placed silently now.
          leftAt: this.roomWatermark?.readAt ?? null,
          onReadReply: (messageId) => this.readReply(messageId),
          speech: this.speech(),
          composer: {
            agentHandle: this.agentHandle(),
            value: this.composerText,
            sending: this.sendingMessage,
            disabledReason: this.composerDisabledReason(),
            sendError: this.sendError,
            onInput: (text) => {
              this.composerText = text
              this.sendError = ''
            },
            onSubmit: () => void this.submitMessage(),
          },
          onToggleModelPicker: () => this.toggleAgentModelPicker(),
          onChooseProvider: (provider) => (this.agentModelProvider = provider),
          onChangeModel: (modelId) => void this.changeAgentModel(modelId),
          onFloorAffordance: (affordance) => this.handleFloorAffordance(affordance),
          onSteeringText: (text) => (this.steeringText = text),
          onSubmitSteering: () => void this.submitSteering(),
          onCancelSteering: () => this.closeSteering(),
          openConductIds: this.openConductMessageIds,
          onToggleConduct: (messageId) => this.toggleConduct(messageId),
        })}
      </div>
    `
  }

  /**
   * The CONSTITUTION room's matter — the recognition card (folio 02). One card, two
   * responsive postures: the wide desk composition (#desk-card) at desktop widths, the
   * compact reading card (sheet 09·B) below the breakpoint. Same model feeds both — a
   * posture, not a different card.
   */
  private renderRoomCardBody(): TemplateResult {
    const card = this.selectedAgentCard()
    if (!card) return this.renderLoadingBody()
    const now = Date.now()
    return html`<div class="room room-card" aria-label="the card — what this agent is">
      ${this.deskWide ? renderAgentCardDesk(card, { now }) : renderAgentCard(card, { now })}
    </div>`
  }

  /** Build the recognition card for the selected agent from its live world doc. */
  private selectedAgentCard(): AgentCardViewModel | null {
    const agent = this.selectedAgent()
    if (!agent) return null
    // The Constitution matter (incidents K3, binding chain K2) is fetched on stance
    // entry and cached; until it lands, `constitutionFor` is null and the card carries
    // the ° chips — a served datum renders real, an unserved one chips (never a dash).
    const constitution = this.store.constitutionFor(agentSelector(agent))
    return buildAgentCard({
      agentId: agentSelector(agent),
      handle: firstNonBlankString(agent.handle, stringAt(agent, ['label']), agent.agentId) ?? agent.agentId,
      agentType: agent.agentType ?? null,
      graphId: agent.graphId ?? null,
      kindLine: agent.kindLine ?? null,
      lifecycle: agent.lifecycle,
      sessionCount: agent.sessionCount ?? null,
      careerTurns: agent.careerTurns ?? null,
      careerTokens: agent.careerTokens ?? null,
      careerMemories: agent.careerMemories ?? null,
      firstSessionAt: numberAt(agent, ['firstSessionAt']),
      incidents: constitution?.incidents ?? null,
      bindings: constitution?.bindings ?? null,
      worldDoc: this.read()?.world?.worldDoc,
    })
  }

  /**
   * Fetch (once per agent) the Constitution matter — incidents + the binding chain —
   * when a stance comes to hold that agent's card. It never rides the poll; the trigger
   * is stance entry. Failures degrade to the ° chips (the card is null-safe), so the
   * fetch is fire-and-forget with its rejection swallowed.
   */
  private ensureConstitution(agentId: string | null | undefined): void {
    if (!agentId) return
    void this.store.loadAgentConstitution(agentId).catch(() => {})
  }

  /**
   * The log of a closed conversation. The orchestrator's ruling, recorded here: you
   * cannot speak into a closed conversation, so the log renders the transcript alone —
   * no composer and no floor line. The way out is the bay (esc / the ancestor rung).
   */
  private renderLogBody(): TemplateResult {
    const load = this.logLoad
    return html`
      <div class="gh-log" aria-label="the log — a closed conversation">
        <div class="gh-log-head">
          ${load.title
            ? html`<span class="mn-kind gh-log-title" data-kind="reference"><span class="mn-kind-link">${load.title}</span></span>`
            : load.sessionId
              ? html`<span class="gh-conv-untitled">${load.sessionId}</span>`
              : nothing}
          <span class="mn-kind gh-log-closed" data-kind="state">a closed conversation — you are reading the log</span>
        </div>
        ${load.status === 'loading' ? html`<p class="gh-convs-note">reading the log…</p>` : nothing}
        ${load.status === 'error' ? html`<p class="gh-convs-note">the log did not answer.</p>` : nothing}
        ${load.status === 'ready' && !load.messages.length
          ? html`<p class="gh-convs-note">This conversation left no messages.</p>`
          : nothing}
        ${load.messages.length
          ? renderTranscript(load.messages, {
              openConductIds: this.openConductMessageIds,
              onToggleConduct: (messageId) => this.toggleConduct(messageId),
            })
          : nothing}
      </div>
    `
  }

  private renderLoadingBody(): TemplateResult {
    return html`
      <div class="gh-statebody" aria-label="finding the live world">
        <p class="gh-statehead">Finding the live world.</p>
        <p class="gh-statecopy">Reading the roster from the stack.</p>
      </div>
    `
  }

  private renderDarkBody(): TemplateResult {
    return html`
      <div class="gh-statebody dark-state" aria-label="stack dark">
        <p class="gh-statehead">Stack dark — nothing is verified.</p>
        <p class="gh-statecopy">
          No answer from ${this.baseHost()}. Every strip you saw before this moment is history, not presence.
        </p>
        <code class="gh-cmd">${STACK_COMMAND}</code>
        <p class="gh-state-actions">
          <button class="text-affordance" type="button" @click=${() => void this.store.refresh()}>try again</button>
        </p>
      </div>
    `
  }

  private renderEmptyBody(): TemplateResult {
    const answeredAt = this.liveState.capturedAt
    const graph = this.placeGraph()
    return html`
      <div class="gh-statebody" aria-label="no residents">
        <p class="gh-statehead">No residents${graph ? html` in ${graph}` : nothing}.</p>
        <p class="mn-kind gh-statecopy" data-kind="state">
          The stack is live${answeredAt !== null ? html` and answered ${formatRelativeTime(answeredAt, Date.now())}` : nothing}.
          Agents registered on this graph will take their strips here.
        </p>
      </div>
    `
  }

  // ——— navigation: hooking, entering, climbing ———

  private climbToBay(): void {
    if (this.view === 'room') this.leaveRoom()
    this.view = 'bay'
    this.logLoad = IDLE_LOG
    void this.store.refreshRoster()
  }

  private async hookStrip(agentId: string): Promise<void> {
    if (this.unfoldedAgentId === agentId) {
      this.unfoldedAgentId = null
      return
    }
    this.unfoldedAgentId = agentId
    await this.ensureSessions(agentId)
  }

  /**
   * Read one agent's conversation list through the store the bay reads, into the cache
   * the bay and the palette share. In-flight and already-ready loads are left alone; a
   * prior error is retried. The palette warms this on open so conversations can surface.
   */
  private async ensureSessions(agentId: string): Promise<void> {
    if (!agentId) return
    const existing = this.sessionsByAgent.get(agentId)
    if (existing && existing.status !== 'error') return
    this.setSessionLoad(agentId, { status: 'loading' })
    try {
      const sessions = await this.store.loadAgentSessions(agentId)
      this.setSessionLoad(agentId, { status: 'ready', sessions })
    } catch {
      this.setSessionLoad(agentId, { status: 'error' })
    }
  }

  private setSessionLoad(agentId: string, load: SessionLoad): void {
    const next = new Map(this.sessionsByAgent)
    next.set(agentId, load)
    this.sessionsByAgent = next
  }

  private async enterConversation(agentId: string, conversation: ConversationRow): Promise<void> {
    if (conversation.isActive) {
      await this.enterRoom(agentId)
    } else {
      await this.enterLog(agentId, conversation)
    }
  }

  private async enterRoom(agentId: string): Promise<void> {
    // Leaving a room already open for a different agent advances that mark first.
    if (this.view === 'room' && this.enteredAgentId && this.enteredAgentId !== agentId) this.leaveRoom()
    this.enteredAgentId = agentId
    if (this.read()?.selectedAgentId !== agentId) {
      await this.store.openAgent(agentId)
    }
    // Capture the mark as it was when you arrived; the brief reads against it and
    // holds fixed for the visit. The persisted mark advances when you leave.
    this.roomWatermark = this.watermarkFor(agentId)
    this.roomEnteredAt = Date.now()
    this.view = 'room'
    // Under Constitution, the room lands on the card — warm its off-world matter.
    if (this.stance === 'constitution') this.ensureConstitution(agentId)
  }

  private async enterLog(agentId: string, conversation: ConversationRow): Promise<void> {
    this.enteredAgentId = agentId
    this.view = 'log'
    this.logLoad = { status: 'loading', sessionId: conversation.sessionId, title: conversation.title, messages: [] }
    try {
      const raw = await this.store.loadSessionMessages(conversation.sessionId)
      const speech = buildRoomSpeech({ messages: raw, selfAuthorId: this.config.authorId })
      this.logLoad = { status: 'ready', sessionId: conversation.sessionId, title: conversation.title, messages: speech.messages }
    } catch {
      this.logLoad = { status: 'error', sessionId: conversation.sessionId, title: conversation.title, messages: [] }
    }
  }

  private enteredHandle(): string {
    const id = this.enteredAgentId
    const record = id ? this.read()?.agents.find((agent) => agentSelector(agent) === id) : null
    return (
      firstNonBlankString(record?.handle, stringAt(record, ['label']), record?.agentId, this.agentHandle(), id) ?? 'agent'
    )
  }

  private enteredConversationLabel(): string | null {
    const world = this.read()?.world
    return firstNonBlankString(
      stringAt(world?.session, ['objective']),
      stringAt(world?.worldDoc.status, ['objective']),
      stringAt(world?.session, ['label']),
      this.activeSessionId(),
    )
  }

  private activeSessionIdFor(agentId: string): string | null {
    const read = this.read()
    const record = read?.agents.find((agent) => agentSelector(agent) === agentId)
    const fromRoster = firstNonBlankString(record?.activeSessionId)
    if (fromRoster) return fromRoster
    if (read?.selectedAgentId === agentId) return this.activeSessionId()
    return null
  }

  private placeGraph(): string {
    const fromWorld = this.graphId()
    if (fromWorld) return fromWorld
    const roster = this.read()?.agents ?? []
    return firstNonBlankString(...roster.map((agent) => agent.graphId)) ?? ''
  }

  private baseHost(): string {
    try {
      return new URL(this.config.baseUrl).host || this.config.baseUrl
    } catch {
      return this.config.baseUrl
    }
  }

  private start(): void {
    if (this.booted) return
    this.booted = true
    void this.store.refresh()
    this.stopPolling = this.store.startPoll(normalizeGreenhousePollMs(this.config))
  }

  private read(): GreenhouseLiveRead | null {
    return this.liveState.read
  }

  private screen(): GreenhouseScreenState {
    if (this.liveState.status === 'idle' || (this.liveState.status === 'loading' && !this.liveState.read)) return 'loading'
    if (this.liveState.status === 'error' && !this.liveState.read) return 'dark'
    return this.liveState.read?.screen ?? 'loading'
  }

  private selectedAgent(): GreenhouseAgentRecord | null {
    const read = this.read()
    return read?.agents.find((agent) => agentSelector(agent) === read.selectedAgentId) ?? null
  }

  private agentHandle(): string {
    const agent = this.selectedAgent()
    const world = this.read()?.world
    return (
      firstNonBlankString(
        stringAt(world?.worldDoc.agent, ['handle']),
        stringAt(world?.agent, ['handle']),
        agent?.handle,
        stringAt(agent, ['label']),
        agent?.agentId,
      ) ?? 'agent'
    )
  }

  private currentModel(): string {
    const agent = this.selectedAgent()
    const world = this.read()?.world
    return (
      firstNonBlankString(
        agent ? modelFromRecord(asRecord(agent)) : null,
        modelFromRecord(asRecord(world?.agent)),
        modelFromRecord(world?.worldDoc.status),
        modelFromRecord(world?.worldDoc.agent),
        modelFromRecord(asRecord(valueAt(world?.worldDoc.prompts, ['system', 'binding']))),
        modelFromRecord(asRecord(world?.session ?? {})),
      ) ?? ''
    )
  }

  private graphId(): string {
    const agent = this.selectedAgent()
    const world = this.read()?.world
    return (
      firstNonBlankString(
        stringAt(world?.worldDoc.status, ['graphId']),
        stringAt(world?.worldDoc.agent, ['graphId']),
        world?.session?.graphId,
        world?.run?.graphId,
        agent?.graphId,
      ) ?? ''
    )
  }

  private activeSessionId(): string | null {
    const agent = this.selectedAgent()
    const world = this.read()?.world
    return firstNonBlankString(
      world?.session?.sessionId,
      stringAt(world?.worldDoc.world, ['session', 'sessionId']),
      stringAt(world?.worldDoc.status, ['activeSessionId']),
      agent?.activeSessionId,
    )
  }

  private presence(): AgentPresenceViewModel | null {
    const read = this.read()
    if (!read?.world) return null
    const agent = this.selectedAgent()
    const model = this.currentModel()
    const status = read.world.worldDoc.status
    const modelAttribution = asRecord(valueAt(status, ['attribution', 'model']))
    // Phosphor honesty: worldDoc.prompts.system.document.compatibilitySeeded — served
    // by choreograph when this agent's model/charter fell back to hardcoded in-code
    // constants because the graph read failed. Mirrors card.ts's charter.seeded read.
    const promptDoc = asRecord(valueAt(asRecord(valueAt(read.world.worldDoc.prompts, ['system'])), ['document']))
    const seeded = valueAt(promptDoc, ['compatibilitySeeded']) === true
    return buildAgentPresence({
      name: this.agentHandle(),
      kindLine: firstNonBlankString(stringAt(read.world.worldDoc.agent, ['kindLine']), agent?.kindLine),
      lifecycle: firstNonBlankString(stringAt(status, ['lifecycle']), agent?.lifecycle) ?? '-',
      model,
      attribution: {
        value: stringAt(modelAttribution, ['value']) ?? undefined,
        actorId: stringAt(modelAttribution, ['actorId']) ?? undefined,
        at: numberAt(modelAttribution, ['at']) ?? undefined,
      },
      graph: this.graphId(),
      runId: read.world.run?.runId ?? stringAt(read.world.worldDoc.status, ['activeRunId']) ?? agent?.activeRunId ?? '',
      sessionId: this.activeSessionId() ?? '',
      updatedAt: presenceUpdatedLabel(agent?.updatedAt),
      seeded,
    })
  }

  private floor(): AgentFloorViewModel | null {
    const read = this.read()
    if (!read?.world) return null
    return buildAgentFloor({
      world: read.world,
      clientId: this.config.clientId,
      events: read.events,
    })
  }

  private syncFloorStateAttribute(): void {
    if (this.screen() !== 'ready' || this.view !== 'room') {
      this.removeAttribute('data-floor-state')
      return
    }
    const state = this.floor()?.floor.state
    if (state) this.setAttribute('data-floor-state', state)
    else this.removeAttribute('data-floor-state')
  }

  private speech(): RoomSpeechViewModel {
    const read = this.read()
    return buildRoomSpeech({
      world: read?.world,
      messages: read?.attestedMessages,
      events: read?.events,
      selfAuthorId: this.config.authorId,
    })
  }

  private composerDisabledReason(): string | null {
    if (!this.read()?.selectedAgentId) return 'no agent is selected'
    if (!this.activeSessionId()) return 'no active session is open'
    return null
  }

  // ——— the watermark: the client-side memory of where you left each conversation ———

  private watermarkUserId(): string {
    return firstNonBlankString(this.config.auth.userId, this.config.authorId) ?? 'anon'
  }

  private watermarkFor(agentId: string): AgentWatermark | null {
    const key = watermarkStorageKey(this.watermarkUserId(), agentId)
    if (this.watermarkCache.has(key)) return this.watermarkCache.get(key) ?? null
    let value: AgentWatermark | null = null
    try {
      const raw = globalThis.localStorage?.getItem(key)
      value = raw ? (JSON.parse(raw) as AgentWatermark) : null
    } catch {
      value = null
    }
    this.watermarkCache.set(key, value)
    return value
  }

  private persistWatermark(agentId: string, mark: AgentWatermark): void {
    const key = watermarkStorageKey(this.watermarkUserId(), agentId)
    this.watermarkCache.set(key, mark)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(mark))
    } catch {
      // The browser store is unavailable (private mode) — the mark lives only for the session.
    }
  }

  private memoryRemembered(): readonly TurnoverMemoryEntry[] {
    const memory = this.read()?.world?.worldDoc.memory
    return arrayAt<unknown>(memory, ['rememberedThisSession'])
      .map((entry) => ({ number: numberAt(entry, ['number']) ?? Number.NaN, content: stringAt(entry, ['content']) ?? '' }))
      .filter((entry) => Number.isFinite(entry.number))
  }

  private memoryHigh(): number | null {
    const numbers = this.memoryRemembered().map((entry) => entry.number)
    return numbers.length ? Math.max(...numbers) : null
  }

  private pendingApprovals(): number {
    const control = this.read()?.world?.worldDoc.control
    return (
      arrayAt<unknown>(control, ['approvals']).length +
      arrayAt<unknown>(control, ['pauseRequests']).length +
      this.pendingApprovalDetails().length
    )
  }

  /** Outcome-less entries of `control.permissionRequests` — W1's testimony, named. */
  private pendingApprovalDetails(): readonly { callId: string; tool?: string | null; sinceTs?: number | null }[] {
    const control = this.read()?.world?.worldDoc.control
    const requests = asRecord(valueAt(control, ['permissionRequests']))
    return Object.entries(requests)
      .map(([callId, value]) => ({ callId, entry: asRecord(value) }))
      .filter(({ callId, entry }) => !!callId && !stringAt(entry, ['outcome']))
      .map(({ callId, entry }) => ({
        callId,
        tool: stringAt(entry, ['tool']) ?? stringAt(entry, ['toolName']),
        sinceTs: numberAt(entry, ['ts']) ?? numberAt(entry, ['requestedAt']) ?? numberAt(entry, ['at']),
      }))
  }

  private currentCursor(): number {
    return this.read()?.cursor ?? -1
  }

  /**
   * The turnover brief for the current room visit, built from the events since the
   * captured watermark cursor plus the world's memory diff against its baseline.
   * On a first visit (no prior mark) the cursor sits at the current frontier, so the
   * brief is empty — assert absence, not emptiness.
   */
  private turnoverBrief(): TurnoverBrief | null {
    const read = this.read()
    if (!read?.world || this.view !== 'room') return null
    const mark = this.roomWatermark
    const cursor = mark ? mark.cursor : this.currentCursor()
    const baselineHigh = mark ? mark.memoryHigh : this.memoryHigh()
    const events = read.events
      .filter((event) => event.seq > cursor)
      .map((event) => ({ seq: event.seq, ts: event.ts, type: event.type, payload: event.payload }))
    return buildTurnoverBrief({
      events,
      selfClientId: this.config.clientId,
      leftAt: mark?.readAt ?? this.roomEnteredAt,
      now: Date.now(),
      memory: { remembered: this.memoryRemembered(), baselineHigh },
      previousWatchTokens: mark?.tokens ?? null,
      watermarkSessionId: mark?.sessionId ?? null,
      activeSessionId: this.activeSessionId(),
      modelBaseline: mark?.model ?? this.currentModel(),
      pendingApprovals: this.pendingApprovals(),
      pendingApprovalDetails: this.pendingApprovalDetails(),
    })
  }

  /** The count of new turns since a watermark cursor — the bay's quiet chip. */
  private newTurnsSince(cursor: number): number {
    return (this.read()?.events ?? []).filter(
      (event) => event.seq > cursor && event.type === 'conversation.turn.completed',
    ).length
  }

  /** Advance and persist the mark on leaving — "you left here" is set as you go. */
  private leaveRoom(): void {
    const read = this.read()
    const agentId = this.enteredAgentId
    if (!agentId || !read?.world) return
    const brief = this.turnoverBrief()
    const tokensLine = brief?.lines.find((line) => line.variant === 'tokens')
    const tokens = tokensLine && tokensLine.variant === 'tokens' ? tokensLine.tokens : undefined
    const mark = advanceWatermark(this.watermarkFor(agentId), {
      cursor: this.currentCursor(),
      readAt: Date.now(),
      sessionId: this.activeSessionId(),
      memoryHigh: this.memoryHigh(),
      tokens,
      model: this.currentModel(),
    })
    this.persistWatermark(agentId, mark)
    this.roomWatermark = null
  }

  private readReply(messageId: string): void {
    if (!messageId) return
    this.renderRoot.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  private toggleAgentModelPicker(): void {
    const currentModel = this.currentModel()
    const groups = agentModelGroups(currentModel)
    this.agentModelProvider = activeAgentModelProvider(currentModel, groups, this.agentModelProvider)
    this.agentModelPickerOpen = !this.agentModelPickerOpen
  }

  private toggleConduct(messageId: string): void {
    const next = new Set(this.openConductMessageIds)
    if (next.has(messageId)) next.delete(messageId)
    else next.add(messageId)
    this.openConductMessageIds = next
  }

  private async changeAgentModel(modelId: string): Promise<void> {
    if (!this.read()?.selectedAgentId || !modelId || modelId === this.currentModel()) {
      this.agentModelPickerOpen = false
      return
    }
    this.changingModel = true
    try {
      await this.store.setAgentModel(modelId, modelProvider(modelId).toLowerCase())
      this.agentModelPickerOpen = false
    } catch {
      // Store action preserves the existing dark fallback on model-change failure.
    } finally {
      this.changingModel = false
    }
  }

  private handleFloorAffordance(affordance: AgentAffordance): void {
    if (affordance.intent === 'claim') {
      void this.claimFloor()
      return
    }
    if (affordance.intent === 'release') {
      void this.releaseFloor()
      return
    }
    this.steeringOpen = true
  }

  private async claimFloor(): Promise<void> {
    if (!this.read()?.selectedAgentId || this.floorActivity !== 'idle') return
    this.floorActivity = 'claiming'
    this.steeringOpen = false
    try {
      await this.store.claimFloor()
    } catch {
      await this.store.pollWorld()
    } finally {
      this.floorActivity = 'idle'
    }
  }

  private async releaseFloor(): Promise<void> {
    if (!this.read()?.selectedAgentId || this.floorActivity !== 'idle') return
    this.floorActivity = 'releasing'
    this.steeringOpen = false
    try {
      await this.store.releaseFloor()
    } catch {
      await this.store.pollWorld()
    } finally {
      this.floorActivity = 'idle'
    }
  }

  private async submitSteering(): Promise<void> {
    const text = this.steeringText.trim()
    if (!this.read()?.selectedAgentId || !text || this.floorActivity !== 'idle') return
    this.floorActivity = 'steering'
    try {
      await this.store.steerFloor(text)
      this.closeSteering()
    } catch {
      await this.store.pollWorld()
    } finally {
      this.floorActivity = 'idle'
    }
  }

  private async submitMessage(): Promise<void> {
    const text = this.composerText.trim()
    if (!this.read()?.selectedAgentId || !text || this.sendingMessage || this.composerDisabledReason()) return

    this.sendingMessage = true
    this.sendError = ''
    try {
      await this.store.sendMessage({
        authorId: this.config.authorId,
        role: this.config.role,
        visibility: 'agent-visible',
        text,
        autoTurn: true,
      })
      this.composerText = ''
    } catch {
      this.sendError = 'message was not accepted'
      await this.store.pollWorld()
    } finally {
      this.sendingMessage = false
    }
  }

  private closeSteering(): void {
    this.steeringOpen = false
    this.steeringText = ''
  }

  // ——— the master switch: set / cycle the stance ———

  /**
   * Flip the cockpit posture. Idempotent: setting the stance you are already in is a
   * no-op (nothing to re-weight, no state to lose). The room's conversation state —
   * scroll, draft, watermark, brief — lives in @state / instance fields untouched by
   * the flip, so ⌘1 returns to the conversation EXACTLY as it was left (the bind of
   * sheet 09: a flip that costs state is a navigation in disguise, and forbidden).
   */
  private setStance(stance: 'room' | 'constitution'): void {
    if (this.stance === stance) return
    this.stance = stance
    this.setAttribute('data-stance', stance)
    // Entering Constitution brings a card into view — warm its off-world matter now.
    if (stance === 'constitution') this.ensureConstitution(this.read()?.selectedAgentId)
  }

  /** The annunciator is itself the switch's click target — it cycles the two stances. */
  private cycleStance(): void {
    this.setStance(this.stance === 'room' ? 'constitution' : 'room')
  }

  // ——— the palette (⌘O): reflex navigation over a dimmed surface ———

  private togglePalette(): void {
    if (this.paletteOpen) this.closePalette()
    else this.openPalette()
  }

  private openPalette(): void {
    this.paletteOpen = true
    this.paletteQuery = ''
    this.paletteSelectedIndex = 0
    // Warm the same session cache the bay reads so matching conversations can surface;
    // the palette owns no state but its query — this reads through the store, not into it.
    for (const agent of this.read()?.agents ?? []) void this.ensureSessions(agentSelector(agent))
  }

  private closePalette(): void {
    this.paletteOpen = false
    this.paletteQuery = ''
  }

  private onPaletteQuery(text: string): void {
    this.paletteQuery = text
    this.paletteSelectedIndex = 0
  }

  /** The flat, arrow-walkable list — agents from the roster, conversations from the shared cache. */
  private paletteRows(): readonly PaletteRow[] {
    const sessionsByAgent = new Map<string, readonly GreenhouseAgentSessionRecord[]>()
    for (const [agentId, load] of this.sessionsByAgent) {
      if (load.status === 'ready') sessionsByAgent.set(agentId, load.sessions)
    }
    return buildPaletteRows({ agents: this.read()?.agents ?? [], sessionsByAgent, query: this.paletteQuery })
  }

  private movePaletteSelection(delta: number): void {
    const count = this.paletteRows().length
    if (count === 0) {
      this.paletteSelectedIndex = 0
      return
    }
    this.paletteSelectedIndex = (this.paletteSelectedIndex + delta + count) % count
  }

  private activateSelectedPaletteRow(): void {
    const rows = this.paletteRows()
    const row = rows[this.paletteSelectedIndex]
    if (row) this.activatePaletteRow(row)
  }

  /**
   * ↵ hooks. An agent row goes straight to its room — the returning-watch fast path,
   * for when you already know which room you want (sheet 05 intent; walk α equates
   * ⌘O·type·↵ with hooking the strip). A conversation goes to its room when it is the
   * active one, or to its log when it is closed — exactly the bay's own enterConversation.
   */
  private activatePaletteRow(row: PaletteRow): void {
    this.closePalette()
    if (row.kind === 'agent') {
      void this.enterRoom(row.agentId)
      return
    }
    const conversation = buildConversationRow({
      sessionId: row.session.sessionId,
      objective: row.session.objective,
      messageCount: row.session.messageCount,
      lastMessageAt: row.session.lastMessageAt,
      activeSessionId: this.activeSessionIdFor(row.agentId),
    })
    void this.enterConversation(row.agentId, conversation)
  }

  private onPaletteKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.movePaletteSelection(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.movePaletteSelection(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.activateSelectedPaletteRow()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closePalette()
    }
  }

  private renderPalette(): TemplateResult {
    const rows = this.paletteRows()
    const now = Date.now()
    const selectedIndex = rows.length ? Math.min(this.paletteSelectedIndex, rows.length - 1) : -1
    return html`
      <div
        class="gh-palette-overlay"
        @pointerdown=${(event: PointerEvent) => {
          if (event.target === event.currentTarget) this.closePalette()
        }}
      >
        <div class="gh-palette" role="dialog" aria-label="jump to a room or a conversation">
          <div class="gh-palette-input">
            <span class="gh-caret" aria-hidden="true">›</span>
            <input
              class="gh-query-input"
              aria-label="filter residents and conversations"
              placeholder="jump to a room…"
              autocomplete="off"
              spellcheck="false"
              .value=${this.paletteQuery}
              @input=${(event: InputEvent) => this.onPaletteQuery((event.target as HTMLInputElement).value)}
              @keydown=${(event: KeyboardEvent) => this.onPaletteKeydown(event)}
            />
          </div>
          <div class="gh-palette-rows" role="listbox" aria-label="residents and conversations">
            ${rows.length
              ? rows.map((row, index) => this.renderPaletteRow(row, index, index === selectedIndex, now))
              : html`<p class="gh-palette-empty mn-kind" data-kind="state">no residents or conversations match.</p>`}
          </div>
          <div class="gh-hintbar">
            <span>↑↓ move</span><span>↵ hook</span><span>esc close</span>
          </div>
        </div>
      </div>
    `
  }

  private renderPaletteRow(row: PaletteRow, index: number, selected: boolean, now: number): TemplateResult {
    const onEnter = (): void => this.activatePaletteRow(row)
    if (row.kind === 'agent') {
      const strip = this.buildStripFor(row.agent, now)
      const chips = this.bayChipsFor(row.agentId)
      return html`
        <div
          class="gh-palette-row"
          role="option"
          aria-selected=${selected ? 'true' : 'false'}
          data-palette-index=${index}
          @mouseenter=${() => (this.paletteSelectedIndex = index)}
        >
          ${renderBayStrip(strip, { now, selected, newSince: chips.newSince, anomaly: chips.anomaly, onHook: onEnter })}
        </div>
      `
    }
    const conversation = buildConversationRow({
      sessionId: row.session.sessionId,
      objective: row.session.objective,
      messageCount: row.session.messageCount,
      lastMessageAt: row.session.lastMessageAt,
      activeSessionId: this.activeSessionIdFor(row.agentId),
    })
    return html`
      <div
        class="gh-palette-row gh-palette-row-conv"
        role="option"
        aria-selected=${selected ? 'true' : 'false'}
        data-palette-index=${index}
        @mouseenter=${() => (this.paletteSelectedIndex = index)}
      >
        ${renderConversationRow(conversation, { now, selected, onEnter: () => onEnter() })}
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--mn-color-surface-base, #f6f4ef) 88%, white) 0%, transparent 38%),
        var(--mn-color-surface-base, #f6f4ef);
      color: var(--mn-color-text-primary, #18231e);
      font-family: var(--mn-font-chrome, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
    }

    /* The render root is transparent to layout: the shell stays a direct grid child of :host. */
    .gh-root {
      display: contents;
    }

    /* ——— the shell: five zones, nothing else ——— */
    .shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100vh;
      min-height: 100dvh;
    }

    .shell-body {
      box-sizing: border-box;
      min-height: 0;
      overflow-y: auto;
      padding: clamp(16px, 3.5vw, 40px) clamp(16px, 4vw, 48px) clamp(24px, 4vw, 56px);
    }

    /* Ⓐ the mast */
    .gh-topbar {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 10px clamp(14px, 3vw, 22px);
      background: var(--mn-top-bar-bg, #e9f1ec);
      border-bottom: 1px solid var(--mn-top-bar-border, #cfe0d6);
      color: var(--mn-top-bar-text, #213f33);
    }

    .gh-mast {
      display: inline-flex;
      align-items: baseline;
      gap: 2px;
      font-size: var(--mn-text-md, 16px);
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    .gh-crumb {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-top-bar-text-muted, #60746a);
      cursor: pointer;
      font: inherit;
      font-weight: 500;
    }

    .gh-crumb:hover {
      color: var(--mn-color-accent, #2f7d5f);
      text-decoration: underline;
      text-underline-offset: 0.16em;
    }

    .gh-crumb:focus-visible {
      border-radius: 3px;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .gh-crumb-sep {
      padding: 0 6px;
      color: var(--mn-color-text-muted, #94a09a);
      font-weight: 400;
    }

    .gh-crumb-here {
      font-weight: 650;
    }

    /* Ⓑ the annunciator — the master switch's lit chip; the stance's hue lives in
       tokens (skin-greenhouse.css → --mn-stance-annunciator-*), lit now a second
       stance ships. Itself the switch's click target. */
    .gh-annunciator {
      align-self: center;
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      font-weight: 700;
      color: var(--mn-stance-annunciator-ink, var(--mn-color-accent, #2f7d5f));
      border: 1px solid var(--mn-stance-annunciator-edge, var(--mn-color-border-accent, #b9d8c8));
      background: var(--mn-stance-annunciator-wash, var(--mn-color-surface-accent, #e8f4ee));
      border-radius: 3px;
      padding: 2px 8px;
      cursor: pointer;
      transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
    }
    .gh-annunciator:hover {
      filter: brightness(0.98) saturate(1.06);
    }
    .gh-annunciator:focus-visible {
      outline: 2px solid var(--mn-stance-annunciator-ink, var(--mn-color-accent, #2f7d5f));
      outline-offset: 2px;
    }

    .gh-stancehint {
      color: var(--mn-color-text-muted, #94a09a);
    }

    .gh-topmeta {
      display: flex;
      align-items: baseline;
      gap: 14px;
      margin-left: auto;
      color: var(--mn-top-bar-text-muted, #60746a);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
    }

    .gh-topmeta .gh-place {
      max-width: 40ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .gh-topbar kbd {
      padding: 1px 5px;
      border: 1px solid var(--mn-color-border-default, #cfdad2);
      border-radius: 4px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-tertiary, #737f78);
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    /* Ⓓ the bay — a rack of strips */
    .gh-bay {
      width: min(100%, 1180px);
    }

    .gh-strip {
      border-bottom: 1px solid var(--mn-color-border-subtle, #dfe7e1);
    }

    .gh-strip:last-child {
      border-bottom: 0;
    }

    .gh-strip.hooked {
      border-radius: var(--mn-radius-md, 6px);
      background: var(--mn-color-surface-hover, rgba(47, 125, 95, 0.07));
    }

    .gh-strip-hook {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 12px;
      width: 100%;
      padding: 12px 8px 11px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .gh-strip-hook:hover {
      background: var(--mn-color-surface-hover, rgba(47, 125, 95, 0.07));
      border-radius: var(--mn-radius-md, 6px);
    }

    .gh-strip-hook:focus-visible {
      border-radius: var(--mn-radius-md, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .gh-dot {
      box-sizing: border-box;
      grid-column: 1;
      align-self: center;
      justify-self: center;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .gh-dot-live {
      background: var(--mn-color-accent, #2f7d5f);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 15%, transparent);
    }

    .gh-dot-held {
      background: var(--mn-color-warning, #b98a2e);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-warning, #b98a2e) 15%, transparent);
    }

    .gh-dot-dormant {
      background: transparent;
      border: 1.5px solid var(--mn-color-text-muted, #94a09a);
    }

    .gh-dot-unknown {
      background: transparent;
      border: 1.5px dashed var(--mn-color-text-muted, #94a09a);
    }

    @media (prefers-reduced-motion: no-preference) {
      .gh-dot-pulse {
        animation: gh-dot-pulse 2.4s ease-in-out infinite;
      }
    }

    @keyframes gh-dot-pulse {
      0%,
      100% {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-warning, #b98a2e) 10%, transparent);
      }
      50% {
        box-shadow: 0 0 0 5px color-mix(in srgb, var(--mn-color-warning, #b98a2e) 28%, transparent);
      }
    }

    .gh-strip-lines {
      display: grid;
      grid-column: 2;
      min-width: 0;
      gap: 2px;
    }

    .gh-strip-line1 {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 10px;
      min-width: 0;
    }

    .gh-name {
      font-size: var(--mn-text-base, 15px);
      font-weight: 650;
    }

    .gh-statewords {
      color: var(--mn-color-text-secondary, #526059);
      font-size: var(--mn-text-sm, 13px);
    }

    .gh-strip-line2 {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 10px;
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
    }

    .gh-model {
      font-style: italic;
    }

    .gh-strip-right {
      grid-column: 3;
      align-self: center;
      justify-self: end;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 5px;
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .gh-strip-right .mn-kind-value {
      font-weight: 650;
    }

    /* the count chips — a quiet count of what changed, and the one danger ink in the bay */
    .gh-chip {
      display: inline-block;
      font-size: var(--mn-text-2xs, 10px);
      font-variant-numeric: tabular-nums;
      border-radius: var(--mn-radius-full, 9999px);
      padding: 2px 9px;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .gh-chip.quiet {
      background: var(--mn-color-surface-sunken, #edf2ee);
      color: var(--mn-color-text-secondary, #526059);
      border: 1px solid var(--mn-color-border-subtle, #dfe7e1);
    }
    .gh-chip.alarm {
      background: var(--mn-color-danger-surface, #f9e9e9);
      color: var(--mn-color-danger, #a63232);
      border: 1px solid var(--mn-color-danger-border, #e4bcbc);
      font-weight: 600;
    }
    /* drift is Constitution's amber — unpromoted edits, hung stores, identity changes */
    .gh-chip.drift {
      background: var(--mn-color-warning-surface, #f9f1de);
      color: var(--mn-color-warning, #b98a2e);
      border: 1px solid var(--mn-color-warning-border, #e6d3a3);
      font-weight: 600;
    }
    .gh-strip-unattested .gh-statewords {
      font-style: italic;
      color: var(--mn-color-text-muted, #94a09a);
    }

    /* ——— the recognition card: the CONSTITUTION room's matter (folio 02) ——— */
    .room-card {
      display: flex;
      justify-content: center;
    }
    .gh-card {
      width: 100%;
      max-width: 620px;
    }
    /* the mark zone — the agent's deterministic botanical portrait, team color */
    .c2-mark {
      height: 148px;
      margin: 4px 0 0;
      border-radius: 6px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--agent-color) 10%, var(--mn-color-surface-raised, #ffffff));
      border: 1px dashed color-mix(in srgb, var(--agent-color) 45%, transparent);
    }
    .c2-mark .vrm-chip {
      position: absolute;
      bottom: 6px;
      right: 8px;
    }
    .gh-card-plate {
      border-left: 3px solid var(--agent-color, var(--mn-color-accent, #2f7d5f));
      margin: 12px 0 0;
      padding: 1px 0 2px 12px;
    }
    .gh-card-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .gh-card-head .gh-name {
      font-weight: 650;
      font-size: var(--mn-text-md, 16px);
      letter-spacing: -0.01em;
    }
    .gh-card-sub {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #737f78);
      margin-top: 2px;
    }
    .gh-card .gh-kindline {
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
      color: var(--mn-color-text-secondary, #526059);
      margin: 6px 0 0;
      line-height: 1.45;
    }
    .gh-card-section {
      padding: 10px 0 12px;
      border-top: var(--mn-rule-hair, 1px solid #e4ebe6);
      margin-top: 10px;
    }
    .gh-card-eyebrow {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #94a09a);
      margin: 0 0 7px;
    }
    .gh-card-row {
      display: flex;
      gap: 12px;
      align-items: baseline;
      flex-wrap: wrap;
      font-size: var(--mn-text-sm, 13px);
      padding: 3px 0;
    }
    .gh-card-row .k {
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
      min-width: 118px;
    }
    .gh-card-row .mono {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
    .gh-card-metric .mn-kind-value {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
    }
    .gh-card-metric .mn-kind-unit {
      color: var(--mn-color-text-secondary, #526059);
      margin-inline-start: 0.25rem;
    }
    .gh-void-line {
      color: var(--mn-color-text-muted, #94a09a);
      font-style: italic;
      font-size: var(--mn-text-sm, 13px);
    }
    .gh-card .drift-word,
    .gh-card-desk .drift-word {
      color: var(--mn-color-warning, #b98a2e);
      font-weight: 600;
    }
    .gh-card .alarm-word,
    .gh-card-desk .alarm-word {
      color: var(--mn-color-danger, #a63232);
      font-weight: 600;
    }
    .chip-await {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: 9px;
      letter-spacing: 0.04em;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid var(--mn-color-warning-border, #e6d3a3);
      color: var(--mn-color-warning, #b98a2e);
      white-space: nowrap;
    }
    /* the charter pane — the agent's real system prompt, read-only (hoja waits on R0) */
    .gh-card-charter .gh-charter-doc {
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.6;
      color: var(--mn-color-text-primary, #18231e);
      max-width: 62ch;
    }
    .gh-card-charter .gh-charter-doc p {
      margin: 0 0 10px;
    }
    .gh-charter-foot {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #94a09a);
      padding: 6px 0 4px;
      border-top: var(--mn-rule-hair, 1px solid #e4ebe6);
      margin-top: 4px;
      font-variant-numeric: tabular-nums;
    }
    .gh-charter-foot .gh-charter-hoja {
      margin-left: auto;
      font-style: italic;
    }

    /* ——— the card at DESKTOP scale: one composed data surface (folio 02, #desk-card) ——— */
    /* Base is a single stacked column (a graceful narrow fallback); the desk grid takes
       over at the breakpoint. The card component only mounts this posture when wide, so
       the fallback is belt-and-suspenders, never the primary path. */
    .desk-cardgrid {
      max-width: 1120px;
      margin: 0 auto;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px 22px;
      align-items: start;
    }
    .desk-left {
      background: var(--mn-color-surface-raised, #ffffff);
      border: 1px solid var(--mn-color-border-default, #cfdad2);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card, 0 1px 2px rgba(24, 35, 30, 0.04), 0 6px 18px rgba(47, 90, 70, 0.06));
      padding: 0 14px 10px;
    }
    .c2-face-label {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: 9px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #94a09a);
      margin: 10px 0 0;
    }
    .c2-mark-desk {
      height: 208px;
      margin-top: 8px;
    }
    .c2-mark-desk svg {
      width: 148px;
      height: 148px;
    }
    .c2-plate {
      border-left: 3px solid var(--agent-color, var(--mn-color-accent, #2f7d5f));
      margin: 12px 0 0;
      padding: 1px 0 2px 10px;
    }
    .c2-plate .nm {
      font-weight: 700;
      font-size: var(--mn-text-md, 16px);
      letter-spacing: -0.01em;
    }
    .c2-plate .sub {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-tertiary, #737f78);
      margin-top: 2px;
    }
    .c2-kind {
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
      color: var(--mn-color-text-secondary, #526059);
      margin: 8px 0 0;
      line-height: 1.45;
    }
    .desk-divrow {
      margin: 10px 0 0;
      padding-top: 8px;
      border-top: var(--mn-rule-hair, 1px solid #e4ebe6);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary, #526059);
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: baseline;
    }
    .desk-colors {
      margin-left: auto;
    }
    /* the six-cell stat matrix — hairline-ruled cells; ° marks awaited K-data */
    .desk-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1px;
      background: var(--mn-color-border-subtle, #dfe7e1);
      border: var(--mn-rule-hair, 1px solid #e4ebe6);
      border-radius: 6px;
      overflow: hidden;
    }
    .c2-stat {
      background: var(--mn-color-surface-raised, #ffffff);
      padding: 8px 12px 9px;
    }
    .c2-stat .v {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: var(--mn-text-md, 16px);
    }
    .c2-stat .v.void {
      color: var(--mn-color-text-muted, #94a09a);
      font-weight: 400;
    }
    .c2-stat .v .await {
      color: var(--mn-color-warning, #b98a2e);
      font-weight: 400;
    }
    .c2-stat .l {
      font-size: 9px;
      color: var(--mn-color-text-tertiary, #737f78);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-top: 1px;
    }
    /* the instruments column — only instruments with served data draw (ink clause) */
    .desk-insts {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .inst {
      background: var(--mn-color-surface-raised, #ffffff);
      border: var(--mn-rule-hair, 1px solid #e4ebe6);
      border-radius: 6px;
      padding: 10px 14px 12px;
    }
    .inst .dl {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #94a09a);
      margin: 0 0 6px;
    }
    .inst svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .inst svg text {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: 9px;
      fill: var(--mn-color-text-tertiary, #737f78);
    }
    .inst-row {
      display: flex;
      gap: 10px;
      align-items: baseline;
      flex-wrap: wrap;
      font-size: var(--mn-text-sm, 13px);
      padding: 3px 0 0;
    }
    .inst-row .k {
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
      min-width: 52px;
    }
    /* the instrument inks — team color paints the data, warning keeps its meaning */
    .stations .rail,
    .chain .rail {
      stroke: var(--mn-color-border-default, #cfdad2);
      stroke-width: 1.5;
    }
    .stations circle.on {
      fill: var(--agent-color, var(--mn-color-accent, #2f7d5f));
    }
    .stations circle.off {
      fill: var(--mn-color-surface-raised, #ffffff);
      stroke: var(--mn-color-warning, #b98a2e);
      stroke-width: 1.5;
    }
    .chain circle.now {
      fill: var(--agent-color, var(--mn-color-accent, #2f7d5f));
    }
    .chain circle.past {
      fill: var(--mn-color-border-default, #cfdad2);
    }
    /* the incidents instrument — a bounded, newest-first list, each with its ts */
    .gh-incidents {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .gh-incident {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 3px 0;
      border-bottom: var(--mn-rule-hair, 1px solid #e4ebe6);
      font-size: var(--mn-text-sm, 13px);
    }
    .gh-incident:last-child {
      border-bottom: 0;
    }
    .gh-incident-kind {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
    .gh-incident-when {
      margin-left: auto;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #94a09a);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .gh-incident-more {
      padding: 4px 0 0;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #94a09a);
      font-variant-numeric: tabular-nums;
    }
    /* the charter as an embedded read-only document pane (hoja embed; editing waits R0) */
    .hoja-embed {
      background: var(--mn-color-surface-raised, #ffffff);
      border: 1px solid var(--mn-color-border-default, #cfdad2);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card, 0 1px 2px rgba(24, 35, 30, 0.04), 0 6px 18px rgba(47, 90, 70, 0.06));
      display: flex;
      flex-direction: column;
      min-height: 420px;
    }
    .hoja-head {
      display: flex;
      gap: 10px;
      align-items: baseline;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: var(--mn-rule-line, 1px solid #cfdad2);
    }
    .hoja-head .ht {
      font-weight: 650;
      font-size: var(--mn-text-sm, 13px);
    }
    .hoja-drift {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary, #526059);
    }
    .gh-hoja {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: 9px;
      letter-spacing: 0.08em;
      color: var(--mn-color-text-muted, #94a09a);
      border: 1px solid var(--mn-color-border-subtle, #dfe7e1);
      border-radius: 999px;
      padding: 1px 7px;
      white-space: nowrap;
      margin-left: auto;
    }
    .hoja-doc {
      flex: 1;
      padding: 16px 18px 8px;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.65;
      color: var(--mn-color-text-primary, #18231e);
    }
    .hoja-doc p {
      margin: 0 0 13px;
      max-width: 60ch;
    }
    .hoja-foot {
      border-top: var(--mn-rule-hair, 1px solid #e4ebe6);
      padding: 8px 16px;
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #94a09a);
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-variant-numeric: tabular-nums;
    }
    .hoja-foot-note {
      margin-left: auto;
      font-style: italic;
    }
    /* the desk composition proper — three columns only where there is room for them */
    @media (min-width: 1080px) {
      .desk-cardgrid {
        grid-template-columns: 300px minmax(0, 1fr) minmax(0, 1.1fr);
      }
      .desk-left {
        grid-column: 1;
        grid-row: 1 / span 2;
      }
      .desk-stats {
        grid-column: 2 / 4;
        grid-row: 1;
        grid-template-columns: repeat(6, 1fr);
      }
      .desk-insts {
        grid-column: 2;
        grid-row: 2;
      }
      .hoja-embed {
        grid-column: 3;
        grid-row: 2;
        min-height: 520px;
      }
    }

    .gh-strip-right .mn-kind-unit {
      margin-inline-start: 0.3rem;
    }

    /* the phosphor ramp dims testimony only; identity never decays */
    .gh-strip[data-age='dim1'] .gh-decays {
      opacity: 0.78;
    }
    .gh-strip[data-age='dim2'] .gh-decays {
      opacity: 0.58;
    }
    .gh-strip[data-age='stale'] .gh-decays {
      opacity: 0.58;
    }
    .gh-strip[data-age='stale'] .gh-asof {
      color: var(--mn-color-warning, #b98a2e);
      opacity: 1;
    }

    /* conversations unfolded under a hooked strip */
    .gh-convs {
      margin: 2px 0 10px 26px;
      border-left: 2px solid var(--mn-color-border-subtle, #dfe7e1);
    }

    .gh-convs-note {
      margin: 0;
      padding: 8px 6px 8px 14px;
      color: var(--mn-color-text-muted, #94a09a);
      font-size: var(--mn-text-xs, 12px);
    }

    .gh-conv {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 10px;
      width: 100%;
      padding: 8px 6px 8px 14px;
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-subtle, #dfe7e1);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .gh-conv:last-child {
      border-bottom: 0;
    }

    .gh-conv:hover {
      background: var(--mn-color-surface-hover, rgba(47, 125, 95, 0.07));
    }

    .gh-conv:focus-visible {
      border-radius: var(--mn-radius-md, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .gh-conv-title {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
    }

    .gh-conv-title .mn-kind-link {
      color: var(--mn-color-accent, #2f7d5f);
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 45%, transparent);
      text-underline-offset: 0.14em;
    }

    .gh-conv-untitled {
      color: var(--mn-color-text-tertiary, #737f78);
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
    }

    .gh-conv-meta {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-left: auto;
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
    }

    .gh-conv-live {
      color: var(--mn-color-accent, #2f7d5f);
      font-weight: 600;
    }

    /* Ⓔ the ground line */
    .gh-groundline {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 6px clamp(14px, 3vw, 22px);
      border-top: 1px solid var(--mn-top-bar-border, #cfe0d6);
      background: color-mix(in srgb, var(--mn-top-bar-bg, #e9f1ec) 70%, white);
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-2xs, 10px);
      font-variant-numeric: tabular-nums;
    }

    .gh-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .gh-pill::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--mn-color-accent, #2f7d5f);
    }

    .gh-pill[data-state='reconnecting']::before {
      background: var(--mn-color-warning, #b98a2e);
    }

    .gh-pill[data-state='dark'] {
      color: var(--mn-color-danger, #a63232);
      font-weight: 600;
    }

    .gh-pill[data-state='dark']::before {
      background: var(--mn-color-danger, #a63232);
    }

    .gh-ground-cmd {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .gh-ground-right {
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* the room and the log inside the surface */
    .room,
    .gh-log {
      width: min(100%, 1180px);
    }

    .gh-log {
      display: grid;
      gap: var(--mn-space-4, 16px);
      max-width: min(760px, 100%);
    }

    .gh-log-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 12px;
      padding-bottom: var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #dfe7e1);
    }

    .gh-log-title {
      font-size: var(--mn-text-lg, 18px);
      font-weight: 650;
    }

    .gh-log-title .mn-kind-link {
      color: var(--mn-color-text-primary, #18231e);
    }

    .gh-log-closed {
      color: var(--mn-color-text-muted, #94a09a);
      font-size: var(--mn-text-xs, 12px);
    }

    /* the empty bay and the dark stack */
    .gh-statebody {
      display: grid;
      justify-items: start;
      gap: var(--mn-space-2, 8px);
      width: min(100%, 640px);
      padding: clamp(20px, 5vw, 44px) 0;
    }

    .gh-statebody.dark-state {
      padding: clamp(20px, 5vw, 44px) clamp(16px, 4vw, 32px);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-sunken, #edf2ee);
    }

    .gh-statehead {
      margin: 0;
      font-size: var(--mn-text-lg, 18px);
      font-weight: 650;
    }

    .gh-statecopy {
      margin: 0;
      max-width: 58ch;
      color: var(--mn-color-text-secondary, #526059);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.5;
    }

    .gh-cmd {
      margin-top: var(--mn-space-1, 4px);
      padding: 6px 10px;
      border: 1px solid var(--mn-color-border-default, #cfdad2);
      border-radius: 4px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #526059);
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
    }

    .gh-state-actions {
      margin: var(--mn-space-1, 4px) 0 0;
    }

    .screen-zero,
    .state-screen {
      box-sizing: border-box;
      min-height: 100vh;
      min-height: 100dvh;
      padding: clamp(28px, 7vw, 96px);
    }

    .screen-zero {
      display: flex;
      align-items: flex-start;
    }

    .presence-strip {
      display: grid;
      width: min(100%, 1180px);
      margin-block: auto;
      gap: var(--mn-space-3, 12px);
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-family: var(--mn-font-chrome, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
    }

    .presence-sentence {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.42rem;
      min-width: 0;
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-size: var(--mn-text-lg, 18px);
      line-height: 1.35;
    }

    .presence-name {
      color: var(--mn-color-text-primary, var(--mn-top-bar-text, #18231e));
      font-family: var(--mn-font-display, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: 88px;
      font-weight: var(--mn-font-weight-bold, 700);
      letter-spacing: 0;
      line-height: 0.98;
      overflow-wrap: anywhere;
    }

    .presence-predicate,
    .presence-separator {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
    }

    .presence-dot {
      box-sizing: border-box;
      flex: 0 0 auto;
      width: 12px;
      height: 12px;
      margin-right: 0.16rem;
      border-radius: 999px;
      transform: translateY(-1px);
    }

    .presence-dot-live {
      background: var(--mn-color-accent, #2f7d5f);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 18%, transparent);
    }

    .presence-dot-held {
      background: var(--mn-color-warning, #d97706);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--mn-color-warning, #d97706) 16%, transparent);
    }

    .presence-dot-dormant {
      background: transparent;
      border: 1.5px solid var(--mn-color-text-muted, #94a09a);
    }

    .presence-dot-unknown {
      background: transparent;
      border: 1.5px dashed var(--mn-color-text-muted, #94a09a);
    }

    /* The live dot is still: the slow pulse is the phosphor's alone (staleness),
       the one motion in the system. Liveness is the solid dot + accent ring. */

    .presence-ref {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      text-decoration: none;
    }

    .presence-kindline {
      max-width: 72ch;
      color: var(--mn-color-text-tertiary, var(--mn-top-bar-text-muted, #737f78));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-sm, 14px);
      font-style: italic;
      line-height: 1.35;
    }

    /* ——— the turnover brief: what changed while you were away (sheet 03) ——— */
    .gh-brief {
      padding: 4px 0 0;
    }
    .gh-brief-head {
      margin: 12px 6px 4px;
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mn-color-text-muted, #94a09a);
    }
    .gh-brief-line {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      padding: 7px 6px;
      font-size: var(--mn-text-sm, 13px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e4ebe6);
    }
    .gh-brief-line:last-child {
      border-bottom: 0;
    }
    .gh-brief-line[data-tier='anomaly'] {
      border-left: 2px solid var(--mn-color-danger, #a63232);
      padding-left: 10px;
      background: linear-gradient(90deg, var(--mn-color-danger-surface, #f9e9e9), transparent 55%);
    }
    .gh-brief-line[data-tier='anomaly'] .gh-lead {
      color: var(--mn-color-danger, #a63232);
      font-weight: 600;
    }
    .gh-brief-line[data-tier='whisper'] {
      color: var(--mn-color-text-tertiary, #737f78);
      font-size: var(--mn-text-xs, 12px);
    }
    .gh-brief-line .gh-when {
      margin-left: auto;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #94a09a);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .gh-brief-line .mn-kind[data-kind='metric'] .mn-kind-value {
      font-weight: 650;
    }
    .gh-brief-line .mn-kind[data-kind='metric'] .mn-kind-unit {
      margin-inline-start: 0.25rem;
    }
    .gh-brief-snippet {
      color: var(--mn-color-text-secondary, #526059);
    }
    .gh-chain {
      font-variant-numeric: tabular-nums;
    }
    .gh-chain .gh-arrow {
      color: var(--mn-color-text-muted, #94a09a);
    }
    .gh-trend {
      font-variant-numeric: tabular-nums;
    }
    .gh-trend .up {
      color: var(--mn-color-warning, #b98a2e);
    }
    .gh-trend .down {
      /* Green is liveness + affordance only — a falling metric is not an affordance. */
      color: var(--mn-color-text-tertiary, #737f78);
    }
    .gh-trend .flat {
      color: var(--mn-color-text-muted, #94a09a);
    }
    .gh-aff {
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      color: var(--mn-color-accent, #2f7d5f);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-color: rgba(47, 125, 95, 0.35);
      text-underline-offset: 0.16em;
    }
    .gh-aff:focus-visible {
      outline: 2px solid var(--mn-color-accent, #2f7d5f);
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* ——— the watermark rule: the instrument's self-test (renders every return) ——— */
    .gh-watermark {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 10px 6px;
      color: var(--mn-color-text-muted, #94a09a);
    }
    .gh-watermark::before,
    .gh-watermark::after {
      content: '';
      flex: 1;
      border-top: 1px dashed var(--mn-color-border-default, #cfdad2);
    }
    .gh-watermark span {
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.08em;
      white-space: nowrap;
    }

    .presence-meta {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-sm, 14px);
      line-height: 1.35;
      text-overflow: ellipsis;
      user-select: text;
      white-space: nowrap;
    }

    .speech-surface {
      display: grid;
      gap: var(--mn-space-3, 12px);
      margin-top: var(--mn-space-2, 8px);
    }

    .transcript {
      display: grid;
      gap: var(--mn-space-4, 16px);
      max-width: min(760px, 100%);
    }

    .message-line {
      display: grid;
      gap: var(--mn-space-1, 4px);
      color: var(--mn-color-text-primary, #18231e);
      font-family: var(--mn-font-prose, var(--greenhouse-font-serif, Georgia, serif));
      font-size: var(--mn-text-lg, 18px);
      line-height: 1.5;
    }

    .message-attribution {
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
    }

    .message-text {
      max-width: 72ch;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .message-line-agent .message-text {
      color: var(--mn-color-text-primary, #18231e);
      font-style: normal;
    }

    .message-line-human .message-text {
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      font-style: normal;
    }

    .conduct-account {
      display: grid;
      gap: var(--mn-space-2, 8px);
      max-width: 72ch;
    }

    .conduct-disclosure {
      display: flex;
      width: fit-content;
      max-width: 100%;
      min-height: 24px;
      align-items: baseline;
      gap: var(--mn-space-1, 4px);
      border: 0;
      padding: 0;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      background: transparent;
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      text-align: left;
    }

    .conduct-disclosure:hover {
      color: var(--mn-color-text-secondary, #60746a);
    }

    .conduct-lines {
      display: grid;
      gap: var(--mn-space-1, 4px);
      margin: 0;
      padding: 0;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.45;
      list-style: none;
      overflow-wrap: anywhere;
    }

    .conduct-line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px);
      opacity: 1;
    }

    .conduct-verb {
      color: var(--mn-color-text-secondary, #60746a);
    }

    .conduct-outcome,
    .conduct-source,
    .conduct-metric {
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
    }

    @media (prefers-reduced-motion: no-preference) {
      .conduct-account.open .conduct-lines {
        animation: conduct-lines-in 140ms ease-out;
      }
    }

    @keyframes conduct-lines-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .turn-activity {
      display: flex;
      min-height: 27px;
      align-items: baseline;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-sm, 14px);
      line-height: 1.45;
    }

    .turn-ellipsis {
      display: inline-block;
      width: 1.2em;
      overflow: hidden;
      vertical-align: bottom;
    }

    @media (prefers-reduced-motion: no-preference) {
      .turn-ellipsis {
        animation: turn-ellipsis 1.35s steps(4, end) infinite;
      }
    }

    @keyframes turn-ellipsis {
      from {
        width: 0;
      }
      to {
        width: 1.2em;
      }
    }

    .composer {
      display: flex;
      min-height: 31px;
      max-width: min(620px, 100%);
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
      margin: 0;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-base, 15px);
      line-height: 1.45;
    }

    .composer-input {
      flex: 1 1 24ch;
      min-width: 0;
      padding: 0 0 3px;
      border: 0;
      border-bottom: 1px solid transparent;
      background: transparent;
      color: var(--mn-color-text-primary, #18231e);
      font: inherit;
      line-height: inherit;
    }

    .composer-input::placeholder,
    .composer-disabled-reason,
    .composer-beat {
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
    }

    .composer-input:not(:disabled):focus {
      border-bottom-color: var(--mn-color-border-default, #cbd5d1);
      outline: none;
    }

    .composer-input:focus-visible {
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .composer-beat,
    .composer-disabled-reason {
      flex: 0 0 auto;
      font-size: var(--mn-text-sm, 14px);
      white-space: nowrap;
    }

    .floor-stack {
      display: grid;
      min-height: 54px;
      align-content: start;
      gap: var(--mn-space-1, 4px);
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-base, 15px);
      line-height: 1.45;
    }

    .floor-line {
      display: flex;
      min-height: 28px;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.38rem;
    }

    .floor-line-steering {
      flex-wrap: nowrap;
    }

    .floor-holder-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .floor-queue {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-size: var(--mn-text-sm, 14px);
      line-height: 1.45;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .floor-separator,
    .floor-testimony {
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
    }

    .floor-separator {
      flex: none;
    }

    .text-affordance {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-color-accent, #2f7d5f);
      cursor: pointer;
      font: inherit;
      line-height: inherit;
      text-align: left;
      text-decoration: none;
    }

    .text-affordance:hover {
      color: color-mix(in srgb, var(--mn-color-accent, #2f7d5f) 72%, var(--mn-color-text-primary, #18231e));
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 0.18em;
    }

    .text-affordance:focus-visible,
    .steer-input:focus-visible {
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .floor-transition {
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
    }

    .steer-form {
      display: inline-flex;
      flex: 1 1 min(32ch, 72vw);
      min-width: 0;
      max-width: min(32ch, 72vw);
      min-height: 28px;
      align-items: baseline;
      margin: 0;
    }

    .steer-input {
      width: 100%;
      min-width: 0;
      padding: 0 0 2px;
      border: 0;
      border-bottom: 1px solid var(--mn-color-border-default, #cbd5d1);
      background: transparent;
      color: var(--mn-color-text-primary, #18231e);
      font: inherit;
      line-height: inherit;
    }

    @media (prefers-reduced-motion: no-preference) {
      .floor-line,
      .floor-queue,
      .steer-form {
        transition: opacity 0.16s ease;
      }
    }

    .presence-model {
      position: relative;
      display: inline-flex;
      min-width: 0;
      align-items: baseline;
      gap: var(--mn-space-1-5, 6px);
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .model-stat.open {
      z-index: 10;
    }

    .presence-model .agent-model-trigger {
      display: inline-flex;
      width: auto;
      min-height: 0;
      align-items: baseline;
      gap: 0.2rem;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-top-bar-text, var(--mn-color-text-primary, #213f33));
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-lg, 18px);
      font-weight: var(--mn-font-weight-semibold, 600);
      line-height: 1.35;
      text-align: left;
    }

    .presence-model .agent-model-trigger:hover {
      color: var(--mn-color-accent, #2f7d5f);
    }

    /* phosphor honesty: a seeded model is a hardcoded fallback, Constitution's same
       amber as the charter's drift-word — degraded-but-live, never danger red */
    .presence-model .agent-model-trigger.agent-model-trigger-seeded,
    .presence-model .agent-model-trigger.agent-model-trigger-seeded:hover {
      color: var(--mn-color-warning, #b98a2e);
    }

    .agent-model-trigger:focus-visible {
      border-radius: var(--mn-radius-control, 6px);
      box-shadow: var(--mn-focus-ring, 0 0 0 2px rgba(47, 125, 95, 0.4));
      outline: none;
    }

    .agent-model-name,
    .agent-model-option-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .presence-model .agent-model-caret {
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      font-size: var(--mn-text-xs, 12px);
      transition: transform 0.12s ease;
    }

    .model-stat.open .agent-model-caret {
      transform: rotate(180deg);
    }

    .presence-model-attribution {
      align-self: center;
      color: var(--mn-top-bar-text-muted, var(--mn-color-text-secondary, #60746a));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      white-space: nowrap;
    }

    .presence-model-simulated {
      align-self: center;
      color: var(--mn-color-text-muted, var(--mn-top-bar-text-muted, #94a09a));
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      white-space: nowrap;
    }

    .agent-model-picker {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      z-index: 30;
      display: grid;
      grid-template-columns: 112px minmax(172px, 1fr);
      width: min(360px, calc(100vw - 40px));
      min-height: 176px;
      max-height: 260px;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.14));
    }

    .agent-model-providers,
    .agent-model-models {
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-1-5, 6px) 0;
    }

    .agent-model-providers {
      border-right: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
    }

    .agent-model-models {
      background: var(--mn-color-surface-base, #fff);
    }

    .agent-model-provider,
    .agent-model-option {
      display: block;
      width: 100%;
      min-height: 34px;
      box-sizing: border-box;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      text-align: left;
    }

    .agent-model-provider {
      padding: 8px var(--mn-space-3, 12px);
    }

    .agent-model-option {
      display: flex;
      align-items: center;
      padding: 8px var(--mn-space-3, 12px);
      color: var(--mn-color-text-primary, #111827);
    }

    .agent-model-provider:hover,
    .agent-model-provider:focus-visible,
    .agent-model-provider.active,
    .agent-model-option:hover,
    .agent-model-option:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .agent-model-provider.selected,
    .agent-model-option.selected {
      color: var(--mn-color-text-accent, var(--mn-color-accent, #586f93));
      font-weight: 750;
    }

    .agent-model-option.selected {
      background: var(--mn-color-interactive-selected, rgba(88, 111, 147, 0.12));
    }

    /* ——— the palette (⌘O): the one surface allowed a modal shadow (sheet 05) ——— */
    /* The dimmed surface under the raised palette: a blurred, receded greenhouse pane. */
    .shell.dimmed {
      filter: blur(1.5px) saturate(0.85);
      opacity: 0.6;
      pointer-events: none;
      user-select: none;
    }

    .gh-palette-overlay {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: clamp(24px, 8vh, 104px) 16px 24px;
    }

    .gh-palette {
      display: flex;
      flex-direction: column;
      width: min(520px, 92vw);
      max-height: min(70vh, 620px);
      overflow: hidden;
      border: 1px solid var(--mn-color-border-strong, #adc6b9);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-modal, 0 22px 56px rgba(24, 35, 30, 0.18));
    }

    .gh-palette-input {
      display: flex;
      flex: none;
      align-items: baseline;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--mn-color-border-default, #cfdad2);
      font-size: var(--mn-text-base, 15px);
    }

    .gh-caret {
      color: var(--mn-color-accent, #2f7d5f);
    }

    .gh-query-input {
      flex: 1;
      min-width: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mn-color-text-primary, #18231e);
      font-family: var(--mn-font-mono, ui-monospace, Menlo, monospace);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.35;
    }

    .gh-query-input::placeholder {
      color: var(--mn-color-text-muted, #94a09a);
      font-family: var(--mn-font-chrome, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
    }

    .gh-query-input:focus {
      outline: none;
    }

    .gh-palette-rows {
      min-height: 0;
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    /* Palette rows ARE bay components; the palette only tightens their gutter and
       slots conversations under their agent (folio 05·A markup). */
    .gh-palette-row .gh-strip {
      border-bottom: 1px solid var(--mn-color-border-subtle, #dfe7e1);
    }

    .gh-palette-row:last-child .gh-strip,
    .gh-palette-row:last-child .gh-conv {
      border-bottom: 0;
    }

    .gh-palette-row .gh-strip-hook {
      padding: 9px 12px 8px;
    }

    .gh-palette-row-conv .gh-conv {
      padding-left: 38px;
    }

    /* The selected row wears the same wash the bay's hover uses — selection is one
       idea everywhere (sheet 05 bind). */
    .gh-palette-row .gh-row-selected,
    .gh-palette-row .gh-strip.gh-row-selected .gh-strip-hook,
    .gh-palette-row .gh-conv.gh-row-selected {
      background: var(--mn-color-surface-hover, rgba(47, 125, 95, 0.07));
      border-radius: var(--mn-radius-md, 6px);
    }

    .gh-palette-empty {
      margin: 0;
      padding: 14px 16px;
      color: var(--mn-color-text-muted, #94a09a);
      font-size: var(--mn-text-sm, 13px);
    }

    .gh-hintbar {
      display: flex;
      flex: none;
      gap: 16px;
      padding: 8px 16px;
      border-top: 1px solid var(--mn-color-border-subtle, #e4ebe6);
      background: var(--mn-color-surface-sunken, #edf2ee);
      color: var(--mn-color-text-muted, #94a09a);
      font-size: var(--mn-text-2xs, 10px);
      font-variant-numeric: tabular-nums;
    }

    .state-screen {
      display: grid;
      align-content: center;
      justify-items: start;
      gap: var(--mn-space-3, 12px);
      color: var(--mn-color-text-primary, #18231e);
    }

    .state-kicker {
      color: var(--mn-color-text-muted, #6b7280);
      font-family: var(--mn-font-utility, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: var(--mn-text-xs, 12px);
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .state-title {
      max-width: 720px;
      font-family: var(--mn-font-display, var(--greenhouse-font-sans, Inter, system-ui, sans-serif));
      font-size: 56px;
      font-weight: var(--mn-font-weight-bold, 700);
      letter-spacing: 0;
      line-height: 1.02;
    }

    .state-copy {
      max-width: 560px;
      color: var(--mn-color-text-secondary, #60746a);
      font-size: var(--mn-text-base, 15px);
      line-height: 1.55;
    }

    .state-command {
      margin-top: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #cfe0d6);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #475569);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-sm, 14px);
    }

    @media (max-width: 720px) {
      .screen-zero,
      .state-screen {
        padding: 28px;
      }

      .screen-zero {
        align-items: start;
      }

      .presence-sentence,
      .presence-model .agent-model-trigger {
        font-size: var(--mn-text-base, 15px);
      }

      .presence-name {
        flex-basis: 100%;
        font-size: 48px;
      }

      .state-title {
        font-size: 38px;
      }
    }
  `
}
