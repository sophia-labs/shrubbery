/**
 * grow-cell.ts — the reusable recipe for building a GrowCell port over a cell's
 * MCP transport. Lifted out of the atelier shell (where it was app-local) so every
 * shell — atelier, rhizome, organism, and the choreograph C4 tool wrapper — shares
 * ONE port factory instead of re-deriving the rdf_load arg shape.
 *
 * The two cell operations stay INJECTED (the shell holds the concrete contract /
 * transport); this module only names the GrowCell shape and encodes the genuinely
 * copy-paste-prone bit: the exact rdf_load tool-call arg recipe. It imports nothing
 * backend (island-safe, like grow.ts).
 */

import type { WorkspaceConfig } from '@shrubbery/nucleus'
import type { GrowCell } from './grow.js'

/**
 * The exact `rdf_load` tool-call arg shape for an additive :ux:config delta load
 * (the copy-paste-prone bit — graphId / data / format / targetGraphIri, camelCase,
 * matching spawn-gardend.ts + the grow-cycle integration test).
 */
export function rdfLoadArgs(
  graphId: string,
  nt: string,
  targetGraphIri: string,
): { graphId: string; data: string; format: 'application/n-triples'; targetGraphIri: string } {
  return { graphId, data: nt, format: 'application/n-triples', targetGraphIri }
}

/** Assemble a GrowCell from the two injected cell operations (the shell wires these
 * to its real contract: readConfig over the production read path, loadDelta over
 * `contract.mcp.toolsCall('rdf_load', rdfLoadArgs(...))`). */
export function makeGrowCell(ops: {
  readConfig: (graphId: string) => Promise<WorkspaceConfig>
  loadDelta: (graphId: string, nt: string, targetGraphIri: string) => Promise<void>
}): GrowCell {
  return { readConfig: ops.readConfig, loadDelta: ops.loadDelta }
}
