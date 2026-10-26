/**
 * A hosted graph is identified by its owner AND its id: ids are unique only per owner, so the account's own
 * `onboarding` and an `onboarding` someone shares with it are two graphs.
 *
 * The wire already carries both (`/o/{owner}/g/{graphId}`, and the real id in paths and tool arguments), and it
 * keeps doing so: nothing here is ever sent to a gateway or a cell. What this module decides is the one LOCAL key
 * every app-side structure files a graph under (offline mirrors, document caches, recency, selection):
 *
 * - the account's own graphs keep their bare id, byte for byte, so existing offline copies, pending edits and links
 *   survive untouched;
 * - another owner's graph is qualified with that owner, so it can never be read or written as the account's own
 *   same-id graph. Local state an older client filed for such a graph under the bare id is therefore never reused:
 *   it may belong to the account's own graph of that id.
 */

/** Joins a graph id and another account's owner principal in a local key. No graph id or principal contains it. */
export const GRAPH_KEY_OWNER_SEPARATOR = '\u001f'

export interface GraphRef {
  /** The owner principal (`user:<sub>`); null when the graph is the account's own or the host has no owners. */
  readonly owner: string | null
  readonly graphId: string
}

/** `user:<sub>` for a bare subject or a typed principal; empty for an empty value. */
export function ownerPrincipal(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  return trimmed.startsWith('user:') ? trimmed : `user:${trimmed}`
}

/** True when `owner` is absent or is the signed-in account (`me`, a subject or a principal). */
export function isOwnGraphOwner(owner: string | null | undefined, me: string | null | undefined): boolean {
  const principal = ownerPrincipal(owner)
  return !principal || principal === ownerPrincipal(me)
}

/** The owner a ref should carry: null for the account's own graph, else the owner's principal. */
export function graphRefOwner(owner: string | null | undefined, me: string | null | undefined): string | null {
  return isOwnGraphOwner(owner, me) ? null : ownerPrincipal(owner)
}

/** The suffix that turns a bare id into another owner's local key ('' for the account's own graphs). */
export function graphKeySuffix(owner: string | null | undefined, me: string | null | undefined): string {
  return isOwnGraphOwner(owner, me) ? '' : `${GRAPH_KEY_OWNER_SEPARATOR}${ownerPrincipal(owner)}`
}

/** The one local identity of a graph (see the module comment). Never put on the wire. */
export function localGraphKey(ref: GraphRef, me: string | null | undefined): string {
  const graphId = ref.graphId.trim()
  if (!graphId) throw new Error('A graph key requires a graph id')
  return `${graphId}${graphKeySuffix(ref.owner, me)}`
}

/**
 * Read a local key back. A bare key is the account's own graph (`owner: null`); a qualified one names its owner.
 * Used where a key travels through a host's own state (a picker value, a stored selection) and must become a ref.
 */
export function parseLocalGraphKey(key: string): GraphRef {
  const index = key.indexOf(GRAPH_KEY_OWNER_SEPARATOR)
  if (index < 0) return { owner: null, graphId: key }
  return { graphId: key.slice(0, index), owner: key.slice(index + GRAPH_KEY_OWNER_SEPARATOR.length) || null }
}
