import { type AgentStudioProfileV1, canonicalJson, parseAgentStudioProfile } from '@shrubbery/domain-kit/agent-studio'
import { registerRenderableComponentTags } from '@shrubbery/nucleus'
import { css, html, LitElement, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { AgentStudioApi, AgentStudioSnapshot } from './agent-studio-api.js'

type JsonSection = 'runtimes' | 'ontology' | 'tools' | 'grant' | 'budgets' | 'emanations' | 'triggers' | 'responseSchema'

const JSON_SECTIONS: readonly { key: JsonSection; title: string; description: string }[] = [
  { key: 'runtimes', title: 'Runtime profiles', description: 'Prime and emanation ceilings, bundle digest, persistence, schedules, and delegation.' },
  { key: 'ontology', title: 'Skills & harness', description: 'Exact Meaningful Object references. Digests are authority, not decoration.' },
  { key: 'tools', title: 'Tool manifest', description: 'The tools presented to the Agent, including access, risk, and destructive testimony.' },
  { key: 'grant', title: 'Tool grant', description: 'Effective authority, resource fences, approval policy, and quotas.' },
  { key: 'budgets', title: 'Domain budgets', description: 'Turn, emanation, proposed-effect, and program limits.' },
  { key: 'emanations', title: 'Delegation', description: 'Whether the lead may create bounded child Agents.' },
  { key: 'triggers', title: 'Triggers', description: 'Owner and internal-service entry points plus their source fences.' },
  { key: 'responseSchema', title: 'Response schema', description: 'The structured result contract returned by the Domain invocation.' },
]

registerRenderableComponentTags(['mn-agent-studio-editor'])

@customElement('mn-agent-studio-editor')
export class MnAgentStudioEditor extends LitElement {
  @property({ attribute: false }) api: AgentStudioApi | null = null
  @property({ type: Boolean, reflect: true, attribute: 'workspace-surface' }) workspaceSurface = false

  @state() private snapshot: AgentStudioSnapshot | null = null
  @state() private draft: AgentStudioProfileV1 | null = null
  @state() private jsonDrafts: Record<JsonSection, string> | null = null
  @state() private busy = false
  @state() private dirty = false
  @state() private publishConfirmed = false
  @state() private status = 'Loading the durable Agent profile…'
  @state() private error = ''

  private loadedApi: AgentStudioApi | null = null

  static styles = css`
    :host { display: block; color: var(--mn-color-text-primary); }
    :host([workspace-surface]) {
      box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0;
      padding: clamp(1rem, 3vw, 2.5rem); overflow: auto;
      background: var(--mn-color-surface-canvas, var(--mn-color-bg-default));
    }
    * { box-sizing: border-box; }
    .root { max-width: 1280px; margin: 0 auto; }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1rem; align-items: start; margin-bottom: 1.25rem; }
    h1 { margin: 0 0 .35rem; font: 600 clamp(1.45rem, 2.5vw, 2.15rem)/1.15 var(--mn-font-serif); }
    h2 { margin: 0 0 .35rem; font: 600 1rem/1.3 var(--mn-font-sans); }
    p { margin: 0; color: var(--mn-color-text-secondary); line-height: 1.5; }
    .eyebrow { margin-bottom: .4rem; color: var(--mn-color-text-accent-strong); font: 600 .74rem/1.2 var(--mn-font-mono); letter-spacing: .08em; text-transform: uppercase; }
    .status { min-width: 15rem; padding: .8rem 1rem; border: 1px solid var(--mn-color-border-subtle); border-radius: .75rem; background: var(--mn-color-surface-elevated, transparent); font: .78rem/1.45 var(--mn-font-mono); }
    .status strong { display: block; margin-bottom: .15rem; color: var(--mn-color-text-primary); }
    .status.error { border-color: var(--mn-color-danger-border); color: var(--mn-color-text-danger); }
    .toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: 0 0 1rem; padding: .75rem; border: 1px solid var(--mn-color-border-subtle); border-radius: .85rem; background: color-mix(in srgb, var(--mn-color-surface-canvas, #fff) 94%, transparent); backdrop-filter: blur(12px); }
    button, input, textarea, select { font: inherit; }
    button { padding: .55rem .9rem; border: 1px solid var(--mn-color-border-default); border-radius: .55rem; background: transparent; color: var(--mn-color-text-primary); cursor: pointer; }
    button.primary { border-color: var(--mn-color-border-accent); background: var(--mn-color-surface-accent); color: var(--mn-color-text-accent-strong); }
    button.danger { border-color: var(--mn-color-warning-border, var(--mn-color-border-default)); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .spacer { flex: 1; }
    .confirm { display: inline-flex; align-items: center; gap: .45rem; color: var(--mn-color-text-secondary); font-size: .82rem; white-space: nowrap; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    section { padding: 1rem; border: 1px solid var(--mn-color-border-subtle); border-radius: .9rem; background: var(--mn-color-surface-elevated, transparent); }
    section.wide { grid-column: 1 / -1; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin-top: .9rem; }
    label { display: grid; gap: .35rem; color: var(--mn-color-text-secondary); font: .76rem/1.35 var(--mn-font-sans); }
    label.wide { grid-column: 1 / -1; }
    input, textarea, select { width: 100%; padding: .62rem .7rem; border: 1px solid var(--mn-color-border-default); border-radius: .55rem; outline: none; background: var(--mn-color-surface-canvas, transparent); color: var(--mn-color-text-primary); }
    input:focus, textarea:focus, select:focus { border-color: var(--mn-color-border-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--mn-color-border-accent) 20%, transparent); }
    textarea.prose { min-height: 10rem; resize: vertical; line-height: 1.5; }
    textarea.json { min-height: 15rem; resize: vertical; font: .75rem/1.45 var(--mn-font-mono); tab-size: 2; }
    .meta { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin-top: .75rem; color: var(--mn-color-text-secondary); font: .72rem/1.4 var(--mn-font-mono); }
    code { overflow-wrap: anywhere; }
    details { margin-top: 1rem; }
    summary { cursor: pointer; color: var(--mn-color-text-secondary); }
    pre { max-height: 24rem; overflow: auto; padding: .8rem; border-radius: .55rem; background: var(--mn-color-surface-canvas, transparent); font: .7rem/1.45 var(--mn-font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 820px) { header, .grid, .fields { grid-template-columns: 1fr; } .status, section.wide, label.wide { grid-column: 1; } .status { min-width: 0; } }
  `

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('api') && this.api !== this.loadedApi) void this.reload()
  }

  render() {
    if (!this.api) return html`<div class="root"><p>This Agent Studio is available only in the trusted <code>sophia-cluster</code> workspace.</p></div>`
    const profile = this.draft
    return html`<div class="root">
      <header>
        <div>
          <div class="eyebrow">Cloud-2 · Agent Ontology</div>
          <h1>${profile?.displayName ?? 'Sophia Cluster Agent Studio'}</h1>
          <p>Author the lead Agent’s identity and authority here. Saving updates the source profile; publishing atomically advances what new Sessions resolve.</p>
        </div>
        <div class="status ${this.error ? 'error' : ''}" aria-live="polite">
          <strong>${this.error ? 'Needs attention' : this.dirty ? 'Unsaved draft' : 'Durable source'}</strong>
          ${this.error || this.status}
        </div>
      </header>
      <div class="toolbar">
        <button @click=${this.reload} ?disabled=${this.busy}>Reload</button>
        <button @click=${this.validateDraft} ?disabled=${this.busy || !profile}>Validate</button>
        <button class="primary" @click=${this.save} ?disabled=${this.busy || !profile || !this.dirty}>Save draft</button>
        <span class="spacer"></span>
        <label class="confirm"><input type="checkbox" .checked=${this.publishConfirmed} @change=${this.onPublishConfirmation}> New Sessions may use this version</label>
        <button class="danger" @click=${this.publish} ?disabled=${this.busy || !profile || this.dirty || !this.publishConfirmed}>Publish</button>
      </div>
      ${profile && this.jsonDrafts ? this.renderProfile(profile) : html`<section><p>${this.status}</p></section>`}
    </div>`
  }

  private renderProfile(profile: AgentStudioProfileV1) {
    return html`<div class="grid">
      <section class="wide">
        <h2>Identity & graph authority</h2>
        <p>The registered name mints the stable Agent identity. Changing it creates a different Agent.</p>
        <div class="fields">
          ${this.textField('Registered name', profile.registeredName, value => this.setTop('registeredName', value))}
          ${this.textField('Display name', profile.displayName, value => this.setTop('displayName', value))}
          ${this.textField('Home owner principal', profile.home.ownerPrincipal, value => this.setAddress('home', 'ownerPrincipal', value))}
          ${this.textField('Home graph', profile.home.graphId, value => this.setAddress('home', 'graphId', value))}
          ${this.textField('Grant authority owner', profile.grantAuthority.ownerPrincipal, value => this.setAddress('grantAuthority', 'ownerPrincipal', value))}
          ${this.textField('Grant authority graph', profile.grantAuthority.graphId, value => this.setAddress('grantAuthority', 'graphId', value))}
        </div>
      </section>
      ${this.proseSection('System prompt', 'Exact source prompt sealed into each published binding.', 'prompt', profile.prompt)}
      ${this.proseSection('Charter', 'Durable role, obligations, boundaries, and relationship to the human owner.', 'charter', profile.charter)}
      ${this.proseSection('Geist', 'Temperament and mode of presence, represented as an Agent Ontology object.', 'geist', profile.geist)}
      <section>
        <h2>Inference</h2><p>Provider and model bindings for the lead and its bounded emanations.</p>
        <div class="fields">
          <label>Provider<select .value=${profile.inference.provider} @change=${(event: Event) => this.setInference('provider', (event.target as HTMLSelectElement).value)}><option value="openrouter">openrouter</option><option value="openai-codex">openai-codex</option></select></label>
          ${this.textField('Pilot model', profile.inference.pilotModel, value => this.setInference('pilotModel', value))}
          ${this.textField('Emanation model', profile.inference.emanationModel, value => this.setInference('emanationModel', value), true)}
        </div>
      </section>
      ${JSON_SECTIONS.map(section => html`<section class="wide">
        <h2>${section.title}</h2><p>${section.description}</p>
        <textarea class="json" spellcheck="false" .value=${this.jsonDrafts?.[section.key] ?? ''} @input=${(event: Event) => this.setJson(section.key, (event.target as HTMLTextAreaElement).value)}></textarea>
      </section>`)}
      <section class="wide">
        <h2>Publication</h2>
        <p>The stable definition pointer is written only after every digest-addressed dependency and the cross-graph grant reread successfully.</p>
        <div class="meta">
          <span>source revision: <code>${this.snapshot?.profile.revision ?? 'not exposed'}</code></span>
          <span>source updated: <code>${this.snapshot?.profile.updatedAt ?? 'not exposed'}</code></span>
          <span>active schema: <code>${String(this.snapshot?.activeDefinition?.value.schema ?? 'not published')}</code></span>
          <span>active revision: <code>${this.snapshot?.activeDefinition?.revision ?? 'not exposed'}</code></span>
        </div>
        <details><summary>Canonical source preview</summary><pre>${this.preview()}</pre></details>
      </section>
    </div>`
  }

  private proseSection(title: string, description: string, key: 'prompt' | 'charter' | 'geist', value: string) {
    return html`<section class="wide"><h2>${title}</h2><p>${description}</p><textarea class="prose" .value=${value} @input=${(event: Event) => this.setTop(key, (event.target as HTMLTextAreaElement).value)}></textarea></section>`
  }

  private textField(label: string, value: string, update: (value: string) => void, wide = false) {
    return html`<label class=${wide ? 'wide' : ''}>${label}<input .value=${value} @input=${(event: Event) => update((event.target as HTMLInputElement).value)}></label>`
  }

  private readonly reload = async (): Promise<void> => {
    const api = this.api
    this.loadedApi = api
    if (!api) return
    await this.run('Loading durable Agent profile…', async () => {
      this.adopt(await api.load())
      this.status = 'Profile loaded. Publishing affects new Sessions only.'
    })
  }

  private readonly validateDraft = (): void => {
    try {
      parseAgentStudioProfile(this.candidate())
      this.error = ''
      this.status = 'Valid current-v2 Agent definition source.'
    } catch (error) {
      this.error = message(error)
    }
  }

  private readonly save = async (): Promise<void> => {
    if (!this.api || !this.snapshot) return
    await this.run('Saving source profile…', async () => {
      const next = await this.api!.saveDraft(this.candidate(), this.snapshot!.profile)
      this.adopt(next)
      this.status = 'Draft saved and reread from Garden.'
    })
  }

  private readonly publish = async (): Promise<void> => {
    if (!this.api || !this.snapshot || !this.publishConfirmed || this.dirty) return
    await this.run('Publishing immutable Agent dependencies…', async () => {
      const result = await this.api!.publish(this.snapshot!.profile)
      this.adopt(result.snapshot)
      this.publishConfirmed = false
      this.status = `Published ${result.publication.publicationId}; new Sessions resolve ${result.publication.agentId}.`
    })
  }

  private async run(status: string, operation: () => Promise<void>): Promise<void> {
    this.busy = true
    this.error = ''
    this.status = status
    try { await operation() } catch (error) { this.error = message(error) } finally { this.busy = false }
  }

  private adopt(snapshot: AgentStudioSnapshot): void {
    this.snapshot = snapshot
    this.draft = structuredClone(snapshot.profile.profile)
    this.jsonDrafts = jsonSections(snapshot.profile.profile)
    this.dirty = false
  }

  private candidate(): AgentStudioProfileV1 {
    if (!this.draft || !this.jsonDrafts) throw new Error('Agent profile is not loaded')
    const candidate = structuredClone(this.draft) as unknown as Record<string, unknown>
    for (const section of JSON_SECTIONS) {
      try { candidate[section.key] = JSON.parse(this.jsonDrafts[section.key]) } catch { throw new Error(`${section.title} is not valid JSON`) }
    }
    return parseAgentStudioProfile(candidate)
  }

  private preview(): string {
    try { return canonicalJson(this.candidate()) } catch (error) { return message(error) }
  }

  private setTop(key: 'registeredName' | 'displayName' | 'prompt' | 'charter' | 'geist', value: string): void {
    if (!this.draft) return
    this.draft = { ...this.draft, [key]: value }
    this.changed()
  }

  private setAddress(key: 'home' | 'grantAuthority', field: 'ownerPrincipal' | 'graphId', value: string): void {
    if (!this.draft) return
    this.draft = { ...this.draft, [key]: { ...this.draft[key], [field]: value } }
    this.changed()
  }

  private setInference(key: 'provider' | 'pilotModel' | 'emanationModel', value: string): void {
    if (!this.draft) return
    this.draft = { ...this.draft, inference: { ...this.draft.inference, [key]: value } } as AgentStudioProfileV1
    this.changed()
  }

  private setJson(key: JsonSection, value: string): void {
    if (!this.jsonDrafts) return
    this.jsonDrafts = { ...this.jsonDrafts, [key]: value }
    this.changed()
  }

  private changed(): void {
    this.dirty = true
    this.publishConfirmed = false
    this.error = ''
    this.status = 'Save and reread this source draft before publishing.'
  }

  private readonly onPublishConfirmation = (event: Event): void => {
    this.publishConfirmed = (event.target as HTMLInputElement).checked
  }
}

function jsonSections(profile: AgentStudioProfileV1): Record<JsonSection, string> {
  return Object.fromEntries(JSON_SECTIONS.map(({ key }) => [key, JSON.stringify(profile[key], null, 2)])) as Record<JsonSection, string>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare global {
  interface HTMLElementTagNameMap { 'mn-agent-studio-editor': MnAgentStudioEditor }
}
