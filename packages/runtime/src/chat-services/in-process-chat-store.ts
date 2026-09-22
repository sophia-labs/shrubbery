/**
 * in-process-chat-store.ts — a REAL Map-backed chat store (option a).
 *
 * This is a THIRD honest sibling to the two production ChatStore impls
 * (garden's TauriCommandChatStore = JSON-on-disk via Rust commands, and
 * choreograph's libSQL SessionStore) — NOT a mock. It implements the same
 * session/message persistence shape with REAL upsert + REAL aggregate folding,
 * over an in-process Map.
 *
 * WHY in-process (not the cell :chat graph): gen-2 chat persists in choreograph's
 * libSQL (a PROCESS-SIDE RELATIONAL store), NOT in the gardend graph — the
 * gardend loopback contract exposes NO chat/session primitives, chat messages are
 * Pi content-blocks/JSON not naturally RDF, and a cell :chat graph would force
 * inventing a chat-RDF vocab + a ChatWriter contract member + a live cell
 * dependency. An in-process store MODELS the production substrate; the cell graph
 * would model a place chat does NOT live. (See the C2 survey forks.)
 *
 * TRADE: in-memory loses cross-reload durability — acceptable to prove the
 * round-trip. The Tauri JSON-on-disk + choreograph libSQL impls are the durable
 * siblings; a disk-backed upgrade is a later drop-in, still in-process, no infra.
 *
 * KERNEL-PURE: holds SessionSummary + ChatMessage[] (NOT garden's AgentMessage
 * rows). computeAggregates folds over ChatMessage.tokens (the kernel's
 * TokenUsage) — a LOCAL re-derivation (garden's computeAggregates reads Pi usage,
 * which is off-limits), so it must be written fresh, not imported.
 */

import { uuid, type ChatMessage, type SessionSummary, type TokenUsage } from '@shrubbery/chat-kernel'

/** Aggregate token totals folded over a session's ChatMessage[]. A LOCAL
 * re-derivation over the kernel's TokenUsage (NOT garden's Pi-usage computeAggregates). */
export interface SessionAggregates {
  messageCount: number
  tokens: TokenUsage
}

/** A stored session: its summary + the ordered message history. */
interface StoredSession {
  session: SessionSummary
  messages: ChatMessage[]
}

/** Options to seed a new session row. */
export interface CreateSessionRow {
  title?: string | null
}

/**
 * Fold token aggregates over a ChatMessage[]. Sums each message's TokenUsage
 * (absent ⇒ zero). Pure; no Pi/usage shape — the kernel's TokenUsage only.
 */
export function computeAggregates(messages: ChatMessage[]): SessionAggregates {
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const m of messages) {
    if (!m.tokens) continue
    tokens.input += m.tokens.input
    tokens.output += m.tokens.output
    tokens.cacheRead += m.tokens.cacheRead
    tokens.cacheWrite += m.tokens.cacheWrite
  }
  return { messageCount: messages.length, tokens }
}

/**
 * A REAL in-process Map-backed chat store. The local ChatService is built over
 * this — it persists user + assistant ChatMessages and lists/renames/deletes
 * sessions, all in-process. Every method is real (no vi.fn).
 */
export class InProcessChatStore {
  private readonly byId = new Map<string, StoredSession>()

  /** Mint a session with a uuid() id + ISO timestamps. */
  createSession(opts: CreateSessionRow = {}): SessionSummary {
    const now = new Date().toISOString()
    const session: SessionSummary = {
      id: uuid(),
      title: opts.title ?? null,
      created_at: now,
      updated_at: now,
    }
    this.byId.set(session.id, { session, messages: [] })
    return session
  }

  /** List session summaries, newest-first by updated_at (ISO sorts lexically). */
  listSessions(): SessionSummary[] {
    return [...this.byId.values()]
      .map((s) => s.session)
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }

  /** Read a session + its messages, or throw if absent (an honest error). */
  getSession(id: string): { session: SessionSummary; messages: ChatMessage[] } {
    const stored = this.byId.get(id)
    if (!stored) throw new Error(`InProcessChatStore: no session ${id}`)
    // Defensive copies — callers fold/derive over these, never mutate the store.
    return { session: stored.session, messages: [...stored.messages] }
  }

  /**
   * Replace the session's messages from `fromOrdinal` with `incoming` (the
   * upsert primitive — mirrors the production ChatStore.upsertMessages, which
   * replaces a tail by ordinal). Bumps updated_at. Throws if the session is gone.
   */
  upsertMessages(id: string, fromOrdinal: number, incoming: ChatMessage[]): void {
    const stored = this.byId.get(id)
    if (!stored) throw new Error(`InProcessChatStore: no session ${id}`)
    const head = stored.messages.slice(0, Math.max(0, fromOrdinal))
    stored.messages = [...head, ...incoming]
    stored.session = { ...stored.session, updated_at: new Date().toISOString() }
  }

  /** Append messages to the tail (sugar over upsertMessages at the end). */
  appendMessages(id: string, incoming: ChatMessage[]): void {
    const stored = this.byId.get(id)
    if (!stored) throw new Error(`InProcessChatStore: no session ${id}`)
    this.upsertMessages(id, stored.messages.length, incoming)
  }

  /** Patch a session's title (the renameSession path — NOT on garden's ChatBackend). */
  patchSession(id: string, title: string): SessionSummary {
    const stored = this.byId.get(id)
    if (!stored) throw new Error(`InProcessChatStore: no session ${id}`)
    stored.session = { ...stored.session, title, updated_at: new Date().toISOString() }
    return stored.session
  }

  /** Delete a session (and its messages). */
  deleteSession(id: string): void {
    this.byId.delete(id)
  }

  /** Fold token aggregates for a session (LOCAL re-derivation over TokenUsage). */
  aggregates(id: string): SessionAggregates {
    return computeAggregates(this.getSession(id).messages)
  }
}
