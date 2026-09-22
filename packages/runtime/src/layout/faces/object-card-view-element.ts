/**
 * object-card-view-element.ts — `<sh-object-card-view>`, the real body for
 * the `card.object` face (WS1 §6.4, master spec §3 Slice 2 "the healthy
 * card"). The first MO-native display in Sophia.
 *
 * Deliberately dumb: renders only already-resolved display data — the mirror/
 * authority read, the field selection, and the strategy-label mapping all
 * live in `card-object-face.ts`, mirroring the same face/view-element split
 * every other face in this directory draws (`subject-card-view-element.ts`'s
 * own header).
 *
 * Plain `LitElement`, shadow DOM, token custom properties only (WS1 D-5):
 * `@shrubbery/runtime` does not depend on `@shrubbery/components`, so this is
 * NOT `SkinAware` — nothing in this card is structurally skin-dependent.
 *
 * SLICE HISTORY (master spec §3: "Slice 2 — the source-object seam and the
 * healthy card" then "Slice 5 — the contested stance and the contested
 * surface", master §4.5 tags this file `[2/5]`). Slice 2 shipped the HEALTHY
 * record/footer rendering. Slice 5 adds the card's CONTESTED POSTURE — a
 * STANCE this same element wears, not a second display: `stance`,
 * `provisionalHead`, `proposals`, `conflictId`, `contestReason`,
 * `showProposals`, the proposals section, and the `sh-object-intent`
 * emitter (WS1 §6.5, master §2.6). The empty-selection copy ("Choose an
 * object to see what was proposed.") is also Slice 5's fix — the contested
 * split (master §2.9's assembler branch) mints this leaf on every render,
 * including before anything is selected, and the generic pre-Slice-5 empty
 * message read `No object  in .  for this graph.` for that exact case.
 *
 * `.mn-kind[data-kind=…]` markup does NOT light `kind.css` on its own inside
 * a shadow root — CSS selectors never cross a shadow boundary, only inherited
 * custom PROPERTY VALUES do. This element's own `static styles` therefore
 * reproduces, token-driven against the SAME `--mn-kind-*` custom properties
 * `kind.css` defines, every kind this card actually emits: `identity`
 * (header), `state`/`metric`/`prose`/`reference` (field values, §6.9's
 * `inferFieldKind`), `testimony` (the footer's last-writer slot and
 * per-proposal bylines), and `affordance` (proposal action buttons, Slice 5).
 * `object-card-kind-parity.test.ts` guards this duplication against drift.
 */
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { DisplayKind } from '@shrubbery/nucleus'
import type { SourceObjectProvenance, SourceObjectUnavailable } from '../source-object-service.js'

/**
 * `sh-object-intent` (WS1 §6.4 "Events", master §2.6 — harmonized with WS2's
 * own event into one name, one discriminated union). The face performs no
 * write (WS1 D-12): this element never imports a mutation client and cannot
 * author a resolution; it only reports what the user pointed at.
 * `bubbles: true, composed: true` — the `SUBJECT_ROW_ACTIVATE_EVENT`
 * mechanism (`sparql-table-view-element.ts:38-49`), so it crosses this
 * element's own shadow boundary and reaches whatever leaf wrapper hosts it.
 */
export const OBJECT_INTENT_EVENT = 'sh-object-intent'

export interface ObjectIntentProposal {
  readonly operationId: string
  readonly sourceVersion: string
  /** Ask A. `clientId`, verbatim. Absent ⇒ the byline is the unattributed marker. */
  readonly observer?: string
  readonly isProjectedHead: boolean
  /** Resident, NOT an Ask-A dependency: `CurrentCandidateFace.record` ships
   *  on the wire today. Without it a resolution host's field-wise composer
   *  has no records to diff. */
  readonly record: Readonly<Record<string, unknown>>
}

export type ObjectCardIntent =
  /** Open the resolution menu for this object. Raised by the proposals-
   *  section header's "Compose a merged value…" affordance. */
  | {
      readonly kind: 'resolve'
      readonly objectKey: string
      readonly conflictId: string
      readonly anchor: { readonly x: number; readonly y: number }
      readonly proposals: readonly ObjectIntentProposal[]
      readonly seedOperationId?: string
    }
  /** Direct keep, when the user already chose from the card rather than the menu. */
  | {
      readonly kind: 'keep-candidate'
      readonly objectKey: string
      readonly conflictId: string
      readonly chosenOperationId: string
    }
  /**
   * "Show me this proposal's full record." The PRIMARY effect is this
   * element's own and unconditional: it toggles the proposal's record open
   * inline (client-local disclosure, LAY-009 — survives no reload, needs no
   * params field). The event still travels so a host that wants to ALSO
   * split a leaf may; ignoring it costs the user nothing.
   */
  | {
      readonly kind: 'inspect-candidate'
      readonly objectKey: string
      readonly conflictId: string
      readonly operationId: string
      /** This element's own POST-gesture state, so a mirroring host agrees. */
      readonly expanded: boolean
    }

export interface ObjectIntentDetail {
  readonly intent: ObjectCardIntent
}

export type ObjectCardViewStatus = 'loading' | 'ready' | 'error' | 'empty'

/** One already-resolved, already-formatted record field (WS1 §6.4). */
export interface ObjectCardField {
  /** short display label (§6.9) */
  readonly label: string
  /** the untruncated key / predicate IRI (title=) */
  readonly fullLabel: string
  /** already-formatted display text */
  readonly value: string
  /** the seven shipped kinds only */
  readonly kind: DisplayKind
  /** metric only */
  readonly unit?: string
  /** reference only */
  readonly href?: string
  /** JSON null / no value — renders an em dash */
  readonly absent?: boolean
  /** object/array rendered as compact JSON prose */
  readonly nested?: boolean
}

/**
 * One proposal in a contested object's fold (WS1 §6.4; master §2.11's
 * `CurrentCandidateFace`). `fields` is the display-flattened record
 * (§6.9's `selectObjectCardFields` path, applied per-candidate) for the
 * inline "Show full record" disclosure; `record` is the SAME candidate's
 * RAW record, carried alongside because the `resolve` intent's
 * `ObjectIntentProposal.record` needs the untransformed value for a
 * resolution host's field-wise composer to diff — this element is what
 * DISPATCHES that event, so it needs the raw record itself, not only its
 * own display projection of it. (CHAIR — this field is additive to WS1
 * §6.4's own table, which named `fields` but not `record`; without it the
 * event this same section describes has no data to carry. See the Slice 5
 * build-log entry.)
 */
export interface ObjectCardProposal {
  readonly operationId: string
  /** shown as first 8 chars, full value in `title=` */
  readonly sourceVersion: string
  readonly baseVersion: string
  readonly record: Readonly<Record<string, unknown>>
  readonly fields: readonly ObjectCardField[]
  /** true for the operationId the fold projected as head */
  readonly projected: boolean
  /** Ask A. Absent ⇒ the unattributed marker (checked PER PROPOSAL — a
   *  resolved head is permanently unattributed even when a sibling isn't). */
  readonly observer?: string
  /** Opaque ordering value — NEVER a timestamp (C-D10). Rendered `order {n}`. */
  readonly causalOrder?: number
}

function shortHash(value: string): string {
  return value.slice(0, 8)
}

@customElement('sh-object-card-view')
export class ShObjectCardView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-3, 12px);
      box-sizing: border-box;
      gap: var(--mn-space-2, 8px);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card);
    }
    header.identity {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }
    .class-line {
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
    }
    h1.title {
      margin: 0;
      font-size: var(--mn-text-md, 1rem);
      font-weight: 650;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }
    /* Layout-invisible wrappers — see the comments in _body()/_record()/
       _proposalsSection(). */
    .body-region,
    .record-region,
    .proposals-region {
      display: contents;
    }
    dl.record {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--mn-space-3, 12px);
      row-gap: var(--mn-space-1-5, 6px);
      margin: 0;
    }
    dl.record dt {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      white-space: nowrap;
      padding-top: 0.15em;
    }
    dl.record dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .truncation-note {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-tertiary);
    }
    footer.testimony {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      margin-top: auto;
      padding-top: var(--mn-space-2, 8px);
      border-top: 1px solid var(--mn-color-border-subtle);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary);
    }
    footer.testimony .caveat {
      flex-basis: 100%;
      color: var(--mn-color-text-tertiary);
    }
    .state {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary);
      text-align: center;
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-danger-strong);
    }

    /* ── kind.css duplication (this file's header) — token-driven, same vars ── */
    .mn-kind {
      color: var(--mn-kind-text);
    }
    .mn-kind[data-kind='identity'] {
      --mn-kind-register-current: identity;
      font-weight: 650;
    }
    .mn-kind[data-kind='state'] {
      --mn-kind-register-current: state;
      color: var(--mn-kind-muted);
    }
    .mn-kind[data-kind='metric'] {
      --mn-kind-register-current: metric;
    }
    .mn-kind[data-kind='metric'] .mn-kind-value {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
    }
    .mn-kind[data-kind='metric'] .mn-kind-unit {
      color: var(--mn-kind-metric-unit);
      margin-inline-start: 0.25rem;
    }
    .mn-kind[data-kind='prose'] {
      --mn-kind-register-current: prose;
      line-height: 1.55;
    }
    .mn-kind[data-kind='reference'] {
      --mn-kind-register-current: reference;
    }
    .mn-kind[data-kind='reference'] .mn-kind-link {
      color: var(--mn-kind-reference-text);
      text-decoration-color: color-mix(in srgb, var(--mn-kind-reference-text) 45%, transparent);
      text-underline-offset: 0.14em;
    }
    .mn-kind[data-kind='testimony'] .mn-kind-attribution {
      color: var(--mn-kind-testimony-text);
      margin-inline-start: 0.4rem;
    }
    .mn-kind[data-kind='testimony'] {
      --mn-kind-register-current: testimony;
    }
    .mn-kind[data-kind='testimony'] .mn-kind-attribution::before {
      content: '— ';
    }
    .mn-kind[data-kind='affordance'] {
      --mn-kind-register-current: affordance;
      color: var(--mn-kind-accent);
      font-weight: 600;
    }

    /* ── contested posture (Slice 5) ── */
    .provisional {
      align-self: flex-start;
    }
    section.proposals {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding-top: var(--mn-space-2, 8px);
      border-top: 1px solid var(--mn-color-border-subtle);
    }
    section.proposals h2 {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      color: var(--mn-color-text-muted);
    }
    .proposals-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
    }
    .order-note,
    .reason-line {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-tertiary);
    }
    ol.proposal-list {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li.proposal {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-control, 6px);
    }
    li.proposal[data-projected] {
      border-color: var(--mn-stance-contested-edge, var(--mn-color-border-subtle));
    }
    .proposal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
      flex-wrap: wrap;
    }
    .projected-badge {
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      color: var(--mn-stance-contested-ink, var(--mn-color-text-secondary));
    }
    .proposal-meta {
      display: flex;
      gap: var(--mn-space-2, 8px);
      flex-wrap: wrap;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-tertiary);
    }
    .proposal-actions {
      display: flex;
      gap: var(--mn-space-2, 8px);
      flex-wrap: wrap;
    }
    .proposal-actions button,
    .compose-action button {
      font: inherit;
      cursor: pointer;
    }
    .proposal-record {
      margin-top: var(--mn-space-1, 4px);
    }
    .ethic-line {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-tertiary);
    }
  `

  @property({ type: String }) status: ObjectCardViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) objectKey = ''
  @property({ type: String }) vocab = ''
  @property({ type: String, attribute: 'class-name' }) className_ = ''
  @property({ type: String }) objectId = ''
  @property({ type: String }) title = ''
  @property({ attribute: false }) fields: readonly ObjectCardField[] = []
  @property({ type: Number }) shownOf = 0
  @property({ type: String }) provenance: SourceObjectProvenance | '' = ''
  @property({ type: String }) reconciliationStrategy = ''
  @property({ type: String }) sourceVersion = ''
  @property({ type: String }) lastWriter = ''
  @property({ type: String }) lastWriterOperationId = ''
  @property({ type: Boolean, attribute: 'attribution-recorded' }) attributionRecorded = false
  /** WS1 §6.5: `data-stance="contested"` on `:host` — the only stance this
   *  element ever wears, driven by `read.conflictId !== undefined`. */
  @property({ type: String, reflect: true, attribute: 'data-stance' }) stance: 'contested' | null = null
  /** Marks the projected head as hash-order, not chosen. Driven by `conflictId`, not `contest`. */
  @property({ type: Boolean }) provisionalHead = false
  @property({ attribute: false }) proposals: readonly ObjectCardProposal[] = []
  /** Echoed on every emitted intent. */
  @property({ type: String }) conflictId = ''
  /** The cell's own words, verbatim — empty in the degraded case. */
  @property({ type: String }) contestReason = ''
  /** Param-driven; `false` collapses the section to its header + count. */
  @property({ type: Boolean }) showProposals = true
  @property({ attribute: false }) unavailable: readonly SourceObjectUnavailable[] = []
  @property({ type: String }) epoch = ''

  /**
   * `:host[data-provenance][data-attribution]` (§6.4's structure diagram) —
   * imperative, not `reflect: true`, because `data-attribution` is a
   * VALUE-MAPPED derivation (`attributionRecorded: boolean` -> the string
   * `'recorded' | 'unrecorded'`), which Lit's declarative reflection cannot
   * express on its own.
   */
  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('provenance')) {
      if (this.provenance) this.dataset.provenance = this.provenance
      else delete this.dataset.provenance
    }
    if (changed.has('attributionRecorded')) {
      this.dataset.attribution = this.attributionRecorded ? 'recorded' : 'unrecorded'
    }
  }

  private _kindValue(
    text: string,
    kind: DisplayKind,
    opts: { readonly unit?: string; readonly href?: string; readonly title?: string } = {},
  ): TemplateResult {
    if (kind === 'reference' && opts.href) {
      return html`<span class="mn-kind" data-kind="reference" title=${opts.title ?? nothing}
        ><a class="mn-kind-link" href=${opts.href}>${text}</a></span
      >`
    }
    if (kind === 'metric') {
      return html`<span class="mn-kind" data-kind="metric" title=${opts.title ?? nothing}
        ><span class="mn-kind-value">${text}</span
        >${opts.unit ? html`<span class="mn-kind-unit">${opts.unit}</span>` : nothing}</span
      >`
    }
    return html`<span class="mn-kind" data-kind=${kind} title=${opts.title ?? nothing}
      ><span class="mn-kind-value">${text}</span></span
    >`
  }

  private _testimonyValue(text: string, unattributedNote: string): TemplateResult {
    if (!text) return html`<span class="mn-kind" data-kind="state"><span class="mn-kind-value">${unattributedNote}</span></span>`
    return html`<span class="mn-kind" data-kind="testimony"
      ><span class="mn-kind-value">—</span><span class="mn-kind-attribution">${text}</span></span
    >`
  }

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  /** The shared `<dl>` fragment — the main record AND a proposal's own
   *  expanded record both render through this one path (§6.9). */
  private _fieldsList(fields: readonly ObjectCardField[]): TemplateResult {
    return html`<dl class="record">
      ${fields.map(
        (field) => html`
          <dt title=${field.fullLabel}>${field.label}</dt>
          <dd>
            ${field.absent
              ? this._kindValue('—', 'state', { title: 'No value recorded.' })
              : field.nested
                ? this._kindValue(field.value, 'prose', {
                    title: 'A structured value, shown as JSON. Per-class rendering has not been defined for this class.',
                  })
                : this._kindValue(field.value, field.kind, { unit: field.unit, href: field.href })}
          </dd>
        `,
      )}
    </dl>`
  }

  private _record(): TemplateResult {
    if (this.fields.length === 0) {
      return this._state('This object has no recorded fields.')
    }
    // Wrapped in `.record-region` for the same reason `_body()`'s
    // `.body-region` is — two top-level dynamic child parts (the `<dl>` and
    // the truncation note) with no wrapping element mis-render under
    // happy-dom (verified via a minimal repro outside this component).
    return html`<div class="record-region">
      ${this._fieldsList(this.fields)}
      ${this.shownOf !== this.fields.length
        ? html`<div class="truncation-note">Showing ${this.fields.length} of ${this.shownOf} fields.</div>`
        : nothing}
    </div>`
  }

  private _strategyChip(): TemplateResult {
    if (!this.reconciliationStrategy || this.unavailable.includes('reconciliationStrategy')) {
      return html`<span class="chip">reconciliation not read</span>`
    }
    return html`<span class="chip" title="How this class reconciles concurrent writes.">${this.reconciliationStrategy}</span>`
  }

  private _versionSlot(): TemplateResult {
    if (!this.sourceVersion || this.unavailable.includes('sourceVersion')) {
      return html`<span class="version">source version not read</span>`
    }
    return html`<span class="version" title=${this.sourceVersion}>source ${shortHash(this.sourceVersion)}</span>`
  }

  private _writerSlot(): TemplateResult {
    return html`<span class="writer">${this._testimonyValue(this.lastWriter, 'Last writer not recorded by this cell.')}</span>`
  }

  private _provenanceSlot(): TemplateResult {
    if (this.provenance === 'authority-projection') return html`<span class="provenance">read live from the cell's projection</span>`
    return html`<span class="provenance">from the local mirror, epoch ${this.epoch}</span>`
  }

  private _footer(): TemplateResult {
    return html`
      <footer class="testimony">
        <span class="class">${this.vocab}.${this.className_}</span>
        <span class="strategy">${this._strategyChip()}</span>
        ${this._versionSlot()} ${this._writerSlot()} ${this._provenanceSlot()}
        ${this.provenance === 'authority-projection'
          ? html`<span class="caveat">Source version, reconciliation strategy, and proposals are not available from this read.</span>`
          : nothing}
      </footer>
    `
  }

  // ── contested posture (Slice 5, WS1 §6.5) ─────────────────────────────

  /** Client-local disclosure state for a proposal's inline record (LAY-009 —
   *  never persisted, never a descriptor param, survives no reload). */
  #expandedOperationIds = new Set<string>()

  private _emitIntent(intent: ObjectCardIntent): void {
    this.dispatchEvent(
      new CustomEvent<ObjectIntentDetail>(OBJECT_INTENT_EVENT, {
        detail: { intent },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /** "Keep this one" — direct keep, no optimistic state, no disabling, no spinner (§6.5). */
  private _onKeep(proposal: ObjectCardProposal): void {
    this._emitIntent({
      kind: 'keep-candidate',
      objectKey: this.objectKey,
      conflictId: this.conflictId,
      chosenOperationId: proposal.operationId,
    })
  }

  /** "Show/Hide full record" — the PRIMARY effect is this element's own and
   *  unconditional (C-D21): toggles inline, then also emits the intent. */
  private _onInspect(proposal: ObjectCardProposal): void {
    const expanded = !this.#expandedOperationIds.has(proposal.operationId)
    if (expanded) this.#expandedOperationIds.add(proposal.operationId)
    else this.#expandedOperationIds.delete(proposal.operationId)
    this.requestUpdate()
    this._emitIntent({
      kind: 'inspect-candidate',
      objectKey: this.objectKey,
      conflictId: this.conflictId,
      operationId: proposal.operationId,
      expanded,
    })
  }

  /** "Compose a merged value…" — the proposals-section header's own
   *  affordance; raises `resolve` with no `seedOperationId` (the gesture
   *  did not originate on a specific proposal). */
  private _onCompose(event: MouseEvent): void {
    const anchorEl = event.currentTarget as HTMLElement
    const rect = anchorEl.getBoundingClientRect()
    this._emitIntent({
      kind: 'resolve',
      objectKey: this.objectKey,
      conflictId: this.conflictId,
      anchor: { x: rect.left, y: rect.bottom },
      proposals: this.proposals.map(
        (proposal): ObjectIntentProposal => ({
          operationId: proposal.operationId,
          sourceVersion: proposal.sourceVersion,
          ...(proposal.observer !== undefined ? { observer: proposal.observer } : {}),
          isProjectedHead: proposal.projected,
          record: proposal.record,
        }),
      ),
    })
  }

  /** The header's contested/provisional markers. Two INDEPENDENT signals
   *  (WS1 §6.4's own property table) rendered together when either is set —
   *  in practice both are driven by `conflictId !== undefined` (§6.5). */
  private _provisionalMarker(): TemplateResult | typeof nothing {
    if (this.stance !== 'contested' && !this.provisionalHead) return nothing
    return html`<div class="provisional">
      ${this.stance === 'contested'
        ? html`<span class="mn-kind" data-kind="state"><span class="mn-kind-value">Contested</span></span>`
        : nothing}
      ${this.provisionalHead
        ? html`<span
            class="mn-kind"
            data-kind="state"
            title="While this object is contested, the cell projects the proposal with the lowest version hash. That is a deterministic order, not a decision."
            ><span class="mn-kind-value">Provisional head — hash order, not chosen</span></span
          >`
        : nothing}
    </div>`
  }

  private _proposalFields(proposal: ObjectCardProposal): TemplateResult {
    if (proposal.fields.length === 0) return this._state('This object has no recorded fields.')
    return this._fieldsList(proposal.fields)
  }

  private _proposalRow(proposal: ObjectCardProposal): TemplateResult {
    const expanded = this.#expandedOperationIds.has(proposal.operationId)
    return html`<li class="proposal" ?data-projected=${proposal.projected}>
      <div class="proposal-head">
        ${proposal.projected ? html`<span class="projected-badge">Projected head</span>` : nothing}
        <span class="byline"
          >${this._testimonyValue(
            proposal.observer ?? '',
            'Proposal not attributed — this cell does not record who wrote it.',
          )}</span
        >
      </div>
      <div class="proposal-meta">
        <span class="version" title=${proposal.sourceVersion}>version ${shortHash(proposal.sourceVersion)}</span>
        <span class="base">from base ${shortHash(proposal.baseVersion)}</span>
        ${proposal.causalOrder !== undefined ? html`<span class="order">order ${proposal.causalOrder}</span>` : nothing}
      </div>
      <div class="proposal-actions">
        ${this.proposals.length > 1
          ? html`<button
              type="button"
              class="mn-kind"
              data-kind="affordance"
              title="Select this proposal as the object's record."
              @click=${() => this._onKeep(proposal)}
            ><span class="mn-kind-value">Keep this one</span></button>`
          : nothing}
        <button
          type="button"
          class="mn-kind"
          data-kind="affordance"
          title=${expanded ? "Collapse this proposal's record." : "Show this proposal's complete record here."}
          @click=${() => this._onInspect(proposal)}
        ><span class="mn-kind-value">${expanded ? 'Hide full record' : 'Show full record'}</span></button>
      </div>
      ${expanded ? html`<div class="proposal-record">${this._proposalFields(proposal)}</div>` : nothing}
    </li>`
  }

  /**
   * The proposals section (WS1 §6.5). Renders whenever `stance==='contested'`
   * — three sub-states: DEGRADED (`conflictId` present, `contest` absent —
   * `unavailable` names it), COLLAPSED (`showProposals===false` — header +
   * count only), and the full list. The standing ethic line renders
   * unconditionally within all three — it is what a person needs to know
   * BEFORE choosing, not a hover-only aside.
   *
   * `.proposals-region` (below) is the SAME real, empirically-found Lit
   * defect `mn-bottom-bar.ts` (master §3 Slice 4) already named: two
   * adjacent dynamic child expressions — here, the reason-line ternary
   * (`nothing`-or-`TemplateResult`) immediately followed by the proposal
   * list's `.map()`-produced array — silently misalign under happy-dom when
   * they sit as bare top-level siblings with no wrapping element: the
   * ternary's content renders INSIDE `<ol>` and the real `<li>` rows vanish
   * (confirmed via an isolated minimal repro, not merely a hunch). The fix
   * is the SAME one `.body-region`/`.record-region` already apply: wrap the
   * adjacent dynamic siblings in one `display:contents` element.
   */
  private _proposalsSection(): TemplateResult | typeof nothing {
    if (this.stance !== 'contested') return nothing
    const degraded = this.unavailable.includes('contest')
    const count = this.proposals.length
    return html`<section class="proposals">
      <div class="proposals-header">
        <h2>Proposals</h2>
        ${!degraded && this.showProposals
          ? html`<span class="compose-action"
              ><button
                type="button"
                class="mn-kind"
                data-kind="affordance"
                title="Write a new record for this object, starting from these proposals."
                @click=${(event: MouseEvent) => this._onCompose(event)}
              ><span class="mn-kind-value">Compose a merged value…</span></button></span
            >`
          : nothing}
      </div>
      ${degraded
        ? html`<p class="order-note">This object is contested, but the proposals did not arrive with this epoch.</p>`
        : !this.showProposals
          ? html`<p class="order-note">${count} proposals — hidden by this view's settings.</p>`
          : html`
              <p class="order-note">
                ${count >= 2 ? `${count} proposals share one observed base.` : 'One proposal references a base this cell no longer has.'}
              </p>
              <p class="order-note">Ordered by version hash, not by time.</p>
              <div class="proposals-region">
                ${this.contestReason ? html`<p class="reason-line">${this.contestReason}</p>` : nothing}
                <ol class="proposal-list">
                  ${this.proposals.map((proposal) => this._proposalRow(proposal))}
                </ol>
              </div>
            `}
      <p class="ethic-line">Resolving selects — the unchosen proposal remains in the ledger's history.</p>
    </section>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Loading…')
    if (this.status === 'error') {
      return this._state(this.error || 'This object could not be read.', 'danger')
    }
    if (this.status === 'empty') {
      // Master §2.5's empty-selection locator (`{kind:'graph', graphId}`,
      // no `subjectIri`) resolves through this SAME `status:'empty'` path,
      // never a fabricated object identity — `objectId`/`vocab`/
      // `className_` stay '' (the face never populates them for that
      // locator). A REAL locator whose read genuinely found nothing DOES
      // carry a real `objectId` (parsed from the URN before the read ran) —
      // that is the honest discriminator between the two, not a new prop.
      return this.objectId === '' && this.vocab === '' && this.className_ === ''
        ? this._state('Choose an object to see what was proposed.')
        : this._state(`No object ${this.objectId} in ${this.vocab}.${this.className_} for this graph.`)
    }
    // The record + footer are wrapped in a `display:contents` element rather
    // than left as bare top-level siblings beside `<header>` — mirrors
    // subject-card-view-element.ts's own `.fields-region` comment: some DOM
    // implementations (verified: happy-dom) mis-render two dynamic child
    // parts that sit as bare adjacent top-level template children with no
    // wrapping element (confirmed via a minimal repro outside this
    // component — the SAME two bindings render correctly once wrapped).
    // Layout-invisible; changes no box.
    return html`
      <header class="identity">
        <div class="class-line">
          <span class="mn-kind" data-kind="identity"><span class="mn-kind-value">${this.vocab} · ${this.className_}</span></span>
        </div>
        <h1 class="title">
          <span class="mn-kind" data-kind="identity"><span class="mn-kind-value">${this.title}</span></span>
        </h1>
        ${this._provisionalMarker()}
      </header>
      <div class="body-region">${this._record()} ${this._proposalsSection()} ${this._footer()}</div>
    `
  }

  render(): TemplateResult {
    return html`<div
      class="stage"
      role="region"
      aria-label=${this.title || this.objectKey || 'Meaningful Object card'}
    >
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-object-card-view': ShObjectCardView
  }
}
