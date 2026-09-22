/**
 * subject-card-view-element.ts — `<sh-subject-card-view>`, the real property
 * card body for the `card.subject` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4: "property card for one
 * subject (SELECT ?p ?o) — the inspector-lite / pin-card precursor, and the
 * collection-bound item face").
 *
 * Deliberately dumb: renders only already-resolved `title`/`fields` display
 * strings — the `?p ?o` query, the graph resolution, and the
 * titleField/fields selection all live in card-subject-face.ts, mirroring
 * the same face/view-element split every other face in this directory draws.
 *
 * Aesthetic-overhaul pass (builder B3): shares `stat-scalar-view-element.ts`'s
 * typographic hierarchy — small-caps muted field labels, tabular figures on
 * numeric-looking field values — AND its card chrome (surface-raised +
 * `--mn-radius-surface` + `--mn-shadow-card`, the Observatory instrument
 * glow), so a dashboard mixing `stat.scalar` and `card.subject` leaves reads
 * as one designed system, not two. Color tokens carry no raw-hex fallbacks —
 * tokens.css is always loaded in-product (harness pages import it too).
 */
import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

/** A value is decoratively "numeric" when its plain text parses as a finite number — never a guess from formatting. */
function isNumericFieldValue(value: string): boolean {
  return value !== '' && Number.isFinite(Number(value))
}

export type SubjectCardViewStatus = 'loading' | 'ready' | 'error'

export interface SubjectCardField {
  readonly label: string
  readonly value: string
}

@customElement('sh-subject-card-view')
export class ShSubjectCardView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    /* The same card chrome as stat.scalar's .card — one instrument language
       across the face set (in Observatory: the lit bezel + glow). */
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
    .title {
      /* On the published scale (the old 17-pixel magic value sat between
         --mn-text-md and -lg for no articulable reason; md keeps the title
         subordinate to stat.scalar's 3xl hero while landing on a real step). */
      font-size: var(--mn-text-md, 1rem);
      font-weight: 650;
      letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }
    /* Layout-invisible wrapper — see the comment in _body(). */
    .fields-region {
      display: contents;
    }
    dl.fields {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--mn-space-3, 12px);
      row-gap: var(--mn-space-1-5, 6px);
      margin: 0;
    }
    /* Small-caps muted field labels — the same eyebrow treatment as
       stat.scalar's .label (shared typographic hierarchy). */
    dt {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      white-space: nowrap;
      padding-top: 0.15em;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    /* A numeric-looking field value reads as a counted quantity, same as the
       stat hero numeral — tabular lining figures for clean digit stacking. */
    dd[data-numeric] {
      font-variant-numeric: tabular-nums lining-nums;
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
  `

  @property({ type: String }) status: SubjectCardViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) title = ''
  @property({ type: String }) subjectIri = ''
  @property({ attribute: false }) fields: readonly SubjectCardField[] = []

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Loading…')
    if (this.status === 'error') return this._state(this.error || 'This subject could not be loaded.', 'danger')
    // The conditional (fields vs. empty-state) content is wrapped in its own
    // `display:contents` element rather than left as a bare sibling part
    // alongside `.title` — layout-invisible, but gives the dynamic part a
    // stable single-child DOM parent. Some DOM implementations mis-render a
    // TemplateResult-valued child part that sits as a bare top-level sibling
    // next to another dynamic/static part in the same template.
    return html`
      <div class="title">${this.title}</div>
      <div class="fields-region">
        ${this.fields.length === 0
          ? this._state('No fields configured.')
          : html`
              <dl class="fields">
                ${this.fields.map(
                  (field) =>
                    html`<dt>${field.label}</dt><dd ?data-numeric=${isNumericFieldValue(field.value)}>${field.value || '—'}</dd>`,
                )}
              </dl>
            `}
      </div>
    `
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" aria-label=${this.title || this.subjectIri || 'Subject card'}>${this._body()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-subject-card-view': ShSubjectCardView
  }
}
