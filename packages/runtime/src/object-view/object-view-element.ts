/**
 * `<sh-object-view .model slot="inline|card|pane" stance>` — the one view of a typed object (typed objects architecture
 * D7, `plans/2026-10-20-typed-objects/README.md`). Every host draws a typed object through it: the workflow inspector
 * and full views, the object page, the injerto in a document, a layout leaf (`object.card`).
 *
 * | slot   | what it shows                                                                                       |
 * |--------|-----------------------------------------------------------------------------------------------------|
 * | inline | a chip: the class, the title, the stance                                                            |
 * | card   | the title, two to six fields (a nested value summarized to its title), the testimony line            |
 * | pane   | every field (a nested value as a sub-card in full), the quote and its door to the document, the      |
 * |        | testimony, and the documents it is used in (`.usedIn`, from the host)                                |
 *
 * Controlled and dumb: the model is built by `typedObjectModel` (`@shrubbery/nucleus/object-faces`), the face params
 * by `resolveObjectFace`. It writes nothing (D-12): every gesture is one `sh-object-view-intent` event (`bubbles`,
 * `composed`), which the host handles — open the object, open a document at a block, embed it in a document.
 *
 * Self-styled with `--mn-*` token custom properties only, so it is shadow-safe in `<sh-editor-host>`'s shadow tree and
 * in light DOM alike. `slot` is a global HTML attribute: it is read here (as `faceSlot`) so templates can write
 * `slot="card"`, but a host that PROJECTS light-DOM children through `<slot>`s must not place it as such a child (it
 * would be assigned to a named slot); every host in this repo renders it inside its own shadow tree or a node view.
 */

import type { ObjectStance } from '@shrubbery/nucleus/object-faces'
import {
  type ObjectFaceParams,
  type ObjectModel,
  type ObjectModelField,
  objectSlotFields,
  resolveObjectFace,
} from '@shrubbery/nucleus/object-faces'
import type { FaceSlot } from '@shrubbery/nucleus/value-faces'
import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import { kindValue, OBJECT_KIND_STYLES } from './kind-value.js'

export const OBJECT_VIEW_INTENT_EVENT = 'sh-object-view-intent'

export type ObjectViewIntent =
  | { readonly kind: 'open-object'; readonly iri: string; readonly graphId: string | null }
  | { readonly kind: 'open-document'; readonly documentId: string; readonly blockId: string | null; readonly graphId: string | null }
  | { readonly kind: 'embed'; readonly iri: string; readonly graphId: string | null; readonly label: string; readonly classLabel: string }
  | { readonly kind: 'open-run'; readonly runIri: string; readonly runId: string; readonly graphId: string | null }

/** One document a typed object is embedded in (the object page's "Used in"). */
export interface ObjectUsage {
  readonly documentId: string
  readonly title?: string | null
  readonly blockId?: string | null
}

export type ObjectViewSlot = Extract<FaceSlot, 'inline' | 'card' | 'pane' | 'block'>

/** A moment, as a person reads it: today's time, or the day and time. */
export function whenWords(at: string | undefined, now = new Date()): string {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** The testimony in one line: the sitting (or the being), the run, the moment. */
export function testimonyLine(model: ObjectModel): string {
  const t = model.testimony
  const who = t.sitting ?? t.by?.label ?? (t.by ? shortAgent(t.by.agentIri) : '')
  return [who ? `by ${who}` : '', t.run ? `run ${t.run.id}` : '', whenWords(t.at)].filter(Boolean).join(' · ')
}

function shortAgent(iri: string): string {
  const tail = iri.slice(Math.max(iri.lastIndexOf(':'), iri.lastIndexOf('/'), iri.lastIndexOf('#')) + 1)
  return tail.length > 18 ? `${tail.slice(0, 16)}…` : tail
}

const STANCE_WORDS: Readonly<Record<ObjectStance, string>> = {
  read: '',
  unfit: 'Unfit',
  retracted: 'Retracted',
  contested: 'Contested',
}

function isSlot(value: string): value is ObjectViewSlot {
  return value === 'inline' || value === 'card' || value === 'pane' || value === 'block'
}

function isStance(value: string): value is ObjectStance {
  return value === 'read' || value === 'unfit' || value === 'retracted' || value === 'contested'
}

export class ShObjectView extends LitElement {
  static override properties = {
    model: { attribute: false },
    faceSlot: { type: String, attribute: 'slot', reflect: false },
    stance: { type: String, reflect: true },
    graphId: { type: String, attribute: 'graph-id' },
    params: { attribute: false },
    usedIn: { attribute: false },
    documentTitles: { attribute: false },
    noTestimony: { type: Boolean, attribute: 'no-testimony' },
    noActions: { type: Boolean, attribute: 'no-actions' },
  }

  declare model: ObjectModel | null
  declare faceSlot: string
  /** An override of the model's own stance (a host that knows more, e.g. contested). Empty: the model's. */
  declare stance: string
  declare graphId: string
  declare params: ObjectFaceParams | null
  /** Pane: the documents that embed it; null while the host has not looked. */
  declare usedIn: readonly ObjectUsage[] | null
  declare documentTitles: Readonly<Record<string, string>> | null
  /** The frame draws the testimony itself (the injerto keeps it outside its scroll). */
  declare noTestimony: boolean
  declare noActions: boolean

  constructor() {
    super()
    this.model = null
    this.faceSlot = 'card'
    this.stance = ''
    this.graphId = ''
    this.params = null
    this.usedIn = null
    this.documentTitles = null
    this.noTestimony = false
    this.noActions = false
  }

  static override styles = css`
    ${OBJECT_KIND_STYLES}
    :host {
      display: block;
      box-sizing: border-box;
      min-width: 0;
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    :host([slot='inline']) { display: inline-block; vertical-align: baseline; max-width: 100%; }
    * { box-sizing: border-box; }
    h1, h2, h3, p, dl, dd, blockquote { margin: 0; }
    .view { display: flex; flex-direction: column; gap: var(--mn-space-2, 8px); min-width: 0; }
    .card {
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-raised);
    }
    .view[data-stance='unfit'] { border-left: 3px solid var(--mn-color-danger-border); }
    .view[data-stance='retracted'] { opacity: .72; }
    .view[data-stance='retracted'] .title { text-decoration: line-through; text-decoration-thickness: 1px; }
    .view[data-stance='contested'] { border-color: var(--mn-stance-contested-edge, var(--mn-color-border-subtle)); }
    .class-line {
      display: flex; align-items: center; gap: var(--mn-space-2, 8px); flex-wrap: wrap;
      font: 500 11px/1.3 var(--mn-font-mono, ui-monospace, monospace); letter-spacing: .02em;
      color: var(--mn-color-text-secondary);
    }
    .stance {
      font: 600 10.5px/1.4 var(--mn-font-chrome, system-ui, sans-serif); letter-spacing: .06em; text-transform: uppercase;
      padding: 0 6px; border-radius: 999px; border: 1px solid var(--mn-color-border-default); color: var(--mn-color-text-secondary);
    }
    .stance[data-stance='unfit'] { border-color: var(--mn-color-danger-border); color: var(--mn-color-text-danger); background: var(--mn-color-danger-surface, transparent); }
    .title { font: 600 var(--mn-text-md, 14px) / 1.3 var(--mn-font-chrome, system-ui, sans-serif); overflow-wrap: anywhere; }
    .pane .title { font-size: 22px; line-height: 1.2; }
    .subtitle { color: var(--mn-color-text-secondary); overflow-wrap: anywhere; }
    .violations { margin: 0; padding: 6px 10px; list-style: none; border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-danger-surface, var(--mn-color-surface-raised)); color: var(--mn-color-text-danger); font-size: 12px; }
    .violations li + li { margin-top: 2px; }
    blockquote.quote {
      padding-left: 10px; border-left: 2px solid var(--mn-color-border-default);
      font-family: var(--mn-font-serif, Georgia, serif); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere;
    }
    .card blockquote.quote { font-size: 13.5px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .note { overflow-wrap: anywhere; }
    dl.record { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: var(--mn-space-3, 12px); row-gap: 3px; font-size: 12.5px; }
    dl.record dt {
      color: var(--mn-color-text-secondary); font-size: 11.5px; font-weight: 600; white-space: nowrap; padding-top: .1em;
      max-width: 14em; overflow: hidden; text-overflow: ellipsis;
    }
    dl.record dd { overflow-wrap: anywhere; min-width: 0; }
    .card dl.record dd .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .nested { display: grid; gap: 6px; }
    .sub {
      padding: 6px 10px; border: 1px solid var(--mn-color-border-subtle); border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-canvas, transparent);
    }
    .sub .sub-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 2px; }
    .sub .sub-class { font: 500 10.5px/1.3 var(--mn-font-mono, ui-monospace, monospace); color: var(--mn-color-text-secondary); }
    .sub .sub-title { font-weight: 600; }
    .testimony { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11.5px; color: var(--mn-color-text-secondary); }
    .card .testimony { padding-top: 6px; border-top: 1px solid var(--mn-color-border-subtle); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    button.quiet {
      font: inherit; font-size: 12px; border: 1px solid var(--mn-color-border-default); background: var(--mn-color-surface-raised);
      color: inherit; border-radius: var(--mn-radius-control, 6px); padding: 2px 10px; cursor: pointer;
    }
    button.quiet:hover { border-color: var(--mn-color-border-accent); }
    button.link {
      font: inherit; border: 0; background: none; padding: 0; cursor: pointer; text-align: left;
      color: var(--mn-color-text-accent, var(--mn-color-accent)); text-decoration: underline; text-underline-offset: 2px;
    }
    section h2 {
      font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--mn-color-text-secondary);
      font-weight: 600; margin: 0 0 6px;
    }
    .pane { gap: 18px; }
    .pane header { display: grid; gap: 4px; }
    .pane .lines { display: grid; gap: 4px; }
    .pane .lines .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
    .pane .lines .row > .what { color: var(--mn-color-text-secondary); min-width: 6.5em; }
    .used { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
    .muted { color: var(--mn-color-text-secondary); }
    code { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 11.5px; overflow-wrap: anywhere; }
    .chip {
      font: inherit; font-size: 12px; display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%;
      padding: 1px 9px; border-radius: 999px; border: 1px solid var(--mn-color-border-default);
      background: var(--mn-color-surface-raised); color: inherit; cursor: pointer; overflow: hidden; white-space: nowrap;
    }
    .chip:hover { border-color: var(--mn-color-border-accent); }
    .chip .chip-class { font: 500 10.5px var(--mn-font-mono, ui-monospace, monospace); color: var(--mn-color-text-secondary); }
    .chip .chip-title { overflow: hidden; text-overflow: ellipsis; }
    .chip[data-stance='unfit'] { border-color: var(--mn-color-danger-border); }
    .empty { color: var(--mn-color-text-secondary); font-style: italic; }
  `

  private get slotName(): ObjectViewSlot {
    return isSlot(this.faceSlot) ? this.faceSlot : 'card'
  }

  private get effectiveStance(): ObjectStance {
    return isStance(this.stance) ? this.stance : (this.model?.stance ?? 'read')
  }

  private emit(intent: ObjectViewIntent): void {
    this.dispatchEvent(new CustomEvent(OBJECT_VIEW_INTENT_EVENT, { detail: { intent }, bubbles: true, composed: true }))
  }

  private graph(): string | null {
    return this.graphId || null
  }

  private openObject(): void {
    if (this.model) this.emit({ kind: 'open-object', iri: this.model.iri, graphId: this.graph() })
  }

  private embed(): void {
    const model = this.model
    if (model) this.emit({ kind: 'embed', iri: model.iri, graphId: this.graph(), label: model.title, classLabel: model.classLabel })
  }

  override render() {
    const model = this.model
    if (!model) return html`<div class="view card"><p class="empty">Nothing to show.</p></div>`
    const slot = this.slotName
    const stance = this.effectiveStance
    const face = resolveObjectFace(model.classIri, slot, stance, [], { view: this.params ?? undefined })
    if (slot === 'inline') return this.renderInline(model, stance)
    if (slot === 'pane' || slot === 'block') return this.renderPane(model, stance, face.params)
    return this.renderCard(model, stance, face.params)
  }

  private stanceBadge(stance: ObjectStance): TemplateResult | typeof nothing {
    const words = STANCE_WORDS[stance]
    return words ? html`<span class="stance" data-stance=${stance}>${words}</span>` : nothing
  }

  private violations(model: ObjectModel, params: ObjectFaceParams): TemplateResult | typeof nothing {
    if (params.violations === false || !model.violations?.length) return nothing
    return html`<ul class="violations" aria-label="Why it does not fit">${model.violations.map((v) => html`<li>${v}</li>`)}</ul>`
  }

  private renderInline(model: ObjectModel, stance: ObjectStance): TemplateResult {
    return html`<button class="chip" data-stance=${stance} title=${`${model.classLabel}: ${model.title}`} @click=${() => this.openObject()}>
      <span class="chip-class">${model.classLabel}</span> <span class="chip-title">${model.title}</span> ${this.stanceBadge(stance)}
    </button>`
  }

  /** A field's value: an em dash when absent, a nested value's titles in a card, its sub-cards in a pane. */
  private fieldValue(field: ObjectModelField, full: boolean, depth: number): TemplateResult {
    if (field.absent) return kindValue('—', 'state', { title: 'No value recorded.' })
    if (field.objects?.length) {
      if (!full) return kindValue(field.value, 'identity')
      return html`<div class="nested">${field.objects.map((o) => this.renderSub(o, depth + 1))}</div>`
    }
    if (field.nested) return kindValue(field.value, 'prose', { title: 'A structured value, shown as JSON.' })
    return kindValue(field.value, field.kind, { unit: field.unit, href: field.href })
  }

  private fieldList(fields: readonly ObjectModelField[], full: boolean, depth = 0): TemplateResult {
    return html`<dl class="record">${fields.map((field) => html`<dt title=${field.description ?? field.fullLabel}>${field.label}</dt>
      <dd>${full ? this.fieldValue(field, true, depth) : html`<div class="clamp">${this.fieldValue(field, false, depth)}</div>`}</dd>`)}</dl>`
  }

  /** A nested object as a sub-card, in full. */
  private renderSub(model: ObjectModel, depth: number): TemplateResult {
    const fields = model.fields.filter((f) => f.key !== model.roleKeys.title)
    return html`<div class="sub"><div class="sub-head"><span class="sub-class">${model.classLabel}</span> <span class="sub-title">${model.title}</span></div>
      ${fields.length ? this.fieldList(fields, true, depth) : nothing}</div>`
  }

  private testimony(model: ObjectModel): TemplateResult | typeof nothing {
    const line = testimonyLine(model)
    return line ? html`<div class="testimony" title=${model.testimony.by?.agentIri ?? ''}>${line}</div>` : nothing
  }

  private renderCard(model: ObjectModel, stance: ObjectStance, params: ObjectFaceParams): TemplateResult {
    const quoteKey = model.roleKeys.quote
    const fields = objectSlotFields(model, 'card', params.maxFields ?? 6).filter((f) => !(f.key === quoteKey && model.roles.quote))
    return html`<article class="view card" data-stance=${stance} aria-label=${`${model.classLabel}: ${model.title}`}>
      <div class="class-line"><span>${model.classLabel}</span>${this.stanceBadge(stance)}</div>
      <h3 class="title">${model.title}</h3>
      ${model.subtitle ? html`<p class="subtitle">${model.subtitle}</p>` : nothing}
      ${this.violations(model, params)}
      ${model.roles.quote ? html`<blockquote class="quote">${model.roles.quote}</blockquote>` : nothing}
      ${fields.length ? this.fieldList(fields, false) : nothing}
      ${!this.noTestimony && params.testimony !== false ? this.testimony(model) : nothing}
      ${this.noActions ? nothing : html`<div class="actions">
        <button class="quiet" @click=${() => this.openObject()}>Open</button>
        <button class="quiet" @click=${() => this.embed()}>Embed in a document…</button>
      </div>`}
    </article>`
  }

  private documentTitle(documentId: string): string {
    return this.documentTitles?.[documentId] ?? 'the document'
  }

  private renderPane(model: ObjectModel, stance: ObjectStance, params: ObjectFaceParams): TemplateResult {
    const drawn = new Set([model.roles.quote ? model.roleKeys.quote : undefined, model.roles.note ? model.roleKeys.note : undefined, model.roleKeys.title])
    const fields = model.fields.filter((f) => !drawn.has(f.key))
    const doc = model.roles.document
    const t = model.testimony
    const graphId = this.graph()
    return html`<article class="view pane" data-stance=${stance} aria-label=${`${model.classLabel}: ${model.title}`}>
      <header>
        <div class="class-line"><span>${model.classLabel}</span><span>· ${model.register === 'run' ? 'run testimony' : 'workspace object'}</span>${this.stanceBadge(stance)}</div>
        <h1 class="title">${model.title}</h1>
        ${model.subtitle ? html`<p class="subtitle">${model.subtitle}</p>` : nothing}
      </header>
      ${this.violations(model, params)}
      ${model.roles.quote || doc ? html`<section><h2>The quote</h2><div class="lines">
        ${model.roles.quote ? html`<blockquote class="quote">${model.roles.quote}</blockquote>` : html`<p class="muted">No quote recorded.</p>`}
        ${doc ? html`<div class="actions"><button class="quiet" @click=${() => this.emit({ kind: 'open-document', documentId: doc.documentId, blockId: doc.blockId ?? null, graphId })}>Show in ${this.documentTitle(doc.documentId)}</button></div>` : nothing}
      </div></section>` : nothing}
      ${model.roles.note ? html`<section><h2>Note</h2><p class="note">${model.roles.note}</p></section>` : nothing}
      <section><h2>Fields</h2>${fields.length ? this.fieldList(fields, true) : html`<p class="muted">It has no other fields.</p>`}</section>
      ${params.testimony !== false && !this.noTestimony ? html`<section><h2>Testimony</h2><div class="lines">
        ${t.sitting ? html`<div class="row"><span class="what">Handed back by</span> <span>${t.sitting}</span></div>` : nothing}
        ${t.by ? html`<div class="row"><span class="what">The being</span> <span>${t.by.label ?? html`<code>${t.by.agentIri}</code>`}</span></div>` : nothing}
        ${t.run ? html`<div class="row"><span class="what">In run</span> <button class="link" @click=${() => this.emit({ kind: 'open-run', runIri: t.run!.iri, runId: t.run!.id, graphId })}>${t.run.id}</button></div>` : nothing}
        ${t.at ? html`<div class="row"><span class="what">At</span> <span>${whenWords(t.at)}</span></div>` : nothing}
        ${!t.sitting && !t.by && !t.run && !t.at ? html`<p class="muted">No testimony recorded: who made it and when are not known.</p>` : nothing}
        <div class="row"><span class="what">IRI</span> <code>${model.iri}</code></div>
      </div></section>` : nothing}
      <section class="used-in"><h2>Used in</h2>${this.renderUsedIn()}</section>
      ${this.noActions ? nothing : html`<div class="actions"><button class="quiet" @click=${() => this.embed()}>Embed in a document…</button></div>`}
    </article>`
  }

  private renderUsedIn(): TemplateResult {
    const used = this.usedIn
    const graphId = this.graph()
    if (used === null) return html`<p class="muted">Looking…</p>`
    if (used.length === 0) return html`<p class="muted">No document embeds it yet.</p>`
    return html`<ul class="used">${used.map((u) => html`<li><button class="link"
      @click=${() => this.emit({ kind: 'open-document', documentId: u.documentId, blockId: u.blockId ?? null, graphId })}>${u.title || u.documentId}</button></li>`)}</ul>`
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-object-view')) {
  customElements.define('sh-object-view', ShObjectView)
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-object-view': ShObjectView
  }
}
