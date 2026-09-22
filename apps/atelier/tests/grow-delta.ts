/**
 * grow-delta.ts — compute the ADDITIVE N-Triples delta between a seed config and
 * a grown config.
 *
 * The W0 grow gesture is a PURE APPEND to the cell's :ux:config named graph:
 * rdf_load (and the cell's store.load_from_slice) is ADDITIVE — it never clears
 * the target graph. So the grow write body must be exactly the triples that the
 * grown config has and the seed config lacks. By construction the minimal seed and
 * grown configs differ ONLY by region-top-bar's RootEntry (appended at a higher
 * index than region-center's), so this delta is those few triples — no overwrite
 * of any seed triple is required.
 *
 * This helper asserts the delta is a strict SUPERSET append (the grown set fully
 * contains the seed set), throwing if the grow would require deleting/overwriting
 * a seed triple (which rdf_load cannot do). That keeps the W0 write honestly
 * additive.
 *
 * Pure: no DOM, no stores, no network.
 */

import { serializeConfigToTriples, triplesToNT, type Triple, type WorkspaceConfig } from '@shrubbery/nucleus'

/** Canonical line form of a triple (the exact N-Triples statement). */
const lineOf = (t: Triple): string => triplesToNT([t])

/**
 * The N-Triples body to rdf_load over the seeded :ux:config to grow `seed` into
 * `grown`. Throws if `grown` does not strictly CONTAIN `seed` (i.e. the grow would
 * need to remove/overwrite a seed triple — which the additive rdf_load cannot do).
 */
export function growDeltaNT(seed: WorkspaceConfig, grown: WorkspaceConfig): string {
  const seedTriples = serializeConfigToTriples(seed)
  const grownTriples = serializeConfigToTriples(grown)

  const seedLines = new Set(seedTriples.map(lineOf))
  const grownLines = new Set(grownTriples.map(lineOf))

  // The grow must be a pure append: every seed triple must still be present in
  // the grown config (rdf_load cannot delete the seed's triples).
  for (const line of seedLines) {
    if (!grownLines.has(line)) {
      throw new Error(`growDeltaNT: grow is not additive — seed triple would be lost:\n${line}`)
    }
  }

  // The delta = the triples present in grown but absent from seed.
  const delta = grownTriples.filter((t) => !seedLines.has(lineOf(t)))
  return triplesToNT(delta)
}
