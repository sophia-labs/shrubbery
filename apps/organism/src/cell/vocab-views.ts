/**
 * vocab-views.ts — the EMPORIUM `dom` face: the VOCAB-CATALOGUE view + the
 * (iter-5a DEEPENED) PACK-DETAIL view, built PURELY from the GENERALIZED
 * components (mn-card / mn-chip / mn-badge / mn-sparkline + the iter-5a
 * mn-relations) and the render package's VocabResource / VocabPack shapes.
 *
 * The pack-detail view renders the FULL pack ANATOMY from the GENERALIZED
 * primitives: pack STATS (class/predicate/relationship counts + sha), the
 * namespace table, the MINTING rules (slug + uri/doc-id), a RELATIONSHIPS section
 * with a LIST/GRAPH toggle (class→class predicate ranges + CRDT wire rules shown
 * as an edge LIST via mn-relations OR a layered class GRAPH via mn-graph — both
 * fed by the SAME relationship read-model, iter-6b), and per class:
 * required-vs-optional predicates with datatype/multi, CLOSED-ENUM values, and the
 * subject-minting rule. All from REAL live-read data, never faked.
 *
 * This is the missing fourth face of the Emporium catalogue. @shrubbery/render
 * already renders the catalogue to the three TEXT faces (markdown / Turtle /
 * JSON-LD); the `dom` face is a Lit concern and so lives OUTSIDE the Lit-free
 * render package — here, alongside the other DOM-host code. It is the exact
 * analogue of how @shrubbery/runtime owns the workspace `dom` face while
 * @shrubbery/render owns that resource's text faces.
 *
 * WHY shell-side (apps/organism), not @shrubbery/components:
 *   - @shrubbery/components is an ISLAND — its guard test forbids any import
 *     beyond lit + @shrubbery/nucleus (it must not depend on @shrubbery/render).
 *     These views consume the VocabResource / VocabPack shapes from
 *     @shrubbery/render, so they belong in the shell that already reads the live
 *     registry (the EmporiumClient is here too). The general PRIMITIVES they
 *     compose stay in the library; only the vocab-specific VIEW lives here.
 *
 * Pure presentation: lit + the registered general components + render TYPES. No
 * network, no store, no backend. The views never fetch — the shell hands them
 * REAL vocab data it read live from a cell (or nothing, in which case they show
 * an honest empty/placeholder, never faked rows).
 *
 * Skin-aware for FREE: every primitive (mn-card / mn-chip / mn-badge) mirrors
 * the ambient [data-skin] and recolors via the inherited role tokens, so the
 * Emporium skin turns the whole catalogue purple with no per-skin code here.
 */

import { html, nothing, type TemplateResult } from 'lit'
import type { VocabPack, VocabSummary } from '@shrubbery/render'

// Side-effect import: register the general primitives this view stamps. (The
// organism already imports '@shrubbery/components' for the chrome; importing the
// barrel here too is idempotent and keeps this module self-contained.)
import '@shrubbery/components'

/** Shorten a 64-hex content hash for a chip/badge label (keeps the full in title). */
export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 8) : '—'
}

/** Options for the catalogue list view. */
export interface VocabCatalogueViewOptions {
  /**
   * Optional per-vocabulary class count (name → count). The /emporium/vocabs
   * LIST endpoint does not carry class counts — only the per-pack golden
   * contract does — so the shell supplies them after reading the details. When a
   * name is absent the card honestly omits the class-count chip (never a fake 0).
   */
  readonly classCounts?: Readonly<Record<string, number>>
  /** Fired (as `mn-card-activate`) when a pack card is activated → open detail. */
  readonly onOpen?: (name: string) => void
}

/**
 * The VOCAB-CATALOGUE view — one mn-card per vocabulary pack, each surfacing the
 * catalogue facts as general primitives:
 *   - name + title       → the card header
 *   - version            → an accent mn-chip
 *   - namespace          → a neutral mn-chip (monospace-ish, full namespace)
 *   - class-count        → a muted mn-chip (only when the shell supplied it)
 *   - sha (content hash) → a success mn-badge (8-char label, full sha in title)
 *
 * Renders REAL rows only — if `vocabs` is empty it shows an honest empty state.
 */
export function renderVocabCatalogue(
  vocabs: readonly VocabSummary[],
  opts: VocabCatalogueViewOptions = {},
): TemplateResult {
  if (vocabs.length === 0) {
    return html`
      <div class="vocab-catalogue" data-empty="true">
        <p class="vocab-empty">No vocabularies served by this cell (the live /emporium registry is empty).</p>
      </div>
    `
  }
  return html`
    <div class="vocab-catalogue">
      <div class="vocab-catalogue__intro">
        <strong>${vocabs.length}</strong> ${vocabs.length === 1 ? 'vocabulary' : 'vocabularies'}.
        The pack IS the catalog.
      </div>
      <div class="vocab-catalogue__grid">
        ${vocabs.map((v) => renderVocabCard(v, opts))}
      </div>
    </div>
  `
}

/** One catalogue row — an mn-card composed of the general primitives. */
function renderVocabCard(
  v: VocabSummary,
  opts: VocabCatalogueViewOptions,
): TemplateResult {
  const classCount = opts.classCounts?.[v.name]
  const onActivate = (): void => opts.onOpen?.(v.name)
  return html`
    <mn-card
      class="vocab-card"
      data-vocab=${v.name}
      interactive
      label=${`Open ${v.name} pack detail`}
      @mn-card-activate=${onActivate}
    >
      <div slot="header" class="vocab-card__header">
        <span class="vocab-card__name">${v.name}</span>
        <span class="vocab-card__title">${v.title}</span>
      </div>
      <div class="vocab-card__chips">
        <mn-chip tone="accent" glyph="v" label=${v.version} hint=${`version ${v.version}`}></mn-chip>
        ${classCount !== undefined
          ? html`<mn-chip
              tone="muted"
              label=${`${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
              hint="classes in this pack's golden contract"
            ></mn-chip>`
          : nothing}
        <mn-chip tone="neutral" label=${v.namespace} hint=${v.namespace}></mn-chip>
      </div>
      <div slot="footer" class="vocab-card__footer">
        <mn-badge
          state="success"
          glyph="#"
          label=${shortSha(v.sha)}
          hint=${`sha256 ${v.sha}`}
        ></mn-badge>
      </div>
    </mn-card>
  `
}

/** How the RELATIONSHIPS section is presented: as an edge LIST or as a layered GRAPH. */
export type RelationshipsView = 'list' | 'graph'

/** Options for the pack-detail view. */
export interface VocabPackViewOptions {
  /** Fired when the "back to catalogue" affordance is activated. */
  readonly onBack?: () => void
  /**
   * Which face the RELATIONSHIPS section shows: the iter-5a edge LIST
   * (mn-relations) or the iter-6b layered class GRAPH (mn-graph). Both consume the
   * SAME relationship read-model (pack.relationships); the graph also takes the
   * pack's classes as its node set. Defaults to 'list'. The shell owns the toggle
   * state and re-renders on change (this view stays pure).
   */
  readonly relationshipsView?: RelationshipsView
  /** Fired when the list/graph toggle is activated, with the requested view. */
  readonly onRelationshipsView?: (view: RelationshipsView) => void
  /** Fired when a class node/card is activated in the GRAPH (deep-link the class). */
  readonly onClassSelect?: (cls: string) => void
}

/**
 * The PACK-DETAIL view — one pack's golden contract rendered as its FULL ANATOMY
 * from the general primitives (iter-5a deepening):
 *   - a header card: the pack facts as STATS chips (version / namespace / sha +
 *     class / predicate / relationship counts as a sparkline-flanked stat strip);
 *   - the prefix → namespace table;
 *   - the pack-level MINTING rules (slug rule + per-template uri / doc-id rules);
 *   - a RELATIONSHIPS section: every class→class edge (predicate ranges + CRDT
 *     wire rules) via the general mn-relations component (from→pred→to);
 *   - ONE mn-card per class: REQUIRED vs OPTIONAL predicates grouped, each with
 *     datatype + multi (mn-chip) + required (mn-badge) + CLOSED-ENUM allowed
 *     values (mn-chip set) + the class's subject-minting rule.
 *
 * "The pack IS the catalog": every fact shown here is REAL data the shell parsed
 * live from /emporium/vocab/{name}/{version} — nothing is faked. A section the
 * contract omits shows an honest absence (it simply does not render).
 */
export function renderVocabPack(
  pack: VocabPack,
  opts: VocabPackViewOptions = {},
): TemplateResult {
  const predCount = pack.predicateCount ?? pack.classes.reduce((n, c) => n + c.predicates.length, 0)
  const relCount = pack.relationshipCount ?? pack.relationships?.length ?? 0
  return html`
    <div class="vocab-pack" data-vocab=${pack.name}>
      ${opts.onBack
        ? html`<div class="vocab-pack__nav">
            <mn-badge
              interactive
              state="neutral"
              glyph="←"
              label="catalogue"
              hint="back to the vocabulary catalogue"
              @mn-badge-action=${() => opts.onBack?.()}
            ></mn-badge>
          </div>`
        : nothing}

      <mn-card class="vocab-pack__head">
        <div slot="header" class="vocab-pack__title">
          <span class="vocab-pack__name">${pack.name}</span>
          <span class="vocab-pack__subtitle">${pack.title}</span>
        </div>
        ${pack.description ? html`<p class="vocab-pack__desc">${pack.description}</p>` : nothing}
        <div class="vocab-pack__chips">
          <mn-chip tone="accent" glyph="v" label=${pack.version} hint=${`version ${pack.version}`}></mn-chip>
          <mn-chip tone="neutral" label=${pack.namespace} hint=${pack.namespace}></mn-chip>
          ${pack.sha
            ? html`<mn-badge state="success" glyph="#" label=${shortSha(pack.sha)} hint=${`sha256 ${pack.sha}`}></mn-badge>`
            : nothing}
        </div>
        ${renderPackStats(pack.classes.length, predCount, relCount)}
        ${renderNamespaceTable(pack.namespaces)}
      </mn-card>

      ${renderMinting(pack.minting)}
      ${renderRelationships(pack.relationships ?? [], pack.classes, opts)}

      <div class="vocab-pack__classes">
        ${pack.classes.length === 0
          ? html`<p class="vocab-empty">This pack declares no classes.</p>`
          : pack.classes.map((cls) => renderClassCard(cls))}
      </div>
    </div>
  `
}

/**
 * The pack STATS strip — class / predicate / relationship counts as muted chips
 * + a tiny sparkline of the three magnitudes (a general at-a-glance shape). The
 * sha already rides the header badge.
 */
function renderPackStats(
  classCount: number,
  predicateCount: number,
  relationshipCount: number,
): TemplateResult {
  return html`
    <div class="vocab-pack__stats">
      <mn-chip
        tone="muted"
        glyph="◫"
        label=${`${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
        hint="classes in this pack"
      ></mn-chip>
      <mn-chip
        tone="muted"
        glyph="·"
        label=${`${predicateCount} ${predicateCount === 1 ? 'predicate' : 'predicates'}`}
        hint="predicates across all classes"
      ></mn-chip>
      <mn-chip
        tone="muted"
        glyph="→"
        label=${`${relationshipCount} ${relationshipCount === 1 ? 'relationship' : 'relationships'}`}
        hint="class→class links (predicate ranges + CRDT wires)"
      ></mn-chip>
      <mn-sparkline
        class="vocab-pack__stats-spark"
        .values=${[classCount, relationshipCount, predicateCount]}
        hint="class · relationship · predicate magnitudes"
      ></mn-sparkline>
    </div>
  `
}

/** The pack's prefix → namespace table (only when the contract carried one). */
function renderNamespaceTable(
  namespaces: VocabPack['namespaces'],
): TemplateResult | typeof nothing {
  if (!namespaces) return nothing
  const entries = Object.entries(namespaces).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return nothing
  return html`
    <table class="vocab-pack__ns">
      <thead>
        <tr><th>prefix</th><th>namespace</th></tr>
      </thead>
      <tbody>
        ${entries.map(
          ([prefix, ns]) => html`<tr>
            <td><mn-chip tone="muted" label=${prefix || '(base)'}></mn-chip></td>
            <td class="vocab-pack__ns-uri">${ns}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  `
}

/**
 * The pack-level MINTING rules — the slug rule (pattern / replacement / case) +
 * the per-template subject-URI and doc-id rules, as a real table. Absent when the
 * contract declares none (honest, not a faked empty section).
 */
function renderMinting(
  minting: VocabPack['minting'],
): TemplateResult | typeof nothing {
  if (!minting) return nothing
  const uriRules = minting.uriRules ? Object.entries(minting.uriRules) : []
  const docIdRules = minting.docIdRules ? Object.entries(minting.docIdRules) : []
  const hasSlug =
    minting.slugPattern !== undefined ||
    minting.slugReplacement !== undefined ||
    minting.slugLowercase !== undefined
  if (!hasSlug && uriRules.length === 0 && docIdRules.length === 0) return nothing
  return html`
    <mn-card class="vocab-pack__minting" data-section="minting">
      <div slot="header" class="vocab-pack__section-head">
        <span>Minting</span>
        <mn-chip tone="muted" label="slug · uri · doc-id rules"></mn-chip>
      </div>
      <div class="vocab-pack__minting-body">
        ${hasSlug
          ? html`<div class="vocab-pack__slug">
              ${minting.slugPattern !== undefined
                ? html`<mn-chip tone="neutral" glyph="/" label=${`pattern ${minting.slugPattern}`} hint="slug regex"></mn-chip>`
                : nothing}${minting.slugReplacement !== undefined
                ? html`<mn-chip tone="neutral" label=${`→ ${minting.slugReplacement || '∅'}`} hint="slug replacement"></mn-chip>`
                : nothing}${minting.slugLowercase !== undefined
                ? html`<mn-chip
                    tone=${minting.slugLowercase ? 'accent' : 'muted'}
                    label=${minting.slugLowercase ? 'lowercase' : 'preserve case'}
                  ></mn-chip>`
                : nothing}
            </div>`
          : nothing}${renderMintRuleTable('subject URI rules', uriRules)}${renderMintRuleTable('doc-id rules', docIdRules)}
      </div>
    </mn-card>
  `
}

/** One labeled template→rule table (shared by uri-rules and doc-id-rules). */
function renderMintRuleTable(
  caption: string,
  rules: ReadonlyArray<readonly [string, string]>,
): TemplateResult | typeof nothing {
  if (rules.length === 0) return nothing
  return html`
    <table class="vocab-pack__mint">
      <thead>
        <tr><th colspan="2">${caption}</th></tr>
        <tr><th>template</th><th>rule</th></tr>
      </thead>
      <tbody>
        ${rules
          .slice()
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([tpl, rule]) => html`<tr>
              <td><mn-chip tone="muted" label=${tpl}></mn-chip></td>
              <td class="vocab-pack__mint-rule">${rule}</td>
            </tr>`,
          )}
      </tbody>
    </table>
  `
}

/**
 * The RELATIONSHIPS section — every class→class edge (predicate-range links +
 * CRDT wire rules), shown either as the iter-5a edge LIST (the general
 * mn-relations component, from→pred→to, split by provenance) OR as the iter-6b
 * layered class GRAPH (the general mn-graph component: classes as nodes,
 * predicate-range + CRDT-wire edges). A LIST/GRAPH toggle lets the user switch;
 * BOTH faces consume the SAME relationship read-model (the single source of truth)
 * — the graph adds the pack's classes as its node set so isolated classes still
 * appear as nodes. Renders nothing when the pack declares no edges.
 */
function renderRelationships(
  relationships: NonNullable<VocabPack['relationships']>,
  classes: VocabPack['classes'],
  opts: VocabPackViewOptions = {},
): TemplateResult | typeof nothing {
  if (relationships.length === 0) return nothing
  const view: RelationshipsView = opts.relationshipsView ?? 'list'
  const predicateEdges = relationships.filter((r) => r.kind === 'predicate')
  const wireEdges = relationships.filter((r) => r.kind === 'wire')
  return html`
    <mn-card class="vocab-pack__relationships" data-section="relationships" data-rel-view=${view}>
      <div slot="header" class="vocab-pack__section-head">
        <span>Relationships</span>
        <mn-chip
          tone="muted"
          label=${`${relationships.length} ${relationships.length === 1 ? 'link' : 'links'}`}
        ></mn-chip>
        <span class="vocab-pack__rel-toggle" role="group" aria-label="Relationships view">
          <button
            class="vocab-pack__rel-toggle-btn ${view === 'list' ? 'is-active' : ''}"
            data-rel-view-btn="list"
            aria-pressed=${view === 'list' ? 'true' : 'false'}
            @click=${() => opts.onRelationshipsView?.('list')}
          >
            list
          </button>
          <button
            class="vocab-pack__rel-toggle-btn ${view === 'graph' ? 'is-active' : ''}"
            data-rel-view-btn="graph"
            aria-pressed=${view === 'graph' ? 'true' : 'false'}
            @click=${() => opts.onRelationshipsView?.('graph')}
          >
            graph
          </button>
        </span>
      </div>
      ${view === 'graph'
        ? renderRelationshipsGraph(relationships, classes, opts)
        : html`<div class="vocab-pack__rel-groups">
            ${predicateEdges.length > 0
              ? html`<div class="vocab-pack__rel-group" data-rel-kind="predicate">
                  <div class="vocab-pack__rel-label">class → class (predicate ranges)</div>
                  <mn-relations .relations=${predicateEdges}></mn-relations>
                </div>`
              : nothing}${wireEdges.length > 0
              ? html`<div class="vocab-pack__rel-group" data-rel-kind="wire">
                  <div class="vocab-pack__rel-label">CRDT wires (doc connections)</div>
                  <mn-relations .relations=${wireEdges}></mn-relations>
                </div>`
              : nothing}
          </div>`}
    </mn-card>
  `
}

/**
 * The GRAPH face of the relationships — the pack's class graph via the general
 * mn-graph component. NODES are the pack's classes (so an isolated class still
 * appears, not just edge endpoints); EDGES are the SAME relationship read-model
 * the list face consumes (predicate ranges solid, CRDT wires dashed). Activating a
 * node deep-links the class (onClassSelect). No data is faked — the node set + the
 * edge set are exactly what the live contract declared.
 */
function renderRelationshipsGraph(
  relationships: NonNullable<VocabPack['relationships']>,
  classes: VocabPack['classes'],
  opts: VocabPackViewOptions,
): TemplateResult {
  const nodes = classes.map((c) => ({ id: c.name }))
  return html`
    <div class="vocab-pack__rel-graph" data-rel-kind="graph">
      <div class="vocab-pack__rel-label">class graph (predicate ranges + CRDT wires)</div>
      <mn-graph
        interactive
        hint="class graph: classes as nodes, predicate-range (solid) + CRDT-wire (dashed) edges"
        .nodes=${nodes}
        .edges=${relationships}
        @mn-graph-node-select=${(e: CustomEvent) => opts.onClassSelect?.(e.detail.id)}
      ></mn-graph>
    </div>
  `
}

/**
 * One class card — REQUIRED vs OPTIONAL predicates grouped, each with datatype +
 * multi + closed-enum values, plus the class's subject-minting rule.
 */
function renderClassCard(cls: VocabPack['classes'][number]): TemplateResult {
  const required = cls.predicates.filter((p) => p.required)
  const optional = cls.predicates.filter((p) => !p.required)
  return html`
    <mn-card class="vocab-class" data-class=${cls.name}>
      <div slot="header" class="vocab-class__header">
        <span class="vocab-class__name">${cls.name}</span>
        <mn-chip
          tone="muted"
          label=${`${cls.predicates.length} ${cls.predicates.length === 1 ? 'predicate' : 'predicates'}`}
        ></mn-chip>
        ${required.length > 0
          ? html`<mn-chip tone="warning" glyph="!" label=${`${required.length} required`}></mn-chip>`
          : nothing}
      </div>

      ${cls.subjectRule
        ? html`<div class="vocab-class__subject">
            <mn-chip tone="muted" glyph="⌖" label="subject" hint="subject-minting rule"></mn-chip>
            <span class="vocab-class__subject-rule">${cls.subjectRule}</span>
          </div>`
        : nothing}

      ${cls.predicates.length === 0
        ? html`<p class="vocab-empty">(no predicates)</p>`
        : html`<div class="vocab-class__groups">
            ${renderPredGroup('required', required)}${renderPredGroup('optional', optional)}
          </div>`}
    </mn-card>
  `
}

/**
 * One predicate group (required | optional) — a real table of predicates with
 * datatype, the required/multi flags, and any CLOSED-ENUM allowed-value chips.
 */
function renderPredGroup(
  group: 'required' | 'optional',
  preds: ReadonlyArray<VocabPack['classes'][number]['predicates'][number]>,
): TemplateResult | typeof nothing {
  if (preds.length === 0) return nothing
  return html`
    <div class="vocab-class__group" data-pred-group=${group}>
      <div class="vocab-class__group-label">${group}</div>
      <table class="vocab-class__preds">
        <thead>
          <tr><th>predicate</th><th>datatype</th><th>flags / enum</th></tr>
        </thead>
        <tbody>
          ${preds.map(
            (pred) => html`<tr data-pred=${pred.name}>
              <td>
                <mn-chip
                  tone=${pred.relatesTo ? 'accent' : 'neutral'}
                  glyph=${pred.relatesTo ? '→' : ''}
                  label=${pred.name}
                  hint=${pred.relatesTo ? `links to ${pred.relatesTo}` : pred.name}
                ></mn-chip>
              </td>
              <td class="vocab-class__dt">${pred.datatype ?? '—'}</td>
              <td class="vocab-class__flags">
                ${group === 'required'
                  ? html`<mn-badge state="warning" glyph="!" label="required"></mn-badge>`
                  : nothing}
                ${pred.multi
                  ? html`<mn-chip tone="accent" label="multi" hint="multi-valued predicate"></mn-chip>`
                  : nothing}
                ${pred.relatesTo
                  ? html`<mn-chip tone="accent" glyph="→" label=${pred.relatesTo} hint="object-property range"></mn-chip>`
                  : nothing}
                ${pred.enumValues && pred.enumValues.length > 0
                  ? html`<span class="vocab-class__enum" data-enum=${pred.name}>
                      ${pred.enumValues.map(
                        (v) => html`<mn-chip tone="muted" dashed label=${v} hint="closed-enum value"></mn-chip>`,
                      )}
                    </span>`
                  : nothing}
              </td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  `
}
