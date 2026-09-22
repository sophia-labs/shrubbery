/**
 * read-status.ts — the shared empty/error/malformed classification (design
 * §3.1's table): ONE TripleSource read, classified so the server AND the SPA
 * (U11, which imports this same module) agree on the taxonomy byte-for-byte.
 *
 *   | condition     | detection                                     |
 *   | -------------- | ---------------------------------------------- |
 *   | EMPTY          | settled read, tripleCount === 0                |
 *   | unauthorized   | TripleSourceError 401-shaped                   |
 *   | forbidden      | TripleSourceError 403-shaped                   |
 *   | not-found      | TripleSourceError 404-shaped                   |
 *   | unavailable    | connect failure / 5xx / CellUnavailable        |
 *   | malformed      | non-empty triples, parseTriplesToConfig throws |
 *   | ok             | non-empty triples, parses cleanly              |
 *
 * `TripleSourceError`'s 'protocol' code (the store answered, but not in the
 * contracted shape — a WIRE surprise) has no separate row in the design's
 * table; it is folded into 'unavailable' here — both are upstream/infra-level
 * failures the host cannot serve past, honestly named 503 rather than
 * inventing a sixth HTTP bucket the design never asked for. 'malformed' stays
 * reserved for OUR OWN parseTriplesToConfig throwing over triples the store DID
 * successfully hand back (the read succeeded; only the config shape didn't).
 *
 * No fallback config anywhere: every branch carries either a real TripleRead
 * or the upstream TripleSourceError verbatim.
 */

import {
  TripleSourceError,
  isEmptyRead,
  parseTriplesToConfig,
  triplesOf,
  type Triple,
  type TripleRead,
  type TripleSource,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'

export interface OkStatus {
  readonly kind: 'ok'
  readonly read: TripleRead
  readonly triples: readonly Triple[]
  readonly config: WorkspaceConfig
}

export interface EmptyStatus {
  readonly kind: 'empty'
  readonly read: TripleRead
}

export interface MalformedStatus {
  readonly kind: 'malformed'
  readonly read: TripleRead
  readonly triples: readonly Triple[]
  readonly error: Error
}

export type FailedKind = 'unauthorized' | 'forbidden' | 'not-found' | 'unavailable'

export interface FailedStatus {
  readonly kind: FailedKind
  readonly error: TripleSourceError
}

export type ReadStatus = OkStatus | EmptyStatus | MalformedStatus | FailedStatus

function classifyErrorCode(code: TripleSourceError['code']): FailedKind {
  switch (code) {
    case 'unauthorized':
      return 'unauthorized'
    case 'forbidden':
      return 'forbidden'
    case 'not-found':
      return 'not-found'
    case 'unavailable':
    case 'protocol':
      return 'unavailable'
  }
}

/** Read `graphIri` from `source` and classify the result. Re-throws anything
 *  that is NOT a `TripleSourceError` (a programmer error, not store testimony —
 *  the ONLY failure shape adapters may throw per the nucleus contract).
 *
 *  `triplesOf` (invariant-2 normalization) can ITSELF throw a `TripleSourceError`
 *  ('protocol' — a `TripleRead` carrying neither `triples` nor `nt`, the
 *  contract-violating shape a non-conforming third-party adapter might hand
 *  back) — that call is deliberately inside the SAME try/catch as `source.read`
 *  so a protocol-shape surprise classifies as 'unavailable' (503) exactly like
 *  every other upstream/infra-level failure, never escaping uncaught to a bare
 *  500. `parseTriplesToConfig` gets its OWN try/catch below: it is OUR OWN
 *  config-shape parser, and its failures stay 'malformed' — a distinct
 *  condition from the store answering in an uncontracted shape. */
export async function classifyRead(source: TripleSource, graphIri: string): Promise<ReadStatus> {
  let read: TripleRead
  let triples: readonly Triple[]
  try {
    read = await source.read(graphIri)
    if (isEmptyRead(read)) return { kind: 'empty', read }
    triples = triplesOf(read)
  } catch (e) {
    if (e instanceof TripleSourceError) {
      return { kind: classifyErrorCode(e.code), error: e }
    }
    throw e
  }
  try {
    const config = parseTriplesToConfig(triples)
    return { kind: 'ok', read, triples, config }
  } catch (e) {
    return { kind: 'malformed', read, triples, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

/** The HTTP status a ReadStatus maps to (design §3.1's table). */
export function httpStatusFor(status: ReadStatus): number {
  switch (status.kind) {
    case 'ok':
    case 'empty':
      return 200
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not-found':
      return 404
    case 'unavailable':
      return 503
    case 'malformed':
      return 500
  }
}

/** Whether the underlying READ itself succeeded (empty/ok/malformed all had a
 *  real TripleRead — only the config-shape interpretation may have failed).
 *  Health uses this: upstream connectivity, not our own config-parse logic. */
export function readSucceeded(status: ReadStatus): boolean {
  return status.kind === 'ok' || status.kind === 'empty' || status.kind === 'malformed'
}
