/** Read-only agent dossier: source-backed identity, ontology, and mode exposure. */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { agentMark } from '@shrubbery/nucleus/kinds'
import { type ChoreoAgent, type ChoreoMode, type ChoreoToolDescriptor, isToolEffective } from './choreo-modes-model.js'

function labelForMode(modes: readonly ChoreoMode[], iri: string): string {
  return modes.find(mode => mode.iri === iri)?.label ?? iri.split(':').at(-1) ?? iri
}

@customElement('choreo-agent-profile')
export class ChoreoAgentProfile extends LitElement {
  @property({ attribute: false }) agent: ChoreoAgent | null = null
  @property({ attribute: false }) modes: readonly ChoreoMode[] = []
  @property({ attribute: false }) catalogue: readonly ChoreoToolDescriptor[] = []
  @property({ type: String }) graphId = ''

  static styles = css`
    :host { display:block; min-width:0; color:var(--mn-color-text-primary,#18211b); font:13px/1.45 var(--mn-font-chrome,system-ui,sans-serif); }
    * { box-sizing:border-box; }
    h2,h3,p,dl,dd,ul { margin:0; }
    .dossier { display:grid; gap:19px; min-width:0; }
    .hero { display:grid; grid-template-columns:74px minmax(0,1fr); gap:16px; align-items:center; padding-bottom:17px; border-bottom:1px solid var(--mn-color-border-subtle,#d8ded9); }
    .mark { display:grid; place-items:center; width:74px; height:74px; border:1px solid color-mix(in srgb,var(--agent-color) 48%,transparent); border-radius:22px; background:color-mix(in srgb,var(--agent-color) 18%,var(--mn-color-surface-raised,#fff)); color:var(--agent-color); font:650 34px/1 var(--mn-font-display,Georgia,serif); }
    .eyebrow { display:block; margin-bottom:4px; color:var(--mn-color-text-muted,#66736a); font:700 10px/1.2 var(--mn-font-utility,system-ui,sans-serif); letter-spacing:.1em; text-transform:uppercase; }
    h2 { font:650 clamp(25px,3vw,34px)/1.12 var(--mn-font-display,Georgia,serif); letter-spacing:-.035em; }
    .role { margin-top:4px; color:var(--mn-color-text-accent-strong,#376d57); font-weight:650; }
    .summary { color:var(--mn-color-text-secondary,#58665c); line-height:1.55; }
    .source { color:var(--mn-color-text-muted,#66736a); font-size:11px; }
    .source strong { color:var(--mn-color-text-secondary,#58665c); }
    .identity { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .identity > div { min-width:0; padding:11px 12px; border:1px solid var(--mn-color-border-subtle,#d8ded9); border-radius:11px; background:var(--mn-color-surface-base,#fafcf9); }
    .identity dt { margin-bottom:4px; color:var(--mn-color-text-muted,#66736a); font:700 10px/1.2 var(--mn-font-utility,system-ui,sans-serif); letter-spacing:.06em; text-transform:uppercase; }
    .identity dd { overflow-wrap:anywhere; font-weight:550; }
    code { font:11px/1.4 var(--mn-font-mono,ui-monospace,monospace); overflow-wrap:anywhere; }
    section { min-width:0; }
    .section-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:10px; }
    h3 { font:650 16px/1.2 var(--mn-font-display,Georgia,serif); }
    .section-head small { color:var(--mn-color-text-muted,#66736a); font-size:11px; }
    .stat-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
    .stat { min-width:0; padding:11px; border:1px solid var(--mn-color-border-subtle,#d8ded9); border-radius:11px; }
    .stat strong { display:block; overflow-wrap:anywhere; font:650 15px/1.2 var(--mn-font-display,Georgia,serif); }
    .stat small { color:var(--mn-color-text-muted,#66736a); font-size:10px; }
    .mode-note,.empty { margin-top:9px; color:var(--mn-color-text-secondary,#58665c); font-size:11px; }
    .tool-list,.object-list { list-style:none; padding:0; display:grid; gap:7px; }
    .tool-list li,.object-list li { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 10px; align-items:start; min-width:0; padding:9px 11px; border:1px solid var(--mn-color-border-subtle,#d8ded9); border-radius:10px; }
    .tool-list strong,.object-list strong { font-size:12px; overflow-wrap:anywhere; }
    .tool-list p { grid-column:1/-1; color:var(--mn-color-text-secondary,#58665c); font-size:11px; overflow-wrap:anywhere; }
    .tag { padding:2px 6px; border-radius:6px; background:var(--mn-color-surface-accent,#edf6ef); color:var(--mn-color-text-accent-strong,#376d57); font:700 10px/1.2 var(--mn-font-utility,system-ui,sans-serif); text-transform:uppercase; }
    .tag.write { background:var(--mn-color-surface-warning,#fff3d7); color:var(--mn-color-text-warning,#875c1a); }
    .object-list code { grid-column:1/-1; color:var(--mn-color-text-secondary,#58665c); }
    .mode-list { display:flex; flex-wrap:wrap; gap:6px; padding:0; list-style:none; }
    .mode-list li { padding:4px 8px; border:1px solid var(--mn-color-border-subtle,#d8ded9); border-radius:999px; font-size:11px; }
    .mode-list li[data-default='true'] { border-color:var(--mn-color-border-focus,#39765a); background:var(--mn-color-surface-accent,#edf6ef); }
    @media(max-width:500px) { .hero { grid-template-columns:60px minmax(0,1fr); gap:12px; } .mark { width:60px; height:60px; border-radius:17px; font-size:29px; } .identity,.stat-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  `

  private objectRows(): readonly [string, string][] {
    const ontology = this.agent?.dossier?.ontology
    if (!ontology) return []
    const rows: [string, string][] = []
    for (const [kind, id] of [
      ['Geist', ontology.geist], ['Prompt', ontology.prompt], ['Harness', ontology.harness],
      ['Tool manifest', ontology.toolManifest], ['Tool grant', ontology.toolGrant],
      ['Runtime profile', ontology.runtimeProfile],
    ] as const) if (id) rows.push([kind, id])
    for (const skill of ontology.skills ?? []) rows.push(['Skill', skill])
    return rows
  }

  render(): TemplateResult {
    const agent = this.agent
    if (!agent) return html`<p class="empty">Select an agent to inspect its profile.</p>`
    const dossier = agent.dossier
    const mark = agentMark(agent.agentId)
    const defaultMode = this.modes.find(mode => mode.iri === agent.defaultMode)
    const byName = new Map(this.catalogue.map(tool => [tool.name, tool]))
    const effective = defaultMode ? defaultMode.allowsTools
      .map(name => byName.get(name))
      .filter((tool): tool is ChoreoToolDescriptor => isToolEffective(tool, defaultMode.access)) : []
    const approvalCount = defaultMode?.requiresApproval.filter(name => effective.some(tool => tool.name === name)).length ?? 0
    const rows = this.objectRows()
    return html`<article class="dossier" aria-label=${`Agent dossier: ${agent.label ?? agent.agentId}`}>
      <header class="hero">
        <span class="mark" style=${`--agent-color:${mark.color}`} aria-label=${`Botanical mark: ${mark.colorName}`}>${(agent.label ?? agent.agentId).slice(0,1).toLocaleUpperCase()}</span>
        <div><span class="eyebrow">Agent · ${mark.colorName}</span><h2>${agent.label ?? agent.agentId}</h2>
          ${dossier?.role ? html`<p class="role">${dossier.role}</p>` : nothing}</div>
      </header>
      ${dossier?.summary ? html`<p class="summary">${dossier.summary}</p>` : nothing}
      <p class="source">Profile evidence: <strong>${dossier?.sourceLabel ?? 'Mode graph only'}</strong></p>
      <dl class="identity">
        <div><dt>Identity</dt><dd><code>${agent.agentId}</code></dd></div>
        <div><dt>Workspace</dt><dd>${dossier?.homeGraphId || this.graphId || 'Unspecified'}</dd></div>
        <div><dt>Agent IRI</dt><dd><code>${agent.iri}</code></dd></div>
        <div><dt>Model</dt><dd>${dossier?.model ?? 'Not available from mode graph'}</dd></div>
      </dl>
      <section aria-label="Operating surface"><div class="section-head"><h3>Operating surface</h3><small>Configured mode</small></div>
        <div class="stat-grid">
          <div class="stat"><strong>${defaultMode?.label ?? 'None'}</strong><small>Default mode</small></div>
          <div class="stat"><strong>${effective.length}</strong><small>Exposed catalogue tools</small></div>
          <div class="stat"><strong>${approvalCount}</strong><small>Approval gates</small></div>
        </div>
        <p class="mode-note">A mode limits what a session may see. The runtime grant may narrow access further.</p>
        ${effective.length ? html`<ul class="tool-list">${effective.map(tool => html`<li><strong>${tool.name}</strong><span class="tag ${tool.effect}">${tool.effect}</span><p>${tool.description || 'No tool description in the live catalogue.'}</p></li>`)}</ul>`
          : html`<p class="empty">No effective tools are visible through the default mode.</p>`}
      </section>
      <section aria-label="Mode permissions"><div class="section-head"><h3>Mode permissions</h3><small>${agent.mayUseModes.length} configured</small></div>
        <ul class="mode-list">${agent.mayUseModes.map(iri => html`<li data-default=${String(iri === agent.defaultMode)}>${labelForMode(this.modes, iri)}${iri === agent.defaultMode ? ' · default' : ''}</li>`)}</ul>
      </section>
      <section aria-label="Ontology binding"><div class="section-head"><h3>Ontology binding</h3><small>${rows.length ? 'Referenced objects' : 'Not served'}</small></div>
        ${rows.length ? html`<ul class="object-list">${rows.map(([kind, id]) => html`<li><strong>${kind}</strong><code>${id}</code></li>`)}</ul>`
          : html`<p class="empty">This workspace only served the Agent identity and mode assignments. Charter, skills, harness, Geist, and runtime bindings are not available in this read.</p>`}
      </section>
    </article>`
  }
}

declare global { interface HTMLElementTagNameMap { 'choreo-agent-profile': ChoreoAgentProfile } }
