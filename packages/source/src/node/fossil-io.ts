/**
 * fossil-io.ts — NODE-ONLY fossil file I/O over the browser-safe fossil-codec.
 *
 * writeFossil is how fossils are PRODUCED (dump.mts rides on it): it takes a
 * real TripleRead and stamps the read's own testimony — graphIri and readAt —
 * into the v1 header, so every fossil carries capture provenance by
 * construction (the anti-W-1b property: a fossil's capturedAt is the read
 * completion instant at the authoritative store, never the write instant).
 *
 * readFossil is the honest inverse: it REFUSES a header-stripped body with a
 * named error instead of loading a fossil that cannot testify.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { triplesOf, triplesToNT, type TripleRead } from '@shrubbery/nucleus'
import {
  FOSSIL_MAGIC,
  FossilCodecError,
  parseFossilHeader,
  serializeFossil,
  type FossilHeader,
} from '../fossil/fossil-codec.js'

/** A fossil file read back from disk. `text` is the full file content —
 *  valid staticNtSource input (header + .nt body). */
export interface FossilFile {
  readonly header: FossilHeader
  /** Full file text (v1 header + N-Triples body). */
  readonly text: string
}

/**
 * Read a fossil file. Throws FossilCodecError when the file carries no
 * fossil v1 magic (a header-stripped fossil is refused, never laundered into
 * apparent freshness) or a malformed header (codec error verbatim).
 */
export async function readFossil(path: string): Promise<FossilFile> {
  const text = await readFile(path, 'utf8')
  const header = parseFossilHeader(text) // malformed header throws verbatim
  if (header === null) {
    throw new FossilCodecError(
      `readFossil: ${path} carries no "${FOSSIL_MAGIC}" header — a fossil without ` +
        'capture provenance cannot testify (readAt must be CAPTURE time, never load ' +
        'time). Re-dump it with writeFossil / dump.mts.',
    )
  }
  return { header, text }
}

/**
 * Write a TripleRead to disk as a fossil v1 file. The header's capture
 * testimony comes from the read itself: graphIri verbatim, capturedAt =
 * read.readAt. The body prefers the read's native nt carrier (byte-faithful
 * to the store's own serialization); a triples-only read is serialized via
 * triplesToNT; a read with neither carrier throws (triplesOf, verbatim).
 *
 * `source` is the optional human-readable capture source for the header,
 * e.g. 'gardend-local http://127.0.0.1:7090' — never a secret.
 *
 * Returns the header written (the caller's receipt).
 */
export async function writeFossil(
  path: string,
  read: TripleRead,
  source?: string,
): Promise<FossilHeader> {
  const body = read.nt ?? triplesToNT(triplesOf(read))
  const header: FossilHeader = {
    graphIri: read.graphIri,
    capturedAt: read.readAt,
    ...(source !== undefined && source !== '' ? { source } : {}),
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeFossil(header, body), 'utf8')
  return header
}
