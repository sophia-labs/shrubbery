/**
 * despacho-query-catalog.ts — el Despacho's named queries (W1,
 * plans/2026-09-15-despacho-design.md §7): the focus-driven surface's
 * collection shapes, registered into the ONE shell registry beside the
 * Observatory's and source-sync's, under the disjoint `cuenta.*` prefix.
 *
 * Every query here carries `{{focus}}` — the bead under the cursor — which
 * the runtime's named-query resolver splices through its embeddability gate
 * (`substituteFocus`) after the shell's focus binding stamped the session's
 * focus onto the locator. The `card.cuenta` face's OWN three shapes (the
 * bead's properties, edges, accounts) are not here: they are fixed per
 * subject and live with the face (`cuenta-reading.ts`).
 */
import type { NamedQueryDefinition } from '@shrubbery/runtime/layout'

const CTA = 'http://mnemosyne.dev/cuentas#'
const COR = 'http://sophia.ai/correo#'
const CUENTAS_GRAPH = 'urn:mnemosyne:local:graph:{{graphId}}:projection:cuentas'
const CORREO_GRAPH = 'urn:mnemosyne:local:graph:{{graphId}}:projection:correo'

export const DESPACHO_QUERY = {
  /** Beads that point AT the focus — its parts, what it blocks, what it gates, what it discovered. Binds `?item` per row (the grid contract). */
  children: 'urn:sophia:query:cuenta.children',
  /** The gates still open in the whole graph, oldest first — the room's standing docket. */
  openGates: 'urn:sophia:query:cuenta.open-gates',
  // el Despacho W2: seats and letters of the Demi register (correo v0.1.0).
  /** Letters addressed to the focus seat, newest first. */
  seatInbox: 'urn:sophia:query:seat.inbox',
  /** Runs recorded for the focus seat, newest first. */
  seatRuns: 'urn:sophia:query:seat.runs',
  /** Every letter in the focus letter's conversation, oldest first — the thread. */
  letterThread: 'urn:sophia:query:letter.thread',
  /**
   * What points at the focus, whatever the focus is: beads whose edges name
   * it (gates first, then priority), letters addressed to it (a seat), letters
   * answering it (a letter) — newest letters first. Rendered through
   * `card.focus` in entry mode so one grid may mix kinds.
   */
  related: 'urn:sophia:query:despacho.related',
  // el Despacho W4: the collection shapes of an inbox and of held work,
  // scoped to the focus SEAT. The two rooms themselves (`card.inbox`,
  // `card.my-work`) are NOT focus-driven — an inbox is not a subject in the
  // graph, so whose it is comes from closed params — but a seat's own inbox
  // and work ARE addressable, and these are the grids for them.
  /** Questions and requests to the focus seat that nobody has answered or acknowledged, newest first. */
  inboxUnanswered: 'urn:sophia:query:inbox.unanswered',
  /**
   * Open gates whose `cta:owner` equals the focus seat's `cor:seatId`.
   * EMPTY on sophia-cluster today, and honestly so: cuentas names a holder by
   * office ("vera", "demi") while correo seats carry ids like "chat-archive",
   * so the two registers do not yet meet. The shape is right and lights up the
   * day a holder edge exists; until then a room shows nothing here rather than
   * guessing a match.
   */
  inboxAwaitingWord: 'urn:sophia:query:inbox.awaiting-word',
  /** Beads held by the focus seat — same office join, same honest emptiness — by status then priority. */
  myWorkHeld: 'urn:sophia:query:mywork.held',
  /** Beads waiting on an open gate the focus seat owns — same office join, same honest emptiness. */
  myWorkGatedOn: 'urn:sophia:query:mywork.gated-on',
  // el Despacho W11: the roster pokédex gallery (correo is the canon). Every
  // seat as one ?item per row, by activity: last recorded run first (seats
  // with none last), then letters received, then id. The gallery's tabs are
  // these filters as layout data — no filter param exists in the registry,
  // so each filter is its own named query and its own grid.
  galleryAll: 'urn:sophia:query:gallery.all',
  galleryKeepers: 'urn:sophia:query:gallery.keepers',
  galleryChoreograph: 'urn:sophia:query:gallery.choreograph',
  galleryHouse: 'urn:sophia:query:gallery.house',
  galleryNetwork: 'urn:sophia:query:gallery.network',
  galleryDormant: 'urn:sophia:query:gallery.dormant',
} as const

/** The activity ordering shared by every gallery query: last run (desc, none last), letters in (desc), id. */
function galleryQuery(filter: string): string {
  return (
    `SELECT ?item ?last ?in WHERE { GRAPH <${CORREO_GRAPH}> { ?item <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${COR}Seat> . ${filter} ` +
    `OPTIONAL { SELECT ?item (MAX(?at) AS ?last) WHERE { GRAPH <${CORREO_GRAPH}> { ?r <${COR}seat> ?item ; <${COR}at> ?at } } GROUP BY ?item } ` +
    `OPTIONAL { SELECT ?item (COUNT(?l) AS ?in) WHERE { GRAPH <${CORREO_GRAPH}> { ?l <${COR}to> ?item } } GROUP BY ?item } } } ` +
    `ORDER BY DESC(BOUND(?last)) DESC(?last) DESC(?in) ?item`
  )
}


export const DESPACHO_NAMED_QUERIES: readonly NamedQueryDefinition[] = [
  {
    name: DESPACHO_QUERY.children,
    description: 'Beads whose partOf/needs/gatedBy/discoveredFrom edge points at the focus bead — one ?item IRI per row, gates first, then by priority and id.',
    text:
      `SELECT DISTINCT ?item WHERE { GRAPH <${CUENTAS_GRAPH}> { ` +
      `?item ?edge <{{focus}}> . VALUES ?edge { <${CTA}partOf> <${CTA}needs> <${CTA}gatedBy> <${CTA}discoveredFrom> } ` +
      `?item <${CTA}beadKind> ?kind . OPTIONAL { ?item <${CTA}priority> ?priority } ` +
      `BIND(IF(?kind = "gate", 0, 1) AS ?gateFirst) } } ORDER BY ?gateFirst ?priority ?item`,
  },
  {
    name: DESPACHO_QUERY.openGates,
    description: 'Every gate Cuenta whose status is open — the words still owed — one ?item IRI per row, by priority then id.',
    text:
      `SELECT ?item WHERE { GRAPH <${CUENTAS_GRAPH}> { ` +
      `?item <${CTA}beadKind> "gate" ; <${CTA}status> "open" . OPTIONAL { ?item <${CTA}priority> ?priority } } } ` +
      `ORDER BY ?priority ?item`,
  },
  {
    name: DESPACHO_QUERY.seatInbox,
    description: 'Letters addressed to the focus seat (cor:to), newest first — one ?item IRI per row.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { ?item <${COR}to> <{{focus}}> ; <${COR}at> ?at } } ` +
      `ORDER BY DESC(?at) ?item`,
  },
  {
    name: DESPACHO_QUERY.seatRuns,
    description: 'Runs recorded for the focus seat (cor:seat), newest first — one ?item IRI per row.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { ?item <${COR}seat> <{{focus}}> ; <${COR}at> ?at } } ` +
      `ORDER BY DESC(?at) ?item`,
  },
  {
    name: DESPACHO_QUERY.letterThread,
    description: 'Every letter sharing the focus letter’s conversation, oldest first — the thread, the focus itself included.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { <{{focus}}> <${COR}conversation> ?c . ?item <${COR}conversation> ?c ; <${COR}at> ?at } } ` +
      `ORDER BY ?at ?item`,
  },
  {
    name: DESPACHO_QUERY.related,
    description:
      'What points at the focus, whatever it is: beads whose partOf/needs/gatedBy/discoveredFrom names it (gates first, then priority), then letters addressed to it or answering it, newest first — one ?item IRI per row, mixed kinds.',
    text:
      `SELECT DISTINCT ?item ?rank ?priority ?at WHERE { ` +
      `{ GRAPH <${CUENTAS_GRAPH}> { ?item ?edge <{{focus}}> . VALUES ?edge { <${CTA}partOf> <${CTA}needs> <${CTA}gatedBy> <${CTA}discoveredFrom> } ` +
      `?item <${CTA}beadKind> ?kind . OPTIONAL { ?item <${CTA}priority> ?priority } } BIND(IF(?kind = "gate", 0, 1) AS ?rank) } ` +
      `UNION { GRAPH <${CORREO_GRAPH}> { ?item <${COR}to> <{{focus}}> ; <${COR}at> ?at } BIND(2 AS ?rank) } ` +
      `UNION { GRAPH <${CORREO_GRAPH}> { ?item <${COR}replyTo> <{{focus}}> ; <${COR}at> ?at } BIND(2 AS ?rank) } ` +
      `} ORDER BY ?rank ?priority DESC(?at) ?item`,
  },
  {
    name: DESPACHO_QUERY.inboxUnanswered,
    description:
      'Questions and requests addressed to the focus seat with no reply pointing at them and no acknowledgement — the register’s own two ways of answering — newest first, one ?item IRI per row.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { ` +
      `VALUES ?kind { "question" "request" } ` +
      `?item <${COR}to> <{{focus}}> ; <${COR}letterKind> ?kind ; <${COR}at> ?at . ` +
      `FILTER NOT EXISTS { ?reply <${COR}replyTo> ?item } FILTER NOT EXISTS { ?ack <${COR}acknowledges> ?item } } } ` +
      `ORDER BY DESC(?at) ?item`,
  },
  {
    name: DESPACHO_QUERY.inboxAwaitingWord,
    description:
      'Open gates whose cta:owner equals the focus seat’s cor:seatId — the words that seat still owes. Empty on sophia-cluster today: cuentas names holders by office while correo seats carry roster ids, so the join has nothing to meet; the shape is correct and stays ready for the day a holder edge exists.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { <{{focus}}> <${COR}seatId> ?office } ` +
      `GRAPH <${CUENTAS_GRAPH}> { ?item <${CTA}beadKind> "gate" ; <${CTA}status> "open" ; <${CTA}owner> ?office . ` +
      `OPTIONAL { ?item <${CTA}priority> ?priority } } } ORDER BY ?priority ?item`,
  },
  {
    name: DESPACHO_QUERY.myWorkHeld,
    description:
      'Beads held by the focus seat (cta:owner = cor:seatId), by status then priority. Empty today for the same honest reason as inbox.awaiting-word.',
    text:
      `SELECT ?item WHERE { GRAPH <${CORREO_GRAPH}> { <{{focus}}> <${COR}seatId> ?office } ` +
      `GRAPH <${CUENTAS_GRAPH}> { ?item <${CTA}owner> ?office ; <${CTA}status> ?status . ` +
      `OPTIONAL { ?item <${CTA}priority> ?priority } } } ORDER BY ?status ?priority ?item`,
  },
  {
    name: DESPACHO_QUERY.myWorkGatedOn,
    description:
      'Beads waiting on an open gate the focus seat owns — what this seat’s silence is holding up. Empty today for the same honest reason as inbox.awaiting-word.',
    text:
      `SELECT DISTINCT ?item WHERE { GRAPH <${CORREO_GRAPH}> { <{{focus}}> <${COR}seatId> ?office } ` +
      `GRAPH <${CUENTAS_GRAPH}> { ?gate <${CTA}beadKind> "gate" ; <${CTA}status> "open" ; <${CTA}owner> ?office . ` +
      `?item <${CTA}gatedBy> ?gate } } ORDER BY ?item`,
  },
  {
    name: DESPACHO_QUERY.galleryAll,
    description: 'Every seat of the correo canon — one ?item IRI per row, by activity (last run first, then letters received).',
    text: galleryQuery(''),
  },
  {
    name: DESPACHO_QUERY.galleryKeepers,
    description: 'The keepers (facilities folded from the swarm graph) — one ?item per row, by activity.',
    text: galleryQuery(`?item <${COR}seatKind> "keeper" .`),
  },
  {
    name: DESPACHO_QUERY.galleryChoreograph,
    description: 'The choreograph agents, active and retired — one ?item per row, by activity.',
    text: galleryQuery(`?item <${COR}seatKind> "choreograph-agent" .`),
  },
  {
    name: DESPACHO_QUERY.galleryHouse,
    description: 'The house seats of the Sirin move — one ?item per row, by activity.',
    text: galleryQuery(`?item <${COR}seatKind> "house-seat" .`),
  },
  {
    name: DESPACHO_QUERY.galleryNetwork,
    description: 'The Demi network seats (demanation, cross-repo, repo, system) — one ?item per row, by activity.',
    text: galleryQuery(`?item <${COR}seatKind> ?kind . VALUES ?kind { "demanation" "cross-repo" "repo" "system" "unrostered" }`),
  },
  {
    name: DESPACHO_QUERY.galleryDormant,
    description: 'Seats whose source says dormant or retired — one ?item per row, by activity.',
    text: galleryQuery(`?item <${COR}status> ?status . VALUES ?status { "dormant" "retired" }`),
  },
]
