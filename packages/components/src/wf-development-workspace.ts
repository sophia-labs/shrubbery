/** Controlled pane. The application owns transport, document leases and execution. */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { keyed } from 'lit/directives/keyed.js'
import type { DevelopmentWorkspaceViewState, DevelopmentWorkspaceIntent, DevelopmentRun, DevelopmentFile } from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import './wf-development-ide.js'

function short(value?: string | null): string { return value ? (value.length > 18 ? `${value.slice(0, 15)}…` : value) : 'Not recorded' }
function date(value: string): string { return Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString() }

@customElement('wf-development-workspace')
export class WfDevelopmentWorkspace extends SkinAware(LitElement) {
  @property({ attribute: false }) state: DevelopmentWorkspaceViewState | null = null
  static styles = css`
    :host { display:block; height:100%; min-height:0; color:var(--mn-color-text-primary,#25332a); background:var(--mn-color-surface-base,#fff); font:13px var(--mn-font-chrome,system-ui,sans-serif); }
    * { box-sizing:border-box; } .workspace { height:100%; display:flex; flex-direction:column; }
    header { padding:16px 20px; border-bottom:1px solid var(--mn-color-border-subtle,#dfe5dc); display:flex; flex-wrap:wrap; align-items:center; gap:14px; }
    h2 { font-size:17px; font-weight:600; margin:0 0 5px; } .identity { flex:1; min-width:150px; }
    .eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:var(--mn-color-text-tertiary,#647462); margin-bottom:6px; }
    .muted { color:var(--mn-color-text-tertiary,#69746c); font-size:11px; line-height:1.6; } .mono,code,pre { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
    button,select { color:inherit; font:inherit; border:1px solid var(--mn-color-border-subtle,#d8dfd4); border-radius:5px; background:var(--mn-color-surface-base,#fff); padding:7px 10px; }
    button { cursor:pointer; } button:hover { background:var(--mn-color-panel-bg,#f0f5ee); } button:disabled { cursor:default; opacity:.5; }
    button:focus-visible,select:focus-visible { outline:2px solid var(--mn-color-accent,#598263); outline-offset:2px; }
    .primary { background:var(--mn-color-accent,#426c47); color:white; border-color:transparent; } .actions { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
    label { display:grid; gap:5px; font-size:11px; color:var(--mn-color-text-tertiary,#69746c); } select { max-width:260px; color:var(--mn-color-text-primary,#25332a); }
    .columns { min-height:0; flex:1; display:grid; grid-template-columns:210px minmax(250px,1fr) 265px; }
    .tree { border-right:1px solid var(--mn-color-border-subtle,#dfe5dc); background:var(--mn-color-panel-bg,#fafbf8); overflow:auto; padding:17px 10px; }
    .tree h3,.side h3 { font-size:11px; text-transform:uppercase; letter-spacing:.07em; font-weight:600; margin:0 0 12px; } .tree h3 { margin-left:8px; }
    .file { border:0; display:block; text-align:left; width:100%; padding:10px 9px; margin:3px 0; overflow-wrap:anywhere; }
    .file[aria-current=true] { background:var(--mn-color-accent-subtle,#e5eee0); color:var(--mn-color-accent,#345f3d); } .file-kind { display:block; font-size:10px; opacity:.65; margin-top:3px; }
    main { overflow:auto; padding:20px; min-width:0; } .file-heading { display:flex; justify-content:space-between; align-items:start; gap:12px; margin-bottom:18px; }
    .file-heading h3 { margin:0 0 4px; font-size:15px; overflow-wrap:anywhere; } .cell { margin:0 0 22px; }
    .cell-bar { display:flex; align-items:center; gap:8px; margin-bottom:7px; } .cell-bar .caption { flex:1; font-size:12px; }
    .side { overflow:auto; border-left:1px solid var(--mn-color-border-subtle,#dfe5dc); padding:19px 16px; background:var(--mn-color-panel-bg,#fafbf8); }
    .side section + section { margin-top:26px; padding-top:20px; border-top:1px solid var(--mn-color-border-subtle,#dfe5dc); }
    .participant { margin:12px 0; } .participant strong { font-size:12px; font-weight:600; } .badge { font-size:10px; padding:2px 5px; border-radius:3px; background:var(--mn-color-accent-subtle,#eaf0e6); white-space:nowrap; }
    dl { margin:13px 0; font-size:11px; line-height:1.5; } dt { color:var(--mn-color-text-tertiary,#6b756e); margin-top:9px; } dd { margin:2px 0 0; overflow-wrap:anywhere; }
    .run { border-left:2px solid var(--mn-color-accent,#779572); margin:10px 0; padding:8px 12px; background:var(--mn-color-panel-bg,#f7f9f5); }
    .run-heading { display:flex; gap:8px; justify-content:space-between; align-items:center; font-size:11px; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; line-height:1.6; max-height:320px; overflow:auto; }
    details { font-size:11px; margin-top:8px; } summary { cursor:pointer; color:var(--mn-color-text-tertiary,#69746c); } .stale { color:var(--mn-color-warning,#8b641d); }
    .notice { margin:0; padding:9px 20px; font-size:12px; background:var(--mn-color-panel-bg,#f5f7f1); } .error { color:var(--mn-color-danger,#a13535); }
    .empty { padding:35px 20px; color:var(--mn-color-text-tertiary,#69746c); line-height:1.7; } time { font-variant-numeric:tabular-nums; }
    @media(max-width:1050px) { .columns { grid-template-columns:170px minmax(220px,1fr); } .side { grid-column:1 / -1; display:grid; grid-template-columns:1fr 1fr; gap:20px; border-top:1px solid #dfe5dc; max-height:240px; } .side section + section { margin:0; padding:0; border:0; } }
    @media(max-width:600px) { header { padding:12px; } .columns { display:flex; flex-direction:column; overflow:auto; } .tree { max-height:150px; flex-shrink:0; border-bottom:1px solid #dfe5dc; } main { overflow:visible; padding:14px; } .side { display:block; max-height:none; overflow:visible; } .side section + section { margin-top:22px; } }
  `
  private intent(action: DevelopmentWorkspaceIntent['action'], id?: string): void {
    this.dispatchEvent(new CustomEvent<DevelopmentWorkspaceIntent>('development-workspace-intent', { detail:{ action,...(id ? {id} : {}) }, bubbles:true, composed:true }))
  }
  private editor(file: DevelopmentFile, blockId: string, language: string, label: string): TemplateResult {
    const binding = this.state?.document
    if (!binding || binding.documentId !== file.documentId) return html`<p class="muted">Opening Garden document…</p>`
    return html`<sh-development-code-editor .provider=${binding.provider} .blockId=${blockId} .language=${language} .label=${label}></sh-development-code-editor>`
  }
  private run(run: DevelopmentRun): TemplateResult {
    return html`<article class="run" data-run-id=${run.id} aria-label="Recorded cell result">
      <div class="run-heading"><span>${run.status} · <time datetime=${run.startedAt}>${date(run.startedAt)}</time></span>${run.stale ? html`<span class="stale">Inputs changed</span>` : nothing}</div>
      <pre>${run.output || '(No textual output)'}</pre>
      <div class="muted">Kernel ${short(run.kernelId)} · generation ${run.kernelGeneration}${run.kernelRecovery ? html` · ${run.kernelRecovery}` : nothing}</div>
      <details><summary>Prepared source · ${short(run.checkpointId)}</summary><dl><dt>Execution</dt><dd>${run.id}</dd><dt>Cell source version</dt><dd>${run.sourceVersion}</dd><dt>Checkpoint</dt><dd>${run.checkpointId}</dd><dt>Source integrity at execution boundaries</dt><dd>${run.sourceIntegrity ?? 'Unknown'}</dd>${run.consumedFiles.map(file => html`<dt>${file.path}</dt><dd>${file.version}</dd>`)}</dl></details>
    </article>`
  }
  private file(file: DevelopmentFile): TemplateResult {
    const state = this.state!
    return html`<div class="file-heading"><div><h3 class="mono">${file.path}</h3><div class="muted">Garden document ${file.documentId}</div></div><span class="badge">${file.syncState ?? 'Synchronization unknown'}</span></div>
      <div class="file-content">${keyed(`${state.selectedRiftId}:${file.documentId}`, file.kind === 'notebook'
        ? html`<div class="notebook">${repeat(file.cells ?? [], cell => cell.id, (cell,index) => html`<section class="cell" data-cell-id=${cell.id}>
          <div class="cell-bar"><span class="caption">${cell.title ?? `${cell.kind === 'narrative' ? 'Notes' : 'Cell'} ${index+1}`} <span class="muted">· ${cell.language}</span></span>${cell.kind === 'code' ? html`<button class="primary" aria-label=${`Run ${cell.title ?? cell.id}`} ?disabled=${!!state.pending || !state.document} @click=${() => this.intent('execute',cell.id)}>Run cell</button>` : nothing}</div>
          ${this.editor(file,cell.blockId,cell.language,`${file.path}: ${cell.title ?? cell.id}`)}
          ${repeat(state.workspace?.runs.filter(run => run.notebookDocumentId === file.documentId && run.cellId === cell.id).sort((a,b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0)) ?? [],run => run.id,run => this.run(run))}
        </section>`)}</div>`
        : file.blockId ? this.editor(file,file.blockId,file.language ?? '',file.path) : html`<p class="error">This file has no Garden source block identity.</p>`)}</div>
    `
  }
  render(): TemplateResult {
    const state = this.state
    if(state?.ide)return html`<wf-development-ide .state=${state}></wf-development-ide>`
    if (!state) return html`<div class="empty"><h2>Development workspace</h2>Connect a development service to browse this project’s Rifts and shared Garden files.</div>`
    const workspace = state.workspace
    const file = workspace?.files.find(file => file.id === state.selectedFileId)
    const environment = workspace?.environments.find(item => item.id === state.selectedEnvironmentId) ?? workspace?.environments[0]
    return html`<section class="workspace" aria-label="Development workspace"><header>
      <div class="identity"><div class="eyebrow">Development workspace</div><h2>${workspace?.rift.project ?? 'Projects and Rifts'}</h2><div class="muted">Canonical base <span class="mono" title=${workspace?.rift.baseRevision ?? ''}>${short(workspace?.rift.baseRevision)}</span> · checkpoint <span class="mono" title=${workspace?.rift.checkpointId ?? ''}>${short(workspace?.rift.checkpointId)}</span></div></div>
      <label>Working Rift<select aria-label="Working Rift" .value=${state.selectedRiftId} ?disabled=${!!state.pending} @change=${(event:Event) => this.intent('select-rift',(event.target as HTMLSelectElement).value)}>${state.rifts.length ? state.rifts.map(rift => html`<option value=${rift.id} ?selected=${rift.id === state.selectedRiftId}>${rift.name}</option>`) : html`<option value="">No Rifts available</option>`}</select></label>
      <div class="actions"><button ?disabled=${!!state.pending} @click=${() => this.intent('refresh')}>Refresh</button><button ?disabled=${!!state.pending || !workspace} @click=${() => this.intent('synchronize')}>Synchronize</button><button ?disabled=${!!state.pending || !workspace} @click=${() => this.intent('checkpoint')}>Checkpoint</button></div>
    </header>${state.error ? html`<p class="notice error" role="alert">${state.error}</p>` : nothing}${state.pending ? html`<p class="notice" role="status">${state.pending}…</p>` : nothing}
    <div class="columns"><nav class="tree" aria-label="Rift files"><h3>Files & notebooks</h3>${workspace?.files.map(file => html`<button class="file" data-file-id=${file.id} aria-current=${String(file.id === state.selectedFileId)} ?disabled=${!!state.pending} @click=${() => this.intent('select-file',file.id)}><span class="mono">${file.path}</span><span class="file-kind">${file.kind === 'notebook' ? `${file.cells?.length ?? 0} notebook cells` : file.language ?? 'Text source'}${file.syncState === 'conflict' ? ' · conflict' : ''}</span></button>`)}${workspace && !workspace.files.length ? html`<p class="muted">No enrolled files.</p>` : nothing}</nav>
    <main>${file ? this.file(file) : html`<div class="empty">${state.status === 'loading' ? 'Opening workspace…' : 'Select a file or notebook to open its shared Garden document.'}</div>`}</main>
    <aside class="side"><section><h3>Participants</h3>${workspace?.participants.length ? workspace.participants.map(person => html`<div class="participant"><strong>${person.name}</strong> <span class="badge">${person.kind}</span><div class="muted">${person.task ?? 'No task recorded'}</div><div>${person.status}</div><time class="muted" datetime=${person.observedAt}>${date(person.observedAt)}</time></div>`) : html`<p class="muted">No participant observations recorded.</p>`}${workspace?.kernelStatus ? html`<p class="muted">Kernel: ${workspace.kernelStatus}</p>` : nothing}</section>
    <section><h3>Environment</h3><label>Cluster · component<select aria-label="Observed environment" .value=${environment?.id ?? ''} @change=${(event:Event) => this.intent('select-environment',(event.target as HTMLSelectElement).value)}>${workspace?.environments.map(env => html`<option value=${env.id} ?selected=${env.id === environment?.id}>${env.cluster} · ${env.component}</option>`)}</select></label>
      ${environment ? html`<dl><dt>Desired release</dt><dd>${environment.desiredRelease ?? 'Not recorded'}</dd><dt>Observed serving artifact</dt><dd>${environment.servingArtifact ?? 'Not observed'}</dd><dt>Source revision</dt><dd class="mono">${environment.sourceRevision ?? 'Unknown'}</dd><dt>Rollout</dt><dd>${environment.rolloutStatus}</dd><dt>Observed by ${environment.observer}</dt><dd><time datetime=${environment.observedAt}>${date(environment.observedAt)}</time></dd></dl>${environment.deploymentHistory?.length ? html`<details><summary>Deployment history (${environment.deploymentHistory.length})</summary>${environment.deploymentHistory.map(item => html`<dl><dt><time datetime=${item.observedAt}>${date(item.observedAt)}</time> · ${item.status}</dt><dd>${item.artifact}</dd><dd>${item.riftId ?? 'Rift unknown'} · ${item.checkpointId ?? 'Checkpoint unknown'}</dd></dl>`)}</details>` : html`<p class="muted">No deployment history recorded.</p>`}` : html`<p class="muted">No environment observations recorded.</p>`}
    </section></aside></div></section>`
  }
}
declare global { interface HTMLElementTagNameMap { 'wf-development-workspace': WfDevelopmentWorkspace } }
