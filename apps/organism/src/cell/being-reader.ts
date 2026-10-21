/**
 * Who a being is, from the graph (world-UX slice A / typed objects D9): an item names its maker by IRI
 * (`wf:producedBy <urn:sophia:agent:…>`), and nothing writes that agent a label. The run's own graph does know whose
 * post it sat at: `<run#step-n> wf:castAgent <agent> ; wf:step <post>`, the post is `urn:sophia:wf:<document>#<id>`, and
 * the workflow's draft graph labels it. So the name is the post's label, the door is the document and the post's id.
 */

import { postOfStepIri } from '@shrubbery/nucleus/object-faces'
import type { BeingRef } from '@shrubbery/runtime'
import { assertIri, findRows, parseTerm, WF } from './graph-plan.js'

export type BeingQuery = (graphId: string, sparql: string) => Promise<unknown>

/** The post that cast this being in some run of the graph, or null when no run names it. */
export async function readBeingRef(query: BeingQuery, graphId: string, agentIri: string): Promise<BeingRef | null> {
  assertIri(agentIri, 'agent')
  const sparql = `SELECT ?step ?label WHERE { GRAPH ?run { ?sitting <${WF}castAgent> <${agentIri}> ; <${WF}step> ?step } OPTIONAL { GRAPH ?draft { ?step <${WF}label> ?label } } } LIMIT 1`
  for (const row of findRows(await query(graphId, sparql)) ?? []) {
    if (typeof row !== 'object' || row === null) continue
    const { step, label } = row as { step?: unknown; label?: unknown }
    if (typeof step !== 'string') continue
    const stepIri = parseTerm(step).value
    const post = postOfStepIri(stepIri)
    const named = typeof label === 'string' ? parseTerm(label).value : ''
    return { iri: agentIri, name: named || post?.stepId || stepIri, documentId: post?.documentId ?? null, stepId: post?.stepId ?? null }
  }
  return null
}
