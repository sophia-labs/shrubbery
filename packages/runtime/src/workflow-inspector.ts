/**
 * `<sh-workflow-inspector .plan=${plan}>`: the right sidebar of a workflow, which explains whatever the canvas has
 * selected (Vera, 2026-10-19: "information in the right sidebar that is contextual to what is going on").
 *
 * | selected      | what it shows                                                                                  |
 * |---------------|------------------------------------------------------------------------------------------------|
 * | nothing       | the workflow: whether it can run, its problems, Run, the last run, the order of work, who changed it, its digest |
 * | a person      | their instructions in full, how they work, what they read and hand on; after a run, how it went |
 * | a check       | the same, and what it passed and what it refused, and why                                       |
 * | a stack       | the shape of one item, then the items as cards, each with a way to see it in its document       |
 * | a source      | the document and the section; open it                                                           |
 * | a destination | what it receives; Publish; what is already published                                            |
 *
 * Every effect is the host's: selecting (`onSelect`), running, publishing, opening a document.
 */

import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import type {
  WorkflowAuthoringView, WorkflowDestinationView, WorkflowPlanOptions, WorkflowPlanStepView, WorkflowSourceView, WorkflowStackView,
} from './render-workspace.js'
import { humanName, nodeKey, stepModeWords, stepRunState } from './workflow-scene.js'

const ITEMS_SHOWN = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function when(at: string | null | undefined): string {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? copied(value) : JSON.stringify(value)
}

/** Text an agent copied JSON-escaped (`\\n` for a soft wrap), as a person reads it. */
function copied(value: string): string {
  return value.replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim()
}

export class ShWorkflowInspector extends LitElement {
  static override properties = { plan: { attribute: false } }
  declare plan: WorkflowPlanOptions | null

  constructor() {
    super()
    this.plan = null
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px) var(--mn-space-4, 16px) var(--mn-space-6, 32px);
      font-family: var(--mn-font-chrome);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
      color: var(--mn-color-text-primary);
      background: var(--mn-color-surface-panel, transparent);
    }
    .eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mn-color-text-secondary); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .back { font: inherit; letter-spacing: 0; text-transform: none; border: 0; background: none; color: var(--mn-color-text-secondary); cursor: pointer; padding: 0; }
    .back:hover { color: var(--mn-color-text-primary); text-decoration: underline; }
    h1 { font: 600 18px/1.25 var(--mn-font-chrome); margin: 4px 0 2px; overflow-wrap: anywhere; }
    .sub { color: var(--mn-color-text-secondary); }
    section { margin-top: 18px; }
    h2 { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mn-color-text-secondary); font-weight: 600; margin: 0 0 6px; }
    p { margin: 0 0 6px; }
    .status { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mn-color-border-default); flex: none; }
    .dot[data-tone='ready'] { background: var(--mn-color-success-border); }
    .dot[data-tone='invalid'], .dot[data-tone='error'] { background: var(--mn-color-danger-border); }
    .dot[data-tone='running'] { background: var(--mn-color-warning-border); }
    .problems { margin: 0; padding: 0; list-style: none; }
    .problems li { border-left: 2px solid var(--mn-color-danger-border); padding: 2px 0 2px 8px; margin: 4px 0; }
    .problems button { margin-left: 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
      padding: 1px 8px; border-radius: 999px; border: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-raised); color: inherit; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip:hover { border-color: var(--mn-color-border-accent); }
    .chip[data-kind='source'], .chip[data-kind='destination'] { border-style: double; border-width: 3px; padding: 0 7px; }
    .chip[data-kind='check'] { border-left: 3px solid var(--mn-color-text-danger); }
    .instructions { white-space: pre-wrap; font-family: var(--mn-font-serif, Georgia, serif); font-size: 14px; line-height: 1.5; margin: 0;
      padding: 10px 12px; border-radius: var(--mn-radius-control, 6px); background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-subtle); }
    .fields { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 10px; font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 12px; }
    .action {
      font: 600 13px var(--mn-font-chrome); padding: 7px 14px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--mn-color-accent); background: var(--mn-color-accent); color: var(--mn-color-text-on-accent, #fff);
    }
    .action:hover:not([disabled]) { background: var(--mn-color-accent-hover, var(--mn-color-accent)); }
    .action[disabled] { opacity: .45; cursor: default; }
    .quiet { font: inherit; border: 1px solid var(--mn-color-border-default); background: var(--mn-color-surface-raised); color: inherit; border-radius: var(--mn-radius-control, 6px); padding: 3px 10px; cursor: pointer; }
    .quiet:hover { border-color: var(--mn-color-border-accent); }
    .link { font: inherit; border: 0; background: none; padding: 0; color: var(--mn-color-text-accent, var(--mn-color-accent)); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    .item { border: 1px solid var(--mn-color-border-subtle); border-radius: var(--mn-radius-control, 6px); padding: 8px 10px; margin: 8px 0; background: var(--mn-color-surface-raised); }
    .item blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid var(--mn-color-border-default); font-family: var(--mn-font-serif, Georgia, serif); font-size: 13.5px; }
    .item .note { margin: 0 0 4px; }
    .item dl { display: grid; grid-template-columns: max-content 1fr; gap: 1px 8px; margin: 0 0 4px; font-size: 12px; }
    .item dt { color: var(--mn-color-text-secondary); }
    .item dd { margin: 0; overflow-wrap: anywhere; }
    .item .n { float: right; color: var(--mn-color-text-secondary); font-variant-numeric: tabular-nums; font-size: 11px; }
    .refusal { border-left: 2px solid var(--mn-color-danger-border); }
    .event { margin: 6px 0; }
    .event .who { font-weight: 600; }
    .event .at { color: var(--mn-color-text-secondary); font-size: 11.5px; }
    .order { margin: 0; padding-left: 20px; }
    .order li { margin: 3px 0; }
    code { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 11.5px; overflow-wrap: anywhere; }
    .tally { font-variant-numeric: tabular-nums; }
  `

  private select(key: string | null): void {
    this.plan?.onSelect?.(key)
  }

  override render() {
    const plan = this.plan
    if (!plan) return nothing
    const key = plan.selected ?? null
    const [kind, id] = key ? [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)] : [null, null]
    if (kind === 'step' || kind === 'refused') {
      const step = plan.steps.find((s) => s.id === id)
      if (step) return this.renderStep(plan, step)
    }
    if (kind === 'stack') {
      const stack = plan.stacks?.find((s) => s.id === id) ?? { id: id!, producer: null, fields: [] }
      return this.renderStack(plan, stack)
    }
    if (kind === 'source') {
      const source = plan.sources?.find((s) => s.id === id)
      if (source) return this.renderSource(plan, source)
    }
    if (kind === 'destination') {
      const destination = plan.destinations?.find((d) => d.id === id)
      if (destination) return this.renderDestination(plan, destination)
    }
    return this.renderOverview(plan)
  }

  private eyebrow(what: string): TemplateResult {
    return html`<div class="eyebrow"><span>${what}</span><button class="back" @click=${() => this.select(null)}>The whole workflow</button></div>`
  }

  private chip(key: string, label: string, kind: string): TemplateResult {
    return html`<button class="chip" data-kind=${kind} title=${label} @click=${() => this.select(key)}>${label}</button>`
  }

  private stepChip(plan: WorkflowPlanOptions, stepId: string): TemplateResult {
    const step = plan.steps.find((s) => s.id === stepId)
    return this.chip(nodeKey.step(stepId), step?.label ?? stepId, step?.checks ? 'check' : 'step')
  }

  private problemList(problems: readonly string[]): TemplateResult | typeof nothing {
    if (problems.length === 0) return nothing
    return html`<section><h2>What keeps it from running</h2><ul class="problems">${problems.map((p) => html`<li>${p}</li>`)}</ul></section>`
  }

  private runButton(plan: WorkflowPlanOptions): TemplateResult {
    const running = plan.run?.status === 'running'
    const canRun = plan.status === 'ready' && Boolean(plan.digest) && !running
    return html`<button class="action" ?disabled=${!canRun} @click=${() => plan.onRun?.()}>${running ? 'Running…' : plan.run ? 'Run this version again' : 'Approve and run this version'}</button>`
  }

  private publishButton(plan: WorkflowPlanOptions, destination: WorkflowDestinationView | null): TemplateResult | typeof nothing {
    const publish = plan.publish
    if (!publish || publish.count === 0) return nothing
    if (publish.status === 'done') return publish.message ? html`<p class="sub">${publish.message}</p>` : nothing
    if (destination && publish.destination && publish.destination !== destination.id) return nothing
    const where = destination?.label ?? (plan.destinations?.find((d) => d.id === publish.destination)?.label ?? 'the margin')
    return html`<p><button class="action" ?disabled=${publish.status === 'publishing'} @click=${() => plan.onPublish?.(destination?.id ?? publish.destination)}>${publish.status === 'publishing'
      ? 'Publishing…' : `Publish ${publish.count} to ${where}`}</button></p>
      ${publish.message ? html`<p class="sub">${publish.message}</p>` : nothing}`
  }

  private renderOverview(plan: WorkflowPlanOptions): TemplateResult {
    const running = plan.run?.status === 'running'
    const tone = running ? 'running' : plan.status
    const statusWords = running ? 'Running'
      : plan.status === 'loading' ? 'Reading the workflow…'
        : plan.status === 'error' ? `Could not read it: ${plan.error ?? ''}`
          : plan.status === 'invalid' ? (plan.steps.length === 0 ? 'Empty: nothing to run yet' : 'Not runnable yet')
            : 'Ready to run'
    // Every problem, with the part it is about.
    const named: { key: string; label: string; problem: string }[] = []
    for (const step of plan.steps) for (const p of step.problems ?? []) named.push({ key: nodeKey.step(step.id), label: step.label, problem: p })
    for (const source of plan.sources ?? []) for (const p of source.problems ?? []) named.push({ key: nodeKey.source(source.id), label: source.label, problem: p })
    for (const stack of plan.stacks ?? []) for (const p of stack.problems ?? []) named.push({ key: nodeKey.stack(stack.id), label: humanName(stack.id), problem: p })
    for (const d of plan.destinations ?? []) for (const p of d.problems ?? []) named.push({ key: nodeKey.destination(d.id), label: d.label, problem: p })
    const phases = plan.phases ?? []
    return html`
      <div class="eyebrow"><span>Workflow</span></div>
      <h1>${plan.title}</h1>
      <div class="status"><span class="dot" data-tone=${tone}></span><span>${statusWords}</span></div>
      ${(plan.problems?.length ?? 0) + named.length > 0 ? html`<section><h2>What keeps it from running</h2><ul class="problems">
        ${(plan.problems ?? []).map((p) => html`<li>${p}</li>`)}
        ${named.map((n) => html`<li>${n.problem} <button class="link" @click=${() => this.select(n.key)}>${n.label}</button></li>`)}
      </ul></section>` : nothing}
      <section>${this.runButton(plan)}</section>
      ${plan.run ? html`<section><h2>The last run</h2>
        <p>${plan.run.status === 'running' ? 'Running now.' : `It ${plan.run.status === 'completed' ? 'finished' : plan.run.status}.`}${plan.run.message ? html` ${plan.run.message}.` : nothing}</p>
        ${this.publishButton(plan, null)}
      </section>` : nothing}
      ${phases.length > 0 ? html`<section><h2>The order of work</h2><ol class="order">
        ${phases.map((phase) => html`<li><span class="sub">${phase.title}:</span> ${plan.steps.filter((s) => s.phase?.order === phase.order)
          .map((s, i) => html`${i ? ', ' : ''}<button class="link" @click=${() => this.select(nodeKey.step(s.id))}>${s.label}</button>`)}</li>`)}
      </ol><p class="sub">Each step starts when the one before it has finished; steps in the same stage work at the same time.</p></section>` : nothing}
      ${plan.authoring && plan.authoring.length > 0 ? html`<section><h2>Changes</h2>${plan.authoring.slice(0, 6).map((e) => this.renderEvent(e))}</section>` : nothing}
      ${plan.digest ? html`<section><h2>About</h2>
        <p class="sub">A run approves exactly this version: its digest is <code>${plan.digest}</code>, and any change to the plan makes a new one.</p>
        <p class="sub">Plan graph <code>${plan.definition}</code></p>
      </section>` : nothing}`
  }

  private renderEvent(e: WorkflowAuthoringView): TemplateResult {
    const who = e.actor ?? 'Someone'
    if (e.kind === 'publish') {
      return html`<div class="event"><span class="who">${who}</span> published ${e.placed ?? 0} to the margin${e.notFound ? html`, ${e.notFound} not found` : nothing} <span class="at">${when(e.at)}</span></div>`
    }
    return html`<div class="event"><span class="who">${who}</span> ${e.rationale ? html`<span>${e.rationale}</span>` : 'changed the plan'} <span class="at">${when(e.at)}</span></div>`
  }

  private renderStep(plan: WorkflowPlanOptions, step: WorkflowPlanStepView): TemplateResult {
    const run = stepRunState(step)
    const p = step.progress
    const sources = (step.reads ?? []).map((id) => plan.sources?.find((s) => s.id === id) ?? { id, label: id, documentId: null })
    const takes = [...new Set([...(step.over ? [step.over] : []), ...(step.consumes ?? [])])]
    const made = step.produces ? plan.stacks?.find((s) => s.id === step.produces) : undefined
    const refused = (plan.refused ?? []).filter((r) => r.step === step.id)
    return html`
      ${this.eyebrow(step.checks ? 'Check' : 'Person')}
      <h1>${step.label}</h1>
      <div class="sub">${step.job} · ${stepModeWords(step)}</div>
      ${this.problemList(step.problems ?? [])}
      ${p ? html`<section><h2>This run</h2><p class="tally">${step.mode === 'perItem'
        ? `${p.started} item${p.started === 1 ? '' : 's'}: ${p.done} done${p.failed ? `, ${p.failed} failed` : ''}${p.started > p.done + p.failed ? `, ${p.started - p.done - p.failed} in hand` : ''}.`
        : run === 'running' ? 'Working on it now.' : run === 'failed' ? 'It failed.' : 'Done.'}
        ${step.verdicts ? html` Passed ${step.verdicts.passed}, refused ${step.verdicts.refused}.` : nothing}</p></section>` : nothing}
      ${sources.length + takes.length > 0 ? html`<section><h2>${step.checks ? 'Checks' : 'Reads'}</h2><div class="chips">
        ${sources.map((s) => this.chip(nodeKey.source(s.id), s.label, 'source'))}
        ${takes.map((c) => this.chip(nodeKey.stack(c), step.mode === 'perItem' && c === step.over ? `each of ${humanName(c)}` : humanName(c), 'stack'))}
      </div></section>` : html`<section><h2>Reads</h2><p class="sub">The run input only.</p></section>`}
      ${step.produces ? html`<section><h2>${step.checks ? 'Passes on' : 'Hands on'}</h2><div class="chips">${this.chip(nodeKey.stack(step.produces), humanName(step.produces), 'stack')}</div>
        ${made && made.fields.length ? html`<div class="sub" style="margin:8px 0 4px">Each item has</div><ul class="fields">${made.fields.map((f) => html`<li>${f}</li>`)}</ul>` : nothing}</section>` : nothing}
      <section><h2>${step.checks ? 'What it checks' : 'What they are told'}</h2><p class="instructions">${step.instructions || '(no instructions yet)'}</p></section>
      ${step.phase ? html`<section><h2>When</h2><p class="sub">Stage ${step.phase.order}, ${step.phase.title}.</p></section>` : nothing}
      ${refused.length > 0 ? html`<section><h2>Refused (${refused.length})</h2>${refused.slice(0, ITEMS_SHOWN).map((r, i) => this.renderItem(r.item, i, r.why))}</section>` : nothing}`
  }

  private renderStack(plan: WorkflowPlanOptions, stack: WorkflowStackView): TemplateResult {
    const readers = plan.steps.filter((s) => s.over === stack.id || (s.consumes ?? []).includes(stack.id))
    const goes = (plan.destinations ?? []).filter((d) => d.receives === stack.id)
    const items = stack.items ?? null
    return html`
      ${this.eyebrow('Stack')}
      <h1>${humanName(stack.id)}</h1>
      <div class="sub">${items ? `${items.length} item${items.length === 1 ? '' : 's'} after the last run` : 'Filled when the workflow runs'}</div>
      ${this.problemList(stack.problems ?? [])}
      <section><h2>Made by</h2><div class="chips">${stack.producer ? this.stepChip(plan, stack.producer) : html`<span class="sub">No one yet</span>`}</div></section>
      ${readers.length + goes.length > 0 ? html`<section><h2>Goes to</h2><div class="chips">
        ${readers.map((s) => this.stepChip(plan, s.id))}
        ${goes.map((d) => this.chip(nodeKey.destination(d.id), d.label, 'destination'))}
      </div></section>` : nothing}
      ${stack.fields.length ? html`<section><h2>Each item has</h2><ul class="fields">${stack.fields.map((f) => html`<li>${f}</li>`)}</ul></section>` : nothing}
      ${items && items.length > 0 ? html`<section><h2>The items</h2>
        ${items.slice(0, ITEMS_SHOWN).map((item, i) => this.renderItem(item, i))}
        ${items.length > ITEMS_SHOWN ? html`<p class="sub">And ${items.length - ITEMS_SHOWN} more.</p>` : nothing}
      </section>` : nothing}`
  }

  /** One item as a card: its quote, its note, its other fields, and where to see it in its document. */
  private renderItem(item: unknown, index: number, why?: string): TemplateResult {
    const plan = this.plan
    if (!isRecord(item)) return html`<div class="item ${why ? 'refusal' : ''}"><span class="n">${index + 1}</span>${text(item)}${why ? html`<p class="sub">${why}</p>` : nothing}</div>`
    const { quote, note, documentId, blockId, ...rest } = item
    const fields = Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && text(v).trim() !== '').slice(0, 8)
    const doc = typeof documentId === 'string' && documentId ? documentId : null
    const block = typeof blockId === 'string' && blockId ? blockId : null
    const docTitle = doc ? (plan?.documentTitles?.[doc] ?? plan?.sources?.find((s) => s.documentId === doc)?.documentTitle ?? null) : null
    return html`<div class="item ${why ? 'refusal' : ''}"><span class="n">${index + 1}</span>
      ${typeof quote === 'string' && quote ? html`<blockquote>${copied(quote)}</blockquote>` : nothing}
      ${typeof note === 'string' && note ? html`<p class="note">${copied(note)}</p>` : nothing}
      ${fields.length ? html`<dl>${fields.map(([k, v]) => html`<dt>${k}</dt><dd>${text(v)}</dd>`)}</dl>` : nothing}
      ${why ? html`<p class="sub"><strong>Refused:</strong> ${why}</p>` : nothing}
      ${doc && plan?.onOpenDocument ? html`<button class="quiet" @click=${() => plan.onOpenDocument?.({ documentId: doc, blockId: block })}>Show in ${docTitle ?? 'the document'}</button>` : nothing}
    </div>`
  }

  private renderSource(plan: WorkflowPlanOptions, source: WorkflowSourceView): TemplateResult {
    const readers = plan.steps.filter((s) => (s.reads ?? []).includes(source.id))
    const documentId = source.documentId
    return html`
      ${this.eyebrow('Source')}
      <h1>${source.label}</h1>
      ${this.problemList(source.problems ?? [])}
      <section><h2>Document</h2>
        ${documentId ? html`<p>${source.documentTitle ?? html`<code>${documentId}</code>`}</p>
          <p><button class="quiet" @click=${() => plan.onOpenDocument?.({ documentId, blockId: source.fromBlock ?? null })}>${source.fromBlock ? 'Open at this section' : 'Open it'}</button></p>`
          : html`<p class="sub">No document named yet.</p>`}
      </section>
      ${source.fromBlock || source.toBlock ? html`<section><h2>The section</h2><p class="sub">${source.fromBlock ? html`From block <code>${source.fromBlock}</code>` : 'From the beginning'}
        ${source.toBlock ? html`through block <code>${source.toBlock}</code>` : 'to the end'}.</p></section>` : html`<section><h2>The section</h2><p class="sub">The whole document.</p></section>`}
      <section><h2>Read by</h2><div class="chips">${readers.length ? readers.map((s) => this.stepChip(plan, s.id)) : html`<span class="sub">No one yet</span>`}</div></section>`
  }

  private renderDestination(plan: WorkflowPlanOptions, destination: WorkflowDestinationView): TemplateResult {
    const published = (plan.authoring ?? []).filter((e) => e.kind === 'publish')
    const where = destination.documentTitle ?? destination.documentId
    return html`
      ${this.eyebrow('Destination')}
      <h1>${destination.label}</h1>
      <div class="sub">${destination.kind === 'margin'
        ? where ? html`Comments in the margin of ${where}` : 'Comments in the margins of the documents its findings quote'
        : destination.kind ?? ''}</div>
      ${this.problemList(destination.problems ?? [])}
      <section><h2>Receives</h2><div class="chips">${destination.receives ? this.chip(nodeKey.stack(destination.receives), humanName(destination.receives), 'stack') : html`<span class="sub">Nothing yet</span>`}</div></section>
      <section><h2>Publish</h2>
        ${plan.publish && plan.publish.count > 0 ? this.publishButton(plan, destination)
          : html`<p class="sub">${plan.run ? 'The last run left nothing to publish here.' : 'After a run, its findings wait here until you publish them.'}</p>`}
        ${destination.documentId && plan.onOpenDocument ? html`<p><button class="quiet" @click=${() => plan.onOpenDocument?.({ documentId: destination.documentId! })}>Open ${where ?? 'the document'}</button></p>` : nothing}
      </section>
      ${published.length > 0 ? html`<section><h2>Published</h2>${published.slice(0, 5).map((e) => this.renderEvent(e))}</section>` : nothing}`
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-workflow-inspector')) {
  customElements.define('sh-workflow-inspector', ShWorkflowInspector)
}
