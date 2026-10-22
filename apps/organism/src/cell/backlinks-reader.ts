/**
 * The shell's reader for `get_backlinks` (SPRINT D10): who links to a document, a block, an object or a board.
 * The same seam as the typed-object reader: an MCP tool port. gardend's REST route `GET /backlinks/{graph}` answers
 * the same JSON for callers without an MCP port; the shell does not use it.
 *
 * Owned by S1. The signatures below are FINAL; S1 replaces the bodies (and writes `backlinks-reader.test.ts`).
 */
import type { WbBacklink, WbBacklinkTarget, WbBacklinksResult } from '@shrubbery/runtime'
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

/** `get_backlinks {graphId, documentId | iri, blockId?}` parsed into rows; exactly one of `documentId` and `iri` is sent. */
export function makeBacklinksReader(port: McpToolPort, options?: BacklinksReaderOptions): BacklinksReader {
  void [port, options]
  throw new Error('S1')
}

/** Parse `get_backlinks`'s answer (a bare object or an MCP text-content wrapper) into a {@link WbBacklinksResult}. */
export function parseBacklinksResult(raw: unknown): WbBacklinksResult {
  void raw
  throw new Error('S1')
}
