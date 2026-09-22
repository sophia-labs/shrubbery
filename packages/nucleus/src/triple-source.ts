/**
 * triple-source.ts — the TripleSource sub-contract: reading RDF as testimony.
 *
 * A STANDALONE sibling of ShrubberyContract (contract.ts), NOT a member of it:
 * a read-only host must be able to consume a triple store without faking
 * wireMode/ui/runtime. This file speaks only RDF universals — named-graph
 * IRIs, the nucleus Triple/Term model, N-Triples text, epoch-ms clocks, and
 * (optionally) SPARQL. Anything store-specific — MCP envelopes, loopback
 * manifests, gateway routes, graphId conventions, credentials — lives in the
 * adapter behind a factory, never in this interface. A stranger with a plain
 * Oxigraph/Fuseki endpoint can implement this contract without ever hearing
 * the word "gardend"; `@shrubbery/source/conformance` is the acceptance test.
 *
 * CONTRACT INVARIANTS (enforced by the conformance suite):
 *   1. Every read returns testimony: readAt (epoch ms), graphIri (what was
 *      actually read), tripleCount.
 *   2. At least one of `triples` / `nt` is present; when both are, they agree.
 *      `tripleCount` MUST equal the parsed triple count — never a transport
 *      envelope's own counter (the gardend `quadCount` lie).
 *   3. EMPTY (tripleCount === 0) is a successful read — a first-class store
 *      state, never an error and never an excuse for a fallback body.
 *      (parseTriplesToConfig throws on empty input; hosts pre-check.)
 *   4. Capability flags and optional methods agree: `select` is implemented
 *      iff `description.sparql`; `subscribe` is implemented iff
 *      `description.liveness === 'push'`. Hosts discover capabilities by
 *      reading `description`, never by probe-and-catch.
 *   5. Failures are thrown ONLY as TripleSourceError with a code from the
 *      closed taxonomy below; adapters map their transport's errors and carry
 *      the upstream message verbatim.
 *   6. `close()` is idempotent and releases every socket/timer/process the
 *      source owns.
 *   7. LIVENESS IS TESTIMONY, NOT ASPIRATION. A 'static' source's readAt is
 *      the fossil's CAPTURE time; an adapter must REFUSE construction rather
 *      than fabricate it (no-mocks applies to timestamps). A live source's
 *      readAt is read-completion time (the CellConfigRead.readAt lineage).
 *
 * Pure types + tiny pure helpers only — no DOM, no network, no node builtins.
 */

import type { Term, Triple } from './workspace/rdf-model.js'
import { parseNT } from './workspace/rdf-model.js'

// ── Liveness ─────────────────────────────────────────────────────────────────

/**
 * How this source learns about change — DECLARED by the adapter, never
 * inferred by the host:
 *   'push'   — the source notifies via subscribe(). NO in-tree adapter can
 *              honestly declare this today (gardend exposes no RDF named-graph
 *              change feed; the only SSE is service logs; hocuspocus carries
 *              CRDT sync, not :ux:config). The seam is reserved for one that
 *              can.
 *   'poll'   — reads are live but change detection is the host's re-read loop
 *              (honor `suggestedPollMs` when present).
 *   'static' — the source is a fossil; content can never change and readAt is
 *              the fossil's CAPTURE time (invariant 7), not load time.
 */
export const SOURCE_LIVENESS = ['push', 'poll', 'static'] as const
export type SourceLiveness = (typeof SOURCE_LIVENESS)[number]

// ── Self-description (capability discovery) ─────────────────────────────────

/** A source's self-description. Safe to serialize and show to users/agents —
 *  MUST NOT contain credentials (endpoints are redacted of tokens/userinfo by
 *  the adapter). Adapters may structurally extend this with adapter-specific
 *  display fields (e.g. the hosted adapter's readPath) — such fields live in
 *  the adapter package, never here. */
export interface TripleSourceDescription {
  /** Adapter identity, e.g. 'gardend-local' | 'hosted-gateway' | 'sparql-http'
   *  | 'static-nt' — or any third-party name. OPEN string; display/diagnostic
   *  only: hosts MUST NOT switch behavior on it. */
  readonly kind: string
  readonly liveness: SourceLiveness
  /** True iff select() is implemented. */
  readonly sparql: boolean
  /** Optional provenance for testimony display (endpoint URL, file path…).
   *  Never a secret. */
  readonly endpoint?: string
  /** For 'poll' sources: the adapter's recommended re-read interval. */
  readonly suggestedPollMs?: number
}

// ── The read result: testimony, not just data ───────────────────────────────

/** One read of one named graph, with its provenance. */
export interface TripleRead {
  /** The named-graph IRI that was actually read. */
  readonly graphIri: string
  /** Epoch ms at which these triples were obtained FROM THE AUTHORITATIVE
   *  STORE: read completion for live sources, capture time for fossils. */
  readonly readAt: number
  /** Authoritative count — equals the parsed triple count (invariant 2). */
  readonly tripleCount: number
  /** Parsed triples (preferred carrier). */
  readonly triples?: readonly Triple[]
  /** Raw N-Triples body (alternate carrier; present when the source natively
   *  produced one — rdf_dump bodies, fossils. Useful for the turtle face,
   *  debugging, re-serialization). */
  readonly nt?: string
}

/** EMPTY is a first-class state — sugar for the pre-parse check every host
 *  must make before parseTriplesToConfig. */
export function isEmptyRead(read: TripleRead): boolean {
  return read.tripleCount === 0
}

/** Normalize a read to triples: prefer the parsed carrier, else parse `nt`.
 *  Throws TripleSourceError('protocol') if the read carries neither. */
export function triplesOf(read: TripleRead): readonly Triple[] {
  if (read.triples) return read.triples
  if (read.nt !== undefined) return parseNT(read.nt)
  throw new TripleSourceError(
    'protocol',
    `TripleRead for <${read.graphIri}> carries neither triples nor nt`,
  )
}

// ── Optional SPARQL capability ───────────────────────────────────────────────

/** A SELECT binding term. Extends the nucleus Term with blank nodes, which
 *  third-party stores legitimately return even though the nucleus Triple
 *  model (deliberately) never emits them. */
export type SourceTerm = Term | { readonly type: 'bnode'; readonly value: string }

/** A SPARQL SELECT result, with the same testimony discipline as reads. */
export interface SelectResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, SourceTerm>>>
  readonly readAt: number
}

// ── Error taxonomy ───────────────────────────────────────────────────────────

export type TripleSourceErrorCode =
  | 'unauthorized' // credentials missing/expired (HTTP 401-shaped)
  | 'forbidden' // authenticated but not allowed (403-shaped)
  | 'not-found' // store/dataset/graph does not exist (404-shaped)
  | 'unavailable' // store unreachable / still starting / 5xx-shaped
  | 'protocol' // the store answered, but not in the contracted shape

/** The ONLY failure shape adapters may throw. `detail` carries the upstream
 *  message verbatim (honest errors, never rewritten). */
export class TripleSourceError extends Error {
  readonly code: TripleSourceErrorCode
  /** Upstream HTTP status, when there was one. */
  readonly status?: number
  readonly detail?: string

  constructor(
    code: TripleSourceErrorCode,
    message: string,
    opts?: { status?: number; detail?: string; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'TripleSourceError'
    this.code = code
    this.status = opts?.status
    this.detail = opts?.detail
  }
}

// ── The contract ─────────────────────────────────────────────────────────────

/**
 * A readable RDF store bound (at construction, by an adapter factory) to one
 * endpoint + dataset + credential. `read` addresses named graphs WITHIN that
 * binding — which is what keeps store-specific graph addressing (e.g. a
 * gardend graphId) out of this interface.
 */
export interface TripleSource {
  readonly description: TripleSourceDescription

  /**
   * Dump one named graph. EMPTY (tripleCount === 0) resolves successfully.
   * Rejects only with TripleSourceError.
   */
  read(graphIri: string): Promise<TripleRead>

  /**
   * OPTIONAL — present iff description.sparql. Run a SPARQL SELECT against
   * the bound store (the read-recipe's COUNT cross-check; FID-004 probes;
   * richer faces).
   */
  select?(sparql: string): Promise<SelectResult>

  /**
   * OPTIONAL — present iff description.liveness === 'push'. Reserved seam:
   * NO in-tree adapter implements it this slice (no RDF push surface exists
   * on gardend). Returns an unsubscribe function.
   */
  subscribe?(graphIri: string, onChange: (read: TripleRead) => void): () => void

  /** Release sockets/timers/processes. Idempotent. */
  close(): Promise<void>
}
