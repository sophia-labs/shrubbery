import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import {
  canonicalJson,
  createIngestionRunRequest,
  draftDiscordIngestionPolicy,
  draftOperationsControl,
  type PhanesControlApi,
  type PhanesControlBundle,
  type PhanesControlDocument,
  type PhanesDiscordChannel,
  type PhanesDiscordIngestionControl,
  type PhanesDiscordIngestionPolicy,
  type PhanesOperations,
  type PhanesOperationsControl,
} from './phanes-control-api.js'
import { icon, iconStyles } from '@shrubbery/components'
import { registerRenderableComponentTags } from '@shrubbery/nucleus'

type EditorMode = 'operations' | 'copy' | 'flow-json' | 'channels'

// This app-owned element is an admitted Class-A Shrubbery surface. Registering
// it in trusted code is what lets the graph-authored Phanes WorkspaceConfig
// cross the graph -> DOM gate; an RDF document cannot register arbitrary tags.
registerRenderableComponentTags(['mn-phanes-control-editor'])

@customElement('mn-phanes-control-editor')
export class MnPhanesControlEditor extends LitElement {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      color: var(--mn-color-text-primary);
    }

    :host([workspace-surface]) {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      padding: clamp(var(--mn-space-4), 3vw, var(--mn-space-8));
      overflow: auto;
      background: var(--mn-color-surface-canvas, var(--mn-color-bg-default));
    }

    .editor-root {
      display: block;
      min-width: 0;
      max-width: 1440px;
      margin: 0 auto;
    }

    .surface-header {
      margin-bottom: var(--mn-space-6);
    }

    .surface-header h1 {
      margin: 0 0 var(--mn-space-2);
      color: var(--mn-color-text-primary);
      font-family: var(--mn-font-serif);
      font-size: clamp(1.35rem, 2vw, 1.9rem);
      font-weight: 600;
    }

    .surface-header p {
      max-width: 78ch;
      margin: 0;
      color: var(--mn-color-text-secondary);
      line-height: 1.55;
    }

    .description,
    .note {
      color: var(--mn-color-text-secondary);
      font-family: var(--mn-font-sans);
      line-height: 1.55;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2);
      flex-wrap: wrap;
      margin-bottom: var(--mn-space-5);
    }

    button,
    input,
    textarea {
      font: inherit;
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-2);
      padding: var(--mn-space-2) var(--mn-space-4);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-md);
      background: transparent;
      color: var(--mn-color-text-secondary);
      cursor: pointer;
    }

    button.primary,
    button.active {
      border-color: var(--mn-color-border-accent);
      background: var(--mn-color-surface-accent);
      color: var(--mn-color-text-accent-strong);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .spacer {
      flex: 1;
    }

    .search {
      min-width: 230px;
      padding: var(--mn-space-2) var(--mn-space-3);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-md);
      background: transparent;
      color: var(--mn-color-text-primary);
    }

    .status {
      display: flex;
      gap: var(--mn-space-3);
      align-items: center;
      padding: var(--mn-space-3) var(--mn-space-4);
      margin-bottom: var(--mn-space-5);
      border-left: 3px solid var(--mn-color-border-accent);
      background: var(--mn-color-surface-accent);
      color: var(--mn-color-text-secondary);
      font-family: var(--mn-font-sans);
      font-size: var(--mn-text-sm);
    }

    .status.error {
      border-left-color: var(--mn-color-danger-border);
      background: var(--mn-color-danger-surface);
      color: var(--mn-color-text-danger);
    }

    .catalog {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4);
    }

    .message-card,
    .flow-card,
    .operations-card {
      padding: var(--mn-space-4);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-lg);
      background: var(--mn-color-surface-elevated, transparent);
    }

    .message-heading,
    .flow-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-3);
      margin-bottom: var(--mn-space-2);
    }

    .key {
      font-family: var(--mn-font-mono);
      font-size: var(--mn-text-sm);
      color: var(--mn-color-text-primary);
    }

    .surface,
    .revision {
      font-family: var(--mn-font-utility);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mn-color-text-tertiary);
    }

    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 76px;
      resize: vertical;
      padding: var(--mn-space-3);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-md);
      background: var(--mn-color-bg-default, transparent);
      color: var(--mn-color-text-primary);
      line-height: 1.45;
    }

    textarea:focus,
    input:focus {
      outline: 2px solid var(--mn-color-border-focus);
      outline-offset: 1px;
    }

    .template-meta {
      display: flex;
      justify-content: space-between;
      gap: var(--mn-space-3);
      margin-top: var(--mn-space-2);
      color: var(--mn-color-text-tertiary);
      font-family: var(--mn-font-sans);
      font-size: var(--mn-text-xs);
    }

    .raw-editor {
      min-height: 560px;
      font-family: var(--mn-font-mono);
      font-size: 0.78rem;
      white-space: pre;
      tab-size: 2;
    }

    .flow-grid {
      display: grid;
      gap: var(--mn-space-3);
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-bottom: var(--mn-space-5);
    }

    .flow-card ul {
      margin: var(--mn-space-2) 0 0;
      padding-left: var(--mn-space-5);
      color: var(--mn-color-text-secondary);
      font-size: var(--mn-text-sm);
    }

    .policy-card {
      padding: var(--mn-space-5);
      margin-bottom: var(--mn-space-5);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-lg);
      background: var(--mn-color-surface-elevated, transparent);
    }

    .policy-toggle,
    .channel-row {
      display: flex;
      gap: var(--mn-space-3);
      align-items: flex-start;
    }

    .policy-toggle {
      font-weight: 600;
      color: var(--mn-color-text-primary);
    }

    .policy-toggle input,
    .channel-row input {
      margin-top: 0.2rem;
      accent-color: var(--mn-color-text-accent-strong);
    }

    .safety-note {
      margin: var(--mn-space-4) 0 0;
      padding: var(--mn-space-3) var(--mn-space-4);
      border-left: 3px solid var(--mn-color-border-accent);
      background: var(--mn-color-surface-accent);
      color: var(--mn-color-text-secondary);
      line-height: 1.5;
    }

    .channel-grid {
      display: grid;
      gap: var(--mn-space-3);
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }

    .channel-row {
      padding: var(--mn-space-4);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-md);
      background: var(--mn-color-surface-elevated, transparent);
    }

    .channel-copy {
      min-width: 0;
    }

    .channel-name {
      display: block;
      color: var(--mn-color-text-primary);
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .channel-meta {
      display: block;
      margin-top: var(--mn-space-1);
      color: var(--mn-color-text-tertiary);
      font-family: var(--mn-font-mono);
      font-size: var(--mn-text-xs);
      overflow-wrap: anywhere;
    }

    .channel-state {
      display: block;
      margin-top: var(--mn-space-2);
      color: var(--mn-color-text-secondary);
      font-size: var(--mn-text-xs);
    }

    .empty {
      padding: var(--mn-space-8);
      text-align: center;
      color: var(--mn-color-text-muted);
      font-style: italic;
    }

    .operations-grid {
      display: grid;
      gap: var(--mn-space-4);
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }

    .operations-card h2 {
      margin: 0 0 var(--mn-space-2);
      font-size: var(--mn-text-lg);
    }

    .operations-card p {
      margin: 0 0 var(--mn-space-4);
      color: var(--mn-color-text-secondary);
      line-height: 1.5;
    }

    .operations-state {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--mn-space-2) var(--mn-space-4);
      margin: var(--mn-space-4) 0;
      font-size: var(--mn-text-sm);
    }

    .operations-state dt {
      color: var(--mn-color-text-tertiary);
    }

    .operations-state dd {
      margin: 0;
      color: var(--mn-color-text-primary);
      overflow-wrap: anywhere;
    }
  `

  private _api: PhanesControlApi | null = null
  private loaded: PhanesControlDocument | null = null
  private draft: PhanesControlBundle | null = null
  private ingestion: PhanesDiscordIngestionControl | null = null
  private policyDraft: PhanesDiscordIngestionPolicy | null = null
  private operations: PhanesOperations | null = null
  private mode: EditorMode = 'operations'
  private rawDraft = ''
  private filter = ''
  private channelFilter = ''
  private loading = true
  private saving = false
  private dirty = false
  private policyDirty = false
  private message = ''
  private error = ''
  private loadedFromApi: PhanesControlApi | null = null
  private operationsPoll: ReturnType<typeof setInterval> | null = null

  /** True when graph-authored Shrubbery UX makes this the workspace body. */
  @property({ type: Boolean, reflect: true, attribute: 'workspace-surface' })
  workspaceSurface = false

  get api(): PhanesControlApi | null {
    return this._api
  }

  set api(value: PhanesControlApi | null) {
    if (value === this._api) return
    const previous = this._api
    this._api = value
    this.requestUpdate('api', previous)
    if (this.isConnected && value && this.loadedFromApi !== value) {
      this.scheduleLoad(value)
    }
  }

  private scheduleLoad(api: PhanesControlApi): void {
    this.loadedFromApi = api
    void this.updateComplete.then(() => {
      if (this.api === api && this.isConnected) void this.load()
    })
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (this.api && this.loadedFromApi !== this.api) {
      this.scheduleLoad(this.api)
    }
    this.operationsPoll = setInterval(() => {
      if (this.mode === 'operations' && !this.saving) void this.refreshOperations()
    }, 5_000)
  }

  disconnectedCallback(): void {
    if (this.operationsPoll !== null) clearInterval(this.operationsPoll)
    this.operationsPoll = null
    super.disconnectedCallback()
  }

  private async load(): Promise<void> {
    const api = this.api
    if (!api) {
      this.loading = false
      this.error = 'The Phanes control authority is unavailable in this runtime.'
      this.requestUpdate()
      return
    }
    this.loading = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const [document, ingestion, operations] = await Promise.all([
        api.load(),
        api.loadIngestionControl(),
        api.loadOperations(),
      ])
      this.adopt(document)
      this.adoptIngestion(ingestion)
      this.operations = operations
      this.message = 'Loaded the reread-verified presentation, flows, ingestion policy, and runtime operations.'
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load Phanes controls'
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private adopt(document: PhanesControlDocument): void {
    this.loaded = document
    this.draft = structuredClone(document.bundle)
    this.rawDraft = JSON.stringify(document.bundle, null, 2)
    this.dirty = false
  }

  private adoptIngestion(ingestion: PhanesDiscordIngestionControl): void {
    this.ingestion = ingestion
    this.policyDraft = structuredClone(ingestion.policy.value)
    this.policyDirty = false
  }

  private async refreshOperations(): Promise<void> {
    const api = this.api
    if (!api) return
    try {
      this.operations = await api.loadOperations()
      this.error = ''
      this.requestUpdate()
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not refresh Phanes operations'
      this.requestUpdate()
    }
  }

  private async saveOperations(candidate: PhanesOperationsControl, success: string): Promise<void> {
    if (!this.operations || !this.api) return
    this.saving = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      this.operations = await this.api.saveOperationsControl(candidate, this.operations.control.revision)
      this.message = success
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save Phanes operations'
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private async setResponsesEnabled(enabled: boolean): Promise<void> {
    if (!this.operations) return
    await this.saveOperations(
      draftOperationsControl(this.operations.control.value, { responsesEnabled: enabled }),
      enabled
        ? 'Response-on intent published. Waiting for Phanes to report it effective.'
        : 'Response-off intent published. Phanes will keep ingesting but will not answer mentions.',
    )
  }

  private async runIngestion(): Promise<void> {
    if (!this.operations) return
    await this.saveOperations(
      draftOperationsControl(this.operations.control.value, {
        ingestionRequest: createIngestionRunRequest(),
      }),
      'Ingestion reconciliation requested. Runtime progress will update here.',
    )
  }

  private updateCopy(index: number, text: string): void {
    if (!this.draft) return
    const next = structuredClone(this.draft)
    next.presentation.messages[index].text = text
    next.presentation.messages[index].allowedVariables = this.extractVariables(text)
    this.draft = next
    this.rawDraft = JSON.stringify(next, null, 2)
    this.dirty = canonicalJson(next) !== this.loaded?.canonicalContent
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private extractVariables(value: string): string[] {
    const values = new Set<string>()
    for (const match of value.matchAll(/(?<!\{)\{([a-z][a-z0-9]*(?:[_-][a-z0-9]+)*)\}(?!\})/g)) {
      values.add(match[1])
    }
    return [...values].sort()
  }

  private changeMode(mode: EditorMode): void {
    if (mode === 'flow-json' && this.draft) {
      this.rawDraft = JSON.stringify(this.draft, null, 2)
    }
    this.mode = mode
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private updateRaw(value: string): void {
    this.rawDraft = value
    this.dirty = true
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private discard(): void {
    if (this.mode === 'channels') {
      if (this.ingestion) this.adoptIngestion(this.ingestion)
    } else if (this.loaded) {
      this.adopt(this.loaded)
    }
    this.message = 'Local edits discarded.'
    this.error = ''
    this.requestUpdate()
  }

  private async save(): Promise<void> {
    if (this.mode === 'channels') {
      await this.saveIngestionPolicy()
      return
    }
    if (!this.loaded || !this.draft || !this.dirty) return
    this.saving = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      let candidate: unknown = this.draft
      if (this.mode === 'flow-json') {
        try {
          candidate = JSON.parse(this.rawDraft)
        } catch {
          throw new Error('The advanced control draft is not valid JSON')
        }
      }
      const api = this.api
      if (!api) throw new Error('The Phanes control authority is unavailable in this runtime.')
      const saved = await api.save(candidate, this.loaded.revision)
      this.adopt(saved)
      this.message = 'Published and durably reread. Phanes will hot-reload this revision.'
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save Phanes controls'
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private updateIngestionPolicy(options: { enabled?: boolean; channelId?: string; admitted?: boolean }): void {
    if (!this.policyDraft || !this.ingestion) return
    const excluded = new Set(this.policyDraft.excludedChannels.map(item => item.channelId))
    if (options.channelId !== undefined && options.admitted !== undefined) {
      if (options.admitted) excluded.delete(options.channelId)
      else excluded.add(options.channelId)
    }
    this.policyDraft = draftDiscordIngestionPolicy(this.policyDraft, {
      enabled: options.enabled ?? this.policyDraft.enabled,
      excludedChannelIds: excluded,
    })
    this.policyDirty = (
      this.policyDraft.enabled !== this.ingestion.policy.value.enabled
      || canonicalJson(this.policyDraft.excludedChannels.map(item => item.channelId))
        !== canonicalJson(this.ingestion.policy.value.excludedChannels.map(item => item.channelId))
    )
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private async saveIngestionPolicy(): Promise<void> {
    if (!this.ingestion || !this.policyDraft || !this.policyDirty) return
    this.saving = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const api = this.api
      if (!api) throw new Error('The Phanes control authority is unavailable in this runtime.')
      const saved = await api.saveIngestionPolicy(
        this.policyDraft,
        this.ingestion.policy.revision,
      )
      this.adoptIngestion(saved)
      this.message = saved.policy.value.enabled
        ? 'Published and durably reread. Phanes will reconcile the local RDF source before activating this fence.'
        : 'Published and durably reread. Phanes ingestion is disabled and fail-closed.'
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save the Discord ingestion policy'
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private visibleMessages(): Array<{ index: number; message: PhanesControlBundle['presentation']['messages'][number] }> {
    if (!this.draft) return []
    const needle = this.filter.trim().toLocaleLowerCase()
    return this.draft.presentation.messages
      .map((message, index) => ({ index, message }))
      .filter(({ message }) => !needle || [message.key, message.surface, message.text]
        .some(value => value.toLocaleLowerCase().includes(needle)))
  }

  private visibleChannels(): PhanesDiscordChannel[] {
    if (!this.ingestion) return []
    const needle = this.channelFilter.trim().toLocaleLowerCase()
    return this.ingestion.catalog.value.channels.filter(channel => (
      !needle
      || [channel.name, channel.channelId, channel.categoryName ?? '', channel.kind]
        .some(value => value.toLocaleLowerCase().includes(needle))
    ))
  }

  private get activeDirty(): boolean {
    if (this.mode === 'operations') return false
    return this.mode === 'channels' ? this.policyDirty : this.dirty
  }

  private renderOperations() {
    if (!this.operations) return html`<div class="empty">Phanes has not published runtime operations yet.</div>`
    const { control, status } = this.operations
    const ingestion = status.value.ingestion
    const requestPending = (control.value.ingestionRequest?.requestId ?? null) !== ingestion.controlRequestId
    const busy = requestPending || !['active', 'failed'].includes(ingestion.phase)
    const effectiveResponses = status.value.responsesEnabled
    return html`
      <div class="operations-grid">
        <section class="operations-card">
          <h2>Responses</h2>
          <p>
            This switch controls Discord replies only. Privacy-safe live ingestion and local RDF maintenance continue.
          </p>
          <label class="policy-toggle">
            <input
              type="checkbox"
              .checked=${control.value.responsesEnabled}
              ?disabled=${this.saving}
              @change=${(event: Event) => void this.setResponsesEnabled((event.target as HTMLInputElement).checked)}
            />
            <span>
              Let Phanes answer direct @Phanes mentions
              <span class="channel-state">
                Runtime reports responses ${effectiveResponses ? 'on' : 'off'}
                ${effectiveResponses === control.value.responsesEnabled ? '(effective)' : '(activation pending)'}.
              </span>
            </span>
          </label>
        </section>
        <section class="operations-card">
          <h2>Ingestion</h2>
          <p>
            Reconcile the admitted channels through the Privacy Steward. Existing RDF is rematerialized locally;
            Discord history is read only for consented principals already awaiting a one-time backfill.
          </p>
          <button class="primary" ?disabled=${this.saving || busy} @click=${() => void this.runIngestion()}>
            ${busy ? icon('loader-circle', { size: 14, class: 'mn-icon-spin' }) : icon('play', { size: 14 })}
            ${busy ? 'Ingestion in progress…' : 'Run ingestion now'}
          </button>
          <dl class="operations-state">
            <dt>Phase</dt><dd>${ingestion.phase}</dd>
            <dt>Messages</dt><dd>${ingestion.messageCount}</dd>
            <dt>Documents</dt><dd>${ingestion.documentCount}</dd>
            <dt>Authority</dt><dd>${ingestion.authorityRevision === null ? 'starting' : `r${ingestion.authorityRevision}`}</dd>
            <dt>Updated</dt><dd>${new Date(status.value.updatedAt).toLocaleString()}</dd>
            ${ingestion.errorCode ? html`<dt>Error</dt><dd>${ingestion.errorCode}</dd>` : nothing}
          </dl>
          <button ?disabled=${this.saving} @click=${() => void this.refreshOperations()}>
            ${icon('refresh-cw', { size: 14 })} Refresh status
          </button>
        </section>
      </div>
      <p class="safety-note">
        Operations are revision-checked Meaningful Objects. Status is authored by the Phanes runtime from the
        segregated privacy authority; this interface never edits or deletes Discord data.
      </p>
    `
  }

  private renderChannelPolicy(channels: PhanesDiscordChannel[], excluded: Set<string>) {
    if (!this.ingestion || !this.policyDraft) {
      return html`<div class="empty">The bot-authored Discord channel catalog is unavailable.</div>`
    }
    return html`
      <section class="policy-card">
        <label class="policy-toggle">
          <input
            type="checkbox"
            .checked=${this.policyDraft.enabled}
            @change=${(event: Event) => this.updateIngestionPolicy({
              enabled: (event.target as HTMLInputElement).checked,
            })}
          />
          <span>
            Enable Discord ingestion for the admitted channels below
            <span class="channel-state">
              Disabled is the fail-closed default: Phanes reads no channel history, ignores gateway messages and
              direct mentions, and issues no Discord capability context.
            </span>
          </span>
        </label>
        <p class="safety-note">
          Channel names come from the Discord gateway cache; loading this page does not poll message history.
          Excluding a channel prevents initial backfill and future create/edit/delete ingestion. Publishing a changed
          fence performs local RDF source surgery and rematerialization only. It never deletes or edits Discord data.
        </p>
      </section>
      <div class="channel-grid">
        ${channels.map(channel => {
          const admitted = !excluded.has(channel.channelId)
          return html`
            <label class="channel-row">
              <input
                type="checkbox"
                .checked=${admitted}
                @change=${(event: Event) => this.updateIngestionPolicy({
                  channelId: channel.channelId,
                  admitted: (event.target as HTMLInputElement).checked,
                })}
              />
              <span class="channel-copy">
                <span class="channel-name">#${channel.name}</span>
                <span class="channel-meta">
                  ${channel.categoryName ? `${channel.categoryName} · ` : ''}${channel.kind} · ${channel.channelId}
                </span>
                <span class="channel-state">
                  ${admitted ? 'Admitted when ingestion is enabled' : 'Excluded from backfill, live events, mentions, and contexts'}
                </span>
              </span>
            </label>
          `
        })}
      </div>
      ${channels.length === 0 ? html`<div class="empty">No configured channels match that filter.</div>` : nothing}
    `
  }

  render() {
    const visible = this.visibleMessages()
    const channels = this.visibleChannels()
    const excluded = new Set(this.policyDraft?.excludedChannels.map(item => item.channelId) ?? [])
    const configuredChannelCount = this.ingestion?.catalog.value.channels.length ?? 0
    const admittedChannelCount = this.policyDraft?.enabled ? configuredChannelCount - excluded.size : 0
    const surfaceHeader = this.workspaceSurface ? html`
      <header class="surface-header">
        <h1>Phanes control</h1>
        <p>
          Edit Phanes’s AgentPresentationCatalog and InteractionFlows, then decide which Discord channels
          the ingestion workflow may admit. Every publication is revision-checked, sealed as Meaningful Objects,
          and durably reread before Phanes can activate it.
        </p>
      </header>
    ` : nothing
    const toolbar = html`
      <div class="toolbar">
        <button class=${this.mode === 'copy' ? 'active' : ''} @click=${() => this.changeMode('copy')}>
          ${icon('message-square', { size: 14 })} Message copy
        </button>
        <button class=${this.mode === 'operations' ? 'active' : ''} @click=${() => this.changeMode('operations')}>
          ${icon('bot', { size: 14 })} Operations
        </button>
        <button class=${this.mode === 'flow-json' ? 'active' : ''} @click=${() => this.changeMode('flow-json')}>
          ${icon('git-branch', { size: 14 })} Flow &amp; raw JSON
        </button>
        <button class=${this.mode === 'channels' ? 'active' : ''} @click=${() => this.changeMode('channels')}>
          ${icon('database', { size: 14 })} Channel ingestion
        </button>
        <span class="spacer"></span>
        ${this.mode === 'copy' ? html`
          <input
            class="search"
            type="search"
            placeholder="Filter copy by key or text…"
            .value=${this.filter}
            @input=${(event: Event) => {
              this.filter = (event.target as HTMLInputElement).value
              this.requestUpdate()
            }}
          />
        ` : this.mode === 'channels' ? html`
          <input
            class="search"
            type="search"
            placeholder="Filter channels by name, category, or ID…"
            .value=${this.channelFilter}
            @input=${(event: Event) => {
              this.channelFilter = (event.target as HTMLInputElement).value
              this.requestUpdate()
            }}
          />
        ` : nothing}
        <button ?disabled=${this.loading || this.saving} @click=${() => void this.load()}>
          ${icon('refresh-cw', { size: 14 })} Reload
        </button>
        ${this.mode === 'operations' ? nothing : html`
          <button ?disabled=${!this.activeDirty || this.saving} @click=${this.discard}>Discard</button>
          <button class="primary" ?disabled=${!this.activeDirty || this.saving} @click=${() => void this.save()}>
            ${this.saving ? icon('loader-circle', { size: 14, class: 'mn-icon-spin' }) : icon('save', { size: 14 })}
            ${this.saving ? 'Publishing…' : this.mode === 'channels' ? 'Publish ingestion policy' : 'Publish revision'}
          </button>
        `}
      </div>
    `
    const status = this.mode === 'operations' ? null : this.mode === 'channels' && this.ingestion && this.policyDraft ? html`
      <div class="status">
        <span class="revision">Policy r${this.ingestion.policy.revision}</span>
        <span class="revision">Catalog r${this.ingestion.catalog.revision}</span>
        <strong>${this.policyDraft.enabled ? 'Ingestion enabled' : 'Ingestion disabled'}</strong>
        <span>${admittedChannelCount} / ${configuredChannelCount} configured channels admitted</span>
        ${this.policyDirty ? html`<strong>Unpublished edits</strong>` : nothing}
      </div>
    ` : this.loaded ? html`
      <div class="status">
        <span class="revision">Document r${this.loaded.revision}</span>
        <span>${this.loaded.bundle.object.version.slice(0, 23)}…</span>
        ${this.dirty ? html`<strong>Unpublished edits</strong>` : nothing}
      </div>
    ` : null
    const notices = html`
      ${this.message ? html`<div class="status">${this.message}</div>` : nothing}
      ${this.error ? html`<div class="status error">${icon('alert-circle', { size: 16 })}${this.error}</div>` : nothing}
    `

    if (this.loading) return html`
      <div class="editor-root">
        ${surfaceHeader}
        ${toolbar}
        ${status}
        ${notices}
        <div class="empty">Loading Phanes controls…</div>
      </div>
    `
    if (!this.draft) {
      return html`
        <div class="editor-root">
          ${surfaceHeader}
          ${toolbar}
          ${status}
          ${notices}
          <div class="empty">The Phanes control graph is unavailable to this account.</div>
        </div>
      `
    }
    if (this.mode === 'channels') {
      return html`
        <div class="editor-root">
          ${surfaceHeader}
          ${toolbar}
          ${status}
          ${notices}
          ${this.renderChannelPolicy(channels, excluded)}
        </div>
      `
    }
    if (this.mode === 'operations') {
      return html`
        <div class="editor-root">
          ${surfaceHeader}
          ${toolbar}
          ${notices}
          ${this.renderOperations()}
        </div>
      `
    }
    if (this.mode === 'copy') {
      return html`
        <div class="editor-root">
          ${surfaceHeader}
          ${toolbar}
          ${status}
          ${notices}
          <div class="catalog">
            ${visible.map(({ index, message }) => html`
              <section class="message-card">
                <div class="message-heading">
                  <span class="key">${message.key}</span>
                  <span class="surface">${message.surface}</span>
                </div>
                <textarea
                  aria-label=${`Copy for ${message.key}`}
                  .value=${message.text}
                  maxlength=${message.maxLength}
                  @input=${(event: Event) => this.updateCopy(index, (event.target as HTMLTextAreaElement).value)}
                ></textarea>
                <div class="template-meta">
                  <span>${message.allowedVariables.length ? `Variables: ${message.allowedVariables.join(', ')}` : 'No variables'}</span>
                  <span>${message.text.length} / ${message.maxLength}</span>
                </div>
              </section>
            `)}
            ${visible.length === 0 ? html`<div class="empty">No message copy matches that filter.</div>` : nothing}
          </div>
        </div>
      `
    }
    return html`
      <div class="editor-root">
        ${surfaceHeader}
        ${toolbar}
        ${status}
        ${notices}
        <p class="note">
          The cards show the admitted flow topology. The JSON editor exposes the complete bundle for
          advanced flow changes; publish revalidates every template reference and regenerates all Meaningful Object digests.
        </p>
        <div class="flow-grid">
          ${this.draft.flows.flatMap(flow => flow.nodes.map(node => html`
            <section class="flow-card">
              <div class="flow-heading">
                <span class="key">${flow.flowId} / ${node.nodeId}</span>
                <span class="surface">${node.kind}</span>
              </div>
              <ul>
                ${node.actions.map(action => html`
                  <li><code>${action.actionId}</code> → ${action.kind}${action.target ? ` (${action.target})` : ''}</li>
                `)}
              </ul>
            </section>
          `))}
        </div>
        <textarea
          class="raw-editor"
          aria-label="Complete Phanes control JSON"
          spellcheck="false"
          .value=${this.rawDraft}
          @input=${(event: Event) => this.updateRaw((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-phanes-control-editor': MnPhanesControlEditor
  }
}
