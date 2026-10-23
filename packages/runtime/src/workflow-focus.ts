/**
 * `<sh-workflow-focus .plan=${plan}>`: one part of a workflow, full size, in place of the canvas (Vera, 2026-10-20:
 * "expand a given node into a full-main-pane view with a way back into the workflow … tightly integrated with our
 * Choreograph app UX"). Every part of a workflow is itself a small system with inputs, work and outputs, so opening
 * one goes a level down, and the breadcrumb climbs back:
 *
 *   workflow ─ a person or a check ─ one of their agents: the item it was given, what it did, what it handed on
 *            ─ a stack             ─ one item: who made it, who worked it next, where it went
 *            ─ a check's refusals  ─ one refusal
 *
 * Esc climbs one level; ← and → step through the items of the level you are on. Every effect is the host's
 * (`onFocus`, `onSelect`, `onOpenDocument`); the agents come from Choreograph's run (`plan.agents`).
 */

import { LocaleController, formatNumber, localeSource, t } from '@shrubbery/nucleus'
import type { BeingFace, ObjectModel } from '@shrubbery/nucleus/object-faces'
import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import './being/being-face-element.js'
import { OBJECT_VIEW_INTENT_EVENT } from './object-view/object-view-element.js'
import type { WorkflowAgentRunView, WorkflowFocus, WorkflowPlanOptions, WorkflowPlanStepView, WorkflowStackView } from './render-workspace.js'
import {
  copied, itemText, objectForItem, renderItemCard, routeObjectIntent, stackCountWords, stackFieldWords, stackName,
  stackObject, unfitCount, WORKFLOW_ITEM_STYLES,
} from './workflow-inspector.js'
import { humanName, nodeKey, stepModeWords, workflowGlyph } from './workflow-scene.js'

const ROWS_SHOWN = 400

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function plural(n: number, one: string, many = `${one}s`): string {
  const key = one === 'item' ? 'count.items' : one === 'turn' ? 'count.turns' : one === 'match' ? 'count.matches' : null
  return key ? t(key, { count: n, number: formatNumber(n) }) : `${formatNumber(n)} ${n === 1 ? one : many}`
}

/** A span of time as a person says it: 840 ms, 4.1 s, 2 min 5 s. */
export function spanWords(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`
}

/** The items an agent handed back: `{items: [...]}` or a bare list. */
function handedItems(output: unknown): unknown[] | null {
  if (Array.isArray(output)) return output
  if (isRecord(output) && Array.isArray(output.items)) return output.items
  return null
}

/** A check's answer, from what its agent handed back: `{ok, reason?, nearest?}`. */
export function verdictOf(output: unknown): { passed: boolean; why: string } | null {
  if (!isRecord(output) || typeof output.ok !== 'boolean') return null
  const why = [typeof output.reason === 'string' ? output.reason : '', typeof output.nearest === 'string' && output.nearest ? `Nearest: ${output.nearest}` : '']
    .filter(Boolean).join(' ')
  return { passed: output.ok, why }
}

/** What an agent handed on, in a few words: in its stack's class when it has one ("3 dream reports, 1 unfit"). */
function handedWords(agent: WorkflowAgentRunView, step: WorkflowPlanStepView, made?: WorkflowStackView, unfit?: readonly string[]): string {
  if (agent.state === 'failed') return agent.error ? `Failed: ${agent.error}` : 'Failed'
  if (agent.state === 'running') return t('Working…')
  if (agent.state === 'queued') return 'Waiting'
  if (unfit) return `Nothing that fit${unfit.length ? `: ${unfit.join('; ')}` : ''}`
  if (step.checks) {
    const verdict = verdictOf(agent.output)
    if (verdict) return verdict.passed ? 'Passed' : `Refused${verdict.why ? `: ${verdict.why}` : ''}`
  }
  const items = handedItems(agent.output)
  if (items) {
    if (items.length === 0) return 'Nothing'
    if (made?.itemClass) {
      const bad = items.filter((item) => objectForItem(made, item)?.stance === 'unfit').length
      return `${stackCountWords(made, items.length)}${bad ? `, ${bad} unfit` : ''}`
    }
    return plural(items.length, humanName(step.produces ?? 'item').replace(/s$/, ''), humanName(step.produces ?? 'items'))
  }
  return agent.output === null || agent.output === undefined ? '' : itemText(agent.output).slice(0, 120)
}

/** An item in one line: its quote, else its text, else its first field. */
function itemLine(item: unknown): string {
  if (isRecord(item)) {
    for (const key of ['quote', 'text', 'note', 'title', 'name']) {
      const value = item[key]
      if (typeof value === 'string' && value.trim()) return copied(value)
    }
    const first = Object.values(item).find((value) => typeof value === 'string' && value.trim())
    return typeof first === 'string' ? copied(first) : itemText(item)
  }
  return itemText(item)
}

/** A tool call in one line: the tool, then what it named (a block, a document, a query), as briefly as it can. */
function toolLine(args: unknown, titles: Readonly<Record<string, string>>): string {
  if (!isRecord(args)) return ''
  const doc = typeof args.documentId === 'string' ? (titles[args.documentId] ?? args.documentId) : null
  const parts: string[] = []
  if (typeof args.blockId === 'string') parts.push(args.blockId)
  if (doc) parts.push(`in ${doc}`)
  if (typeof args.query === 'string') parts.push(`“${args.query.slice(0, 60)}”`)
  if (parts.length) return parts.join(' ')
  const rest = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}: ${String(v)}`)
  return rest.join(', ').slice(0, 120)
}

interface TableColumn {
  readonly key: string
  readonly label: string
}

/**
 * The columns of a stack's table. A typed stack: its class's fields, labelled, in the class's order (the document and
 * block plumbing aside). Otherwise its item fields (the plan's, else what its items carry), its quote first.
 */
function stackColumns(stack: WorkflowStackView, items: readonly unknown[]): TableColumn[] {
  if (stack.itemClass) {
    const sample = (stack.objects ?? []).find((o): o is ObjectModel => Boolean(o))
    const hidden = new Set([sample?.roleKeys.document ?? 'documentId', sample?.roleKeys.block ?? 'blockId'])
    return stack.itemClass.columns.filter((c) => !hidden.has(c.key)).slice(0, 7)
  }
  const seen = new Set<string>(stack.fields)
  for (const item of items.slice(0, 50)) if (isRecord(item)) for (const key of Object.keys(item)) seen.add(key)
  const hidden = new Set(['documentId', 'blockId'])
  const columns = [...seen].filter((c) => !hidden.has(c))
  return [...columns.filter((c) => c === 'quote'), ...columns.filter((c) => c !== 'quote')].slice(0, 7).map((key) => ({ key, label: humanName(key) }))
}

/** A cell: a typed item's field (a nested value as its title, an absent one as a dash), else the JSON's value. */
function cellText(model: ObjectModel | null, item: unknown, key: string, first: boolean): string {
  if (model) {
    const field = model.fields.find((f) => f.key === key)
    if (field) return field.absent ? '—' : copied(field.value)
  }
  return itemText(isRecord(item) ? item[key] : first ? item : undefined)
}

function matches(item: unknown, filter: string): boolean {
  if (!filter) return true
  return JSON.stringify(item).toLowerCase().includes(filter.toLowerCase())
}

export class ShWorkflowFocus extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static override properties = { plan: { attribute: false }, filter: { state: true } }
  declare plan: WorkflowPlanOptions | null
  declare filter: string
  private focusedFor = ''

  constructor() {
    super()
    this.plan = null
    this.filter = ''
    this.tabIndex = -1
    this.addEventListener('keydown', this.onKeyDown)
    this.addEventListener(OBJECT_VIEW_INTENT_EVENT, (event) => routeObjectIntent(this.plan, event))
  }

  static override styles = [WORKFLOW_ITEM_STYLES, css`
    :host {
      display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; outline: none;
      background: var(--mn-color-surface-canvas); color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px)/1.5 var(--mn-font-chrome); container-type: inline-size;
    }
    * { box-sizing: border-box; }
    /* One element around each view, for DOMs that lose a binding beside another top-level node; it adds no box. */
    .part { display: contents; }
    h1, h2, h3, p { margin: 0; }
    .bar {
      flex: none; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 10px 16px;
      border-bottom: 1px solid var(--mn-color-border-subtle); background: var(--mn-color-surface-raised);
    }
    .bar .up { font: inherit; display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; border: 1px solid var(--mn-color-border-default); background: transparent; color: inherit; cursor: pointer; flex: none; }
    .bar .up:hover { border-color: var(--mn-color-border-accent); }
    .crumbs { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; }
    .crumbs button { font: inherit; border: 0; background: none; padding: 2px 4px; border-radius: 4px; color: var(--mn-color-text-secondary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
    .crumbs button:hover { color: var(--mn-color-text-primary); background: var(--mn-color-surface-hover); }
    .crumbs .here { color: var(--mn-color-text-primary); font-weight: 600; padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; }
    .crumbs .sep { color: var(--mn-color-text-tertiary, var(--mn-color-text-secondary)); flex: none; }
    .stepper { display: flex; align-items: center; gap: 4px; flex: none; color: var(--mn-color-text-secondary); font-variant-numeric: tabular-nums; }
    .stepper button { font: inherit; width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--mn-color-border-default); background: transparent; color: inherit; cursor: pointer; }
    .stepper button:hover:not([disabled]) { border-color: var(--mn-color-border-accent); color: var(--mn-color-text-primary); }
    .stepper button[disabled] { opacity: .35; cursor: default; }
    .keys { flex: none; color: var(--mn-color-text-secondary); font-size: 11px; }
    kbd { font: 11px var(--mn-font-mono, ui-monospace, monospace); padding: 0 4px; border: 1px solid var(--mn-color-border-default); border-radius: 4px; background: var(--mn-color-surface-canvas); }

    .scroll { flex: 1; min-height: 0; overflow: auto; padding: 24px 28px 96px; }
    .page { max-width: 1240px; margin: 0 auto; }
    .hero { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 20px; }
    .hero .badge { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
      background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-default); color: var(--mn-color-text-secondary); }
    .hero .badge[data-kind='check'] { border-left: 3px solid var(--mn-color-text-danger); }
    .hero .badge svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
    .hero .hero-mark { flex: none; }
    .hero h1 { font: 600 22px/1.2 var(--mn-font-chrome); overflow-wrap: anywhere; }
    .hero .sub { margin-top: 3px; }
    .sub { color: var(--mn-color-text-secondary); }
    .wiring { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
    .wiring .arrow { color: var(--mn-color-text-secondary); padding: 0 2px; }
    .chip {
      font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; max-width: 320px;
      padding: 1px 9px; border-radius: 999px; border: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-raised); color: inherit; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip:hover { border-color: var(--mn-color-border-accent); }
    .chip[data-kind='source'], .chip[data-kind='destination'] { border-style: double; border-width: 3px; padding: 0 8px; }
    .chip[data-kind='check'] { border-left: 3px solid var(--mn-color-text-danger); }

    .cols { display: grid; gap: 20px 28px; grid-template-columns: minmax(0, 1fr); }
    @container (min-width: 900px) { .cols { grid-template-columns: minmax(280px, 5fr) minmax(0, 7fr); } .cols.three { grid-template-columns: minmax(0, 4fr) minmax(0, 4fr) minmax(0, 5fr); } }
    section + section { margin-top: 22px; }
    h2 { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mn-color-text-secondary); font-weight: 600; margin: 0 0 8px; }
    .instructions { white-space: pre-wrap; font-family: var(--mn-font-serif, Georgia, serif); font-size: 15px; line-height: 1.55;
      padding: 14px 16px; border-radius: 8px; background: var(--mn-color-surface-raised); border: 1px solid var(--mn-color-border-subtle); }
    .fields { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 12px; }
    .stats { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
    .stats b { font-weight: 600; }
    .empty { padding: 18px; border: 1px dashed var(--mn-color-border-default); border-radius: 8px; color: var(--mn-color-text-secondary); }

    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
    thead th { position: sticky; top: -24px; z-index: 1; text-align: left; font-weight: 600; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
      color: var(--mn-color-text-secondary); background: var(--mn-color-surface-canvas); padding: 6px 10px; border-bottom: 1px solid var(--mn-color-border-default); white-space: nowrap; }
    tbody td { padding: 7px 10px; border-bottom: 1px solid var(--mn-color-border-subtle); vertical-align: top; }
    tbody tr { cursor: pointer; }
    tbody tr:hover td { background: var(--mn-color-surface-hover); }
    tbody tr:focus-visible { outline: 2px solid var(--mn-color-accent); outline-offset: -2px; }
    td.n { width: 1%; color: var(--mn-color-text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--mn-color-text-secondary); }
    td .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    td.quote .clamp { font-family: var(--mn-font-serif, Georgia, serif); font-size: 13px; }
    td.why { color: var(--mn-color-text-danger); }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--mn-color-border-default); vertical-align: middle; }
    .dot[data-state='done'] { background: var(--mn-color-success-border); }
    .dot[data-state='failed'] { background: var(--mn-color-danger-border); }
    .dot[data-state='running'] { background: var(--mn-color-warning-border); }
    .dot[data-state='refused'] { background: var(--mn-color-danger-border); }
    .filter { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .filter input { font: inherit; flex: 0 1 320px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--mn-color-border-default); background: var(--mn-color-surface-raised); color: inherit; }
    .filter input:focus { outline: 2px solid var(--mn-color-accent); outline-offset: 1px; }

    .timeline { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--mn-color-border-subtle); }
    .timeline li { position: relative; padding: 0 0 12px 16px; }
    .timeline li::before { content: ''; position: absolute; left: -6px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--mn-color-surface-canvas); border: 2px solid var(--mn-color-border-default); }
    .timeline li[data-tone='done']::before { border-color: var(--mn-color-success-border); }
    .timeline li[data-tone='failed']::before { border-color: var(--mn-color-danger-border); }
    .timeline .what { font-weight: 600; }
    .timeline .tool { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 600; }
    .timeline .at { color: var(--mn-color-text-secondary); font-variant-numeric: tabular-nums; font-size: 11.5px; margin-left: 6px; }
    .timeline .detail { color: var(--mn-color-text-secondary); overflow-wrap: anywhere; }
    .verdict { padding: 12px 14px; border-radius: 8px; border: 1px solid var(--mn-color-border-subtle); background: var(--mn-color-surface-raised); }
    .verdict[data-passed='false'] { border-left: 3px solid var(--mn-color-danger-border); }
    .verdict[data-passed='true'] { border-left: 3px solid var(--mn-color-success-border); }
    .verdict .what { font-weight: 600; }
    .failure { padding: 12px 14px; border-radius: 8px; border-left: 3px solid var(--mn-color-danger-border); background: var(--mn-color-surface-raised); }
    .lineage { display: grid; gap: 8px; }
    .lineage .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
    .lineage .row .sub { min-width: 88px; }
    .link { font: inherit; border: 0; background: none; padding: 0; color: var(--mn-color-text-accent, var(--mn-color-accent)); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
    tbody tr[data-stance='unfit'] td.n:first-child { box-shadow: inset 3px 0 0 var(--mn-color-danger-border); }
    .unfit-tag { display: inline-block; margin-left: 4px; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--mn-color-text-danger); }
    .unfit-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .unfit-list li { padding: 6px 10px; border-left: 3px solid var(--mn-color-danger-border); background: var(--mn-color-surface-raised); border-radius: 0 6px 6px 0; }
    @media (prefers-reduced-motion: no-preference) { .page { animation: rise .14s ease-out; } @keyframes rise { from { opacity: 0; transform: translateY(4px); } } }
  `]

  override updated(): void {
    // Take the keyboard when a new level opens, so Esc and the arrows work at once.
    const at = JSON.stringify(this.plan?.focus ?? null)
    if (at !== this.focusedFor) {
      this.focusedFor = at
      if (!this.shadowRoot?.activeElement) this.focus({ preventScroll: true })
      this.shadowRoot?.querySelector('.scroll')?.scrollTo({ top: 0 })
    }
  }

  private go(focus: WorkflowFocus | null): void {
    this.plan?.onFocus?.(focus)
  }

  /** One level up: an item to its part, a part to the canvas. */
  private up(): void {
    const focus = this.plan?.focus
    if (!focus) return
    this.go(focus.item ? { key: focus.key } : null)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const typing = e.composedPath().some((el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    if (e.key === 'Escape') {
      if (typing && this.filter) {
        this.filter = ''
        e.preventDefault()
        return
      }
      e.preventDefault()
      this.up()
      return
    }
    if (typing) return
    const focus = this.plan?.focus
    if (!focus?.item || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    const count = this.itemCount(focus.key)
    const next = focus.item + (e.key === 'ArrowRight' ? 1 : -1)
    if (next >= 1 && next <= count) {
      e.preventDefault()
      this.go({ key: focus.key, item: next })
    }
  }

  // ── the parts ────────────────────────────────────────────────────────────────────────────────────────────────

  private partOf(key: string): { kind: string; id: string; step?: WorkflowPlanStepView; stack?: WorkflowStackView } {
    const kind = key.slice(0, key.indexOf(':'))
    const id = key.slice(key.indexOf(':') + 1)
    const plan = this.plan!
    if (kind === 'step' || kind === 'refused') return { kind, id, step: plan.steps.find((s) => s.id === id) }
    if (kind === 'stack') return { kind, id, stack: plan.stacks?.find((s) => s.id === id) ?? { id, producer: null, fields: [] } }
    return { kind, id }
  }

  private partLabel(key: string): string {
    const part = this.partOf(key)
    if (part.kind === 'refused') return `Refused by ${part.step?.label ?? part.id}`
    if (part.step) return part.step.label
    if (part.stack) return stackName(part.stack)
    return humanName(part.id)
  }

  /** The being a post cast in the last run, or undefined (no run yet, or none recorded). */
  private faceOf(step: WorkflowPlanStepView): BeingFace | undefined {
    return this.plan?.cast?.find((face) => face.stepId === step.id)
  }

  private agentsOf(step: WorkflowPlanStepView): WorkflowAgentRunView[] {
    return (this.plan?.agents ?? []).filter((agent) => agent.step === step.label)
      .sort((a, b) => (a.n ?? 0) - (b.n ?? 0))
  }

  /** How many items the level holds (for ← and →). */
  private itemCount(key: string): number {
    const part = this.partOf(key)
    if (part.kind === 'step' && part.step) return Math.max(...this.agentsOf(part.step).map((a) => a.n ?? 1), 0)
    if (part.kind === 'stack') return part.stack?.items?.length ?? 0
    if (part.kind === 'refused') return (this.plan?.refused ?? []).filter((r) => r.step === part.id).length
    return 0
  }

  private stepChip(stepId: string): TemplateResult {
    const step = this.plan?.steps.find((s) => s.id === stepId)
    return html`<button class="chip" data-kind=${step?.checks ? 'check' : 'step'} title=${step?.label ?? stepId}
      @click=${() => this.go({ key: nodeKey.step(stepId) })}>${step?.label ?? stepId}</button>`
  }

  private stackChip(id: string, words = this.stackWords(id)): TemplateResult {
    return html`<button class="chip" data-kind="stack" title=${words} @click=${() => this.go({ key: nodeKey.stack(id) })}>${words}</button>`
  }

  /** A stack by its name: its class's plural when it has one. */
  private stackWords(id: string): string {
    const stack = this.plan?.stacks?.find((s) => s.id === id)
    return stack ? stackName(stack) : humanName(id)
  }

  /** The violations of a sitting that handed back nothing that fit, or undefined. */
  private unfitOf(step: WorkflowPlanStepView, agent: WorkflowAgentRunView): readonly string[] | undefined {
    return (this.plan?.unfitSittings ?? []).find((u) => u.step === step.id && u.sitting === agent.label)?.violations
  }

  // ── render ───────────────────────────────────────────────────────────────────────────────────────────────────

  override render() {
    const plan = this.plan
    const focus = plan?.focus
    if (!plan || !focus) return nothing
    const part = this.partOf(focus.key)
    const count = focus.item ? this.itemCount(focus.key) : 0
    const itemWord = part.kind === 'step' ? (part.step?.mode === 'perItem' || part.step?.checks ? 'Item' : 'Their work') : part.kind === 'refused' ? 'Refusal' : 'Item'
    return html`
      <div class="bar" role="navigation" aria-label=${t('Where you are in the workflow')}>
        <button class="up" title=${t('Up one level (Esc)')} aria-label=${t('Up one level')} @click=${() => this.up()}>←</button>
        <div class="crumbs">
          <button @click=${() => this.go(null)} title=${t('Back to the canvas')}>${plan.title}</button>
          <span class="sep">/</span>
          ${focus.item
            ? html`<button @click=${() => this.go({ key: focus.key })}>${this.partLabel(focus.key)}</button><span class="sep">/</span>
              <span class="here">${itemWord} ${count > 1 || part.kind !== 'step' ? focus.item : ''}</span>`
            : html`<span class="here">${this.partLabel(focus.key)}</span>`}
        </div>
        ${focus.item && count > 1 ? html`<div class="stepper" aria-label=${t('Items')}>
          <button ?disabled=${focus.item <= 1} title=${t('The one before (←)')} @click=${() => this.go({ key: focus.key, item: focus.item! - 1 })}>‹</button>
          <span>${focus.item} of ${count}</span>
          <button ?disabled=${focus.item >= count} title=${t('The next one (→)')} @click=${() => this.go({ key: focus.key, item: focus.item! + 1 })}>›</button>
        </div>` : nothing}
        <span class="keys"><kbd>Esc</kbd> up</span>
      </div>
      <div class="scroll"><div class="page">
        ${part.kind === 'step' && part.step ? (focus.item ? this.renderAgent(part.step, focus.item) : this.renderPerson(part.step))
          : part.kind === 'stack' && part.stack ? (focus.item ? this.renderStackItem(part.stack, focus.item) : this.renderStack(part.stack))
            : part.kind === 'refused' && part.step ? (focus.item ? this.renderRefusal(part.step, focus.item) : this.renderRefusals(part.step))
              : html`<p class="empty">${t('This part is not in the workflow any more.')}</p>`}
      </div></div>`
  }

  private hero(kind: 'step' | 'check' | 'stack' | 'refused', title: string, sub: TemplateResult | string, wiring?: TemplateResult, being?: BeingFace): TemplateResult {
    return html`<header class="hero">
      ${being
        ? html`<sh-being-mark class="hero-mark" agent-id=${being.agentId} name=${being.name} .size=${40}></sh-being-mark>`
        : html`<div class="badge" data-kind=${kind}>${workflowGlyph(kind)}</div>`}
      <div><h1>${title}</h1><div class="sub">${sub}</div>${wiring ?? nothing}</div>
    </header>`
  }

  private wiring(step: WorkflowPlanStepView): TemplateResult {
    const plan = this.plan!
    const sources = (step.reads ?? []).map((id) => plan.sources?.find((s) => s.id === id) ?? { id, label: id, documentId: null })
    const takes = [...new Set([...(step.over ? [step.over] : []), ...(step.consumes ?? []), ...(step.checks ? [step.checks] : [])])]
    return html`<div class="wiring">
      ${sources.map((s) => html`<button class="chip" data-kind="source" title=${s.label}
        @click=${() => { if (s.documentId) plan.onOpenDocument?.({ documentId: s.documentId, blockId: 'fromBlock' in s ? (s.fromBlock ?? null) : null }) }}>${s.label}</button>`)}
      ${takes.map((c) => this.stackChip(c, step.mode === 'perItem' && (c === step.over || c === step.checks) ? `each of ${this.stackWords(c)}` : this.stackWords(c)))}
      ${sources.length + takes.length === 0 ? html`<span class="sub">${t('The run input')}</span>` : nothing}
      ${step.produces ? html`<span class="arrow">→</span>${this.stackChip(step.produces)}` : nothing}
      ${step.checks && plan.refused?.some((r) => r.step === step.id) ? html`<button class="chip" data-kind="check"
        @click=${() => this.go({ key: nodeKey.refused(step.id) })}>${t('refused')}</button>` : nothing}
    </div>`
  }

  // A person (or a check): their brief on the left, their agents on the right.
  private renderPerson(step: WorkflowPlanStepView): TemplateResult {
    const plan = this.plan!
    const agents = this.agentsOf(step)
    const made = step.produces ? plan.stacks?.find((s) => s.id === step.produces) : undefined
    const kind = step.checks ? 'check' : 'step'
    const being = this.faceOf(step)
    return html`<div class="part">
      ${this.hero(kind, step.label, [step.job, stepModeWords(step), step.phase ? `stage ${step.phase.order}, ${step.phase.title}` : ''].filter(Boolean).join(' · '), this.wiring(step), being)}
      <div class="cols">
        <div>
          ${being ? html`<section><h2>${step.checks ? t('Who checks') : t('Who is cast')}</h2><sh-being-face .face=${being}></sh-being-face></section>` : nothing}
          <section><h2>${step.checks ? t('What it checks') : t('What they are told')}</h2><p class="instructions">${step.instructions || '(no instructions yet)'}</p></section>
          ${!step.checks && made && stackFieldWords(made).length ? html`<section><h2>${made.itemClass ? `Each ${made.itemClass.label.toLowerCase()} they hand on has` : 'Each item they hand on has'}</h2><ul class="fields">${stackFieldWords(made).map((f) => html`<li>${f}</li>`)}</ul></section>` : nothing}
          ${(step.problems ?? []).length ? html`<section><h2>${t('What keeps them from running')}</h2>${step.problems!.map((p) => html`<p>${p}</p>`)}</section>` : nothing}
          ${this.renderUnfitSittings(step)}
        </div>
        <div>${this.renderWork(step, agents)}</div>
      </div></div>`
  }

  /** The sittings of this person that handed back nothing that fit their class, and why. */
  private renderUnfitSittings(step: WorkflowPlanStepView): TemplateResult | typeof nothing {
    const unfit = (this.plan?.unfitSittings ?? []).filter((u) => u.step === step.id)
    if (unfit.length === 0) return nothing
    const open = (sitting: string): void => {
      const agent = this.agentsOf(step).find((a) => a.label === sitting)
      if (agent) this.go({ key: nodeKey.step(step.id), item: agent.n ?? 1 })
    }
    return html`<section><h2>${t('Handed back nothing that fit')}</h2><ul class="unfit-list">
      ${unfit.map((u) => html`<li><button class="link" @click=${() => open(u.sitting)}>${u.sitting}</button> handed back nothing that fit: ${u.violations.join('; ') || 'no reason given'}</li>`)}
    </ul></section>`
  }

  private renderWork(step: WorkflowPlanStepView, agents: readonly WorkflowAgentRunView[]): TemplateResult {
    if (agents.length === 0) {
      return html`<section><h2>${t('Their work')}</h2><p class="empty">${this.plan?.run
        ? t('Choreograph has no record of their sittings for the last run.')
        : t('Not run yet. When the workflow runs, each of their sittings shows here: what they were given, what they did, what they handed on.')}</p></section>`
    }
    // A once step has one agent: its work is shown right here.
    if (step.mode !== 'perItem' && !step.checks && agents.length === 1) return this.renderAgentBody(step, agents[0]!, null)
    const done = agents.filter((a) => a.state === 'done').length
    const failed = agents.filter((a) => a.state === 'failed').length
    const running = agents.filter((a) => a.state === 'running' || a.state === 'queued').length
    const start = Math.min(...agents.map((a) => a.startedAt ?? Number.POSITIVE_INFINITY))
    const end = Math.max(...agents.map((a) => a.endedAt ?? 0))
    const tokens = agents.reduce((sum, a) => sum + (a.tokens ?? 0), 0)
    const models = [...new Set(agents.map((a) => a.model).filter((m): m is string => Boolean(m)))]
    const verdicts = step.checks ? agents.map((a) => verdictOf(a.output)) : []
    const passed = verdicts.filter((v) => v?.passed).length
    const refused = verdicts.filter((v) => v && !v.passed).length
    const inputs = this.inputsOf(step)
    const made = step.produces ? this.plan?.stacks?.find((s) => s.id === step.produces) : undefined
    const being = this.faceOf(step)
    return html`<section><h2>${being ? t('Sittings in the last run') : t('Their work in the last run')}</h2>
      <div class="stats">
        <span>${being ? html`<b>${being.name}</b>, ` : nothing}${t('being.sittings', { count: agents.length, number: formatNumber(agents.length) })}</span>
        ${step.checks ? html`<span><b>${passed}</b> passed</span><span><b>${refused}</b> ${t('refused')}</span>` : html`<span><b>${done}</b> done</span>`}
        ${failed ? html`<span><b>${failed}</b> failed</span>` : nothing}
        ${running ? html`<span><b>${running}</b> at work</span>` : nothing}
        ${Number.isFinite(start) && end > start ? html`<span>${spanWords(end - start)}</span>` : nothing}
        ${tokens ? html`<span>${t('count.tokens', { count: tokens, number: formatNumber(tokens) })}</span>` : nothing}
        ${models.length ? html`<span class="sub">${models.join(', ')}</span>` : nothing}
      </div>
      <table>
        <thead><tr><th></th><th>#</th><th>${t('Given')}</th><th>${step.checks ? 'Verdict' : t('Handed on')}</th><th>${t('Time')}</th><th>${t('Tokens')}</th></tr></thead>
        <tbody>${agents.slice(0, ROWS_SHOWN).map((agent) => {
          const verdict = step.checks ? verdictOf(agent.output) : null
          const unfit = this.unfitOf(step, agent)
          const state = agent.state === 'done' && ((verdict && !verdict.passed) || unfit) ? 'refused' : agent.state
          const given = agent.n !== null ? inputs?.[agent.n - 1] : undefined
          const open = (): void => this.go({ key: nodeKey.step(step.id), item: agent.n ?? 1 })
          return html`<tr tabindex="0" @click=${open} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') open() }}>
            <td class="n"><span class="dot" data-state=${state} title=${state}></span></td>
            <td class="n">${agent.attempts > 1 ? html`${agent.n ?? ''} <span title=${t('Asked again')}>↻</span>` : String(agent.n ?? '')}</td>
            <td><div class="clamp">${given === undefined ? '' : itemLine(given)}</div></td>
            <td class=${state === 'failed' || state === 'refused' ? 'why' : ''}><div class="clamp">${handedWords(agent, step, made, unfit)}</div></td>
            <td class="num">${spanWords(agent.startedAt !== null && agent.endedAt !== null ? agent.endedAt - agent.startedAt : null)}</td>
            <td class="num">${agent.tokens ? agent.tokens.toLocaleString(localeSource.get()) : ''}</td>
          </tr>`
        })}</tbody>
      </table>
      ${agents.length > ROWS_SHOWN ? html`<p class="sub">And ${agents.length - ROWS_SHOWN} more.</p>` : nothing}
    </section>`
  }

  /** The items a person's agents were given, in order: the stack they run over or check. */
  private inputsOf(step: WorkflowPlanStepView): readonly unknown[] | null {
    return this.inputStack(step)?.items ?? null
  }

  private inputStack(step: WorkflowPlanStepView): WorkflowStackView | undefined {
    const over = step.checks ?? step.over
    return over ? this.plan?.stacks?.find((s) => s.id === over) : undefined
  }

  // One agent: what it was given, what it did, what it handed on.
  private renderAgent(step: WorkflowPlanStepView, n: number): TemplateResult {
    const agent = this.agentsOf(step).find((a) => (a.n ?? 1) === n)
    const kind = step.checks ? 'check' : 'step'
    const title = step.mode === 'perItem' || step.checks ? `${step.label}, item ${n}` : step.label
    const being = this.faceOf(step)
    if (!agent) return html`${this.hero(kind, title, t('No record of this sitting in the last run.'), this.wiring(step), being)}`
    return html`<div class="part">${this.hero(kind, title, [being ? `a sitting of ${being.name}` : step.job, agent.model ?? ''].filter(Boolean).join(' · '), this.wiring(step), being)}
      ${this.renderAgentBody(step, agent, n)}</div>`
  }

  private renderAgentBody(step: WorkflowPlanStepView, agent: WorkflowAgentRunView, n: number | null): TemplateResult {
    const plan = this.plan!
    const given = n !== null ? this.inputsOf(step)?.[n - 1] : undefined
    const sources = (step.reads ?? []).map((id) => plan.sources?.find((s) => s.id === id)).filter(Boolean)
    const t0 = agent.queuedAt ?? agent.startedAt ?? 0
    const at = (ms: number | null): string => (ms === null ? '' : `+${spanWords(Math.max(0, ms - t0)) || '0 ms'}`)
    const titles = plan.documentTitles ?? {}
    const verdict = step.checks ? verdictOf(agent.output) : null
    const handed = handedItems(agent.output)
    const overStack = step.checks ?? step.over
    const made = step.produces ? plan.stacks?.find((s) => s.id === step.produces) : undefined
    const unfit = this.unfitOf(step, agent)
    return html`<div class="cols three">
      <section><h2>${t('Given')}</h2>
        ${given !== undefined
          ? html`<div class="part">${renderItemCard(plan, n !== null ? stackObject(this.inputStack(step), n - 1) : null, given, n !== null ? n - 1 : null, undefined, 20)}
            ${overStack ? html`<p class="sub">Item ${n} of ${this.stackChip(overStack)}</p>` : nothing}</div>`
          : sources.length ? html`${sources.map((s) => html`<p>${s!.documentTitle ? `${s!.label} · ${s!.documentTitle}` : s!.label}</p>`)}`
            : html`<p class="sub">${t('The run input.')}</p>`}
      </section>
      <section><h2>${t('What it did')}</h2>
        <ol class="timeline">
          ${agent.queuedAt !== null ? html`<li><span class="what">${t('Queued')}</span>${agent.model ? html` <span class="detail">for ${agent.model}</span>` : nothing}</li>` : nothing}
          ${agent.startedAt !== null ? html`<li><span class="what">${t('Started')}</span><span class="at">${at(agent.startedAt)}</span></li>` : nothing}
          ${agent.tools.map((tool) => html`<li><span class="tool">${tool.gate}</span><span class="at">${at(tool.at)}</span>
            <div class="detail">${toolLine(tool.args, titles)}</div></li>`)}
          ${agent.state === 'done' || agent.state === 'failed' ? html`<li data-tone=${agent.state}><span class="what">${agent.state === 'done' ? t('Done') : 'Failed'}</span><span class="at">${at(agent.endedAt)}</span>
            <div class="detail">${[agent.turns ? plural(agent.turns, 'turn') : '', agent.tokens ? t('count.tokens', { count: agent.tokens, number: formatNumber(agent.tokens) }) : '',
              agent.attempts > 1 ? `asked ${agent.attempts} times` : ''].filter(Boolean).join(' · ')}</div></li>`
            : html`<li><span class="what">${agent.state === 'running' ? t('Working…') : 'Waiting'}</span></li>`}
        </ol>
      </section>
      <section><h2>${step.checks ? 'Verdict' : t('Handed on')}</h2>
        ${agent.state === 'failed' ? html`<div class="failure"><p><strong>${t('It failed.')}</strong> ${agent.error ?? ''}</p>
            <p class="sub">${agent.attempts > 1 ? t('It was asked again and failed again.') : t('Nothing it found was kept.')}</p></div>`
          : unfit ? html`<div class="failure"><p><strong>It handed back nothing that fit${made?.itemClass ? ` a ${made.itemClass.label.toLowerCase()}` : ''}:</strong> ${unfit.join('; ') || 'no reason given'}</p>
            <p class="sub">${t('What it answered was kept as testimony, not as an item.')}</p></div>`
          : verdict ? html`<div class="verdict" data-passed=${String(verdict.passed)}><p class="what">${verdict.passed ? 'Passed' : 'Refused'}</p>
              ${verdict.why ? html`<p>${verdict.why}</p>` : nothing}
              ${step.produces && verdict.passed ? html`<p class="sub" style="margin-top:6px">It went on to ${this.stackChip(step.produces)}</p>` : nothing}
              ${!verdict.passed ? html`<p class="sub" style="margin-top:6px">It waits with the other ${this.refusedChip(step)}</p>` : nothing}</div>`
            : handed ? (handed.length === 0 ? html`<p class="empty">${t('Nothing: this item held none.')}</p>`
              : html`<div class="part">${handed.slice(0, 50).map((item, i) => renderItemCard(plan, objectForItem(made, item), item, i, undefined, 12))}
                ${step.produces ? html`<p class="sub">Into ${this.stackChip(step.produces)}</p>` : nothing}</div>`)
              : agent.output !== null && agent.output !== undefined ? html`<div class="item">${itemText(agent.output)}</div>`
                : html`<p class="empty">${agent.state === 'done' ? 'Nothing.' : t('Not yet.')}</p>`}
      </section>
    </div>`
  }

  private refusedChip(step: WorkflowPlanStepView): TemplateResult {
    return html`<button class="chip" data-kind="check" @click=${() => this.go({ key: nodeKey.refused(step.id) })}>${t('refusals')}</button>`
  }

  // A stack: every item as a row of a table; filter it; open one.
  private renderStack(stack: WorkflowStackView): TemplateResult {
    const plan = this.plan!
    const items = stack.items ?? []
    const readers = plan.steps.filter((s) => s.over === stack.id || s.checks === stack.id || (s.consumes ?? []).includes(stack.id))
    const goes = (plan.destinations ?? []).filter((d) => d.receives === stack.id)
    const destinations = goes.map((d) => html`<button class="chip" data-kind="destination" @click=${() => plan.onSelect?.(nodeKey.destination(d.id))}>${d.label}</button>`)
    const unfit = unfitCount(stack)
    const sub = html`<span class="part"><span>${stack.items ? `${stackCountWords(stack, items.length)}${unfit ? `, ${unfit} unfit` : ''}` : 'Filled when the workflow runs'}</span>
      ${stack.producer ? html`<span class="part"><span>· made by</span> ${this.stepChip(stack.producer)}</span>` : nothing}
      ${readers.length + goes.length ? html`<span class="part"><span>· goes to</span> ${[...readers.map((s) => this.stepChip(s.id)), ...destinations]}</span>` : nothing}</span>`
    const fields = stackFieldWords(stack)
    const why = stack.objects?.some((o) => o?.stance === 'unfit') ? stack.objects.map((o) => (o?.stance === 'unfit' ? (o.violations ?? []).join('; ') || 'It does not fit.' : '')) : undefined
    return html`<div class="part">${this.hero('stack', stackName(stack), sub)}
      ${items.length === 0 ? html`<p class="empty">${[stack.items ? 'The last run left it empty.' : 'Nothing here until the workflow runs.', fields.length ? `Each ${stack.itemClass ? stack.itemClass.label.toLowerCase() : 'item'} will have ${fields.join(', ')}.` : ''].filter(Boolean).join(' ')}</p>`
        : this.renderTable(items, stackColumns(stack, items), (i) => this.go({ key: nodeKey.stack(stack.id), item: i + 1 }), why, stack.objects ?? undefined)}</div>`
  }

  private renderTable(
    items: readonly unknown[],
    columns: readonly TableColumn[],
    open: (index: number) => void,
    why?: readonly string[],
    objects?: readonly (ObjectModel | null)[],
  ): TemplateResult {
    const rows = items.map((item, index) => ({ item, index })).filter(({ item, index }) => matches(item, this.filter) || (why?.[index] ?? '').toLowerCase().includes(this.filter.toLowerCase()))
    return html`<div class="part"><div class="filter">
        <input type="search" placeholder=${t('count.filterItems', { count: items.length })} .value=${this.filter} aria-label=${t('Filter the items')}
          @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value }}>
        ${this.filter ? html`<span class="sub">${plural(rows.length, 'match', 'matches')}</span>` : nothing}
      </div>
      <table>
        <thead><tr><th>#</th>${[...columns.map((c) => html`<th title=${c.key}>${c.label}</th>`), ...(why ? [html`<th>${t('Why')}</th>`] : [])]}</tr></thead>
        <tbody>${rows.slice(0, ROWS_SHOWN).map(({ item, index }) => {
          const model = objects?.[index] ?? null
          return html`<tr tabindex="0" data-stance=${model?.stance ?? 'read'} @click=${() => open(index)} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') open(index) }}>
          <td class="n">${index + 1}${model?.stance === 'unfit' ? html`<span class="unfit-tag">${t('unfit')}</span>` : nothing}</td>
          ${columns.map((c, at) => html`<td class=${c.key === (model?.roleKeys.quote ?? 'quote') ? 'quote' : ''}><div class="clamp">${cellText(model, item, c.key, at === 0)}</div></td>`)}
          ${why ? html`<td class="why"><div class="clamp">${why[index] ?? ''}</div></td>` : nothing}
        </tr>`
        })}</tbody>
      </table>
      ${rows.length > ROWS_SHOWN ? html`<p class="sub">And ${rows.length - ROWS_SHOWN} more; filter to find them.</p>` : nothing}</div>`
  }

  // One item of a stack, whole, and its lineage: who made it, who worked it next, where it went.
  private renderStackItem(stack: WorkflowStackView, n: number): TemplateResult {
    const plan = this.plan!
    const item = stack.items?.[n - 1]
    if (item === undefined) return html`${this.hero('stack', `${stackName(stack)}, item ${n}`, t('Not in the last run.'))}`
    const model = stackObject(stack, n - 1)
    const producer = stack.producer ? plan.steps.find((s) => s.id === stack.producer) : undefined
    const same = JSON.stringify(item)
    // The agent that handed it back: a typed item names its sitting (wf:sitting); otherwise, a check passes on the item
    // it checked, and any other maker handed it in its output.
    const bySitting = producer && model?.testimony.sitting ? this.agentsOf(producer).find((a) => a.label === model.testimony.sitting) : undefined
    const maker = bySitting ?? (producer
      ? this.agentsOf(producer).find((a) => producer.checks ? false : (handedItems(a.output) ?? []).some((x) => JSON.stringify(x) === same))
      : undefined)
    const checkedFrom = producer?.checks ? plan.stacks?.find((s) => s.id === producer.checks)?.items?.findIndex((x) => JSON.stringify(x) === same) : undefined
    const workers = plan.steps.filter((s) => s.over === stack.id || s.checks === stack.id)
    const goes = (plan.destinations ?? []).filter((d) => d.receives === stack.id)
    // A typed item's page is its pane, which carries its title: the hero names the item, so the title is not said twice.
    const title = model ? `${model.classLabel} ${n}` : `${stackName(stack)}, item ${n}`
    const sub = model ? `One of ${stackCountWords(stack, stack.items?.length ?? 0)}${model.stance === 'unfit' ? ', and it does not fit' : ''}` : `One of ${plural(stack.items?.length ?? 0, 'item')}`
    return html`<div class="part">${this.hero('stack', title, sub)}
      <div class="cols">
        <section><h2>${model ? `The ${model.classLabel.toLowerCase()}` : t('The item')}</h2>${renderItemCard(plan, model, item, n - 1, undefined, 40, 'pane')}
          ${model && plan.onOpenObject ? html`<p style="margin-top:10px"><button class="link" @click=${() => plan.onOpenObject?.({ iri: model.iri, graphId: plan.graphId ?? null })}>${t('Open as an object')}</button></p>` : nothing}</section>
        <section><h2>${t('Its path')}</h2><div class="lineage">
          ${producer ? html`<div class="row"><span class="sub">${t('Made by')}</span>
            ${maker ? html`<button class="link" @click=${() => this.go({ key: nodeKey.step(producer.id), item: maker.n ?? 1 })}>${maker.label}</button>`
              : producer.checks && checkedFrom !== undefined && checkedFrom >= 0
                ? html`<span class="part"><button class="link" @click=${() => this.go({ key: nodeKey.step(producer.id), item: checkedFrom + 1 })}>${producer.label} #${checkedFrom + 1}</button>
                  <span class="sub">passed it, from item ${checkedFrom + 1} of</span> ${this.stackChip(producer.checks)}</span>`
                : this.stepChip(producer.id)}</div>` : nothing}
          ${workers.map((w) => html`<div class="row"><span class="sub">${w.checks ? t('Checked by') : t('Worked by')}</span>
            <button class="link" @click=${() => this.go({ key: nodeKey.step(w.id), item: n })}>${w.label} #${n}</button></div>`)}
          ${goes.map((d) => html`<div class="row"><span class="sub">${t('Goes to')}</span><button class="chip" data-kind="destination"
            @click=${() => plan.onSelect?.(nodeKey.destination(d.id))}>${d.label}</button></div>`)}
          ${!producer && workers.length + goes.length === 0 ? html`<p class="sub">${t('No one makes or reads this stack yet.')}</p>` : nothing}
        </div></section>
      </div></div>`
  }

  // What a check refused, and why.
  private renderRefusals(step: WorkflowPlanStepView): TemplateResult {
    const refused = (this.plan?.refused ?? []).filter((r) => r.step === step.id)
    const columns = [...new Set(refused.flatMap((r) => (isRecord(r.item) ? Object.keys(r.item) : [])))].filter((c) => c !== 'documentId' && c !== 'blockId')
    const ordered = [...columns.filter((c) => c === 'quote'), ...columns.filter((c) => c !== 'quote')].slice(0, 5).map((key) => ({ key, label: humanName(key) }))
    // What a check refused is an item of the stack it checks: a typed stack's refusals keep their class's columns.
    const checked = this.inputStack(step)
    const objects = checked?.itemClass ? refused.map((r) => objectForItem(checked, r.item)) : undefined
    const cols = checked?.itemClass ? stackColumns(checked, refused.map((r) => r.item)).slice(0, 5) : ordered
    return html`<div class="part">${this.hero('refused', `Refused by ${step.label}`, html`<span class="part">${checked?.itemClass ? stackCountWords(checked, refused.length) : plural(refused.length, 'item')} it would not pass on · ${this.stepChip(step.id)}</span>`)}
      ${refused.length === 0 ? html`<p class="empty">${t('It refused nothing in the last run.')}</p>`
        : this.renderTable(refused.map((r) => r.item), cols, (i) => this.go({ key: nodeKey.refused(step.id), item: i + 1 }), refused.map((r) => r.why), objects)}</div>`
  }

  private renderRefusal(step: WorkflowPlanStepView, n: number): TemplateResult {
    const refusal = (this.plan?.refused ?? []).filter((r) => r.step === step.id)[n - 1]
    if (!refusal) return html`${this.hero('refused', `Refusal ${n}`, t('Not in the last run.'))}`
    return html`<div class="part">${this.hero('refused', `Refused by ${step.label}`, `Refusal ${n}`)}
      <div class="cols"><section><h2>${t('The item')}</h2>${renderItemCard(this.plan, objectForItem(this.inputStack(step), refusal.item), refusal.item, n - 1, refusal.why, 40)}</section>
        <section><h2>${t('Why')}</h2><div class="verdict" data-passed="false"><p>${refusal.why}</p></div></section></div></div>`
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-workflow-focus')) {
  customElements.define('sh-workflow-focus', ShWorkflowFocus)
}
