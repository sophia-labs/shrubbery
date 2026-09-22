/**
 * fossil-source.ts — StaticNtSource: the 'static-nt' fossil TripleSource.
 *
 * Modeled on the organism harness's in-memory cell contract @ b2f408e, reduced
 * to the TripleSource surface + the fossil doctrine (Design 3, mandatory
 * graft):
 *
 *   - liveness 'static': the source is a fossil; content can never change.
 *   - readAt = capturedAt, ALWAYS — never load time. No-mocks applies to
 *     timestamps: stamping load time launders a fossil's age into apparent
 *     freshness (the exact W-1b defect).
 *   - Construction WITHOUT capture provenance (fossil v1 header or explicit
 *     {graphIri, capturedAt}) is REFUSED with a named error — the adapter
 *     must refuse rather than fabricate testimony.
 *   - select is honestly ABSENT (description.sparql === false); a fossil has
 *     no query engine.
 *
 * Browser-safe: pure string/array work over the nucleus codec.
 */

import {
  TripleSourceError,
  parseNT,
  type Triple,
  type TripleRead,
  type TripleSource,
  type TripleSourceDescription,
} from '@shrubbery/nucleus'
import { FOSSIL_MAGIC, parseFossilHeader, type FossilHeader } from './fossil-codec.js'

/** Explicit capture provenance for a body that carries no fossil v1 header. */
export type StaticNtProvenance = FossilHeader

/** Thrown when a static-nt source is constructed without capture provenance —
 *  the refusal the fossil doctrine mandates (never fabricate capturedAt). */
export class FossilProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FossilProvenanceError'
  }
}

/**
 * Build a 'static-nt' TripleSource from an N-Triples body.
 *
 * Provenance resolution: explicit `provenance` wins; otherwise the body's
 * fossil v1 header is parsed. If neither yields {graphIri, capturedAt}, the
 * construction throws FossilProvenanceError. A malformed fossil header
 * (magic present, fields broken) throws FossilCodecError verbatim; a
 * malformed N-Triples body throws parseNT's error verbatim.
 */
export function staticNtSource(body: string, provenance?: StaticNtProvenance): TripleSource {
  const header = provenance ?? parseFossilHeader(body)
  if (!header) {
    throw new FossilProvenanceError(
      'staticNtSource: refusing construction without capture provenance — the body ' +
        `carries no "${FOSSIL_MAGIC}" header and no explicit {graphIri, capturedAt} ` +
        'was given. A fossil without a capture time cannot testify honestly ' +
        '(readAt must be CAPTURE time, never load time); refusing beats fabricating.',
    )
  }
  if (!Number.isFinite(header.capturedAt)) {
    throw new FossilProvenanceError(
      `staticNtSource: capturedAt must be finite epoch ms, got ${String(header.capturedAt)}`,
    )
  }
  if (!header.graphIri) {
    throw new FossilProvenanceError('staticNtSource: provenance graphIri is required')
  }

  // Construction-time parse: the fossil's content is fixed for its lifetime.
  // parseNT skips '#' lines, so the header (when in-body) costs nothing.
  const triples: readonly Triple[] = parseNT(body)

  const description: TripleSourceDescription = {
    kind: 'static-nt',
    liveness: 'static',
    sparql: false,
    ...(header.source !== undefined ? { endpoint: header.source } : {}),
  }

  const read = (graphIri: string): Promise<TripleRead> => {
    if (graphIri !== header.graphIri) {
      return Promise.reject(
        new TripleSourceError(
          'not-found',
          `static-nt fossil holds <${header.graphIri}>; asked to read <${graphIri}>`,
        ),
      )
    }
    return Promise.resolve({
      graphIri: header.graphIri,
      readAt: header.capturedAt, // invariant 7: capture time, never load time
      tripleCount: triples.length,
      triples,
      nt: body,
    })
  }

  return {
    description,
    read,
    // select: honestly absent (description.sparql === false)
    // subscribe: honestly absent (liveness !== 'push')
    close: () => Promise.resolve(), // nothing owned; trivially idempotent
  }
}
