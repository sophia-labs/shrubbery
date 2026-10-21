/**
 * The being's face, drawn (world-UX slice A, "the cast"). Two small elements, used at every zoom:
 *
 * - `<sh-being-mark agent-id name size>`: the being's mark, `agentMark(agentId)`'s colour with the name's first letter
 *   (the same mark the `/choreograph` dossier draws).
 * - `<sh-being-face .face variant="card|line">`: the mark, the name (the post that cast it), and only the facts a run
 *   observed: kind, models, sittings, failures. `card` is the inspector's and the page's header; `line` is one row of the
 *   Cast list.
 *
 * Controlled and dumb: the face is built by `beingFaces` (`@shrubbery/nucleus/object-faces`); every gesture is one
 * `sh-being-intent` event (`bubbles`, `composed`) that the host handles. No level, no mood, no rarity.
 */

import { agentMark } from '@shrubbery/nucleus/kinds'
import { type BeingFace, beingFacts, sittingsWords } from '@shrubbery/nucleus/object-faces'
import { css, html, LitElement, nothing } from 'lit'

export const BEING_INTENT_EVENT = 'sh-being-intent'

export type BeingIntent = { readonly kind: 'open-being'; readonly iri: string; readonly agentId: string }

export const BEING_MARK_STYLES = css`
  .mark {
    display: inline-grid; place-items: center; flex: none; width: var(--being-mark-size, 22px); height: var(--being-mark-size, 22px);
    border: 1px solid color-mix(in srgb, var(--agent-color) 48%, transparent); border-radius: calc(var(--being-mark-size, 22px) * .3);
    background: color-mix(in srgb, var(--agent-color) 18%, var(--mn-color-surface-raised, #fff)); color: var(--agent-color);
    font: 650 calc(var(--being-mark-size, 22px) * .48)/1 var(--mn-font-display, Georgia, serif); user-select: none;
  }
`

export class ShBeingMark extends LitElement {
  static override properties = {
    agentId: { type: String, attribute: 'agent-id' },
    name: { type: String },
    size: { type: Number },
  }
  declare agentId: string
  declare name: string
  declare size: number

  constructor() {
    super()
    this.agentId = ''
    this.name = ''
    this.size = 22
  }

  static override styles = [BEING_MARK_STYLES, css`:host { display: inline-flex; vertical-align: middle; }`]

  override render() {
    if (!this.agentId) return nothing
    const mark = agentMark(this.agentId)
    return html`<span class="mark" style=${`--agent-color:${mark.color};--being-mark-size:${this.size}px`}
      role="img" aria-label=${`${this.name || 'A being'}, mark ${mark.colorName}`} title=${mark.colorName}>${(this.name || '?').slice(0, 1).toLocaleUpperCase()}</span>`
  }
}

export class ShBeingFace extends LitElement {
  static override properties = { face: { attribute: false }, variant: { type: String } }
  declare face: BeingFace | null
  declare variant: 'card' | 'line'

  constructor() {
    super()
    this.face = null
    this.variant = 'card'
  }

  static override styles = [BEING_MARK_STYLES, css`
    :host { display: block; color: var(--mn-color-text-primary); font: var(--mn-text-sm, 13px)/1.45 var(--mn-font-chrome); }
    * { box-sizing: border-box; }
    .card { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border: 1px solid var(--mn-color-border-subtle); border-radius: 10px; background: var(--mn-color-surface-raised); }
    .card .mark { --being-mark-size: 44px; }
    .who { min-width: 0; }
    .name { font: 600 15px/1.25 var(--mn-font-chrome); overflow-wrap: anywhere; }
    .eyebrow { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mn-color-text-secondary); }
    .facts { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; color: var(--mn-color-text-secondary); }
    .facts .bad { color: var(--mn-color-text-danger); }
    .line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .line .name { font-weight: 500; font-size: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .line .count { margin-left: auto; flex: none; color: var(--mn-color-text-secondary); font-variant-numeric: tabular-nums; }
  `]

  override render() {
    const face = this.face
    if (!face) return nothing
    const mark = html`<sh-being-mark agent-id=${face.agentId} name=${face.name} .size=${this.variant === 'line' ? 20 : 44}></sh-being-mark>`
    if (this.variant === 'line') {
      return html`<div class="line" title=${face.iri}>${mark}<span class="name">${face.name}</span>
        <span class="count">${face.sittings > 0 ? sittingsWords(face.sittings) : ''}${face.failed ? html`, <span class="bad">${face.failed} failed</span>` : nothing}</span></div>`
    }
    const facts = beingFacts(face)
    return html`<div class="card" data-agent=${face.agentId}>${mark}
      <div class="who">
        <div class="eyebrow">${face.checks ? 'Checks as' : 'Cast as'} · ${face.mark.colorName}</div>
        <div class="name" title=${face.iri}>${face.name}</div>
        ${facts.length ? html`<div class="facts">${facts.map((fact) => html`<span class=${/ failed$/.test(fact) ? 'bad' : ''}>${fact}</span>`)}</div>` : nothing}
      </div></div>`
  }
}

/** Emit one being gesture from inside any shadow tree. */
export function emitBeingIntent(from: EventTarget, intent: BeingIntent): void {
  from.dispatchEvent(new CustomEvent(BEING_INTENT_EVENT, { detail: { intent }, bubbles: true, composed: true }))
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('sh-being-mark')) customElements.define('sh-being-mark', ShBeingMark)
  if (!customElements.get('sh-being-face')) customElements.define('sh-being-face', ShBeingFace)
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-being-mark': ShBeingMark
    'sh-being-face': ShBeingFace
  }
}
