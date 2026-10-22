/**
 * Whiteboard navigation: where a link, a wire end, a graph node or a backlink row goes (S1, whiteboard semantics).
 *
 * Pure routing. The shell (`main.ts`) does the opening; this file decides what is opened. The rule that matters:
 * a board is never opened in the text editor, whichever door it came through.
 */
import { parseLink, type ObjectUsage, type WbBacklink } from '@shrubbery/runtime'

/** Where a board link goes. `none` is a link that names nothing (empty, or a `mnemosyne://` link that does not parse). */
export type WhiteboardLinkRoute =
  | { readonly kind: 'document'; readonly graphId: string; readonly documentId: string }
  | { readonly kind: 'object'; readonly graphId: string; readonly iri: string }
  | { readonly kind: 'artifact'; readonly graphId: string; readonly artifactId: string }
  | { readonly kind: 'web'; readonly href: string }
  | { readonly kind: 'none' }

/** Schemes the browser owns: a link with one of these is left to the canvas, never opened as a typed object. */
const BROWSER_SCHEME = /^(https?|mailto|tel|sms|ftp):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Route a shape's link. `mnemosyne://document|object|artifact` parse through `parseLink`; a web address is the
 * canvas's own; any other IRI (a bare `urn:` object link from before `mnemosyne://` links) is an object of this graph.
 */
export function routeWhiteboardLink(graphId: string, link: string): WhiteboardLinkRoute {
  const text = typeof link === 'string' ? link.trim() : ''
  if (!text) return { kind: 'none' }
  if (text.startsWith('mnemosyne://')) {
    const parsed = parseLink(text)
    return parsed ?? { kind: 'none' }
  }
  if (BROWSER_SCHEME.test(text)) return { kind: 'web', href: text }
  if (ANY_SCHEME.test(text)) return { kind: 'object', graphId, iri: text }
  return { kind: 'web', href: text }
}

/** The surface a document opens on. */
export type DocumentSurface = 'board' | 'editor'

/** `whiteboard` opens the board, never the text editor; everything else opens as before. */
export function surfaceForDocumentKind(documentKind: string | null | undefined): DocumentSurface {
  return documentKind === 'whiteboard' ? 'board' : 'editor'
}

/** Where a backlink row opens: its source document (a board opens as a board), at the block when it names one. */
export interface BacklinkOpening {
  readonly documentId: string
  readonly blockId: string | null
  readonly surface: DocumentSurface
}

export function openingOfBacklink(row: WbBacklink, kindOf?: (documentId: string) => string | null | undefined): BacklinkOpening {
  const kind = row.sourceKind ?? kindOf?.(row.sourceDocumentId) ?? null
  const surface = surfaceForDocumentKind(kind)
  // A board has no text blocks to focus: its shape ids are not editor blocks.
  return { documentId: row.sourceDocumentId, blockId: surface === 'board' ? null : row.sourceBlockId ?? null, surface }
}

const BOARD_KINDS: ReadonlySet<string> = new Set(['board-link', 'board-card', 'board-connection'])

/** A board's row is one drawn on a board. */
export function isBoardBacklink(row: WbBacklink): boolean {
  return BOARD_KINDS.has(row.kind)
}

/**
 * The object page's "Used in": the documents that embed it (as read already), then the boards that link to it or hold
 * it as a card or connection, and the documents wired to it. One entry per document; the first (a document's own
 * block) wins.
 */
export function usedInWithBoards(
  usages: readonly ObjectUsage[],
  backlinks: readonly WbBacklink[],
  titleOf: (documentId: string) => string | null | undefined,
): ObjectUsage[] {
  const out: ObjectUsage[] = [...usages]
  const seen = new Set(out.map((usage) => usage.documentId))
  for (const row of backlinks) {
    // A wire from a document to the object (a promoted arrow, or one drawn by hand) is a use like a board's card.
    if (!(isBoardBacklink(row) || row.kind === 'wire') || seen.has(row.sourceDocumentId)) continue
    seen.add(row.sourceDocumentId)
    out.push({
      documentId: row.sourceDocumentId,
      title: row.sourceTitle ?? titleOf(row.sourceDocumentId) ?? null,
      blockId: null,
    })
  }
  return out
}

// ---- wires: an end that is an object, and the board a wire was drawn on ------------------------------------------

/** What a bundle's wire summary may carry beyond the document-to-document fields (gardend G3). */
export interface WireBoardFields {
  /** An object end: the IRI. `otherDocumentId` is then empty. */
  readonly otherIri?: string | null
  /** The board the arrow was drawn on, and the arrow itself. */
  readonly sceneDocumentId?: string | null
  readonly sceneElementId?: string | null
}

export type WireEnd =
  | { readonly kind: 'object'; readonly iri: string; readonly label: string }
  | { readonly kind: 'document'; readonly documentId: string; readonly blockId: string | null; readonly label: string }

function iriTail(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':'))
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri
}

/** The far end of a wire: an object when it has an IRI (its label is the title the wire remembers), else a document. */
export function wireEndOf(wire: WireBoardFields & {
  readonly otherDocumentId: string
  readonly otherTitle?: string | null
  readonly otherBlockId?: string | null
}): WireEnd {
  const iri = wire.otherIri?.trim()
  if (iri && !wire.otherDocumentId) {
    return { kind: 'object', iri, label: wire.otherTitle?.trim() || iriTail(iri) }
  }
  return {
    kind: 'document',
    documentId: wire.otherDocumentId,
    blockId: wire.otherBlockId ?? null,
    label: wire.otherTitle?.trim() || wire.otherDocumentId,
  }
}

/** "from board {title}" for a wire drawn on a board; `null` for any other wire. The title is the sidebar node's. */
export function wireBoardProvenance(
  wire: WireBoardFields,
  titleOf: (documentId: string) => string | null | undefined,
): { readonly boardId: string; readonly boardTitle: string; readonly label: string } | null {
  const boardId = wire.sceneDocumentId?.trim()
  if (!boardId) return null
  const boardTitle = titleOf(boardId)?.trim() || boardId
  return { boardId, boardTitle, label: `from board ${boardTitle}` }
}

/**
 * The predicate to preselect in the menu for an arrow labelled `label`: the label itself when it already is a valid
 * single-token predicate name (`supports`, `condenses_into`), else `null`. A multi-word label ("condenses into") is
 * prose, not a predicate: seeding it would let Enter confirm a name gardend cannot make an IRI of.
 */
export function predicateSeedFromLabel(label: string | undefined | null): string | null {
  const name = label?.trim()
  return name && /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? name : null
}

// ---- `whiteboard_apply`'s answer to a `wire` move ----------------------------------------------------------------

export interface AppliedWire {
  readonly arrowId: string | null
  readonly wireId: string
  readonly predicate: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * The wires `whiteboard_apply` made, from a bare result or an MCP text-content wrapper, or the cell's own message when
 * it refused (an `isError` answer, or an `error` field). Never throws: the caller decides what a refusal is.
 */
export function readAppliedWires(raw: unknown): { readonly wires: readonly AppliedWire[]; readonly error: string | null } {
  let body = record(raw)
  let error: string | null = null
  if (body && Array.isArray(body.content)) {
    const text = body.content.map((part) => {
      const text = record(part)?.text
      return typeof text === 'string' ? text : ''
    }).join('\n').trim()
    if (body.isError === true) error = text || 'the cell refused'
    try {
      body = record(JSON.parse(text)) ?? record(body.structuredContent) ?? body
    } catch {
      body = record(body.structuredContent) ?? (error ? null : body)
    }
  } else if (body && record(body.structuredContent)) {
    body = record(body.structuredContent)
  }
  if (body && typeof body.error === 'string' && body.error) error = error ?? body.error
  const rows = body && Array.isArray(body.wires) ? body.wires : []
  const wires: AppliedWire[] = []
  for (const row of rows) {
    const entry = record(row)
    const wireId = entry && typeof entry.wireId === 'string' ? entry.wireId : ''
    if (!entry || !wireId) continue
    wires.push({
      wireId,
      arrowId: typeof entry.arrowId === 'string' ? entry.arrowId : null,
      predicate: typeof entry.predicate === 'string' ? entry.predicate : null,
    })
  }
  return { wires, error }
}
