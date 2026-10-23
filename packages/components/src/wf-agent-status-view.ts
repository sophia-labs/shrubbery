/** Read-only Agent ontology/status view. Reports are testimony, never a liveness probe. */
import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type TemplateResult, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { SkinAware } from './skin-aware.js'

export interface WfAgentStatusReport {
  readonly bodyId: string
  readonly sessionId: string | null
  readonly runId: string | null
  readonly activity: string
  readonly reportedAtMs: number
  readonly expiresAtMs: number
  readonly attribution: string
  readonly reporterPrincipal: string | null
}

export interface WfAgentStatusSubject {
  readonly agentIri: string
  readonly agentId: string
  readonly label: string
  readonly reports: readonly WfAgentStatusReport[]
}

export type WfAgentStatusReadState = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error'

@customElement('wf-agent-status-view')
export class WfAgentStatusView extends SkinAware(LitElement) {
  protected readonly _locale = new LocaleController(this)

  @property({ type: String }) graphId = ''
  @property({ type: String }) source = ''
  @property({ type: String }) status: WfAgentStatusReadState = 'idle'
  @property({ type: String }) error = ''
  @property({ attribute: false }) agents: readonly WfAgentStatusSubject[] = []
  @property({ type: String }) selectedAgentIri = ''
  @property({ type: Boolean }) conversationAvailable = false
  @property({ type: Number }) observedAtMs = 0
  @property({ type: Number }) receivedAtMonotonicMs = 0
  @state() private clock = 0
  private clockTimer: ReturnType<typeof setInterval> | null = null

  static styles = css`
    :host { display:block; container-type:inline-size; width:100%; height:100%; min-width:0; min-height:0; color:var(--mn-color-text-primary, #111827); font:var(--mn-text-sm,13px)/1.5 var(--mn-font-chrome,system-ui,sans-serif); }
    * { box-sizing:border-box; }
    .pane { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; }
    header { flex:none; display:flex; align-items:start; flex-wrap:wrap; gap:12px; padding:16px; border-bottom:1px solid var(--mn-color-border-subtle,#ddd); }
    .heading { flex:1; min-width:0; }
    h2,h3,h4,p { margin:0; }
    h2 { font-size:18px; font-weight:600; }
    h3 { font-size:17px; }
    h4 { font-size:13px; font-weight:600; }
    .muted { color:var(--mn-color-text-secondary,#64748b); }
    .scope { overflow-wrap:anywhere; font-size:12px; }
    button,select { font:inherit; color:inherit; background:var(--mn-color-surface-base,#fff); border:1px solid var(--mn-color-border-subtle,#d1d5db); border-radius:var(--mn-radius-control,6px); }
    button { padding:7px 10px; cursor:pointer; }
    button:focus-visible,select:focus-visible { outline:2px solid var(--mn-color-accent,#2563eb); outline-offset:2px; }
    button:hover { background:var(--mn-color-surface-hover,#f3f4f6); }
    button:disabled { opacity:.55; cursor:default; }
    .content { display:grid; grid-template-columns:minmax(180px, 28%) minmax(0,1fr); flex:1; min-width:0; min-height:0; overflow:hidden; }
    .list,.detail { min-width:0; min-height:0; overflow:auto; padding:12px; }
    .list { border-right:1px solid var(--mn-color-border-subtle,#ddd); }
    .agent { display:block; width:100%; padding:10px; margin-bottom:6px; text-align:left; overflow-wrap:anywhere; border-color:transparent; }
    .agent[aria-pressed=true] { border-color:var(--mn-color-border-accent,#93c5fd); background:var(--mn-color-surface-accent,#eff6ff); }
    .agent-label { display:block; font-weight:600; }
    .presence { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--mn-color-text-secondary,#64748b); }
    .dot { width:7px; height:7px; flex:none; border-radius:50%; background:var(--mn-color-text-muted,#94a3b8); }
    .presence[data-current=true] .dot { background:var(--mn-color-accent,#2563eb); }
    .detail { padding:20px; }
    .report { margin-top:16px; padding:14px; border:1px solid var(--mn-color-border-subtle,#ddd); border-radius:var(--mn-radius-md,8px); }
    .activity { margin:8px 0 12px; white-space:pre-wrap; overflow-wrap:anywhere; }
    dl { display:grid; grid-template-columns:minmax(85px,auto) minmax(0,1fr); gap:5px 12px; margin:12px 0; font-size:12px; }
    dt { color:var(--mn-color-text-secondary,#64748b); }
    dd { margin:0; overflow-wrap:anywhere; }
    code { font-family:var(--mn-font-mono,ui-monospace,monospace); font-size:11px; overflow-wrap:anywhere; }
    .state { overflow:auto; padding:24px; min-height:0; }
    .state h3 { margin-bottom:8px; }
    .error { color:var(--mn-color-danger,#b91c1c); }
    .narrow-picker { display:none; padding:12px; border-bottom:1px solid var(--mn-color-border-subtle,#ddd); }
    .narrow-picker label { display:grid; gap:5px; }
    select { width:100%; min-width:0; padding:8px; }
    @container (max-width:600px) {
      .content { grid-template-columns:minmax(0,1fr); }
      .list { display:none; }
      .narrow-picker { display:block; }
      .detail { padding:12px; }
      dl { grid-template-columns:minmax(0,1fr); gap:2px; }
      dd { margin-bottom:7px; }
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.clock = performance.now()
    // Pure clock update: no heartbeat, read, launch, acknowledgement or spend.
    this.clockTimer = setInterval(() => { this.clock = performance.now() }, 1000)
  }

  disconnectedCallback(): void {
    if (this.clockTimer !== null) clearInterval(this.clockTimer)
    this.clockTimer = null
    super.disconnectedCallback()
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
    if (changed.has('selectedAgentIri') || changed.has('graphId')) {
      const detail = this.renderRoot.querySelector<HTMLElement>('.detail')
      if (detail) { detail.scrollTop = 0; detail.scrollLeft = 0 }
    }
  }

  private nowAtServer(): number {
    return this.observedAtMs + Math.max(0, this.clock - this.receivedAtMonotonicMs)
  }

  private current(report: WfAgentStatusReport): boolean {
    return this.observedAtMs > 0 && report.reportedAtMs <= this.nowAtServer() && report.expiresAtMs > this.nowAtServer()
  }

  private select(agentIri: string): void {
    this.dispatchEvent(new CustomEvent('choreo-agent-select', { detail: { agentIri }, bubbles:true, composed:true }))
  }

  private presence(agent: WfAgentStatusSubject): TemplateResult {
    const current = agent.reports.some(report => this.current(report))
    return html`<span class="presence" data-current=${String(current)}><span class="dot" aria-hidden="true"></span>${current ? t('Recent report') : agent.reports.length ? t('Report expired') : t('No status report')}</span>`
  }

  private renderDetail(agent: WfAgentStatusSubject | undefined): TemplateResult {
    if (!agent) return html`<div class="detail"><h3>${t('Choose an Agent')}</h3><p class="muted">${t('Inspect reported work and its source. Selecting an Agent does not start or contact it.')}</p></div>`
    return html`<section class="detail" aria-label=${`Agent details: ${agent.label}`}>
      <h3>${agent.label}</h3>${this.presence(agent)}
      <dl><dt>${t('Agent identity')}</dt><dd><code>${agent.agentIri}</code></dd><dt>${t('Agent ID')}</dt><dd><code>${agent.agentId}</code></dd></dl>
      <p class="muted">${t('Status is editable graph testimony, not independently verified runtime liveness or authenticated Agent/body identity.')}</p>
      ${agent.reports.length ? agent.reports.map(report => html`<article class="report">
        <h4>${this.current(report) ? t('Reported work') : t('Expired report')}</h4>
        <p class="activity">${report.activity || t('No activity description supplied.')}</p>
        <dl>
          <dt>${t('Attribution')}</dt><dd>${report.attribution}</dd>
          <dt>${t('Reporter')}</dt><dd><code>${report.reporterPrincipal || t('Not independently bound')}</code></dd>
          <dt>${t('Body')}</dt><dd><code>${report.bodyId}</code></dd>
          <dt>${t('Session')}</dt><dd><code>${report.sessionId || t('Not linked')}</code></dd>
          <dt>${t('Reported')}</dt><dd>${new Date(report.reportedAtMs).toLocaleString(localeSource.get())}</dd>
          <dt>${t('Expires')}</dt><dd>${new Date(report.expiresAtMs).toLocaleString(localeSource.get())}</dd>
        </dl>
        ${report.runId ? html`<p class="muted">${t('Reported run (unverified):')} <code>${report.runId}</code>. Use Runs to inspect its runtime evidence.</p>` : html`<p class="muted">${t('Workflow run not linked.')}</p>`}
      </article>`) : html`<p class="activity muted">${t('This Agent has no status report in this workspace. That does not establish whether a body is running elsewhere.')}</p>`}
      ${this.conversationAvailable ? html`<p class="activity"><button @click=${()=>this.dispatchEvent(new CustomEvent('choreo-agent-conversation',{detail:{agentIri:agent.agentIri},bubbles:true,composed:true}))}>${t('Open conversation in Grapevine')}</button></p><p class="muted">${t('Grapevine will resolve an explicitly configured topic for this Agent; opening does not send a message.')}</p>` : html`<p class="activity muted">${t('Grapevine conversation navigation is unavailable in this host.')}</p>`}
    </section>`
  }

  private renderBody(): TemplateResult {
    if (this.status === 'loading') return html`<div class="state" role="status">${t('Reading Agent status…')}</div>`
    if (this.status === 'unavailable') return html`<div class="state"><h3>${t('Agent status unavailable')}</h3><p>${this.error || t('This host does not yet provide the Agent status read interface.')}</p></div>`
    if (this.status === 'error') return html`<div class="state error" role="alert"><h3>${t('Could not read Agent status')}</h3><p>${this.error}</p></div>`
    if (this.status === 'idle') return html`<div class="state"><h3>${t('Agent status has not been read')}</h3><p>${t('Refresh to read the current workspace’s accessible reports.')}</p></div>`
    if (this.status === 'empty') return html`<div class="state"><h3>${t('No Agent reports in this workspace')}</h3><p>${t('A successful read returned no reported Agents. This is not a whole-network census.')}</p></div>`
    if (!this.agents.length) return html`<div class="state error" role="alert">${t('The Agent status snapshot is incomplete. Refresh to try again.')}</div>`
    return html`
      <div class="narrow-picker"><label>${t('Agent')}<select aria-label=${t('Select Agent')} .value=${this.selectedAgentIri} @change=${(event:Event) => this.select((event.target as HTMLSelectElement).value)}><option value="">${t('Choose an Agent')}</option>${this.agents.map(agent => html`<option value=${agent.agentIri}>${agent.label}</option>`)}</select></label></div>
      <div class="content"><nav class="list" aria-label=${t('Agents in this workspace')}>${repeat(this.agents, agent=>agent.agentIri, agent=>html`<button class="agent" aria-pressed=${String(agent.agentIri===this.selectedAgentIri)} @click=${()=>this.select(agent.agentIri)}><span class="agent-label">${agent.label}</span>${this.presence(agent)}</button>`)}</nav>${this.renderDetail(this.agents.find(agent=>agent.agentIri===this.selectedAgentIri))}</div>`
  }

  render(): TemplateResult {
    return html`<section class="pane" aria-label=${t('Agent situational awareness')}>
      <header><div class="heading"><h2>${t('Agents')}</h2><p class="scope muted">Workspace: ${this.graphId || 'not bound'} · not a global roster</p>${this.observedAtMs ? html`<p class="scope muted">Read ${new Date(this.observedAtMs).toLocaleString(localeSource.get())} from ${this.source}</p>` : nothing}</div><button ?disabled=${this.status==='loading'} @click=${()=>this.dispatchEvent(new CustomEvent('choreo-agent-status-refresh', { detail:{ graphId:this.graphId }, bubbles:true, composed:true }))}>${t('Refresh status')}</button></header>
      ${this.renderBody()}
    </section>`
  }
}

declare global { interface HTMLElementTagNameMap { 'wf-agent-status-view': WfAgentStatusView } }
