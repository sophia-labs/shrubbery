/**
 * `mnemosyne://` links on a board: build, parse, and tell a target from a web address. FINAL (no unit edits this
 * file); the Rust twin is gardend `whiteboard/links.rs`. The format:
 *
 *  - `mnemosyne://document/<graph>/<documentId>`
 *  - `mnemosyne://object/<graph>/<urlencoded object IRI>`
 *  - `mnemosyne://artifact/<graph>/<artifactId>`
 *
 * Each segment goes through `encodeURIComponent`, so a segment never contains `/`. Gardend encodes everything but
 * `A-Za-z0-9-_.!~*'()`, which is the same set `encodeURIComponent` leaves alone.
 */
import type { WbMnemosyneRecord, WbTarget } from './semantic-types.js'

export type WbLinkTarget =
  | { readonly kind: 'document'; readonly graphId: string; readonly documentId: string }
  | { readonly kind: 'object'; readonly graphId: string; readonly iri: string }
  | { readonly kind: 'artifact'; readonly graphId: string; readonly artifactId: string }

export function documentLink(graphId: string, documentId: string): string {
  return `mnemosyne://document/${encodeURIComponent(graphId)}/${encodeURIComponent(documentId)}`
}

export function objectLink(graphId: string, iri: string): string {
  return `mnemosyne://object/${encodeURIComponent(graphId)}/${encodeURIComponent(iri)}`
}

export function artifactLink(graphId: string, artifactId: string): string {
  return `mnemosyne://artifact/${encodeURIComponent(graphId)}/${encodeURIComponent(artifactId)}`
}

/** The link for a picked target. */
export function linkOfTarget(target: WbTarget): string {
  return target.kind === 'document' ? documentLink(target.graphId, target.documentId) : objectLink(target.graphId, target.iri)
}

/** The `customData.mnemosyne` snapshot for a picked target. */
export function recordOfTarget(target: WbTarget): WbMnemosyneRecord {
  return target.kind === 'document'
    ? { kind: 'document', graphId: target.graphId, id: target.documentId, title: target.title }
    : { kind: 'object', graphId: target.graphId, iri: target.iri, label: target.label, classLabel: target.classLabel }
}

/** True for any `mnemosyne://` link, well-formed or not. `validateEmbeddable` uses this. */
export function isMnemosyneLink(link: unknown): link is string {
  return typeof link === 'string' && link.startsWith('mnemosyne://')
}

/** Parse a link. A web address, a malformed link or an unknown kind is `null`. A `?query` or `#fragment` is ignored. */
export function parseLink(link: unknown): WbLinkTarget | null {
  if (!isMnemosyneLink(link)) return null
  const rest = link.slice('mnemosyne://'.length).split(/[?#]/)[0] ?? ''
  const parts = rest.split('/')
  if (parts.length < 3) return null
  const kind = parts[0]
  let graphId: string
  let tail: string
  try {
    graphId = decodeURIComponent(parts[1] ?? '')
    tail = decodeURIComponent(parts.slice(2).join('/'))
  } catch {
    return null
  }
  if (!graphId || !tail) return null
  if (kind === 'document') return { kind: 'document', graphId, documentId: tail }
  if (kind === 'object') return { kind: 'object', graphId, iri: tail }
  if (kind === 'artifact') return { kind: 'artifact', graphId, artifactId: tail }
  return null
}

/** Read `customData.mnemosyne` off an element; `null` when absent or malformed. */
export function recordOfElement(element: { readonly customData?: Record<string, unknown> }): WbMnemosyneRecord | null {
  const raw = element.customData?.mnemosyne as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  if (raw.kind === 'document' && text('id')) return { kind: 'document', graphId: text('graphId'), id: text('id'), title: text('title') }
  if (raw.kind === 'object' && text('iri')) {
    return { kind: 'object', graphId: text('graphId'), iri: text('iri'), label: text('label'), classLabel: text('classLabel') }
  }
  return null
}

/** The target an element's `link` and snapshot describe, or `null` (no link, a web address, an artifact). */
export function targetOfElement(element: { readonly link?: unknown; readonly customData?: Record<string, unknown> }): WbTarget | null {
  const parsed = parseLink(element.link)
  if (!parsed || parsed.kind === 'artifact') return null
  const record = recordOfElement(element)
  if (parsed.kind === 'document') {
    return { kind: 'document', graphId: parsed.graphId, documentId: parsed.documentId, title: record?.kind === 'document' ? record.title : parsed.documentId }
  }
  return {
    kind: 'object',
    graphId: parsed.graphId,
    iri: parsed.iri,
    label: record?.kind === 'object' ? record.label : parsed.iri,
    classLabel: record?.kind === 'object' ? record.classLabel : '',
  }
}
