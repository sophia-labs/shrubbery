/**
 * greenhouse-views.ts — THE GREENHOUSE, the cultivation surface (pure Lit views).
 *
 * The fourth RHIZOME surface (greenhouse-design-20260620): the climate house where
 * the gardener tunes HOW the agent forms + reaches its beliefs. This is the `dom`
 * face of the SAME KnobResource/GreenhouseResource the conneg server renders to
 * curl/turtle/json — NO second data path. The shell (main.ts) reads live via
 * greenhouse-world, hands these views the resources, and lits them into the surface.
 *
 * IT APPLIES THE BOUQUET ERGONOMICS (cited inline by P-number; exemplar bouquet-
 * views.ts):
 *   P0  ONE dominant focal point — the marquee SUPERSESSION miss-meter is the single
 *       largest/brightest/most-whitespace element, alone in an accent band at top;
 *       blur the page → only "is the agent leaking duplicate heads, yes/no" survives.
 *   P1  Gestalt grouping by REDUNDANT encoding — each knob FAMILY is a tinted enclosed
 *       common-region zone (zone + glyph + heading + tone), never colour alone.
 *   P2  STABLE spatial zones — CLIMATE → JUDGMENT → REACH → LAWS → METER&SPEND, every
 *       visit; the marquee is always the top band.
 *   P3  overview → details-on-demand — at rest each knob is its gist (value + meter,
 *       one line); the provenance / laws / per-axis rationale expand behind <details>.
 *   P4  the "why" (provenance) is a QUIET layer adjacent to the dial, demoted.
 *   P5/P6 demotion + object constancy — a scrubbed-back past value is faded+struck+
 *       below+dated; the host plays the staged transition on an as-of change.
 *   P7  clean = quiet — a green meter (0 misses) demotes to a one-line tick, never an
 *       alarm widget; full weight is spent only on a FLAGGING meter.
 *
 * TOKEN/ICON discipline — all colour/space/radius/type via `--mn-*`; the RED meter
 * uses the DANGER ROLE TOKENS (--mn-color-danger / -surface / -border), never hex.
 * Glyphs are REGISTERED lucide icon() (never emoji); the SVG inherits currentColor.
 *
 * THE ENTITY-RESOLUTION control (§4b, the LIVE one) carries the strategy selector +
 * the distinct-subject meter + the MERGE/UNMERGE affordances: its [merge] button
 * emits `rz-merge` (the REAL write the shell fulfils via the data layer), then the
 * meter re-reads collapsed (3→1). The MERGE-GHOST on the Plot is in dom-views.ts.
 *
 * Pure: resources in, TemplateResult out. No fetch, no SPARQL.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { epochMsToIso } from '@shrubbery/nucleus'
import { icon } from '@shrubbery/components'
import type {
  GreenhouseResource,
  KnobAxis,
  KnobFamily,
  KnobMeter,
  KnobResource,
} from '@shrubbery/render'

/** The family glyph (P1: redundant with the zone + heading + tone). */
const FAMILY_GLYPH: Readonly<Record<KnobFamily, string>> = {
  CLIMATE: 'thermometer',
  JUDGMENT: 'layers',
  REACH: 'clock',
  LAWS: 'sliders',
  'METER & SPEND': 'wallet',
}

/** The stable §2 family order (P2). */
const FAMILY_ORDER: readonly KnobFamily[] = ['CLIMATE', 'JUDGMENT', 'REACH', 'LAWS', 'METER & SPEND']

/** A short date (YYYY-MM-DD) from an ISO dateTime, or a dash. */
function shortDate(dt?: string | null): string {
  return dt ? dt.slice(0, 10) : '—'
}

/** Knob createdAt is EPOCH MS (R4c): derive the short date through the ISO wire form. */
function shortDateFromEpoch(ms?: number | null): string {
  return ms == null ? '—' : shortDate(epochMsToIso(ms))
}

/** Detected near-duplicate clusters the EntRes control surfaces (from the data layer). */
export interface GhostCluster {
  /** The signature key (e.g. "user·5k-pb"). */
  readonly signature: string
  /** The human label (e.g. "user · 5K-PB"). */
  readonly label: string
  /** The member record IRIs (≥2) — passed back verbatim to merge(). */
  readonly recIris: readonly string[]
  /** How many records are in the cluster. */
  readonly n: number
  /** Whether these records are CURRENTLY merged (a sameSubjectAs edge exists). */
  readonly merged: boolean
}

/**
 * A token-driven VU meter — `value` cells filled toward the PROBLEM out of `max`. We
 * compose it from `<div>`s (there is no mn-meter component yet — the Bouquet composes
 * its constellation from primitives the same way). A clean meter reads near-empty.
 *
 * DANGER FLOOR (the squint intent, P0): the focal danger signal must read LOUD, not
 * faint. A single both-active leak (value=1 against a max of 8) would otherwise light
 * only 1/8 cells — a nearly-empty bar for the most important warning on the surface.
 * So when a meter is FLAGGING (green=false) we floor the lit cells at `DANGER_FLOOR`
 * (≈ half the bar) so the eye reads "this is wrong" at a glance; a higher value still
 * fills more. A clean meter is untouched (it should read near-empty, P7).
 */
const DANGER_FLOOR = 4

function vuMeter(value: number, target: number, green: boolean): TemplateResult {
  const max = 8
  const span = Math.max(max, value, target + 1)
  const proportional = Math.max(0, Math.min(max, Math.round((value / span) * max)))
  // A flagging meter never reads faint: floor it so the danger is visually loud.
  const filled = green ? proportional : Math.max(DANGER_FLOOR, proportional)
  const cells = Array.from({ length: max }, (_, i) => i < filled)
  return html`
    <div class="gh-vu ${green ? 'gh-vu-ok' : 'gh-vu-danger'}" role="meter" aria-valuenow=${value} aria-valuemax=${max}>
      ${cells.map((on) => html`<span class="gh-vu-cell ${on ? 'on' : ''}"></span>`)}
    </div>
  `
}

/**
 * THE MARQUEE — ★ the focal supersession miss-meter (P0). The single dominant
 * element: largest type, an accent (or DANGER when flagging) band, alone at the top,
 * top of order. It names the offender verbatim ("both active: 27:12 AND 25:50") so
 * blurring the page leaves exactly "is the agent leaking duplicate heads, yes/no."
 * A clean run demotes to a quiet green tick (P7).
 */
function marqueeMeter(knob: KnobResource): TemplateResult {
  const m = knob.meter
  const flagging = !m.green
  return html`
    <section class="gh-marquee ${flagging ? 'gh-marquee-danger' : 'gh-marquee-ok'}" data-marquee data-focal data-knob=${knob.id}>
      <div class="gh-marquee-eyebrow">
        <span class="gh-marquee-glyph">${icon(knob.glyph, { size: 18 })}</span>
        <span class="gh-marquee-star">★</span>
        <span class="gh-marquee-name">${knob.title}</span>
        <span class="gh-marquee-family">${knob.family}</span>
      </div>
      <div class="gh-marquee-effect" data-effect>
        ${vuMeter(m.value, m.target, m.green)}
        <span class="gh-marquee-verdict ${flagging ? 'danger' : 'ok'}" data-verdict>
          ${flagging
            ? html`${icon('alert-triangle', { size: 16 })}<span>UNDER-SUPERSEDING</span>`
            : html`${icon('check', { size: 16 })}<span>clean — 1 active head per State subject</span>`}
        </span>
      </div>
      ${flagging
        ? html`<ul class="gh-marquee-offenders" data-offenders>
            ${m.offenders.map((o) => html`<li class="gh-offender" data-offender>${o}</li>`)}
          </ul>`
        : html`<p class="gh-marquee-clean" data-clean>${m.value}/${m.target} · no both-active leak</p>`}
      <p class="gh-marquee-meterline" data-meterline>
        → ${m.label}: <strong>${m.value}</strong> <span class="gh-muted">(target: ${m.target})</span>
      </p>
      <!-- P3/P4: the axes + the why ride behind a quiet details reveal. -->
      <details class="gh-marquee-more" data-knob-more>
        <summary class="gh-more-summary">${icon('info', { size: 12 })}<span>axes &amp; provenance</span></summary>
        ${axesStrip(knob.axes)}
        ${provenance(knob)}
      </details>
    </section>
  `
}

/** The per-axis strip (the two-axis JUDGMENT forks) — value + choices, locked-aware. */
function axesStrip(axes: readonly KnobAxis[]): TemplateResult | typeof nothing {
  if (axes.length === 0) return nothing
  return html`
    <ul class="gh-axes" data-axes>
      ${axes.map(
        (a) => html`
          <li class="gh-axis ${a.locked ? 'gh-axis-locked' : ''}" data-axis=${a.key}>
            <span class="gh-axis-key">${a.label}</span>
            <span class="gh-axis-choices">
              ${a.choices.map(
                (c) => html`<span class="gh-axis-choice ${c === a.value ? 'active' : ''}">${c}</span>`,
              )}
            </span>
            ${a.locked ? html`<span class="gh-axis-lock" title="locked">${icon('alert-circle', { size: 11 })}</span>` : nothing}
            ${a.note ? html`<span class="gh-axis-note">${a.note}</span>` : nothing}
          </li>
        `,
      )}
    </ul>
  `
}

/** The QUIET provenance layer (P4) — justifiedBy + who/when, or the default note. */
function provenance(knob: KnobResource): TemplateResult {
  const has = knob.justifiedBy || knob.createdBy || knob.createdAt != null
  return html`
    <p class="gh-prov" data-prov>
      ${has
        ? html`why
            ${knob.justifiedBy ? html`<code>${knob.justifiedBy}</code> ·` : nothing}
            ${knob.createdBy ? html`by ${knob.createdBy} ·` : nothing}
            ${knob.createdAt != null ? html`set ${shortDateFromEpoch(knob.createdAt)}` : nothing}`
        : html`<span class="gh-muted">default value — no PATCH has set this dial yet (<code>:tune:</code> holds none).</span>`}
    </p>
  `
}

/** The write-mode badge (P7 — staged knobs are quietly badged, never alarm weight). */
function writeBadge(knob: KnobResource): TemplateResult {
  if (knob.writeMode === 'live') {
    return html`<span class="gh-write gh-write-live" data-write="live" title="writes the graph for real">LIVE</span>`
  }
  if (knob.writeMode === 'read-only') {
    return html`<span class="gh-write gh-write-ro" data-write="read-only" title="a legend, not a rewrite path">read-only</span>`
  }
  return html`<span class="gh-write gh-write-staged" data-write="staged" title="PATCH lands in :tune: but is not yet applied to the runtime (WP5.2)">staged · WP5.2</span>`
}

/** A compact meter readout for a non-focal knob (P7: clean = a quiet tick). */
function knobMeterLine(m: KnobMeter): TemplateResult {
  // P7 — a NOT-YET-MEASURED placeholder (no derived read wired) must NOT wear a
  // confident green tick; it demotes to a quiet muted "not yet measured" state so a
  // 0/0 stub is visibly distinct from a genuinely-derived clean pass. No VU bar (an
  // empty bar would read as a real near-empty meter).
  if (m.measured === false) {
    return html`
      <span class="gh-knob-meter unmeasured" data-knob-meter data-unmeasured>
        <span class="gh-knob-meter-val">
          ${icon('help-circle', { size: 12 })}
          <span>not yet measured</span>
        </span>
      </span>
    `
  }
  return html`
    <span class="gh-knob-meter ${m.green ? 'ok' : 'danger'}" data-knob-meter>
      ${vuMeter(m.value, m.target, m.green)}
      <span class="gh-knob-meter-val">
        ${m.green ? icon('check', { size: 12 }) : icon('alert-triangle', { size: 12 })}
        <span>${m.value}${m.unit ?? ''}/${m.target}${m.unit ?? ''}</span>
      </span>
    </span>
  `
}

/** The LAWS legend rows (P3 — one-liners at rest, the law text on demand). */
function lawsLegend(knob: KnobResource): TemplateResult | typeof nothing {
  if (knob.laws.length === 0) return nothing
  return html`
    <ul class="gh-laws" data-laws>
      ${knob.laws.map(
        (law) => html`
          <li class="gh-law" data-law=${law.kind}>
            <span class="gh-law-kind">${law.kind}</span>
            <span class="gh-law-rule">${law.rule}</span>
            <details class="gh-law-more">
              <summary class="gh-more-summary">${icon('info', { size: 11 })}</summary>
              <span class="gh-law-detail">${law.detail}</span>
            </details>
          </li>
        `,
      )}
    </ul>
  `
}

/**
 * THE ENTITY-RESOLUTION control (§4b, the LIVE one) — the strategy selector + the
 * dedupe threshold + the distinct-subject meter + the MERGE/UNMERGE affordances over
 * the detected ghost clusters. The [merge] button emits `rz-merge` (the REAL write);
 * an [unmerge] when the cluster is merged. The dial's consequence (the meter 3→1) is
 * shown right here AND on the Plot (the merge-ghost).
 */
function entResControl(
  knob: KnobResource,
  ghosts: readonly GhostCluster[],
  onMerge: (c: GhostCluster) => void,
  onUnmerge: (c: GhostCluster) => void,
): TemplateResult {
  return html`
    <div class="gh-entres" data-entres>
      ${axesStrip(knob.axes)}
      <div class="gh-entres-meter" data-distinct-meter>
        <span class="gh-knob-label">distinct-subjects</span>
        ${knobMeterLine(knob.meter)}
        <span class="gh-muted">${knob.meter.green ? 'target met (1 bed = 1 subject)' : 'fragmenting one belief across ghosts'}</span>
      </div>
      ${ghosts.length
        ? html`<ul class="gh-ghosts" data-ghosts>
            ${ghosts.map(
              (g) => html`
                <li class="gh-ghost ${g.merged ? 'gh-ghost-merged' : ''}" data-ghost=${g.signature}>
                  <span class="gh-ghost-glyph">${icon('git-merge', { size: 13 })}</span>
                  <span class="gh-ghost-text">
                    these ${g.n} look like one <code>${g.label}</code>
                  </span>
                  ${g.merged
                    ? html`<button
                        class="gh-merge-btn gh-unmerge-btn"
                        data-unmerge=${g.signature}
                        @click=${() => onUnmerge(g)}
                      >
                        ${icon('arrow-left', { size: 12 })}<span>unmerge</span>
                      </button>`
                    : html`<button
                        class="gh-merge-btn"
                        data-merge=${g.signature}
                        @click=${() => onMerge(g)}
                      >
                        ${icon('git-merge', { size: 12 })}<span>merge</span>
                      </button>`}
                </li>
              `,
            )}
          </ul>`
        : html`<p class="gh-ghosts-empty" data-ghosts-empty>
            ${icon('check', { size: 12 })}<span>no near-duplicate cluster detected — distinct subjects healthy</span>
          </p>`}
      ${provenance(knob)}
    </div>
  `
}

/**
 * ONE non-focal knob row (the lower register, P0). At rest: value + meter, one line
 * (P3 gist); the axes / laws / write-mode / provenance ride behind the details. A
 * clean meter is a quiet tick (P7). The entity-resolution knob renders its live
 * control inline (the merge affordance) instead of a flat value.
 */
function knobRow(
  knob: KnobResource,
  ghosts: readonly GhostCluster[],
  onMerge: (c: GhostCluster) => void,
  onUnmerge: (c: GhostCluster) => void,
): TemplateResult {
  const isEntRes = knob.id === 'entity-resolution'
  return html`
    <article class="gh-knob ${knob.meter.green ? 'gh-knob-clean' : 'gh-knob-flag'}" data-knob=${knob.id}>
      <header class="gh-knob-head">
        <span class="gh-knob-glyph">${icon(knob.glyph, { size: 14 })}</span>
        <span class="gh-knob-title">${knob.title}</span>
        ${writeBadge(knob)}
      </header>
      ${isEntRes
        ? entResControl(knob, ghosts, onMerge, onUnmerge)
        : html`
            <div class="gh-knob-body">
              <div class="gh-knob-value" data-value>
                ${knob.axes.length
                  ? html`<span class="gh-muted">${knob.axes.map((a) => `${a.key}=${a.value}`).join(' · ')}</span>`
                  : html`<code>${knob.value}</code>`}
              </div>
              ${knobMeterLine(knob.meter)}
            </div>
            ${lawsLegend(knob)}
            <details class="gh-knob-more" data-knob-more>
              <summary class="gh-more-summary">${icon('info', { size: 11 })}<span>axes &amp; why</span></summary>
              ${axesStrip(knob.axes)}
              ${knob.choices.length
                ? html`<p class="gh-choices">choices:
                    ${knob.choices.map((c) => html`<span class="gh-axis-choice ${c === knob.value ? 'active' : ''}">${c}</span>`)}</p>`
                : nothing}
              ${provenance(knob)}
            </details>
          `}
    </article>
  `
}

/** A family common-region zone (P1) — the tinted enclosure of one knob family. */
function familyZone(
  family: KnobFamily,
  knobs: readonly KnobResource[],
  ghosts: readonly GhostCluster[],
  onMerge: (c: GhostCluster) => void,
  onUnmerge: (c: GhostCluster) => void,
): TemplateResult | typeof nothing {
  // The marquee focal knob is hoisted to the top band — it does NOT also appear in its
  // family zone (P0: one place, top of order). The rest of JUDGMENT (entity-resolution)
  // still renders in the zone.
  const rows = knobs.filter((k) => !k.focal)
  if (rows.length === 0) return nothing
  return html`
    <section class="gh-family gh-family-${family.toLowerCase().replace(/[^a-z]+/g, '-')}" data-family=${family}>
      <h2 class="gh-family-head">
        <span class="gh-family-glyph">${icon(FAMILY_GLYPH[family], { size: 14 })}</span>
        <span>${family}</span>
      </h2>
      <div class="gh-family-knobs">
        ${rows.map((k) => knobRow(k, ghosts, onMerge, onUnmerge))}
      </div>
    </section>
  `
}

/**
 * THE GREENHOUSE — the full surface. The marquee miss-meter is the focal band (P0);
 * the families are the common-region zones in the stable §2 order (P1/P2). Pure: the
 * merge/unmerge intents bubble out via the callbacks (the shell does the real write).
 */
export function greenhouseView(
  greenhouse: GreenhouseResource,
  ghosts: readonly GhostCluster[] = [],
  onMerge: (c: GhostCluster) => void = () => {},
  onUnmerge: (c: GhostCluster) => void = () => {},
): TemplateResult {
  const focal = greenhouse.knobs.find((k) => k.focal)
  const lens = greenhouse.asOf
    ? html`<strong>as-of ${greenhouse.asOf}</strong> — every dial + meter recomputed as the climate was then`
    : html`<strong>now</strong> — meters are derived COUNTs over <code>:projection:memory</code>`
  return html`
    <section class="greenhouse" data-greenhouse=${greenhouse.asOf ?? 'now'}>
      <!-- P0/P4: a quiet orienting eyebrow, NOT a second focal point — the marquee wins. -->
      <header class="gh-header">
        <p class="gh-eyebrow">${icon('thermometer', { size: 13 })}<span class="gh-title">the climate the agent blooms under</span></p>
        <p class="gh-lens">${lens}</p>
      </header>

      <!-- P0: THE MARQUEE — the focal supersession miss-meter, alone in its band. -->
      ${focal ? marqueeMeter(focal) : nothing}

      <!-- The lower register — the families, common-region zones in the stable order. -->
      <div class="gh-families" data-families>
        ${FAMILY_ORDER.map((fam) =>
          familyZone(
            fam,
            greenhouse.knobs.filter((k) => k.family === fam),
            ghosts,
            onMerge,
            onUnmerge,
          ),
        )}
      </div>
    </section>
  `
}
