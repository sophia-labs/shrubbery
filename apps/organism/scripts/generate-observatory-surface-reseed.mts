#!/usr/bin/env -S node --import tsx
/**
 * generate-observatory-surface-reseed.mts — the re-seed artifact P7 calls
 * for (plans/observatory-ux-implementation-spec-20260728.md §3 P7 Risks:
 * "Possibly invisible on canary. P7 replaces the CANNED FALLBACK only. If
 * the 24-cell graph seed was ever applied, the graph copy still wins... a
 * re-seed is a prerequisite and it must be DELETE+INSERT").
 *
 * Gap 1 (§6, CLOSED 2026-07-28) confirmed the live canary `observatory` cell
 * carries `layoutId: "observatory-dashboard-v1-metric-packs"` as a graph
 * seed — so landing this packet's tabs-composed document where an operator
 * can actually SEE it requires replacing that graph-authored `ux:layoutJson`
 * literal, not just this repo's in-repo fallback (which `observatory-
 * layout-source.ts` already graduated to `buildObservatorySurfaceDocument`).
 *
 * This script is PURE COMPUTATION — it builds the real, validated
 * `LayoutDocument` (`buildObservatorySurfaceDocument`) and wraps it in the
 * SAME DELETE-WHERE-then-INSERT-DATA shape `observatory-layout-sink.ts`'s
 * already-proven-live `buildLayoutPersistUpdate` uses. It makes NO network
 * call and NEVER touches a live cell — per this run's own Deployment Safety
 * rule and this packet's explicit instruction ("do NOT run it against
 * canary"), applying the emitted `.ru` is a SEPARATE, gated, human-approved
 * step.
 *
 * TOOLCHAIN NOTE — why this file does NOT import `observatory-layout-sink.ts`
 * directly (a deliberate, tested trade-off, not an oversight): that module
 * imports `observatory-layout-source.ts`, which imports `@shrubbery/runtime`
 * (the FULL barrel — every face, including Lit `@customElement`/`@property`
 * view elements from MULTIPLE packages, e.g. `packages/hoja`). Each of those
 * packages carries its OWN `tsconfig.json` governing its own
 * `experimentalDecorators`/`useDefineForClassFields` settings, but bare
 * `node --import tsx` transforms an entire process run against exactly ONE
 * tsconfig (`TSX_TSCONFIG_PATH`, or the nearest one to CWD by default) — so
 * no single override satisfies every package's decorator settings at once,
 * and the run fails with `Error: Unsupported decorator location: field`
 * (verified: `packages/runtime/tsconfig.json` alone is enough for
 * `buildObservatorySurfaceDocument`'s own chain — see the required env var
 * below — but adding the sink's chain on top fails again, this time inside
 * `packages/hoja`). Rather than fight a multi-package tsconfig conflict in a
 * one-off generator, this file inlines the tiny, stable wrapping algorithm
 * (`buildReseedUpdate` below) as a byte-for-byte mirror of
 * `buildLayoutPersistUpdate`/`escapeSparqlStringLiteral`
 * (`observatory-layout-sink.ts`) and the three predicate/subject/namespace
 * constants `observatory-layout-source.ts` defines
 * (`OBSERVATORY_UX_SURFACE_IRI`/`UX_NS`/`UX_LAYOUT_JSON_PREDICATE_LOCAL`) —
 * `@shrubbery/nucleus`'s `uxConfigGraphIri` (the one remaining external
 * dependency) is Lit-free and imports cleanly with no override. If either
 * source file's algorithm or constants ever change, this mirror must change
 * with it — there is no compile-time link enforcing that, only this comment.
 *
 * Usage (run from `apps/organism/`; the `TSX_TSCONFIG_PATH` override is
 * REQUIRED — bare `node --import tsx` picks this package's own tsconfig by
 * default, which fails to transform the Lit `@customElement`/`@property`
 * decorators `buildObservatorySurfaceDocument`'s own import chain drags in
 * transitively (`@shrubbery/runtime/layout`'s barrel re-exports every face,
 * including its view elements) with the same `Unsupported decorator
 * location: field` error; pointing tsx at `packages/runtime/tsconfig.json`
 * — the tsconfig that actually governs those files' decorator settings —
 * fixes it):
 *
 *   TSX_TSCONFIG_PATH="$(pwd)/../../packages/runtime/tsconfig.json" \
 *     node --import tsx scripts/generate-observatory-surface-reseed.mts [graphId]
 *
 * Defaults `graphId` to `observatory` (the live canary cell's own id, per
 * Gap 1's confirmed query). Writes the `.ru` text to stdout AND to
 * `seeds/observatory-surface-v1-reseed.ru` (relative to this package root)
 * so the artifact is both inspectable in a terminal and checked into the
 * repo as a durable, regenerable file — regenerate it (this script, not a
 * hand-edit) whenever `buildObservatorySurfaceDocument` changes.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import type { LayoutDocument } from '@shrubbery/nucleus/layout'
import { buildObservatorySurfaceDocument } from '../src/harness/observatory-surface-document.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── mirrors observatory-layout-source.ts's own constants (the reader's
// single source of truth for subject/predicate/namespace) — see this file's
// header for why these are a local copy rather than an import. ────────────
const OBSERVATORY_UX_SURFACE_IRI = 'urn:sophia:ux:surface:observatory-dashboard'
const UX_NS = 'http://mnemosyne.dev/ux#'
const UX_LAYOUT_JSON_PREDICATE_LOCAL = 'layoutJson'

/** Byte-for-byte mirror of observatory-layout-sink.ts's escapeSparqlStringLiteral. */
function escapeSparqlStringLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/** Byte-for-byte mirror of observatory-layout-sink.ts's buildLayoutPersistUpdate, specialized to the default surface (no surfaceIri override needed here). */
function buildReseedUpdate(graphId: string, doc: LayoutDocument): string {
  const graphIri = uxConfigGraphIri(graphId)
  const escaped = escapeSparqlStringLiteral(JSON.stringify(doc))
  return (
    `PREFIX ux: <${UX_NS}>\n` +
    `DELETE WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${OBSERVATORY_UX_SURFACE_IRI}> ux:${UX_LAYOUT_JSON_PREDICATE_LOCAL} ?layoutJson .\n` +
    `  }\n` +
    `} ;\n` +
    `INSERT DATA {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    <${OBSERVATORY_UX_SURFACE_IRI}> ux:${UX_LAYOUT_JSON_PREDICATE_LOCAL} "${escaped}" .\n` +
    `  }\n` +
    `}`
  )
}

function main(): void {
  const graphId = process.argv[2] ?? 'observatory'
  const doc = buildObservatorySurfaceDocument(graphId)
  const update = buildReseedUpdate(graphId, doc)

  const header =
    `# GENERATED — do not hand-edit. Regenerate from apps/organism/ with:\n` +
    `#   TSX_TSCONFIG_PATH="$(pwd)/../../packages/runtime/tsconfig.json" \\\n` +
    `#     node --import tsx scripts/generate-observatory-surface-reseed.mts ${graphId}\n` +
    `# Source: apps/organism/src/harness/observatory-surface-document.ts\n` +
    `#   (buildObservatorySurfaceDocument), wrapped in the SAME DELETE-WHERE-then-\n` +
    `#   INSERT-DATA shape observatory-layout-sink.ts's live persister already uses\n` +
    `#   (this script's own buildReseedUpdate mirrors it — see this file's header).\n` +
    `#   DELETE-then-INSERT, never a bare INSERT DATA: the reader (observatory-\n` +
    `#   layout-source.ts) throws on a second ux:layoutJson triple for the surface\n` +
    `#   subject, so a re-seed must delete the old one first.\n` +
    `#\n` +
    `# NOT executed by this script. Per plans/observatory-ux-implementation-\n` +
    `# spec-20260728.md §3 P7 and this repo's own CLAUDE.md Deployment Safety rule,\n` +
    `# applying this update to a live cell is a separate, gated, human-approved step\n` +
    `# (e.g. via the gateway's sparql_update route or the sophia-canary MCP), never\n` +
    `# run automatically here.\n\n`

  const output = header + update + '\n'

  const outPath = resolve(__dirname, '..', 'seeds', 'observatory-surface-v1-reseed.ru')
  writeFileSync(outPath, output, 'utf8')

  process.stdout.write(output)
  console.error(`\nwrote ${outPath} (graphId=${graphId}, layoutId=${doc.layoutId}, ${Object.keys(doc.nodes).length} nodes)`)
}

main()
