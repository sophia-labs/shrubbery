/** Choreograph workspace: configuration, agent profiles, modes, and run history. */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { descriptionLength, descriptionWords, estimatedDescriptionTokens, type DescriptionLength } from './choreo-tool-analysis.js'
import './choreo-agent-profile.js'
import {
  type ChoreoAgent,
  type ChoreoMode,
  type ChoreoModeDraft,
  type ChoreoModesPort,
  type ChoreoToolDescriptor,
  type ModeAccess,
  effectiveToolCount,
  isToolEffective,
  isValidGraphId,
  modeIri,
  slugify,
  validateModeDraft,
} from './choreo-modes-model.js'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ChoreoScreen = 'overview' | 'agents' | 'modes' | 'runs'
type ToolView = 'all' | 'exposed' | 'brief' | 'long' | 'missing'
type ToolSort = 'family' | 'name' | 'tokens-desc' | 'tokens-asc'

export interface ChoreoRunOverviewItem {
  readonly runId: string
  readonly workflowName: string
  readonly status: string
  readonly startedAt: string
  readonly durationMs: number | null
  readonly endedAt?: string | null
  readonly totalTokens?: number | null
  readonly agentCount?: number | null
}

export type ChoreoRunOverviewResult =
  | { readonly kind: 'ok'; readonly runs: readonly ChoreoRunOverviewItem[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly error: string }

type ChoreoRunOverviewState = ChoreoRunOverviewResult | { readonly kind: 'loading' }

export interface ChoreoRunOverviewPort {
  runs(): Promise<ChoreoRunOverviewResult>
}

interface EditorState {
  readonly isNew: boolean
  readonly iri: string | null
  readonly slug: string
  readonly label: string
  readonly access: ModeAccess
  readonly allowsTools: readonly string[]
  readonly graphScopes: readonly string[]
  readonly requiresApproval: readonly string[]
  readonly imageTransform: string | null
}

interface AgentDraft {
  readonly defaultMode: string | null
  readonly mayUseModes: readonly string[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

@customElement('choreo-modes-surface')
export class ChoreoModesSurface extends LitElement {
  /** The active graph's modes port; setting a new port reloads. */
  @property({ attribute: false }) port: ChoreoModesPort | null = null
  /** Optional workflow run history, separate from graph mode configuration. */
  @property({ attribute: false }) runOverviewPort: ChoreoRunOverviewPort | null = null
  /** Graph ids the viewer can pick as a scope (suggestions; free entry is validated). */
  @property({ attribute: false }) graphIds: readonly string[] = []

  @state() private status: LoadStatus = 'idle'
  @state() private loadError = ''
  @state() private catalogue: readonly ChoreoToolDescriptor[] = []
  @state() private catalogueError = ''
  @state() private modes: readonly ChoreoMode[] = []
  @state() private agents: readonly ChoreoAgent[] = []
  @state() private editor: EditorState | null = null
  @state() private editorBusy = false
  @state() private editorError = ''
  @state() private confirmingDelete = false
  @state() private toolFilter = ''
  @state() private toolView: ToolView = 'all'
  @state() private toolSort: ToolSort = 'family'
  @state() private inspectedTool: string | null = null
  @state() private scopeInput = ''
  @state() private agentDrafts: ReadonlyMap<string, AgentDraft> = new Map()
  @state() private agentBusy = ''
  @state() private agentErrors: ReadonlyMap<string, string> = new Map()
  @state() private notice = ''
  @state() private screen: ChoreoScreen = 'overview'
  @state() private agentQuery = ''
  @state() private selectedAgentId: string | null = null
  @state() private selectedRunId: string | null = null
  @state() private runOverview: ChoreoRunOverviewState = { kind: 'unavailable' }

  private loadToken = 0
  private runLoadToken = 0

  /**
   * The shared Sophia top bar's Choreograph toolbar (app-toolbar.ts) emits
   * composed, bubbling events; the bar is a sibling of this surface, not an
   * ancestor, so the surface hears them on its document. One surface per
   * page (the organism app region or the /choreograph route).
   */
  private readonly onToolbarOverview = (): void => { this.showScreen('overview') }
  private readonly onToolbarNewMode = (): void => { this.startNewMode() }

  override connectedCallback(): void {
    super.connectedCallback()
    this.ownerDocument.addEventListener('mn-choreograph-overview', this.onToolbarOverview)
    this.ownerDocument.addEventListener('mn-choreograph-new-mode', this.onToolbarNewMode)
  }

  override disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('mn-choreograph-overview', this.onToolbarOverview)
    this.ownerDocument.removeEventListener('mn-choreograph-new-mode', this.onToolbarNewMode)
    super.disconnectedCallback()
  }

  /** Show one of the four screens (the toolbar's Overview is the home). */
  showScreen(screen: ChoreoScreen): void {
    if (screen === 'overview') this.editor = null
    this.screen = screen
  }

  /** Open the editor on a new, empty mode. */
  startNewMode(): void {
    this.openNew()
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('port')) {
      this.editor = null
      this.agentDrafts = new Map()
      this.agentErrors = new Map()
      void this.reload()
    } else if (changed.has('runOverviewPort')) {
      void this.reloadRuns()
    }
  }

  /** Re-read catalogue, modes and agents from the port. */
  async reload(): Promise<void> {
    const port = this.port
    const token = ++this.loadToken
    void this.reloadRuns()
    if (!port) {
      this.status = 'idle'
      this.modes = []
      this.agents = []
      this.catalogue = []
      return
    }
    this.status = 'loading'
    this.loadError = ''
    const [catalogue, snapshot] = await Promise.allSettled([port.catalogue(), port.load()])
    if (token !== this.loadToken) return
    if (catalogue.status === 'fulfilled') {
      this.catalogue = catalogue.value
      this.catalogueError = ''
    } else {
      this.catalogue = []
      this.catalogueError = errorText(catalogue.reason)
    }
    if (snapshot.status === 'fulfilled') {
      this.modes = snapshot.value.modes
      this.agents = snapshot.value.agents
      this.status = 'ready'
    } else {
      this.loadError = errorText(snapshot.reason)
      this.status = 'error'
    }
  }

  private async reloadRuns(): Promise<void> {
    const port = this.runOverviewPort
    const token = ++this.runLoadToken
    if (!port) {
      this.runOverview = { kind: 'unavailable' }
      return
    }
    this.runOverview = { kind: 'loading' }
    try {
      const result = await port.runs()
      if (token === this.runLoadToken) this.runOverview = result
    } catch (error) {
      if (token === this.runLoadToken) this.runOverview = { kind: 'error', error: errorText(error) }
    }
  }

  // ── editor ────────────────────────────────────────────────────────────────

  private openNew(): void {
    this.screen = 'modes'
    this.notice = ''
    this.editorError = ''
    this.confirmingDelete = false
    this.inspectedTool = null
    this.editor = {
      isNew: true, iri: null, slug: '', label: '', access: 'read',
      allowsTools: [], graphScopes: [], requiresApproval: [], imageTransform: null,
    }
  }

  private openMode(mode: ChoreoMode): void {
    this.screen = 'modes'
    this.notice = ''
    this.editorError = ''
    this.confirmingDelete = false
    this.inspectedTool = mode.allowsTools.find(name => this.catalogue.some(tool => tool.name === name)) ?? null
    this.editor = {
      isNew: false, iri: mode.iri, slug: mode.slug, label: mode.label, access: mode.access,
      allowsTools: [...mode.allowsTools], graphScopes: [...mode.graphScopes],
      requiresApproval: [...mode.requiresApproval], imageTransform: mode.imageTransform,
    }
  }

  private patch(next: Partial<EditorState>): void {
    if (!this.editor) return
    this.editor = { ...this.editor, ...next }
    this.editorError = ''
  }

  private setLabel(label: string): void {
    if (!this.editor) return
    this.patch(this.editor.isNew ? { label, slug: slugify(label) } : { label })
  }

  private toggleTool(name: string, on: boolean): void {
    const editor = this.editor
    if (!editor) return
    const allowsTools = on
      ? [...new Set([...editor.allowsTools, name])]
      : editor.allowsTools.filter(tool => tool !== name)
    this.patch({
      allowsTools,
      requiresApproval: on ? editor.requiresApproval : editor.requiresApproval.filter(tool => tool !== name),
    })
  }

  private toggleApproval(name: string, on: boolean): void {
    const editor = this.editor
    if (!editor) return
    this.patch({
      requiresApproval: on
        ? [...new Set([...editor.requiresApproval, name])]
        : editor.requiresApproval.filter(tool => tool !== name),
    })
  }

  private addScope(): void {
    const editor = this.editor
    const id = this.scopeInput.trim()
    if (!editor || !id) return
    if (!isValidGraphId(id)) {
      this.editorError = `'${id}' is not a graph id.`
      return
    }
    this.patch({ graphScopes: [...new Set([...editor.graphScopes, id])] })
    this.scopeInput = ''
  }

  private draftOf(editor: EditorState): ChoreoModeDraft {
    return {
      slug: editor.slug,
      label: editor.label,
      access: editor.access,
      allowsTools: editor.allowsTools,
      graphScopes: editor.graphScopes,
      requiresApproval: editor.requiresApproval.filter(name => editor.allowsTools.includes(name)),
    }
  }

  private async save(): Promise<void> {
    const editor = this.editor
    const port = this.port
    if (!editor || !port || this.editorBusy) return
    const draft = this.draftOf(editor)
    const issues = validateModeDraft(draft, this.catalogue)
    const errors = [...issues.errors]
    if (editor.isNew && this.modes.some(mode => mode.slug === draft.slug)) {
      errors.push(`A mode with id '${draft.slug}' already exists.`)
    }
    if (errors.length > 0) {
      this.editorError = errors.join(' ')
      return
    }
    this.editorBusy = true
    try {
      await port.saveMode(draft)
      this.notice = `Saved ${draft.label.trim()}.`
      this.editor = null
      await this.reload()
    } catch (error) {
      this.editorError = errorText(error)
    } finally {
      this.editorBusy = false
    }
  }

  private async deleteCurrent(): Promise<void> {
    const editor = this.editor
    const port = this.port
    if (!editor?.iri || !port || this.editorBusy) return
    this.editorBusy = true
    try {
      await port.deleteMode(editor.iri)
      this.notice = `Deleted ${editor.label}.`
      this.editor = null
      this.confirmingDelete = false
      this.agentDrafts = new Map()
      await this.reload()
    } catch (error) {
      this.editorError = errorText(error)
    } finally {
      this.editorBusy = false
    }
  }

  // ── agents ────────────────────────────────────────────────────────────────

  private agentDraft(agent: ChoreoAgent): AgentDraft {
    return this.agentDrafts.get(agent.iri) ?? { defaultMode: agent.defaultMode, mayUseModes: agent.mayUseModes }
  }

  private setAgentDraft(agent: ChoreoAgent, draft: AgentDraft): void {
    const next = new Map(this.agentDrafts)
    next.set(agent.iri, draft)
    this.agentDrafts = next
    const errors = new Map(this.agentErrors)
    errors.delete(agent.iri)
    this.agentErrors = errors
  }

  private toggleAllowed(agent: ChoreoAgent, mode: string, on: boolean): void {
    const draft = this.agentDraft(agent)
    const mayUseModes = on
      ? [...new Set([...draft.mayUseModes, mode])]
      : draft.mayUseModes.filter(value => value !== mode)
    // The default must stay inside the allowed set: dropping it clears it.
    const defaultMode = draft.defaultMode && mayUseModes.includes(draft.defaultMode) ? draft.defaultMode : null
    this.setAgentDraft(agent, { defaultMode, mayUseModes })
  }

  private setDefault(agent: ChoreoAgent, mode: string): void {
    const draft = this.agentDraft(agent)
    this.setAgentDraft(agent, { ...draft, defaultMode: mode || null })
  }

  private agentDirty(agent: ChoreoAgent): boolean {
    const draft = this.agentDrafts.get(agent.iri)
    if (!draft) return false
    const same = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index])
    return draft.defaultMode !== agent.defaultMode || !same(draft.mayUseModes, agent.mayUseModes)
  }

  private async saveAgent(agent: ChoreoAgent): Promise<void> {
    const port = this.port
    if (!port || this.agentBusy) return
    const draft = this.agentDraft(agent)
    if (draft.defaultMode && !draft.mayUseModes.includes(draft.defaultMode)) {
      const errors = new Map(this.agentErrors)
      errors.set(agent.iri, 'The default mode must be one of the allowed modes.')
      this.agentErrors = errors
      return
    }
    this.agentBusy = agent.iri
    try {
      await port.saveAgentModes(agent.iri, draft.defaultMode, draft.mayUseModes)
      const drafts = new Map(this.agentDrafts)
      drafts.delete(agent.iri)
      this.agentDrafts = drafts
      this.notice = `Saved modes for ${agent.label ?? agent.agentId}.`
      await this.reload()
    } catch (error) {
      const errors = new Map(this.agentErrors)
      errors.set(agent.iri, errorText(error))
      this.agentErrors = errors
    } finally {
      this.agentBusy = ''
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  protected render(): TemplateResult {
    const heading = this.screen === 'overview' ? 'Overview' : this.screen === 'agents' ? 'Agents' : this.screen === 'runs' ? 'Runs' : 'Modes'
    const description = this.screen === 'overview'
      ? 'Agents, modes, and access in this workspace.'
      : this.screen === 'agents'
        ? 'A directory for the agents defined in this graph.'
        : this.screen === 'runs'
          ? 'Workflow run history recorded by Choreograph for this graph.'
        : 'Choose the tools and graph access available to agent sessions.'
    return html`
      <div class="studio-shell">
        <aside class="studio-sidebar" aria-label="Choreograph navigation">
          <nav class="studio-nav" aria-label="Choreograph sections">
            ${([
              ['overview', 'Overview', '⌂'],
              ['agents', 'Agents', '✦'],
              ['modes', 'Modes', '▤'],
              ['runs', 'Runs', '◷'],
            ] as const).map(([id, label, symbol]) => html`
              <button class="studio-nav-item" data-screen=${id} aria-current=${this.screen === id ? 'page' : nothing}
                @click=${() => { this.screen = id }}>
                <span aria-hidden="true">${symbol}</span><span>${label}</span>
                ${id === 'agents' && this.agents.length ? html`<span class="nav-count">${this.agents.length}</span>` : nothing}
              </button>`)}
          </nav>
          <div class="studio-sidebar-footer">${this.port ? html`<span>Workspace</span><strong title=${this.port.graphId}>${this.port.graphId}</strong>` : nothing}</div>
        </aside>
        <main class="studio-main"><div class="page">
        <header class="header">
          <div class="heading">
            <span class="kicker">Choreograph</span>
            <h1 class="title">${heading}</h1>
            <p class="lede">${description}</p>
          </div>
          <div class="header-actions">
            ${this.port ? html`<span class="graph-pill" data-role="graph">${this.port.graphId}</span>` : nothing}
            <button class="button" data-action="refresh" ?disabled=${!this.port || this.status === 'loading'}
              @click=${() => { void this.reload() }}>Refresh</button>
          </div>
        </header>
        ${this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : nothing}
        ${!this.port || this.status === 'error' || this.status === 'loading' ? this.renderBody()
          : this.screen === 'agents' ? this.renderAgentDirectory()
          : this.screen === 'runs' ? this.renderRuns()
          : this.screen === 'overview' ? this.renderOverview()
            : this.renderBody()}
        </div></main>
      </div>
    `
  }

  private renderOverview(): TemplateResult {
    const assignedAgents = this.agents.filter(agent => agent.defaultMode || agent.mayUseModes.length > 0).length
    const configuredTools = new Set(this.modes.flatMap(mode =>
      this.catalogue.filter(tool => mode.allowsTools.includes(tool.name) && isToolEffective(tool, mode.access)).map(tool => tool.name)))
    const approvalRules = this.modes.reduce((sum, mode) => sum + mode.requiresApproval.length, 0)
    const runs = this.runOverview.kind === 'ok' ? this.runOverview.runs : []
    const activeRuns = runs.filter(run => ['running', 'pending', 'queued', 'in_progress'].includes(run.status.toLocaleLowerCase())).length
    const failedRuns = runs.filter(run => ['failed', 'error'].includes(run.status.toLocaleLowerCase())).length
    const measuredRuns = runs.filter(run => run.totalTokens != null && Number.isFinite(run.totalTokens))
    const recordedTokens = measuredRuns.reduce((sum, run) => sum + (run.totalTokens ?? 0), 0)
    return html`<div class="overview">
      <section class="overview-banner" aria-label="Workspace configuration summary">
        <div><span class="overview-eyebrow">CURRENT GRAPH · CONFIGURATION</span><h2>Workspace state</h2>
          <p>Mode definitions and agent assignments read from ${this.port?.graphId ?? 'the active graph'}.</p></div>
        <div class="overview-metrics">
          <span><strong>${this.modes.length}</strong> modes</span>
          <span><strong>${assignedAgents}/${this.agents.length}</strong> agents assigned</span>
          <span><strong>${configuredTools.size}/${this.catalogue.length}</strong> tools exposed</span>
        </div>
      </section>
      <div class="overview-grid">
        <section class="card overview-run-panel" aria-label="Recent workflow runs">
          <div class="section-heading"><div><span class="overview-eyebrow">CHOREOGRAPH · WORKFLOW HISTORY</span><h2>Recent runs</h2></div>
            <button class="text-button" @click=${() => { this.screen = 'runs' }}>Open history →</button></div>
          ${this.runOverview.kind === 'ok' && runs.length > 0 ? html`<div class="run-summary" aria-label="Loaded run metrics">
            <span><strong>${activeRuns}</strong><small>Active</small></span>
            <span><strong>${failedRuns}</strong><small>Failed</small></span>
            <span><strong>${recordedTokens.toLocaleString()}</strong><small>Recorded tokens · ${measuredRuns.length}/${runs.length} runs</small></span>
          </div>` : nothing}
          ${this.runOverview.kind === 'loading'
            ? html`<p class="muted">Loading run history…</p>`
            : this.runOverview.kind === 'unavailable'
            ? html`<p class="muted">Run history is not available in this workspace.</p>`
            : this.runOverview.kind === 'error'
              ? html`<p class="warning" role="alert">Run history could not be loaded: ${this.runOverview.error}</p>`
              : runs.length === 0
                ? html`<p class="muted">No workflow runs were returned for this graph.</p>`
                : html`<div class="run-list">${runs.slice(0, 8).map(run => html`
                    <button class="run-row" data-run=${run.runId} @click=${() => this.openRun(run.runId)}>
                      <span class="run-status" data-status=${run.status.toLocaleLowerCase()} aria-label=${`Status: ${run.status}`}></span>
                      <span class="run-identity"><strong>${run.workflowName || run.runId}</strong><small title=${run.runId}>${run.runId}</small></span>
                      <span class="run-detail"><strong>${run.status}</strong><small>${this.formatRunDate(run.startedAt)}${run.durationMs === null ? '' : ` · ${this.formatDuration(run.durationMs)}`}${run.totalTokens == null ? '' : ` · ${run.totalTokens.toLocaleString()} tokens`}</small></span>
                    </button>`)}</div>`}
          <p class="panel-provenance">Source: Choreograph workflow run list for this graph. Token totals appear only when recorded; this feed does not attribute them to modes or split input from output.</p>
        </section>
        <section class="card overview-mode-panel" aria-label="Mode inventory">
          <div class="section-heading"><div><span class="overview-eyebrow">CONFIGURATION</span><h2>Mode inventory</h2></div>
            <button class="text-button" @click=${() => { this.screen = 'modes' }}>Open workspace →</button></div>
          <div class="overview-facts"><span><strong>${this.modes.filter(mode => mode.access === 'read').length}</strong><small>Read ceilings</small></span>
            <span><strong>${this.modes.filter(mode => mode.access === 'write').length}</strong><small>Write ceilings</small></span>
            <span><strong>${approvalRules}</strong><small>Approval rules</small></span></div>
          ${this.modes.length ? html`<ul class="mode-list">${this.modes.slice(0, 5).map(mode => this.renderModeItem(mode))}</ul>`
            : html`<p class="muted">No modes are defined in this graph.</p>`}
        </section>
      </div>
      ${this.agents.length ? html`<section class="directory-preview" aria-label="Agent directory preview">
        <div class="section-heading"><div><span class="overview-eyebrow">AGENT ASSIGNMENTS</span><h2>Agents</h2></div>
          <button class="text-button" @click=${() => { this.screen = 'agents' }}>View directory →</button></div>
        <div class="agent-cards">${this.agents.slice(0, 4).map(agent => this.renderAgentCard(agent))}</div>
      </section>` : nothing}
    </div>`
  }

  private openRun(runId: string): void {
    this.selectedRunId = runId
    this.screen = 'runs'
  }

  private renderRuns(): TemplateResult {
    if (this.runOverview.kind === 'loading') return html`<div class="card empty">Loading run history…</div>`
    if (this.runOverview.kind === 'unavailable') return html`<div class="card empty">Run history is not available in this workspace.</div>`
    if (this.runOverview.kind === 'error') return html`<div class="card error" role="alert">Run history could not be loaded: ${this.runOverview.error}</div>`
    const runs = this.runOverview.runs
    const selected = runs.find(run => run.runId === this.selectedRunId) ?? runs[0] ?? null
    return html`<div class="runs-workspace">
      <div class="run-source-line"><span class="overview-eyebrow">SOURCE · CHOREOGRAPH WORKFLOW RUN LIST</span>
        <span>${runs.length} ${runs.length === 1 ? 'run' : 'runs'} returned for ${this.port?.graphId}</span></div>
      ${runs.length === 0 ? html`<div class="card empty">No workflow runs were returned for this graph.</div>` : html`
        <div class="runs-layout">
          <section class="card run-index" aria-label="Workflow runs">
            <h2 class="card-title">Workflow runs</h2>
            <div class="run-list">${runs.map(run => html`
              <button class="run-row" data-run=${run.runId} data-selected=${String(run.runId === selected?.runId)}
                @click=${() => { this.selectedRunId = run.runId }}>
                <span class="run-status" data-status=${run.status.toLocaleLowerCase()} aria-label=${`Status: ${run.status}`}></span>
                <span class="run-identity"><strong>${run.workflowName || run.runId}</strong><small>${run.runId}</small></span>
                <span class="run-detail"><strong>${run.status}</strong><small>${this.formatRunDate(run.startedAt)}${run.totalTokens == null ? '' : ` · ${run.totalTokens.toLocaleString()} tokens`}</small></span>
              </button>`)}</div>
          </section>
          ${selected ? html`<aside class="card run-inspector" aria-label="Run details">
            <span class="overview-eyebrow">WORKFLOW RUN</span><h2>${selected.workflowName || selected.runId}</h2>
            <dl><div><dt>Status</dt><dd>${selected.status}</dd></div>
              <div><dt>Started</dt><dd>${this.formatRunDate(selected.startedAt)}</dd></div>
              <div><dt>Ended</dt><dd>${selected.endedAt ? this.formatRunDate(selected.endedAt) : 'Not recorded'}</dd></div>
              <div><dt>Duration</dt><dd>${selected.durationMs === null ? 'Not recorded' : this.formatDuration(selected.durationMs)}</dd></div>
              <div><dt>Total tokens</dt><dd>${selected.totalTokens == null ? 'Not recorded' : selected.totalTokens.toLocaleString()}</dd></div>
              <div><dt>Agents</dt><dd>${selected.agentCount == null ? 'Not recorded' : selected.agentCount}</dd></div>
              <div><dt>Run ID</dt><dd class="mono">${selected.runId}</dd></div></dl>
            <p class="panel-provenance">These fields come from Choreograph’s workflow run list. Token totals are observed run data when recorded; no per-mode attribution or input/output split is available here.</p>
          </aside>` : nothing}
        </div>`}
    </div>`
  }

  private formatRunDate(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  private formatDuration(value: number): string {
    if (value < 1000) return `${Math.round(value)} ms`
    if (value < 60_000) return `${(value / 1000).toFixed(1)} s`
    return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
  }

  private renderAgentCard(agent: ChoreoAgent): TemplateResult {
    const defaultMode = this.modes.find(mode => mode.iri === agent.defaultMode)
    const label = agent.label ?? agent.agentId
    const initial = label.trim().slice(0, 1).toLocaleUpperCase() || 'A'
    return html`<button class="agent-card" data-agent-card=${agent.agentId}
      aria-pressed=${String(this.screen === 'agents' && this.selectedAgentId === agent.agentId)}
      @click=${() => { this.selectedAgentId = agent.agentId; this.screen = 'agents' }}>
      <span class="agent-card-mark" aria-hidden="true">${initial}</span>
      <span class="agent-card-body"><strong>${label}</strong><small>${agent.agentId}</small></span>
      <span class="agent-card-meta">${defaultMode?.label ?? 'No default mode'} · ${agent.mayUseModes.length} modes</span>
    </button>`
  }

  private renderAgentDirectory(): TemplateResult {
    if (!this.port || this.status === 'error' || this.status === 'loading') return this.renderBody()
    const query = this.agentQuery.trim().toLocaleLowerCase()
    const visible = this.agents.filter(agent =>
      !query || `${agent.label ?? ''} ${agent.agentId}`.toLocaleLowerCase().includes(query))
    const selected = visible.find(agent => agent.agentId === this.selectedAgentId) ?? visible[0] ?? null
    return html`<div class="directory">
      <div class="section-heading"><div><h2>Agent directory</h2><p>${this.agents.length} in this workspace</p></div>
        <input class="input agent-search" type="search" aria-label="Search agents" placeholder="Search agents"
          .value=${this.agentQuery} @input=${(event: Event) => { this.agentQuery = (event.currentTarget as HTMLInputElement).value }} />
      </div>
      ${this.agents.length === 0 ? html`<div class="card empty">No agents in this graph yet.</div>` : html`
        <div class="directory-layout">
          <div class="agent-cards">${visible.map(agent => this.renderAgentCard(agent))}
            ${visible.length === 0 ? html`<p class="muted">No matching agents.</p>` : nothing}</div>
          ${selected ? html`<section class="card agent-profile" aria-label="Agent profile">
            <choreo-agent-profile .agent=${selected} .modes=${this.modes} .catalogue=${this.catalogue}
              .graphId=${this.port.graphId}></choreo-agent-profile>
            <section class="profile-access" aria-label="Edit mode access"><h3>Edit mode access</h3>
              <ul class="agent-list">${this.renderAgent(selected)}</ul></section>
          </section>` : nothing}
        </div>`}
    </div>`
  }

  private renderBody(): TemplateResult {
    if (!this.port) {
      return html`<div class="card empty" data-state="idle">Open a graph to manage its modes.</div>`
    }
    if (this.status === 'loading' && this.modes.length === 0 && this.agents.length === 0) {
      return html`<div class="card empty" data-state="loading">Reading modes…</div>`
    }
    if (this.status === 'error') {
      return html`<div class="card empty error" data-state="error" role="alert">Could not read modes: ${this.loadError}</div>`
    }
    // One wrapping element: a template whose root starts with a child part
    // mis-parses under happy-dom, and the wrapper costs nothing in a browser.
    return html`<div class="body">
      ${this.catalogueError ? html`
        <p class="warning" data-role="catalogue-error" role="alert">
          The live tool catalogue is unavailable (${this.catalogueError}); modes cannot be saved until it loads.
        </p>` : nothing}
      <div class="columns">
        <section class="card list" aria-label="Modes">
          <div class="card-heading">
            <div><span class="workbench-eyebrow">CONFIGURATIONS</span><h2 class="card-title">Modes <span class="list-total">${this.modes.length}</span></h2></div>
            <button class="button primary" data-action="new-mode" @click=${() => this.openNew()}>New mode</button>
          </div>
          ${this.modes.length === 0
            ? html`<p class="muted" data-state="no-modes">No modes in this graph yet.</p>`
            : html`<ul class="mode-list">${this.modes.map(mode => this.renderModeItem(mode))}</ul>`}
          <p class="rail-note">A mode shapes the tools and graph scope visible in a session. It stays within each agent’s existing grant.</p>
        </section>
        ${this.editor ? this.renderEditor(this.editor) : this.renderModeLanding()}
      </div>
      ${this.screen === 'modes' ? nothing : this.renderAgents()}
    </div>`
  }

  private renderModeLanding(): TemplateResult {
    const namedTools = new Set(this.modes.flatMap(mode => mode.allowsTools))
    return html`<section class="card mode-landing" aria-label="Mode workspace">
      <span class="workbench-eyebrow">MODE WORKSPACE</span>
      <h2>Shape the agent’s working world.</h2>
      <p>Select a mode to inspect its effective tools, the language used to describe them, graph scope, and approval gates.</p>
      <div class="landing-stats">
        <span><strong>${this.modes.length}</strong><small>Modes</small></span>
        <span><strong>${namedTools.size}</strong><small>Tools referenced</small></span>
        <span><strong>${this.catalogue.length}</strong><small>Live tools</small></span>
      </div>
      ${this.modes.length === 0 ? html`<button class="button primary" @click=${() => this.openNew()}>Create first mode</button>` : nothing}
    </section>`
  }

  private renderModeItem(mode: ChoreoMode): TemplateResult {
    const defaults = this.agents.filter(agent => agent.defaultMode === mode.iri)
    const allowed = this.agents.filter(agent => agent.mayUseModes.includes(mode.iri) && agent.defaultMode !== mode.iri)
    const name = (agent: ChoreoAgent) => agent.label ?? agent.agentId
    const selected = this.editor?.iri === mode.iri
    const effective = effectiveToolCount(mode, this.catalogue)
    const effectiveTools = this.catalogue.filter(tool => mode.allowsTools.includes(tool.name) && isToolEffective(tool, mode.access))
    const tokens = effectiveTools.reduce((total, tool) => total + estimatedDescriptionTokens(tool), 0)
    return html`
      <li>
        <button class="mode-item" data-mode=${mode.slug} data-selected=${String(selected)}
          @click=${() => this.openMode(mode)}>
          <span class="mode-name">${mode.label}</span>
          <span class="mode-meta">
            <span class="badge" data-access=${mode.access}>${mode.access}</span>
            <span data-role="tool-count">${mode.allowsTools.length} ${mode.allowsTools.length === 1 ? 'tool' : 'tools'}</span>
            <span>${effective} exposed</span>
            ${mode.graphScopes.length > 0 ? html`<span>${mode.graphScopes.length} graph${mode.graphScopes.length === 1 ? '' : 's'}</span>` : nothing}
          </span>
          <span class="mode-footprint">≈${tokens.toLocaleString()} text tokens <span>· descriptions + names</span></span>
          <span class="mode-agents" data-role="agents">
            ${defaults.length === 0 && allowed.length === 0 ? html`<span class="muted">No agents</span>` : nothing}
            ${defaults.length > 0 ? html`<span>Default for ${defaults.map(name).join(', ')}</span>` : nothing}
            ${allowed.length > 0 ? html`<span>Allowed for ${allowed.map(name).join(', ')}</span>` : nothing}
          </span>
        </button>
      </li>
    `
  }

  private renderEditor(editor: EditorState): TemplateResult {
    const draft = this.draftOf(editor)
    const issues = validateModeDraft(draft, this.catalogue)
    const exposed = effectiveToolCount(draft, this.catalogue)
    const byName = new Map(this.catalogue.map(tool => [tool.name, tool]))
    const approvals = new Set(editor.requiresApproval)
    const suggestions = this.graphIds.filter(id => !editor.graphScopes.includes(id))
    return html`
      <section class="card editor" aria-label="Mode editor" data-editor=${editor.isNew ? 'new' : editor.slug}>
        <div class="card-heading">
          <div><span class="workbench-eyebrow">${editor.isNew ? 'NEW CONFIGURATION' : 'MODE CONFIGURATION'}</span>
            <h2 class="card-title">${editor.isNew ? 'New mode' : editor.label || editor.slug}</h2></div>
          <span class="count" data-role="exposes">Exposes ${exposed} of ${this.catalogue.length} tools</span>
        </div>
        <p class="muted small editor-principle">A mode narrows each agent’s existing grant at session start. These are configuration choices, not a record of a running session.</p>

        <label class="field">
          <span class="field-label">Name</span>
          <input class="input" name="label" .value=${editor.label} placeholder="Researcher"
            @input=${(event: Event) => this.setLabel((event.target as HTMLInputElement).value)} />
          <span class="muted small" data-role="iri">${editor.slug ? this.safeModeIri(editor.slug) : 'The id is derived from the name.'}</span>
        </label>

        <div class="field">
          <span class="field-label">Access ceiling</span>
          <div class="segmented" role="radiogroup" aria-label="Access">
            ${(['read', 'write'] as const).map(access => html`
              <button class="segment" role="radio" data-access-option=${access}
                aria-checked=${String(editor.access === access)} data-active=${String(editor.access === access)}
                @click=${() => this.patch({ access })}>${access === 'read' ? 'Read only' : 'Read and write'}</button>`)}
          </div>
          ${issues.ineffectiveTools.length > 0 ? html`
            <span class="warning small" data-role="ineffective">
              Under read access these write tools are not exposed: ${issues.ineffectiveTools.join(', ')}.
            </span>` : nothing}
        </div>

        ${issues.unknownTools.length > 0 ? html`
          <div class="field unknown" data-role="unknown-tools">
            <span class="field-label">Not in this cell's catalogue</span>
            <div class="chips">
              ${issues.unknownTools.map(name => html`
                <span class="chip danger">${name}
                  <button class="chip-remove" data-remove-tool=${name} aria-label=${`Remove ${name}`}
                    @click=${() => this.toggleTool(name, false)}>×</button>
                </span>`)}
            </div>
            <span class="warning small">Remove these before saving; modes name exact live tools only.</span>
          </div>` : nothing}

        ${this.renderToolWorkbench(editor)}

        <div class="field">
          <span class="field-label">Graph scope</span>
          <span class="muted small">Leave empty to use the agent's own graphs.</span>
          <div class="chips" data-role="scopes">
            ${editor.graphScopes.map(id => html`
              <span class="chip">${id}
                <button class="chip-remove" data-remove-scope=${id} aria-label=${`Remove ${id}`}
                  @click=${() => this.patch({ graphScopes: editor.graphScopes.filter(value => value !== id) })}>×</button>
              </span>`)}
          </div>
          <div class="field-row">
            <input class="input compact" name="scope" list="choreo-modes-graphs" placeholder="graph id"
              .value=${this.scopeInput}
              @input=${(event: Event) => { this.scopeInput = (event.target as HTMLInputElement).value }}
              @keydown=${(event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); this.addScope() } }} />
            <datalist id="choreo-modes-graphs">${suggestions.map(id => html`<option value=${id}></option>`)}</datalist>
            <button class="button" data-action="add-scope" @click=${() => this.addScope()}>Add graph</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Approval required</span>
          <span class="muted small">Calls to these tools pause until a person approves them.</span>
          ${editor.allowsTools.length === 0
            ? html`<p class="muted small">Choose tools first.</p>`
            : html`<div class="chips" data-role="approvals">${[...editor.allowsTools].sort().map(name => html`
              <label class="chip toggle" data-approval=${name} data-unknown=${String(!byName.has(name))}>
                <input type="checkbox" .checked=${approvals.has(name)}
                  @change=${(event: Event) => this.toggleApproval(name, (event.target as HTMLInputElement).checked)} />
                ${name}
              </label>`)}</div>`}
        </div>

        ${this.editorError ? html`<p class="error-text" role="alert" data-role="editor-error">${this.editorError}</p>` : nothing}

        <div class="actions">
          ${!editor.isNew ? (this.confirmingDelete
            ? html`
              <span class="small">Delete this mode and remove it from every agent?</span>
              <button class="button danger" data-action="confirm-delete" ?disabled=${this.editorBusy}
                @click=${() => { void this.deleteCurrent() }}>Delete</button>
              <button class="button" data-action="cancel-delete" @click=${() => { this.confirmingDelete = false }}>Keep</button>`
            : html`<button class="button danger" data-action="delete" @click=${() => { this.confirmingDelete = true }}>Delete mode</button>`)
            : nothing}
          <span class="spacer"></span>
          <button class="button" data-action="cancel" @click=${() => { this.editor = null }}>Cancel</button>
          <button class="button primary" data-action="save"
            ?disabled=${this.editorBusy || issues.errors.length > 0 || this.catalogue.length === 0}
            @click=${() => { void this.save() }}>${this.editorBusy ? 'Saving…' : 'Save mode'}</button>
        </div>
      </section>
    `
  }

  private renderToolWorkbench(editor: EditorState): TemplateResult {
    const selected = new Set(editor.allowsTools)
    const exposed = this.catalogue.filter(tool => selected.has(tool.name) && isToolEffective(tool, editor.access))
    const tokenEstimate = exposed.reduce((sum, tool) => sum + estimatedDescriptionTokens(tool), 0)
    const brief = exposed.filter(tool => descriptionLength(tool.description) === 'brief').length
    const missing = exposed.filter(tool => descriptionLength(tool.description) === 'missing').length
    const long = exposed.filter(tool => descriptionLength(tool.description) === 'long').length
    const query = this.toolFilter.trim().toLocaleLowerCase()
    const matchesView = (tool: ChoreoToolDescriptor): boolean => {
      if (this.toolView === 'exposed') return selected.has(tool.name) && isToolEffective(tool, editor.access)
      if (this.toolView === 'brief' || this.toolView === 'long' || this.toolView === 'missing') {
        return descriptionLength(tool.description) === this.toolView
      }
      return true
    }
    const visible = this.catalogue.filter(tool => matchesView(tool) && (
      !query || `${tool.name} ${tool.description} ${tool.family} ${tool.scopes.join(' ')}`.toLocaleLowerCase().includes(query)
    ))
    visible.sort((a, b) => {
      if (this.toolSort === 'tokens-desc') return estimatedDescriptionTokens(b) - estimatedDescriptionTokens(a) || a.name.localeCompare(b.name)
      if (this.toolSort === 'tokens-asc') return estimatedDescriptionTokens(a) - estimatedDescriptionTokens(b) || a.name.localeCompare(b.name)
      if (this.toolSort === 'name') return a.name.localeCompare(b.name)
      return a.family.localeCompare(b.family) || a.name.localeCompare(b.name)
    })
    const inspected = this.catalogue.find(tool => tool.name === this.inspectedTool)
      ?? exposed[0] ?? visible[0] ?? null
    return html`<section class="tool-workbench" aria-label="Tool catalogue and description analysis">
      <div class="workbench-head">
        <div><span class="workbench-eyebrow">AGENT TOOL SURFACE</span><h3>Catalogue & description review</h3>
          <p>Inspect the exact live description text and compare its length across tools.</p></div>
      </div>
      <div class="analysis-strip" aria-label="Tool description summary">
        <span><strong>${exposed.length}</strong><small>Exposed tools</small></span>
        <span><strong>≈${tokenEstimate.toLocaleString()}</strong><small>Text tokens</small></span>
        <span><strong>${brief}</strong><small>Brief descriptions</small></span>
        <span><strong>${long}</strong><small>Long descriptions</small></span>
        <span><strong>${missing}</strong><small>Missing descriptions</small></span>
      </div>
      <p class="estimate-note" data-role="estimate-method">Token estimate: UTF-8 bytes ÷ 4, rounded up per exposed tool, for names and descriptions only. Actual model tokens and complete tool definitions depend on the provider and schemas.</p>
      <div class="tool-toolbar">
        <input class="input" type="search" aria-label="Search tool catalogue" placeholder="Search tools, descriptions, or scopes"
          .value=${this.toolFilter} @input=${(event: Event) => { this.toolFilter = (event.currentTarget as HTMLInputElement).value }} />
        <label>View <select class="input" aria-label="Filter tools" .value=${this.toolView}
          @change=${(event: Event) => { this.toolView = (event.currentTarget as HTMLSelectElement).value as ToolView }}>
          <option value="all">All tools</option><option value="exposed">Exposed</option><option value="brief">Brief (&lt;12 words)</option>
          <option value="long">Long (&gt;60 words)</option><option value="missing">Missing text</option>
        </select></label>
        <label>Sort <select class="input" aria-label="Sort tools" .value=${this.toolSort}
          @change=${(event: Event) => { this.toolSort = (event.currentTarget as HTMLSelectElement).value as ToolSort }}>
          <option value="family">Family</option><option value="name">Name</option>
          <option value="tokens-desc">Most text tokens</option><option value="tokens-asc">Fewest text tokens</option>
        </select></label>
      </div>
      <div class="tool-workspace">
        <div class="catalogue-pane">
          <div class="catalogue-column-head"><span>${visible.length} of ${this.catalogue.length} tools</span><span>DESCRIPTION</span><span>≈ TOKENS</span></div>
          ${visible.length ? html`<div class="tool-rows" role="list" aria-label="Tools">
            ${visible.map(tool => {
              const isSelected = selected.has(tool.name)
              const effective = isToolEffective(tool, editor.access)
              const length = descriptionLength(tool.description)
              return html`<div class="tool-row" role="listitem" data-tool=${tool.name} data-effective=${String(!isSelected || effective)} data-inspected=${String(inspected?.name === tool.name)}>
                <label class="tool-choice" title=${isSelected && !effective ? 'Selected but blocked by the read ceiling' : 'Include tool in mode'}>
                  <input type="checkbox" aria-label=${`Include ${tool.name}`} .checked=${isSelected}
                    @change=${(event: Event) => this.toggleTool(tool.name, (event.currentTarget as HTMLInputElement).checked)} />
                </label>
                <button class="tool-inspect" aria-label=${`Inspect ${tool.name}`} @click=${() => { this.inspectedTool = tool.name }}>
                  <span class="tool-ident"><strong>${tool.name}</strong><small>${tool.family} · ${tool.effect}${isSelected && !effective ? ' · blocked by access' : ''}</small></span>
                  <span class="tool-excerpt" data-length=${length}>${tool.description.trim() || 'No description supplied by the live catalogue.'}</span>
                  <span class="tool-cost">≈${estimatedDescriptionTokens(tool)}<small>${descriptionWords(tool.description)} words</small></span>
                </button>
              </div>`
            })}
          </div>` : html`<p class="catalogue-empty">No tools match this view.</p>`}
        </div>
        <aside class="tool-inspector" aria-label="Selected tool details">
          ${inspected ? this.renderToolInspector(inspected, editor) : html`<p class="muted">Select a tool to inspect its description.</p>`}
        </aside>
      </div>
    </section>`
  }

  private renderToolInspector(tool: ChoreoToolDescriptor, editor: EditorState): TemplateResult {
    const chosen = editor.allowsTools.includes(tool.name)
    const effective = isToolEffective(tool, editor.access)
    const length: DescriptionLength = descriptionLength(tool.description)
    return html`
      <span class="workbench-eyebrow">TOOL INSPECTOR</span>
      <h4>${tool.name}</h4>
      <div class="inspector-badges"><span class="badge" data-effect=${tool.effect}>${tool.effect}</span>
        <span class="badge">${tool.family}</span><span class="badge">${chosen ? (effective ? 'Exposed' : 'Blocked by access') : 'Not in mode'}</span></div>
      <div class="inspector-section"><h5>Agent-facing description</h5>
        <p class="description-copy" data-length=${length}>${tool.description.trim() || 'No description supplied by the live catalogue.'}</p></div>
      <div class="inspector-measures">
        <span><strong>${descriptionWords(tool.description)}</strong><small>words</small></span>
        <span><strong>${tool.description.length}</strong><small>characters</small></span>
        <span><strong>≈${estimatedDescriptionTokens(tool)}</strong><small>text tokens</small></span>
      </div>
      <div class="inspector-section"><h5>Required scopes</h5>
        ${tool.scopes.length ? html`<div class="scope-list">${tool.scopes.map(scope => html`<code>${scope}</code>`)}</div>`
          : html`<p class="muted small">No scopes listed in the tool metadata.</p>`}</div>
      <div class="inspector-section"><h5>Language review</h5>
        <p class="muted small">${length === 'missing' ? 'Add a description at the tool source so the agent can understand its purpose.'
          : length === 'brief' ? 'Brief text: check that it names the action, result, and important limits.'
            : length === 'long' ? 'Long text: check that each sentence helps the agent choose or use the tool.'
              : 'Read for a concrete action, a recognizable result, and useful boundaries.'}</p>
        <p class="muted small">Does the wording make the result easy to picture? Description text comes from the live MCP catalogue and is edited at its source.</p></div>
      ${chosen ? html`<label class="inspector-approval"><input type="checkbox" .checked=${editor.requiresApproval.includes(tool.name)}
        @change=${(event: Event) => this.toggleApproval(tool.name, (event.currentTarget as HTMLInputElement).checked)} />Require approval for this tool</label>` : nothing}
    `
  }

  private safeModeIri(slug: string): string {
    try {
      return modeIri(slug)
    } catch {
      return `Invalid id '${slug}'`
    }
  }

  private renderAgents(): TemplateResult {
    return html`
      <section class="card agents" aria-label="Agents">
        <div class="card-heading">
          <h2 class="card-title">Agents</h2>
        </div>
        ${this.agents.length === 0
          ? html`<p class="muted" data-state="no-agents">No agents in this graph.</p>`
          : this.modes.length === 0
            ? html`<p class="muted" data-state="no-modes-for-agents">Create a mode to assign it to agents.</p>`
            : nothing}
        ${this.agents.length > 0 ? html`<ul class="agent-list">${this.agents.map(agent => this.renderAgent(agent))}</ul>` : nothing}
      </section>
    `
  }

  private renderAgent(agent: ChoreoAgent): TemplateResult {
    const draft = this.agentDraft(agent)
    const dirty = this.agentDirty(agent)
    const error = this.agentErrors.get(agent.iri)
    const allowedModes = this.modes.filter(mode => draft.mayUseModes.includes(mode.iri))
    const missing = draft.mayUseModes.filter(iri => !this.modes.some(mode => mode.iri === iri))
    return html`
      <li class="agent" data-agent=${agent.agentId}>
        <div class="agent-head">
          <span class="agent-name">${agent.label ?? agent.agentId}</span>
          ${agent.label ? html`<span class="muted small">${agent.agentId}</span>` : nothing}
        </div>
        <div class="chips" data-role="allowed">
          ${this.modes.map(mode => html`
            <label class="chip toggle" data-allowed=${mode.slug}>
              <input type="checkbox" .checked=${draft.mayUseModes.includes(mode.iri)}
                @change=${(event: Event) => this.toggleAllowed(agent, mode.iri, (event.target as HTMLInputElement).checked)} />
              ${mode.label}
            </label>`)}
          ${missing.map(iri => html`<span class="chip danger" title="This mode no longer exists">${iri}</span>`)}
        </div>
        <div class="field-row">
          <label class="field-label" for=${`default-${agent.agentId}`}>Default mode</label>
          <select class="input compact" id=${`default-${agent.agentId}`} data-role="default"
            ?disabled=${allowedModes.length === 0}
            @change=${(event: Event) => this.setDefault(agent, (event.target as HTMLSelectElement).value)}>
            <option value="" ?selected=${!draft.defaultMode}>None</option>
            ${allowedModes.map(mode => html`<option value=${mode.iri} ?selected=${draft.defaultMode === mode.iri}>${mode.label}</option>`)}
          </select>
          <span class="spacer"></span>
          <button class="button primary" data-action="save-agent" ?disabled=${!dirty || this.agentBusy === agent.iri}
            @click=${() => { void this.saveAgent(agent) }}>${this.agentBusy === agent.iri ? 'Saving…' : 'Save'}</button>
        </div>
        ${error ? html`<p class="error-text" role="alert">${error}</p>` : nothing}
      </li>
    `
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      background: var(--mn-color-surface-canvas, var(--mn-color-surface, #f7f4ec));
      color: var(--mn-color-text-primary, #1d1b18);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }
    .studio-shell { display: grid; grid-template-columns: 228px minmax(0, 1fr); height: 100%; min-width: 0; }
    .studio-sidebar {
      display: flex; min-width: 0; min-height: 0; flex-direction: column;
      padding: 24px 13px 18px; border-right: 1px solid var(--mn-color-border-subtle, #d8ded9);
      background: var(--mn-color-surface-chrome, #f1f2e9); box-sizing: border-box;
    }
    .studio-nav { display: grid; gap: 5px; }
    .studio-nav-item {
      display: flex; min-height: 43px; align-items: center; gap: 11px; width: 100%;
      padding: 0 12px; border: 1px solid transparent; border-radius: 11px;
      background: transparent; color: var(--mn-color-text-secondary, #58665c);
      text-align: left; cursor: pointer; font: 600 13px/1 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .studio-nav-item > span:first-child { width: 19px; flex: 0 0 auto; color: var(--mn-color-text-accent, #376d57); font-size: 17px; text-align: center; }
    .studio-nav-item:hover { background: var(--mn-color-surface-hover, #edf6ef); }
    .studio-nav-item[aria-current='page'] { border-color: var(--mn-garden-card-edge, #c2d7c8); background: var(--mn-color-surface-raised, #fff); color: var(--mn-color-text-primary, #18211b); box-shadow: var(--mn-garden-card-shadow, none); }
    .studio-nav-item:focus-visible, .agent-card:focus-visible, .text-button:focus-visible { outline: 2px solid var(--mn-focus-ring-color, #376d57); outline-offset: 2px; }
    .nav-count { margin-left: auto; color: var(--mn-color-text-muted, #66736a); font: 600 11px/1 var(--mn-font-utility, system-ui, sans-serif); }
    .studio-sidebar-footer { display: grid; gap: 5px; margin-top: auto; padding: 12px 12px 0; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); color: var(--mn-color-text-muted, #66736a); font: 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); text-transform: uppercase; letter-spacing: 0.1em; }
    .studio-sidebar-footer strong { overflow: hidden; color: var(--mn-color-text-secondary, #58665c); font: 600 12px/1.3 var(--mn-font-chrome, system-ui, sans-serif); text-overflow: ellipsis; text-transform: none; letter-spacing: 0; white-space: nowrap; }
    .studio-main { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
    .page {
      max-width: 1540px;
      margin: 0 auto;
      padding: var(--mn-space-8, 32px) var(--mn-space-6, 24px) var(--mn-space-12, 48px);
      display: grid;
      gap: var(--mn-space-5, 20px);
    }
    .body { display: grid; gap: var(--mn-space-5, 20px); }
    .overview { display: grid; gap: 24px; }
    .overview-workbench .body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
    .overview-workbench .columns { grid-template-columns: minmax(0, 1fr); }
    .overview-banner { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 24px 28px; border: 1px solid var(--mn-garden-card-edge, #d8ded9); border-radius: 18px; background: var(--mn-color-surface-raised, #fff); }
    .overview-eyebrow { color: var(--mn-color-text-accent, #376d57); font: 700 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); letter-spacing: 0.13em; }
    .overview-banner h2 { margin: 7px 0 5px; font: 600 clamp(27px, 3vw, 38px)/1.1 var(--mn-font-display, Georgia, serif); letter-spacing: -0.04em; }
    .overview-banner p { margin: 0; color: var(--mn-color-text-secondary, #58665c); font-size: 13px; }
    .overview-metrics { display: flex; gap: 22px; flex: 0 0 auto; }
    .overview-metrics span { display: grid; gap: 5px; min-width: 62px; color: var(--mn-color-text-muted, #66736a); font: 11px/1.1 var(--mn-font-utility, system-ui, sans-serif); text-transform: uppercase; letter-spacing: 0.06em; }
    .overview-metrics strong { color: var(--mn-color-text-primary, #18211b); font: 650 26px/1 var(--mn-font-display, Georgia, serif); letter-spacing: -0.04em; }
    .overview-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, 1fr); align-items: start; gap: 18px; }
    .overview-grid .card { min-height: 250px; }
    .overview-grid .section-heading { align-items: center; }
    .source-tag { padding: 4px 8px; border: 1px solid var(--mn-color-border-subtle, #d8ded9); border-radius: 6px; color: var(--mn-color-text-muted, #66736a); font: 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); white-space: nowrap; }
    .run-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 10px 0 14px; }
    .run-summary span { display: grid; gap: 3px; min-width: 0; }
    .run-summary strong { font: 650 21px/1 var(--mn-font-display, Georgia, serif); font-variant-numeric: tabular-nums; }
    .run-summary small { color: var(--mn-color-text-muted, #66736a); font: 10px/1.3 var(--mn-font-utility, system-ui, sans-serif); }
    .run-list { border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .run-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 11px; width: 100%; padding: 10px 2px; border: 0; border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9); background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
    .run-row:hover, .run-row[data-selected='true'] { background: var(--mn-color-surface-hover, #edf6ef); }
    .run-row:focus-visible { outline: 2px solid var(--mn-focus-ring-color, #376d57); outline-offset: -2px; }
    .run-status { width: 7px; height: 7px; border-radius: 50%; background: var(--mn-color-text-muted, #66736a); }
    .run-status[data-status='finished'], .run-status[data-status='completed'], .run-status[data-status='succeeded'], .run-status[data-status='success'] { background: var(--mn-color-accent, #326f4c); }
    .run-status[data-status='failed'], .run-status[data-status='error'] { background: var(--mn-color-danger, #a33a2a); }
    .run-status[data-status='running'], .run-status[data-status='pending'] { background: var(--mn-color-warning, #b7791f); }
    .run-identity, .run-detail { display: grid; min-width: 0; gap: 3px; }
    .run-identity strong, .run-identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .run-identity strong, .run-detail strong { font: 600 12px/1.25 var(--mn-font-chrome, system-ui, sans-serif); }
    .run-identity small, .run-detail small { color: var(--mn-color-text-muted, #66736a); font: 10px/1.25 var(--mn-font-utility, system-ui, sans-serif); }
    .run-detail { text-align: right; }
    .panel-provenance { margin: 15px 0 0; color: var(--mn-color-text-muted, #66736a); font: 10px/1.5 var(--mn-font-utility, system-ui, sans-serif); }
    .runs-workspace { display: grid; gap: 12px; }
    .run-source-line { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; color: var(--mn-color-text-muted, #66736a); font: 11px/1.2 var(--mn-font-utility, system-ui, sans-serif); }
    .runs-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(275px, .8fr); align-items: start; gap: 16px; }
    .run-index .card-title { margin-bottom: 12px; }
    .run-index .run-list { max-height: 650px; overflow-y: auto; }
    .run-inspector { position: sticky; top: 16px; }
    .run-inspector h2 { margin: 7px 0 16px; overflow-wrap: anywhere; font: 600 24px/1.15 var(--mn-font-display, Georgia, serif); }
    .run-inspector dl { margin: 0; }
    .run-inspector dl div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .run-inspector dt { color: var(--mn-color-text-muted, #66736a); font-size: 11px; }
    .run-inspector dd { margin: 0; min-width: 0; overflow-wrap: anywhere; font-size: 12px; text-align: right; }
    .run-inspector dd.mono { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 10px; }
    .overview-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; padding: 12px 0; border-block: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .overview-facts span { display: grid; gap: 3px; }
    .overview-facts strong { font: 650 20px/1 var(--mn-font-display, Georgia, serif); }
    .overview-facts small { color: var(--mn-color-text-muted, #66736a); font: 10px/1.3 var(--mn-font-utility, system-ui, sans-serif); }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .section-heading h2 { margin: 0; font: 600 22px/1.2 var(--mn-font-display, Georgia, serif); letter-spacing: -0.03em; }
    .section-heading p { margin: 3px 0 0; color: var(--mn-color-text-muted, #66736a); font-size: 12px; }
    .text-button { border: 0; background: none; color: var(--mn-color-text-accent, #376d57); font: 650 12px/1 var(--mn-font-chrome, system-ui, sans-serif); cursor: pointer; }
    .agent-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(205px, 1fr)); gap: 11px; }
    .agent-card { display: grid; grid-template-columns: 45px minmax(0, 1fr); gap: 8px 11px; align-items: center; min-width: 0; min-height: 110px; padding: 15px; border: 1px solid var(--mn-garden-card-edge, #d8ded9); border-radius: 16px; background: var(--mn-color-surface-raised, #fff); color: var(--mn-color-text-primary, #18211b); box-shadow: var(--mn-garden-card-shadow, none); text-align: left; cursor: pointer; }
    .agent-card:hover, .agent-card[aria-pressed='true'] { border-color: var(--mn-color-border-focus, #39765a); background: var(--mn-color-surface-hover, #edf6ef); }
    .agent-card-mark { display: grid; width: 45px; height: 45px; flex: 0 0 auto; place-items: center; border-radius: 14px; background: color-mix(in srgb, var(--mn-color-surface-accent, #edf6ef) 75%, #b4d4e7); color: var(--mn-color-text-accent-strong, #2d6a4f); font: 650 23px/1 var(--mn-font-display, Georgia, serif); }
    .agent-card-body { display: grid; min-width: 0; gap: 3px; }
    .agent-card-body strong, .agent-card-body small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-card-body strong { font: 650 16px/1.2 var(--mn-font-display, Georgia, serif); }
    .agent-card-body small { color: var(--mn-color-text-muted, #66736a); font: 11px/1.2 var(--mn-font-utility, system-ui, sans-serif); }
    .agent-card-meta { grid-column: 1 / -1; color: var(--mn-color-text-secondary, #58665c); font: 12px/1.2 var(--mn-font-chrome, system-ui, sans-serif); }
    .directory { display: grid; gap: 10px; }
    .agent-search { width: min(245px, 100%); box-sizing: border-box; }
    .directory-layout { display: grid; grid-template-columns: minmax(220px, 285px) minmax(0, 1fr); gap: 18px; align-items: start; }
    .directory-layout .agent-cards { grid-template-columns: minmax(0, 1fr); align-content: start; }
    .agent-profile { display: grid; gap: 22px; min-width: 0; }
    .profile-access { display: grid; gap: 12px; padding-top: 18px; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .agent-profile h3 { margin: 0; font: 650 14px/1 var(--mn-font-chrome, system-ui, sans-serif); }
    .agent-profile .agent { border-top: 0; padding-top: 0; }
    .header { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--mn-space-4, 16px); flex-wrap: wrap; }
    .kicker { color: var(--mn-color-text-muted, #67625b); text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--mn-text-xs, 11px); }
    .title {
      margin: 2px 0 6px;
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-3xl, 30px);
      letter-spacing: -0.025em;
      font-weight: 600;
    }
    .lede { margin: 0; max-width: 62ch; color: var(--mn-color-text-secondary, #4a463f); }
    .header-actions { display: flex; align-items: center; gap: var(--mn-space-2, 8px); }
    .graph-pill {
      padding: 4px 12px;
      border-radius: var(--mn-radius-full, 999px);
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2));
      color: var(--mn-color-text-secondary, #4a463f);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 11px);
    }
    .columns { display: grid; grid-template-columns: minmax(220px, 265px) minmax(0, 1fr); gap: var(--mn-space-4, 16px); align-items: start; }
    @media (max-width: 820px) { .columns { grid-template-columns: 1fr; } }
    .card {
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2));
      border-radius: 18px;
      background: var(--mn-color-surface-raised, #fffefa);
      box-shadow: var(--mn-garden-card-shadow, var(--mn-shadow-card, none));
      padding: var(--mn-space-4, 16px) var(--mn-space-5, 20px);
      min-width: 0;
    }
    .card.empty { color: var(--mn-color-text-muted, #67625b); }
    .card.error, .error-text { color: var(--mn-color-text-danger, var(--mn-color-danger, #a33a2a)); }
    .card-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--mn-space-3, 12px); margin-bottom: var(--mn-space-3, 12px); }
    .card-title { margin: 0; font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif)); font-size: var(--mn-text-md, 16px); font-weight: 600; }
    .muted { color: var(--mn-color-text-muted, #67625b); }
    .small { font-size: var(--mn-text-xs, 11px); }
    .notice, .warning {
      margin: 0;
      padding: 8px 14px;
      border-radius: 12px;
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2));
      border-left: 3px solid var(--mn-color-border-accent, #326f4c);
      background: var(--mn-color-surface-raised, #fffefa);
    }
    .warning { border-left-color: var(--mn-color-warning, #b7791f); }
    span.warning { display: block; margin-top: 6px; }
    .button, .segment, .mode-item, .chip {
      font: inherit;
      color: var(--mn-garden-control-text, var(--mn-color-text-primary, #1d1b18));
    }
    .button {
      min-height: 32px;
      padding: 0 14px;
      border: 1px solid var(--mn-garden-control-edge, var(--mn-color-border-subtle, #e2ddd2));
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-garden-control-bg, var(--mn-color-surface-raised, #fffefa));
      box-shadow: var(--mn-garden-control-shadow, none);
      cursor: pointer;
      white-space: nowrap;
    }
    .button:hover:not(:disabled) { background: var(--mn-garden-control-bg-hover, var(--mn-color-surface-hover, #f1ede4)); }
    .button:active:not(:disabled) { background: var(--mn-garden-control-bg-active, var(--mn-color-surface-active, #e9e3d7)); box-shadow: var(--mn-garden-control-shadow-active, none); }
    .button:disabled { opacity: 0.5; cursor: default; }
    .button.primary { background: var(--mn-color-accent, #326f4c); border-color: transparent; color: var(--mn-color-text-on-accent, #fff); }
    .button.primary:hover:not(:disabled) { background: var(--mn-color-accent-hover, var(--mn-color-accent, #2a5e40)); }
    .button.danger { border-color: var(--mn-color-danger-border, currentColor); color: var(--mn-color-text-danger, var(--mn-color-danger, #a33a2a)); }
    .mode-list, .agent-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--mn-space-2, 8px); }
    .mode-item {
      width: 100%;
      display: grid;
      gap: 4px;
      text-align: left;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: 14px;
      background: transparent;
      cursor: pointer;
    }
    .mode-item:hover { background: var(--mn-color-interactive-hover, var(--mn-color-surface-hover, #f1ede4)); }
    .mode-item[data-selected='true'] {
      border-color: var(--mn-garden-control-edge, var(--mn-color-border-subtle, #e2ddd2));
      background: var(--mn-garden-control-bg, var(--mn-color-surface-raised, #fffefa));
      box-shadow: var(--mn-garden-control-shadow, none);
    }
    .mode-name { font-weight: 600; }
    .mode-footprint { color: var(--mn-color-text-accent, #376d57); font: 600 11px/1.3 var(--mn-font-utility, system-ui, sans-serif); }
    .mode-footprint span { color: var(--mn-color-text-muted, #67625b); font-weight: 400; }
    .workbench-eyebrow { color: var(--mn-color-text-muted, #67625b); font: 700 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); letter-spacing: .1em; }
    .list-total { margin-left: 4px; color: var(--mn-color-text-muted, #67625b); font: 500 12px/1 var(--mn-font-utility, system-ui, sans-serif); }
    .rail-note { margin: 18px 3px 2px; padding-top: 14px; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); color: var(--mn-color-text-muted, #67625b); font: 11px/1.5 var(--mn-font-chrome, system-ui, sans-serif); }
    .mode-landing { display: flex; min-height: 350px; flex-direction: column; justify-content: center; align-items: flex-start; padding: 36px; background: linear-gradient(140deg, var(--mn-color-surface-raised, #fffefa), var(--mn-color-surface-accent, #edf6ef)); }
    .mode-landing h2 { max-width: 18ch; margin: 9px 0 8px; font: 600 clamp(25px, 3vw, 36px)/1.12 var(--mn-font-display, Georgia, serif); letter-spacing: -.035em; }
    .mode-landing p { max-width: 54ch; margin: 0; color: var(--mn-color-text-secondary, #58665c); line-height: 1.55; }
    .landing-stats { display: flex; flex-wrap: wrap; gap: 30px; margin: 28px 0; }
    .landing-stats span { display: grid; gap: 5px; }
    .landing-stats strong { font: 650 24px/1 var(--mn-font-display, Georgia, serif); }
    .landing-stats small { color: var(--mn-color-text-muted, #67625b); font: 11px/1.2 var(--mn-font-utility, system-ui, sans-serif); }
    .mode-meta, .mode-agents { display: flex; flex-wrap: wrap; gap: 8px; color: var(--mn-color-text-secondary, #4a463f); font-size: var(--mn-text-xs, 11px); }
    .badge {
      display: inline-block;
      padding: 0 8px;
      border-radius: var(--mn-radius-full, 999px);
      font-size: var(--mn-text-xs, 11px);
      line-height: 18px;
      border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2));
      color: var(--mn-color-text-secondary, #4a463f);
    }
    .badge[data-access='write'], .badge[data-effect='write'] { color: var(--mn-color-warning-text, #8a5a12); border-color: currentColor; }
    .count { font-variant-numeric: tabular-nums; color: var(--mn-color-text-secondary, #4a463f); }
    .editor { display: grid; gap: var(--mn-space-4, 16px); }
    .editor .card-heading { margin-bottom: 0; }
    .editor > p { margin: 0; }
    .editor-principle { padding-bottom: 12px; border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9); line-height: 1.5; }
    .tool-workbench { display: grid; gap: 12px; min-width: 0; padding: 18px 0; border-block: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .workbench-head h3 { margin: 4px 0; font: 600 21px/1.2 var(--mn-font-display, Georgia, serif); letter-spacing: -.02em; }
    .workbench-head p { margin: 0; color: var(--mn-color-text-muted, #67625b); font-size: 11px; }
    .analysis-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--mn-color-border-subtle, #d8ded9); border-radius: 10px; overflow: hidden; background: var(--mn-color-surface-canvas, #f7f4ec); }
    .analysis-strip span { display: grid; gap: 5px; min-width: 0; padding: 12px 10px; border-right: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .analysis-strip span:last-child { border-right: 0; }
    .analysis-strip strong { font: 650 18px/1 var(--mn-font-display, Georgia, serif); font-variant-numeric: tabular-nums; }
    .analysis-strip small { color: var(--mn-color-text-muted, #67625b); font: 10px/1.25 var(--mn-font-utility, system-ui, sans-serif); }
    .estimate-note { margin: -4px 0 0; color: var(--mn-color-text-muted, #67625b); font: 10px/1.45 var(--mn-font-utility, system-ui, sans-serif); }
    .tool-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .tool-toolbar > input { flex: 1 1 230px; min-width: 0; }
    .tool-toolbar label { display: flex; align-items: center; gap: 5px; color: var(--mn-color-text-muted, #67625b); font-size: 11px; }
    .tool-toolbar select { min-height: 34px; max-width: 145px; padding: 0 8px; }
    .tool-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(230px, 34%); min-height: 420px; border: 1px solid var(--mn-color-border-subtle, #d8ded9); border-radius: 10px; overflow: hidden; }
    .catalogue-pane { min-width: 0; }
    .catalogue-column-head { display: grid; grid-template-columns: minmax(115px, .9fr) minmax(100px, 1.3fr) 75px; gap: 8px; padding: 9px 11px 9px 36px; border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9); background: var(--mn-color-surface-canvas, #f7f4ec); color: var(--mn-color-text-muted, #67625b); font: 700 9px/1.2 var(--mn-font-utility, system-ui, sans-serif); letter-spacing: .06em; }
    .catalogue-column-head span:last-child { text-align: right; }
    .tool-rows { max-height: 530px; overflow-y: auto; }
    .tool-row { display: flex; align-items: stretch; min-width: 0; border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .tool-row:last-child { border-bottom: 0; }
    .tool-row[data-inspected='true'] { background: var(--mn-color-surface-accent, #edf6ef); }
    .tool-row[data-effective='false'] { opacity: .72; }
    .tool-choice { display: grid; flex: 0 0 34px; place-items: center; cursor: pointer; }
    .tool-choice input { accent-color: var(--mn-color-accent, #326f4c); }
    .tool-inspect { display: grid; grid-template-columns: minmax(115px, .9fr) minmax(100px, 1.3fr) 75px; gap: 8px; align-items: center; min-width: 0; width: 100%; min-height: 59px; padding: 8px 11px 8px 2px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
    .tool-inspect:hover { background: var(--mn-color-surface-hover, #edf6ef); }
    .tool-inspect:focus-visible, .tool-choice input:focus-visible { outline: 2px solid var(--mn-focus-ring-color, #376d57); outline-offset: -2px; }
    .tool-ident, .tool-cost { display: grid; min-width: 0; gap: 3px; }
    .tool-ident strong { overflow: hidden; font: 600 11px/1.2 var(--mn-font-mono, ui-monospace, monospace); text-overflow: ellipsis; white-space: nowrap; }
    .tool-ident small, .tool-cost small { color: var(--mn-color-text-muted, #67625b); font: 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); }
    .tool-excerpt { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--mn-color-text-secondary, #4a463f); font: 11px/1.35 var(--mn-font-chrome, system-ui, sans-serif); }
    .tool-excerpt[data-length='missing'] { color: var(--mn-color-text-muted, #67625b); font-style: italic; }
    .tool-cost { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .catalogue-empty { margin: 0; padding: 24px; color: var(--mn-color-text-muted, #67625b); }
    .tool-inspector { display: grid; align-content: start; gap: 12px; min-width: 0; max-height: 565px; overflow-y: auto; padding: 16px; border-left: 1px solid var(--mn-color-border-subtle, #d8ded9); background: var(--mn-color-surface-canvas, #f7f4ec); }
    .tool-inspector h4 { margin: -6px 0 0; overflow-wrap: anywhere; font: 650 16px/1.25 var(--mn-font-mono, ui-monospace, monospace); }
    .inspector-badges { display: flex; flex-wrap: wrap; gap: 5px; }
    .inspector-section { padding-top: 12px; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    .inspector-section h5 { margin: 0 0 7px; font: 700 10px/1.2 var(--mn-font-utility, system-ui, sans-serif); letter-spacing: .05em; text-transform: uppercase; }
    .inspector-section p { margin: 0; line-height: 1.5; }
    .description-copy { overflow-wrap: anywhere; white-space: pre-wrap; font-size: 12px; }
    .description-copy[data-length='missing'] { color: var(--mn-color-text-muted, #67625b); font-style: italic; }
    .inspector-measures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .inspector-measures span { display: grid; gap: 3px; padding: 8px; border: 1px solid var(--mn-color-border-subtle, #d8ded9); border-radius: 6px; background: var(--mn-color-surface-raised, #fffefa); }
    .inspector-measures strong { font-variant-numeric: tabular-nums; }
    .inspector-measures small { color: var(--mn-color-text-muted, #67625b); font-size: 9px; }
    .scope-list { display: flex; flex-wrap: wrap; gap: 4px; }
    .scope-list code { padding: 3px 5px; border: 1px solid var(--mn-color-border-subtle, #d8ded9); border-radius: 5px; background: var(--mn-color-surface-raised, #fffefa); font-size: 10px; overflow-wrap: anywhere; }
    .inspector-approval { display: flex; gap: 7px; align-items: center; padding-top: 12px; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); font-size: 11px; cursor: pointer; }
    .field { display: grid; gap: 6px; }
    .field-label { font-weight: 600; }
    .field-row { display: flex; align-items: center; gap: var(--mn-space-2, 8px); flex-wrap: wrap; }
    .input {
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid var(--mn-color-border-strong, #cbc5ba);
      border-radius: 12px;
      background: var(--mn-color-surface-raised, #fffefa);
      color: inherit;
      font: inherit;
    }
    .input.compact { min-height: 30px; flex: 1 1 160px; max-width: 280px; }
    .segmented { display: inline-flex; gap: 4px; padding: 3px; border-radius: var(--mn-radius-full, 999px); border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2)); width: max-content; }
    .segment { min-height: 28px; padding: 0 14px; border: 1px solid transparent; border-radius: var(--mn-radius-full, 999px); background: transparent; cursor: pointer; }
    .segment[data-active='true'] {
      border-color: var(--mn-garden-control-edge, var(--mn-color-border-subtle, #e2ddd2));
      background: var(--mn-garden-control-bg-active, var(--mn-color-surface-active, #e9e3d7));
      box-shadow: var(--mn-garden-control-shadow, none);
    }
    .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--mn-space-3, 12px); max-height: 420px; overflow: auto; padding-right: 4px; }
    .group { margin: 0; padding: 8px 10px 10px; border: 1px solid var(--mn-garden-card-edge, var(--mn-color-border-subtle, #e2ddd2)); border-radius: 12px; min-width: 0; }
    .group legend { padding: 0 6px; font-size: var(--mn-text-xs, 11px); text-transform: uppercase; letter-spacing: 0.06em; color: var(--mn-color-text-muted, #67625b); }
    .tool { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; }
    .tool-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: var(--mn-text-xs, 11px); }
    .tool[data-effective='false'] .tool-name { text-decoration: line-through; color: var(--mn-color-text-muted, #67625b); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      border: 1px solid var(--mn-garden-control-edge, var(--mn-color-border-subtle, #e2ddd2));
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-garden-control-bg, var(--mn-color-surface-raised, #fffefa));
      font-size: var(--mn-text-xs, 11px);
    }
    .chip.toggle { cursor: pointer; }
    .chip.danger { border-color: var(--mn-color-danger-border, #a33a2a); color: var(--mn-color-text-danger, var(--mn-color-danger, #a33a2a)); }
    .chip-remove { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; }
    .actions { display: flex; align-items: center; gap: var(--mn-space-2, 8px); flex-wrap: wrap; }
    .spacer { flex: 1 1 auto; }
    .agent { display: grid; gap: 8px; padding: 12px 0; border-top: 1px solid var(--mn-color-rule, var(--mn-color-border-subtle, #e2ddd2)); }
    .agent:first-child { border-top: 0; }
    .agent-head { display: flex; align-items: baseline; gap: 8px; }
    .agent-name { font-weight: 600; }
    @media (max-width: 900px) {
      .studio-shell { grid-template-columns: 185px minmax(0, 1fr); }
      .overview-banner { align-items: start; flex-direction: column; }
      .overview-grid { grid-template-columns: minmax(0, 1fr); }
      .runs-layout { grid-template-columns: minmax(0, 1fr); }
      .run-inspector { position: static; }
      .directory-layout { grid-template-columns: minmax(0, 1fr); }
      .agent-profile { position: static; }
    }
    @media (max-width: 1200px) {
      .tool-workspace { grid-template-columns: minmax(0, 1fr); }
      .tool-inspector { max-height: none; border-left: 0; border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
    }
    @media (max-width: 700px) {
      .studio-shell { display: flex; flex-direction: column; }
      .studio-sidebar { flex: 0 0 auto; padding: 0 12px; border-right: 0; border-bottom: 1px solid var(--mn-color-border-subtle, #d8ded9); }
      .studio-sidebar-footer { display: none; }
      .studio-nav { display: flex; gap: 4px; overflow-x: auto; }
      .studio-nav-item { width: auto; min-height: 48px; flex: 1 0 auto; justify-content: center; padding: 0 10px; border-radius: 0; }
      .studio-nav-item[aria-current='page'] { border-color: transparent; border-bottom: 2px solid var(--mn-color-text-accent, #376d57); border-radius: 0; box-shadow: none; }
      .nav-count { margin-left: 0; }
      .studio-main { flex: 1 1 auto; }
      .page { padding: 22px 18px 52px; gap: 20px; }
      .header { align-items: start; }
      .title { font-size: 30px; }
      .header-actions { width: 100%; justify-content: space-between; }
      .overview { gap: 21px; }
      .overview-banner { padding: 22px; border-radius: 18px; }
      .overview-banner h2 { font-size: 30px; }
      .overview-metrics { width: 100%; justify-content: space-between; gap: 10px; }
      .analysis-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .analysis-strip span:nth-child(3) { border-right: 0; }
      .analysis-strip span:nth-child(n+4) { border-top: 1px solid var(--mn-color-border-subtle, #d8ded9); }
      .catalogue-column-head { display: none; }
      .tool-inspect { grid-template-columns: minmax(0, 1fr) 65px; }
      .tool-excerpt { grid-column: 1; grid-row: 2; }
      .tool-cost { grid-column: 2; grid-row: 1 / 3; }
      .agent-cards { grid-template-columns: minmax(0, 1fr); }
      .directory-layout .agent-cards { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; scroll-snap-type: x proximity; }
      .directory-layout .agent-card { flex: 0 0 174px; min-height: 74px; padding: 10px; gap: 5px 8px; scroll-snap-align: start; }
      .directory-layout .agent-card-mark { width: 38px; height: 38px; border-radius: 11px; font-size: 20px; }
      .directory-layout .agent-card-meta { display: none; }
      .section-heading { align-items: start; }
      .directory > .section-heading { flex-wrap: wrap; }
      .agent-search { width: 100%; }
      .columns { grid-template-columns: minmax(0, 1fr); }
      .columns > .list .mode-list { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 5px; scroll-snap-type: x proximity; }
      .columns > .list .mode-list > li { flex: 0 0 190px; scroll-snap-align: start; }
      .columns > .list .mode-item { height: 100%; min-height: 136px; padding: 10px; border-color: var(--mn-color-border-subtle, #d8ded9); }
      .columns > .list .rail-note { display: none; }
      .overview-workbench .body { grid-template-columns: minmax(0, 1fr); }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'choreo-modes-surface': ChoreoModesSurface
  }
}
