/**
 * dom-views.ts — THE DOM FACE of the RHIZOME memory observatory (pure Lit views).
 *
 * This is the `dom` face of the SAME memory world that slice-1 renders to
 * curl/turtle/json. It consumes the SAME pure resource shapes from
 * @shrubbery/render (PlotResource / SubjectResource / MemoryRecord) that the data
 * layer (memory-world.ts) produces live from the cell — there is NO second data
 * path. The shell (main.ts) reads live, hands these views the resource, and lits
 * them into the observatory region; the render-smoke test hands the SAME views the
 * SAME live resource and asserts the HTML — one render path, two callers.
 *
 * ERGONOMICS — this surface is held to THE BOUQUET's bar (the exemplar is
 * bouquet-views.ts / rz-bouquet.ts), the human-factors checklist cited inline by
 * P-number (the SAME vocabulary the constellation reader uses, so the two surfaces
 * read as one family):
 *
 *   P0  ONE dominant focal point per view — in THE PLOT each bed's CURRENT HEAD
 *       BLOOM is the brightest/largest/most-whitespace datum (it wins the bed's
 *       blur/squint test); everything else (soil, lineage, cross-link) is a
 *       visibly lower register. In THE BOUQUET the head flower is the focal star.
 *   P1  Gestalt GROUPING by REDUNDANT encoding — kinds segment by common-region
 *       (a tinted enclosed zone), proximity, a glyph + tone, never colour alone;
 *       the one explicit connecting LINE is spent on the supersession lineage.
 *   P2  STABLE spatial zones — bloom / soil / lineage live in fixed slots.
 *   P3  OVERVIEW → details-on-demand — the gist is the bloom; the lineage graph +
 *       the deep soil + the "why" ride behind <details> (progressive disclosure).
 *   P4  the "WHY" is a QUIET layer (smaller, muted, beside its claim), expandable.
 *   P5  SUPERSEDED records demote REDUNDANTLY (fade + strike + position-below +
 *       date), never strike alone — value-contrast carries alive→dead.
 *   P6  OBJECT CONSTANCY on the as-of change is driven by the host (rz-observatory
 *       plays a subtle bloom transition; reduced-motion falls back to instant).
 *   P7  no chartjunk — whitespace + value-contrast over boxes; ABSENT content is a
 *       quiet one-liner, never a full-weight empty zone.
 *
 * TOKEN/ICON DISCIPLINE — all glyphs are REGISTERED lucide icon() (never emoji),
 * the inline <svg> inheriting currentColor; colour/space via --mn-* tokens only.
 *
 * THE PLOT (plotView) — subject-beds laid out as cards:
 *   - the resolved CURRENT HEAD blooms (the focal datum: the headline content at
 *     the largest type, most whitespace; the lineage graph folds behind details).
 *   - superseded predecessors are the dimmed SOIL layer BENEATH each bed — dated,
 *     present, struck-through, faded; never hidden (the "accumulating" rule).
 *   - a single-record bed (an Event never updated) shows its head and demotes the
 *     empty soil to a quiet one-liner (P7).
 *
 * THE BOUQUET (bouquetView) — one opened subject as a constellation:
 *   - the current head FLOWER is the focal star (P0); the superseded predecessors
 *     demote into the dimmed lineage below (P5), each annotated with its WHY
 *     (current / resolved-conflict / event-accumulates) as a quiet layer (P4),
 *     and the supersession edges fold behind a details reveal (P3, the one line).
 *
 * THE SCRUBBER (scrubberView) — the ?asof control: a date input + quick lenses;
 *   wired by the shell to re-fetch the PLOT as-of-then (reusing slice-1's as-of
 *   reconstruction in memory-world.ts — currency is recomputed from createdAt, NOT
 *   the mutated status flag).
 *
 * Pure: resource in, TemplateResult out. No fetch, no SPARQL — the components are
 * registered by the shell (the upgrade seam); this module only composes them.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { icon } from '@shrubbery/components'
import type { MnGraphEdge, MnGraphNode, MnRelation } from '@shrubbery/components'
import type { MemoryRecord, PlotResource, PlotSubject, SubjectResource } from '@shrubbery/render'
import type { GhostCluster } from './greenhouse-views.js'

/** The WHY of a record's position in its bed — the bouquet annotation taxonomy. */
export type RecordWhy = 'current' | 'resolved-conflict' | 'event-accumulates'

/**
 * Classify WHY a record sits where it does in its bed.
 *   - the resolved head with NO predecessors → `event-accumulates` (an Event that
 *     was recorded once and never contradicted — it accumulates, it isn't a fix).
 *   - the resolved head WITH a predecessor   → `current` (it superseded an older
 *     belief; it is the live answer).
 *   - any non-head record                    → `resolved-conflict` (it was the
 *     belief once, then a newer record resolved the conflict by superseding it).
 */
export function whyFor(record: MemoryRecord, head: string, bedSize: number): RecordWhy {
  if (record.localId !== head) return 'resolved-conflict'
  if (bedSize > 1) return 'current' // the live head of a supersession lineage
  // Single-record bed: only an actual Event/Episode "accumulates". A State / Profile /
  // WorldState / Preference / Claim that was simply never superseded is the CURRENT
  // belief — labelling it "event-accumulates" mislabels a State as an Event.
  const k = record.kind ?? ''
  return k === 'EventMemory' || k === 'EpisodeMemory' ? 'event-accumulates' : 'current'
}

const WHY_LABEL: Readonly<Record<RecordWhy, string>> = {
  current: 'current — the live belief (active head)',
  'resolved-conflict': 'resolved conflict — a newer record superseded this',
  'event-accumulates': 'event — recorded once, never contradicted (accumulates)',
}

const WHY_TONE: Readonly<Record<RecordWhy, 'success' | 'muted' | 'accent'>> = {
  current: 'success',
  'resolved-conflict': 'muted',
  'event-accumulates': 'accent',
}

/**
 * A REGISTERED lucide glyph per WHY (P1: REDUNDANT with the tone + the zone, never
 * the sole differentiator — A3 no colour-only). The inline <svg> inherits
 * currentColor in Shadow DOM (the host folds iconStyles in). Mirrors the Bouquet's
 * WHY_GLYPH so the two surfaces read as one family.
 */
const WHY_GLYPH: Readonly<Record<RecordWhy, string>> = {
  current: 'sprout',
  'resolved-conflict': 'layers',
  'event-accumulates': 'diamond',
}

/** A bed's lineage as an mn-graph (newest head → … → oldest root, by supersedes). */
function bedGraph(records: readonly MemoryRecord[]): {
  nodes: MnGraphNode[]
  edges: MnGraphEdge[]
} {
  const byId = new Map(records.map((r) => [r.id, r]))
  const nodes: MnGraphNode[] = records.map((r) => ({
    id: r.localId,
    label: r.localId.slice(0, 8),
    note: `${r.status} · ${r.createdAt ?? '?'} · ${r.content}`,
  }))
  const edges: MnGraphEdge[] = []
  for (const r of records) {
    if (r.supersedes) {
      const target = byId.get(r.supersedes)
      if (target) edges.push({ from: r.localId, to: target.localId, predicate: 'supersedes' })
    }
  }
  return { nodes, edges }
}

/** Short date (YYYY-MM-DD) from an xsd:dateTime, or a dash. */
function shortDate(dt?: string): string {
  if (!dt) return '—'
  return dt.slice(0, 10)
}

// ── THE PLOT ──────────────────────────────────────────────────────────────────

/**
 * One bed's card — the focal BLOOM (P0) over its dimmed SOIL layer (P5). The bloom
 * is the single dominant datum of the card: the head content at the largest type,
 * the most whitespace, top of order (it survives the bed's blur/squint test). The
 * cross-link, the lineage graph, and the soil are a visibly lower register. The
 * `data-bloom` carries the head id so the host can play the P6 as-of transition.
 */
function bedCard(
  subject: PlotSubject,
  records: readonly MemoryRecord[],
  mintedByRun: string | undefined,
  onOpenRun: (runId: string) => void,
): TemplateResult {
  const head = records.find((r) => r.localId === subject.head)
  // SOIL ordered newest-first (P5/D1: position-below means recency) so the eye reads
  // the demotion stepping down the age axis.
  const soil = records
    .filter((r) => r.localId !== subject.head)
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const why = head ? whyFor(head, subject.head, records.length) : 'event-accumulates'
  const { nodes, edges } = bedGraph(records)
  return html`
    <mn-card class="bed" label=${subject.topic} interactive data-bed=${subject.rootId}>
      <!-- P0/P4: the bed eyebrow is a QUIET orienting band — the topic + a kind
           badge (glyph + tone, redundant). It rides ABOVE the bloom but in a lower
           register (uppercase, 11px, muted) so it never competes with the head. -->
      <div slot="header" class="bed-head" title=${WHY_LABEL[why]}>
        <span class="bed-glyph">${icon(WHY_GLYPH[why], { size: 13 })}</span>
        <span class="bed-topic">${subject.topic}</span>
        <mn-badge
          state=${WHY_TONE[why] === 'success' ? 'success' : 'neutral'}
          label=${why}
        ></mn-badge>
      </div>

      <!-- P0 — THE BLOOM: the resolved current head, the single FOCAL datum of the
           card (largest type, most whitespace, brightest). Blur the card → only the
           bloom-content survives. The data-bloom/data-head attrs let the host play
           the P6 as-of arrival transition on a head change. -->
      <div class="bloom" data-bloom data-head=${head?.localId ?? ''}>
        ${head
          ? html`
              <div class="bloom-content" data-head=${head.localId}>${head.content || subject.headContent}</div>
              <!-- P4/P7: the meta is a quiet adjacent layer — date + a hover-title
                   short-id (the same restraint as the soil rows), NOT a chip row
                   competing with the headline. The redundant mem:status chip is
                   dropped (the kind badge above already says "active"). -->
              <div class="bloom-meta">
                <span class="bloom-date">${shortDate(head.createdAt)}</span>
                <code class="bloom-id" title=${head.id}>${head.localId.slice(0, 8)}</code>
              </div>
            `
          : html`<div class="bloom-content empty">no record as-of this date</div>`}
      </div>

      <!-- P3 — THE LINEAGE GRAPH folds behind details (overview at rest, the layered
           DAG on demand) so the bloom keeps the focal whitespace. The summary is the
           quiet count handle; the supersession DAG is the one explicit line (P1). -->
      ${edges.length
        ? html`<details class="bed-graph-fold" data-lineage>
            <summary class="bed-fold-summary">
              ${icon('share', { size: 12 })}<span>the lineage (${edges.length === 1 ? '1 edge' : edges.length + ' edges'})</span>
            </summary>
            <mn-graph
              class="bed-graph"
              .nodes=${nodes}
              .edges=${edges}
              hint=${'lineage of ' + subject.topic}
            ></mn-graph>
          </details>`
        : nothing}

      <!-- THE CROSS-LINK — "minted by run …" (the reverse Plot→Walk affordance). P7:
           a quiet secondary affordance, NOT a heavy filled pill competing with the
           bloom; it LOOKS actionable (icon + hover) but stays in the lower register.
           The button fires onOpenRun + stops the click from also opening the bouquet. -->
      ${mintedByRun
        ? html`<div class="bed-minted" data-minted-by=${mintedByRun}>
            <button
              type="button"
              class="bed-walk-link"
              data-open-run=${mintedByRun}
              title=${'open the Walk of run ' + mintedByRun}
              @click=${(e: Event) => {
                e.stopPropagation()
                onOpenRun(mintedByRun)
              }}
            >
              ${icon('network', { size: 12 })}<span>minted by run</span>
              <code>${mintedByRun}</code>
              ${icon('arrow-right', { size: 12 })}
            </button>
          </div>`
        : nothing}

      <!-- P5 — THE SOIL: superseded predecessors demote REDUNDANTLY (fade + strike +
           position-below-by-recency + date), never hidden (the "accumulating" rule),
           so the dead/alive distinction reads in grayscale / for colourblind users.
           Empty soil demotes to a quiet one-liner (P7), NOT a full empty zone. -->
      <div slot="footer" class="soil" data-soil>
        ${soil.length === 0
          ? why === 'event-accumulates'
            ? html`<p class="soil-empty" title="no superseded predecessor — this event simply accumulates (surfaced honestly, never faked)">
                ${icon('leaf', { size: 12 })}<span>no soil — this event accumulates</span>
              </p>`
            : html`<p class="soil-empty" title="no earlier belief — this is the current value, never superseded (surfaced honestly)">
                ${icon('sprout', { size: 12 })}<span>no soil — current belief, never superseded</span>
              </p>`
          : html`<div class="soil-stack">
              <p class="soil-cap">
                ${icon('layers', { size: 12 })}<span>soil — ${soil.length === 1 ? '1 superseded layer' : soil.length + ' superseded layers'}</span>
              </p>
              <div class="soil-rows">
                ${soil.map(
                  (r, i) => html`
                    <div class="soil-row" data-soil-record=${r.localId} style="--soil-age:${i}">
                      <span class="soil-date">${shortDate(r.createdAt)}</span>
                      <s class="soil-content">${r.content}</s>
                      <mn-chip tone="muted" label="superseded"></mn-chip>
                    </div>
                  `,
                )}
              </div>
            </div>`}
      </div>
    </mn-card>
  `
}

/**
 * THE MERGE-GHOST affordance (greenhouse-design §4b #3) — the entity-resolution
 * call rendered WHERE IT LIVES, on the Plot. When the detector flags a near-duplicate
 * cluster, the Plot plants a ghost: "these N look like one (user · 5K-PB) — [merge]".
 * The dial's consequence is shown IN THE GARDEN, not just as a number — the gardener
 * sees the beds the agent is unsure are one. [merge] emits the REAL write (rz-merge);
 * a merged cluster offers [unmerge]. Quiet at rest (P7) — a thin accent banner, not
 * an alarm; full weight only because it is a genuine, actionable fragmentation.
 */
function mergeGhostBanner(
  ghosts: readonly GhostCluster[],
  onMerge: (c: GhostCluster) => void,
  onUnmerge: (c: GhostCluster) => void,
): TemplateResult | typeof nothing {
  if (ghosts.length === 0) return nothing
  return html`
    <div class="plot-ghosts" data-plot-ghosts>
      ${ghosts.map(
        (g) => html`
          <div class="plot-ghost ${g.merged ? 'plot-ghost-merged' : ''}" data-plot-ghost=${g.signature}>
            <span class="plot-ghost-glyph">${icon('git-merge', { size: 14 })}</span>
            <span class="plot-ghost-text">
              these <strong>${g.n}</strong> look like one <code>${g.label}</code>
            </span>
            ${g.merged
              ? html`<button
                  type="button"
                  class="plot-ghost-btn plot-ghost-unmerge"
                  data-unmerge=${g.signature}
                  @click=${() => onUnmerge(g)}
                >
                  ${icon('arrow-left', { size: 12 })}<span>unmerge</span>
                </button>`
              : html`<button
                  type="button"
                  class="plot-ghost-btn"
                  data-merge=${g.signature}
                  @click=${() => onMerge(g)}
                >
                  ${icon('git-merge', { size: 12 })}<span>merge</span>
                </button>`}
          </div>
        `,
      )}
    </div>
  `
}

/**
 * THE PLOT — the whole observatory bed-grid for one lens (now, or ?asof=T).
 *
 * Needs the per-bed full record chains (the soil layer), keyed by rootId — the
 * shell fetches them once (memory-world.subject) and passes them in. A bed with no
 * chain entry still renders from its PlotSubject (bloom only). `ghosts` are the
 * entity-resolution near-duplicate clusters (the MERGE-GHOST affordance, §4b) — the
 * resolution call rendered on the Plot; merging emits the REAL write via the cbs.
 */
export function plotView(
  plot: PlotResource,
  chains: ReadonlyMap<string, readonly MemoryRecord[]>,
  mintedBy: ReadonlyMap<string, string> = new Map(),
  onOpenRun: (runId: string) => void = () => {},
  ghosts: readonly GhostCluster[] = [],
  onMerge: (c: GhostCluster) => void = () => {},
  onUnmerge: (c: GhostCluster) => void = () => {},
): TemplateResult {
  // P0/P4: the plot header is a QUIET orienting band, NOT a second focal point — the
  // dominant data are the per-bed BLOOMS in the grid below. The title is a modest
  // eyebrow, the lens + summary a muted layer beside it (the same restraint as the
  // Bouquet's header, where the focal head — not the page title — wins the blur test).
  const lens = plot.asOf
    ? html`<strong>as-of ${plot.asOf}</strong> — heads RECOMPUTED from <code>mem:createdAt</code> (the mutated <code>mem:status</code> flag is ignored)`
    : html`<strong>now</strong> — heads are the <code>mem:status="active"</code> record`
  return html`
    <section class="plot" data-plot data-asof=${plot.asOf ?? 'now'}>
      <header class="plot-header">
        <p class="plot-eyebrow">
          ${icon('sprout', { size: 13 })}<span class="plot-title">${plot.title}</span>
        </p>
        <p class="plot-lens">${lens}</p>
        <p class="plot-summary">
          ${plot.subjects.length} subject-bed${plot.subjects.length === 1 ? '' : 's'} ·
          ${plot.subjects.reduce((n, s) => n + s.activeCount, 0)} active heads ·
          ${plot.subjects.reduce((n, s) => n + s.supersededCount, 0)} in the soil
        </p>
      </header>
      ${mergeGhostBanner(ghosts, onMerge, onUnmerge)}
      <div class="beds">
        ${plot.subjects.map((s) =>
          bedCard(s, chains.get(s.rootId) ?? [], mintedBy.get(s.rootId), onOpenRun),
        )}
      </div>
    </section>
  `
}

// ── THE BOUQUET ─────────────────────────────────────────────────────────────

/**
 * THE FOCAL FLOWER (P0) — the current head as the single dominant star: the largest
 * content, the brightest, the most whitespace, top of order. The "why" rides as a
 * quiet adjacent layer (P4); the head id is a hover-title <code>, not a chip row.
 * `data-arrived`/`data-head` let the host play the P6 as-of arrival transition.
 */
function flowerHead(record: MemoryRecord): TemplateResult {
  return html`
    <mn-card class="flower flower-head" label="the answer" data-record=${record.localId} data-arrived data-head=${record.localId}>
      <div slot="header" class="flower-head-row">
        <span class="flower-glyph">${icon(WHY_GLYPH.current, { size: 16 })}</span>
        <span class="flower-eyebrow">the answer</span>
        <mn-badge state="success" label=${record.kind ?? 'memory'}></mn-badge>
      </div>
      <p class="flower-content" data-why="current">${record.content}</p>
      <div class="flower-meta">
        <span class="flower-date">${shortDate(record.createdAt)}</span>
        <code class="flower-id" title=${record.id}>${record.localId.slice(0, 8)}</code>
      </div>
    </mn-card>
  `
}

/**
 * ONE struck predecessor (P5) — a dimmed, dated, struck resolved-conflict row,
 * positioned BELOW the head and ordered by recency. Value-contrast (faded) + strike
 * + position + date are redundant, so the demotion reads in grayscale. The `--soil-
 * age` (0 = newest) steps each older record along a visible age axis (D1).
 */
function predecessorRow(record: MemoryRecord, age = 0): TemplateResult {
  return html`
    <li class="flower-pred" data-why="resolved-conflict" data-record=${record.localId} style="--soil-age:${age}">
      <span class="flower-pred-glyph">${icon(WHY_GLYPH['resolved-conflict'], { size: 13 })}</span>
      <time class="flower-pred-date">${shortDate(record.createdAt)}</time>
      <s class="flower-pred-content">${record.content}</s>
      <mn-chip tone="muted" label="superseded"></mn-chip>
      <code class="flower-pred-id" title=${record.id}>${record.localId.slice(0, 8)}</code>
    </li>
  `
}

/**
 * THE BOUQUET — one opened subject as a constellation. The current head is the focal
 * flower (P0); its superseded predecessors demote into the dimmed lineage zone below
 * (P5, a common-region with the accent rail — P1), and the supersession edges (the
 * one true sequence) fold behind a quiet details reveal (P1/P3). A single-record bed
 * demotes the empty lineage to a quiet one-liner (P7), never a faked star.
 */
export function bouquetView(subject: SubjectResource): TemplateResult {
  const head = subject.records.find((r) => r.localId === subject.head)
  const predecessors = subject.records
    .filter((r) => r.localId !== subject.head)
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const byId = new Map(subject.records.map((r) => [r.id, r]))
  const relations: MnRelation[] = []
  for (const r of subject.records) {
    if (r.supersedes) {
      const target = byId.get(r.supersedes)
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
  const lens = subject.asOf
    ? html`<strong>as-of ${subject.asOf}</strong> — head RECOMPUTED from <code>mem:createdAt</code>`
    : html`<strong>now</strong> — head = the <code>mem:status="active"</code> record`
  return html`
    <section class="bouquet" data-bouquet=${subject.rootId}>
      <!-- P0/P4: the header is a QUIET orienting eyebrow (lens + blurb), NOT a second
           focal point — the focal flower below wins the blur test. -->
      <header class="bouquet-header">
        <p class="bouquet-eyebrow">
          ${icon('sprout', { size: 13 })}<span class="bouquet-title">${subject.title}</span>
        </p>
        <p class="bouquet-lens">${lens}</p>
      </header>

      <!-- P0: the focal flower, alone in its band, the single dominant element. -->
      <div class="flower-focus" data-arm="focus">
        ${head ? flowerHead(head) : html`<p class="bloom-content empty">no record as-of this date</p>`}
      </div>

      <!-- P1/P5 — THE LINEAGE: a common-region zone (accent rail) of struck
           predecessors below the head; the supersession line folds behind details. -->
      ${predecessors.length
        ? html`<section class="flower-lineage" data-arm="lineage">
            <h2 class="flower-arm-head">
              ${icon('layers', { size: 14 })}<span>Resolved conflicts</span>
              <span class="flower-arm-count">${predecessors.length}</span>
            </h2>
            <ol class="flower-pred-list">
              ${predecessors.map((r, i) => predecessorRow(r, i))}
            </ol>
            ${relations.length
              ? html`<details class="flower-lineage-graph" data-lineage>
                  <summary class="flower-fold-summary">
                    ${icon('share', { size: 12 })}<span>the supersession line</span>
                  </summary>
                  <mn-relations .relations=${relations} interactive></mn-relations>
                </details>`
              : nothing}
          </section>`
        : (head && whyFor(head, subject.head, 1) === 'event-accumulates')
          ? html`<p class="flower-single" title="a single record — this event accumulates; nothing has superseded it (surfaced honestly)">
              ${icon('diamond', { size: 13 })}<span>A single record — this event accumulates; nothing has superseded it.</span>
            </p>`
          : html`<p class="flower-single" title="a single record — the current belief; nothing has superseded it (surfaced honestly)">
              ${icon('diamond', { size: 13 })}<span>A single record — the current belief; nothing has superseded it.</span>
            </p>`}
    </section>
  `
}

// ── THE SCRUBBER ────────────────────────────────────────────────────────────

/** The dates that bracket this world (the design's two proving lenses + now). */
export const SCRUBBER_LENSES: ReadonlyArray<{ label: string; asof: string | null }> = [
  { label: 'now', asof: null },
  { label: '2023-05-25 (old world)', asof: '2023-05-25' },
  { label: '2023-06-01 (new world)', asof: '2023-06-01' },
]

/**
 * THE SCRUBBER — the ?asof control. A date input + quick lenses. Emits the host's
 * `onAsof` with the chosen date (null = now); the host re-fetches the PLOT as-of
 * that date (slice-1's createdAt-based reconstruction).
 */
export function scrubberView(
  current: string | null,
  onAsof: (asof: string | null) => void,
): TemplateResult {
  return html`
    <div class="scrubber" data-scrubber>
      <span class="scrubber-label">as-of</span>
      <input
        type="date"
        class="scrubber-date"
        .value=${current ?? ''}
        @change=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value
          onAsof(v || null)
        }}
      />
      ${SCRUBBER_LENSES.map(
        (l) => html`
          <button
            class="scrubber-lens ${(current ?? null) === l.asof ? 'active' : ''}"
            @click=${() => onAsof(l.asof)}
          >
            ${l.label}
          </button>
        `,
      )}
    </div>
  `
}

