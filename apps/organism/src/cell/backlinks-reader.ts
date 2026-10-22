/**
 * The shell's reader for `get_backlinks` (SPRINT D10): who links to a document, a block, an object or a board.
 * The same seam as the typed-object reader: an MCP tool port. gardend's REST route `GET /backlinks/{graph}` answers
 * the same JSON for callers without an MCP port; the shell does not use it.
 *
 * Owned by S1. The signatures below are FINAL; S1 replaces the bodies (and writes `backlinks-reader.test.ts`).
 */
import type { WbBacklink, WbBacklinkKind, WbBacklinkTarget, WbBacklinksResult } from '@shrubbery/runtime'
import type { McpToolPort } from './typed-object-reader.js'

export interface BacklinksReader {
  /** The rows, sorted as gardend returns them. A graph or target gardend does not know is an empty list, not an error. */
  read(target: WbBacklinkTarget): Promise<readonly WbBacklink[]>
  /** Drop what is cached for a graph (or all), so the next read asks the cell. */
  forget(graphId?: string): void
}

export interface BacklinksReaderOptions {
  readonly now?: () => number
  /** How long a read is reused. Default 5000 ms. */
  readonly ttlMs?: number
}

const DEFAULT_TTL_MS = 5000

const KINDS: ReadonlySet<string> = new Set<WbBacklinkKind>([
  'wire',
  'embed',
  'wikilink',
  'link',
  'board-link',
  'board-card',
  'board-connection',
])

interface Entry {
  readonly at: number
  readonly graphId: string
  readonly rows: Promise<readonly WbBacklink[]>
}

/** The arguments of one call: exactly one of `documentId` and `iri` (a document wins if both were given). */
function callArguments(target: WbBacklinkTarget): Record<string, unknown> {
  const args: Record<string, unknown> = { graphId: target.graphId }
  if (target.documentId) args.documentId = target.documentId
  else if (target.iri) args.iri = target.iri
  else throw new Error('get_backlinks needs a documentId or an iri')
  if (target.blockId && target.documentId) args.blockId = target.blockId
  return args
}

function cacheKey(args: Record<string, unknown>): string {
  return JSON.stringify([args.graphId, args.documentId ?? null, args.iri ?? null, args.blockId ?? null])
}

/** A graph or target gardend does not know reads as nobody linking to it. */
function isUnknown(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not[ _-]?found|unknown (graph|document)|no such (graph|document)/i.test(message)
}

/** `get_backlinks {graphId, documentId | iri, blockId?}` parsed into rows; exactly one of `documentId` and `iri` is sent. */
export function makeBacklinksReader(port: McpToolPort, options?: BacklinksReaderOptions): BacklinksReader {
  const now = options?.now ?? Date.now
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  const cache = new Map<string, Entry>()

  return {
    read(target) {
      let args: Record<string, unknown>
      try {
        args = callArguments(target)
      } catch (error) {
        return Promise.reject(error)
      }
      const key = cacheKey(args)
      const hit = cache.get(key)
      const at = now()
      if (hit && at - hit.at < ttlMs) return hit.rows
      const rows: Promise<readonly WbBacklink[]> = port.callTool('get_backlinks', args).then(
        (raw) => parseBacklinksResult(raw).backlinks,
        (error) => {
          if (isUnknown(error)) return []
          // A failed read is never kept: the next ask goes to the cell again.
          if (cache.get(key)?.rows === rows) cache.delete(key)
          throw error
        },
      )
      cache.set(key, { at, graphId: target.graphId, rows })
      return rows
    },
    forget(graphId) {
      if (graphId === undefined) {
        cache.clear()
        return
      }
      for (const [key, entry] of cache) if (entry.graphId === graphId) cache.delete(key)
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Unwrap an MCP result: a bare object, `structuredContent`, or `content: [{type: 'text', text: '<json>'}]`. */
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return unwrap(JSON.parse(raw))
    } catch {
      return null
    }
  }
  if (!isRecord(raw)) return null
  if (Array.isArray(raw.backlinks)) return raw
  if (isRecord(raw.structuredContent)) return unwrap(raw.structuredContent)
  if (isRecord(raw.result)) return unwrap(raw.result)
  if (Array.isArray(raw.content)) {
    for (const part of raw.content) {
      if (isRecord(part) && typeof part.text === 'string') {
        const inner = unwrap(part.text)
        if (inner) return inner
      }
    }
  }
  return null
}

function optionalText(row: Record<string, unknown>, key: string): { [k: string]: string } {
  const value = row[key]
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

function parseRow(value: unknown): WbBacklink | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const sourceDocumentId = value.sourceDocumentId
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null
  if (typeof sourceDocumentId !== 'string' || !sourceDocumentId) return null
  return {
    kind: kind as WbBacklinkKind,
    sourceDocumentId,
    ...optionalText(value, 'sourceBlockId'),
    ...optionalText(value, 'sourceTitle'),
    ...optionalText(value, 'sourceKind'),
    ...optionalText(value, 'predicate'),
    ...optionalText(value, 'wireId'),
    ...optionalText(value, 'viaConnection'),
  }
}

/** Parse `get_backlinks`'s answer (a bare object or an MCP text-content wrapper) into a {@link WbBacklinksResult}. */
export function parseBacklinksResult(raw: unknown): WbBacklinksResult {
  const body = unwrap(raw)
  if (!body) {
    // An error answer reads as its message; anything else unrecognised is an answer with no rows.
    if (isRecord(raw) && raw.isError === true && Array.isArray(raw.content)) {
      const text = raw.content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join(' ').trim()
      throw new Error(text || 'get_backlinks failed')
    }
    return { graphId: '', target: {}, backlinks: [], count: 0 }
  }
  const backlinks = (body.backlinks as unknown[]).map(parseRow).filter((row): row is WbBacklink => row !== null)
  const target = isRecord(body.target) ? body.target : {}
  return {
    graphId: typeof body.graphId === 'string' ? body.graphId : '',
    target: {
      ...optionalText(target, 'documentId'),
      ...optionalText(target, 'iri'),
      ...optionalText(target, 'blockId'),
    },
    backlinks,
    count: typeof body.count === 'number' ? body.count : backlinks.length,
  }
}
