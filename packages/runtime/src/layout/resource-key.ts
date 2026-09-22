/**
 * resource-key.ts — collision-safe canonical resource-key encoding
 * (diff-review r2 WRONG: "'one shared ProviderHandle per document key'" —
 * the broker key was not canonical).
 *
 * A resourceKey built by naive colon-joining (e.g.
 * `` `document:${graphId}:${documentId}` ``) is NOT canonical: Phase 1
 * permits arbitrary non-empty identifiers, INCLUDING colons, in
 * graphId/documentId/queryId/etc (nucleus `validate.ts`'s shape check has no
 * delimiter restriction — see `packages/nucleus/src/layout/validate.ts:213`).
 * `(graphId:'a:b', documentId:'c')` and `(graphId:'a', documentId:'b:c')`
 * both then encode to the exact same string `document:a:b:c`. Since
 * `resource-broker.ts` keys its durable-entry map ONLY by this string
 * (`resource-broker.ts`'s `durableEntries: Map<ResourceKey, DurableEntry>`),
 * two genuinely distinct documents could silently share one provider.
 *
 * `JSON.stringify` of a tagged tuple is collision-safe for arbitrary string
 * parts: JSON escapes every embedded `"`/`\` and the array/string delimiters
 * are themselves part of the encoding, so two DIFFERENT part sequences can
 * never serialize to the same string — the property a naive delimiter-joined
 * template literal lacks. `undefined` parts (e.g. `sparql.bindings-table`'s
 * optional `revision`) are normalized to `null` so a present-but-empty part
 * and an absent part are still distinguishable from each other AND from any
 * real value (JSON has no `undefined`, so leaving it as-is would silently
 * drop the array slot instead of encoding its absence).
 */
export function resourceKeyTuple(tag: string, ...parts: ReadonlyArray<string | undefined>): string {
  return JSON.stringify([tag, ...parts.map((part) => part ?? null)])
}
