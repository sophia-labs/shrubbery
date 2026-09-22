/**
 * source-sync-query-catalog.ts — the named queries behind the contested
 * wayfinding surface (MO object-face integration spec, master §2.7, §3
 * Slice 5). Extends the SAME `urn:sophia:query:*` grammar and the SAME
 * `NamedQueryRegistry`/`{{graphId}}` template discipline
 * `observatory-surface-query-catalog.ts` already established — a SEPARATE,
 * disjoint-named catalogue, composed with that one (never replacing it) by
 * `shell-named-query-registry.ts`.
 *
 * Written against WS4's REAL, shipped RDF vocabulary (Garden
 * `src-tauri/src/source_sync.rs`'s `conflict_triples`/`ConflictProjection`,
 * verified 2026-07-30 against the landed Slice 0 commit) — not the pack's
 * earlier guessed shape. `sync:candidateCount` gives the badge/table its
 * count in one binding, with no sub-select and no aggregate; candidate nodes
 * are a second, disjoint class span (`sync:SyncConflictCandidate`), so there
 * is no BGP in which two per-candidate variables can pair wrongly (the
 * "cartesian hazard" the pre-Ask-A flat-predicate shape had is structurally
 * gone here — kept as a regression test, T-Q3, not a design constraint).
 *
 * `objectKey` is `vocab \u{1F} class \u{1F} objectId` (Garden's
 * `object_key()`, `source_sync.rs:758-760`) — U+001F (INFORMATION SEPARATOR
 * ONE), never projected as its own column; `sync.conflicts-open` splits it
 * into `?class`/`?object` via `STRBEFORE`/`STRAFTER` on that exact byte so a
 * reader never has to parse the composite. `?item` stays a URI (row
 * activation requires it, `sparql-table-view-element.ts:206-207`).
 */
// Type-only: a VALUE import of `@shrubbery/runtime/layout` pulls in the
// whole faces barrel — every `@customElement`-decorated view element,
// which calls `customElements.define` at MODULE LOAD TIME and crashes
// outside a DOM (verified: a Node-only script that imported this file
// transitively via a value import died with "Unsupported decorator
// location: field" from `stat-scalar-view-element.ts`). This file is
// PURE DATA, consumed from both browser (`shell-named-query-registry.ts`)
// and Node-only real-cell scripts (`contested-surface-gardend.mts`) — it
// must stay import-safe in both.
import type { NamedQueryDefinition } from '@shrubbery/runtime/layout'

/**
 * U+001F (INFORMATION SEPARATOR ONE) — Garden's own field separator inside a
 * folded `objectKey` composite (`object_key()`, `source_sync.rs:758-760`).
 * Built via `String.fromCharCode`, deliberately, rather than a literal
 * control byte sitting invisibly in this source file.
 */
const OBJECT_KEY_SEPARATOR = String.fromCharCode(0x1f)

export const SYNC_QUERY = {
  conflictsOpen: 'urn:sophia:query:sync.conflicts-open',
  conflictCandidates: 'urn:sophia:query:sync.conflict-candidates',
} as const

export const SOURCE_SYNC_NAMED_QUERIES: readonly NamedQueryDefinition[] = [
  {
    name: SYNC_QUERY.conflictsOpen,
    description:
      'One row per contested object in this graph’s local mirror — a FILTER over objects wearing the contested stance, not a place.',
    text: `PREFIX sync: <http://mnemosyne.dev/sync#>
SELECT ?object ?class ?proposals ?strategy ?observedBase ?item
WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:sync-conflicts> {
    ?item a sync:SyncConflict ;
          sync:objectKey ?objectKey ;
          sync:baseVersion ?observedBase ;
          sync:reconciliationStrategy ?strategy ;
          sync:candidateCount ?proposals .
  }
  BIND(STRBEFORE(STRAFTER(?objectKey, "${OBJECT_KEY_SEPARATOR}"), "${OBJECT_KEY_SEPARATOR}") AS ?class)
  BIND(STRAFTER(STRAFTER(?objectKey, "${OBJECT_KEY_SEPARATOR}"), "${OBJECT_KEY_SEPARATOR}") AS ?object)
}
ORDER BY ?object`,
  },
  {
    name: SYNC_QUERY.conflictCandidates,
    description:
      'Every proposal on one contested object, post-Ask-A — writer and order are optional (a pre-Ask-A cell omits them, never fabricates them).',
    text: `PREFIX sync: <http://mnemosyne.dev/sync#>
SELECT ?proposal ?writer ?order ?version ?operation ?item
WHERE {
  GRAPH <urn:mnemosyne:local:graph:{{graphId}}:projection:sync-conflicts> {
    ?proposal a sync:SyncConflictCandidate ;
              sync:conflict ?item ;
              sync:candidateOperationId ?operation ;
              sync:candidateVersion ?version .
    OPTIONAL { ?proposal sync:candidateClientId ?writer }
    OPTIONAL { ?proposal sync:candidateCausalOrder ?order }
  }
}
ORDER BY ?order ?version`,
  },
]
