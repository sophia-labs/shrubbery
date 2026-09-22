/**
 * testimony.ts — the SIX X-Shrubbery-* headers + Last-Modified, computed ONCE
 * per request from a completed `TripleRead` + the adapter's `TripleSourceDescription`
 * (Design 1's construction, J1 graft) — face-invariant BY CONSTRUCTION (every
 * face of one resource is handed the SAME `Testimony` value), never asserted
 * per-route.
 *
 * Also the two host-seam body blocks the render package itself never emits
 * (render-package changes are out of scope — the tested Link-set-parity
 * invariant there stays untouched):
 *   - the hypertext/html FOOTER line;
 *   - the `#`-comment CAPTURE BLOCK prefixed to the turtle face (J2 graft) —
 *     `#` lines are skipped by both `parseNT` and `parseTurtle`, so
 *     `parseTurtle -> parseTriplesToConfig` round-trips through it unchanged
 *     (pinned by test).
 *
 * Pure: no DOM, no network — a TripleRead/TripleSourceDescription in, strings out.
 */

import { epochMsToIso, formatTimestamp } from '@shrubbery/nucleus'
import type { TripleRead, TripleSourceDescription } from '@shrubbery/nucleus'

/** The testimony envelope for ONE completed read — shared by every face. */
export interface Testimony {
  readonly readAt: number
  readonly readAtIso: string
  readonly graphIri: string
  readonly tripleCount: number
  /** The adapter kind (`description.kind`), e.g. 'gardend-local' | 'static-nt'. */
  readonly source: string
  readonly liveness: string
  /** Adapter endpoint, when the adapter discloses one (never a secret). */
  readonly endpoint?: string
}

export function testimonyFor(read: TripleRead, description: TripleSourceDescription): Testimony {
  return {
    readAt: read.readAt,
    readAtIso: epochMsToIso(read.readAt),
    graphIri: read.graphIri,
    tripleCount: read.tripleCount,
    source: description.kind,
    liveness: description.liveness,
    ...(description.endpoint !== undefined ? { endpoint: description.endpoint } : {}),
  }
}

/** The six X-Shrubbery-* headers + Last-Modified — IDENTICAL across all four
 *  faces of one resource (the acceptance's face-invariance pin). */
export function testimonyHeaders(t: Testimony): Record<string, string> {
  return {
    'X-Shrubbery-Read-At': String(t.readAt),
    'X-Shrubbery-Read-At-Iso': t.readAtIso,
    'X-Shrubbery-Graph-Iri': t.graphIri,
    'X-Shrubbery-Triple-Count': String(t.tripleCount),
    'X-Shrubbery-Source': t.source,
    'X-Shrubbery-Liveness': t.liveness,
    'Last-Modified': new Date(t.readAt).toUTCString(),
  }
}

/** MED-3: liveness-aware capture-verb — a 'static' fossil was CAPTURED at a
 *  fixed point in the past (never "read live", which claims an ongoing
 *  connection this source structurally cannot have); a 'poll'/'push' source
 *  genuinely reads live. Shared by every body block below so the wording
 *  stays a single decision, not four independently-drifting copies. */
function captureVerb(t: Testimony): 'captured' | 'read live' {
  return t.liveness === 'static' ? 'captured' : 'read live'
}

/** The one-line testimony clause — liveness-aware (MED-3): "captured {when}
 *  from {label} (static fossil)" for a fossil, "read live from {label} at
 *  {when}" for a live source — always followed by the same triple-count +
 *  graphIri + liveness tail. */
function testimonyLine(t: Testimony, when: string): string {
  const label = t.endpoint ?? t.source
  const clause =
    captureVerb(t) === 'captured' ? `captured ${when} from ${label} (static fossil)` : `read live from ${label} at ${when}`
  return `${clause} — ${t.tripleCount} triples in <${t.graphIri}> (${t.liveness})`
}

/** The hypertext/html footer line (design §3.1), liveness-aware (MED-3):
 *  "read live from {endpoint} at {formatTimestamp(readAt)} — {n} triples in
 *  <{graphIri}> ({liveness})" for a live source, "captured {when} from
 *  {endpoint} (static fossil) — …" for a fossil. Falls back to the adapter
 *  kind when no endpoint is disclosed. */
export function testimonyFooter(t: Testimony, now?: number): string {
  const when = formatTimestamp(t.readAt, now !== undefined ? { now } : undefined)
  return testimonyLine(t, when)
}

/** The `#`-comment capture block prefixed to the turtle face, liveness-aware
 *  (MED-3) — same wording as `testimonyFooter`. Full-line `#` comments are
 *  skipped by both `parseNT` and `parseTurtle` (verified: turtle.ts
 *  `parseTurtle` strips `line.trim().startsWith('#')`), so this NEVER perturbs
 *  the `parseTurtle -> parseTriplesToConfig` round-trip. */
export function testimonyCaptureComment(t: Testimony): string {
  const label = t.endpoint ?? t.source
  const clause =
    captureVerb(t) === 'captured' ? `captured ${t.readAtIso} from ${label} (static fossil)` : `read live from ${label} at ${t.readAtIso}`
  return [`# ${clause}`, `# ${t.tripleCount} triples in <${t.graphIri}> (${t.liveness})`].join('\n')
}

/** The RESERVED `?asof` grammar note (design §3.1): present whenever `?asof` was
 *  supplied, an explicit "not available" testimony line rather than a silently
 *  ignored query param. A dated lens is a NAMED later slice, not this one. */
export function asofNotAvailableLine(liveness: string): string {
  return `temporal lens not available for this source (liveness=${liveness}; no history index)`
}

// ── Stale capture (design §3.1: "Error faces carry the last successful
//    read's capture block when one exists, clearly labeled stale") ─────────
//
// A FailedStatus (unauthorized/forbidden/not-found/unavailable) carries NO
// TripleRead of its own — there is nothing for `testimonyFor` to describe.
// When an EARLIER read on this same bound source DID succeed (ok or empty —
// the `SourceState.read` retention rule from packages/source's
// source-store.ts: "set for ready AND empty; retained through later errors,
// hosts label it stale"), the host may still show that prior testimony,
// unambiguously marked STALE so it is never mistaken for the current state.

/** Markdown/plain-text stale block, appended after the error body.
 *  Liveness-aware wording (MED-3), same as `testimonyFooter`. */
export function staleCaptureMarkdown(t: Testimony, now?: number): string {
  const when = formatTimestamp(t.readAt, now !== undefined ? { now } : undefined)
  return [
    '> **STALE** — last known-good read (before this failure), never the current state:',
    `> ${testimonyLine(t, when)}`,
  ].join('\n')
}

/** The `#`-comment stale block for the turtle error face (skipped by the
 *  parsers, same discipline as `testimonyCaptureComment`). Liveness-aware
 *  wording (MED-3). */
export function staleCaptureTurtleComment(t: Testimony): string {
  const label = t.endpoint ?? t.source
  const clause =
    captureVerb(t) === 'captured' ? `captured ${t.readAtIso} from ${label} (static fossil)` : `read live from ${label} at ${t.readAtIso}`
  return [
    '# STALE — last known-good read (before this failure), never the current state:',
    `# ${clause}`,
    `# ${t.tripleCount} triples in <${t.graphIri}> (${t.liveness})`,
  ].join('\n')
}

/** The JSON stale block — `stale: true` is the unambiguous marker. */
export function staleCaptureJson(t: Testimony): Record<string, unknown> {
  return {
    stale: true,
    readAt: t.readAt,
    readAtIso: t.readAtIso,
    graphIri: t.graphIri,
    tripleCount: t.tripleCount,
    source: t.source,
    liveness: t.liveness,
    ...(t.endpoint !== undefined ? { endpoint: t.endpoint } : {}),
  }
}
