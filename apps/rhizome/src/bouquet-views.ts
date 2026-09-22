/**
 * bouquet-views.ts — THE BOUQUET, the READ-side constellation reader (pure Lit).
 *
 * The counterpart to the Walk's write-side: opening a belief blooms a CONSTELLATION
 * of stars, each annotated with WHY it is in the configuration (Benjamin: meaning is
 * a configuration of fragments, never one row). This is the `dom` face of the SAME
 * BouquetResource the conneg server renders to curl/turtle/json — there is NO second
 * data path. The shell (main.ts) reads live via world.bouquet(), hands this view the
 * resource, and lits it into the surface region.
 *
 * This must be the MOST sophisticated/pleasant of the three surfaces, so it APPLIES
 * the human-factors ergonomics checklist (cited inline by P-number):
 *
 *   P0  one dominant focal point — the CURRENT head is the single brightest,
 *       largest, top-of-order, most-whitespace element (the answer); everything else
 *       is a visibly lower register. The head wins the blur/squint test.
 *   P1  Gestalt grouping by star-KIND via REDUNDANT encoding (common-region arm +
 *       proximity + a kind glyph/heading + tone), never colour alone. The strongest
 *       cue (an explicit connecting line) is spent on the one true sequence — the
 *       supersession LINEAGE (mn-relations).
 *   P2  stable spatial skeleton — the arms live in fixed zones (head, lineage,
 *       dispositions, entity links, gotchas, evidence) across every read.
 *   P3  overview → details-on-demand — the gist is one fixation on the head; the
 *       "why", the full evidence, and deep predecessors are <details> reveals.
 *   P4  the "why" is a QUIET integrated layer (smaller, muted, beside its claim —
 *       never a distant legend), demoted typographically, expandable.
 *   P5  supersession = a redundant, meaning-carrying demotion (fade + strike +
 *       position BELOW the head, ordered by recency, dated) — value-contrast does
 *       the alive/dead work.
 *   P6  object constancy on the as-of change — a single staged ~1s arrival pop on
 *       the new head (rz-bouquet drives it via the mn-badge `settle`/data-arrived),
 *       honouring prefers-reduced-motion.
 *   P6b focus+context for long lineages — the head + most-recent predecessors stay
 *       sharp; older ones fold behind a "+N earlier" affordance.
 *   P7  evidence is the quietest layer, a count handle that expands; entity links
 *       LOOK actionable but stay secondary.
 *
 *   - the bright CURRENT head (the answer) blooms (an accented mn-card),
 *   - the dimmed dated STRUCK predecessors are the resolved-conflict stars (struck),
 *   - the STANDING dispositions are durable-trait stars,
 *   - the ENTITY links are sibling-bed stars (each deep-links to its own bouquet),
 *   - the GOTCHAS are do-not-strike markers (e.g. an Event that must NOT supersede),
 *   - the minimal verbatim EVIDENCE is the grounding floor (or an honest absence),
 *   - the RETRIEVAL block surfaces the read reasoning (ClassifyQueryShape verdict,
 *     gate→fuse) the way the Walk surfaces write reasoning.
 *
 * Pure: resource in, TemplateResult out. No fetch, no SPARQL — the components are
 * registered by the shell (the upgrade seam); this module only composes them. The
 * entity-link cards emit `rz-open` (rootId) so the shell navigates to the sibling
 * bloom — the cross-surface drill-down (no island).
 */

import { html, nothing, type TemplateResult } from 'lit'
import { icon, type MnTone, type MnRelation } from '@shrubbery/components'
import type {
  BouquetResource,
  BouquetStar,
  MemoryRecord,
  StarWhy,
} from '@shrubbery/render'

/**
 * A glyph + tone + label for each star WHY (the constellation legend). Glyphs are
 * REGISTERED icon names (@shrubbery/components lucide set), never an emoji — the
 * inline SVG inherits currentColor in Shadow DOM (iconStyles folded into the shell).
 * The tone (P1) is REDUNDANT with the glyph + the arm's common-region zone, never
 * the sole differentiator (A3: no colour-only encoding).
 */
const WHY_GLYPH: Readonly<Record<StarWhy, string>> = {
  current: 'sprout',
  'resolved-conflict': 'layers',
  standing: 'diamond',
  'entity-link': 'share',
  gotcha: 'alert-triangle',
  evidence: 'leaf',
}
const WHY_LABEL: Readonly<Record<StarWhy, string>> = {
  current: 'the answer',
  'resolved-conflict': 'resolved conflict',
  standing: 'standing disposition',
  'entity-link': 'entity link',
  gotcha: 'gotcha — do not supersede',
  evidence: 'evidence',
}
/**
 * The "why" reason — the QUIET secondary layer (P4): legible on demand, never body
 * weight. It rides WITH its star (integrated, no split attention — A5).
 */
const WHY_WHY: Readonly<Record<StarWhy, string>> = {
  current: 'the mem:status="active" head (or the as-of-resolved record) — the live belief.',
  'resolved-conflict': 'a newer record superseded this; kept (never hidden) so the lineage reads.',
  standing: 'a durable trait in the same scope — not a rival belief, it simply holds.',
  'entity-link': 'a sibling belief sharing a salient term — open it to read its own bloom.',
  gotcha: 'an Event/episodic fragment that grounds the belief — must NOT be struck.',
  evidence: 'a verbatim episodic fragment carrying a head term — the floor the belief rests on.',
}
/** mn-chip/mn-badge tone routing. NB: mn-* have no `info` tone → entity-link = accent. */
const WHY_CHIP_TONE: Readonly<Record<StarWhy, MnTone>> = {
  current: 'success',
  'resolved-conflict': 'muted',
  standing: 'accent',
  'entity-link': 'accent',
  gotcha: 'warning',
  evidence: 'neutral',
}

/** Predecessors kept at full legibility before the focus+context fold (P6b). */
const SHARP_PREDECESSORS = 2

/** Short date (YYYY-MM-DD) from an xsd:dateTime, or a dash. */
function shortDate(dt?: string): string {
  return dt ? dt.slice(0, 10) : '—'
}

/** The bed root short-id of a record IRI (the bouquet URL key), or null. */
function bedRootId(iri: string): string | null {
  const parts = iri.split(':record:')
  const sha = parts[parts.length - 1]
  return sha ? sha.slice(0, 12) : null
}

/**
 * The QUIET "why" layer for a star (P3/P4): a `<details>` whose summary is one
 * legible glance and whose body is the reason — demoted, integrated, on demand.
 */
function whyDetails(why: StarWhy, note?: string): TemplateResult {
  return html`
    <details class="bq-why" data-why-detail=${why}>
      <summary class="bq-why-summary">
        <span class="bq-why-q">${icon('info', { size: 12 })}</span>
        <span class="bq-why-label">why it's here</span>
      </summary>
      <p class="bq-why-body">
        ${WHY_WHY[why]}${note ? html` <span class="bq-why-note">${note}</span>` : nothing}
      </p>
    </details>
  `
}

/**
 * AN ABSENT ARM (A4) — existence carries the weight, not content. When an arm has
 * zero items it does NOT spend a full common-region zone (sunken well + padding +
 * rail) on one italic line; it collapses to a single muted one-line stub OUTSIDE the
 * well: the kind glyph + a terse handle ("No entity links"). The full honest sentence
 * (why the floor is empty) rides behind the title= hover so honesty stays without
 * spending preattentive weight at rest. `arm` keeps the stable data-arm key (P2).
 */
function absentArm(
  arm: string,
  glyph: string,
  label: string,
  note: string,
): TemplateResult {
  return html`
    <p class="bq-arm-absent" data-arm=${arm} data-absent title=${note}>
      <span>${icon(glyph, { size: 13 })}</span>
      <span class="bq-arm-absent-label">${label}</span>
      <span class="bq-arm-absent-note">— none in this cell</span>
    </p>
  `
}

/**
 * THE FOCAL STAR — the bright CURRENT head, the answer (P0). The single largest,
 * brightest, highest-contrast element: the most surrounding whitespace, the accent
 * frame, top of reading order. `data-arrived` lets rz-bouquet play the one staged
 * arrival pop on an as-of change (P6, object constancy).
 *
 * P0 — the page TITLE rides INSIDE the eyebrow band (a quiet muted suffix), not as a
 * standalone h1 above the card; so the head card is the SOLE focal point (no second
 * ~bold ~18px string competes at the top). P4/A7 — the footer carries only date +
 * (optional) as-of as chips; the redundant 'mem:status active' chip is dropped (the
 * answer + the success kind-badge already say "active"), and the head-id moves to a
 * hover-title <code> (the same restraint as the predecessor short-ids) so the band
 * reads answer → one badge → date, not a chip row competing with the headline.
 */
function headStar(head: MemoryRecord, title: string, asOf?: string | null): TemplateResult {
  return html`
    <mn-card
      class="bq-star bq-head"
      label="the answer"
      data-why="current"
      data-arrived
      data-record=${head.localId}
    >
      <div slot="header" class="bq-head-banner">
        <span class="bq-head-glyph">${icon(WHY_GLYPH.current, { size: 18 })}</span>
        <span class="bq-head-eyebrow">
          <span>${WHY_LABEL.current}</span>
          <span class="bq-head-title" data-head-title>${title}</span>
        </span>
        <mn-badge state="success" label=${head.kind ?? 'memory'} settle data-arrived-badge></mn-badge>
      </div>
      <p class="bq-head-content" data-head=${head.localId}>${head.content}</p>
      <div slot="footer" class="bq-head-meta">
        <mn-chip tone="neutral" label=${shortDate(head.createdAt)}></mn-chip>
        ${asOf
          ? html`<mn-chip tone="accent" dashed label=${'as-of ' + asOf}></mn-chip>`
          : nothing}
        <code class="bq-head-id" title=${head.id}>${head.localId}</code>
      </div>
    </mn-card>
  `
}

/**
 * ONE struck predecessor — a dimmed, dated, struck resolved-conflict row, positioned
 * BELOW the head and ordered by recency (P5). Value-contrast (faded) + strike +
 * position are redundant, so the demotion reads in grayscale / for colourblind users.
 *
 * D1 — POSITION MEANS RECENCY: `age` (0 = newest predecessor) drives a small
 * indent step (`--bq-age`), so older records step DOWN-AND-RIGHT along a visible age
 * axis — the as-of scrubber slides a record along that axis (the #1 perceptual
 * channel, position-on-a-scale, now spent on the lineage instead of nothing).
 * D7 — the short-id `<code>` carries `title=full IRI` so hover reveals the cut value.
 */
function predecessorRow(r: MemoryRecord, age = 0): TemplateResult {
  return html`
    <li class="bq-pred" data-why="resolved-conflict" data-record=${r.localId} style="--bq-age:${age}">
      <span class="bq-pred-rail" aria-hidden="true"></span>
      <span class="bq-pred-glyph">${icon(WHY_GLYPH['resolved-conflict'], { size: 13 })}</span>
      <time class="bq-pred-date">${shortDate(r.createdAt)}</time>
      <s class="bq-pred-content">${r.content}</s>
      <mn-chip tone="muted" label="superseded"></mn-chip>
      <code class="bq-pred-id" title=${r.id}>${r.localId}</code>
    </li>
  `
}

/**
 * THE OUTGOING-HEAD GHOST (P6, the demote half) — the previous head, rendered as a
 * struck row at the TOP of the lineage during the ~1s arrival window. It carries the
 * `bq-pred-ghost` class so it slides DOWN+shrinks+fades into the lineage (where the
 * old answer went), staged before the new head rises. Transient: only present while
 * rz-bouquet holds an outgoing head.
 */
function ghostRow(r: MemoryRecord): TemplateResult {
  return html`
    <li class="bq-pred bq-pred-ghost" data-why="resolved-conflict" data-ghost data-record=${r.localId} style="--bq-age:0">
      <span class="bq-pred-rail" aria-hidden="true"></span>
      <span class="bq-pred-glyph">${icon(WHY_GLYPH['resolved-conflict'], { size: 13 })}</span>
      <time class="bq-pred-date">${shortDate(r.createdAt)}</time>
      <s class="bq-pred-content">${r.content}</s>
      <mn-chip tone="muted" label="superseded"></mn-chip>
      <code class="bq-pred-id" title=${r.id}>${r.localId}</code>
    </li>
  `
}

/**
 * THE LINEAGE arm — the struck predecessors with the explicit connecting line as
 * the supersession sequence (P1: the strongest cue spent on the one true sequence;
 * P6b: the head + most-recent stay sharp, older fold behind "+N earlier"). `outgoing`
 * is the transient demoting ghost of the previous head (P6) shown at the top during
 * an as-of/head change; it slots above the real predecessors and is excluded from
 * the persistent chain so it never doubles a real predecessor row.
 */
function lineageArm(
  head: MemoryRecord,
  predecessors: readonly MemoryRecord[],
  outgoing: MemoryRecord | null = null,
): TemplateResult {
  // The ghost is shown only while it is NOT already a real predecessor in this bed
  // (avoid a double row once the demotion lands as a genuine superseded record).
  const ghost =
    outgoing && !predecessors.some((p) => p.localId === outgoing.localId) ? outgoing : null

  if (predecessors.length === 0) {
    // A4: an empty lineage with no transient ghost collapses to a one-line absent stub
    // (no sunken well spent on absence). When a ghost IS demoting (the as-of beat),
    // keep the full arm so the demotion has its zone to land in.
    if (!ghost) {
      return absentArm(
        'lineage',
        'layers',
        'Resolved conflicts',
        'This belief has no superseded predecessor — it simply accumulates (surfaced honestly, never faked).',
      )
    }
    return html`
      <section class="bq-arm bq-arm-lineage" data-arm="lineage">
        <h2 class="bq-arm-head">${icon('layers', { size: 14 })}<span>Resolved conflicts</span></h2>
        <ol class="bq-pred-list">${ghostRow(ghost)}</ol>
      </section>
    `
  }
  const sharp = predecessors.slice(0, SHARP_PREDECESSORS)
  const folded = predecessors.slice(SHARP_PREDECESSORS)

  // The lineage as the explicit connecting line — the one sequence worth the
  // strongest Gestalt cue (mn-relations: head ← supersedes ← predecessor …).
  const chain: readonly MemoryRecord[] = [head, ...predecessors]
  const byLocal = new Map(chain.map((r) => [r.localId, r]))
  const relations: MnRelation[] = []
  for (const r of chain) {
    if (r.supersedes) {
      const target = [...byLocal.values()].find((x) => x.id === r.supersedes)
      if (target) {
        relations.push({
          from: r.localId.slice(0, 8),
          to: target.localId.slice(0, 8),
          predicate: 'supersedes',
          note: `${r.content} → resolves → ${target.content}`,
        })
      }
    }
  }

  return html`
    <section class="bq-arm bq-arm-lineage" data-arm="lineage">
      <h2 class="bq-arm-head">
        ${icon('layers', { size: 14 })}<span>Resolved conflicts</span>
        <span class="bq-arm-count">${predecessors.length}</span>
      </h2>
      <ol class="bq-pred-list">
        ${ghost ? ghostRow(ghost) : nothing}
        ${sharp.map((r, i) => predecessorRow(r, i))}
        ${folded.length
          ? html`<li class="bq-pred-fold">
              <details data-fold>
                <summary class="bq-fold-summary">+${folded.length} earlier (folded)</summary>
                <ol class="bq-pred-list bq-pred-list-folded">
                  ${folded.map((r, i) => predecessorRow(r, SHARP_PREDECESSORS + i))}
                </ol>
              </details>
            </li>`
          : nothing}
      </ol>
      ${relations.length && predecessors.length > 1
        ? // A2: the supersession line is the most EXPENSIVE Gestalt cue (connectedness),
          // so it is spent only when it ADDS information. For a 1-predecessor bed the
          // struck row (date + content + "superseded" chip) and the ::before rail
          // already draw the single edge twice — a third explicit mn-relations graph
          // would render "supersedes" a THIRD time (chartjunk/repetition). So the
          // inline edge graph appears ONLY for multi-predecessor chains, where the
          // explicit head←…←…  topology genuinely carries more than the linear list.
          // Short multi-chains render it inline (open); long lineages fold it (P3).
          predecessors.length <= SHARP_PREDECESSORS
          ? html`<div class="bq-lineage-graph" data-lineage>
              <p class="bq-lineage-cap">${icon('share', { size: 12 })}<span>the supersession line</span></p>
              <mn-relations .relations=${relations} interactive></mn-relations>
            </div>`
          : html`<details class="bq-lineage-graph" data-lineage>
              <summary class="bq-fold-summary">${icon('share', { size: 12 })} the supersession line</summary>
              <mn-relations .relations=${relations} interactive></mn-relations>
            </details>`
        : nothing}
    </section>
  `
}

/** A standing disposition — a durable-trait star (its own Gestalt zone, P1/P2). */
function dispositionRow(r: MemoryRecord): TemplateResult {
  return html`
    <li class="bq-disp" data-why="standing" data-record=${r.localId}>
      <span class="bq-disp-glyph">${icon(WHY_GLYPH.standing, { size: 13 })}</span>
      <span class="bq-disp-content">${r.content}</span>
      <code class="bq-disp-id" title=${r.id}>${r.localId}</code>
      ${whyDetails('standing')}
    </li>
  `
}

/** An entity-link star — a sibling belief; clicking deep-links to its bloom (P7). */
function entityLinkCard(
  star: BouquetStar,
  onOpen: (rootId: string) => void,
): TemplateResult {
  const rootId = bedRootId(star.record.id)
  return html`
    <mn-card
      class="bq-star bq-entity"
      label="open the sibling belief"
      interactive
      data-why="entity-link"
      data-entity=${rootId ?? ''}
      @click=${() => rootId && onOpen(rootId)}
    >
      <div slot="header" class="bq-star-head">
        <span class="bq-star-glyph">${icon(WHY_GLYPH['entity-link'], { size: 14 })}</span>
        <span class="bq-star-why">${WHY_LABEL['entity-link']}</span>
        <span class="bq-entity-go" aria-hidden="true">${icon('arrow-right', { size: 13 })}</span>
      </div>
      <p class="bq-entity-content">${star.record.content}</p>
      <div class="bq-entity-foot">
        <mn-chip tone="accent" dashed label=${rootId ?? star.record.localId}></mn-chip>
        ${star.note ? html`<span class="bq-star-note">${star.note}</span>` : nothing}
      </div>
    </mn-card>
  `
}

/** A gotcha star — a do-not-supersede marker (warning zone, P1). */
function gotchaRow(star: BouquetStar): TemplateResult {
  return html`
    <li class="bq-gotcha" data-why="gotcha" data-record=${star.record.localId}>
      <span class="bq-gotcha-glyph">${icon(WHY_GLYPH.gotcha, { size: 14 })}</span>
      <span class="bq-gotcha-content">${star.record.content}</span>
      ${star.note ? html`<span class="bq-star-note">${star.note}</span>` : nothing}
    </li>
  `
}

/** One verbatim evidence fragment — the grounding floor, the quietest layer (P7). */
function evidenceRow(r: MemoryRecord): TemplateResult {
  return html`
    <blockquote class="bq-evidence" data-why="evidence" data-record=${r.localId}>
      <span class="bq-evidence-glyph">${icon(WHY_GLYPH.evidence, { size: 13 })}</span>
      <span class="bq-evidence-text">${r.content}</span>
      <footer class="bq-evidence-src"><code title=${r.id}>${r.localId}</code>${r.kind ? html` · ${r.kind}` : nothing}</footer>
    </blockquote>
  `
}

/**
 * THE EVIDENCE arm — quietest in the hierarchy (P7). At rest it is a COUNT handle
 * ("N sources"); the verbatim corpus is details-on-demand (P3), not shown at full
 * weight at rest (A4).
 */
function evidenceArm(evidence: readonly MemoryRecord[]): TemplateResult {
  if (evidence.length === 0) {
    // A4 / P3 — at rest the absence is a terse muted handle ("Evidence — none in this
    // cell"), a one-line stub OUTSIDE the well; the full honest sentence (the floor is
    // empty, surfaced honestly) rides behind the title= hover, so existence (not
    // verbose prose) carries the preattentive weight.
    return absentArm(
      'evidence',
      'leaf',
      'Evidence',
      'No episodic fragment in this cell grounds the head with its key terms — the floor is empty here (surfaced honestly, never faked).',
    )
  }
  const n = evidence.length
  return html`
    <section class="bq-arm bq-arm-evidence" data-arm="evidence">
      <details class="bq-evidence-fold" data-evidence open>
        <summary class="bq-arm-head bq-evidence-summary">
          ${icon('leaf', { size: 14 })}<span>Evidence</span>
          <span class="bq-arm-count">${n} ${n === 1 ? 'source' : 'sources'}</span>
        </summary>
        <div class="bq-quotes">${evidence.map((r) => evidenceRow(r))}</div>
      </details>
    </section>
  `
}

/** A retrieval-reasoning row (the read-side analog of the Walk's write reasoning). */
function retrievalRow(key: string, value: TemplateResult | string): TemplateResult {
  return html`<li class="bq-rv-row"><span class="bq-rv-key">${key}</span><span class="bq-rv-val">${value}</span></li>`
}

/**
 * THE BOUQUET — the full constellation. Every section is HONEST: an empty arm
 * renders an explicit absence (the floor is empty here), never a faked star. The
 * arms sit in a STABLE skeleton (P2) so the same belief reads the same tomorrow.
 */
export function bouquetView(
  bouquet: BouquetResource,
  onOpen: (rootId: string) => void = () => {},
  outgoingHead: MemoryRecord | null = null,
): TemplateResult {
  const lens = bouquet.asOf
    ? html`<strong>as-of ${bouquet.asOf}</strong> — head RECOMPUTED from <code>mem:createdAt</code>`
    : html`<strong>now</strong> — head = the <code>mem:status="active"</code> record`

  const r = bouquet.retrieval
  const deterministic = !r.queryShape && !r.question && !r.gate && !r.fuse

  return html`
    <section class="bouquet" data-bouquet=${bouquet.rootId}>
      <!-- P0/A1: the page title is NO LONGER a standalone h1 here (it competed with the
           head as a second ~bold ~18px string). It rides inside the head card's eyebrow
           band; the header is now a quiet muted orientation line (lens + blurb) only. -->
      <header class="bouquet-header">
        <p class="bouquet-lens">${lens}</p>
        <p class="bouquet-blurb">A configuration of fragments — meaning is never one row.</p>
      </header>

      <!-- P0: the FOCAL star, alone in its band, the single dominant element. -->
      <div class="bq-focus" data-arm="focus">
        ${headStar(bouquet.currentHead, bouquet.title, bouquet.asOf)}
        ${whyDetails('current', bouquet.asOf ? `head as-of ${bouquet.asOf}` : undefined)}
      </div>

      <!-- The lower register: the lineage, then the grouped secondary arms. -->
      <div class="constellation">
        ${lineageArm(bouquet.currentHead, bouquet.predecessors, outgoingHead)}

        ${bouquet.dispositions.length
          ? html`<section class="bq-arm bq-arm-standing" data-arm="standing">
              <h2 class="bq-arm-head">
                ${icon('diamond', { size: 14 })}<span>Standing dispositions</span>
                <span class="bq-arm-count">${bouquet.dispositions.length}</span>
              </h2>
              <ul class="bq-list">${bouquet.dispositions.map((d) => dispositionRow(d))}</ul>
            </section>`
          : // A4: no disposition → a one-line absent stub, not a full sunken zone.
            absentArm(
              'standing',
              'diamond',
              'Standing dispositions',
              'No standing disposition about this subject (surfaced honestly, never faked).',
            )}

        ${bouquet.entityLinks.length
          ? html`<section class="bq-arm bq-arm-entity" data-arm="entity">
              <h2 class="bq-arm-head">
                ${icon('share', { size: 14 })}<span>Entity links</span>
                <span class="bq-arm-count">${bouquet.entityLinks.length}</span>
              </h2>
              <div class="bq-cards">${bouquet.entityLinks.map((s) => entityLinkCard(s, onOpen))}</div>
            </section>`
          : // A4: no sibling link → a one-line absent stub, not a full sunken zone.
            absentArm(
              'entity',
              'share',
              'Entity links',
              'No sibling bed shares a salient term (surfaced honestly, never faked).',
            )}

        ${bouquet.gotchas.length
          ? html`<section class="bq-arm bq-arm-gotcha" data-arm="gotcha">
              <h2 class="bq-arm-head">
                ${icon('alert-triangle', { size: 14 })}<span>Gotchas — read with care</span>
                <span class="bq-arm-count">${bouquet.gotchas.length}</span>
              </h2>
              <ul class="bq-list">${bouquet.gotchas.map((s) => gotchaRow(s))}</ul>
            </section>`
          : nothing}

        ${evidenceArm(bouquet.evidence)}
      </div>

      <!-- The read reasoning, demoted to a quiet expandable footer (P4/A4). -->
      <details class="bq-retrieval" data-retrieval>
        <summary class="bq-arm-head bq-retrieval-summary">
          ${icon('info', { size: 14 })}<span>Retrieval reasoning</span>
        </summary>
        <ul class="bq-rv-list">
          ${r.queryShape ? retrievalRow('ClassifyQueryShape', html`<code>${r.queryShape}</code>`) : nothing}
          ${r.question ? retrievalRow('question', r.question) : nothing}
          ${r.gate ? retrievalRow('gate', r.gate) : nothing}
          ${r.fuse ? retrievalRow('fuse', r.fuse) : nothing}
          ${deterministic
            ? html`<li class="bq-empty">Deterministic read — a <code>lineage-head</code> resolution; no question-driven gate/fuse trace.</li>`
            : nothing}
        </ul>
      </details>
    </section>
  `
}
