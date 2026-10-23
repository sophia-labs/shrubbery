/**
 * `<sh-injerto>` — a bounded pane of one register's matter inside a host surface (principle IX, ratified by Vera
 * 2026-07-06; typed objects architecture D8.3). Here: one typed object inside a document's prose, around
 * `<sh-object-view slot="card">`. The frame applies the five laws:
 *
 *   1. framed and flagged: a quiet mono chip names the class and the register ("run testimony", "workspace object");
 *   2. subject-bound, never a survey: it takes ONE IRI, and has no way to list;
 *   3. bounded, with its own scroll: the object's window has a ceiling and scrolls inside it;
 *   4. the register's laws travel with the matter: the testimony line and the stance sit in the frame, outside the
 *      scroll, so they are always visible;
 *   5. a door to the full surface ("Open", the object page), honestly absent when the object cannot be resolved:
 *      then it says "Not in this graph" and shows the snapshot label the block keeps for exactly this case.
 *
 * Controlled: the host (the runtime's embed renderer) reads the object and sets `status` and `model`. It writes
 * nothing; "Open" is the same `sh-object-view-intent` the view emits.
 */

import { LocaleController, localizeLabel, t } from '@shrubbery/nucleus'
import { type ObjectModel, registerWords } from '@shrubbery/nucleus/object-faces'
import { css, html, LitElement, nothing, type TemplateResult } from 'lit'
import { OBJECT_VIEW_INTENT_EVENT, type ObjectViewIntent, testimonyLine } from './object-view-element.js'
import './object-view-element.js'

export type InjertoStatus = 'loading' | 'ready' | 'absent' | 'error'

const STANCE_WORDS: Readonly<Record<string, string>> = { unfit: 'unfit', retracted: 'retracted', contested: 'contested' }

export class ShInjerto extends LitElement {
  protected readonly _locale = new LocaleController(this)

  static override properties = {
    model: { attribute: false },
    status: { type: String, reflect: true },
    error: { type: String },
    iri: { type: String },
    graphId: { type: String, attribute: 'graph-id' },
    label: { type: String },
    classLabel: { type: String, attribute: 'class-label' },
  }

  declare model: ObjectModel | null
  declare status: InjertoStatus
  declare error: string
  declare iri: string
  declare graphId: string
  /** The title snapshot the block keeps, for a reader that cannot resolve the object. */
  declare label: string
  /** The class label snapshot. */
  declare classLabel: string

  constructor() {
    super()
    this.model = null
    this.status = 'loading'
    this.error = ''
    this.iri = ''
    this.graphId = ''
    this.label = ''
    this.classLabel = ''
  }

  static override styles = css`
    :host {
      display: block; box-sizing: border-box; margin: 6px 0; max-width: 100%;
      color: var(--mn-color-text-primary); font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    * { box-sizing: border-box; }
    .frame {
      display: flex; flex-direction: column; min-width: 0;
      border: 1px solid var(--mn-color-border-default); border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-canvas, var(--mn-color-surface-raised));
    }
    .frame[data-stance='unfit'] { border-left: 3px solid var(--mn-color-danger-border); }
    .frame[data-status='absent'] { border-style: dashed; }
    .head {
      display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 6px 4px 10px;
      border-bottom: 1px solid var(--mn-color-border-subtle);
    }
    .flag {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font: 500 11px/1.4 var(--mn-font-mono, ui-monospace, monospace); letter-spacing: .02em; color: var(--mn-color-text-secondary);
    }
    .door {
      flex: none; font: inherit; font-size: 12px; padding: 1px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--mn-color-border-default); background: var(--mn-color-surface-raised); color: inherit;
    }
    .door:hover { border-color: var(--mn-color-border-accent); }
    .window {
      max-height: var(--sh-injerto-max-height, 320px); overflow: auto; overscroll-behavior: contain; padding: 6px;
    }
    .window sh-object-view { --mn-radius-control: 6px; }
    .foot {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 4px 10px;
      border-top: 1px solid var(--mn-color-border-subtle); font-size: 11.5px; color: var(--mn-color-text-secondary);
    }
    .stance {
      font: 600 10.5px/1.4 var(--mn-font-chrome, system-ui, sans-serif); letter-spacing: .06em; text-transform: uppercase;
      padding: 0 6px; border-radius: 999px; border: 1px solid var(--mn-color-border-default);
    }
    .stance[data-stance='unfit'] { border-color: var(--mn-color-danger-border); color: var(--mn-color-text-danger); }
    .absent { padding: 10px 12px; display: grid; gap: 4px; }
    .absent .what { font-weight: 600; }
    .absent .snapshot { color: var(--mn-color-text-secondary); overflow-wrap: anywhere; }
    .absent code { font: 11px var(--mn-font-mono, ui-monospace, monospace); color: var(--mn-color-text-secondary); overflow-wrap: anywhere; }
    .waiting { padding: 10px 12px; color: var(--mn-color-text-secondary); }
  `

  private open(): void {
    const intent: ObjectViewIntent = { kind: 'open-object', iri: this.model?.iri ?? this.iri, graphId: this.graphId || null }
    this.dispatchEvent(new CustomEvent(OBJECT_VIEW_INTENT_EVENT, { detail: { intent }, bubbles: true, composed: true }))
  }

  private flag(): string {
    const model = this.status === 'ready' ? this.model : null
    const cls = model?.classLabel ?? this.classLabel ?? ''
    const register = model ? localizeLabel(registerWords(model.register)) : this.status === 'absent' ? t('not resolved') : ''
    return [cls || 'Object', register].filter(Boolean).join(' · ')
  }

  override render() {
    const model = this.status === 'ready' ? this.model : null
    const stance = model?.stance ?? 'read'
    return html`<figure class="frame" data-status=${this.status} data-stance=${stance} style="margin:0"
      aria-label=${`${this.flag()}: ${model?.title ?? this.label}`}>
      <figcaption class="head">
        <span class="flag" title=${this.iri}>${this.flag()}</span>
        ${this.status === 'absent' ? nothing : html`<button class="door" title=${t('Open it full size')} @click=${() => this.open()}>${t('Open')}</button>`}
      </figcaption>
      ${this.body(model)}
      ${model ? this.foot(model) : nothing}
    </figure>`
  }

  private body(model: ObjectModel | null): TemplateResult {
    if (this.status === 'absent') {
      return html`<div class="absent" role="note">
        <span class="what">${t('Not in this graph')}</span>
        <span class="snapshot">${this.label || t('This object')}${this.classLabel ? `, a ${this.classLabel.toLowerCase()}` : ''}, as it was when it was embedded.</span>
        <code>${this.iri}</code>
      </div>`
    }
    if (this.status === 'error') {
      return html`<div class="absent" role="note"><span class="what">${t('Could not read it')}</span>
        <span class="snapshot">${this.label || this.iri}${this.error ? `: ${this.error}` : ''}</span></div>`
    }
    if (!model) return html`<div class="waiting">Reading ${this.label || 'the object'}…</div>`
    return html`<div class="window"><sh-object-view slot="card" .model=${model} graph-id=${this.graphId} no-testimony no-actions></sh-object-view></div>`
  }

  private foot(model: ObjectModel): TemplateResult {
    const line = testimonyLine(model)
    const stance = STANCE_WORDS[model.stance]
    return html`<footer class="foot">
      ${stance ? html`<span class="stance" data-stance=${model.stance}>${localizeLabel(stance)}</span>` : nothing}
      <span class="line">${line || t('No testimony recorded')}</span>
    </footer>`
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('sh-injerto')) {
  customElements.define('sh-injerto', ShInjerto)
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-injerto': ShInjerto
  }
}
