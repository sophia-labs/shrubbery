/**
 * archive-projection.ts — an imported conversation, read in the kernel's vocabulary.
 *
 * The gateway serves an archived message as `{role, occurredAt, parts[]}` where a
 * part is text, reasoning, an attachment reference, tool activity (a JSON STRING)
 * or something this app does not know. Here every message is first NORMALIZED
 * into a small typed turn, and that one shape feeds three readers:
 *
 *   - `projectArchiveMessages` -> the kernel's ChatMessage, so the imported reader
 *     is `sh-chat-panel` in read-only posture (markdown, reasoning, tool cards);
 *   - the line under each message: a real date and the voice the source recorded;
 *   - `conversationToMarkdown` -> Download as Markdown and Save to Garden.
 *
 * Live conversations normalize into the same shape (`normalizeChatMessage`), so
 * both kinds leave the app through one path.
 *
 * Doctrine carried here:
 *   - Testimony, not authorship. A voice mark is what a derived sidecar says the
 *     source recorded; where nothing was recorded the mark says so. No message is
 *     ever labelled with a current or default model.
 *   - A retained tool call with no output is shown as "output not retained",
 *     never as an empty result.
 *   - Nothing is decoded from an id, and no text is rewritten: text passes
 *     through untouched (the kernel sanitizes what it renders).
 */

import type { ChatMessage, MessagePart, ToolCall, ToolCallStatus } from '@shrubbery/chat-kernel'
import type { ArchiveMessage, ArchiveVoice } from './conversation-archive.js'
import { formatAbsoluteDate, modelDisplayName, parseIso } from './conversation-home.js'

export const VOICE_NOT_RECORDED = 'voice not recorded'
export const TIME_NOT_RECORDED = 'Time not recorded'

// ── voice ──────────────────────────────────────────────────────────────────

export type VoiceMark =
  | { readonly recorded: true; readonly label: string; readonly modelId: string | null; readonly basis: string | null }
  | { readonly recorded: false }

/** The mark for an assistant turn: the recorded voice, or the honest absence of one. */
export function voiceMarkFor(voice: ArchiveVoice | null | undefined): VoiceMark {
  if (!voice) return { recorded: false }
  const label = voice.label ?? (voice.modelId ? modelDisplayName(voice.modelId) : null)
  if (!label) return { recorded: false }
  return { recorded: true, label, modelId: voice.modelId, basis: voice.basis }
}

/** 'voice: Kimi K2.5 · source-recorded', or 'voice not recorded'. */
export function voiceMarkText(mark: VoiceMark): string {
  if (!mark.recorded) return VOICE_NOT_RECORDED
  return mark.basis ? `voice: ${mark.label} · ${mark.basis}` : `voice: ${mark.label}`
}

// ── one normalized turn ────────────────────────────────────────────────────

export type TurnBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly name: string
      readonly status: ToolCallStatus
      readonly input: Record<string, unknown> | null
      readonly output: string | null
      readonly error: string | null
    }
  | { readonly kind: 'other'; readonly label: string; readonly text: string; readonly tone: 'data' | 'warning' }

export interface NormalizedTurn {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'other'
  /** The source's own role word; meaningful for `other` (e.g. 'system'). */
  readonly roleName: string
  /** The source's ISO time when it is readable, else null. */
  readonly occurredAt: string | null
  /** Milliseconds since the epoch, or 0 when no time was recorded. */
  readonly createdAt: number
  readonly deleted: boolean
  /** Only assistant turns carry a mark; a user turn has no voice to mark. */
  readonly voice: VoiceMark | null
  readonly blocks: readonly TurnBlock[]
}

type ArchivePart = ArchiveMessage['parts'][number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function tryJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function errorText(value: unknown): string | null {
  if (typeof value === 'string') return cleanString(value)
  if (isRecord(value)) return Object.keys(value).length ? asText(value) : null
  return value === null || value === undefined ? null : String(value)
}

const FAILED_STATES = new Set(['error', 'failed', 'failure'])
const UNFINISHED_STATES = new Set(['running', 'pending', 'queued', 'started'])

function toolBlock(part: ArchivePart): TurnBlock {
  const raw = typeof part.content === 'string' ? tryJson(part.content) : part.content
  if (!isRecord(raw)) {
    return { kind: 'other', label: 'Tool activity (unreadable)', text: asText(part.content), tone: 'data' }
  }
  const state = typeof raw.state === 'string' ? raw.state.trim().toLowerCase() : ''
  const error = errorText(raw.error)
  // An unfinished call in a finished transcript never finished: show it as
  // pending, never as a running spinner.
  const status: ToolCallStatus = error || FAILED_STATES.has(state) ? 'error' : UNFINISHED_STATES.has(state) ? 'pending' : 'completed'
  const output = raw.output === null || raw.output === undefined ? null : asText(raw.output)
  const input = isRecord(raw.input) ? raw.input : raw.input === null || raw.input === undefined ? null : { input: raw.input }
  return { kind: 'tool', id: part.partId, name: cleanString(raw.toolName ?? raw.tool ?? raw.name) ?? 'tool', status, input, output, error }
}

function attachmentBlock(part: ArchivePart): TurnBlock {
  const raw = typeof part.content === 'string' ? tryJson(part.content) : part.content
  const name = isRecord(raw) ? cleanString(raw.name ?? raw.filename ?? raw.fileName ?? raw.title) : null
  const text = name ?? asText(part.content).slice(0, 500)
  return { kind: 'other', label: 'Attachment (file not captured)', text: text || 'Unnamed attachment', tone: 'data' }
}

const DELETED_NOTE: TurnBlock = {
  kind: 'other',
  label: 'Deleted at the source',
  text: 'This message was deleted in the old garden before it was exported.',
  tone: 'warning',
}

export function normalizeArchiveMessage(message: ArchiveMessage): NormalizedTurn {
  const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'other'
  const time = parseIso(message.occurredAt)
  const deleted = message.state.trim().toLowerCase() === 'deleted'
  const blocks: TurnBlock[] = deleted ? [DELETED_NOTE] : []
  for (const part of message.parts) {
    if (part.kind === 'text') {
      const text = asText(part.content)
      if (text.trim()) blocks.push({ kind: 'text', text })
    } else if (part.kind === 'reasoning') {
      const text = asText(part.content)
      if (text.trim()) blocks.push({ kind: 'reasoning', text })
    } else if (part.kind === 'tool-activity') {
      blocks.push(toolBlock(part))
    } else if (part.kind === 'attachment') {
      blocks.push(attachmentBlock(part))
    } else {
      blocks.push({ kind: 'other', label: `Unrecognised part (${part.kind})`, text: asText(part.content), tone: 'data' })
    }
  }
  return {
    id: message.messageId,
    role,
    roleName: message.role,
    occurredAt: time === null ? null : message.occurredAt,
    createdAt: time ?? 0,
    deleted,
    voice: role === 'assistant' ? voiceMarkFor(message.voice) : null,
    blocks,
  }
}

/** A live message, normalized into the same turn shape. It carries no voice claim. */
export function normalizeChatMessage(message: ChatMessage): NormalizedTurn {
  const blocks: TurnBlock[] = []
  const parts: readonly MessagePart[] = message.parts ?? []
  if (parts.length === 0 && message.content.trim()) blocks.push({ kind: 'text', text: message.content })
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.content.trim()) blocks.push({ kind: 'text', text: part.content })
    } else if (part.type === 'reasoning') {
      if (part.content.trim()) blocks.push({ kind: 'reasoning', text: part.content })
    } else if (part.type === 'tool') {
      const call = message.toolCalls.find(candidate => candidate.id === part.toolCallId)
      if (call) blocks.push(liveToolBlock(call))
    } else {
      blocks.push({ kind: 'other', label: part.title, text: part.content, tone: part.tone === 'warning' ? 'warning' : 'data' })
    }
  }
  return {
    id: message.id,
    role: message.role,
    roleName: message.role,
    occurredAt: message.createdAt > 0 ? new Date(message.createdAt).toISOString() : null,
    createdAt: Math.max(0, message.createdAt),
    deleted: false,
    voice: null,
    blocks,
  }
}

function liveToolBlock(call: ToolCall): TurnBlock {
  return {
    kind: 'tool',
    id: call.id,
    name: call.tool,
    status: call.status,
    input: call.input ?? null,
    output: call.output ?? null,
    error: call.status === 'error' ? (call.output ?? null) : null,
  }
}

// ── the line under each message ───────────────────────────────────────────

/** 'Mar 3, 2026, 2:06 PM · voice: Kimi K2.5 · source-recorded'. Every piece is either recorded or said to be absent. */
export function turnMetaLine(turn: NormalizedTurn): string {
  const pieces = [formatAbsoluteDate(turn.occurredAt, true) ?? TIME_NOT_RECORDED]
  if (turn.role === 'other') pieces.push(`role: ${turn.roleName}`)
  if (turn.voice) pieces.push(voiceMarkText(turn.voice))
  return pieces.join(' · ')
}

// ── the kernel's ChatMessage ──────────────────────────────────────────────

export interface ProjectedTranscript {
  readonly messages: ChatMessage[]
  /** Message id -> the line shown under that message. */
  readonly annotations: ReadonlyMap<string, string>
}

function projectTurn(turn: NormalizedTurn): ChatMessage {
  const parts: MessagePart[] = []
  const toolCalls: ToolCall[] = []
  const text: string[] = []
  for (const block of turn.blocks) {
    if (block.kind === 'text') {
      parts.push({ type: 'text', content: block.text })
      text.push(block.text)
    } else if (block.kind === 'reasoning') {
      parts.push({ type: 'reasoning', content: block.text })
    } else if (block.kind === 'tool') {
      toolCalls.push({
        id: block.id,
        tool: block.name,
        status: block.status,
        input: block.input,
        // An error card shows its error as its output; a silent call keeps null,
        // which the reader renders as "output not retained".
        output: block.status === 'error' ? (block.error ?? block.output) : block.output,
        metadata: null,
      })
      parts.push({ type: 'tool', toolCallId: block.id })
    } else {
      parts.push({ type: 'transcript', title: block.label, content: block.text, tone: block.tone, sourceLabel: block.label })
    }
  }
  return {
    id: turn.id,
    role: turn.role === 'user' ? 'user' : 'assistant',
    content: text.join('\n\n'),
    parts,
    isStreaming: false,
    toolCalls,
    createdAt: turn.createdAt,
  }
}

export function projectArchiveMessages(messages: readonly ArchiveMessage[]): ProjectedTranscript {
  const annotations = new Map<string, string>()
  const projected = messages.map(message => {
    const turn = normalizeArchiveMessage(message)
    annotations.set(turn.id, turnMetaLine(turn))
    return projectTurn(turn)
  })
  return { messages: projected, annotations }
}

// ── plain-language notes ──────────────────────────────────────────────────

/** Says what may be missing without naming the exporter or its schema. */
export function completenessNote(completeness: { status: string; reason: string } | null): string | null {
  if (!completeness) return null
  const status = completeness.status.trim().toLowerCase()
  if (status === 'complete') return 'This is the whole conversation as it was recorded.'
  if (status === 'unknown') {
    return 'Some of this conversation may be missing. It comes from a selected export of the old garden, '
      + 'so anything the export left out (older turns, attachments, some tool output) is not shown here.'
  }
  return 'This copy is partial: parts of the original conversation are missing.'
}

export function messageCountLine(loaded: number, total: number): string {
  return `${loaded.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} message${total === 1 ? '' : 's'}`
}

// ── Markdown ──────────────────────────────────────────────────────────────

export interface ConversationExport {
  readonly title: string
  readonly kind: 'live' | 'imported'
  /** 'Imported from the old garden · basis' for an import, null for a live chat. */
  readonly provenance: string | null
  /** The span of dates the conversation covers, already worded, or null. */
  readonly range: string | null
  readonly exportedAt: string
  /** The completeness note for an import, or null. */
  readonly note: string | null
  readonly turns: readonly NormalizedTurn[]
}

/** A fence longer than any run of backticks inside, so the content can never close it early. */
function fence(text: string, language = ''): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
  const ticks = '`'.repeat(Math.max(3, longest + 1))
  return `${ticks}${language}\n${text}\n${ticks}`
}

/**
 * A message is data, and in a copy it must not be able to draw the copy's own structure: a
 * line inside it that reads "## Assistant" would pass for a turn heading, and a line of "-"
 * or "=" under a word would make that word a heading. Outside fenced code, a heading inside
 * a message is demoted to level 4 or deeper (the copy uses levels 1 and 2) and a setext
 * underline is escaped. Nothing is dropped; fenced code is left exactly as it was.
 */
export function neutralizeMarkdownStructure(text: string): string {
  let fence: { readonly char: string; readonly length: number } | null = null
  return text
    // Any line ending counts: a stray carriage return must not hide a heading or an underline.
    .split(/\r\n|\r|\n/)
    .map(line => {
      if (fence) {
        // A fence closes on the same character, at least as long, and nothing else on the line.
        if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`).test(line)) fence = null
        return line
      }
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (opening) {
        fence = { char: opening[1][0], length: opening[1].length }
        return line
      }
      const heading = /^( {0,3})(#{1,6})([ \t].*|)$/.exec(line)
      if (heading) return `${heading[1]}${'#'.repeat(Math.max(heading[2].length, 4))}${heading[3]}`
      const underline = /^( {0,3})(=+|-+)([ \t]*)$/.exec(line)
      if (underline) return `${underline[1]}\\${underline[2]}${underline[3]}`
      return line
    })
    .join('\n')
}

function blockMarkdown(block: TurnBlock): string {
  if (block.kind === 'text') return neutralizeMarkdownStructure(block.text.trim())
  if (block.kind === 'reasoning') {
    const quoted = block.text.trim().split('\n').map(line => (line ? `> ${line}` : '>'))
    return ['> **Thinking**', '>', ...quoted].join('\n')
  }
  if (block.kind === 'other') {
    return block.text.trim() ? `**${block.label}**\n\n${fence(block.text.trim())}` : `**${block.label}**`
  }
  const sections = [`**Tool: ${block.name}** · ${block.status}`]
  if (block.input !== null) sections.push(`Input:\n\n${fence(JSON.stringify(block.input, null, 2), 'json')}`)
  if (block.error) sections.push(`Error:\n\n${fence(block.error)}`)
  else if (block.output === null) sections.push('_Output not retained._')
  else if (block.output.trim()) sections.push(`Output:\n\n${fence(block.output)}`)
  return sections.join('\n\n')
}

function turnHeading(turn: NormalizedTurn): string {
  return turn.role === 'user' ? 'You' : turn.role === 'assistant' ? 'Assistant' : turn.roleName || 'Message'
}

export function conversationToMarkdown(input: ConversationExport): string {
  const count = input.turns.length
  const exported = formatAbsoluteDate(input.exportedAt)
  const meta = [input.provenance, `${count} message${count === 1 ? '' : 's'}`, input.range, exported ? `exported ${exported}` : null]
    .filter(Boolean)
    .join(' · ')
  const sections = [`# ${input.title.replace(/\s+/g, ' ').trim() || 'Conversation'}`, `*${meta}*`]
  if (input.note) sections.push(`> ${input.note}`)
  for (const turn of input.turns) {
    sections.push(`## ${turnHeading(turn)}`, `*${turnMetaLine(turn)}*`)
    for (const block of turn.blocks) sections.push(blockMarkdown(block))
  }
  return `${sections.join('\n\n')}\n`
}

/** 'deploy-to-sirin-box-2026-09-28.md'. Only letters and digits survive, so a title can never name a path. */
export function markdownFilename(title: string, iso: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  const time = parseIso(iso)
  let day = ''
  if (time !== null) {
    const date = new Date(time)
    day = `-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  return `${slug || 'conversation'}${day}.md`
}
