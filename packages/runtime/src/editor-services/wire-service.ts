/**
 * wire-service.ts — WireService: the host-side seam that creates/deletes the wire backing
 * a wikilink (the relationship a `[[link]]` records in the graph).
 *
 * Garden created the wire via a REST `POST /wires/{g}/document/{doc}` endpoint
 * (wire-store.ts::createWikiLinkWire) and deleted via `wireStore.deleteWire`.
 *
 * RUNG L2c RESEAT (the cell-faithful write path): create/delete now go through the
 * contract's WireWriter seam — NOT raw projection SPARQL. THE OLD DOOR WAS WRONG: a
 * wire's triples live in the read-only :projection:workspace graph, which the cell
 * MATERIALIZES from its workspace CRDT plane; a raw sparql_update targeting any
 * :projection:* graph is REJECTED by the cell's authority gate (garden
 * rdf_authority.rs:61-73 — "SPARQL update targets a reserved local RDF authority
 * graph"). The L2a oxigraph harness only accepted the raw INSERT/DELETE because it
 * has NO authority gate. So this service is reseated onto contract.wire.{create,delete},
 * whose concrete (the gardend shell) enqueues a workspace.createWire / deleteWire op
 * via the create_wires / delete{type:'wires'} MCP tools — exactly what a real cell
 * accepts. The graphId comes from getScope().graphId AT CALL TIME (stateless over
 * (wire, getScope)).
 *
 * wireId is MINTED host-side (garden minted it server-side; here the host owns it so the
 * created wire and the inserted WikiLink node carry the SAME id — the cell honors the
 * caller-supplied wire_id). FIRE-AND-INSERT: create() issues the op and returns the id;
 * it NEVER calls setEditable(false) / enters a "wire mode" (garden's createWikiLinkWire
 * path deliberately avoided that — it kills the TipTap suggestion plugin state mid-flow).
 *
 * THE RETIRED RAW-SPARQL BUILDERS (wireInsertSparql / wireDeleteSparql) are KEPT, EXPORTED,
 * relabeled as the NEGATIVE-PROOF artifacts: they emit byte-for-byte the GRAPH
 * <…:projection:workspace> INSERT/DELETE form the cell's authority gate rejects. The test
 * pins that emit as the executable proof the old door is wrong (the one piece of the
 * write story that IS executable on this branch) — they are NOT on the live write path.
 *
 * ISLAND NOTE: editor-services/ subdir — outside the non-recursive island scan.
 */

import type { EditorScope, WireWriter } from '@shrubbery/nucleus'
import {
  WIRE_NS,
  XSD_NS,
  RDF_TYPE,
  blockRefUri,
  documentRefUri,
  wirePredicateUri,
  wireRefUri,
  workspaceProjectionGraphIri,
} from './sparql-terms.js'

/** The default wikilink predicate — garden used 'relatedTo' (wire-store DEFAULT_PREDICATE). */
export const DEFAULT_WIKILINK_PREDICATE = 'relatedTo'

/** create() params — mirrors garden's WikiLinkWireParams (minus server-minted id). */
export interface WireCreateParams {
  /** Source document id (the doc the wikilink lives in). */
  readonly sourceDocumentId: string
  /** Source block id (the block containing the wikilink), if known. */
  readonly sourceBlockId?: string
  /** Target document id (the linked doc). */
  readonly targetDocumentId: string
  /** Target graph id, for cross-graph wires. Defaults to the open graph. */
  readonly targetGraphId?: string
  /** Target block id (for block-level links), if any. */
  readonly targetBlockId?: string
  /** Predicate — bare name (→ WIRE_NS) or absolute IRI. Default 'relatedTo'. */
  readonly predicate?: string
  /** Whether the created wire should be materialized as bidirectional. */
  readonly bidirectional?: boolean
}

/** The host-side seam: create/delete the wire backing a wikilink. */
export interface WireService {
  /** Create a wikilink wire; returns the host-minted wireId. */
  create(params: WireCreateParams): Promise<{ wireId: string }>
  /** Delete a wire by id (wikilink-node deletion cleanup). */
  delete(wireId: string): Promise<void>
}

/** A `<iri>` term. */
function iri(value: string): string {
  return `<${value}>`
}

/**
 * NEGATIVE-PROOF ARTIFACT (NOT on the live write path). Build the GRAPH-scoped INSERT
 * DATA for a wikilink wire wrapped in GRAPH <…:projection:workspace> — byte-for-byte the
 * form garden's authority gate REJECTS (rdf_authority.rs:61-73). The reseat test pins this
 * emit as the executable proof the old projection-SPARQL door is wrong; the live path uses
 * the WireWriter seam (workspace-CRDT-materialized).
 */
export function wireInsertSparql(graphId: string, wireId: string, params: WireCreateParams): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const subject = wireRefUri(graphId, wireId)
  const predicate = params.predicate ?? DEFAULT_WIKILINK_PREDICATE
  const lines: string[] = [
    `${iri(subject)} ${iri(RDF_TYPE)} ${iri(`${WIRE_NS}Wire`)} .`,
    `${iri(subject)} ${iri(`${WIRE_NS}sourceDocument`)} ${iri(documentRefUri(params.sourceDocumentId))} .`,
    `${iri(subject)} ${iri(`${WIRE_NS}targetDocument`)} ${iri(documentRefUri(params.targetDocumentId))} .`,
  ]
  if (params.sourceBlockId) {
    lines.push(
      `${iri(subject)} ${iri(`${WIRE_NS}sourceBlock`)} ${iri(blockRefUri(params.sourceDocumentId, params.sourceBlockId))} .`,
    )
  }
  if (params.targetBlockId) {
    lines.push(
      `${iri(subject)} ${iri(`${WIRE_NS}targetBlock`)} ${iri(blockRefUri(params.targetDocumentId, params.targetBlockId))} .`,
    )
  }
  lines.push(
    `${iri(subject)} ${iri(`${WIRE_NS}predicate`)} ${iri(wirePredicateUri(predicate))} .`,
    `${iri(subject)} ${iri(`${WIRE_NS}bidirectional`)} "${String(params.bidirectional ?? false)}"^^${iri(`${XSD_NS}boolean`)} .`,
  )
  return `INSERT DATA { GRAPH <${ws}> {\n${lines.map((l) => '  ' + l).join('\n')}\n} }`
}

/**
 * NEGATIVE-PROOF ARTIFACT (NOT on the live write path). Build the GRAPH-scoped DELETE for a
 * wire by id, wrapped in GRAPH <…:projection:workspace> — the same projection-graph write
 * the authority gate rejects. Kept only as the executable witness of the wrong door; the
 * live delete uses the WireWriter seam.
 */
export function wireDeleteSparql(graphId: string, wireId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const subject = wireRefUri(graphId, wireId)
  return `DELETE WHERE { GRAPH <${ws}> { ${iri(subject)} ?p ?o } }`
}

/**
 * Mint a host-side wireId. Stable, collision-resistant, and shaped so wire_ref_uri wraps
 * it (a bare id, NOT an already-URN'd one). Uses crypto.randomUUID when available.
 */
export function mintWireId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `wire-${uuid}`
}

/**
 * Build the WireService over the contract's WireWriter seam and a scope getter. STATELESS
 * over (wire, getScope): reads getScope().graphId AT CALL TIME.
 *
 *   - create(): mint a wireId host-side, call wire.create (cell-faithful: a
 *     workspace.createWire CRDT op via create_wires, the cell materializing the
 *     :projection:workspace triples), return the host-minted id;
 *   - delete(): call wire.delete (workspace.deleteWire via delete{type:'wires'}).
 *
 * The predicate defaults to DEFAULT_WIKILINK_PREDICATE so the materialized wire matches
 * the legacy projection shape (the cell's own create_wires default is 'isWiredTo'; we pass
 * the wikilink predicate explicitly). bidirectional stays false for wikilinks unless an
 * advanced wire flow opts in. The cell honors the caller-minted wire_id so the WikiLink
 * node + wire share it.
 *
 * Home scope (no graphId) ⇒ throw: a wire has no graph to live in. (The picker is gated on
 * an open document upstream, so this is a programmer-error guard, not a user path.)
 */
export function makeWireService(wire: WireWriter, getScope: () => EditorScope): WireService {
  function requireGraphId(): string {
    const graphId = getScope().graphId
    if (!graphId) throw new Error('WireService: no open graph in scope (home/idle)')
    return graphId
  }
  return {
    async create(params: WireCreateParams): Promise<{ wireId: string }> {
      const graphId = requireGraphId()
      const wireId = mintWireId()
      await wire.create(graphId, {
        sourceDocumentId: params.sourceDocumentId,
        targetDocumentId: params.targetDocumentId,
        targetGraphId: params.targetGraphId,
        sourceBlockId: params.sourceBlockId,
        targetBlockId: params.targetBlockId,
        predicate: params.predicate ?? DEFAULT_WIKILINK_PREDICATE,
        bidirectional: params.bidirectional ?? false,
        wireId,
      })
      return { wireId }
    },
    async delete(wireId: string): Promise<void> {
      const graphId = requireGraphId()
      await wire.delete(graphId, wireId)
    },
  }
}
