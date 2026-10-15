/**
 * conversation-archive-view.ts — the templates of the Chat history drawer.
 *
 * This file replaces the old <sh-conversation-archive> element (a separate raw
 * viewer with its own shadow root, its own fetch path and its own dead ends). The
 * drawer is now ONE surface, drawn by <sh-chat-host> in its own update cycle from
 * plain data (the controllers in chat-services/):
 *
 *   renderConversationHome   every conversation in one list, by real date
 *   renderImportedReader     an imported conversation, read in <sh-chat-panel>
 *                            (transcript-only), with its provenance and its family
 *   renderSaveDialog         Save to Garden and Download as Markdown
 *
 * Because everything renders in the host's own shadow tree, the drawer's Tab trap
 * sees every control, including the ones inside the reader's transcript.
 *
 * Doctrine carried here: a title, a message, a tool output is DATA. Every string
 * from a conversation is drawn through a text binding (never as markup), and the
 * only markup a conversation's words ever reach is the kernel's sanitized
 * Markdown. The archive's internal label (`cloud1-opencode-archive`) is never
 * shown as a name, a workspace or a search key.
 */

import { css, html, nothing, type TemplateResult } from 'lit'
import type { ChatMessage, CodeCopyIntent, MessageActionKind, MessageActionResult } from '@shrubbery/chat-kernel'
import type { ProjectedTranscript } from '../chat-services/archive-projection.js'
import type { ArchivedConversation } from '../chat-services/conversation-archive.js'
import type { ConversationFamily, ConversationHomeView } from '../chat-services/conversation-home-controller.js'
import {
  IMPORTED_PROVENANCE,
  VOICE_GLYPH,
  displayTitle,
  formatRelativeDate,
  modelVoiceLabel,
  type ConversationRow,
  type HomeFilter,
} from '../chat-services/conversation-home.js'
import type { ImportedReaderHeader, ImportedReaderState } from '../chat-services/imported-reader.js'
import { SAVE_TO_GARDEN_INTRO, saveToGardenCopy, type SaveFlowState } from '../chat-services/save-flow.js'

// ── the list ───────────────────────────────────────────────────────────────

export interface HomeActions {
  search(query: string): void
  filter(filter: HomeFilter): void
  toggleChildren(conversationId: string): void
  selectLive(id: string): void
  openImported(conversationId: string): void
  startRename(id: string, rawTitle: string | null): void
  editTitle(value: string): void
  commitRename(id: string): void
  cancelRename(): void
  deleteLive(id: string): void
  /** Duplicate a live conversation; absent where the chat cannot (the row then has no Duplicate). */
  duplicateLive?(id: string): void
  retryLive(): void
  retryImported(): void
  dismissNotice(): void
  loadMore(): void
}

export interface HomeRenderContext {
  readonly view: ConversationHomeView
  readonly query: string
  readonly filter: HomeFilter
  readonly expanded: ReadonlySet<string>
  readonly now: number
  readonly activeSessionId: string | null
  readonly editingId: string | null
  readonly editingTitle: string
  /** A failed select, create, rename or delete. */
  readonly actionError: string | null
  readonly actions: HomeActions
}

const FILTERS: ReadonlyArray<readonly [HomeFilter, string]> = [
  ['all', 'All'],
  ['live', 'Current'],
  ['imported', 'Imported'],
]

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** 'Yesterday · 4 messages · ∿ Kimi K2.5': every piece is recorded, or absent, or said to be absent. */
function metaLine(ctx: HomeRenderContext, row: ConversationRow): string {
  const pieces = [formatRelativeDate(row.dateIso, ctx.now) ?? 'No date recorded']
  if (row.kind === 'imported' && row.messageCount !== null) pieces.push(plural(row.messageCount, 'message', 'messages'))
  const voice = modelVoiceLabel(row.models)
  if (voice) pieces.push(`${VOICE_GLYPH} ${voice}`)
  return pieces.join(' · ')
}

function renderLiveRow(ctx: HomeRenderContext, row: ConversationRow): TemplateResult {
  const active = ctx.activeSessionId === row.id
  if (ctx.editingId === row.id) {
    return html`
      <div class="history-row" data-chat-history-row=${row.id} data-chat-history-kind="live" ?data-active=${active}>
        <div class="history-inline">
          <input
            class="history-input"
            data-chat-history-rename-input
            placeholder="Untitled chat"
            .value=${ctx.editingTitle}
            @input=${(event: Event) => ctx.actions.editTitle((event.target as HTMLInputElement).value)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                ctx.actions.commitRename(row.id)
              } else if (event.key === 'Escape') {
                // Escape ends the edit and nothing more: the drawer stays.
                event.preventDefault()
                event.stopPropagation()
                ctx.actions.cancelRename()
              }
            }}
            aria-label="Session title"
          />
          <button type="button" class="history-button" data-chat-history-rename-save @click=${() => ctx.actions.commitRename(row.id)}>Save</button>
          <button type="button" class="history-button" data-chat-history-rename-cancel @click=${() => ctx.actions.cancelRename()}>Cancel</button>
        </div>
      </div>
    `
  }
  const duplicate = ctx.actions.duplicateLive
  const lineage = row.live?.branchedFrom
  return html`
    <div class="history-row" data-chat-history-row=${row.id} data-chat-history-kind="live" ?data-active=${active} ?data-chat-history-duplicable=${Boolean(duplicate)}>
      <button type="button" class="history-select" data-chat-history-select=${row.id} @click=${() => ctx.actions.selectLive(row.id)}>
        <span class="history-name">${row.title}</span>
        <span class="history-meta">${metaLine(ctx, row)}</span>
        ${lineage
          ? html`<span class="history-lineage" data-chat-history-lineage=${lineage.id}>↳ ${lineage.kind === 'clone' ? 'duplicated' : 'branched'} from ${lineage.title ?? 'a deleted conversation'}</span>`
          : nothing}
      </button>
      ${duplicate
        ? html`<button
            type="button"
            class="history-button"
            data-chat-history-duplicate=${row.id}
            title="Duplicate chat"
            aria-label="Duplicate ${row.title}"
            @click=${() => duplicate(row.id)}
          >Duplicate</button>`
        : nothing}
      <button
        type="button"
        class="history-button"
        data-chat-history-rename=${row.id}
        title="Rename chat"
        aria-label="Rename ${row.title}"
        @click=${() => ctx.actions.startRename(row.id, row.live?.title ?? null)}
      >Rename</button>
      <button
        type="button"
        class="history-button"
        data-chat-history-delete=${row.id}
        title="Delete chat"
        aria-label="Delete ${row.title}"
        @click=${() => ctx.actions.deleteLive(row.id)}
      >Delete</button>
    </div>
  `
}

function renderImportedRow(ctx: HomeRenderContext, row: ConversationRow, child: boolean): TemplateResult {
  return html`
    <div class="history-row history-row-imported" data-chat-history-row=${row.id} data-chat-history-kind="imported" ?data-chat-history-child=${child}>
      <button type="button" class="history-select" data-chat-history-open=${row.id} @click=${() => ctx.actions.openImported(row.id)}>
        <span class="history-name">${row.title}</span>
        <span class="history-meta">${metaLine(ctx, row)}</span>
        <span class="history-provenance">${IMPORTED_PROVENANCE}</span>
      </button>
    </div>
  `
}

function renderGroup(ctx: HomeRenderContext, row: ConversationRow): TemplateResult {
  const children = row.children
  const open = children.length > 0 && ctx.expanded.has(row.id)
  return html`
    <div class="history-group" role="listitem">
      ${row.kind === 'live' ? renderLiveRow(ctx, row) : renderImportedRow(ctx, row, false)}
      ${children.length > 0
        ? html`<button
            type="button"
            class="history-children-toggle"
            data-chat-history-children=${row.id}
            aria-expanded=${open ? 'true' : 'false'}
            @click=${() => ctx.actions.toggleChildren(row.id)}
          >${plural(children.length, 'sub-agent conversation', 'sub-agent conversations')}</button>`
        : nothing}
      ${open ? children.map(child => renderImportedRow(ctx, child, true)) : nothing}
    </div>
  `
}

function renderTools(ctx: HomeRenderContext): TemplateResult | typeof nothing {
  const { view } = ctx
  // Nothing to search or filter until something is listed (or a search is under way).
  if (view.list.total === 0 && ctx.query.trim() === '') return nothing
  return html`
    <div class="history-tools">
      <input
        class="history-input history-search"
        type="search"
        data-chat-history-search
        aria-label="Search chat titles"
        placeholder="Search titles"
        autocomplete="off"
        .value=${ctx.query}
        @input=${(event: Event) => ctx.actions.search((event.target as HTMLInputElement).value)}
      />
      ${view.showFilter
        ? html`<div class="history-filter" role="group" aria-label="Show" data-chat-history-filter>
            ${FILTERS.map(([value, label]) => html`<button
              type="button"
              class="history-chip"
              data-chat-history-filter-option=${value}
              aria-pressed=${ctx.filter === value ? 'true' : 'false'}
              @click=${() => ctx.actions.filter(value)}
            >${label}</button>`)}
          </div>`
        : nothing}
    </div>
  `
}

function renderNotice(ctx: HomeRenderContext): TemplateResult | typeof nothing {
  const notice = ctx.view.notice
  if (!notice) return nothing
  return html`
    <div class="history-notice" data-chat-history-notice data-kind=${notice.kind} role="status">
      <strong class="history-notice-title">${notice.title}</strong>
      <span class="history-notice-detail">${notice.detail}</span>
      <span class="history-notice-actions">
        ${notice.retryable
          ? html`<button type="button" class="history-button" data-chat-history-notice-retry @click=${() => ctx.actions.retryImported()}>Try again</button>`
          : html`<button type="button" class="history-button" data-chat-history-notice-dismiss @click=${() => ctx.actions.dismissNotice()}>Dismiss</button>`}
      </span>
    </div>
  `
}

function renderListBody(ctx: HomeRenderContext): TemplateResult | typeof nothing {
  const { view } = ctx
  if (view.loadingFirst) return html`<div class="history-status" role="status">Loading your chats…</div>`
  if (view.empty) return html`<p class="history-status" data-chat-history-empty>No chats yet. Choose New to start one.</p>`
  const query = ctx.query.trim()
  if (view.list.rows.length === 0) {
    return query ? html`<p class="history-status" data-chat-history-empty>No chats match “${query}”.</p>` : nothing
  }
  return html`
    <div class="home-slot">
      ${view.searchNote ? html`<p class="history-note" data-chat-history-search-note>${view.searchNote}</p>` : nothing}
      <div class="history-list" role="list">
        ${view.list.rows.map(row => renderGroup(ctx, row))}
      </div>
      ${view.canLoadMore
        ? html`<div class="history-more-row">
            <button type="button" class="history-button history-more" data-chat-history-more ?disabled=${view.loadingMore} @click=${() => ctx.actions.loadMore()}>
              ${view.loadingMore ? 'Loading…' : 'Load older chats'}
            </button>
          </div>`
        : nothing}
    </div>
  `
}

export function renderConversationHome(ctx: HomeRenderContext): TemplateResult {
  const { view } = ctx
  return html`
    <div class="history-body" data-history-view="list">
      ${renderTools(ctx)}
      ${ctx.actionError ? html`<div class="history-status error" role="alert">${ctx.actionError}</div>` : nothing}
      ${view.liveError
        ? html`<div class="history-status error" role="alert" data-chat-history-live-error>
            Your chats could not be listed: ${view.liveError}
            <button type="button" class="history-button" data-chat-history-live-retry @click=${() => ctx.actions.retryLive()}>Try again</button>
          </div>`
        : nothing}
      ${renderNotice(ctx)}
      ${renderListBody(ctx)}
    </div>
  `
}

// ── the reader ─────────────────────────────────────────────────────────────

export interface ReaderActions {
  back(): void
  retry(): void
  loadMore(): void
  switchRevision(revisionId: string): void
  open(conversationId: string): void
  continueConversation(): void
  save(invoker: HTMLElement | null): void
  download(): void
}

export interface ReaderRenderContext {
  readonly state: ImportedReaderState
  readonly header: ImportedReaderHeader
  readonly transcript: ProjectedTranscript
  readonly annotate: (message: ChatMessage) => string | null
  readonly family: ConversationFamily
  /** The conversation says it was started by another one that is not loaded. */
  readonly startedByUnloaded: boolean
  readonly now: number
  readonly continueAvailable: boolean
  /** A failed Continue or download. */
  readonly actionError: string | null
  /** Something in progress or just done that is worth a line ("Preparing the download…"). */
  readonly actionNote: string | null
  readonly messageActions: readonly MessageActionKind[]
  readonly onMessageAction: (messageId: string, action: MessageActionKind) => Promise<MessageActionResult>
  readonly onCodeCopy: (intent: CodeCopyIntent) => Promise<void>
  readonly actions: ReaderActions
}

function familyTitle(item: ArchivedConversation): string {
  return displayTitle(item.revision.title, 'imported')
}

function renderFamily(ctx: ReaderRenderContext): TemplateResult | typeof nothing {
  const { family } = ctx
  const parent = family.parent
  return html`
    <div class="home-slot">
    ${parent
      ? html`<p class="history-reader-family">
          <button type="button" class="history-link" data-chat-reader-parent @click=${() => ctx.actions.open(parent.conversationId)}>
            Started by ${familyTitle(parent)}
          </button>
        </p>`
      : ctx.startedByUnloaded
        ? html`<p class="history-reader-family">Started by another conversation that is not loaded here.</p>`
        : nothing}
    ${family.children.length > 0
      ? html`<div class="history-reader-family" data-chat-reader-children>
          <p class="history-reader-family-title">${plural(family.children.length, 'sub-agent conversation', 'sub-agent conversations')}</p>
          <ul class="history-reader-children">
            ${family.children.map(child => html`<li>
              <button type="button" class="history-link" data-chat-reader-child=${child.conversationId} @click=${() => ctx.actions.open(child.conversationId)}>
                ${familyTitle(child)}
                <span class="history-meta">${formatRelativeDate(child.lastOccurredAt ?? child.firstOccurredAt ?? null, ctx.now) ?? 'No date recorded'}</span>
              </button>
            </li>`)}
          </ul>
        </div>`
      : nothing}
    </div>
  `
}

function renderReaderStatus(ctx: ReaderRenderContext): TemplateResult | typeof nothing {
  const { state } = ctx
  if (state.status === 'loading') return html`<div class="history-status" role="status" data-chat-reader-loading>Loading this conversation…</div>`
  if (state.status === 'error' && state.failure) {
    return html`
      <div class="history-status error" role="alert" data-chat-reader-error>
        <strong>${state.failure.title}.</strong> ${state.failure.detail}
        ${state.failure.retryable
          ? html`<button type="button" class="history-button" data-chat-reader-retry @click=${() => ctx.actions.retry()}>Try again</button>`
          : nothing}
      </div>
    `
  }
  return nothing
}

export function renderImportedReader(ctx: ReaderRenderContext): TemplateResult {
  const { state, header } = ctx
  const voices = header.voices
    ? `${header.voices.includes(',') ? 'Voices' : 'Voice'}: ${header.voices}`
    : 'Voice not recorded'
  return html`
    <div class="history-body history-reader" data-history-view="reader" data-chat-reader data-status=${state.status}>
      <div class="history-reader-bar">
        <button type="button" class="history-button" data-chat-reader-back @click=${() => ctx.actions.back()}>← Chats</button>
        <div class="history-reader-actions">
          ${ctx.continueAvailable
            ? html`<button type="button" class="history-button history-primary" data-chat-reader-continue @click=${() => ctx.actions.continueConversation()}>Continue with…</button>`
            : nothing}
          <button type="button" class="history-button" data-chat-reader-save @click=${(event: Event) => ctx.actions.save(event.currentTarget as HTMLElement)}>Save to Garden</button>
          <button type="button" class="history-button" data-chat-reader-download @click=${() => ctx.actions.download()}>Download as Markdown</button>
        </div>
      </div>
      <div class="history-reader-head">
        <h3 class="history-reader-title" data-chat-reader-title>${header.title}</h3>
        <p class="history-reader-provenance" data-chat-reader-provenance>${header.provenance}</p>
        <p class="history-reader-meta">
          ${header.range ? html`<span data-chat-reader-range>${header.range}</span>` : nothing}
          <span data-chat-reader-voices>${voices}</span>
          <span data-chat-reader-count>${header.countLine}</span>
        </p>
        ${state.revisions.length > 1
          ? html`<label class="history-reader-revision">
              <span>Version</span>
              <select
                class="history-input"
                data-chat-reader-revision
                aria-label="Imported revision"
                .value=${state.revisionId}
                ?disabled=${state.status === 'loading'}
                @change=${(event: Event) => ctx.actions.switchRevision((event.target as HTMLSelectElement).value)}
              >
                ${state.revisions.map((revision, index) => html`<option value=${revision.revisionId} ?selected=${revision.revisionId === state.revisionId}>
                  Revision ${index + 1} · ${plural(revision.messageCount, 'message', 'messages')}
                </option>`)}
              </select>
            </label>`
          : nothing}
        ${renderFamily(ctx)}
        ${state.status === 'ready' && header.note ? html`<p class="history-reader-note" data-chat-reader-note>${header.note}</p>` : nothing}
        ${ctx.actionNote ? html`<p class="history-reader-note" role="status" data-chat-reader-status>${ctx.actionNote}</p>` : nothing}
        ${ctx.actionError ? html`<p class="history-status error" role="alert" data-chat-reader-action-error>${ctx.actionError}</p>` : nothing}
      </div>
      ${renderReaderStatus(ctx)}
      ${state.status === 'ready'
        ? html`
            <div class="home-slot">
            <div class="history-reader-body">
              <sh-chat-panel
                class="history-reader-panel"
                role="region"
                aria-label="Imported conversation"
                .assistantLabel=${'Assistant'}
                .transcriptOnly=${true}
                .readOnly=${true}
                .messages=${ctx.transcript.messages}
                .messageActions=${ctx.messageActions}
                .formatModelAnnotation=${ctx.annotate}
                .onMessageAction=${ctx.onMessageAction}
                .onCodeCopy=${ctx.onCodeCopy}
              ></sh-chat-panel>
            </div>
            ${state.moreFailure
              ? html`<div class="history-status error" role="alert" data-chat-reader-more-error>
                  <strong>${state.moreFailure.title}.</strong> The rest of this conversation is not loaded.
                  <button type="button" class="history-button" data-chat-reader-more-retry @click=${() => ctx.actions.loadMore()}>Try again</button>
                </div>`
              : nothing}
            ${state.nextCursor !== null
              ? html`<div class="history-more-row">
                  <button type="button" class="history-button history-reader-more" data-chat-reader-more ?disabled=${state.loadingMore} @click=${() => ctx.actions.loadMore()}>
                    ${state.loadingMore ? 'Loading…' : 'Load more messages'}
                  </button>
                </div>`
              : nothing}
            </div>
          `
        : nothing}
    </div>
  `
}

// ── save and download ──────────────────────────────────────────────────────

export interface SaveDialogActions {
  select(graphId: string): void
  confirm(): void
  download(): void
  cancelReading(): void
  retryTargets(): void
  open(): void
  close(): void
  keydown(event: KeyboardEvent): void
}

export interface SaveDialogContext {
  readonly state: SaveFlowState
  /** A way to save into a workspace exists. Without one only the download is offered. */
  readonly hasPort: boolean
  /** A saved copy can be opened from here. */
  readonly canOpen: boolean
  readonly actions: SaveDialogActions
}

const progressWords = (state: SaveFlowState): string =>
  state.progress ? ` ${state.progress.loaded.toLocaleString('en-US')} of ${state.progress.total.toLocaleString('en-US')} messages.` : ''

function renderChoices(ctx: SaveDialogContext): TemplateResult {
  const { state } = ctx
  if (!ctx.hasPort) {
    return html`<p class="save-none" data-chat-save-none>Saving into a workspace is not available here.</p>`
  }
  if (state.targetsError) {
    return html`<p class="save-status error" role="alert" data-chat-save-status>
      Your workspaces could not be listed: ${state.targetsError}
      <button type="button" class="history-button" data-chat-save-targets-retry @click=${() => ctx.actions.retryTargets()}>Try again</button>
    </p>`
  }
  if (state.targets === null) return html`<p class="save-status" role="status" data-chat-save-loading>Looking for your workspaces…</p>`
  if (state.targets.length === 0) {
    return html`<p class="save-none" data-chat-save-none>You do not have a workspace you can write to yet.</p>`
  }
  const chosen = state.targets.find(target => target.graphId === state.selected) ?? null
  return html`
    <div class="home-slot">
    <fieldset class="save-choices">
      <legend class="save-intro">${SAVE_TO_GARDEN_INTRO}</legend>
      ${state.targets.map(target => html`<label class="save-choice">
        <input
          type="radio"
          name="chat-save-target"
          data-chat-save-target=${target.graphId}
          .checked=${state.selected === target.graphId}
          @change=${() => ctx.actions.select(target.graphId)}
        />
        <span>${target.title}</span>
      </label>`)}
    </fieldset>
    ${chosen ? html`<p class="save-copy" data-chat-save-copy>${saveToGardenCopy(chosen.title)}</p>` : nothing}
    </div>
  `
}

export function renderSaveDialog(ctx: SaveDialogContext): TemplateResult {
  const { state } = ctx
  const busy = state.phase === 'preparing' || state.phase === 'saving'
  const result = state.phase === 'saved' ? state.result : null
  return html`
    <div class="save-backdrop" data-chat-save-backdrop @click=${() => ctx.actions.close()}>
      <section
        class="save-dialog"
        data-chat-save-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-save-title"
        tabindex="-1"
        @keydown=${(event: KeyboardEvent) => ctx.actions.keydown(event)}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <h2 class="save-title" id="chat-save-title">Save to Garden</h2>
        ${result
          ? html`
              <div class="home-slot">
              <p class="save-status" role="status" data-chat-save-status>
                Saved to ${result.workspaceTitle}${result.documentIds.length > 1 ? ` as ${result.documentIds.length} documents` : ''}.
              </p>
              <div class="save-actions">
                ${ctx.canOpen ? html`<button type="button" class="history-button history-primary" data-chat-save-open @click=${() => ctx.actions.open()}>Open</button>` : nothing}
                <button type="button" class="history-button" data-chat-save-close @click=${() => ctx.actions.close()}>Done</button>
              </div>
              </div>
            `
          : html`
              <div class="home-slot">
              ${renderChoices(ctx)}
              ${state.phase === 'preparing'
                ? html`<p class="save-status" role="status" data-chat-save-status>
                    Reading the conversation…${progressWords(state)}
                    <button type="button" class="history-button" data-chat-save-cancel @click=${() => ctx.actions.cancelReading()}>Stop</button>
                  </p>`
                : nothing}
              ${state.phase === 'saving' ? html`<p class="save-status" role="status" data-chat-save-status>Saving…</p>` : nothing}
              ${state.error && !busy ? html`<p class="save-status error" role="alert" data-chat-save-status>${state.error}</p>` : nothing}
              ${state.downloaded ? html`<p class="save-status" role="status" data-chat-save-downloaded>Downloaded ${state.downloaded}.</p>` : nothing}
              <div class="save-actions">
                ${ctx.hasPort && state.targets !== null && state.targets.length > 0
                  ? html`<button
                      type="button"
                      class="history-button history-primary"
                      data-chat-save-confirm
                      ?disabled=${busy || state.selected === null}
                      @click=${() => ctx.actions.confirm()}
                    >Save copy</button>`
                  : nothing}
                <button type="button" class="history-button" data-chat-save-download ?disabled=${busy} @click=${() => ctx.actions.download()}>Download as Markdown</button>
                <button type="button" class="history-button" data-chat-save-close @click=${() => ctx.actions.close()}>Close</button>
              </div>
              </div>
            `}
      </section>
    </div>
  `
}

// ── styles ─────────────────────────────────────────────────────────────────

export const conversationHomeStyles = css`
  /* A wrapper that exists only so that no child binding sits at the top level of a template
     (happy-dom, where the tests run, mis-places those markers). It draws nothing of its own. */
  .home-slot {
    display: contents;
  }
  .history-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .history-tools {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem 0.75rem 0;
  }
  .history-search {
    width: 100%;
    box-sizing: border-box;
    min-height: 36px;
  }
  .history-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .history-chip {
    min-height: 32px;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--mn-garden-control-edge, var(--mn-color-border-subtle, #d8ded9));
    border-radius: 999px;
    background: var(--mn-garden-control-bg, var(--mn-color-surface-raised, #fff));
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    line-height: 1;
  }
  .history-chip[aria-pressed='true'] {
    border-color: var(--mn-color-text-accent-strong, #2d6a4f);
    background: var(--mn-color-text-accent-strong, #2d6a4f);
    color: var(--mn-color-surface-raised, #fff);
    font-weight: 650;
  }
  .history-chip:focus-visible,
  .history-children-toggle:focus-visible,
  .history-link:focus-visible,
  .save-choice:focus-within {
    outline: 2px solid var(--mn-focus-ring-color, #376d57);
    outline-offset: 2px;
  }
  .history-note {
    margin: 0.5rem 0.75rem 0;
    color: var(--mn-color-text-secondary, #4b5563);
    font-size: 0.75rem;
  }
  .history-notice {
    display: grid;
    gap: 0.3rem;
    margin: 0.75rem 0.75rem 0;
    padding: 0.75rem;
    border: 1px solid var(--mn-color-border-subtle, #d8ded9);
    border-radius: 12px;
    background: var(--mn-color-surface-raised, #fff);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .history-notice-title {
    font-weight: 650;
  }
  .history-notice-detail {
    color: var(--mn-color-text-secondary, #4b5563);
  }
  .history-notice-actions {
    display: flex;
    gap: 0.375rem;
  }
  .history-group {
    display: block;
  }
  .history-row-imported {
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
  }
  .history-row[data-chat-history-child] {
    margin-left: 1.25rem;
  }
  .history-row[data-chat-history-duplicable] {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }
  .history-row[data-chat-history-duplicable] > [data-chat-history-duplicate] { grid-column: 2; }
  .history-row[data-chat-history-duplicable] > [data-chat-history-rename] { grid-column: 3; }
  .history-row[data-chat-history-duplicable] > [data-chat-history-delete] { grid-column: 4; }
  .history-lineage {
    display: block;
    overflow: hidden;
    margin-top: 0.125rem;
    color: var(--mn-color-text-muted, #66736a);
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-provenance {
    display: block;
    margin-top: 0.125rem;
    color: var(--mn-color-text-muted, #66736a);
    font-size: 0.68rem;
    letter-spacing: 0.02em;
  }
  .history-children-toggle,
  .history-link {
    display: inline-block;
    max-width: 100%;
    margin: 0 0 0.5rem 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    background: transparent;
    color: var(--mn-color-text-accent-strong, #2d6a4f);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    text-align: left;
    text-decoration: underline;
  }
  .history-more-row {
    padding: 0 0.75rem 0.75rem;
  }
  .history-primary {
    border-color: var(--mn-color-text-accent-strong, #2d6a4f);
    background: var(--mn-color-text-accent-strong, #2d6a4f);
    color: var(--mn-color-surface-raised, #fff);
    font-weight: 650;
  }
  .history-button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  .history-reader {
    overflow: hidden;
  }
  .history-reader-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
  }
  .history-reader-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .history-reader-head {
    flex: 0 0 auto;
    max-height: 45%;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9);
  }
  .history-reader-title {
    margin: 0;
    font: 650 1.05rem/1.25 var(--mn-font-display, Georgia, serif);
    overflow-wrap: anywhere;
  }
  .history-reader-provenance {
    margin: 0.25rem 0 0;
    color: var(--mn-color-text-muted, #66736a);
    font-size: 0.75rem;
  }
  .history-reader-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin: 0.375rem 0 0;
    color: var(--mn-color-text-secondary, #4b5563);
    font-size: 0.75rem;
  }
  .history-reader-note {
    margin: 0.5rem 0 0;
    color: var(--mn-color-text-secondary, #4b5563);
    font-size: 0.75rem;
    line-height: 1.45;
  }
  .history-reader-family {
    margin: 0.5rem 0 0;
    font-size: 0.75rem;
  }
  .history-reader-family-title {
    margin: 0;
    color: var(--mn-color-text-secondary, #4b5563);
  }
  .history-reader-children {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .history-reader-revision {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.75rem;
  }
  .history-reader-body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }
  .history-reader-body > sh-chat-panel {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  .save-backdrop {
    position: absolute;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--mn-color-backdrop, rgb(18 32 23 / 0.24));
  }
  .save-dialog {
    display: grid;
    gap: 0.75rem;
    width: min(28rem, 100%);
    max-height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding: 1.25rem;
    border: 1px solid var(--mn-color-border-subtle, #d8ded9);
    border-radius: 16px;
    background: var(--mn-color-surface-panel, var(--mn-color-surface-base, #fff));
    box-shadow: var(--mn-shadow-modal, 0 20px 48px rgb(15 30 20 / 0.22));
    color: var(--mn-color-text-primary, #18211b);
    font-family: var(--mn-font-chrome, system-ui, sans-serif);
  }
  .save-dialog:focus-visible {
    outline: 2px solid var(--mn-focus-ring-color, #376d57);
    outline-offset: 2px;
  }
  .save-title {
    margin: 0;
    font: 650 1.15rem/1.15 var(--mn-font-display, Georgia, serif);
  }
  .save-choices {
    display: grid;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .save-intro,
  .save-copy,
  .save-none,
  .save-status {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .save-copy {
    color: var(--mn-color-text-secondary, #4b5563);
  }
  .save-status.error {
    color: var(--mn-color-danger-text, #b42318);
  }
  .save-choice {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--mn-color-border-subtle, #d8ded9);
    border-radius: 10px;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .save-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.375rem;
  }
  @media (max-width: 600px), (pointer: coarse) {
    .history-button,
    .history-chip,
    .history-select,
    .history-input,
    .history-more,
    .history-notice button,
    .history-children-toggle,
    .history-link,
    .history-reader-bar .history-button,
    .save-choice,
    .save-dialog .history-button,
    .history-drawer sh-chat-panel .message-action-btn,
    .history-drawer sh-chat-panel .tool-call-header,
    .history-drawer sh-chat-panel .reasoning-header,
    .history-drawer sh-chat-panel .code-copy-btn {
      min-height: 44px;
    }
    .history-button.icon,
    .history-drawer sh-chat-panel .message-action-btn,
    .history-drawer sh-chat-panel .code-copy-btn {
      min-width: 44px;
    }
    .history-reader-head {
      max-height: 40%;
    }
  }
`
