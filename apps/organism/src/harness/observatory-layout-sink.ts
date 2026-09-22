/**
 * observatory-layout-sink.ts — the WRITE counterpart to
 * `observatory-layout-source.ts`: it PERSISTS a `LayoutDocument` (the Surface
 * engine's canonical model) as the single `ux:layoutJson` literal the reader
 * loads back, so a layout mutation SURVIVES A RELOAD.
 *
 * Honest scope (read before extending):
 *   - This is a DURABLE, ONE-SHOT write to the cell's `:ux:config` named graph.
 *     It is NOT a CRDT: there is no merge, no operational transform, no
 *     conflict resolution — the whole document is serialized and the previous
 *     literal is replaced wholesale. Durability means "the same document loads
 *     back after a reload", nothing more.
 *   - Multi-tab / multi-client convergence is therefore POLL-BASED, not push:
 *     a second tab only observes this write when it next RUNS the reader's
 *     query. There is no live subscription here. Two tabs writing concurrently
 *     is last-writer-wins at the triple level, exactly like the `sux:`
 *     WorkspaceConfig writes that share this same graph slot.
 *   - REPLACE, never append. The reader treats a SECOND `ux:layoutJson` triple
 *     for the surface subject as a hard uniqueness violation (it throws). So
 *     this writer emits ONE `sparql_update` that DELETEs every existing
 *     `ux:layoutJson` for the subject and INSERTs exactly one new literal —
 *     an additive `rdf_load`-style insert would trip that uniqueness throw.
 *   - The `:ux:config` graph is NOT a reserved `:projection:*` graph, so a raw
 *     `sparql_update` targeting it is ALLOWED by the cell's authority gate
 *     (the same slot the `sux:` config writes and the FID-004 probe already
 *     write + read back). The named graph is targeted INSIDE the update text
 *     via a literal `GRAPH <iri> { … }` block — `sparql_update` takes no
 *     separate target-graph arg.
 *
 * Island-clean: the seam is the contract's `RestClient.update(graphId, sparql)`
 * (POST /graphs/update). This module reuses the READER's own constants
 * (`UX_NS` / `UX_LAYOUT_JSON_PREDICATE_LOCAL` / `OBSERVATORY_UX_SURFACE_IRI` /
 * `assertEmbeddableGraphId` and `uxConfigGraphIri`) as the single source of
 * truth for subject/predicate/graph, so the write can NEVER drift onto a
 * predicate the reader does not query.
 *
 * STATUS: LIVE. The workspace-hosted dashboard center
 * (`cell/layout-dashboard-mount.ts`, reached through the normal Organism
 * workspace whenever a graph's :ux:config declares `sh-layout-dashboard`)
 * persists its divider settle points through this sink via
 * `createLayoutPersister`. This module remains the one durable write
 * PRIMITIVE; it is proven on its own (see observatory-layout-sink.test.ts).
 */
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  OBSERVATORY_UX_SURFACE_IRI,
  UX_LAYOUT_JSON_PREDICATE_LOCAL,
  UX_NS,
  UX_VEGA_THEME_PREDICATE_LOCAL,
  assertEmbeddableGraphId,
} from './observatory-layout-source.js'

/**
 * Escape a raw string for embedding inside a SPARQL double-quoted string
 * literal. Order is load-bearing: backslash MUST be doubled FIRST (otherwise a
 * later rule's inserted backslash would itself be doubled), then the quote,
 * then the C0 whitespace controls a SPARQL literal cannot carry raw. Mirrors
 * the escaping idiom in `in-memory-cell-contract.ts`, plus `\t`.
 */
export function escapeSparqlStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/** Where a durable layout write lands: the cell's graph, and (parameterized) the surface subject it is keyed under. */
export interface LayoutPersistTarget {
  readonly graphId: string
  /**
   * The subject the `ux:layoutJson` triple hangs off. Defaults to
   * `OBSERVATORY_UX_SURFACE_IRI` — parameterized so this write generalizes past
   * the single observatory surface the moment a second hosted surface exists.
   */
  readonly surfaceIri?: string
}

/**
 * Build the ONE `sparql_update` text that durably replaces the surface's
 * `ux:layoutJson` literal: a `DELETE WHERE` that removes EVERY existing
 * `ux:layoutJson` for the subject, immediately followed (`;`) by an
 * `INSERT DATA` of exactly one new literal — the serialized document. Replace,
 * never append: this is what keeps the reader's one-triple uniqueness invariant
 * intact across repeated writes.
 *
 * The payload is `JSON.stringify(doc)` (a `LayoutDocument` is plain frozen JSON
 * — no functions/Maps/symbols; `Object.freeze` does not affect `stringify`),
 * then SPARQL-literal-escaped.
 */
export function buildLayoutPersistUpdate(target: LayoutPersistTarget, doc: LayoutDocument): string {
  assertEmbeddableGraphId(target.graphId)
  const surfaceIri = target.surfaceIri ?? OBSERVATORY_UX_SURFACE_IRI
  const graphIri = uxConfigGraphIri(target.graphId)
  const escaped = escapeSparqlStringLiteral(JSON.stringify(doc))
  return (
    `PREFIX ux: <${UX_NS}>\n` +
    `DELETE WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_LAYOUT_JSON_PREDICATE_LOCAL} ?layoutJson .\n` +
    `  }\n` +
    `} ;\n` +
    `INSERT DATA {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_LAYOUT_JSON_PREDICATE_LOCAL} "${escaped}" .\n` +
    `  }\n` +
    `}`
  )
}

/**
 * Durably persist `doc` as the surface's single `ux:layoutJson` literal via the
 * contract's write seam (`RestClient.update` -> POST /graphs/update ->
 * `sparql_update`). One round trip; resolves when the cell has applied the
 * DELETE+INSERT.
 */
export async function persistLayoutDocument(
  rest: RestClient,
  target: LayoutPersistTarget,
  doc: LayoutDocument,
): Promise<void> {
  await rest.update(target.graphId, buildLayoutPersistUpdate(target, doc))
}

// ── ux:vegaTheme — the sibling write, same replace-not-append shape ────────

/**
 * Build the `sparql_update` text that durably replaces the surface's
 * `ux:vegaTheme` literal — the EXACT same DELETE-WHERE-then-INSERT-DATA
 * shape as `buildLayoutPersistUpdate`, targeting the sibling predicate
 * (`observatory-layout-source.ts`'s own `UX_VEGA_THEME_PREDICATE_LOCAL`) at
 * the SAME subject/named-graph. `theme` is caller-validated plain JSON
 * (typically `isValidVegaThemeOverride`-checked before this is called; this
 * function does not re-validate — it only serializes and escapes).
 */
export function buildVegaThemePersistUpdate(target: LayoutPersistTarget, theme: Record<string, unknown>): string {
  assertEmbeddableGraphId(target.graphId)
  const surfaceIri = target.surfaceIri ?? OBSERVATORY_UX_SURFACE_IRI
  const graphIri = uxConfigGraphIri(target.graphId)
  const escaped = escapeSparqlStringLiteral(JSON.stringify(theme))
  return (
    `PREFIX ux: <${UX_NS}>\n` +
    `DELETE WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_VEGA_THEME_PREDICATE_LOCAL} ?vegaTheme .\n` +
    `  }\n` +
    `} ;\n` +
    `INSERT DATA {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${surfaceIri}> ux:${UX_VEGA_THEME_PREDICATE_LOCAL} "${escaped}" .\n` +
    `  }\n` +
    `}`
  )
}

/** Durably persist `theme` as the surface's single `ux:vegaTheme` literal — the write counterpart to `loadObservatoryVegaTheme`. */
export async function persistVegaTheme(
  rest: RestClient,
  target: LayoutPersistTarget,
  theme: Record<string, unknown>,
): Promise<void> {
  await rest.update(target.graphId, buildVegaThemePersistUpdate(target, theme))
}
