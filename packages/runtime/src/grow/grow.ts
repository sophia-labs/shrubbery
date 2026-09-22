/**
 * grow.ts — the host-side, reusable GROW cycle (RUNG G1).
 *
 * grow(port, graphId, verbSpec) is the one canonical path that turns a STRUCTURAL
 * VERB into an additive, gate-checked write to a cell's :ux:config named graph:
 *
 *   READ      port.readConfig(graphId)            — the PRODUCTION read path
 *             (loadConfigFromCell: rdf_dump → parseNT → parseTriplesToConfig).
 *   CATALOG   applyVerb(config, verbSpec)         — layer 2: rejects any component
 *             ∉ KNOWN_COMPONENTS BEFORE building the candidate (no leak).
 *   SPINE     validateConfig(candidate)           — layer 3 HARD GATE: on !ok we
 *             return { ok:false } and NEVER write a broken spine. Validate BEFORE
 *             serialize/write.
 *   DELTA     serializeConfigToTriples + the additive-superset guard — compute the
 *             strict-superset N-Triples delta; THROW if any read-config triple
 *             would be lost (the additive guard: rdf_load cannot delete).
 *   WRITE     port.loadDelta(graphId, nt, uxConfigGraphIri) — rdf_load in the
 *             ADMITTED LITERAL-GRAPH form (layer 4, the cell authority gate, then
 *             vets reserved / :projection: / variable-GRAPH writes).
 *   RE-READ   port.readConfig(graphId)            — the now-grown config, returned.
 *
 * The choreograph C4 tool is meant to be a THIN WRAPPER over this identical
 * grow() — the catalog + spine + additive gates live HERE, once.
 *
 * ISLAND NOTE: this lives in the QUARANTINED src/grow/ subdir (like src/collab/),
 * NOT a top-level src/*.ts file, so the runtime island scan does not see it. It
 * imports ONLY @shrubbery/nucleus + an injected port — no contract concrete, no
 * yjs, no socket. The shell (apps/*) provides the port over the transport it holds.
 *
 * v1 SCOPE: ADDITIVE grows only (the VerbSpec union is additive-only). Mutating-
 * existing grows (resize/relocate via literal-GRAPH DELETE/INSERT) are a labeled
 * follow-on.
 */

import {
  applyVerb,
  validateConfig,
  serializeConfigToTriples,
  triplesToNT,
  uxConfigGraphIri,
  type VerbSpec,
  type WorkspaceConfig,
  type Triple,
} from '@shrubbery/nucleus'

/**
 * The narrow cell port grow() needs — the two real cell operations, injected by
 * the shell so this module stays an island (no contract concrete here).
 */
export interface GrowCell {
  /** Read + parse the cell's :ux:config to a WorkspaceConfig (production path). */
  readConfig(graphId: string): Promise<WorkspaceConfig>
  /**
   * rdf_load the N-Triples delta into the literal :ux:config target graph
   * (additive — the cell never clears the target). The shell wires this to
   * contract.mcp.toolsCall('rdf_load', { graphId, data, format, targetGraphIri }).
   */
  loadDelta(graphId: string, nt: string, targetGraphIri: string): Promise<void>
}

/** The settled result of one grow cycle. */
export type GrowResult =
  | {
      readonly ok: true
      /** The re-read, now-grown config. */
      readonly config: WorkspaceConfig
      /** The N-Triples delta that was written (the additive append). */
      readonly delta: string
    }
  | {
      readonly ok: false
      /** Which gate rejected: 'catalog' (applyVerb) or 'spine' (validateConfig). */
      readonly gate: 'catalog' | 'spine'
      /** The verbatim rejection reason. */
      readonly error: string
    }

/** Canonical N-Triples line of one triple (set-membership key). */
const lineOf = (t: Triple): string => triplesToNT([t])

/**
 * Compute the ADDITIVE strict-superset delta between the read config and the
 * candidate. THROWS if the candidate would lose any read-config triple (the grow
 * is not additive — rdf_load cannot delete). Returns the N-Triples to append.
 */
function additiveDelta(read: WorkspaceConfig, candidate: WorkspaceConfig): string {
  const readTriples = serializeConfigToTriples(read)
  const candidateTriples = serializeConfigToTriples(candidate)
  const readLines = new Set(readTriples.map(lineOf))
  const candidateLines = new Set(candidateTriples.map(lineOf))
  for (const line of readLines) {
    if (!candidateLines.has(line)) {
      throw new Error(`grow is not additive — read-config triple would be lost:\n${line}`)
    }
  }
  const delta = candidateTriples.filter((t) => !readLines.has(lineOf(t)))
  return triplesToNT(delta)
}

/**
 * Run one grow cycle. See the module doc for the gate order.
 *
 * NOTHING is written unless BOTH gates pass: a catalog rejection (off-allowlist
 * component) or a spine rejection (broken invariant, e.g. a 2nd resizable root)
 * returns { ok:false } and leaves the cell's :ux:config untouched. The additive
 * guard (which would THROW for a non-additive candidate) runs AFTER both gates,
 * so a rejected verb never reaches it.
 */
export async function grow(
  port: GrowCell,
  graphId: string,
  verbSpec: VerbSpec,
): Promise<GrowResult> {
  // READ — the production read path.
  const read = await port.readConfig(graphId)

  // CATALOG — applyVerb (layer 2). Rejects off-allowlist components pre-build.
  const applied = applyVerb(read, verbSpec)
  if (!applied.ok) {
    return { ok: false, gate: 'catalog', error: applied.error }
  }

  // SPINE — validateConfig (layer 3 HARD GATE) BEFORE any serialize/write.
  const verdict = validateConfig(applied.config)
  if (!verdict.ok) {
    return { ok: false, gate: 'spine', error: verdict.error }
  }

  // DELTA — additive strict-superset guard (THROWS on loss).
  const delta = additiveDelta(read, applied.config)

  // IDEMPOTENT NO-OP — an empty delta means the verb changed nothing (e.g. re-rooting
  // an already-rooted region). Skip the rdf_load (an empty load is pointless) and
  // return ok with the unchanged config; callers narrate "already there".
  if (delta.trim().length === 0) {
    return { ok: true, config: read, delta }
  }

  // WRITE — rdf_load in the admitted literal-graph form (layer 4 gate is the cell's).
  await port.loadDelta(graphId, delta, uxConfigGraphIri(graphId))

  // RE-READ — the now-grown config.
  const config = await port.readConfig(graphId)
  return { ok: true, config, delta }
}
