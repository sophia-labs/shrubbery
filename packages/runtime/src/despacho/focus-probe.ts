/**
 * focus-probe.ts — what IS the thing under the cursor? (el Despacho W2.)
 *
 * A focus-driven room has one cursor and several kinds of thing it can rest
 * on: a bead (`cta:Cuenta`), a seat (`cor:Seat`), a letter (`cor:Letter`).
 * The `card.focus` face asks this one question first — one `rdf:type` read
 * over every named graph — and then renders the subject AS WHAT IT IS through
 * the matching face. Pure: the query text and the classification of its rows.
 * Precedence is a bead, then a seat, then a letter; a subject that is none of
 * these classifies as `unknown` with the types it does carry, so the view can
 * say honestly what it found rather than paint a blank.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { CTA_NS } from './cuenta-reading.js'
import { COR_NS } from './seat-reading.js'

export type FocusKind = 'cuenta' | 'seat' | 'letter' | 'unknown'

export interface FocusProbe {
  readonly subject: string
  readonly kind: FocusKind
  /** Every `rdf:type` the subject carries, in row order — for the honest `unknown` message and for tests. */
  readonly types: readonly string[]
}

export const FOCUS_PROBE_MAX_ROWS = 20

export function focusTypesQuery(subject: string): string {
  return `SELECT DISTINCT ?t WHERE { GRAPH ?g { <${subject}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?t } } LIMIT ${FOCUS_PROBE_MAX_ROWS}`
}

/** Pure — classify the type rows. */
export function classifyFocus(subject: string, result: QueryBlockResult): FocusProbe {
  const types: string[] = []
  if (result.resultKind === 'bindings') {
    for (const row of result.rows) {
      const t = plainQueryBlockTermValue(row.t)
      if (t && !types.includes(t)) types.push(t)
    }
  }
  const kind: FocusKind = types.includes(`${CTA_NS}Cuenta`)
    ? 'cuenta'
    : types.includes(`${COR_NS}Seat`)
      ? 'seat'
      : types.includes(`${COR_NS}Letter`)
        ? 'letter'
        : 'unknown'
  return { subject, kind, types }
}
