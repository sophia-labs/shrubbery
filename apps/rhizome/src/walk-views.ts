/**
 * walk-views.ts — THE DOM FACE of the RHIZOME WALK surface (pure Lit views).
 *
 * The `dom` face of the SAME agentic-run trace the conneg server renders to
 * curl/turtle/json. It consumes the SAME pure resource shapes from
 * @shrubbery/render (WalkResource / WalkIndexResource / WalkTurn) that the trace
 * reader (trace-world.ts) parses from the JSONL files — NO second data path. The
 * shell (rz-walk) reads the trace, hands these views the resource, and lits them.
 *
 * THE RIBBON (walkView) — a run as a vertical ribbon of TURN cards. Each turn is
 * an observe→think→act step. This surface is held to THE BOUQUET's ergonomics bar
 * (the exemplar is bouquet-views.ts / rz-bouquet.ts — cited inline by P-number):
 *
 *   P0  ONE dominant focal point — per turn the model's REASONING (the think) is
 *       the brightest + largest + most-whitespace datum (it wins the turn's
 *       blur/squint test); the phase label / turn index demote to a quiet eyebrow,
 *       and the verbose tool args/results sit in a visibly lower register. At the
 *       RUN level the FINAL answer is the single focal datum (an accent flower),
 *       NOT a row in a Q/Gold/Final stack — the question/gold demote to a quiet
 *       orienting band.
 *   P1  Gestalt grouping by PHASE via common-region zones (think / act / observe
 *       are tinted enclosed wells with a kind glyph + tone), redundant encoding —
 *       never colour alone; the one explicit connecting LINE is spent on the
 *       supersession lineage (the run-level edges → the Plot beds).
 *   P2  stable spatial skeleton — think → act → observe → cost in a fixed order
 *       across every turn.
 *   P3  overview → details-on-demand — the verbose tool ARGS and the tool RESULT
 *       (the raw <pre> walls) fold behind a <details> by default; the gist (the
 *       tool name + a one-line preview) is what the summary shows at rest.
 *   P4  the "why" — the supersede annotation — is a quiet integrated layer beside
 *       its claim (smaller, muted), never a distant legend.
 *   P5  the SUPERSEDE moment / the run-level edges demote the OLD record
 *       redundantly (fade + strike + position + the short-id), the NEW one stays
 *       bright — value-contrast carries new→old.
 *   P6  object constancy on the ?turn lens change — rz-walk plays a staged
 *       rise-into-focus on the lensed turn (prefers-reduced-motion → instant).
 *   P7  avoid chartjunk — an empty reasoning / a no-tool-calls turn / an absent
 *       edge set demotes to a quiet one-liner, never a full-weight empty zone.
 *
 *   - THINK: the model's reasoning (rawAssistant) — the focal layer of the turn.
 *   - ACT: the tool call(s) — graph_sparql_select / remember — args folded (P3).
 *   - OBSERVE: the tool result(s) (the cell's reply), folded; the per-turn cost.
 *   - the SUPERSEDE moment (a remember with supersedes_ref, or a run_end edge) is
 *     the WRITE that "met its past self" — highlighted as the one true sequence.
 *
 * THE RUN LIST (walkIndexView) — the walk index: one row per run to pick from.
 *
 * THE ?turn LENS — when the resource carries a turnCursor, the ribbon limits to
 * that turn (the Walk's analog of the Plot's ?asof lens).
 *
 * Pure: resource in, TemplateResult out. No fetch, no FS — the components are
 * registered by the shell (the upgrade seam); this module only composes them. All
 * glyphs are lucide icon() (never emoji); the host (rz-walk) folds in iconStyles.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { icon, type MnTone } from '@shrubbery/components'
import { classifyVerdict } from './verdict.js'
import type {
  WalkIndexResource,
  WalkResource,
  WalkToolCall,
  WalkToolResult,
  WalkTurn,
} from '@shrubbery/render'

/** Short bed-key of a record IRI — the last `:record:<sha>`, first 12. */
function shortId(iri: string): string {
  const parts = iri.split(':record:')
  return (parts[parts.length - 1] || iri).slice(0, 12)
}

/** Truncate a value for display (no silent drop — the full text is in the bytes).
 * Coerces non-strings: a LongMemEval `gold`/answer can be a NUMBER (count questions),
 * and `.slice` on it threw, blanking the WHOLE Walk index (one numeric-gold run killed
 * the list). Coerce so any value renders. */
function truncate(s: unknown, max: number): string {
  const str = typeof s === 'string' ? s : String(s ?? '')
  return str.length <= max ? str : str.slice(0, max) + ` … (+${str.length - max})`
}

/** A one-line preview of a verbose payload (the <details> SUMMARY gist, P3). */
function preview(s: string, max = 88): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max) + '…'
}

/**
 * THE VERDICT CHIP (agent-as-subject firstStep) — the deterministic gap between the
 * agent's verbatim final answer and the gold, surfaced everywhere the run appears.
 * This is the falsifier that makes the agent a SUBJECT (its belief can be WRONG), not
 * a flattering mirror — read-only, no-mock, computed from gold+finalAnswer the resource
 * already carries (see verdict.ts). Redundant encoding: tone (colour) + glyph + word.
 */
function verdictChip(gold: unknown, finalAnswer: string): TemplateResult {
  const v = classifyVerdict(gold, finalAnswer)
  // tone (colour) + word — redundant encoding, never colour-only; matches the app's
  // other chips. (mn-chip's `glyph` is a raw char not a lucide name, so we don't use
  // it; v.glyph stays in the Verdict data for the curl/turtle faces.)
  return html`<mn-chip
    class="verdict-chip"
    data-verdict=${v.state}
    tone=${v.tone}
    label=${v.label}
    title=${v.why}
  ></mn-chip>`
}

/** Format a USD cost compactly ($0.001074). */
function cost(n?: number): string {
  return n === undefined ? '—' : `$${n.toFixed(6)}`
}

/**
 * Render the bench answer's inline markdown — the ONE place a run carries authored
 * markup. The bench's final answers wrap the load-bearing datum in **bold** (e.g.
 * "your personal best 5K time was **25:50**"); rendered verbatim that focal string
 * would carry literal asterisks as visual noise. This splits on the bold markers
 * (`**…**` / `__…__`) into `<strong>` runs — text still flows through Lit's auto-
 * escaping (no unsafeHTML, no XSS surface), and the markers are stripped so the
 * single most-important run-level datum reads clean. Anything that is not a bold
 * span passes through as plain text (italics/links are left literal — out of scope).
 */
function inlineMarkdown(s: string): TemplateResult {
  // Split on **…** or __…__, keeping the captured inner text in alternating slots.
  const parts = s.split(/(\*\*[^*]+\*\*|__[^_]+__)/g)
  return html`${parts.map((p) => {
    const m = /^(\*\*|__)([\s\S]+)(\*\*|__)$/.exec(p)
    return m ? html`<strong>${m[2]}</strong>` : p
  })}`
}

/**
 * A glyph for each tool name — the redundant (icon + tone + zone) encoding (P1),
 * from the REGISTERED lucide set (never an emoji). A graph/sparql read is the
 * `network` glyph (the query topology); a remember/write is `sprout` (it plants a
 * record, the Plot's bloom glyph); anything else falls back to a neutral `share`.
 */
function toolGlyph(name: string): string {
  if (name.includes('sparql') || name.includes('query') || name.includes('select')) return 'network'
  if (name.includes('remember') || name.includes('memory') || name.includes('write')) return 'sprout'
  return 'share'
}

// ── ONE turn card (the observe→think→act step) ─────────────────────────────────

/**
 * One tool call + its co-located result (the ACT + the OBSERVATION), as a
 * common-region zone (P1). The verbose ARGS and the verbose RESULT each fold
 * behind a <details> (P3) — the summary is the one-line gist (the tool name + a
 * preview), the raw <pre> wall is the on-demand body, NOT shown at full weight at
 * rest. The supersede call wears the accent rail (the one true sequence, P5).
 */
function callView(call: WalkToolCall, result: WalkToolResult | undefined): TemplateResult {
  const sup = call.supersedesRef
  const glyph = toolGlyph(call.name)
  const argsText = JSON.stringify(call.arguments, null, 2)
  return html`
    <div class="wk-call ${sup ? 'wk-call-supersede' : ''}" data-call=${call.name}>
      <div class="wk-call-head">
        <span class="wk-call-glyph">${icon(glyph, { size: 13 })}</span>
        <span class="wk-call-name">${call.name}</span>
        ${sup
          ? html`<span class="wk-call-supersede-tag" data-supersede-ref=${sup} title="this write met its past self — it supersedes an earlier record">
              ${icon('share', { size: 11 })}<span>supersedes ${shortId(sup)}</span>
            </span>`
          : nothing}
      </div>
      <!-- P3: the verbose ARGS fold behind a summary; the gist is the one-liner. -->
      <details class="wk-fold wk-args-fold" data-args-fold>
        <summary class="wk-fold-summary">
          ${icon('chevron-right', { size: 12 })}
          <span class="wk-fold-label">args</span>
          <code class="wk-fold-peek">${preview(argsText)}</code>
        </summary>
        <pre class="wk-args" data-args>${truncate(argsText, 1400)}</pre>
      </details>
      ${result
        ? html`
            <div class="wk-result ${result.isError ? 'wk-result-err' : ''}" data-result>
              <details class="wk-fold wk-result-fold" data-result-fold>
                <summary class="wk-fold-summary">
                  ${result.isError
                    ? html`<span class="wk-result-glyph">${icon('alert-triangle', { size: 12 })}</span>`
                    : icon('chevron-right', { size: 12 })}
                  <span class="wk-fold-label">${result.isError ? 'error' : 'result'}</span>
                  <code class="wk-fold-peek">${preview(result.result)}</code>
                </summary>
                <pre class="wk-result-body">${truncate(result.result, 1000)}</pre>
              </details>
            </div>
          `
        : nothing}
    </div>
  `
}

/** mn-chip tone for a turn's stop reason — a quiet muted tag, never colour-only. */
const STOP_TONE: MnTone = 'muted'

/**
 * One TURN as an mn-card — think (reasoning, the FOCAL layer P0) → act (calls) →
 * observe (results) → cost. The header is a QUIET eyebrow (the phase + turn index,
 * uppercase + muted) so it never competes with the reasoning; the supersede badge
 * is the one bright tag (the WRITE that met its past self).
 */
function turnCard(turn: WalkTurn): TemplateResult {
  const resultByCall = new Map(turn.toolResults.map((r) => [r.toolCallId, r]))
  const u = turn.usage
  return html`
    <mn-card
      class="wk-turn ${turn.supersedes ? 'wk-turn-supersede' : ''}"
      label=${`${turn.label} · turn ${turn.turn} — focus the turn lens`}
      interactive
      data-turn=${turn.turn}
      data-phase=${turn.label}
    >
      <!-- P0/P4: the phase + turn index is a QUIET eyebrow, a register below the
           reasoning; only the supersede badge (the one true sequence) is bright. -->
      <div slot="header" class="wk-turn-head">
        <span class="wk-turn-eyebrow">${turn.label} · turn ${turn.turn}</span>
        ${turn.supersedes
          ? html`<mn-badge state="success" label="met its past self" data-supersede-turn></mn-badge>`
          : turn.stopReason
            ? html`<mn-chip tone=${STOP_TONE} label=${turn.stopReason}></mn-chip>`
            : nothing}
      </div>

      <!-- THINK: the model's reasoning — the FOCAL datum of the turn (P0). It is a
           common-region zone (the think well) with a quiet glyph eyebrow. -->
      <div class="wk-think" data-think>
        <p class="wk-zone-cap">${icon('eye', { size: 12 })}<span>think</span></p>
        ${turn.reasoning
          ? html`<p class="wk-reasoning" data-reasoning>${turn.reasoning}</p>`
          : html`<p class="wk-reasoning-empty">no reasoning text this turn</p>`}
      </div>

      <!-- ACT + OBSERVE: each tool call with its result, in the act common-region. -->
      ${turn.toolCalls.length === 0
        ? html`<p class="wk-no-calls">${icon('check', { size: 12 })}<span>no tool calls — the model answered (stop)</span></p>`
        : html`<div class="wk-act" data-act>
            <p class="wk-zone-cap">${icon('network', { size: 12 })}<span>act → observe</span></p>
            <div class="wk-calls">
              ${turn.toolCalls.map((c) => callView(c, resultByCall.get(c.id)))}
            </div>
          </div>`}

      <!-- COST: the per-turn usage — the quietest layer, a muted chip row. -->
      <div slot="footer" class="wk-usage" data-usage>
        <mn-chip tone="muted" label=${`${u?.inputTokens ?? '?'} in`}></mn-chip>
        <mn-chip tone="muted" label=${`${u?.outputTokens ?? '?'} out`}></mn-chip>
        <mn-chip tone="muted" label=${`${u?.totalTokens ?? '?'} tok`}></mn-chip>
        <mn-chip tone="neutral" label=${cost(u?.costUsd)}></mn-chip>
      </div>
    </mn-card>
  `
}

// ── THE RIBBON (one run) ───────────────────────────────────────────────────────

/**
 * THE WALK — one run as a ribbon of turn cards. When `turnCursor` is set, the
 * ribbon LIMITS to that turn (the ?turn lens); otherwise the whole run renders.
 *
 * P0 — the run header is a QUIET orienting band (an eyebrow + the question/gold as
 * a muted layer), and the FINAL answer is the single focal datum (an accent
 * flower), NOT one row in a Q/Gold/Final stack. P5/P1 — the run's confirmed
 * supersession edges (each ties a WRITE back to a Plot bed) are the one explicit
 * connecting line; the OLD record demotes (struck + faded), the NEW one stays
 * bright. The whole edge block folds behind a count handle when there is more than
 * one (P3); an empty edge set is a quiet one-liner (P7), never a full-weight zone.
 */
export function walkView(walk: WalkResource): TemplateResult {
  const cursor = walk.turnCursor ?? null
  const turns = cursor === null ? walk.turns : walk.turns.filter((t) => t.turn === cursor)
  const totalCost = walk.turns.reduce((n, t) => n + (t.usage?.costUsd ?? 0), 0)
  const totalTokens = walk.turns.reduce((n, t) => n + (t.usage?.totalTokens ?? 0), 0)
  const lens =
    cursor !== null
      ? html`<strong>turn ${cursor}</strong> — the ribbon is positioned at this turn (clear the lens to walk the whole run)`
      : html`<strong>whole run</strong> — every turn, in order`
  const edges = walk.supersessionEdges
  const nEdges = edges.length
  return html`
    <section class="walk" data-walk-run=${walk.id} data-turn-cursor=${cursor ?? 'all'}>
      <!-- P0/P4: the header is a quiet orienting band; the FINAL answer is the focal
           flower below it, alone in its band — the single dominant run-level datum. -->
      <header class="walk-header">
        <p class="walk-eyebrow">${icon('eye', { size: 13 })}<span>agentic run</span></p>
        <p class="walk-q" data-question><span class="walk-q-key">Q</span> ${walk.question}</p>
        <p class="walk-gold">
          <span class="walk-q-key">gold</span> ${walk.gold} ${verdictChip(walk.gold, walk.finalAnswer)}
        </p>
        <p class="walk-lens">${lens}</p>
      </header>

      <div class="walk-final-focus" data-arm="final">
        <div class="walk-final-flower" data-final>
          <p class="walk-final-cap">${icon('sprout', { size: 13 })}<span>final answer</span></p>
          <p class="walk-final-content">${inlineMarkdown(walk.finalAnswer)}</p>
        </div>
      </div>

      <p class="walk-summary">
        ${walk.turns.length} turn${walk.turns.length === 1 ? '' : 's'} ·
        ${totalTokens.toLocaleString()} tokens · ${cost(totalCost)} ·
        ${nEdges} confirmed supersession${nEdges === 1 ? '' : 's'}
      </p>

      ${nEdges
        ? html`
            <section class="walk-edges" data-edges>
              <details class="walk-edges-fold" data-edges-fold ?open=${nEdges <= 2}>
                <summary class="wk-zone-cap walk-edges-summary">
                  ${icon('share', { size: 13 })}<span>supersessions → the Plot beds</span>
                  <span class="wk-count">${nEdges}</span>
                </summary>
                <ol class="walk-edge-rows">
                  ${edges.map(
                    (e) => html`
                      <li class="walk-edge" data-edge>
                        <span class="walk-edge-rail" aria-hidden="true"></span>
                        <code class="walk-edge-new" title=${e.newUrn}>new ${shortId(e.newUrn)}</code>
                        <span class="walk-edge-arrow">${icon('arrow-right', { size: 12 })}<span>supersedes</span></span>
                        <s class="walk-edge-old" title=${e.oldUrn}>old ${shortId(e.oldUrn)}</s>
                      </li>
                    `,
                  )}
                </ol>
              </details>
            </section>
          `
        : // P7: no edge → a quiet one-liner, not a full accent zone.
          html`<p class="walk-edges-absent" data-edges-absent title="This run superseded no earlier record — it accumulated (surfaced honestly, never faked).">
            ${icon('share', { size: 12 })}<span>no supersessions this run</span>
          </p>`}

      <div class="ribbon" data-ribbon>
        ${turns.map((t) => html`<div class="ribbon-turn-host">${turnCard(t)}</div>`)}
      </div>
    </section>
  `
}

// ── THE RUN LIST (the walk index) ──────────────────────────────────────────────

/** THE WALK INDEX — one card per run to pick from (emits rz-open-run on activate). */
export function walkIndexView(index: WalkIndexResource): TemplateResult {
  return html`
    <section class="walk-index" data-walk-index>
      <header class="walk-header">
        <p class="walk-eyebrow">${icon('eye', { size: 13 })}<span>${index.title}</span></p>
        <p class="walk-summary">${index.summary}</p>
        <p class="walk-count">
          ${index.runs.length} run${index.runs.length === 1 ? '' : 's'}
        </p>
      </header>
      <div class="run-list">
        ${index.runs.length === 0
          ? html`<p class="run-empty">${icon('eye-off', { size: 13 })}<span>No agentic-run traces found in the runs directory.</span></p>`
          : index.runs.map(
              (r) => html`
                <mn-card class="run-row" label=${r.question} interactive data-run=${r.id}>
                  <!-- P0: the question is the focal datum of the row; the supersede
                       count is a quiet bright badge (the one true sequence). -->
                  <div slot="header" class="run-head">
                    <span class="run-q">${r.question}</span>
                    ${verdictChip(r.gold, r.finalAnswer)}
                    ${r.supersessionCount
                      ? html`<mn-badge
                          state="success"
                          label=${`${r.supersessionCount} supersession${r.supersessionCount === 1 ? '' : 's'}`}
                        ></mn-badge>`
                      : nothing}
                  </div>
                  <p class="run-final" data-final>${inlineMarkdown(r.finalAnswer)}</p>
                  <div slot="footer" class="run-meta">
                    <code class="run-id" title=${'run ' + r.id}>run ${r.id}</code>
                    <mn-chip tone="muted" label=${`${r.turnCount} turns`}></mn-chip>
                    <mn-chip tone="muted" label=${'gold ' + truncate(r.gold, 40)}></mn-chip>
                  </div>
                </mn-card>
              `,
            )}
      </div>
    </section>
  `
}
