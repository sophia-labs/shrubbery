/**
 * fossil-codec.ts — the shrubbery fossil v1 provenance-header codec.
 *
 * A fossil is a captured N-Triples body whose provenance rides in leading
 * `#` comment lines, so the file stays a valid .nt everywhere (`parseNT`
 * skips `#` lines). Written by `writeFossil` / `dump.mts`, parsed here:
 *
 *   # shrubbery fossil v1
 *   # graphIri: urn:mnemosyne:local:graph:g1:ux:config
 *   # capturedAt: 1783200000000 (2026-07-11T19:20:00.000Z)
 *   # source: gardend-local http://127.0.0.1:7090
 *   <subject> <predicate> <object> .
 *   …
 *
 * The capture provenance is TESTIMONY: a 'static' TripleSource's readAt is the
 * fossil's CAPTURE time, never load time (nucleus triple-source invariant 7 —
 * stamping load time launders a fossil's age into apparent freshness).
 *
 * Pure string transforms — browser-safe, no node builtins.
 */

/** The v1 magic line. A body whose first non-blank line is not this is simply
 *  not a fossil (parseFossilHeader → null), never an error. */
export const FOSSIL_MAGIC = '# shrubbery fossil v1'

/** Capture provenance carried by a fossil header. */
export interface FossilHeader {
  /** The named-graph IRI the body was dumped from. */
  readonly graphIri: string
  /** Epoch ms at which the body was captured from the authoritative store. */
  readonly capturedAt: number
  /** Optional human-readable capture source, e.g.
   *  'gardend-local http://127.0.0.1:7090'. Never a secret. */
  readonly source?: string
}

/** A fossil that declares the v1 magic but carries a malformed/incomplete
 *  header is corrupt — surfaced verbatim, never patched over. */
export class FossilCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FossilCodecError'
  }
}

/**
 * Parse the fossil v1 header from a body.
 *
 * Returns `null` when the body does not declare the v1 magic (a plain .nt
 * file — honestly not a fossil). Throws `FossilCodecError` when the magic is
 * present but `graphIri` or `capturedAt` is missing or malformed.
 *
 * Only the leading run of `#` lines is scanned; the first non-`#` line ends
 * the header (so `#` comments inside the body — e.g. a generated seed's own
 * banner — are never misread). First occurrence of each key wins.
 */
export function parseFossilHeader(text: string): FossilHeader | null {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length || lines[i].trim() !== FOSSIL_MAGIC) return null
  i++

  let graphIri: string | undefined
  let capturedAtRaw: string | undefined
  let source: string | undefined
  for (; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('#')) break
    const m = /^#\s*(graphIri|capturedAt|source):\s*(.*)$/.exec(line)
    if (!m) continue // an unrelated comment line inside the header run
    const [, key, value] = m
    if (key === 'graphIri' && graphIri === undefined) graphIri = value.trim()
    else if (key === 'capturedAt' && capturedAtRaw === undefined) capturedAtRaw = value.trim()
    else if (key === 'source' && source === undefined) source = value.trim()
  }

  if (!graphIri) {
    throw new FossilCodecError('fossil v1 header is missing "# graphIri: <iri>"')
  }
  if (capturedAtRaw === undefined) {
    throw new FossilCodecError('fossil v1 header is missing "# capturedAt: <epoch-ms>"')
  }
  const capturedMatch = /^(\d+)(?:\s|$)/.exec(capturedAtRaw)
  if (!capturedMatch) {
    throw new FossilCodecError(
      `fossil v1 header has a malformed capturedAt (expected epoch ms): "${capturedAtRaw}"`,
    )
  }
  const capturedAt = Number(capturedMatch[1])
  if (!Number.isFinite(capturedAt)) {
    throw new FossilCodecError(`fossil v1 capturedAt is not a finite number: "${capturedAtRaw}"`)
  }
  return source !== undefined && source !== ''
    ? { graphIri, capturedAt, source }
    : { graphIri, capturedAt }
}

/**
 * Serialize a fossil: the v1 header followed by the N-Triples body verbatim.
 * The capturedAt line carries the epoch ms (authoritative, parsed back) plus
 * its ISO rendering (human courtesy, ignored by the parser).
 */
export function serializeFossil(header: FossilHeader, ntBody: string): string {
  if (!header.graphIri) throw new FossilCodecError('serializeFossil: graphIri is required')
  if (!Number.isFinite(header.capturedAt)) {
    throw new FossilCodecError('serializeFossil: capturedAt must be finite epoch ms')
  }
  const out: string[] = [
    FOSSIL_MAGIC,
    `# graphIri: ${header.graphIri}`,
    `# capturedAt: ${header.capturedAt} (${new Date(header.capturedAt).toISOString()})`,
  ]
  if (header.source) out.push(`# source: ${header.source}`)
  return `${out.join('\n')}\n${ntBody}`
}
